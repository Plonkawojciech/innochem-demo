import { z } from "zod";
import { cartProducts } from "@/lib/server/catalog";
import { requireSameOrigin, jsonBody, errorResponse } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const data = z
      .object({ ids: z.array(z.uuid()).max(50) })
      .strict()
      .parse(await jsonBody(request, 4000));
    return Response.json(
      { products: await cartProducts(data.ids) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
