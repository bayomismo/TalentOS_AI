/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Vercel's serverless bundler doesn't externalize transitive deps.
  // Prisma 7.x requires `@prisma/client-runtime-utils` via `require()`, so
  // we explicitly mark it as external so the serverless function can find
  // it on the Lambda file system at runtime.
  serverExternalPackages: [
    '@prisma/client',
    '@prisma/client-runtime-utils',
    '@prisma/adapter-pg',
  ],
}

export default nextConfig
