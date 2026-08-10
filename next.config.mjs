import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const projectRoot = fileURLToPath(new URL(".", import.meta.url));

const nextConfig = {
  outputFileTracingRoot: projectRoot,
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Windowsで静的生成ワーカー4本が同時にメモリ確保して落ちるため直列化する。
    // 実行時の挙動には影響せず、クリーン環境でも通常ビルドを再現可能にする。
    cpus: 1,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
              "form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; " +
              "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
              "connect-src 'self' https:; worker-src 'self' blob:; manifest-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
