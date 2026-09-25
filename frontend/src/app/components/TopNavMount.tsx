"use client";

import { useEffect, useReducer } from "react";
import { usePathname } from "next/navigation";
import { TopNav } from "../history/ui";
import { shouldShowHeader } from "./headerVisibility";

/**
 * Mounts the single persistent app header for the whole app.
 *
 * The header stays mounted across client-side route changes, so the
 * segmented-menu pill can glide between tabs without remounting.
 * Visibility follows the same rule as the server layout's first paint;
 * on "/" the search string decides between the marketing landing (no
 * header) and the intake (header). `useSearchParams()` would force a
 * Suspense boundary and drop the header from SSR HTML, so the search
 * string is read from window.location instead, seeded by the server on
 * first paint.
 */
export function TopNavMount({
  initialPathname,
  initialSearch,
}: {
  initialPathname: string;
  initialSearch: string;
}) {
  const pathname = usePathname() ?? initialPathname;
  // Re-render once a client-side navigation settles so window.location
  // is guaranteed to reflect the new URL.
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    force();
  }, [pathname]);
  const search =
    typeof window === "undefined" ? initialSearch : window.location.search;
  if (!shouldShowHeader(pathname, search)) return null;
  return <TopNav />;
}
