# 阿里云部署指南（小白版）

本指南把 GEO_web 部署到阿里云 ECS，让网站 + 四个后台轮询 worker 一起稳定常驻运行。
按顺序照做即可，每一步都给了完整命令，能复制粘贴。

> 本项目已为部署做好了准备：
> - [next.config.ts](next.config.ts) 启用了 `output: "standalone"`，构建产物自包含、体积小。
> - [ecosystem.config.cjs](ecosystem.config.cjs) 配好了 PM2 守护（web + 发布、检测、认知、问题模拟 worker）。
> - [scripts/deploy-prepare.sh](scripts/deploy-prepare.sh) 一键完成「装依赖 → 构建 → 整理产物」。

---

## 目录

1. [整体架构（先搞清楚在干什么）](#1-整体架构)
2. [第 0 步：准备清单](#2-第-0-步准备清单)
3. [第 1 步：买阿里云服务器](#3-第-1-步买阿里云服务器)
4. [第 2 步：域名与备案](#4-第-2-步域名与备案)
5. [第 3 步：连上服务器](#5-第-3-步连上服务器)
6. [第 4 步：安装基础软件（Node / Nginx / PM2）](#6-第-4-步安装基础软件)
7. [第 5 步：上传代码到服务器](#7-第-5-步上传代码)
8. [第 6 步：配置环境变量 .env.production](#8-第-6-步配置环境变量)
9. [第 7 步：构建项目](#9-第-7-步构建项目)
10. [第 8 步：用 PM2 启动并守护进程](#10-第-8-步用-pm2-启动并守护进程)
11. [第 9 步：配置 Nginx 反向代理](#11-第-9-步配置-nginx-反向代理)
12. [第 10 步：上 HTTPS（免费证书）](#12-第-10-步上-https)
13. [第 11 步：验证部署是否成功](#13-第-11-步验证部署)
14. [第 12 步：日常更新代码与回滚](#14-第-12-步日常更新与回滚)
15. [常见坑与排查](#15-常见坑与排查)

---

## 1. 整体架构

部署完成后，服务器上跑着 **5 个常驻进程**，由 PM2 守护，重启自动拉起：

```
                       ┌─────────────── 阿里云 ECS ───────────────┐
  用户浏览器 ──HTTPS──▶ │ Nginx (80/443)                            │
                       │   ├─ 反向代理到 127.0.0.1:3000             │
                       │   └─ 静态资源直发                          │
                       │                                           │
                       │ PM2 守护 5 个进程：                        │
                       │   ├─ geo-web         (Next.js 服务, :3000) │
                       │   ├─ geo-publishing-worker (轮询发布任务)   │
                       │   ├─ geo-detection-worker  (轮询检测任务)   │
                       │   ├─ geo-cognition-worker  (轮询认知任务)   │
                       │   └─ geo-question-simulation-worker         │
                       │                         (轮询问题模拟任务)   │
                       │                                           │
                       │ Supabase / 火山方舟 / 混元  ←── 走外网 API │
                       └───────────────────────────────────────────┘
```

- **geo-web**：主网站，提供页面和 API，监听 127.0.0.1:3000（不直接对公网）。
- **geo-publishing-worker**：死循环轮询 `POST /api/publishing/worker/run`，把待发布任务推到各平台。
- **geo-detection-worker**：死循环轮询 `POST /api/detections/worker/run`，跑 AI 检测任务。
- **geo-cognition-worker**：死循环轮询 `POST /api/cognition-runs/worker/run`，建立品牌和产品认知洞察。
- **geo-question-simulation-worker**：死循环轮询 `POST /api/question-simulations/worker/run`，生成待客户审核的模拟问题。

四个 worker 都是项目自带的后台任务，必须和 web 一起常驻，否则对应的发布、检测、认知或问题模拟流程会停在排队状态。

---

## 2. 第 0 步：准备清单

开始前确认你有这些东西（没有的先去办）：

| 东西 | 说明 |
|------|------|
| 阿里云账号 | 用于买服务器、买域名 |
| 域名（已备案） | 例如 `geoweb.example.com`。**国内服务器必须备案**，否则 80/443 端口会被拦截 |
| 项目代码 | 本地 `d:\My_Workspace\ChuangShi_brand\GEO_web` 这份 |
| Git 仓库（推荐） | 代码放 Gitee/GitHub 私库，服务器 `git pull` 更新最省事 |
| Supabase 项目 | 已建好，URL 和 Key 都在手 |
| 火山方舟 API Key | `ARK_API_KEY`、`GEO_FOUNDATION_API_KEY` |
| 混元 API Key | `HUNYUAN_API_KEY` |

---

## 3. 第 1 步：买阿里云服务器

### 规格

这个项目跑 Next.js + 4 个轻量轮询 worker，**最低 2 核 4G**，推荐 **2 核 4G 起步**：

| 配置 | 是否够用 | 说明 |
|------|----------|------|
| 1 核 2G | ❌ 勉强 | `next build` 会 OOM，运行也紧张 |
| 2 核 4G | ✅ 推荐 | 构建顺畅，运行留有余量 |
| 2 核 8G | ✅ 宽裕 | 预算够就上这个 |

> **重要**：构建很吃内存。如果只有 2G 机器，构建时会 OOM 失败。解决办法见 [常见坑](#15-常见坑与排查) 的「构建 OOM」——可以先在本地构建好再把产物传上去。

### 系统

选 **Ubuntu 22.04 LTS**（或 24.04 LTS）。本指南所有命令都基于 Ubuntu。

### 购买路径

阿里云控制台 → 云服务器 ECS → 创建实例：
- **地域**：选离用户近的（华东 1 杭州 / 华北 2 北京 等）
- **实例规格**：`ecs.g7a.large`（2 核 4G）或 `ecs.t6-c1m2.large`
- **镜像**：Ubuntu 22.04 64 位
- **系统盘**：40G ESSD 起步
- **带宽**：按固定带宽 1~3 Mbps（小站点够用），或按使用流量（更省但有突发费用风险）
- **安全组**：开放端口 **22 (SSH)、80 (HTTP)、443 (HTTPS)**，其它端口（如 3000）**不要**对公网开

### 记住三样东西

买完会拿到：
1. **公网 IP**：例如 `47.xxx.xxx.xxx`
2. **root 密码**：或者你配的 SSH 密钥
3. **实例 ID**：控制台里能看到

---

## 4. 第 2 步：域名与备案

1. **买域名**：阿里云域名控制台买一个，`.com` 一年几十块。
2. **备案**：国内服务器必须备案。阿里云控制台搜「ICP 备案」，按指引提交，**通常 7~20 个工作日**。
3. **解析**：备案通过后，在域名控制台添加 A 记录：
   - 主机记录：`@`（或你想用的子域名如 `app`）
   - 记录类型：`A`
   - 记录值：你的服务器公网 IP
   - TTL：默认 10 分钟

解析生效后，`ping 你的域名` 能看到你的 IP 就对了。

> 没备案完成之前，可以用 IP 直接访问 3000 端口临时测试，但不要用于正式。

---

## 5. 第 3 步：连上服务器

### Windows 用户

用 **PowerShell**（Win10/11 自带）或装 **MobaXterm / PuTTY**。推荐 PowerShell + 内置 ssh：

```powershell
ssh root@47.xxx.xxx.xxx
```

输入买实例时设的密码，连上后会看到类似 `root@i-xxx:~#` 的提示符。

> 后面所有「在服务器上执行」的命令都在这个终端里粘贴运行。

### 首次登录后建议做的事

```bash
# 1. 更新系统
apt update && apt upgrade -y

# 2. 改时区为上海
timedatectl set-timezone Asia/Shanghai

# 3. （可选但推荐）创建普通用户，避免一直用 root
adduser deploy
usermod -aG sudo deploy
# 给 deploy 设密码后，之后用 deploy 登录更安全

# 4. （可选）配 SSH 密钥登录、关密码登录，更安全
```

> 为了简单，本指南后面命令都用 `deploy` 用户执行（如果你跳过了建用户，就用 `root`，命令一样）。

---

## 6. 第 4 步：安装基础软件

在服务器上依次执行。**每段都可以整段复制粘贴**。

### 4.1 装 Node.js 22 LTS

Next.js 16 需要 Node 20.9+，推荐 **Node 22 LTS**。用 NodeSource 官方源，版本好管理：

```bash
# 切到 root 或加 sudo
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 验证
node -v   # 应显示 v22.x.x
npm -v    # 应显示 10.x.x
```

### 4.2 装 Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx     # 开机自启
sudo systemctl start nginx
nginx -v                        # 验证
```

### 4.3 装 PM2（进程守护）

```bash
sudo npm install -g pm2
pm2 -v                          # 验证
```

### 4.4 装 Git（拉代码用）

```bash
sudo apt install -y git
git --version
```

### 4.5 装构建工具（npm 编译原生模块可能要）

```bash
sudo apt install -y build-essential
```

---

## 7. 第 5 步：上传代码

有 **两种方式**，推荐第一种。

### 方式 A：用 Git（推荐，日常更新最方便）

1. 先把本地代码推到 Gitee 或 GitHub 私库（如果还没推）：

```powershell
# 在本地项目目录 d:\My_Workspace\ChuangShi_brand\GEO_web
git init
git remote add origin https://gitee.com/你的用户名/geo-web.git
git add .
git commit -m "init"
git push -u origin main
```

2. 在服务器上克隆：

```bash
# 切到 deploy 用户（或 root）
sudo mkdir -p /opt/geo-web
sudo chown deploy:deploy /opt/geo-web
cd /opt/geo-web

git clone https://gitee.com/你的用户名/geo-web.git .
# 如果是私库会要求输入 Gitee 账号密码
```

> 以后更新代码只要 `git pull`，见 [第 12 步](#14-第-12-步日常更新与回滚)。

### 方式 B：用 rsync/scp 直接传（没有 Git 仓库时）

在 **本地 PowerShell** 执行（把代码整个传上去）：

```powershell
# 注意末尾的冒号和点
scp -r d:\My_Workspace\ChuangShi_brand\GEO_web\* deploy@47.xxx.xxx.xxx:/opt/geo-web/
```

> `.env.local`、`node_modules`、`.next` 不用传（在 `.gitignore` 里已排除，用 git 方式天然不会传）。如果用 scp，自己排除这些。

后面假设代码在服务器的 `/opt/geo-web` 目录下。

---

## 8. 第 6 步：配置环境变量

### 关键概念：NEXT_PUBLIC_ 前缀规则

**这个一定要理解，否则白屏/报错**：

- 变量名以 `NEXT_PUBLIC_` 开头的（如 `NEXT_PUBLIC_SUPABASE_URL`）：**会在构建时被写死进前端代码**。意味着改了这些值**必须重新 `npm run build`** 才生效。它们能被浏览器看到。
- **不带** `NEXT_PUBLIC_` 前缀的（如 `ARK_API_KEY`、`SUPABASE_SECRET_KEY`）：**只在服务端运行时读取**，改完**重启进程**就生效，不用重新构建。浏览器永远看不到，安全。

### 创建 .env.production

在服务器上：

```bash
cd /opt/geo-web
cp .env.example .env.production
nano .env.production      # 或者用 vim
```

按下面逐项填写（**所有值都不要加引号**）：

```ini
# ========== AI 模型密钥（服务端，不外泄） ==========
ARK_API_KEY=你的火山方舟key
ARK_MODEL=doubao-seed-2-0-lite-260428
ARK_DEEPSEEK_MODEL=deepseek-v4-flash-260425

HUNYUAN_API_KEY=你的混元key
HUNYUAN_MODEL=hy3

# 底座模型
GEO_FOUNDATION_PROVIDER=ark
GEO_FOUNDATION_API_KEY=你的底座模型key
GEO_FOUNDATION_BASE_URL=https://ark.cn-beijing.volces.com/api/v3/chat/completions
GEO_FOUNDATION_MODEL=deepseek-v4-flash-ga-260731
GEO_FOUNDATION_TIMEOUT_MS=240000

# 生产环境关闭本地 AI 调试接口
ENABLE_LOCAL_AI_API=false

# ========== Supabase（数据 + 鉴权） ==========
# 下面两个是 NEXT_PUBLIC_ 开头，构建时写进前端，改了要重新 build
NEXT_PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=你的anon公钥
# 这个是服务端密钥，权限大，绝对不要泄露
SUPABASE_SECRET_KEY=你的service_role密钥

# 生产环境必须用 supabase
GEO_DATA_BACKEND=supabase
GEO_AUTH_MODE=supabase

# ========== Worker 令牌（服务端） ==========
# 加密发布凭据用的密钥，用下面命令生成一段随机串：
#   openssl rand -base64 32
PUBLISHING_CREDENTIALS_KEY=用openssl生成的随机串
# Worker 调用内部 API 的令牌，也用 openssl rand -base64 32 生成
PUBLISH_WORKER_TOKEN=用openssl生成的随机串
GEO_WORKER_TOKEN=同上，可以和PUBLISH_WORKER_TOKEN用同一个值
GEO_COLLECTION_CONCURRENCY=3

# ========== 地址配置 ==========
# Worker 从服务器本机调用，用 127.0.0.1 最快最安全
GEO_INTERNAL_BASE_URL=http://127.0.0.1:3000
# 下面两个是 NEXT_PUBLIC_ 开头，会写进前端，要填你的真实域名
NEXT_PUBLIC_APP_URL=https://你的域名.com
# 服务器出口 IP（可选，Supabase RLS 限制 IP 时用）
# 在服务器上执行 curl ifconfig.me 能看到出口 IP
NEXT_PUBLIC_SERVER_EGRESS_IP=
```

### 生成随机密钥的命令

在服务器上执行两次，把输出分别填到 `PUBLISHING_CREDENTIALS_KEY` 和 `PUBLISH_WORKER_TOKEN`：

```bash
openssl rand -base64 32
```

### 保护环境变量文件

```bash
chmod 600 .env.production      # 只有 owner 能读写
```

> **注意**：如果以后要改 `NEXT_PUBLIC_` 开头的变量（比如换域名、换 Supabase URL），改完必须重新构建（见第 12 步）。改非 `NEXT_PUBLIC_` 的变量，重启 PM2 即可。

---

## 9. 第 7 步：构建项目

在服务器上：

```bash
cd /opt/geo-web

# 创建日志目录（PM2 会往里写）
mkdir -p logs

# 一键构建（装依赖 + 类型检查 + next build + 整理 standalone 产物到 deploy/）
bash scripts/deploy-prepare.sh
```

这个脚本会做这些事（见 [scripts/deploy-prepare.sh](scripts/deploy-prepare.sh)）：
1. `npm ci` 安装依赖
2. `npm run typecheck` 类型检查
3. `npm run build` 构建（输出 standalone 产物到 `.next/standalone`）
4. 把 standalone 产物、静态资源整理到 `deploy/` 目录
5. 校验产物完整性

构建成功会看到 `✅ 构建完成`，`deploy/` 目录大小一般 100M 左右。

> **构建大约要 2~5 分钟，中间会卡住一会儿，正常现象，别 Ctrl+C。**

### 构建失败？

- 报 `out of memory` → 见 [常见坑 - 构建 OOM](#构建-oom)
- 报类型错误 → 本地先 `npm run typecheck` 修了再传
- 报权限错误 → `sudo chown -R deploy:deploy /opt/geo-web`

---

## 10. 第 8 步：用 PM2 启动并守护进程

### 启动

```bash
cd /opt/geo-web
pm2 start ecosystem.config.cjs --env production
```

会看到 PM2 列出 5 个进程：`geo-web`、`geo-publishing-worker`、`geo-detection-worker`、`geo-cognition-worker`、`geo-question-simulation-worker`，状态都是 `online`。

### 查看状态

```bash
pm2 status                    # 总览
pm2 logs geo-web              # 看 web 日志（Ctrl+C 退出）
pm2 logs geo-publishing-worker   # 看发布 worker 日志
pm2 logs geo-cognition-worker    # 看认知洞察 worker 日志
pm2 logs geo-question-simulation-worker # 看问题模拟 worker 日志
pm2 logs                      # 看所有日志
```

### 设置开机自启（关键！）

让服务器重启后 PM2 自动拉起所有进程：

```bash
pm2 save                                  # 保存当前进程列表
pm2 startup                               # 生成开机自启脚本
# 屏幕会返回一条类似下面的命令，复制粘贴执行：
#   sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy
```

> 按提示把返回的那条 `sudo env PATH=...` 命令执行一遍，开机自启就配好了。

### 验证 web 起来了

```bash
curl http://127.0.0.1:3000
# 返回一坨 HTML 就对了
```

---

## 11. 第 9 步：配置 Nginx 反向代理

Nginx 把 80 端口的请求转给 127.0.0.1:3000，这样用户只跟 Nginx 打交道，Next.js 不直接暴露。

### 创建站点配置

```bash
sudo nano /etc/nginx/sites-available/geo-web
```

粘贴下面内容（**把 `你的域名.com` 换成你的真实域名**）：

```nginx
server {
    listen 80;
    server_name 你的域名.com www.你的域名.com;

    # 日志
    access_log /var/log/nginx/geo-web-access.log;
    error_log  /var/log/nginx/geo-web-error.log;

    # 上传体积（AI 生成内容可能较大）
    client_max_body_size 20m;

    # 反向代理到 Next.js
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # WebSocket 支持（Next.js HMR 用，生产可不加但加了无害）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 透传真实客户端信息，否则 Next.js 只能看到 127.0.0.1
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时（AI 接口慢，给足时间）
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # Next.js 静态资源缓存（_next/static 里有 hash，可长期缓存）
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache_valid 200 365d;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
```

### 启用站点

```bash
sudo ln -s /etc/nginx/sites-available/geo-web /etc/nginx/sites-enabled/

# 测试配置语法
sudo nginx -t
# 显示 syntax is ok / test is successful 就对了

# 重载
sudo systemctl reload nginx
```

现在浏览器访问 `http://你的域名.com` 应该能看到网站了。

> 如果访问不了，先检查 [安全组](#3-第-1-步买阿里云服务器) 有没有开 80 端口，再看 [常见坑](#15-常见坑与排查)。

---

## 12. 第 10 步：上 HTTPS

**必须上 HTTPS**：Supabase 鉴权、Chrome 扩展、移动端都要求 HTTPS。用免费的 Let's Encrypt。

### 装 Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 申请证书并自动配置 Nginx

```bash
sudo certbot --nginx -d 你的域名.com -d www.你的域名.com
```

按提示：
1. 输入你的邮箱（证书过期提醒用）
2. 同意服务条款：`Y`
3. 是否分享邮箱：`N`
4. 选自动把 HTTP 跳转到 HTTPS：选 `2`（强制 HTTPS）

成功后 Nginx 配置会自动加上 443 端口和证书路径，并自动把 80 跳转到 443。

### 自动续期

Let's Encrypt 证书 90 天过期，Certbot 装好会自带定时续期。验证一下：

```bash
sudo certbot renew --dry-run
```

显示 `Congratulations, all simulated renewals succeeded` 就对了，以后自动续。

现在访问 `https://你的域名.com`，浏览器应该显示小锁。

---

## 13. 第 11 步：验证部署

### 11.1 网站能打开

浏览器访问 `https://你的域名.com`，能看到登录页。

### 11.2 五个进程都在跑

```bash
pm2 status
```

五个进程都是 `online`，`restart` 列是 0 或小数字（频繁重启说明有问题）。

### 11.3 Supabase 连通

```bash
cd /opt/geo-web
npm run supabase:verify
```

> 注意：这个脚本默认读 `.env.local`，要先 `cp .env.production .env.local` 或者直接在命令前加环境。详见脚本 [scripts/verify-supabase-setup.mjs](scripts/verify-supabase-setup.mjs)。

### 11.4 Worker 在工作

```bash
pm2 logs geo-publishing-worker --lines 20
pm2 logs geo-detection-worker --lines 20
pm2 logs geo-cognition-worker --lines 20
pm2 logs geo-question-simulation-worker --lines 20
```

看到四个 worker 各自的 `started as ...` 日志就对了。没有任务时会每 3 秒空转一次，正常。

### 11.5 健康检查接口

```bash
curl http://127.0.0.1:3000/api/health 2>/dev/null || echo "若无 health 接口则忽略，看首页即可"
curl -I https://你的域名.com
# 返回 HTTP/2 200 就对了
```

---

## 14. 第 12 步：日常更新与回滚

### 日常更新代码（最常用）

当你在本地改了代码（比如刚优化了 `content-generator.ts`），按这个流程上线：

```bash
# 1. 本地：提交并推送
git add .
git commit -m "优化内容生成提示词"
git push

# 2. 服务器上：
cd /opt/geo-web
git pull

# 3. 重新构建
bash scripts/deploy-prepare.sh

# 4. 重启 PM2（让新代码生效）
pm2 restart all

# 5. 确认状态
pm2 status
```

> **改了 `NEXT_PUBLIC_` 开头的环境变量也要重新构建 + 重启。** 只改非 `NEXT_PUBLIC_` 变量，`pm2 restart all` 即可，不用 build。

### 回滚到上一版本

如果新代码上线后出问题，快速回滚：

```bash
cd /opt/geo-web

# 1. 看最近提交，找到上一个稳定版本的 commit hash
git log --oneline -10

# 2. 回滚到指定版本（假设是 abc1234）
git reset --hard abc1234

# 3. 重新构建 + 重启
bash scripts/deploy-prepare.sh
pm2 restart all
```

### 只改了环境变量（没改代码）

```bash
cd /opt/geo-web
nano .env.production        # 改完保存

# 改的是非 NEXT_PUBLIC_ 变量：直接重启
pm2 restart all

# 改的是 NEXT_PUBLIC_ 变量：必须重新构建
bash scripts/deploy-prepare.sh
pm2 restart all
```

---

## 15. 常见坑与排查

### 坑 1：构建 OOM（内存不足）

**症状**：`npm run build` 报 `JavaScript heap out of memory` 或进程被杀。

**原因**：2G 内存机器构建时内存不够。

**解决**（任选其一）：

**A. 给 Node 加内存上限**（治标）：
```bash
cd /opt/geo-web
# 临时加大堆内存再构建
NODE_OPTIONS="--max-old-space-size=1536" bash scripts/deploy-prepare.sh
```

**B. 加 swap 虚拟内存**（推荐，一劳永逸）：
```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
# 永久生效
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**C. 本地构建，只传产物**（2G 机器终极方案）：
在本地（内存大）构建好 `deploy/` 目录，把 `deploy/` 整个传到服务器，服务器不用装 dev 依赖、不用构建，直接 `pm2 start`。

### 坑 2：网站打不开

按顺序排查：

```bash
# 1. Next.js 起来了吗？
pm2 status                    # geo-web 是 online 吗？
curl http://127.0.0.1:3000    # 本机能访问吗？

# 2. Nginx 起来了吗？
sudo systemctl status nginx
sudo nginx -t                 # 配置语法对吗？

# 3. 安全组开了吗？
# 阿里云控制台 → ECS → 安全组 → 入方向规则，确认 80/443 开放

# 4. 域名解析到了吗？
ping 你的域名.com             # IP 对吗？

# 5. 备案了吗？
# 国内服务器没备案，80/443 会被拦截
```

### 坑 3：PM2 重启循环

**症状**：`pm2 status` 里某进程 `restart` 次数一直涨。

```bash
pm2 logs geo-web --lines 50 --err
```

看错误信息。常见原因：
- `.env.production` 里少了必填变量（如 `PUBLISH_WORKER_TOKEN` 没填，worker 启动就退）
- `deploy/server.js` 不存在（构建没成功）
- 端口 3000 被占用：`sudo lsof -i:3000`，`pm2 stop all` 后再起

### 坑 4：502 Bad Gateway

Nginx 起来了但连不上 Next.js：

```bash
pm2 status                    # geo-web 是不是 stopped？
pm2 restart geo-web
curl http://127.0.0.1:3000    # 本机通不通？
```

通的话是 Nginx 配置问题，看 `/var/log/nginx/geo-web-error.log`。

### 坑 5：Worker 报 401 Unauthorized

`PUBLISH_WORKER_TOKEN` / `GEO_WORKER_TOKEN` 没配，或值跟代码里校验的对不上。检查 `.env.production`，重启 `pm2 restart all`。

### 坑 6：Supabase 连不上 / RLS 报错

- 确认 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 填了（**改完要重新 build**，因为是 `NEXT_PUBLIC_` 前缀）
- `SUPABASE_SECRET_KEY` 是 service_role 那个，不是 anon 的，权限不同
- Supabase 项目如果开了 IP 白名单，要把服务器出口 IP 加进去（`curl ifconfig.me` 查出口 IP）
- RLS 策略要在 Supabase 控制台配好，参考项目里的 `supabase:verify` 脚本

### 坑 7：定时任务

本项目**不需要**额外配 cron。四个 worker 是死循环常驻进程，由 PM2 守护，本身就在持续轮询。

如果你想加别的定时任务（比如每天清理日志）：

```bash
crontab -e
# 加一行：每天凌晨 3 点清理 7 天前的 PM2 日志
0 3 * * * find /opt/geo-web/logs -name "*.log" -mtime +7 -delete
```

### 坑 8：PM2 日志撑爆磁盘

PM2 日志不自动清理。建议：

```bash
pm2 install pm2-logrotate     # 装日志轮转插件
pm2 set pm2-logrotate:max_size 50M     # 单文件超 50M 切割
pm2 set pm2-logrotate:retain 14        # 保留 14 份
pm2 set pm2-logrotate:compress true    # 旧日志压缩
```

### 坑 9：改了 .env.production 但没生效

- 非 `NEXT_PUBLIC_` 变量：`pm2 restart all`
- `NEXT_PUBLIC_` 变量：必须 `bash scripts/deploy-prepare.sh` 重新构建，再 `pm2 restart all`（构建会把变量写死进前端 JS）

### 坑 10：服务器重启后网站没了

说明 PM2 开机自启没配好：

```bash
pm2 save                      # 先保存当前进程列表
pm2 startup                   # 按提示执行返回的命令
```

### 坑 11：端口被占用

```bash
sudo lsof -i:3000             # 看谁占了
pm2 stop all                  # 停掉自己的
# 处理占用进程后
pm2 start ecosystem.config.cjs --env production
```

---

## 附：一键速查（部署成功后的日常）

```bash
# 看状态
pm2 status

# 看日志
pm2 logs

# 重启所有
pm2 restart all

# 重启单个
pm2 restart geo-web

# 更新代码上线
cd /opt/geo-web && git pull && bash scripts/deploy-prepare.sh && pm2 restart all

# 只改了环境变量（非 NEXT_PUBLIC_）
nano .env.production && pm2 restart all

# 看 Nginx 错误日志
sudo tail -f /var/log/nginx/geo-web-error.log

# 看磁盘
df -h

# 看内存
free -h
```

---

## 附：项目部署相关文件速查

| 文件 | 作用 |
|------|------|
| [next.config.ts](next.config.ts) | 启用 `output: "standalone"` |
| [ecosystem.config.cjs](ecosystem.config.cjs) | PM2 守护配置（web + 4 worker） |
| [scripts/deploy-prepare.sh](scripts/deploy-prepare.sh) | 一键构建脚本 |
| [scripts/publishing-worker.mjs](scripts/publishing-worker.mjs) | 发布轮询 worker |
| [scripts/detection-worker.mjs](scripts/detection-worker.mjs) | 检测轮询 worker |
| [scripts/cognition-worker.mjs](scripts/cognition-worker.mjs) | 认知洞察轮询 worker |
| [scripts/question-simulation-worker.mjs](scripts/question-simulation-worker.mjs) | 用户问题模拟轮询 worker |
| [.env.example](.env.example) | 环境变量模板（复制为 `.env.production`） |
| [.gitignore](.gitignore) | 已排除 `deploy/`、`logs/`、`.env*` |
