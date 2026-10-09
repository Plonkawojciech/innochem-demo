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


def deliver_channels(alerts, topic, key, subject, body, previous=None):
    previous = previous or {}
    return {
        "push": previous["push"] if previous.get("push", {}).get("accepted") else alerts.send_push(topic, subject, body, "4"),
        "email": previous["email"] if previous.get("email", {}).get("accepted") else alerts.send_email(key, RECIPIENT, subject, body, "Programo-Innochem-monitor/1"),
    }


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
    def deliver(subject, body, previous=None):
        return deliver_channels(programo_alerts, topic, key, subject, body, previous)
    return programo_alerts, deliver


def advance(state, issues, alerts, deliver, now):
    plan = alerts.step(state.setdefault("alerts", {}), issues, None, now)
    state.update(checkedAt=dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(), issues=issues)
    if not plan["due"]:
        return {"due": False, "issues": issues}
    state["alerts"]["attemptAt"] = now
    subject, body = alerts.render(plan, SOURCE, now)
    signature = hashlib.sha256(json.dumps({
        kind: sorted(row["info"]["key"] for row in plan.get(kind, []))
        for kind in ("new", "remind", "resolved")
    }, sort_keys=True).encode()).hexdigest()
    pending = state.get("pendingDelivery", {})
    previous = pending.get("receipts", {}) if pending.get("signature") == signature else {}
    receipts = deliver(subject, body, previous)
    state["pendingDelivery"] = {"signature": signature, "receipts": receipts}
    state["lastReceipts"] = dict(receipts, at=state["checkedAt"], subject=subject)
    # Never mark delivery complete until both authorized channels accept it.
    if all(receipts.get(channel, {}).get("accepted") for channel in ("email", "push")):
        alerts.delivered(state["alerts"], plan, now)
        state.pop("pendingDelivery", None)
    return {"due": True, "issues": issues, "receipts": receipts, "subject": subject}


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
                for offset in range(count - 1):
                    alerts.step(state.setdefault("alerts", {}), issues, None, now - 1000 + offset)
                state.setdefault("alerts", {}).pop("attemptAt", None)
            result = advance(state, issues, alerts, deliver, now)
            atomic(state_path, state)
            print(json.dumps(dict(result, test=args.test, productionStateChanged=False), ensure_ascii=False))
            return 0 if not result["due"] or all(result["receipts"].get(channel, {}).get("accepted") for channel in ("email", "push")) else 1
        except Exception as error:
            print(json.dumps({"notificationFailed": type(error).__name__, "productionStateChanged": False}))
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
