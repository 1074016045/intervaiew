import { VoiceInterviewPanel } from "@/features/realtime/components/voice-interview-panel";

export default async function VoiceInterviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VoiceInterviewPanel id={id} />;
}
