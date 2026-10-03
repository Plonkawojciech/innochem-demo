import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { pathToFileURL } from "node:url";

export type Check = {
  name: string;
  status: "OK" | "BRAK" | "BŁĄD";
  message: string;
};
export async function preflight(env: NodeJS.ProcessEnv): Promise<Check[]> {
  const checks: Check[] = [];
  function check(
    name: string,
    valid: (value: string) => boolean = () => true,
    message = "Wymagana niepusta wartość.",
    required = true,
  ) {
    const value = env[name];
    const present = !!value?.trim();
    checks.push({
      name,
      status: !present
        ? required
          ? "BRAK"
          : "OK"
        : valid(value!)
          ? "OK"
          : "BŁĄD",
      message:
        !present && !required
          ? "Opcjonalna przy bieżącej konfiguracji."
          : present && valid(value!)
            ? "Poprawna konfiguracja."
            : message,
    });
  }
  check(
    "APP_URL",
    (value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !!url.hostname &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          !value.endsWith("/") &&
          value === value.trim()
        );
      } catch {
        return false;
      }
    },
    "Wymagany adres HTTPS bez końcowego ukośnika, danych logowania, query i fragmentu.",
  );
  for (const name of ["BETTER_AUTH_SECRET", "WORKER_SECRET"])
    check(
      name,
      (value) =>
        value.length >= 32 && env.BETTER_AUTH_SECRET !== env.WORKER_SECRET,
      "Sekrety muszą mieć co najmniej 32 znaki i różnić się od siebie.",
    );
  for (const name of ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"])
    check(name);
  check("MEDIA_ROOT");
  if (env.MEDIA_ROOT?.trim()) {
    try {
      if (!(await stat(env.MEDIA_ROOT)).isDirectory()) throw new Error();
      await access(env.MEDIA_ROOT, constants.W_OK);
    } catch {
      checks[checks.length - 1] = {
        name: "MEDIA_ROOT",
        status: "BŁĄD",
        message:
          "Katalog musi istnieć i być zapisywalny dla użytkownika procesu.",
      };
    }
  }
  for (const name of [
    "STOREFRONT_PREVIEW",
    "MAIL_DELIVERY_ENABLED",
    "PAYMENTS_ENABLED",
    "TRUST_PROXY",
  ])
    check(
      name,
      (value) => ["true", "false"].includes(value),
      "Wymagane true albo false.",
    );
  const mail = env.MAIL_DELIVERY_ENABLED === "true";
  for (const name of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"])
    check(name, undefined, undefined, mail);
  check(
    "SMTP_PORT",
    (value) =>
      /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535,
    "Wymagany całkowity numer portu od 1 do 65535.",
    mail,
  );
  check(
    "MAIL_FROM",
    (value) => /^[^<>\r\n]+\s<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$/.test(value),
    "Wymagany format Nazwa <adres e-mail>.",
    mail,
  );
  const payments = env.PAYMENTS_ENABLED === "true";
  for (const name of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"])
    check(name, undefined, undefined, payments);
  check(
    "STRIPE_MODE",
    (value) => ["test", "live"].includes(value),
    "Wymagane test albo live.",
    payments,
  );
  check("NEXT_PUBLIC_GA4_MEASUREMENT_ID", undefined, undefined, false);
  check(
    "GA4_API_SECRET",
    undefined,
    "Wymagany sekret przy ustawionym publicznym ID GA4.",
    !!env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.trim(),
  );
  return checks;
}
export function formatChecks(checks: Check[]) {
  return checks
    .map(({ name, status, message }) => `${status} ${name}: ${message}`)
    .join("\n");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  preflight(process.env)
    .then((checks) => {
      console.log(formatChecks(checks));
      if (checks.some((check) => check.status !== "OK")) process.exitCode = 1;
    })
    .catch(() => {
      console.error("BŁĄD PREFLIGHT: Nie udało się sprawdzić konfiguracji.");
      process.exitCode = 1;
    });
}
