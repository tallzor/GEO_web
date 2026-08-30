import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 生产构建输出独立可运行包到 .next/standalone，部署时无需上传整个 node_modules。
  // 详见 DEPLOYMENT.md「构建与启动」一节。
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
