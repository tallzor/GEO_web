import { expect, test } from "@playwright/test";

async function driveDetectionWorker(page: import("@playwright/test").Page, maxSteps = 12) {
  for (let step = 0; step < maxSteps; step += 1) {
    const response = await page.request.post("/api/detections/worker/run", {
      headers: { authorization: "Bearer e2e-detection-worker-token" },
    });
    expect(response.ok()).toBeTruthy();
    const payload = await response.json() as { processed?: boolean };
    if (!payload.processed) return;
  }
  throw new Error(`检测 Worker 在 ${maxSteps} 步内仍未清空任务队列`);
}

async function markSeedDetectionsAsVerified(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    const raw = localStorage.getItem("geo-web-demo-v3");
    if (!raw) return;
    const persisted = JSON.parse(raw);
    const detections = persisted.state?.detections;
    if (!Array.isArray(detections)) return;
    for (const detection of detections) {
      if (!detection.diagnosis || !Array.isArray(detection.results)) continue;
      detection.dataSource = "live_api";
      detection.analysisModel = "deepseek-v4-flash-ga-260731";
      detection.diagnosis.analysisModel = "deepseek-v4-flash-ga-260731";
      detection.results = detection.results.map((result: { provider: string }, index: number) => ({
        ...result,
        dataSource: "live_api",
        model: result.provider === "deepseek"
          ? "deepseek-v4-flash-260425"
          : result.provider === "yuanbao"
            ? "hy3"
            : "doubao-seed-2-0-lite-260428",
        requestId: `verified-${detection.id}-${index + 1}`,
        analysisModel: "deepseek-v4-flash-ga-260731",
      }));
    }
    localStorage.setItem("geo-web-demo-v3", JSON.stringify(persisted));
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/dev/doubao/questions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        questions: Array.from({ length: 15 }, (_, index) => `测试品牌的真实用户检测问题${index + 1}是什么？`),
        model: "doubao-seed-2-0-lite-260428",
        latencyMs: 900,
      }),
    });
  });
  await page.route("**/api/dev/providers/collect", async (route) => {
    const requestBody = route.request().postDataJSON() as { question?: string; provider?: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: requestBody.provider || "doubao",
        collectionMethod: "model_api",
        collectedAt: "2026-07-30T10:00:00.000Z",
        requestId: "test-request",
        model: "doubao-seed-2-0-lite-260428",
        answer: `这是豆包针对“${requestBody.question || "检测问题"}”的真实接口回答示例，回答中提及跃动健身。`,
        citations: [],
        searchQueries: [],
        usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
        latencyMs: 1200,
      }),
    });
  });
  await page.route("**/api/dev/detection-analysis", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      responses?: { resultId: string }[];
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        analysisModel: "doubao-seed-2-0-lite-260428",
        analyses: (requestBody.responses || []).map((item) => ({
          resultId: item.resultId,
          brandMentioned: true,
          mentionCount: 1,
          firstMentionIndex: 35,
          competitorMentions: [],
          mentionEvidence: "回答中提及跃动健身",
          recommended: true,
          recommendationType: "recommended",
          recommendationPosition: "明确推荐",
          recommendationEvidence: "回答中提及跃动健身",
          sentimentLabel: "积极",
          sentimentScore: 78,
          sentimentEvidence: "真实接口回答示例",
          accuracy: "准确",
          accuracyScore: 82,
          accuracyEvidence: "回答中提及跃动健身",
          analysisConclusion: "回答明确提及并正向推荐跃动健身。",
          factClaims: ["提及跃动健身"],
          analysisModel: "doubao-seed-2-0-lite-260428",
        })),
        diagnosis: {
          scores: { visibility: 100, ranking: 100, reputation: 100, sentiment: 78 },
          scoreAvailability: { visibility: true, ranking: true, reputation: true, sentiment: true },
          analysisModel: "doubao-seed-2-0-lite-260428",
          summary: "本次回答已提及并推荐品牌，四维分析已完成。",
          issues: [{
            id: "issue_visibility_1",
            title: "品牌能见仍有提升空间",
            severity: "low",
            dimension: "visibility",
            evidence: "1/1条回答提及品牌，其中1/1条形成推荐。",
          }],
          suggestions: [{
            id: "suggestion_visibility_1",
            title: "建立“本地健身入门服务”清晰认知",
            description: "围绕新手体验、课程选择和服务流程，持续补充可验证的品牌内容。",
            reason: "品牌定位聚焦本地健身入门服务，但相关回答中的品牌识别信息仍不充分。",
            dimension: "visibility",
            generatedBy: "foundation_model",
            generationModel: "doubao-seed-2-0-lite-260428",
            promptVersion: "optimization-goal-v3-positioning-light",
          }],
        },
      }),
    });
  });
  await page.goto("/login");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: /进入工作台/ }).click();
  await expect(page).toHaveURL(/workbench/);
});

