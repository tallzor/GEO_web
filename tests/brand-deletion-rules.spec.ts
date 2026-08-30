import { expect, test } from "@playwright/test";
import {
  BRAND_NAME_MISMATCH_MESSAGE,
  getBrandDeletionBlockMessage,
  isExactBrandName,
  type BrandProcessCounts,
} from "../src/lib/brand-deletion";

const emptyCounts = (): BrandProcessCounts => ({
  optimizationCycles: 0,
  detections: 0,
  publishBatches: 0,
  publishRecords: 0,
  backgroundJobs: 0,
});

test.describe("品牌删除规则", () => {
  test("必须逐字输入完整品牌名称", () => {
    expect(isExactBrandName("跃动健身", "跃动健身")).toBe(true);
    expect(isExactBrandName(" 跃动健身", "跃动健身")).toBe(false);
    expect(isExactBrandName("跃动", "跃动健身")).toBe(false);
    expect(BRAND_NAME_MISMATCH_MESSAGE).toBe("名称输入错误，不可删除");
  });

  test("正在进行的优化任务优先阻止删除", () => {
    expect(getBrandDeletionBlockMessage({
      ...emptyCounts(),
      optimizationCycles: 1,
      detections: 1,
    })).toContain("请先终止任务");
  });

  test("检测分析、内容发布和后台任务均会阻止删除", () => {
    expect(getBrandDeletionBlockMessage({ ...emptyCounts(), detections: 1 })).toContain("检测或分析");
    expect(getBrandDeletionBlockMessage({ ...emptyCounts(), publishRecords: 1 })).toContain("内容发布");
    expect(getBrandDeletionBlockMessage({ ...emptyCounts(), backgroundJobs: 1 })).toContain("后台任务");
  });

  test("没有活动流程时允许删除", () => {
    expect(getBrandDeletionBlockMessage(emptyCounts())).toBe("");
  });
});
