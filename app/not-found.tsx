import Link from "next/link";

export default function NotFound() {
  return <main className="not-found"><p className="eyebrow">404</p><h1>That plugin is not listed.</h1><p>The listing may not exist, or may have been withdrawn from the directory.</p><Link href="/">Return to the directory</Link></main>;
}
