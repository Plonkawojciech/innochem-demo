"""Exact VM step/delivered snapshot 2026-10-09; no transport or credentials.
Source SHA256: e75bfa6b0d97a4853c2484ce2ada37631b55ee8c7d743cc601ef2511041e7f35
Catalog rendering is irrelevant to delivery state; the tests replace describe.
"""
import time

def describe(issue, metrics=None):
    return {"key": issue, "severity": 1, "title": issue, "raw": issue}

DEBOUNCE_CHECKS = 2


RESOLVE_AFTER_MISSES = 3


REMIND_AFTER = 12 * 3600


RETRY_AFTER = 120


def step(state, issues, metrics=None, now=None):
    """Advance per-problem state; return what should be sent now.

    state: {"problems": {key: {...}}, "attemptAt": ts}. Mutated in place.
    """
    now = time.time() if now is None else now
    problems = state.setdefault("problems", {})
    seen = {}
    for issue in issues:
        d = describe(issue, metrics)
        seen.setdefault(d["key"], d)
    for key, d in seen.items():
        p = problems.setdefault(key, {"firstSeen": now, "checks": 0, "alertedAt": None})
        p.update(checks=p["checks"] + 1, misses=0, lastSeen=now, info=d)
    resolved = []
    for key in list(problems):
        if key in seen:
            continue
        p = problems[key]
        p["misses"] = p.get("misses", 0) + 1
        if p["misses"] >= RESOLVE_AFTER_MISSES:
            if p.get("alertedAt"):
                resolved.append(dict(p, resolvedAt=p.get("lastSeen", now)))
            del problems[key]
    new = [p for k, p in problems.items() if k in seen and not p.get("alertedAt") and p["checks"] >= DEBOUNCE_CHECKS]
    remind = [p for k, p in problems.items() if k in seen and p.get("alertedAt") and now - p["alertedAt"] > REMIND_AFTER]
    ongoing = [p for k, p in problems.items() if k in seen and p.get("alertedAt") and p not in remind]
    pending_resolved = state.setdefault("pendingResolved", [])
    pending_resolved.extend(resolved)
    due = bool(new or remind or pending_resolved) and now - state.get("attemptAt", 0) > RETRY_AFTER
    order = lambda p: (p["info"]["severity"], p["firstSeen"])
    return {"due": due, "new": sorted(new, key=order), "remind": sorted(remind, key=order),
            "resolved": list(pending_resolved), "ongoing": sorted(ongoing, key=order)}


def delivered(state, plan, now=None):
    now = time.time() if now is None else now
    for p in plan["new"] + plan["remind"]:
        p["alertedAt"] = now
    state["pendingResolved"] = []
