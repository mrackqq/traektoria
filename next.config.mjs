/** @type {import('next').NextConfig} */
const nextConfig = {
  // Сборка пишет в отдельную папку, если её задали через окружение: иначе
  // `next build` и работающий `next dev` портят друг другу общий `.next`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  // SEC-02: базовые защитные заголовки. CSP задаётся здесь статически;
  // при добавлении внешних скриптов её нужно пересматривать, а не расширять «на всякий случай».
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Next.js в dev-режиме использует eval для HMR; в проде остаётся только 'self'.
              process.env.NODE_ENV === 'development'
                ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
                : "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
      {
        // SEC-03 / PRIV-05: приватные ответы не кешируются CDN.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, private' }],
      },
    ];
  },
};

export default nextConfig;
