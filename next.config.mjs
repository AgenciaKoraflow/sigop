/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "iiuvwngyyrkfnchkjued.supabase.co",
      },
    ],
  },
};

export default nextConfig;
