// 检查 supabase/migrations/ 目录里的 migration 文件声明的数据库对象，
// 是否在 Supabase 线上库里真实存在。防止「代码已依赖某列、但 migration 没执行」的不一致。
//
// 用法（本地）：
//   npm run supabase:verify-migrations
// 或直接：
//   node --env-file-if-exists=.env.local scripts/verify-migration-state.mjs
//
// 原理：扫描所有 .sql migration，用正则提取
//   - create table public.X        → 检查表 X 是否存在
//   - alter table public.X ... add column Y   → 检查列 X.Y 是否存在
// 然后用 service role key 通过 supabase-js 逐个验证。
//   - 列不存在 → PostgreSQL 返回错误码 42703 (undefined_column)
// 退出码：0 全部一致；1 有缺失；2 环境变量缺失或运行出错。
//
// 测试：scripts/verify-migration-state.test.mjs（用 node:test，零依赖）

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// 从 migration 文件内容数组提取期望对象（纯函数，可测）。
// files: [{ name, content }]
// returns: [{ migration, type: "table"|"column", table, column? }]
export function extractExpectations(files) {
  const expectations = [];

  for (const { name, content } of files) {
    // create table [if not exists] public.X
    const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi;
    let m;
    while ((m = tableRe.exec(content)) !== null) {
      expectations.push({ migration: name, type: "table", table: m[1] });
    }

    // alter table public.X ... add column ... （整块到分号，块内可能有多列）
    const alterBlockRe = /alter\s+table\s+public\.(\w+)([\s\S]*?);/g;
    let am;
    while ((am = alterBlockRe.exec(content)) !== null) {
      const table = am[1];
      const block = am[2];
      const colRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi;
      let cm;
      while ((cm = colRe.exec(block)) !== null) {
        expectations.push({ migration: name, type: "column", table, column: cm[1] });
      }
    }
  }

  return expectations;
}

// 对期望对象去重：表按表名、列按 table.column。
// returns: { tables: string[], columns: [{ migration, table, column }] }
export function dedupeExpectations(expectations) {
  const tables = [...new Set(expectations.filter((e) => e.type === "table").map((e) => e.table))];
  const seenCol = new Set();
  const columns = [];
  for (const e of expectations.filter((e) => e.type === "column")) {
    const key = `${e.table}.${e.column}`;
    if (!seenCol.has(key)) {
      seenCol.add(key);
      columns.push({ migration: e.migration, table: e.table, column: e.column });
    }
  }
  return { tables, columns };
}

// 验证期望对象是否存在于数据库（可注入 client，便于测试）。
// client 需实现：from(table).select(column).limit(n) => Promise<{ data, error }>
//   表存在性检查用 select("*")；列检查用 select(column)。两者 error 不同。
// returns: { existingTables: Set, missing: [{ type, table, column?, migration?, skipped?, message? }] }
export async function verifyExpectations(tables, columns, client) {
  const existingTables = new Set();
  const missing = [];

  // 1. 检查表（select "*" 不引用具体列，只判断表能否访问）
  for (const table of tables) {
    const { error } = await client.from(table).select("*").limit(0);
    if (!error) {
      existingTables.add(table);
    } else {
      missing.push({ type: "table", table, message: error.message });
    }
  }

  // 2. 检查列（只在表存在时查；表缺失则标记跳过）
  for (const { migration, table, column } of columns) {
    if (!existingTables.has(table)) {
      missing.push({ type: "column", table, column, migration, skipped: true });
      continue;
    }
    const { error } = await client.from(table).select(column).limit(0);
    if (!error) {
      // 列存在
    } else if (error.code === "42703") {
      missing.push({ type: "column", table, column, migration });
    } else {
      missing.push({ type: "column", table, column, migration, message: error.message, unknown: true });
    }
  }

  return { existingTables, missing };
}

// --- 以下是主流程（直接运行时才执行；被 import 时不跑） ---

