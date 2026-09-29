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
  distDir: process.env.NEXT_DIST_DIR || ".next",
  skipTrailingSlashRedirect: true,
  // Local runs use APP_URL=http://127.0.0.1:<port>; dev asset loading must allow that host.
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
export default nextConfig;
