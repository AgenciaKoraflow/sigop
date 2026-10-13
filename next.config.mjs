const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), bluetooth=(), interest-cohort=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  // The Content-Security-Policy is per-request (nonce) and is set in middleware.ts.
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  env: {
    // Boolean only — the shared provisional password itself stays server-side.
    NEXT_PUBLIC_SHARED_PASSWORD_MODE: process.env.SHARED_PROVISIONAL_PASSWORD?.trim() ? "1" : "",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "iiuvwngyyrkfnchkjued.supabase.co",
      },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
