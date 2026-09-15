import type { SeedData } from "@/lib/seed";
import type { AppSliceCreator, BrandSlice, StoreDependencies } from "@/lib/store/contracts";
import type { Brand } from "@/lib/types";
import { createId, isoNow } from "@/lib/utils";
import { QUESTION_LIBRARY_LIMIT, validateReviewedCandidates } from "@/lib/question-simulator";

const questionContextFields: ReadonlyArray<keyof Brand> = [
  "name",
  "shortName",
  "characteristics",
  "categoryName",
  "trustProof",
  "positioningStatement",
  "industry",
  "industryCode",
  "industryPath",
  "industryStandard",
  "intro",
  "serviceArea",
  "targetAudience",
  "coreScenarios",
  "valuePromise",
  "cognitionBoundary",
  "otherInfo",
];

export function createBrandSlice(
  initial: SeedData,
  dependencies: StoreDependencies,
): AppSliceCreator<BrandSlice> {
  return (set, get) => ({
    brands: initial.brands,
    currentBrandId: initial.brands[0]?.id || "",
    setCurrentBrand: (brandId) => set({ currentBrandId: brandId }),
    createBrand: (input) => {
      const id = createId("brand");
      const now = isoNow();
      const brand: Brand = {
        id,
        name: input.name,
        shortName: input.shortName || "",
        characteristics: input.characteristics || "",
        categoryName: input.categoryName || "",
        trustProof: input.trustProof || "",
        positioningStatement: input.positioningStatement || "",
        industry: input.industry || "",
        industryCode: input.industryCode || "",
        industryPath: input.industryPath || "",
        industryStandard: input.industryStandard || "",
        website: input.website || "",
        intro: input.intro || "",
        city: "",
        stores: [],
        serviceArea: input.serviceArea || "",
        targetAudience: input.targetAudience || "",
        coreScenarios: input.coreScenarios || "",
        valuePromise: input.valuePromise || "",
        cognitionBoundary: input.cognitionBoundary || "",
        otherInfo: input.otherInfo || "",
        products: (input.products || []).map((item) => ({ ...item, id: createId("product"), updatedAt: now })),
        competitors: (input.competitors || []).map((item) => ({ ...item, id: createId("competitor") })),
        knowledge: [],
        questions: [],
        questionContextUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      set((state) => ({ brands: [...state.brands, brand], currentBrandId: id }));
      return id;
    },
    removeBrand: (brandId, nextBrandId) => set((state) => {
      const brands = state.brands.filter((brand) => brand.id !== brandId);
      const preferredBrandId = nextBrandId && brands.some((brand) => brand.id === nextBrandId)
        ? nextBrandId
        : brands[0]?.id || "";
      return {
        brands,
        currentBrandId: state.currentBrandId === brandId ? preferredBrandId : state.currentBrandId,
        detections: state.detections.filter((detection) => detection.brandId !== brandId),
        cycles: state.cycles.filter((cycle) => cycle.brandId !== brandId),
        contents: state.contents.filter((content) => content.brandId !== brandId),
        publishBatches: state.publishBatches.filter((batch) => batch.brandId !== brandId),
        publishRecords: state.publishRecords.filter((record) => record.brandId !== brandId),
        platforms: state.platforms.filter((platform) => platform.brandId !== brandId),
        cognitionRuns: state.cognitionRuns.filter((run) => run.brandId !== brandId),
        questionSimulationRuns: state.questionSimulationRuns.filter((run) => run.brandId !== brandId),
      };
    }),
    updateBrand: (brandId, patch) => set((state) => {
      const now = isoNow();
      const contextChanged = questionContextFields.some((key) => key in patch);
      return {
        brands: state.brands.map((brand) => brand.id === brandId ? {
          ...brand,
          ...patch,
          updatedAt: now,
          questionContextUpdatedAt: contextChanged ? now : brand.questionContextUpdatedAt,
        } : brand),
      };
    }),
    addProduct: (brandId, product) => set((state) => ({
      brands: state.brands.map((brand) => brand.id === brandId ? {
        ...brand,
        products: [...brand.products, { ...product, id: createId("product"), updatedAt: isoNow() }],
        updatedAt: isoNow(),
      } : brand),
    })),
    updateProduct: (brandId, productId, patch) => set((state) => ({
      brands: state.brands.map((brand) => brand.id === brandId ? {
        ...brand,
        products: brand.products.map((product) => product.id === productId
          ? { ...product, ...patch, updatedAt: isoNow() }
          : product),
        updatedAt: isoNow(),
      } : brand),
    })),
    deleteProduct: (brandId, productId) => set((state) => ({
      brands: state.brands.map((brand) => brand.id === brandId ? {
        ...brand,
        products: brand.products.filter((item) => item.id !== productId),
        knowledge: brand.knowledge.map((item) => item.productId === productId ? { ...item, productId: undefined } : item),
        updatedAt: isoNow(),
      } : brand),
    })),
    addCompetitor: (brandId, competitor) => set((state) => ({
      brands: state.brands.map((brand) => brand.id === brandId ? {
        ...brand,
        competitors: [...brand.competitors, { ...competitor, id: createId("competitor") }],
        updatedAt: isoNow(),
        questionContextUpdatedAt: isoNow(),
      } : brand),
    })),
    updateCompetitor: (brandId, competitorId, patch) => set((state) => ({
      brands: state.brands.map((brand) => brand.id === brandId ? {
        ...brand,
        competitors: brand.competitors.map((item) => item.id === competitorId ? { ...item, ...patch } : item),
        updatedAt: isoNow(),
        questionContextUpdatedAt: isoNow(),
      } : brand),
    })),
    deleteCompetitor: (brandId, competitorId) => set((state) => ({
      brands: state.brands.map((brand) => brand.id === brandId ? {
        ...brand,
        competitors: brand.competitors.filter((item) => item.id !== competitorId),
        updatedAt: isoNow(),
        questionContextUpdatedAt: isoNow(),
      } : brand),
    })),
    addKnowledge: (brandId, attachment) => {
      const id = createId("knowledge");
      dependencies.applyPersistedProjection(get().dataMode, () => {
        set((state) => ({
          brands: state.brands.map((brand) => brand.id === brandId ? {
            ...brand,
            knowledge: [...brand.knowledge, { ...attachment, id, uploadedAt: isoNow() }],
            updatedAt: isoNow(),
          } : brand),
        }));
      });
      return id;
    },
    updateKnowledgeStatus: (brandId, attachmentId, status, error) => {
      dependencies.applyPersistedProjection(get().dataMode, () => {
        set((state) => ({
          brands: state.brands.map((brand) => brand.id === brandId ? {
            ...brand,
            knowledge: brand.knowledge.map((item) => item.id === attachmentId ? { ...item, status, error } : item),
            updatedAt: isoNow(),
          } : brand),
        }));
      });
    },
    deleteKnowledge: (brandId, attachmentId) => {
      dependencies.applyPersistedProjection(get().dataMode, () => {
        set((state) => ({
          brands: state.brands.map((brand) => brand.id === brandId ? {
            ...brand,
            knowledge: brand.knowledge.filter((item) => item.id !== attachmentId),
            updatedAt: isoNow(),
          } : brand),
        }));
      });
    },
    addQuestion: async (input) => {
      const state = get();
      const brand = state.brands.find((item) => item.id === input.brandId);
      if (!brand) throw new Error("品牌不存在");
      const [validated] = validateReviewedCandidates([input]);
      if (brand.questions.length >= QUESTION_LIBRARY_LIMIT) throw new Error("问题库已达240道上限，请先删除旧问题");
      const now = isoNow();
      const question = state.dataMode === "supabase"
        ? await dependencies.remote.addQuestion(input)
        : {
            id: createId("question"),
            text: validated.text,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            persona: validated.persona,
            decisionScenario: validated.decisionScenario,
            source: "manual" as const,
            enabled: true,
            createdAt: now,
            updatedAt: now,
          };
      dependencies.applyPersistedProjection(state.dataMode, () => set((current) => ({
        brands: current.brands.map((item) => item.id === input.brandId
          ? { ...item, questions: [question, ...item.questions] }
          : item),
      })));
      return question.id;
    },
    setQuestionEnabled: async (brandId, questionId, enabled) => {
      const state = get();
      const question = state.dataMode === "supabase"
        ? await dependencies.remote.setQuestionEnabled(questionId, enabled)
        : undefined;
      dependencies.applyPersistedProjection(state.dataMode, () => set((current) => ({
        brands: current.brands.map((brand) => brand.id === brandId ? {
          ...brand,
          questions: brand.questions.map((item) => item.id === questionId
            ? question || { ...item, enabled, updatedAt: isoNow() }
            : item),
        } : brand),
      })));
    },
    deleteQuestion: async (brandId, questionId) => {
      const state = get();
      if (state.dataMode === "supabase") await dependencies.remote.deleteQuestion(questionId);
      dependencies.applyPersistedProjection(state.dataMode, () => set((current) => ({
        brands: current.brands.map((brand) => brand.id === brandId ? {
          ...brand,
          questions: brand.questions.filter((item) => item.id !== questionId),
        } : brand),
      })));
    },
    mergeQuestionLibrary: (brandId, questions) => dependencies.applyPersistedProjection(get().dataMode, () => {
      set((state) => ({
        brands: state.brands.map((brand) => brand.id === brandId ? { ...brand, questions } : brand),
      }));
    }),
  });
}
