import { DirectoryBrowser } from "@/components/directory-browser";
import { getDirectoryPlugins } from "@/lib/directory";

export default function HomePage() {
  return <DirectoryBrowser plugins={getDirectoryPlugins()} />;
}
