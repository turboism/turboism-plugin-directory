import type { NextRequest } from "next/server";
import { handleSubmissionsRepos } from "@/lib/submissions/http.mjs";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest): Promise<Response> {
  return handleSubmissionsRepos(request);
}
