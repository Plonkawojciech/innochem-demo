/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR || ".next",
  skipTrailingSlashRedirect: true,
};
export default nextConfig;
