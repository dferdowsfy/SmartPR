import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // Government PDFs and reviewed mappings are runtime inputs, not generated
  // worksheets. Keep them in the Next.js service bundle for every server route.
  outputFileTracingIncludes: {
    "/*": ["RealForms/**/*", "form-mappings/**/*"],
  },
  // Standalone /demo page: a single self-contained HTML file in public/.
  // beforeFiles runs ahead of the app router, so /demo serves the static
  // file even though src/app/demo/ exists (it only has /demo/enterprise).
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/demo", destination: "/demo.html" },
        { source: "/demo/", destination: "/demo.html" },
      ],
    };
  },
  // Allow Browser Use Cloud live preview iframes (live.browser-use.com).
  async headers() {
    return [
      {
        source: "/businesses/:id/agency-run",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "frame-src 'self' https://live.browser-use.com https://*.browser-use.com",
              "child-src 'self' https://live.browser-use.com https://*.browser-use.com",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
