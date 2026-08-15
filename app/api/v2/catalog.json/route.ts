import type { NextRequest } from "next/server";
import { serveCatalog } from "@/lib/catalog-v2/http.mjs";

// Read-only complete catalog endpoint (contract 3). Fails closed with
// 503 catalog_unavailable until a verified production catalog/signature pair
// is provisioned under public/api/v2/. Never signs, mutates, or uploads.
export const dynamic = "force-dynamic";

export function GET(request: NextRequest): Response {
  return serveCatalog(request, {}, false);
}

export function HEAD(request: NextRequest): Response {
  return serveCatalog(request, {}, true);
}
