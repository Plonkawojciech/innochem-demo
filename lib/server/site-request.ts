import { cache } from "react";
import { cookies, headers } from "next/headers";
import { requireAdmin } from "./auth";
import { cmsPreviewCookie, readSite } from "./site-content";

export const requestSite = cache(async () => {
  let draft = false;
  if ((await cookies()).get(cmsPreviewCookie())?.value === "1") {
    try {
      await requireAdmin(await headers());
      draft = true;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !["UNAUTHORIZED", "FORBIDDEN"].includes(error.message)
      )
        throw error;
    }
  }
  return { content: await readSite(draft), draft };
});
