#!/usr/bin/env python3
"""Connect Stripe and Apaczka to the INNOCHEM store on Coolify.

Reads credentials only from the macOS Keychain and never prints them.
  programo.innochem.stripe-test          sk_test_/rk_test_ key of acct_1UNTjpEpjVk0RfTD
  programo.innochem.stripe-live          sk_live_/rk_live_ key (only with --live)
  programo.innochem.apaczka-app-id       Apaczka Web API App ID
  programo.innochem.apaczka-secret       Apaczka Web API App Secret
  programo.innochem.stripe-<mode>-webhook  written by this script

Usage: python3 scripts/connect-providers.py [--live] [--check] [--no-deploy]
  --live       launch day: live key, webhook on https://innochem.pl, test checkout off.
               Leaves PAYMENTS_ENABLED and STOREFRONT_PREVIEW to the cutover runbook.
  --check      verify credentials and print status, change nothing
  --no-deploy  update Coolify env but skip the redeploy
"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ACCOUNT = "acct_1UNTjpEpjVk0RfTD"
APP_UUID = "oxdsv73fkwbxg7t0umly3ucd"
LIVE = "--live" in sys.argv
MODE = "live" if LIVE else "test"
WEBHOOK_URL = (
    "https://innochem.pl/api/payments/stripe/webhook"
    if LIVE
    else "https://sklep-innochem.programo.pl/api/payments/stripe/webhook"
)
WEBHOOK_EVENTS = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
]
MANAGED = "innochem-connect-providers"


def keychain(service):
    r = subprocess.run(
        ["security", "find-generic-password", "-s", service, "-w"],
        capture_output=True,
        text=True,
    )
    return r.stdout.strip() or None if r.returncode == 0 else None


def keychain_store(service, value):
    # Pass the value on stdin of `security -i` so it never appears in argv.
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    cmd = f'add-generic-password -U -s "{service}" -a innochem -w "{escaped}"\n'
    r = subprocess.run(["security", "-i"], input=cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"Keychain write failed for {service}")


def http(method, url, headers=None, data=None, form=None):
    body = None
    headers = dict(headers or {})
    if form is not None:
        body = urllib.parse.urlencode(form, doseq=True).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read() or b"null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"null")
        except ValueError:
            return e.code, None


def stripe(method, path, key, form=None):
    return http(
        method,
        f"https://api.stripe.com/v1/{path}",
        {"Authorization": f"Bearer {key}"},
        form=form,
    )


def connect_stripe(check_only):
    key = keychain(f"programo.innochem.stripe-{MODE}")
    if not key:
        print(f"stripe: brak klucza w Keychain (programo.innochem.stripe-{MODE})")
        return None
    if not key.startswith((f"sk_{MODE}_", f"rk_{MODE}_")):
        sys.exit(f"stripe: klucz nie jest kluczem trybu {MODE} (sk_{MODE}_/rk_{MODE}_)")
    code, acct = stripe("GET", "account", key)
    if code == 200 and acct.get("id") != ACCOUNT:
        sys.exit(f"stripe: klucz nie należy do {ACCOUNT}")
    # A restricted key may lack account read access; the webhook call below still proves the key.
    if code not in (200, 403):
        sys.exit(f"stripe: klucz odrzucony (HTTP {code})")
    print(f"stripe: tryb {MODE}, konto {ACCOUNT if code == 200 else 'niesprawdzone (klucz ograniczony)'}")

    code, cfgs = stripe("GET", "payment_method_configurations?limit=10", key)
    if code == 200:
        for cfg in cfgs.get("data", []):
            if not cfg.get("is_default"):
                continue
            for pm in ("card", "blik", "p24"):
                info = cfg.get(pm) or {}
                pref = (info.get("display_preference") or {}).get("value")
                print(f"stripe: {pm}: available={info.get('available')} preference={pref}")

    if check_only:
        return None
    code, hooks = stripe("GET", "webhook_endpoints?limit=100", key)
    if code != 200:
        sys.exit(f"stripe: nie można odczytać webhooków (HTTP {code})")
    managed = [
        h
        for h in hooks.get("data", [])
        if h.get("url") == WEBHOOK_URL
        and (h.get("metadata") or {}).get("managed_by") == MANAGED
    ]
    secret = keychain(f"programo.innochem.stripe-{MODE}-webhook")
    if len(managed) == 1 and secret:
        print(f"stripe: webhook {managed[0]['id']} już istnieje, sekret w Keychain")
    else:
        for h in managed:
            stripe("DELETE", f"webhook_endpoints/{h['id']}", key)
        code, hook = stripe(
            "POST",
            "webhook_endpoints",
            key,
            form={
                "url": WEBHOOK_URL,
                "enabled_events[]": WEBHOOK_EVENTS,
                "description": "INNOCHEM sklep" if LIVE else "INNOCHEM sklep (podgląd)",
                "metadata[managed_by]": MANAGED,
            },
        )
        if code != 200 or not hook.get("secret", "").startswith("whsec_"):
            sys.exit(f"stripe: nie udało się utworzyć webhooka (HTTP {code})")
        secret = hook["secret"]
        keychain_store(f"programo.innochem.stripe-{MODE}-webhook", secret)
        print(f"stripe: utworzono webhook {hook['id']}, sekret zapisany w Keychain")
    return {
        "STRIPE_MODE": MODE,
        "STRIPE_SECRET_KEY": key,
        "STRIPE_WEBHOOK_SECRET": secret,
        "STRIPE_TEST_CHECKOUT_ENABLED": "false" if LIVE else "true",
    }


def apaczka_call(app_id, secret, route, data):
    payload = json.dumps(data)
    expires = int(time.time()) + 300
    sig = hmac.new(
        secret.encode(), f"{app_id}:{route}:{payload}:{expires}".encode(), hashlib.sha256
    ).hexdigest()
    return http(
        "POST",
        f"https://www.apaczka.pl/api/v2/{route}",
        form={"app_id": app_id, "request": payload, "expires": expires, "signature": sig},
    )


def connect_apaczka():
    app_id = keychain("programo.innochem.apaczka-app-id")
    secret = keychain("programo.innochem.apaczka-secret")
    if not (app_id and secret):
        print("apaczka: brak App ID lub App Secret w Keychain")
        return None
    code, res = apaczka_call(app_id, secret, "service_structure/", {})
    if code != 200 or not res or res.get("status") != 200:
        sys.exit(f"apaczka: klucze odrzucone (HTTP {code}, status {res and res.get('status')})")
    services = (res.get("response") or {}).get("services") or []
    names = sorted({s.get("name", "?") for s in services})
    print(f"apaczka: klucze OK, {len(services)} usług, m.in.: {', '.join(names[:8])}")
    # Live mode: valuation and service lists work; real orders stay blocked until
    # STOREFRONT_PREVIEW=false and APACZKA_LIVE_SHIPPING_ENABLED=true at launch.
    return {"APACZKA_MODE": "live", "APACZKA_APP_ID": app_id, "APACZKA_APP_SECRET": secret}


def coolify():
    env = {}
    with open(os.path.expanduser("~/.claude/coolify.env")) as f:
        for line in f:
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.strip().split("=", 1)
                env[k.removeprefix("export ").strip()] = v.strip().strip("'\"")
    base = env.get("COOLIFY_URL") or env.get("COOLIFY_API_URL")
    token = env.get("COOLIFY_TOKEN") or env.get("COOLIFY_API_TOKEN")
    return base.rstrip("/"), {"Authorization": f"Bearer {token}"}


def update_env(values):
    base, auth = coolify()
    data = [{"key": k, "value": v, "is_preview": False} for k, v in values.items()]
    code, _ = http("PATCH", f"{base}/api/v1/applications/{APP_UUID}/envs/bulk", auth, data={"data": data})
    if code not in (200, 201):
        sys.exit(f"coolify: zapis zmiennych nieudany (HTTP {code})")
    print(f"coolify: ustawiono {', '.join(sorted(values))}")


def deploy():
    base, auth = coolify()
    code, res = http("POST", f"{base}/api/v1/deploy", auth, data={"uuid": APP_UUID})
    dep = (res or {}).get("deployments", [{}])[0].get("deployment_uuid")
    if code != 200 or not dep:
        sys.exit(f"coolify: deploy nieudany (HTTP {code})")
    print(f"coolify: deploy {dep} w kolejce")
    for _ in range(60):
        time.sleep(20)
        _, st = http("GET", f"{base}/api/v1/deployments/{dep}", auth)
        status = (st or {}).get("status")
        if status in ("finished", "failed", "cancelled-by-user"):
            print(f"coolify: deploy {status}")
            return status == "finished"
    print("coolify: deploy nie zakończył się w 20 min")
    return False


def main():
    check_only = "--check" in sys.argv
    values = {}
    # Apaczka keys are already live; launch day only swaps the Stripe mode.
    apaczka = None if check_only or LIVE else connect_apaczka()
    for part in (connect_stripe(check_only), apaczka):
        values.update(part or {})
    if check_only:
        connect_apaczka()
        return
    if not values:
        sys.exit("Nic do podpięcia: brak kluczy w Keychain.")
    update_env(values)
    if "--no-deploy" not in sys.argv and not deploy():
        sys.exit(1)


if __name__ == "__main__":
    main()
