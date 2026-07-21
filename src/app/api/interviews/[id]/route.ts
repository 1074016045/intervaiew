import { NextResponse } from "next/server";
import { InterviewService } from "@/features/interviews/application/interview-service";
import { InterviewDomainError } from "@/features/interviews/domain/interview-errors";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  try {
    const interview = new InterviewService().get(id);
    if (!interview)
      throw new InterviewDomainError(
        "INTERVIEW_NOT_FOUND",
        "The interview could not be found.",
      );
    return NextResponse.json({ interview });
  } catch (error) {
    return apiErrorResponse(error, {
      route: "/api/interviews/[id]",
      sessionId: id,
    });
  }
}
export async function DELETE(_: Request, context: Context) {
  const { id } = await context.params;
  try {
    if (!(await new InterviewService().delete(id)))
      throw new InterviewDomainError(
        "INTERVIEW_NOT_FOUND",
        "The interview could not be found.",
      );
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error, {
      route: "/api/interviews/[id]",
      sessionId: id,
    });
  }
}
