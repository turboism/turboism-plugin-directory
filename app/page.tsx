import { Suspense } from "react";
import { DirectoryBrowser } from "@/components/directory-browser";
import { getDirectoryPlugins } from "@/lib/directory";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 pt-24 min-h-screen" />}>
      <DirectoryBrowser plugins={getDirectoryPlugins()} />
    </Suspense>
  );
}
