"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { TopNav } from "../history/ui";
import { shouldShowHeader } from "./headerVisibility";

/**
 * Mounts the single persistent app header for the whole app.
 *
 * The header stays mounted across client-side route changes, so the
 * segmented-menu pill can glide between tabs without remounting.
 * Visibility follows the same rule as the server layout's first paint.
 * `useSearchParams()` (not `window.location`) drives the query string so
 * query-only navigations — `/` <-> `/?entry=new-business`, which don't
 * change the pathname — still re-render this component. The root layout
 * already opts every route into dynamic rendering via `headers()`, so the
 * hook is available during the server render and no extra Suspense
 * boundary is needed.
 */
export function TopNavMount({
  initialPathname,
  initialSearch,
}: {
  initialPathname: string;
  initialSearch: string;
}) {
  const pathname = usePathname() ?? initialPathname;
  const searchParams = useSearchParams();
  const search = searchParams ? `?${searchParams.toString()}` : initialSearch;
  const show = shouldShowHeader(pathname, search);
  // Viewport-locked pages size to viewport-minus-header via --topnav-h.
  // When the header is hidden, publish 0 so those pages take the full
  // viewport instead of the 64px fallback. When it shows, TopNav's own
  // ResizeObserver publishes the real height.
  useEffect(() => {
    if (!show && typeof document !== "undefined") {
      document.documentElement.style.setProperty("--topnav-h", "0px");
    }
  }, [show, pathname, search]);
  if (!show) return null;
  return <TopNav />;
}
