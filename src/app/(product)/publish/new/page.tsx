import { PublishSelectionView } from "@/views/publishing-views";

export default async function Page({ searchParams }: { searchParams: Promise<{ contentId?: string }> }) {
  const { contentId = "" } = await searchParams;
  return <PublishSelectionView contentId={contentId} />;
}
