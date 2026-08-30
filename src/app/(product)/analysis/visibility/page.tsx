import { Suspense } from "react";
import { VisibilityRankingView } from "@/views/analysis-views";

export default function Page() {
  return <Suspense><VisibilityRankingView /></Suspense>;
}
