import { PublishProgressView } from "@/views/publishing-views";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublishProgressView batchId={id} />;
}
