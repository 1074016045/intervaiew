import { NextResponse } from "next/server";
import { TranscriptIngestionService } from "@/features/question-intelligence/application/transcript-ingestion-service";
import { SqliteAnalysisRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-analysis-repository";
import { assertSameOrigin } from "@/infrastructure/http/same-origin";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    assertSameOrigin(request);
    const result = new TranscriptIngestionService(
      new SqliteAnalysisRepository(),
    ).ingest(id, await request.json());
    return NextResponse.json(result, {
      status: result.duplicated ? 200 : 201,
      headers: noStoreHeaders,
    });
  } catch (error) {
    const response = apiErrorResponse(error, {
      route: "/api/analysis-sessions/[id]/transcript-segments",
      sessionId: id,
    });
    for (const [name, value] of Object.entries(noStoreHeaders))
      response.headers.set(name, value);
    return response;
  }
}
