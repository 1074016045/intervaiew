import { NextResponse } from "next/server";
import { createQuestionUnderstandingService } from "@/features/question-intelligence/infrastructure/question-understanding-service-factory";
import { assertSameOrigin } from "@/infrastructure/http/same-origin";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store", Pragma: "no-cache" };
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { assertSameOrigin(request); const result = await createQuestionUnderstandingService().analyze(id, await request.json(), request.signal); return NextResponse.json(result, { headers }); }
  catch (error) { const response = apiErrorResponse(error, { route: "/api/analysis-sessions/[id]/question-understanding/analyze", sessionId: id }); for (const [name, value] of Object.entries(headers)) response.headers.set(name, value); return response; }
}
