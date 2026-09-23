import { betterAuth, type BetterAuthOptions } from "better-auth";
import { database, query } from "./db";
import { enqueueMail } from "./mail";

export function authOptions(): BetterAuthOptions {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Authentication secret is not configured");
  const baseURL = process.env.APP_URL;
  if (!baseURL) throw new Error("APP_URL is not configured");
  return {
    appName: "INNOCHEM",
    baseURL,
    secret,
    database: database(),
    trustedOrigins: [baseURL],
    user: {
      modelName: "auth_user",
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "customer",
          input: false,
        },
      },
    },
    session: {
      modelName: "auth_session",
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 12,
    },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        await query('UPDATE auth_user SET "emailVerified"=true WHERE id=$1', [
          user.id,
        ]);
      },
      sendResetPassword: async ({ user, url }) => {
        await enqueueMail(
          user.email,
          "INNOCHEM — zmiana hasła",
          `Aby ustawić nowe hasło, otwórz poniższy link:\n${url}\n\nJeżeli nie proszono o zmianę hasła, pomiń tę wiadomość.`,
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) => {
        await enqueueMail(
          user.email,
          "INNOCHEM — potwierdź adres e-mail",
          `Potwierdź adres e-mail, aby korzystać z konta:\n${url}\n\nJeżeli nie zakładano konta, pomiń tę wiadomość.`,
        );
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limit",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/request-password-reset": { window: 60, max: 3 },
      },
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders:
          process.env.TRUST_PROXY === "true" ? ["x-real-ip"] : [],
      },
      cookiePrefix: process.env.AUTH_COOKIE_PREFIX || "innochem",
      useSecureCookies: new URL(baseURL).protocol === "https:",
      database: { generateId: "uuid" },
    },
  };
}
let instance: ReturnType<typeof betterAuth> | undefined;
export function auth() {
  return (instance ??= betterAuth(authOptions()));
}
export async function session(headers: Headers) {
  return auth().api.getSession({ headers });
}
export async function requireAdmin(headers: Headers) {
  const current = await session(headers);
  if (!current) throw new Error("UNAUTHORIZED");
  const { rows } = await query("SELECT role FROM auth_user WHERE id=$1", [
    current.user.id,
  ]);
  if (rows[0]?.role !== "admin" || !current.user.emailVerified)
    throw new Error("FORBIDDEN");
  return current.user;
}
export async function customerForSession(headers: Headers) {
  const current = await session(headers);
  if (!current || !current.user.emailVerified) return null;
  // Imported accounts are linked by the importer. Signing up with the same
  // email must not grant historical access until the email is verified.
  const { rows } = await query(
    "SELECT id FROM customers WHERE auth_user_id=$1",
    [current.user.id],
  );
  if (rows[0]) return rows[0].id as string;
  const [firstName, ...rest] = current.user.name.split(" ");
  const created = await query(
    "INSERT INTO customers(auth_user_id,email,first_name,last_name) VALUES($1,$2,$3,$4) ON CONFLICT(auth_user_id) DO UPDATE SET email=excluded.email RETURNING id",
    [current.user.id, current.user.email, firstName, rest.join(" ")],
  );
  return created.rows[0].id as string;
}
