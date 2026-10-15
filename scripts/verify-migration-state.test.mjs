// verify-migration-state.mjs 的单元测试。
// 用 Node 内置的 node:test，零依赖，无需安装任何测试框架。
// 运行：npm test  或  node --test scripts/verify-migration-state.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractExpectations,
  dedupeExpectations,
  verifyExpectations,
} from "./verify-migration-state.mjs";

// --- mock client 工厂 ---
// 真实 supabase-js 的调用链：from(table).select(column).limit(n) → Promise<{data, error}>
// 这里用一个 resolver 函数 (table, column, limit) => { data, error } 决定返回什么，
// 这样测试可以精确模拟「表不存在」「列不存在(42703)」「一切正常」等各种场景。
function makeMockClient(resolver) {
  return {
    from(table) {
      return {
        select(column) {
          return {
            limit(n) {
              return Promise.resolve(resolver(table, column, n));
            },
          };
        },
      };
    },
  };
}

// ============ extractExpectations ============

test("extractExpectations 提取 create table public.X", () => {
  const files = [{
    name: "001_core.sql",
    content: "create table public.profiles ( id uuid ); create table public.organizations ( id uuid );",
  }];
  const result = extractExpectations(files);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { migration: "001_core.sql", type: "table", table: "profiles" });
  assert.deepEqual(result[1], { migration: "001_core.sql", type: "table", table: "organizations" });
});

test("extractExpectations 提取 create table if not exists", () => {
  const files = [{ name: "a.sql", content: "create table if not exists public.brands ( id uuid );" }];
  const result = extractExpectations(files);
  assert.equal(result.length, 1);
  assert.equal(result[0].table, "brands");
});

test("extractExpectations 提取 alter table add column（多列、跨行）", () => {
  // 这个格式来自真实的 202608140001_brand_soft_delete_owner_guard.sql
  const files = [{
    name: "002_soft_delete.sql",
    content: `alter table public.brands
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;`,
  }];
  const result = extractExpectations(files);
  assert.equal(result.length, 2);
  assert.equal(result[0].type, "column");
  assert.equal(result[0].table, "brands");
  assert.equal(result[0].column, "deleted_at");
  assert.equal(result[1].column, "deleted_by");
  assert.equal(result[1].migration, "002_soft_delete.sql");
});

test("extractExpectations 提取不带 if not exists 的 add column", () => {
  const files = [{
    name: "a.sql",
    content: "alter table public.brands add column short_name text;",
  }];
  const result = extractExpectations(files);
  assert.equal(result.length, 1);
  assert.equal(result[0].column, "short_name");
});

test("extractExpectations 忽略非 public schema", () => {
  const files = [{
    name: "a.sql",
    content: "create table private.foo ( id int ); create table public.bar ( id int );",
  }];
  const result = extractExpectations(files);
  assert.equal(result.length, 1);
  assert.equal(result[0].table, "bar");
});

test("extractExpectations 忽略 alter table 的 add constraint（只取 add column）", () => {
  const files = [{
    name: "a.sql",
    content: "alter table public.brands add constraint foo_check check (x > 0);",
  }];
  const result = extractExpectations(files);
  assert.equal(result.length, 0);
});

// ============ dedupeExpectations ============

test("dedupeExpectations 表去重", () => {
  const expectations = [
    { migration: "a.sql", type: "table", table: "brands" },
    { migration: "b.sql", type: "table", table: "brands" },
  ];
  const { tables, columns } = dedupeExpectations(expectations);
  assert.deepEqual(tables, ["brands"]);
  assert.equal(columns.length, 0);
});

test("dedupeExpectations 列去重（保留首次出现的 migration）", () => {
  const expectations = [
    { migration: "a.sql", type: "column", table: "brands", column: "x" },
    { migration: "b.sql", type: "column", table: "brands", column: "x" },
  ];
  const { columns } = dedupeExpectations(expectations);
  assert.equal(columns.length, 1);
  assert.equal(columns[0].migration, "a.sql");
});

// ============ verifyExpectations ============

test("verifyExpectations 全部存在 → missing 为空", async () => {
  const tables = ["brands"];
  const columns = [{ migration: "a.sql", table: "brands", column: "deleted_at" }];
  const client = makeMockClient(() => ({ data: [], error: null }));
  const { existingTables, missing } = await verifyExpectations(tables, columns, client);
  assert.equal(missing.length, 0);
  assert.ok(existingTables.has("brands"));
});

