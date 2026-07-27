/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
    // Windowsで静的生成ワーカー4本が同時にメモリ確保して落ちるため直列化する。
    // 実行時の挙動には影響せず、クリーン環境でも通常ビルドを再現可能にする。
    cpus: 1,
  },
};

export default nextConfig;
