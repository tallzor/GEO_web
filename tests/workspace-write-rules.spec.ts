import { expect, test } from "@playwright/test";
import type { Brand, ContentItem, OptimizationCycle } from "../src/lib/types";
import { validateWorkspaceWriteSnapshot } from "../src/lib/server/workspace-write-rules";

const ids = {
  brand: "10000000-0000-4000-8000-000000000001",
  otherBrand: "10000000-0000-4000-8000-000000000002",
  detection: "20000000-0000-4000-8000-000000000001",
  suggestion: "30000000-0000-4000-8000-000000000001",
  cycle: "40000000-0000-4000-8000-000000000001",
  taskPrefix: "50000000-0000-4000-8000-00000000000",
  content: "60000000-0000-4000-8000-000000000001",
};

function brand(id = ids.brand): Brand {
  return {
    id,
    name: "测试品牌",
    shortName: "",
    characteristics: "",
    categoryName: "",
    trustProof: "",
    positioningStatement: "",
    industry: "",
    website: "",
    intro: "",
    city: "",
    stores: [],
    serviceArea: "",
    targetAudience: "",
    products: [],
    competitors: [],
    knowledge: [],
    questions: [],
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
  };
}

function cycle(): OptimizationCycle {
  return {
    id: ids.cycle,
    brandId: ids.brand,
    detectionId: ids.detection,
    suggestionId: ids.suggestion,
    dimension: "visibility",
    target: "完善品牌信息",
    description: "补充用户需要的事实信息",
    status: "active",
    currentDay: 1,
    startDate: "2026-09-04T00:00:00.000Z",
    endDate: "2026-09-10T00:00:00.000Z",
    tasks: Array.from({ length: 7 }, (_, index) => ({
      id: `${ids.taskPrefix}${index + 1}`,
      cycleId: ids.cycle,
      day: index + 1,
      title: `第${index + 1}天任务`,
      description: "生成一项品牌内容",
      type: "content" as const,
      delivery: "copy" as const,
      status: index === 0 ? "in_progress" as const : "pending" as const,
    })),
  };
}

function content(): ContentItem {
  return {
    id: ids.content,
    brandId: ids.brand,
    cycleId: ids.cycle,
    taskId: `${ids.taskPrefix}1`,
    title: "测试内容",
    body: "测试正文",
    selectedChannel: "wechat",
    channels: [],
    version: 1,
    status: "draft",
    riskStatus: "unchecked",
    riskIssues: [],
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
  };
}

test("合法的品牌、周期和内容关系可以通过写入校验", () => {
  expect(() => validateWorkspaceWriteSnapshot({
    brands: [brand()],
    currentBrandId: ids.brand,
    cycles: [cycle()],
    contents: [content()],
  }, ["brands", "currentBrand", "cycles", "contents"])).not.toThrow();
});

test("内容不能借用另一品牌的周期或任务", () => {
  expect(() => validateWorkspaceWriteSnapshot({
    brands: [brand(), brand(ids.otherBrand)],
    currentBrandId: ids.brand,
    cycles: [cycle()],
    contents: [{ ...content(), brandId: ids.otherBrand }],
  }, ["contents"])).toThrow("内容任务归属不正确");
});

test("品牌子数据ID不能在不同品牌间重复", () => {
  const childId = "70000000-0000-4000-8000-000000000001";
  const first = { ...brand(), competitors: [{ id: childId, name: "竞品A", description: "" }] };
  const second = { ...brand(ids.otherBrand), competitors: [{ id: childId, name: "竞品B", description: "" }] };
  expect(() => validateWorkspaceWriteSnapshot({
    brands: [first, second],
    currentBrandId: ids.brand,
    cycles: [],
    contents: [],
  }, ["brands"])).toThrow("品牌子数据ID不能重复");
});

test("当前品牌必须出现在工作区读取投影中", () => {
  expect(() => validateWorkspaceWriteSnapshot({
    brands: [brand()],
    currentBrandId: ids.otherBrand,
    cycles: [],
    contents: [],
  }, ["currentBrand"])).toThrow("当前品牌不属于本工作空间");
});
