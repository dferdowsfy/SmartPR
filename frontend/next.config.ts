import type { NextConfig } from "next";

/**
 * Origins of the self-hosted browser worker(s) (Teach Clara live view is a
 * noVNC page served by the worker). Read at build time — Railway exposes
 * service variables to the build — so the agency-run page may frame them.
 */
function workerFrameOrigins(): string[] {
  const out = new Set<string>();
  for (const v of [process.env.TEACH_WORKER_URL, process.env.SELF_HOSTED_AGENT_URL]) {
    try {
      if (v?.trim()) out.add(new URL(v.trim()).origin);
    } catch {
      // not a URL: ignore
    }
  }
  return [...out];
}

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // Government PDFs and reviewed mappings are runtime inputs, not generated
  // worksheets. Keep them in the Next.js service bundle for every server route.
  outputFileTracingIncludes: {
    "/*": ["RealForms/**/*", "form-mappings/**/*"],
  },
  // Bare-domain canonicalization: once getsmartpr.com points at Railway,
  // redirect it to www (path-preserving). Only matches the bare host, so
  // www traffic is unaffected.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "getsmartpr.com" }],
        destination: "https://www.getsmartpr.com/:path*",
        permanent: true,
      },
    ];
  },
  // Standalone /demo page: a single self-contained HTML file in public/.
  // beforeFiles runs ahead of the app router, so /demo serves the static
  // file even though src/app/demo/ exists (it only has /demo/enterprise).
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/demo", destination: "/demo.html" },
        { source: "/demo/", destination: "/demo.html" },
        // /demo/es and /demo/en serve the same bundle; the page reads
        // location.pathname and starts that language's narrated walkthrough
        // with tap-to-start autoplay (see public/demo.html).
        { source: "/demo/es", destination: "/demo.html" },
        { source: "/demo/es/", destination: "/demo.html" },
        { source: "/demo/en", destination: "/demo.html" },
        { source: "/demo/en/", destination: "/demo.html" },
      ],
    };
  },
  // Allow Browser Use Cloud live preview iframes (live.browser-use.com) and
  // the self-hosted worker's live view (TEACH_WORKER_URL / SELF_HOSTED_AGENT_URL).
  async headers() {
    const frames = ["'self'", "https://live.browser-use.com", "https://*.browser-use.com", ...workerFrameOrigins()].join(" ");
    return [
      {
        source: "/businesses/:id/agency-run",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              `frame-src ${frames}`,
              `child-src ${frames}`,
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
