import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import nodemailer from "nodemailer";
import { database, query, transaction } from "./db";
import { isQaMail } from "./qa-mail";

export async function enqueueMail(
  recipient: string,
  subject: string,
  body: string,
  eventKey = randomUUID(),
) {
  await transaction((db) =>
    enqueueMailInTransaction(db, recipient, subject, body, eventKey),
  );
}
export async function enqueueMailInTransaction(
  db: PoolClient,
  recipient: string,
  subject: string,
  body: string,
  eventKey: string,
) {
  await db.query(
    "INSERT INTO mail_outbox(event_key,recipient,subject,body_text,preview) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING",
    [
      eventKey,
      recipient,
      subject,
      body,
      process.env.STOREFRONT_PREVIEW !== "false" || isQaMail(subject, body),
    ],
  );
}

type MailTransport = {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    messageId: string;
  }): Promise<unknown>;
  close(): void;
};
type TestMailTransport = MailTransport | (() => MailTransport);
/** SMTP delivery is opt-in and impossible in storefront preview. Ambiguous attempts are quarantined. */
export async function deliverMailBatch(transportForTest?: TestMailTransport) {
  if (transportForTest && !process.env.PGDATABASE?.startsWith("innochem_test_"))
    throw new Error("Test transport requires an isolated test database");
  if (
    process.env.MAIL_DELIVERY_ENABLED !== "true" ||
    process.env.STOREFRONT_PREVIEW !== "false"
  )
    return { enabled: false, sent: 0, failed: 0, uncertain: 0 };
  // A session lock spans delivery (not only row leasing), so overlapping workers
  // cannot exceed the shop's send pace by claiming different batches.
  const guard = await database().connect();
  let locked = false;
  let guardLost = false;
  const lost = () => {
    guardLost = true;
  };
  guard.on("error", lost);
  try {
    locked = (
      await guard.query("SELECT pg_try_advisory_lock(842615916) AS locked")
    ).rows[0].locked;
    if (!locked)
      return { enabled: true, sent: 0, failed: 0, uncertain: 0, busy: true };
    return await deliverLockedBatch(transportForTest, () => !guardLost);
  } finally {
    try {
      if (guardLost) throw new Error("Mail guard disconnected");
      if (locked) await guard.query("SELECT pg_advisory_unlock(842615916)");
      guard.release();
    } catch {
      // Destroying this session also releases its advisory lock.
      guard.release(true);
    }
    guard.removeListener("error", lost);
  }
}

async function deliverLockedBatch(
  transportForTest: TestMailTransport | undefined,
  guardHealthy: () => boolean,
) {
  const delivery: { transport?: MailTransport } = {};
  let sent = 0,
    failed = 0,
    uncertain = 0,
    testOnly = 0;
  try {
    const batch = await transaction(async (db) => {
      // A terminated worker may have sent a message. Never retry it merely because its lease expired.
      await db.query(
        "UPDATE mail_outbox SET delivery_state='uncertain',locked_until=NULL,last_error='Delivery interrupted; verify the provider before retrying' WHERE delivery_state='sending' AND sent_at IS NULL AND locked_until<now()",
      );
      const { rows } = await db.query(
        "SELECT * FROM mail_outbox WHERE sent_at IS NULL AND NOT preview AND delivery_state IN ('queued','failed') AND attempts<8 AND available_at<=now() AND (locked_until IS NULL OR locked_until<now()) ORDER BY created_at,id LIMIT 10 FOR UPDATE SKIP LOCKED",
      );
      const deliverable = [];
      for (const row of rows) {
        // Reclassify historical jobs too, before a lease or provider construction.
        if (isQaMail(row.subject, row.body_text)) {
          await db.query(
            "UPDATE mail_outbox SET preview=true,last_error='QA_MAIL_DISABLED',locked_until=NULL,sent_at=NULL WHERE id=$1",
            [row.id],
          );
          testOnly++;
        } else deliverable.push(row);
      }
      if (!deliverable.length) return deliverable;
      // Missing SMTP configuration must not lease real customer correspondence.
      if (
        !transportForTest &&
        (!process.env.SMTP_HOST ||
          !process.env.SMTP_USER ||
          !process.env.SMTP_PASSWORD ||
          !process.env.MAIL_FROM)
      )
        throw new Error("SMTP not configured");
      delivery.transport = transportForTest
        ? typeof transportForTest === "function"
          ? transportForTest()
          : transportForTest
        : nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 465),
            secure: process.env.SMTP_PORT !== "587",
            requireTLS: true,
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASSWORD,
            },
            connectionTimeout: 10000,
            socketTimeout: 15000,
          });
      for (const row of deliverable)
        await db.query(
          "UPDATE mail_outbox SET delivery_state='sending',locked_until=now()+interval '5 minutes',attempts=attempts+1 WHERE id=$1",
          [row.id],
        );
      return deliverable;
    });
    if (!batch.length)
      return { enabled: true, sent, failed, uncertain, testOnly };
    const transport = delivery.transport;
    if (!transport) throw new Error("Mail transport unavailable");
    for (const row of batch) {
      if (!guardHealthy()) throw new Error("Mail guard disconnected");
      try {
        await transport.sendMail({
          from: process.env.MAIL_FROM || "synthetic@example.test",
          to: row.recipient,
          subject: row.subject,
          text: row.body_text,
          messageId: `<${row.id}@innochem.pl>`,
        });
      } catch (error) {
        const e = error as {
          code?: string;
          command?: string;
          responseCode?: number;
        };
        const definiteFailure =
          ["EAUTH", "EENVELOPE"].includes(e.code || "") ||
          [
            "CONN",
            "EHLO",
            "HELO",
            "STARTTLS",
            "AUTH",
            "MAIL FROM",
            "RCPT TO",
          ].includes(e.command || "") ||
          (typeof e.responseCode === "number" &&
            e.responseCode >= 400 &&
            e.responseCode <= 599);
        const state = definiteFailure ? "failed" : "uncertain";
        await query(
          "UPDATE mail_outbox SET delivery_state=$1,locked_until=NULL,available_at=now()+interval '15 minutes',last_error=$2 WHERE id=$3",
          [
            state,
            definiteFailure
              ? "SMTP rejected delivery; retry scheduled"
              : "SMTP result uncertain; verify the provider before retrying",
            row.id,
          ],
        );
        if (definiteFailure) failed++;
        else uncertain++;
        continue;
      } finally {
        // Test transports never contact SMTP. Real attempts are spaced across
        // batch boundaries because the guard remains held through this pause.
        if (!transportForTest) await pause(1000);
      }
      // If persistence fails after SMTP success, leave the lease to become uncertain, never mark it retryable.
      await query(
        "UPDATE mail_outbox SET delivery_state='sent',sent_at=now(),locked_until=NULL,last_error=NULL WHERE id=$1",
        [row.id],
      );
      sent++;
    }
  } finally {
    delivery.transport?.close();
  }
  return { enabled: true, sent, failed, uncertain, testOnly };
}
