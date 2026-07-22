import { NextResponse } from "next/server";
import { createQuestionUnderstandingService } from "@/features/question-intelligence/infrastructure/question-understanding-service-factory";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store", Pragma: "no-cache" };
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { return NextResponse.json(createQuestionUnderstandingService().list(id), { headers }); }
  catch (error) { const response = apiErrorResponse(error, { route: "/api/analysis-sessions/[id]/question-understanding", sessionId: id }); for (const [name, value] of Object.entries(headers)) response.headers.set(name, value); return response; }
}
