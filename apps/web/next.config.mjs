/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@fb-ads/shared"],
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bullmq"],
    instrumentationHook: true,
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://connect.facebook.net",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data:",
              "connect-src 'self' https://graph.facebook.com https://www.facebook.com https://connect.facebook.net https://*.googleapis.com https://api.openai.com https://api.anthropic.com ws: wss:",
              "frame-src https://www.facebook.com https://web.facebook.com",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
