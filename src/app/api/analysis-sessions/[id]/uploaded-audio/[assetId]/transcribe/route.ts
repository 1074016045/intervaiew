import { NextResponse } from "next/server";
import { createUploadedAudioService } from "@/features/uploaded-audio/infrastructure/uploaded-audio-service-factory";
import { assertSameOrigin } from "@/infrastructure/http/same-origin";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
type Context = {
  params: Promise<{ id: string; assetId: string }>;
};
const noStoreHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

export async function POST(request: Request, context: Context) {
  const { id, assetId } = await context.params;
  try {
    assertSameOrigin(request);
    const result = await createUploadedAudioService().transcribe(
      id,
      assetId,
      await request.json(),
    );
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    const response = apiErrorResponse(error, {
      route: "/api/analysis-sessions/[id]/uploaded-audio/[assetId]/transcribe",
      sessionId: id,
    });
    for (const [name, value] of Object.entries(noStoreHeaders))
      response.headers.set(name, value);
    return response;
  }
}