test("旧演示发布数据升级时清除无效记录和平台状态", async ({ page }) => {
  await page.evaluate(() => {
    const key = "geo-web-demo-v3";
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error("演示数据尚未写入");
    const persisted = JSON.parse(raw);
    persisted.version = 3;
    persisted.state.publishBatches = [{ id: "stale-batch" }];
    persisted.state.publishRecords = [{
      id: "stale-record",
      cycleId: "missing-cycle",
      taskId: "missing-task",
      contentId: "missing-content",
    }];
    persisted.state.platforms = [{ channel: "wechat", configured: true }];
    localStorage.setItem(key, JSON.stringify(persisted));
  });

  await page.reload();
  await page.waitForLoadState("networkidle");
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("geo-web-demo-v3") || "{}"));

  expect(migrated.version).toBe(4);
  expect(migrated.state.publishBatches).toEqual([]);
  expect(migrated.state.publishRecords).toEqual([]);
  expect(migrated.state.platforms).toEqual([]);
});

test("核心流程：档案、AI平台真实回答、内容和发布记录", async ({ page }, testInfo) => {
  let detectionCreateRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/detections") && request.method() === "POST") detectionCreateRequests += 1;
  });

  await expect(page.getByRole("heading", { name: "跃动健身", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "分析", exact: true })).toBeVisible();

  await page.goto("/brand");
  await expect(page).toHaveURL(/brand\/basic/);
  await expect(page.getByRole("heading", { name: "跃动健身", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "基本信息" })).toBeVisible();

  await page.goto("/geo/new");
  await page.getByRole("button", { name: /下一步/ }).click();
  await expect(page.getByRole("button", { name: /混元（腾讯元宝）/ })).toBeEnabled();
  await page.getByRole("button", { name: /DeepSeek/ }).click();
  await page.getByRole("button", { name: /豆包/ }).click();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /开始检测/ }).click();
  await expect(page).toHaveURL(/geo\/(progress|results)/);
  await driveDetectionWorker(page);
  await expect(page).toHaveURL(/geo\/results/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "检测结果明细" })).toBeVisible();
  await expect(page.getByText(/可以优先了解跃动健身/).first()).toBeVisible();
  await expect(page.getByLabel("AI平台")).toContainText("DeepSeek");
  await expect(page.getByText("问题与原始回答（1）")).toBeVisible();
  await expect(page.getByText("品牌出现次数")).toBeVisible();
  expect(detectionCreateRequests).toBe(1);
  await expect(page.getByText(/两次原始回答|2次回答/)).toHaveCount(0);

  const persistedResultPath = new URL(page.url()).pathname;
  await page.evaluate(() => localStorage.clear());
  await page.goto("/login");
  await page.getByRole("button", { name: /进入工作台/ }).click();
  await page.goto(persistedResultPath);
  await expect(page.getByRole("heading", { name: "检测结果明细" })).toBeVisible();
  await expect(page.getByText(/可以优先了解跃动健身/).first()).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByText("7天优化任务表")).toBeVisible();

  if (testInfo.project.name === "desktop") {
    const contentLink = page.getByRole("link", { name: /继续处理/ }).first();
    if (await contentLink.isVisible()) {
      await contentLink.click();
      await expect(page.getByRole("heading", { name: "内容生成与编辑" })).toBeVisible();
      await page.getByRole("button", { name: /运行风险检查/ }).click();
      await expect(page.getByText(/未发现违禁词|敏感表达|阻止/).first()).toBeVisible();
      const publishButton = page.getByRole("button", { name: /检查并发布/ });
      if (await publishButton.isEnabled()) {
        await publishButton.click();
        await page.getByRole("button", { name: "确认并发布" }).click();
        await expect(page).toHaveURL(/publishes/);
        await expect(page.getByRole("cell", { name: "发布成功" }).first()).toBeVisible();
      }
    }
  }
});

