import type { Metadata } from "next";
import EnterpriseDemo from "./EnterpriseDemo";

export const metadata: Metadata = {
  title: "Enterprise Demo | SmartPR",
  description: "Isolated SmartPR enterprise demonstration with fictional project data.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/demo/enterprise" },
};

export default function Page() { return <EnterpriseDemo />; }
