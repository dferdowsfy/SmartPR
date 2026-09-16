"use client";

import { DemoBanner, RehearsalProvider } from "./rehearsal";

export default function RehearsalPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RehearsalProvider>
      <div className="min-h-screen bg-slate-100 text-slate-900">
        <DemoBanner />
        {children}
      </div>
    </RehearsalProvider>
  );
}
