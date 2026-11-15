import type { NextRequest } from "next/server";
import { handleAuthSession } from "@/lib/submissions/http.mjs";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest): Promise<Response> {
  return handleAuthSession(request);
}
