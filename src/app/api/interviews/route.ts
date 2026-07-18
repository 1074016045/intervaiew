import { NextRequest, NextResponse } from "next/server";
import { interviewStatusSchema } from "@/features/interviews/domain/interview.types";
import { InterviewService } from "@/features/interviews/application/interview-service";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const statusRaw = request.nextUrl.searchParams.get("status");
    const status = statusRaw
      ? interviewStatusSchema.parse(statusRaw)
      : undefined;
    const search =
      request.nextUrl.searchParams.get("search")?.trim() || undefined;
    return NextResponse.json({
      interviews: new InterviewService().list({ status, search }),
    });
  } catch (error) {
    return apiErrorResponse(error, { route: "/api/interviews" });
  }
}
export async function POST(request: NextRequest) {
  try {
    const interview = new InterviewService().create(await request.json());
    return NextResponse.json({ interview }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, { route: "/api/interviews" });
  }
}
