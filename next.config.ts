import type { NextConfig } from "next";

// The page Content Security Policy (with a per-request nonce) is set in src/proxy.ts.
// API responses are JSON and get this strict one.
const apiCsp = "default-src 'none'; frame-ancestors 'none'";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera and microphone only for our own kiosk pages; everything else off.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const pages = process.env.PAGES_BUILD === "1";

const nextConfig: NextConfig = pages
  ? {
      // GitHub Pages: static UI + the in-browser backend (scripts/build-pages.mjs). No server, no headers.
      output: "export",
      basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
      trailingSlash: true,
      images: { unoptimized: true },
      reactStrictMode: true,
      // The API folder is moved aside for this build (route handlers can't be exported), so Next's own type
      // check would fail on files that import it. `npm run typecheck` runs separately, before this build, in CI.
      typescript: { ignoreBuildErrors: true },
    }
  : {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "Content-Security-Policy", value: apiCsp }] },
    ];
  },
};

export default nextConfig;
