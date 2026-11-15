import type { Metadata } from "next";
import { Suspense } from "react";
import { SubmitWizard } from "@/components/submit-wizard";

export const metadata: Metadata = {
  title: "Submit a Plugin",
  description:
    "Run preflight inspection and open a GitOps review pull request for the Turboism Curated Plugin Directory.",
  alternates: { canonical: "/plugins/submit" },
};

export default function SubmitPage() {
  return (
    <Suspense fallback={<div className="container mx-auto max-w-5xl px-4 py-16 min-h-screen" />}>
      <SubmitWizard />
    </Suspense>
  );
}
