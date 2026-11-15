import type { NextRequest } from "next/server";
import { handleAuthGitHubLogin } from "@/lib/submissions/http.mjs";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest): Promise<Response> {
  return handleAuthGitHubLogin(request);
}
