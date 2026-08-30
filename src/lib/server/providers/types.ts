import type {
  CollectionMethod,
  ProviderErrorCategory,
  ProviderId,
} from "@/lib/types";

export type ProviderCollectionRequest = {
  question: string;
  enableWebSearch?: boolean;
  model?: string;
};

export type ProviderCitation = {
  title: string;
  url: string;
  excerpt?: string;
  providerType?: string;
};

export type ProviderCollectionResult = {
  provider: ProviderId;
  collectionMethod: CollectionMethod;
  collectedAt: string;
  requestId?: string;
  model: string;
  answer: string;
  citations: ProviderCitation[];
  searchQueries: string[];
  webSearchEnabled: boolean;
  webSearchUnavailableReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
};

export type ProviderAdapter = {
  id: ProviderId;
  collectionMethod: CollectionMethod;
  supportsWebSearch: boolean;
  collect: (request: ProviderCollectionRequest) => Promise<ProviderCollectionResult>;
};

export type ClassifiedProviderError = {
  message: string;
  status: number;
  code?: string;
  category: ProviderErrorCategory;
  retryable: boolean;
};
