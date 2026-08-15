import type { NextRequest } from "next/server";
import { serveSearch } from "@/lib/catalog-v2/http.mjs";

// Discovery-only search endpoint (contract 6). Reads the same verified catalog
// bytes the complete catalog endpoint serves; it is never an installation
// authority and never signs, mutates, uploads, or fetches remote data.
export const dynamic = "force-dynamic";

export function GET(request: NextRequest): Response {
  return serveSearch(request, {}, false);
}

export function HEAD(request: NextRequest): Response {
  return serveSearch(request, {}, true);
}
