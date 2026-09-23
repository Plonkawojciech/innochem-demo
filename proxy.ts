import { NextRequest, NextResponse } from "next/server";
import { resolveRedirect } from "./lib/server/redirects";

export async function proxy(request: NextRequest) {
  if (!["GET", "HEAD"].includes(request.method)) return NextResponse.next();
  if (
    process.env.STOREFRONT_PREVIEW === "false" &&
    ["/social.html", "/ig-post.html", "/phone.html", "/karuzela.html"].includes(
      new URL(request.url).pathname,
    )
  )
    return new NextResponse("Not found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex" },
    });
  const result = await resolveRedirect(new URL(request.url));
  if (result?.destination)
    return NextResponse.redirect(
      new URL(result.destination, request.url),
      result.status as 301 | 308,
    );
  if (result) {
    const gone = result.status === 410;
    return new NextResponse(
      request.method === "HEAD"
        ? null
        : `<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${gone ? "Strona archiwalna" : "Nie znaleziono strony"} — INNOCHEM</title><body style="font-family:system-ui;max-width:42rem;margin:10vh auto;padding:24px"><h1>${gone ? "Ta strona została wycofana" : "Nie znaleziono strony"}</h1><p>Aktualną ofertę znajdziesz w katalogu INNOCHEM.</p><a href="/katalog">Przejdź do produktów</a> · <a href="/kontakt">Kontakt</a></body></html>`,
      {
        status: result.status,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "X-Robots-Tag": "noindex",
          "Cache-Control": "no-store",
        },
      },
    );
  }
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
    return NextResponse.redirect(url, 308);
  }
  const response = NextResponse.next();
  if (process.env.STOREFRONT_PREVIEW !== "false")
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
export const config = {
  matcher: [
    "/((?!api(?:/|$)|_next(?:/|$)|media(?:/|$)|admin(?:/|$)|konto(?:/|$)|zamowienie(?:/|$)|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
