// ============================================================================
// Enterprise shared sub-navigation (Phase 3 owns enterprise nav).
// Rendered by /enterprise pages; links to sibling sections that other
// phases own — those routes render when their phase lands.
// ============================================================================
"use client";

import Link from "next/link";

const LINKS = [
  { href: "/enterprise", label: "Portfolio" },
  { href: "/enterprise/work", label: "Work queue" },
  { href: "/enterprise/regulatory", label: "Regulatory changes" },
  { href: "/enterprise/reports", label: "Reports" },
  { href: "/enterprise/admin", label: "Organization admin" },
];

export function EnterpriseSubNav({ active }: { active: string }) {
  return (
    <nav
      aria-label="Enterprise sections"
      className="flex flex-wrap gap-1 border-b border-[#161616]/10 pb-3"
    >
      {LINKS.map((l) => {
        const isActive =
          l.href === "/enterprise" ? active === "/enterprise" : active.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              isActive
                ? "bg-brand text-[#f6f3ea]"
                : "text-[#161616]/70 hover:bg-[#161616]/5 hover:text-[#161616]"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
