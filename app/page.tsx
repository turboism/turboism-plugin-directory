import { Suspense } from "react";
import { DirectoryBrowser } from "@/components/directory-browser";
import { getDirectoryListingPlugins } from "@/lib/directory";
import { loadFrameworkChannelHeads } from "@/lib/framework-channels.mjs";

export default async function HomePage() {
  const frameworkChannels = await loadFrameworkChannelHeads();
  return (
    <Suspense fallback={<div className="container mx-auto px-4 pt-24 min-h-screen" />}>
      <DirectoryBrowser plugins={getDirectoryListingPlugins()} frameworkChannels={frameworkChannels} />
    </Suspense>
  );
}