test("检测接口兼容旧品牌档案缺失的选填字段", async ({ page }) => {
  const id = `legacy_detection_${Date.now()}`;
  const response = await page.request.post("/api/detections", {
    data: {
      id,
      providers: ["deepseek"],
      brand: {
        id: "legacy_brand",
        name: "旧品牌档案",
        products: [{ id: "legacy_product", name: "体验产品" }],
        competitors: [{ id: "legacy_competitor", name: "竞品名称" }],
      },
      questions: [{ id: "legacy_question", text: "旧品牌档案能否正常开始检测？" }],
    },
  });

  expect(response.status()).toBe(202);
  const payload = await response.json() as { detection?: { id?: string } };
  expect(payload.detection?.id).toBe(id);
});

test("工作台：品牌摘要、合并进度和七日任务切换", async ({ page }, testInfo) => {
  const brandCard = page.locator(".workbench-brand-card");
  await expect(brandCard.getByText("产品数量 2", { exact: true })).toBeVisible();
  await expect(brandCard.getByText("健身", { exact: true })).toBeVisible();
  await expect(brandCard.getByText("上海浦东新区", { exact: true })).toBeVisible();
  await expect(brandCard.getByLabel("档案完整度 100%")).toBeVisible();
  await expect(page.getByRole("link", { name: "编辑品牌信息" })).toHaveAttribute("href", "/brand/basic");
  await expect(page.getByRole("heading", { name: "当前优化目标" })).toBeVisible();
  const analysisSummary = page.locator(".workbench-diagnosis-grid");
  await expect(page.getByRole("heading", { name: "最近一次检测分析摘要" })).toBeVisible();
  await expect(analysisSummary.getByText("能见", { exact: true })).toBeVisible();
  await expect(analysisSummary.getByText("排名", { exact: true })).toBeVisible();
  await expect(analysisSummary.getByText("口碑", { exact: true })).toBeVisible();
  await expect(analysisSummary.getByText("情感", { exact: true })).toBeVisible();
  await expect(analysisSummary.getByText("准确度", { exact: true })).toHaveCount(0);
  await expect(analysisSummary.getByText("信源可信度", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "品牌营销分析雷达图" })).toBeVisible();
  await expect(page.locator(".workbench-goal-title-line")).toContainText("提升跃动健身在本地服务问题中的能见");
  await expect(page.locator(".workbench-goal-title-line")).toContainText("进行中");

  const calendar = page.getByRole("group", { name: "7天任务日期" });
  await expect(calendar.getByRole("button")).toHaveCount(7);
  await expect(page.getByText("今天要做")).toBeVisible();
  await calendar.getByRole("button").nth(3).click();
  await expect(page.getByText("7月21日的任务")).toBeVisible();

  await expect(page.getByRole("heading", { name: "最近内容" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "最近动态" })).toHaveCount(0);

  if (testInfo.project.name === "desktop") {
    const [leftBox, taskBox] = await Promise.all([
      page.locator(".workbench-main-grid > .stack").boundingBox(),
      page.locator(".workbench-week-card").boundingBox(),
    ]);
    expect(leftBox).not.toBeNull();
    expect(taskBox).not.toBeNull();
    expect(Math.abs((leftBox!.y + leftBox!.height) - (taskBox!.y + taskBox!.height))).toBeLessThanOrEqual(2);
  }
});

test("品牌隔离：新建品牌后工作空间切换", async ({ page }) => {
  await page.goto("/brands/new");
  await page.getByLabel("品牌名称").fill("测试健身馆");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/workbench/);
  await expect(page.getByRole("heading", { name: "测试健身馆", exact: true })).toBeVisible();
  await expect(page.locator(".workbench-brand-card").getByText("产品数量 0", { exact: true })).toBeVisible();
  await page.goto("/brand/basic");
  await expect(page.getByRole("heading", { name: "测试健身馆" })).toBeVisible();
  const primaryEditButton = page.getByRole("button", { name: "编辑" });
  await expect(primaryEditButton).toHaveClass(/btn-primary/);
  await primaryEditButton.click();
  await expect(page.getByLabel("品牌名称")).toHaveValue("测试健身馆");
  await page.goto("/geo");
  await expect(page.getByText("尚未进行检测")).toBeVisible();
});

