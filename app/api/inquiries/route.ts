import { enqueueMailInTransaction } from "@/lib/server/mail";
import { z } from "zod";
import { transaction } from "@/lib/server/db";
import {
  errorResponse,
  jsonBody,
  rateLimit,
  requireSameOrigin,
} from "@/lib/server/http";
import { storeSettings } from "@/lib/server/settings";
const schema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.email().max(254),
    phone: z.string().trim().max(30).default(""),
    subject: z.string().trim().min(2).max(200),
    message: z.string().trim().min(10).max(6000),
    website: z.string().max(200).default(""),
    privacy: z.literal(true),
  })
  .strict();
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await rateLimit(request, "inquiry", 5);
    const data = schema.parse(await jsonBody(request));
    if (data.website) return Response.json({ ok: true });
    const settings = await storeSettings();
    await transaction(async (db) => {
      const {
        rows: [inquiry],
      } = await db.query(
        "INSERT INTO inquiries(subject,name,email,phone,message) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [data.subject, data.name, data.email, data.phone, data.message],
      );
      await enqueueMailInTransaction(
        db,
        settings.contactEmail,
        `INNOCHEM — ${data.subject}`,
        `${data.name}\n${data.email}\n${data.phone}\n\n${data.message}`,
        `inquiry:${inquiry.id}`,
      );
    });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
