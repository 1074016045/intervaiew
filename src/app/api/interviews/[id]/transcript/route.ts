import { NextResponse } from "next/server";
import { InterviewService } from "@/features/interviews/application/interview-service";
import { InterviewDomainError } from "@/features/interviews/domain/interview-errors";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const service = new InterviewService();
    if (!service.get(id))
      throw new InterviewDomainError(
        "INTERVIEW_NOT_FOUND",
        "The interview could not be found.",
      );
    return NextResponse.json({ transcript: service.transcript(id) });
  } catch (error) {
    return apiErrorResponse(error, {
      route: "/api/interviews/[id]/transcript",
      sessionId: id,
    });
  }
}