test("verifyExpectations 列不存在（42703）→ missing 含该列 + migration 来源", async () => {
  // 模拟 brands 表存在（select "*" 无错），但 deleted_at 列返回 42703
  const tables = ["brands"];
  const columns = [{ migration: "202608140001.sql", table: "brands", column: "deleted_at" }];
  const client = makeMockClient((table, column) => {
    if (column === "*") return { data: [], error: null }; // 表存在
    return {
      data: null,
      error: { code: "42703", message: `column ${table}.${column} does not exist` },
    };
  });
  const { missing } = await verifyExpectations(tables, columns, client);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].type, "column");
  assert.equal(missing[0].column, "deleted_at");
  assert.equal(missing[0].migration, "202608140001.sql");
  assert.equal(missing[0].skipped, undefined);
});

test("verifyExpectations 表不存在 → missing 含表，列被标记 skipped", async () => {
  // 模拟表查询返回错误（PostgREST 对不存在的表返回 PGRST205 等）
  const tables = ["nonexistent_table"];
  const columns = [{ migration: "a.sql", table: "nonexistent_table", column: "foo" }];
  const client = makeMockClient(() => ({
    data: null,
    error: { code: "PGRST205", message: "Could not find the table" },
  }));
  const { missing, existingTables } = await verifyExpectations(tables, columns, client);
  assert.equal(existingTables.size, 0);
  // 表缺失 + 列因表缺失被跳过 = 2 条
  assert.equal(missing.length, 2);
  assert.equal(missing[0].type, "table");
  assert.equal(missing[0].table, "nonexistent_table");
  assert.equal(missing[1].type, "column");
  assert.equal(missing[1].skipped, true);
});

test("verifyExpectations 表存在但列缺失 → 只列在 missing，表不在", async () => {
  const tables = ["brands"];
  const columns = [{ migration: "a.sql", table: "brands", column: "missing_col" }];
  const client = makeMockClient((table, column) => {
    if (column === "*") return { data: [], error: null }; // 表存在
    return { data: null, error: { code: "42703", message: "column does not exist" } };
  });
  const { missing, existingTables } = await verifyExpectations(tables, columns, client);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].column, "missing_col");
  assert.ok(existingTables.has("brands"));
});

test("verifyExpectations 多列部分缺失 → 只标记缺失的列", async () => {
  const tables = ["brands"];
  const columns = [
    { migration: "a.sql", table: "brands", column: "exists_col" },
    { migration: "a.sql", table: "brands", column: "missing_col" },
    { migration: "a.sql", table: "brands", column: "another_exists" },
  ];
  const client = makeMockClient((table, column) => {
    if (column === "*") return { data: [], error: null };
    if (column === "missing_col") {
      return { data: null, error: { code: "42703", message: "column does not exist" } };
    }
    return { data: [], error: null };
  });
  const { missing } = await verifyExpectations(tables, columns, client);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].column, "missing_col");
});

test("verifyExpectations 非 42703 错误标记为 unknown", async () => {
  const tables = ["brands"];
  const columns = [{ migration: "a.sql", table: "brands", column: "x" }];
  const client = makeMockClient((table, column) => {
    if (column === "*") return { data: [], error: null };
    return { data: null, error: { code: "PGRST116", message: "permission denied" } };
  });
  const { missing } = await verifyExpectations(tables, columns, client);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].unknown, true);
  assert.equal(missing[0].message, "permission denied");
});

test("verifyExpectations 网络错误不会误报为表不存在", async () => {
  const tables = ["detections"];
  const columns = [{ migration: "a.sql", table: "detections", column: "result_summary" }];
  const client = makeMockClient(() => ({
    data: null,
    error: { message: "TypeError: fetch failed" },
  }));
  const { missing, existingTables } = await verifyExpectations(tables, columns, client);
  assert.equal(existingTables.size, 0);
  assert.equal(missing.length, 2);
  assert.equal(missing[0].unknown, true);
  assert.equal(missing[1].unknown, true);
  assert.equal(missing[1].skipped, true);
});

test("verifyExpectations 空输入 → 空 missing", async () => {
  const client = makeMockClient(() => ({ data: [], error: null }));
  const { missing, existingTables } = await verifyExpectations([], [], client);
  assert.equal(missing.length, 0);
  assert.equal(existingTables.size, 0);
});
