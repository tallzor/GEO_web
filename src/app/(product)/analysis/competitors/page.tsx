import { Suspense } from "react";
import { CompetitorInsightView } from "@/views/analysis-views";

export default function Page() {
  return <Suspense><CompetitorInsightView /></Suspense>;
}
