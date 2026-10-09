"""Extract native presentation phases from saved Lighthouse artifacts only."""
import gzip
import hashlib
import json
import sys
from pathlib import Path

folder = Path(sys.argv[1]).resolve()
measurements = json.loads((folder / "measurements.json").read_text())


def identity(event):
    return json.dumps(event.get("id2", event.get("id")), sort_keys=True)


def occupied(events, pid, tid, start, end):
    tasks = [e for e in events if e["name"] == "RunTask"
             and e["pid"] == pid and e["tid"] == tid
             and e["ts"] < end and e["ts"] + e.get("dur", 0) > start]
    spans = sorted((max(start, e["ts"]), min(end, e["ts"] + e.get("dur", 0)))
                   for e in tasks)
    merged = []
    for left, right in spans:
        if merged and left <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], right)
        else:
            merged.append([left, right])
    wall = sum(right - left for left, right in merged) / 1000
    return {"wallMs": (end - start) / 1000, "runTaskWallMs": wall,
            "outsideRunTaskMs": (end - start) / 1000 - wall}


def renderer_threads(events, pid, start, end):
    """Union recorded wall intervals per thread; do not sum nested events."""
    names = {e["tid"]: e.get("args", {}).get("name") for e in events
             if e["pid"] == pid and e["name"] == "thread_name"}
    grouped = {}
    for event in events:
        if (event["pid"] == pid and event.get("ph") == "X"
                and event.get("dur", 0) > 0 and event["ts"] < end
                and event["ts"] + event["dur"] > start):
            grouped.setdefault(event["tid"], []).append(event)
    result = []
    for thread, tasks in grouped.items():
        spans = sorted((max(start, e["ts"]), min(end, e["ts"] + e["dur"]))
                       for e in tasks)
        merged = []
        for left, right in spans:
            if merged and left <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], right)
            else:
                merged.append([left, right])
        result.append({"tid": thread, "name": names.get(thread),
                       "recordedWallMs": sum(b - a for a, b in merged) / 1000,
                       "longestRecordedEvents": [
                           {"name": e["name"], "wallMs": e["dur"] / 1000,
                            "cpuMs": e.get("tdur", 0) / 1000}
                           for e in sorted(tasks, key=lambda e: e["dur"], reverse=True)[:5]]})
    return sorted(result, key=lambda row: row["recordedWallMs"], reverse=True)


def extract(number):
    name = f"home-{number}"
    inputs = [folder / f"{name}.json", folder / f"{name}-Trace.json.gz",
              folder / f"{name}-DevtoolsLog.json.gz"]
    lhr = json.loads(inputs[0].read_text())
    events = json.load(gzip.open(inputs[1], "rt"))["traceEvents"]
    nav = next(e for e in events if e["name"] == "navigationStart"
               and e.get("args", {}).get("data", {}).get("documentLoaderURL")
               == lhr["requestedUrl"])
    start, pid, tid = nav["ts"], nav["pid"], nav["tid"]
    lcp = next(e for e in reversed(events)
               if e["name"] == "largestContentfulPaint::Candidate"
               and e["pid"] == pid
               and e.get("args", {}).get("data", {}).get("navigationId")
               == nav["args"]["data"]["navigationId"])
    presented = []
    for begin in events:
        if (begin["name"] != "PipelineReporter" or begin["pid"] != pid
                or begin["ph"] != "b" or begin["ts"] < start
                or begin["ts"] > lcp["ts"]
                or begin.get("args", {}).get("frame_reporter", {}).get("state")
                != "STATE_PRESENTED_ALL"):
            continue
        end = next((e for e in events if e["pid"] == pid
                    and e["name"] == "PipelineReporter" and e["ph"] == "e"
                    and identity(e) == identity(begin) and e["ts"] > begin["ts"]), None)
        if end:
            presented.append((begin, end))
    stages = []
    if presented:
        begin, end = min(presented, key=lambda p: abs(p[1]["ts"] - lcp["ts"]))
        if abs(end["ts"] - lcp["ts"]) < 1000:
            related = [e for e in events if e["pid"] == pid
                       and identity(e) == identity(begin)
                       and begin["ts"] <= e["ts"] <= end["ts"]
                       and e["name"] != "PipelineReporter"]
            for phase in related:
                if phase["ph"] != "b":
                    continue
                finish = next((e for e in related if e["name"] == phase["name"]
                               and e["ph"] == "e" and e["ts"] >= phase["ts"]), None)
                if finish:
                    stages.append({"name": phase["name"],
                                   "startMs": (phase["ts"] - start) / 1000,
                                   **occupied(events, pid, tid, phase["ts"], finish["ts"]),
                                   "rendererRecordedThreads": renderer_threads(
                                       events, pid, phase["ts"], finish["ts"])})
    audits = lhr["audits"]
    return {"name": name, "fetchTime": lhr["fetchTime"],
            "modeledLcpMs": audits["largest-contentful-paint"]["numericValue"],
            "observedLcpMs": (lcp["ts"] - start) / 1000,
            "nativeBreakdown": audits["lcp-breakdown-insight"]["details"],
            "discovery": audits["lcp-discovery-insight"]["details"],
            "renderBlocking": audits.get("render-blocking-insight", {}).get("details"),
            "mainthread": audits["mainthread-work-breakdown"]["details"],
            "nativePresentedFrameStages": stages,
            "mainThreadTasksAbove15MsBeforeLcp": [
                {"name": e["name"], "startMs": (e["ts"] - start) / 1000,
                 "wallMs": e.get("dur", 0) / 1000,
                 "cpuMs": e.get("tdur", 0) / 1000}
                for e in events if e["pid"] == pid and e["tid"] == tid
                and start <= e["ts"] <= lcp["ts"] and e.get("dur", 0) > 15000
                and e["name"] not in ("RunTask", "FunctionCall", "EvaluateScript")],
            "inputSha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                            for p in inputs}}


report = {"scope": "Saved artifacts only; no HTTP, browser or application changes",
          "sourceSHA": measurements["sourceSHA"], "profile": measurements["profile"],
          "nativePhasesAreNotModeledLcp": True,
          "samples": [extract(row["run"]) for row in measurements["runs"] if row["valid"]]}
(folder / "trace-diagnosis.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"samples": len(report["samples"]), "lcp": [
    {"name": row["name"], "modeled": row["modeledLcpMs"], "observed": row["observedLcpMs"]}
    for row in report["samples"]]}, indent=2))
