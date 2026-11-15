import type { NextRequest } from "next/server";
import { handleSubmissionsSubmit } from "@/lib/submissions/http.mjs";

export const dynamic = "force-dynamic";

export function POST(request: NextRequest): Promise<Response> {
  return handleSubmissionsSubmit(request);
}
