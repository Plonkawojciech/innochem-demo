import { NextRequest } from "next/server";
import { accessibleOrder } from "@/lib/server/orders";
import { customerForSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { legalText } from "@/lib/server/legal";
import { errorResponse } from "@/lib/server/http";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = await accessibleOrder(
      id,
      await customerForSession(request.headers),
      request.cookies.get(`innochem_order_${id}`)?.value,
    );
    if (!data?.order.legal_version)
      return new Response("Nie znaleziono dokumentu.", { status: 404 });
    const {
      rows: [legal],
    } = await query(
      "SELECT version,documents,commerce FROM legal_versions WHERE version=$1",
      [data.order.legal_version],
    );
    if (!legal)
      return new Response("Nie znaleziono dokumentu.", { status: 404 });
    return new Response(
      `INNOCHEM — warunki zakupu\nZamówienie ${data.order.number}\nWersja ${legal.version}\n\n${legalText(legal.documents)}\n\nDostawa wybrana przy zakupie: ${data.order.shipping_label}; ${(data.order.shipping_cents / 100).toFixed(2)} ${data.order.currency}\n`,
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="innochem-warunki-${data.order.number}.txt"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
