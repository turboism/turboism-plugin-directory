import { serveLegacyPlugins } from "@/lib/directory";

export const dynamic = "force-dynamic";

export function GET() {
  return serveLegacyPlugins();
}
