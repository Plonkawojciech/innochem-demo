/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self)",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];
const nextConfig = {
  output: "standalone",
  // The preview proxy negotiates Brotli and gzip for immutable assets and HTML.
  compress: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  skipTrailingSlashRedirect: true,
  // Local runs use APP_URL=http://127.0.0.1:<port>; dev asset loading must allow that host.
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/hero-olej-small-d4f01e0e78905be3.avif",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/hero-olej-mobile-855b096a504ba167.avif",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      ...[
        "/tlo-silnik-480-4e7a56fa45622363.avif",
        "/tlo-silnik-800-1753ea917a467a6e.avif",
        "/tlo-silnik-1024-f70777c1c04c694b.avif",
      ].map((source) => ({
        source,
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      })),
    ];
  },
  // One canonical host: www.innochem.pl answers only with a permanent redirect to the apex domain.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.innochem.pl" }],
        destination: "https://innochem.pl/:path*",
        permanent: true,
      },
    ];
  },
};
export default nextConfig;
