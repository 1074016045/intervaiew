import { TextInterviewPanel } from "@/features/text-interview/components/text-interview-panel";
export default async function TextPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TextInterviewPanel id={id} />;
}
