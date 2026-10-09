#!/usr/bin/env python3
"""Use Programo's existing mail/push transport and debounce for Innochem checks."""

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

RECIPIENT = "wojciech.plonka@programo.pl"
FAILURES = {
    "container": "kontener sklepu nie jest zdrowy",
    "http": "endpoint HTTPS sklepu nie odpowiada poprawnie",
    "worker": "worker sklepu nie ma aktualnego heartbeat",
    "backup": "ostatnia lokalna kopia bazy lub mediów nie jest poprawna",
    "disk": "dysk VM przekroczył 90% zajęcia",
    "mailUncertain": "kolejka poczty zawiera wysyłki o niepewnym wyniku",
    "mailExhausted": "kolejka poczty wyczerpała próby wysyłki",
    "mailOverdue": "kolejka poczty jest zaległa ponad 30 minut",
    "paymentsStale": "weryfikacja sesji płatności jest zaległa",
    "paymentReview": "zamówienia wymagają przeglądu płatności",
    "analyticsOverdue": "kolejka analityki jest zaległa ponad 30 minut",
    "monitor_unavailable": "sonda sklepu nie może zebrać stanu",
}
SOURCE = {"tag": "Innochem", "name": "sonda sklepu Innochem na VM Netcup",
          "cadence": "Sprawdza co 5 minut; kopię restic weryfikuje po nocnym zadaniu Programo."}
IDEMPOTENCY_TTL_SECONDS = 24 * 3600 - 60


def fresh(record, field, hours, now):
    try:
        stamp = dt.datetime.fromisoformat(record[field].replace("Z", "+00:00"))
        return stamp.tzinfo is not None and 0 <= now - stamp.timestamp() <= hours * 3600
    except (KeyError, TypeError, ValueError):
        return False


def issues_from_status(status, offsite, now, shared=None):
    issues = []
    if not fresh(status, "at", 10 / 60, now):
        issues.append("Innochem: lokalna sonda nie ma wyniku z ostatnich 10 minut")
    else:
        failures = status.get("failures")
        if not isinstance(failures, list):
            issues.append("Innochem: lokalna sonda ma niepoprawny format wyniku")
        else:
            issues.extend("Innochem: " + FAILURES.get(failure, "sonda zgłasza nieznany typ problemu") for failure in failures)
    if offsite.get("state") != "OK" or not fresh(offsite, "completedAt", 30, now) or not fresh(offsite, "snapshotAt", 30, now):
        issues.append("Innochem: brak zweryfikowanej kopii restic poza VM z ostatnich 30 godzin")
    if shared is not None and shared.get("state") not in ("OK", "RUNNING"):
        issues.append("Innochem: ostatnie wspólne zadanie kopii restic zakończyło się błędem lub nie ma wyniku")
    return sorted(set(issues))