test("新建品牌：三步向导可跳过并保存产品与竞品", async ({ page }) => {
  await page.goto("/brands/new");
  await expect(page.getByRole("heading", { name: "基本信息" })).toBeVisible();
  await page.getByLabel("品牌名称").fill("三步健身馆");
  await page.getByLabel("所属行业").selectOption({ label: "健身" });
  await page.getByLabel("服务市场").fill("上海徐汇区");
  await page.getByRole("button", { name: "下一步", exact: true }).click();

  await expect(page.getByRole("heading", { name: "产品信息" })).toBeVisible();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByRole("heading", { name: "竞品信息" })).toBeVisible();
  await page.getByRole("button", { name: "上一步", exact: true }).click();

  await page.getByRole("button", { name: "新增产品", exact: true }).click();
  await page.getByLabel("产品名称").fill("零基础体验课");
  await page.getByLabel("产品简介").fill("面向健身新手的一次体验课程");
  await page.getByLabel("价格说明").fill("99元/次");
  await page.getByRole("button", { name: "下一步", exact: true }).click();

  await page.getByRole("button", { name: "新增竞品", exact: true }).click();
  await page.getByLabel("竞品名称").fill("对比健身馆");
  await page.getByLabel("竞品描述").fill("徐汇区综合健身房");
  await page.getByRole("button", { name: "完成", exact: true }).click();

  await expect(page).toHaveURL(/workbench/);
  await expect(page.getByRole("heading", { name: "三步健身馆", exact: true })).toBeVisible();
  await expect(page.locator(".workbench-brand-card").getByText("产品数量 1", { exact: true })).toBeVisible();

  await page.goto("/brand/products");
  await expect(page.getByRole("heading", { name: "零基础体验课", exact: true })).toBeVisible();
  await page.goto("/brand/competitors");
  await expect(page.getByRole("heading", { name: "对比健身馆", exact: true })).toBeVisible();
});

