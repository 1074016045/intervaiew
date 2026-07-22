import { TranscriptLabPanel } from "@/features/question-intelligence/components/transcript-lab-panel";
import { getServerEnv } from "@/infrastructure/env/server-env";

export default async function TranscriptLabSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const fakeEnabled =
    process.env.NODE_ENV !== "production" &&
    getServerEnv().TRANSCRIPT_LAB_FAKE_ENABLED;
  return <TranscriptLabPanel id={id} fakeEnabled={fakeEnabled} />;
}
