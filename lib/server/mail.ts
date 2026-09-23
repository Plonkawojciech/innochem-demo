import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { query, transaction } from "./db";

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
      process.env.STOREFRONT_PREVIEW !== "false",
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
/** SMTP delivery is opt-in and impossible in storefront preview. Ambiguous attempts are quarantined. */
export async function deliverMailBatch(transportForTest?: MailTransport) {
  if (transportForTest && !process.env.PGDATABASE?.startsWith("innochem_test_"))
    throw new Error("Test transport requires an isolated test database");
  if (
    process.env.MAIL_DELIVERY_ENABLED !== "true" ||
    process.env.STOREFRONT_PREVIEW !== "false"
  )
    return { enabled: false, sent: 0, failed: 0, uncertain: 0 };
  if (
    !transportForTest &&
    (!process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASSWORD ||
      !process.env.MAIL_FROM)
  )
    throw new Error("SMTP not configured");
  const transport: MailTransport =
    transportForTest ||
    nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: process.env.SMTP_PORT !== "587",
      requireTLS: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
  const batch = await transaction(async (db) => {
    // A terminated worker may have sent a message. Never retry it merely because its lease expired.
    await db.query(
      "UPDATE mail_outbox SET delivery_state='uncertain',locked_until=NULL,last_error='Delivery interrupted; verify the provider before retrying' WHERE delivery_state='sending' AND sent_at IS NULL AND locked_until<now()",
    );
    const { rows } = await db.query(
      "SELECT * FROM mail_outbox WHERE sent_at IS NULL AND NOT preview AND delivery_state IN ('queued','failed') AND attempts<8 AND available_at<=now() AND (locked_until IS NULL OR locked_until<now()) ORDER BY created_at,id LIMIT 10 FOR UPDATE SKIP LOCKED",
    );
    for (const row of rows)
      await db.query(
        "UPDATE mail_outbox SET delivery_state='sending',locked_until=now()+interval '5 minutes',attempts=attempts+1 WHERE id=$1",
        [row.id],
      );
    return rows;
  });
  let sent = 0,
    failed = 0,
    uncertain = 0;
  try {
    for (const row of batch) {
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
      }
      // If persistence fails after SMTP success, leave the lease to become uncertain, never mark it retryable.
      await query(
        "UPDATE mail_outbox SET delivery_state='sent',sent_at=now(),locked_until=NULL,last_error=NULL WHERE id=$1",
        [row.id],
      );
      sent++;
    }
  } finally {
    transport.close();
  }
  return { enabled: true, sent, failed, uncertain };
}
