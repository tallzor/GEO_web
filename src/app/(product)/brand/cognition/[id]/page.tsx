import { CognitionView } from "@/views/cognition-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CognitionView runId={id} />;
}
