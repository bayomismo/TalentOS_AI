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
  // Sprint 16 — security headers.
  //
  // TalentOS uses no third-party analytics, no external fonts, no embeds,
  // no external images, so we can run a tight CSP. The headers below are
  // applied to every response (HTML, API, _next assets, etc).
  //
  //  - HSTS: Vercel already sets this at the edge, but we re-declare it
  //    so it's explicit and survives any future platform change.
  //  - CSP: `default-src 'self'` is the principle-of-least-privilege
  //    default. We whitelist:
  //      * 'self'                            — our own origin
  //      * 'unsafe-inline'                   — Next.js injects inline
  //                                            <script> tags for hydration;
  //                                            we can move to nonces later
  //                                            but this is the safe rollout
  //      * data: + blob:                     — required by some image flows
  //      * https:                            — explicit outbound allow-list
  //                                            (can tighten to specific
  //                                            hosts when we add analytics)
  //  - X-Frame-Options DENY                 — block clickjacking via iframe
  //  - X-Content-Type-Options nosniff       — block MIME confusion attacks
  //  - Referrer-Policy strict-origin-when-cross-origin
  //                                         — don't leak full path to other
  //                                           sites via Referer header
  //  - Permissions-Policy                   — disable features we don't use
  //                                           (camera, mic, geolocation, etc)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Scripts: self + inline (Next.js hydration). 'unsafe-eval' is
              // needed by Next.js dev tooling only — in prod we still allow it
              // to avoid breaking React DevTools and similar. Tighten later.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              // Styles: self + inline (Tailwind, component styles)
              "style-src 'self' 'unsafe-inline'",
              // Images: self + data: (base64) + blob: (preview URLs)
              "img-src 'self' data: blob: https:",
              // Fonts: self + data:
              "font-src 'self' data:",
              // XHR/fetch: self + https (for server actions, API calls,
              // and outbound email provider webhook stubs we may add)
              "connect-src 'self' https:",
              // Media: self (no audio/video in app)
              "media-src 'self'",
              // <object>, <embed>, <applet>: deny
              "object-src 'none'",
              // Frames: deny all (we never embed other sites)
              "frame-src 'none'",
              // Who can embed US in a frame: nobody
              "frame-ancestors 'none'",
              // Form actions: only our own domain
              "form-action 'self'",
              // Base URI: only our own
              "base-uri 'self'",
              // Upgrade insecure requests
              "upgrade-insecure-requests",
            ].join('; '),
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // Disable browser features we don't use. Each `()` is denied.
            key: 'Permissions-Policy',
            value: [
              'accelerometer=()',
              'camera=()',
              'geolocation=()',
              'gyroscope=()',
              'magnetometer=()',
              'microphone=()',
              'payment=()',
              'usb=()',
              'interest-cohort=()',  // blocks FLoC / Topics tracking
            ].join(', '),
          },
          {
            // Don't allow our responses to be cached by shared proxies
            // (defense in depth — most endpoints already set cache-control)
            key: 'X-Permitted-Cross-Domain-Policies',
            value: 'none',
          },
        ],
      },
    ]
  },
}

export default nextConfig
