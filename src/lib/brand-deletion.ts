export const BRAND_NAME_MISMATCH_MESSAGE = "名称输入错误，不可删除";

export type BrandProcessCounts = {
  optimizationCycles: number;
  detections: number;
  publishBatches: number;
  publishRecords: number;
  backgroundJobs: number;
};

export function isExactBrandName(value: string, brandName: string) {
  return value === brandName;
}

export function getBrandDeletionBlockMessage(counts: BrandProcessCounts) {
  if (counts.optimizationCycles > 0) {
    return "该品牌有正在进行的优化任务，请先终止任务后再删除";
  }
  if (counts.detections > 0) {
    return "该品牌有正在进行的检测或分析，请等待流程结束后再删除";
  }
  if (counts.publishBatches > 0 || counts.publishRecords > 0) {
    return "该品牌有正在进行的内容发布，请等待发布结束后再删除";
  }
  if (counts.backgroundJobs > 0) {
    return "该品牌有正在处理的后台任务，请等待任务结束后再删除";
  }
  return "";
}
