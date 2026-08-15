import type { NextRequest } from "next/server";
import { serveSignature } from "@/lib/catalog-v2/http.mjs";

// Read-only detached-signature envelope endpoint (contract 3). Fails closed
// until the deployed pair verifies against the committed trusted-key
// allowlist. Never signs, mutates, or uploads.
export const dynamic = "force-dynamic";

export function GET(request: NextRequest): Response {
  return serveSignature(request, {}, false);
}

export function HEAD(request: NextRequest): Response {
  return serveSignature(request, {}, true);
}
