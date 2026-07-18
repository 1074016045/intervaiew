import { NextResponse } from "next/server";
import { TextInterviewService } from "@/features/text-interview/application/text-interview-service";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    return NextResponse.json(
      new TextInterviewService().perform(id, await request.json()),
    );
  } catch (error) {
    return apiErrorResponse(error, {
      route: "/api/interviews/[id]/actions",
      sessionId: id,
    });
  }
}
