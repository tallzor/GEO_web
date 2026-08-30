# Supabase 数据底座

本目录对应《P0数据服务架构与隔离规范》的数据库实现。默认仍使用本地演示模式；只有显式启用 Supabase 登录和数据后端时，页面才会切换到正式数据源。

## 迁移顺序

1. `202608010001_core_schema.sql`：核心表、组合外键、版本和唯一性约束。
2. `202608010002_rls.sql`：组织成员权限、RLS、浏览器与服务端写入边界。
3. `202608010003_storage.sql`：私有知识附件 bucket 和路径隔离策略。
4. `202608010004_detection_progress_constraint.sql`：统一检测成功、部分失败时的进度约束。

迁移文件必须按文件名顺序执行。可在 Supabase Dashboard 的 SQL Editor 中逐个执行；接入 Supabase CLI 后也可以使用官方 migration 命令执行。

## 环境变量

从 `.env.example` 复制以下变量到本地或部署平台，不要提交真实值：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
GEO_DATA_BACKEND=local
GEO_AUTH_MODE=demo
```

- Publishable Key 可供浏览器使用，但所有数据仍受 RLS 限制。
- Secret Key 只允许用于服务端邀请开通、系统任务和后台分析。
- 不要把 Secret Key 改成 `NEXT_PUBLIC_` 前缀。

建议先只把 `GEO_AUTH_MODE` 调整为 `supabase` 验证真实登录；完成数据库和隔离检查后，再同时设置 `GEO_DATA_BACKEND=supabase`。数据后端使用 Supabase 时，登录模式也必须使用 Supabase。

## 验证命令

```powershell
npm.cmd run supabase:verify
npm.cmd run supabase:verify-isolation
```

第一条检查表和私有 Storage；第二条需要两个不同组织的测试账号，具体变量和完整顺序见 `documents/Supabase上线与验证操作说明.md`。

## 数据隔离检查

正式启用前至少验证：

1. 组织 A 的用户无法读取组织 B 的品牌和业务数据。
2. `viewer` 无法修改品牌档案。
3. 普通成员无法伪造检测原始回答、分析、诊断和发布结果。
4. 发布账号的 `credentials_ciphertext` 不会返回给浏览器。
5. 知识附件路径不符合 `{organization_id}/{brand_id}/...` 时上传失败。
6. 同一品牌无法同时存在两个 `active` 优化周期。
7. 历史检测、诊断版本、目标快照、内容版本和发布快照不会被后续数据覆盖。
