// PM2 进程守护配置：web 服务 + 发布轮询 worker + 检测轮询 worker。
// 用法：
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save                      # 保存进程列表，开机自启时用
//   pm2 startup                   # 生成开机自启脚本（按提示执行返回的命令）
// 环境变量统一从项目根目录的 .env.production 读取（PM2 5.2+ 支持 env_file）。
// 详见 DEPLOYMENT.md「用 PM2 守护进程」一节。

const path = require("path");

const PROJECT_ROOT = __dirname;
const ENV_FILE = path.join(PROJECT_ROOT, ".env.production");

module.exports = {
  apps: [
    {
      name: "geo-web",
      // standalone 构建产物在 deploy/ 下（由 scripts/deploy-prepare.sh 整理）。
      // cwd 必须设为 deploy/，否则 server.js 找不到 .next/static 和 public/。
      script: "server.js",
      cwd: path.join(PROJECT_ROOT, "deploy"),
      env_file: ENV_FILE,
      env: {
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: "3000",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: "700M",
      error_file: "./logs/pm2-geo-web-err.log",
      out_file: "./logs/pm2-geo-web-out.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "geo-publishing-worker",
      script: "scripts/publishing-worker.mjs",
      cwd: PROJECT_ROOT,
      env_file: ENV_FILE,
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: "300M",
      error_file: "./logs/pm2-publishing-worker-err.log",
      out_file: "./logs/pm2-publishing-worker-out.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "geo-detection-worker",
      script: "scripts/detection-worker.mjs",
      cwd: PROJECT_ROOT,
      env_file: ENV_FILE,
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: "300M",
      error_file: "./logs/pm2-detection-worker-err.log",
      out_file: "./logs/pm2-detection-worker-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
