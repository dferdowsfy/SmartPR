import type { ReactNode } from "react";
import { SupportAccessBanner } from "./SupportAccessBanner";

/**
 * /admin layout — mounts the persistent support-access banner above every
 * admin page. The banner is only visible while a non-expired, non-revoked
 * support_access_grants row backs the sp_support_ws cookie.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SupportAccessBanner />
      {children}
    </>
  );
}