function createRealClient(url, secretKey) {
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!url || !secretKey) {
    console.error("❌ 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SECRET_KEY");
    console.error("   请确认 .env.local（或 .env.production）已配置");
    process.exit(2);
  }

  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  let fileNames;
  try {
    fileNames = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    console.error(`❌ 找不到 migrations 目录：${migrationsDir}`);
    process.exit(2);
  }

  const files = fileNames.map((name) => ({
    name,
    content: readFileSync(join(migrationsDir, name), "utf8"),
  }));

  const expectations = extractExpectations(files);
  const { tables, columns } = dedupeExpectations(expectations);
  const totalChecks = tables.length + columns.length;

  console.log("GEO Web Migration 状态检查");
  console.log("=".repeat(50));
  console.log(`扫描 ${fileNames.length} 个 migration 文件`);
  console.log(`提取期望：${tables.length} 张表，${columns.length} 个 alter-table 加的列`);
  console.log(`共 ${totalChecks} 项待检查\n`);

  const client = createRealClient(url, secretKey);
  const { existingTables, missing } = await verifyExpectations(tables, columns, client);

  // 打印逐项结果
  let step = 0;
  console.log("【表】");
  for (const table of tables) {
    step += 1;
    if (existingTables.has(table)) {
      console.log(`  [${step}/${totalChecks}] ✓ 表 ${table}`);
    } else {
      const m = missing.find((x) => x.type === "table" && x.table === table);
      console.log(`  [${step}/${totalChecks}] ✗ 表 ${table} — ${m?.message || "不存在"}`);
    }
  }

  console.log("\n【列】");
  for (const { migration, table, column } of columns) {
    step += 1;
    if (!existingTables.has(table)) {
      console.log(`  [${step}/${totalChecks}] ⊘ ${table}.${column} — 跳过（表不存在）`);
      continue;
    }
    const m = missing.find((x) => x.type === "column" && x.table === table && x.column === column);
    if (!m) {
      console.log(`  [${step}/${totalChecks}] ✓ ${table}.${column}`);
    } else if (m.unknown) {
      console.log(`  [${step}/${totalChecks}] ? ${table}.${column} — ${m.message}`);
    } else {
      console.log(`  [${step}/${totalChecks}] ✗ ${table}.${column} — 列不存在（来自 ${migration}）`);
    }
  }

  // 总结
  console.log("\n" + "=".repeat(50));
  if (missing.length === 0) {
    console.log(`✅ 全部通过（${totalChecks}/${totalChecks}）`);
    console.log("migration 状态一致，无需执行新 migration。");
    process.exit(0);
  }

  console.log(`❌ 发现 ${missing.length} 项缺失：`);
  for (const m of missing) {
    if (m.type === "table") {
      console.log(`  - 表 ${m.table} 不存在`);
    } else if (m.skipped) {
      console.log(`  - 列 ${m.table}.${m.column} 跳过（表 ${m.table} 不存在，来自 ${m.migration}）`);
    } else {
      console.log(`  - 列 ${m.table}.${m.column} 不存在（来自 ${m.migration}）`);
    }
  }

  const missingMigrations = [...new Set(missing.map((m) => m.migration).filter(Boolean))];
  if (missingMigrations.length > 0) {
    console.log("\n需执行的 migration 文件：");
    for (const f of missingMigrations) {
      console.log(`  - supabase/migrations/${f}`);
    }
    const ref = url.match(/^https:\/\/([^.]+)\.supabase\.co/)?.[1] || "<project-ref>";
    console.log("\n请在 Supabase Dashboard → SQL Editor 执行上述文件内容。");
    console.log(`地址：https://supabase.com/dashboard/project/${ref}/sql/new`);
  }

  process.exit(1);
}

// 只在直接运行时跑 main（被测试 import 时不跑）
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error("运行出错：", err);
    process.exit(2);
  });
}
