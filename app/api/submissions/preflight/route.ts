import type { NextRequest } from "next/server";
import { handleSubmissionsPreflight } from "@/lib/submissions/http.mjs";

export const dynamic = "force-dynamic";

export function POST(request: NextRequest): Promise<Response> {
  return handleSubmissionsPreflight(request);
}
