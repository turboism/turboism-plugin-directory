import { plugins } from "@/lib/directory";

export const dynamic = "force-static";

// Public, cacheable machine-readable feed for the Turboism desktop client.
// Static data, so Next.js serves this as a static response on Vercel.
export function GET() {
  return Response.json(plugins, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
