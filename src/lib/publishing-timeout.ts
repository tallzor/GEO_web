export const PUBLISH_TOTAL_TIMEOUT_MS = 10 * 60 * 1000;
export const PUBLISH_TOTAL_TIMEOUT_CODE = "PUBLISH_TOTAL_TIMEOUT";
export const PUBLISH_TOTAL_TIMEOUT_MESSAGE = "排队发布超过10分钟未完成，发布失败，请重新发布。";

export function hasPublishTimedOut(createdAt: unknown, now = Date.now()) {
  if (typeof createdAt !== "string" || !createdAt) return false;
  const createdAtMs = Date.parse(createdAt);
  return Number.isFinite(createdAtMs) && now - createdAtMs >= PUBLISH_TOTAL_TIMEOUT_MS;
}

export function canRetryPublishRecord(record: { status: string; errorCode?: string }) {
  return record.status === "failed" && record.errorCode !== PUBLISH_TOTAL_TIMEOUT_CODE;
}
