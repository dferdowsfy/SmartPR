"use client";

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
  if (!shouldShowHeader(pathname, search)) return null;
  return <TopNav />;
}
