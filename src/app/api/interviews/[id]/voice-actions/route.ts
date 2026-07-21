import { NextResponse } from "next/server";
import { VoiceInterviewService } from "@/features/realtime/application/voice-interview-service";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    return NextResponse.json(
      new VoiceInterviewService().perform(id, await request.json()),
    );
  } catch (error) {
    return apiErrorResponse(error, {
      route: "/api/interviews/[id]/voice-actions",
      sessionId: id,
    });
  }
}
