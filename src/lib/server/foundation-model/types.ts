import type { ProviderErrorCategory } from "@/lib/types";

export type FoundationTaskType =
  | "connectivity_test"
  | "detection_analysis"
  | "optimization_goal"
  | "seven_day_plan"
  | "content_generation"
  | "content_review"
  | "question_generation"
  | "question_simulation"
  | "brand_cognition"
  | "product_cognition";

export type FoundationModelRequest = {
  prompt: string;
  model?: string;
  enableWebSearch?: boolean;
};

export type FoundationModelResult = {
  provider: string;
  model: string;
  answer: string;
  requestId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
  sources?: Array<{ title: string; url: string }>;
  webSearchUsed?: boolean;
};

export type FoundationModelAdapter = {
  id: string;
  isReady: () => {
    ready: boolean;
    message?: string;
    model: string;
  };
  generate: (request: FoundationModelRequest) => Promise<FoundationModelResult>;
};

export class FoundationModelError extends Error {
  readonly status: number;
  readonly category: ProviderErrorCategory;
  readonly retryable: boolean;
  readonly code?: string;

  constructor(
    message: string,
    status: number,
    category: ProviderErrorCategory,
    retryable: boolean,
    code?: string,
  ) {
    super(message);
    this.name = "FoundationModelError";
    this.status = status;
    this.category = category;
    this.retryable = retryable;
    this.code = code;
  }
}
