import { NextResponse } from "next/server";
import { InterviewService } from "@/features/interviews/application/interview-service";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    return NextResponse.json({
      interview: await new InterviewService().generateQuestions(id),
    });
  } catch (error) {
    return apiErrorResponse(error, {
      route: "/api/interviews/[id]/questions",
      sessionId: id,
    });
  }
}
