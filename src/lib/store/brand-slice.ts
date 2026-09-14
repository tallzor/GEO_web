import type { SeedData } from "@/lib/seed";
import type { AppSliceCreator, BrandSlice, StoreDependencies } from "@/lib/store/contracts";
import type { Brand } from "@/lib/types";
import { createId, isoNow } from "@/lib/utils";

const questionContextFields: ReadonlyArray<keyof Brand> = [
  "name",
  "shortName",
  "characteristics",
  "categoryName",
  "trustProof",
  "positioningStatement",
  "industry",
  "intro",
  "serviceArea",
  "targetAudience",
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
        website: "",
        intro: input.intro || "",
        city: "",
        stores: [],
        serviceArea: input.serviceArea || "",
        targetAudience: input.targetAudience || "",
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
    addQuestion: (brandId, text, category) => set((state) => ({
      brands: state.brands.map((brand) => brand.id === brandId ? {
        ...brand,
        questions: [...brand.questions, {
          id: createId("question"),
          text,
          category,
          source: "custom",
          enabled: true,
          updatedAt: isoNow(),
        }],
      } : brand),
    })),
    updateQuestion: (brandId, questionId, patch) => set((state) => ({
      brands: state.brands.map((brand) => brand.id === brandId ? {
        ...brand,
        questions: brand.questions.map((item) => item.id === questionId
          ? { ...item, ...patch, updatedAt: isoNow() }
          : item),
      } : brand),
    })),
    deleteQuestion: (brandId, questionId) => set((state) => ({
      brands: state.brands.map((brand) => brand.id === brandId ? {
        ...brand,
        questions: brand.questions.filter((item) => item.id !== questionId),
      } : brand),
    })),
    addGeneratedQuestions: (brandId, questionTexts) => {
      const now = isoNow();
      const ids: string[] = [];
      set((state) => ({
        brands: state.brands.map((brand) => {
          if (brand.id !== brandId) return brand;
          const existing = new Set(brand.questions.map((item) => item.text.trim()));
          const additions = questionTexts.flatMap((text) => {
            const normalized = text.trim();
            if (!normalized || existing.has(normalized)) return [];
            existing.add(normalized);
            const id = createId("question");
            ids.push(id);
            return [{ id, text: normalized, source: "generated" as const, category: "", enabled: true, updatedAt: now }];
          });
          return {
            ...brand,
            questions: [...brand.questions, ...additions],
            questionsGeneratedAt: now,
            updatedAt: now,
          };
        }),
      }));
      return ids;
    },
    mergePersistedQuestions: (brandId, questions, generatedAt) => {
      const ids = questions.map((question) => question.id);
      dependencies.applyPersistedProjection(get().dataMode, () => {
        set((state) => ({
          brands: state.brands.map((brand) => {
            if (brand.id !== brandId) return brand;
            const incoming = new Map(questions.map((question) => [question.id, question]));
            const merged = brand.questions.map((question) => incoming.get(question.id) || question);
            const knownIds = new Set(brand.questions.map((question) => question.id));
            return {
              ...brand,
              questions: [...merged, ...questions.filter((question) => !knownIds.has(question.id))],
              questionsGeneratedAt: generatedAt,
              updatedAt: generatedAt,
            };
          }),
        }));
      });
      return ids;
    },
  });
}