test("品牌档案：固定品牌标题、只读编辑和三类名称搜索", async ({ page }, testInfo) => {
  await page.goto("/brand");
  await expect(page).toHaveURL(/brand\/basic/);
  await expect(page.getByRole("heading", { name: "跃动健身", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "档案概览" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "新建品牌" })).toHaveCount(0);
  await expect(page.getByLabel("品牌名称")).toHaveCount(0);

  await page.getByRole("button", { name: "编辑" }).click();
  await expect(page.getByLabel("品牌名称")).toHaveValue("跃动健身");
  const editCard = page.locator(".brand-edit-card");
  await expect(editCard.locator(".card-header").getByText("仅品牌名称必填；其他资料越完整，系统生成的问题越贴合。")).toBeVisible();
  await expect(editCard.locator(".card-body .notice")).toHaveCount(0);
  await expect(editCard.locator(".card-header").getByRole("button", { name: "取消" })).toBeVisible();
  await expect(editCard.locator(".card-header").getByRole("button", { name: "保存信息" })).toBeVisible();
  await expect(editCard.locator(".field-hint")).toHaveCount(0);
  await expect(editCard.locator(".required")).toHaveText("*");
  await expect(editCard.locator(".required")).toHaveCSS("color", "rgb(240, 68, 56)");
  await page.getByLabel("品牌名称").fill("未保存的品牌名");
  await page.getByRole("link", { name: "产品与服务" }).click();
  await expect(page.getByRole("heading", { name: "是否保存已编辑内容？" })).toBeVisible();
  await page.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(/brand\/basic/);
  await expect(page.getByLabel("品牌名称")).toHaveValue("未保存的品牌名");
  await page.getByRole("link", { name: "产品与服务" }).click();
  await page.getByRole("button", { name: "不保存并切换" }).click();
  await expect(page).toHaveURL(/brand\/products/);
  await expect(page.getByRole("heading", { name: "跃动健身", exact: true })).toBeVisible();
  const productHeader = page.locator(".brand-list-card .card-header");
  await expect(productHeader.getByRole("heading", { name: "产品与服务（2）" })).toBeVisible();
  await expect(productHeader.getByLabel("搜索产品或服务名称")).toBeVisible();
  await expect(productHeader.getByRole("button", { name: "新增产品", exact: true })).toBeVisible();
  if (testInfo.project.name === "desktop") {
    const [titleBox, searchBox, buttonBox] = await Promise.all([
      productHeader.getByRole("heading", { name: "产品与服务（2）" }).boundingBox(),
      productHeader.getByLabel("搜索产品或服务名称").boundingBox(),
      productHeader.getByRole("button", { name: "新增产品", exact: true }).boundingBox(),
    ]);
    expect(titleBox).not.toBeNull();
    expect(searchBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(Math.abs((titleBox!.y + titleBox!.height / 2) - (searchBox!.y + searchBox!.height / 2))).toBeLessThanOrEqual(3);
    expect(searchBox!.x).toBeGreaterThan(titleBox!.x);
    expect(buttonBox!.x).toBeGreaterThan(searchBox!.x);
  }
  await page.getByLabel("搜索产品或服务名称").fill("新手");
  await expect(page.getByRole("heading", { name: "新手体验课" })).toBeVisible();
  await expect(page.locator(".brand-record-row")).toHaveCount(1);

  await page.goto("/brand/competitors");
  await expect(page.getByRole("heading", { name: "跃动健身" })).toBeVisible();
  const competitorHeader = page.locator(".brand-list-card .card-header");
  await expect(competitorHeader.getByRole("heading", { name: "竞品信息（2）" })).toBeVisible();
  await expect(competitorHeader.getByLabel("搜索竞品名称")).toBeVisible();
  await expect(competitorHeader.getByRole("button", { name: "新增竞品" })).toBeVisible();
  await expect(page.getByRole("link", { name: "前往检测问题库" })).toHaveCount(0);
  await page.getByLabel("搜索竞品名称").fill("燃点");
  await expect(page.getByRole("heading", { name: "燃点健身" })).toBeVisible();
  await expect(page.locator(".brand-record-row")).toHaveCount(1);

  await page.goto("/brand/knowledge");
  await expect(page.getByRole("heading", { name: "跃动健身", exact: true })).toBeVisible();
  const knowledgeHeader = page.locator(".brand-list-card .card-header");
  await expect(knowledgeHeader.getByRole("heading", { name: "知识附件（1）" })).toBeVisible();
  await expect(knowledgeHeader.getByLabel("搜索附件名称")).toBeVisible();
  await expect(knowledgeHeader.getByRole("button", { name: "上传附件" })).toBeVisible();
  await page.getByLabel("搜索附件名称").fill("课程资料");
  await expect(page.getByRole("heading", { name: "跃动健身品牌与课程资料.pdf" })).toBeVisible();
  await expect(page.locator(".brand-record-row")).toHaveCount(1);

  await page.goto("/brand/basic");
  await page.getByRole("button", { name: "编辑" }).click();
  await page.getByLabel("品牌名称").fill("跃动健身升级版");
  await page.getByRole("link", { name: "产品与服务" }).click();
  await page.getByRole("button", { name: "保存并切换", exact: true }).click();
  await expect(page).toHaveURL(/brand\/products/);
  await expect(page.getByRole("heading", { name: "跃动健身升级版", exact: true })).toBeVisible();
});

test("任务终止后可重新选择目标并生成新周期", async ({ page }) => {
  await markSeedDetectionsAsVerified(page);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "终止任务" }).click();
  await page.getByRole("button", { name: "确认终止任务" }).click({ force: true });
  await expect(page.getByText("上一轮任务已终止")).toBeVisible();
  await page.goto("/analysis/visibility?detection=detection_latest");
  await page.getByRole("button", { name: "选择目标" }).first().click();
  await page.getByRole("button", { name: "确认并创建7天任务" }).click({ force: true });
  await expect(page).toHaveURL(/tasks/);
  await expect(page.getByText("7天优化任务表")).toBeVisible();
  await expect(page.getByRole("heading", { name: "提升跃动健身在本地服务问题中的能见" })).toBeVisible();
});

test("返回操作统一位于标题左侧并回到上一页", async ({ page }) => {
  await page.goto("/geo/records");
  await page.goto("/geo/results/detection_latest");
  const backButton = page.getByRole("button", { name: "返回上一页" });
  await expect(backButton).toBeVisible();
  await expect(page.getByRole("link", { name: /返回诊断报告/ })).toHaveCount(0);
  await backButton.click();
  await expect(page).toHaveURL(/geo\/records/);
});

test("分析模块不会展示演示或测试模型生成的数据", async ({ page }) => {
  await page.goto("/analysis/visibility");
  await expect(page.getByText("暂无可分析的检测")).toBeVisible();
  await expect(page.getByRole("region", { name: "分析总览" })).toHaveCount(0);
});

