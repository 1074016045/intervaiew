import { PrepareInterview } from "@/features/interviews/components/prepare-interview";
export default async function PreparePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PrepareInterview id={id} />;
}
