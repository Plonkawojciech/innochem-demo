import { NextRequest } from "next/server";
import { accessibleWithdrawal } from "@/lib/server/withdrawals";
import { customerForSession } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const receipt = await accessibleWithdrawal(
      id,
      await customerForSession(request.headers),
      request.cookies.get(`innochem_withdrawal_${id}`)?.value,
    );
    if (!receipt)
      return new Response("Nie znaleziono potwierdzenia.", { status: 404 });
    return new Response(receipt.receipt, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="innochem-odstapienie-${receipt.reference}.txt"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
