import { NextResponse } from "next/server";
import { AnalysisSessionService } from "@/features/question-intelligence/application/analysis-session-service";
import { SqliteAnalysisRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-analysis-repository";
import { assertSameOrigin } from "@/infrastructure/http/same-origin";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = new AnalysisSessionService(
      new SqliteAnalysisRepository(),
    ).create(await request.json());
    return NextResponse.json(
      { session },
      { status: 201, headers: noStoreHeaders },
    );
  } catch (error) {
    const response = apiErrorResponse(error, {
      route: "/api/analysis-sessions",
    });
    for (const [name, value] of Object.entries(noStoreHeaders))
      response.headers.set(name, value);
    return response;
  }
}
