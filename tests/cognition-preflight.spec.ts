import { expect, test } from "@playwright/test";
import { buildCognitionInput, preflightCognition } from "../src/lib/cognition";
import { createSeedData } from "../src/lib/seed";

test("认知预检只采用客观字段门槛", () => {
  const brand = createSeedData().brands[0];
  const ready = preflightCognition(buildCognitionInput(brand));
  expect(ready.ready).toBe(true);

  const insufficient = preflightCognition({
    brand: { name: "只有名称", industry: "制造业", industryCode: "C" },
    products: [],
    competitors: [],
  });
  expect(insufficient.ready).toBe(false);
  expect(insufficient.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(["brand.intro", "products"]));
});

test("认知预检允许跳过竞品，但阻止不完整产品和无效官网", () => {
  const brand = createSeedData().brands[0];
  const input = buildCognitionInput(brand);
  const result = preflightCognition({
    brand: { ...input.brand, website: "not-a-url" },
    products: [{ ...input.products[0], description: "", features: "", advantages: "", scenarios: "", problemsSolved: "" }],
    competitors: [],
  });
  expect(result.ready).toBe(false);
  expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
    "brand.website",
    "products.0.description",
    "products.0.base",
  ]));
});
