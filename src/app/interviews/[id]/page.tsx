import { InterviewDetail } from "@/features/interviews/components/interview-detail";
export default async function InterviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InterviewDetail id={id} />;
}
