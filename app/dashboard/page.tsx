import type { Metadata } from "next";
import { PublisherDashboard } from "@/components/publisher-dashboard";

export const metadata: Metadata = {
  title: "Publisher Console",
  description:
    "Track submission pull requests and manage claimed plugins in the Turboism Curated Plugin Directory.",
  alternates: { canonical: "/plugins/dashboard" },
};

export default function DashboardPage() {
  return <PublisherDashboard />;
}
