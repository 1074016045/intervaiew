import { NextResponse } from "next/server";
import { AnalysisSessionService } from "@/features/question-intelligence/application/analysis-session-service";
import { SqliteAnalysisRepository } from "@/features/question-intelligence/infrastructure/sqlite/sqlite-analysis-repository";
import { assertSameOrigin } from "@/infrastructure/http/same-origin";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

const noStoreHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function service() {
  return new AnalysisSessionService(new SqliteAnalysisRepository());
}

function safeError(error: unknown, id: string) {
  const response = apiErrorResponse(error, {
    route: "/api/analysis-sessions/[id]",
    sessionId: id,
  });
  for (const [name, value] of Object.entries(noStoreHeaders))
    response.headers.set(name, value);
  return response;
}

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  try {
    return NextResponse.json(service().get(id), { headers: noStoreHeaders });
  } catch (error) {
    return safeError(error, id);
  }
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  try {
    assertSameOrigin(request);
    const session = service().updateStatus(id, await request.json());
    return NextResponse.json({ session }, { headers: noStoreHeaders });
  } catch (error) {
    return safeError(error, id);
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  try {
    assertSameOrigin(request);
    const deleted = service().delete(id);
    return NextResponse.json({ deleted }, { headers: noStoreHeaders });
  } catch (error) {
    return safeError(error, id);
  }
}
