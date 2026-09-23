import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { requireAdmin } from "./auth";
export async function adminPageUser() {
  try {
    return await requireAdmin(await headers());
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED")
      redirect("/konto?returnTo=admin");
    if (error instanceof Error && error.message === "FORBIDDEN") notFound();
    throw error;
  }
}
