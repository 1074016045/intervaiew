import { NextResponse } from "next/server";
import { createQuestionSegmentationService } from "@/features/question-intelligence/infrastructure/question-segmentation-service-factory";
import { assertSameOrigin } from "@/infrastructure/http/same-origin";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store", Pragma: "no-cache" };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    assertSameOrigin(request);
    const result = await createQuestionSegmentationService().evaluateCandidate(
      id,
      await request.json(),
    );
    return NextResponse.json(result, { headers });
  } catch (error) {
    const response = apiErrorResponse(error, {
      route: "/api/analysis-sessions/[id]/question-boundary/evaluate",
      sessionId: id,
    });
    for (const [name, value] of Object.entries(headers))
      response.headers.set(name, value);
    return response;
  }
}
