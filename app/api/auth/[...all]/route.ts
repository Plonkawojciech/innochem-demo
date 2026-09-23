import { auth } from "@/lib/server/auth";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return auth().handler(request);
}
export function POST(request: Request) {
  return auth().handler(request);
}