def read(path):
    try:
        value = json.loads(Path(path).read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def atomic(path, value):
    staged = path.with_name(path.name + ".writing-" + str(os.getpid()))
    created = False
    try:
        with staged.open("x") as stream:
            created = True
            os.chmod(staged, 0o600)
            json.dump(value, stream, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(staged, path)
    finally:
        if created:
            staged.unlink(missing_ok=True)


def event_signature(plan):
    events = {
        phase: sorted((row["info"]["key"], row["firstSeen"], row.get("alertedAt")) for row in plan[phase])
        for phase in ("new", "remind", "resolved")
    }
    return hashlib.sha256(json.dumps(events, sort_keys=True).encode()).hexdigest()


def send_email_idempotent(alerts, key, event, persist, opener=None):
    opener = opener or urllib.request.urlopen
    sender = event.setdefault("emailSender", alerts.SENDER)
    for attempt in range(2):
        # Pin the sender before POST, including a domain-rejection fallback.
        event["emailSender"] = sender
        persist()
        payload = {"from": sender, "to": [RECIPIENT], "subject": event["subject"], "text": event["body"]}
        request_key = event["key"] + "-" + hashlib.sha256(sender.encode()).hexdigest()[:16]
        request = urllib.request.Request("https://api.resend.com/emails", data=json.dumps(payload).encode(), headers={
            "Authorization": "Bearer " + key, "Content-Type": "application/json",
            "Idempotency-Key": request_key, "User-Agent": "Programo-Innochem-monitor/2"})
        try:
            with opener(request, timeout=12) as response:
                receipt = json.loads(response.read(65536))
            return {"accepted": bool(receipt.get("id")), "id": receipt.get("id"), "from": sender}
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read(65536))
            except Exception:
                detail = {}
            if attempt == 0 and event["attempts"] == 1 and sender != alerts.FALLBACK_SENDER and error.code in (403, 422) and "domain" in str(detail.get("message", "")).lower():
                sender = alerts.FALLBACK_SENDER
                continue
            return {"accepted": False, "error": "HTTPError", "status": error.code,
                    "definiteRejected": 400 <= error.code < 500 and error.code not in (408, 409)}
        except Exception as error:
            return {"accepted": False, "error": type(error).__name__, "uncertain": True}
    return {"accepted": False, "error": "SENDER_NOT_CONFIGURED", "definiteRejected": True}


def reconcile_push(topic, event, opener=None):
    opener = opener or urllib.request.urlopen
    query = urllib.parse.urlencode({"poll": "1", "since": str(int(event["createdAt"] - 5)), "title": event["subject"]})
    request = urllib.request.Request("https://ntfy.sh/" + topic + "/json?" + query,
                                     headers={"User-Agent": "Programo-Innochem-monitor/2"})
    marker = "Zdarzenie Innochem: " + event["key"] + "\n"
    try:
        with opener(request, timeout=12) as response:
            body = response.read(256 * 1024).decode()
        for line in body.splitlines():
            row = json.loads(line)
            if row.get("event") == "message" and row.get("title") == event["subject"] and row.get("message", "").startswith(marker):
                return {"accepted": True, "id": row["id"], "reconciled": True}
        return {"accepted": False, "uncertain": True, "error": "STORED_RECEIPT_NOT_FOUND"}
    except Exception as error:
        return {"accepted": False, "uncertain": True, "error": type(error).__name__}


def send_push_safe(topic, event, opener=None):
    opener = opener or urllib.request.urlopen
    # A crash or lost reply after the first POST is reconciled, never re-posted.
    if event["attempts"] > 1 and not event.get("lastReceipt", {}).get("definiteRejected"):
        return reconcile_push(topic, event, opener)
    body = ("Zdarzenie Innochem: " + event["key"] + "\n\n" + event["body"])[:3500]
    request = urllib.request.Request("https://ntfy.sh/" + topic, data=body.encode(), headers={
        "Title": event["subject"].encode("utf-8").decode("latin1"), "Priority": "4",
        "Content-Type": "text/plain; charset=utf-8", "User-Agent": "Programo-Innochem-monitor/2"})
    try:
        with opener(request, timeout=10) as response:
            receipt = json.loads(response.read(65536))
        return {"accepted": bool(receipt.get("id")) and receipt.get("event") == "message", "id": receipt.get("id")}
    except urllib.error.HTTPError as error:
        return {"accepted": False, "error": "HTTPError", "status": error.code,
                "definiteRejected": error.code in (400, 401, 403, 404, 413, 415, 429)}
    except Exception as error:
        return {"accepted": False, "uncertain": True, "error": type(error).__name__}


def transport(module_dir):
    sys.path.insert(0, str(module_dir))
    import infra_monitor
    import programo_alerts
    items = infra_monitor.info()
    topic, key, recipient, _ = infra_monitor.channels(items)
    if recipient != RECIPIENT or not topic or not key:
        raise RuntimeError("AUTHORIZED_CHANNELS_NOT_CONFIGURED")
    # Keep a scoped description without modifying the shared module or catalog.
    describe = programo_alerts.describe
    def scoped_description(issue, metrics=None):
        if issue.startswith("Innochem: "):
            return {"key": issue, "severity": programo_alerts.HIGH, "title": issue,
                    "what": issue + ".", "impact": "Sklep lub jego odtwarzalność wymaga sprawdzenia.",
                    "action": "Sprawdź /root/innochem-monitor/status.json oraz offsite-status.json na VM; zachowaj dane i dotychczasowe kopie.", "raw": issue}
        return describe(issue, metrics)
    programo_alerts.describe = scoped_description
    def deliver(channel, event, persist):
        if channel == "push":
            return send_push_safe(topic, event)
        if channel == "email":
            return send_email_idempotent(programo_alerts, key, event, persist)
        raise ValueError("UNKNOWN_CHANNEL")
    return programo_alerts, deliver


def advance(state, issues, alerts, deliver, now, persist=None):
    state.update(checkedAt=dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(), issues=issues)
    receipts, subjects = {}, {}
    # Each transport owns its acknowledgement. An accepted email receives its
    # recovery even if push failed, while only the missing channel is retried.
    for channel in ("push", "email"):
        channel_state = state.setdefault("channels", {}).setdefault(channel, {})
        alert_state = channel_state.setdefault("alerts", {})
        pending = channel_state.get("pending")
        uncertain = pending and (pending.get("inFlight") or not pending.get("lastReceipt", {}).get("definiteRejected"))
        if not uncertain:
            plan = alerts.step(alert_state, issues, None, now)
            if not plan["due"]:
                if pending and not issues and pending.get("lastReceipt", {}).get("definiteRejected"):
                    channel_state.pop("pending", None)
                continue
            signature = event_signature(plan)
            if not pending or pending["signature"] != signature:
                subject, body = alerts.render(plan, SOURCE, now)
                pending = {"signature": signature, "key": "innochem-" + channel + "-" + signature,
                           "subject": subject, "body": body, "plan": plan,
                           "createdAt": now, "attempts": 0, "inFlight": False}
                channel_state["pending"] = pending
        elif now - alert_state.get("attemptAt", 0) <= alerts.RETRY_AFTER:
            continue
        if channel == "email" and now - pending["createdAt"] >= IDEMPOTENCY_TTL_SECONDS:
            receipt = {"accepted": False, "uncertain": True, "error": "IDEMPOTENCY_WINDOW_EXPIRED"}
        else:
            alert_state["attemptAt"] = now
            pending["attempts"] += 1
            pending["inFlight"] = True
            if persist:
                persist(state)
            receipt = deliver(channel, pending, lambda: persist(state) if persist else None)
            pending["inFlight"] = False
        pending["lastReceipt"] = receipt
        channel_state["lastReceipt"] = dict(receipt, at=state["checkedAt"], subject=pending["subject"])
        receipts[channel], subjects[channel] = receipt, pending["subject"]
        if receipt.get("accepted"):
            # JSON reloads copied pending nodes; reconnect original state nodes.
            accepted_plan = dict(pending["plan"])
            for phase in ("new", "remind"):
                accepted_plan[phase] = [alert_state["problems"][row["info"]["key"]] for row in pending["plan"][phase]
                                        if alert_state["problems"].get(row["info"]["key"], {}).get("firstSeen") == row["firstSeen"]]
            alerts.delivered(alert_state, accepted_plan, now)
            channel_state.pop("pending", None)
        if persist:
            persist(state)
    return {"due": bool(receipts), "issues": issues, "receipts": receipts, "subjects": subjects}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/root/innochem-monitor")
    parser.add_argument("--module-dir", default="/opt/programo-infra")
    parser.add_argument("--vm-state", default="/var/lib/programo-infra/offsite-restic.json")
    parser.add_argument("--test", choices=("failure", "recovery"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    root = Path(args.root)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    now = time.time()
    issues = issues_from_status(read(root / "status.json"), read(root / "offsite-status.json"), now, read(args.vm_state))
    if args.check:
        print(json.dumps({"issues": issues, "recipient": RECIPIENT, "productionStateChanged": False}))
        return int(bool(issues))
    state_path = root / ("alerts-test.json" if args.test else "alerts-state.json")
    with state_path.with_suffix(".lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('{"skipped":"already-running"}')
            return 75
        state = read(state_path)
        try:
            alerts, deliver = transport(Path(args.module_dir))
            if args.test:
                # Synthetic state is isolated; no service or production health is changed.
                issues = ["TEST: sonda Innochem sprawdza kanały alarmu bez zatrzymywania sklepu"] if args.test == "failure" else []
                # Simulate consecutive intervals only for this explicitly requested transport test.
                count = alerts.DEBOUNCE_CHECKS if args.test == "failure" else alerts.RESOLVE_AFTER_MISSES
                for channel in ("push", "email"):
                    alert_state = state.setdefault("channels", {}).setdefault(channel, {}).setdefault("alerts", {})
                    for offset in range(count - 1):
                        alerts.step(alert_state, issues, None, now - 1000 + offset)
                    alert_state.pop("attemptAt", None)
            result = advance(state, issues, alerts, deliver, now, lambda value: atomic(state_path, value))
            result["pendingChannels"] = sorted(channel for channel, value in state.get("channels", {}).items() if value.get("pending"))
            atomic(state_path, state)
            print(json.dumps(dict(result, test=args.test, productionStateChanged=False), ensure_ascii=False))
            return 0 if not result["pendingChannels"] and all(receipt.get("accepted") for receipt in result["receipts"].values()) else 1
        except Exception as error:
            print(json.dumps({"notificationFailed": type(error).__name__, "productionStateChanged": False}))
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
