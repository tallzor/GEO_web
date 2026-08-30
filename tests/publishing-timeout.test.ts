import assert from "node:assert/strict";
import test from "node:test";
// Node 22 以类型擦除模式直接运行该测试；项目本身保持不允许业务代码导入 .ts 扩展名。
// @ts-expect-error -- allowImportingTsExtensions 仅对这个独立 Node 测试需要。
import { PUBLISH_TOTAL_TIMEOUT_CODE, PUBLISH_TOTAL_TIMEOUT_MS, canRetryPublishRecord, hasPublishTimedOut } from "../src/lib/publishing-timeout.ts";

test("发布总时长达到10分钟时判定超时", () => {
  const now = Date.parse("2026-08-23T10:10:00.000Z");
  assert.equal(hasPublishTimedOut("2026-08-23T10:00:00.000Z", now), true);
  assert.equal(hasPublishTimedOut(new Date(now - PUBLISH_TOTAL_TIMEOUT_MS + 1).toISOString(), now), false);
});

test("超时失败记录不可原记录重试", () => {
  assert.equal(canRetryPublishRecord({ status: "failed", errorCode: PUBLISH_TOTAL_TIMEOUT_CODE }), false);
  assert.equal(canRetryPublishRecord({ status: "failed", errorCode: "PUBLISH_FAILED" }), true);
  assert.equal(canRetryPublishRecord({ status: "queued" }), false);
});