test("检测与分析：模块拆分、单批次切换和无历史对比入口", async ({ page }, testInfo) => {
  await markSeedDetectionsAsVerified(page);
  await page.goto("/geo");
  const primaryNav = page.locator(testInfo.project.name === "mobile" ? ".mobile-nav" : ".sidebar");
  await expect(primaryNav.getByRole("link", { name: "检测", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "分析", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "累计检测次数" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "近30天检测频率" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "检测平台分布" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近一次各平台品牌提及占比" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近一次检测分析摘要" })).toBeVisible();
  await expect(page.getByRole("link", { name: /历史对比/ })).toHaveCount(0);

  await page.goto("/geo/records");
  await expect(page.getByRole("columnheader", { name: "有效回答" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "状态", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  await page.goto("/analysis/visibility");
  await expect(page.getByRole("heading", { name: "能见&排名" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "分析总览" })).toBeVisible();
  await expect(page.getByText("查看当前检测中品牌的引用来源、提及率和推荐排名。")).toBeVisible();
  await expect(page.getByRole("link", { name: "口碑分析" })).toBeVisible();
  await expect(page.getByRole("link", { name: "竞品透视" })).toBeVisible();
  await expect(page.getByLabel("检测时间")).toBeVisible();
  await expect(page.getByText(/较上次|变化趋势|历史对比/)).toHaveCount(0);
  await page.getByRole("button", { name: "排名", exact: true }).click();
  await expect(page.getByText("品牌提及率")).toBeVisible();
  await expect(page.getByText("首位推荐率")).toBeVisible();

  await page.goto("/analysis/reputation");
  await expect(page.getByRole("heading", { name: "情感倾向分布" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "评价主题与原文依据" })).toBeVisible();

  await page.goto("/analysis/competitors");
  await expect(page.getByRole("heading", { name: "竞品品牌提及 Top 20" })).toBeVisible();
  await expect(page.getByText("当前批次识别结果")).toBeVisible();
});

test("发布平台展示公众号草稿箱能力和安全配置要求", async ({ page }) => {
  await page.goto("/settings/platforms");
  await expect(page.getByRole("heading", { name: "发布平台配置" })).toBeVisible();
  await expect(page.getByText("可信商家页")).toHaveCount(0);
  const wechatCard = page.locator(".card").filter({ has: page.getByRole("heading", { name: "微信公众号" }) });
  await expect(wechatCard.getByText("通过官方接口存入公众号草稿箱")).toBeVisible();
  await expect(wechatCard.getByText("未配置", { exact: true })).toBeVisible();
  await wechatCard.getByRole("button", { name: "连接账号" }).click();
  await expect(page.getByRole("heading", { name: "连接微信公众号" })).toBeVisible();
  await expect(page.getByText(/服务器固定出口IP/)).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator('input[type="password"]')).toBeVisible();
  await expect(dialog.getByText(/默认封面/).first()).toBeVisible();
  await page.getByRole("button", { name: "验证并保存" }).click();
  await expect(page.getByText("请完整填写公众号名称、AppID和AppSecret")).toBeVisible();
});

test("问答素材支持复制且复制后不会自动完成任务", async ({ page }) => {
  await page.goto("/tasks");
  const copyTask = page.locator("article").filter({ hasText: "常见问答素材已准备好" });
  await copyTask.getByRole("button", { name: "查看详情" }).click();
  await expect(page.getByText(/复制内容不会完成任务/)).toBeVisible();
  await page.getByRole("button", { name: "复制内容" }).click();
  await expect(page.getByText("内容已复制", { exact: true })).toBeVisible();
  await page.goto("/tasks");
  await expect(page.locator("article").filter({ hasText: "常见问答素材已准备好" })).not.toContainText("已完成");
});

test("全部页面可访问且无运行时错误页", async ({ page }) => {
  const routes = [
    "/workbench", "/brand", "/brand/basic", "/brand/products", "/brand/competitors", "/brand/knowledge",
    "/geo", "/geo/questions", "/geo/questions/generate", "/geo/new", "/geo/progress/detection_latest",
    "/geo/results/detection_latest", "/geo/records", "/analysis/visibility", "/analysis/reputation", "/analysis/competitors", "/tasks", "/content/content_current",
    "/publishes", "/settings/profile", "/settings/brands", "/settings/platforms", "/settings/subscription",
  ];
  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBeLessThan(400);
    await expect(page.locator("body"), route).not.toContainText("This page couldn’t load");
  }
});
