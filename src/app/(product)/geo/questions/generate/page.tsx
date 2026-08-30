import { Suspense } from "react";
import { QuestionGenerationView } from "@/views/question-generation-view";

export default function Page() {
  return <Suspense><QuestionGenerationView /></Suspense>;
}
