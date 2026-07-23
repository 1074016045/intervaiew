import { NextResponse } from "next/server";
import { UploadedAudioError } from "@/features/uploaded-audio/domain/uploaded-audio-error";
import { createUploadedAudioService } from "@/features/uploaded-audio/infrastructure/uploaded-audio-service-factory";
import { getServerEnv } from "@/infrastructure/env/server-env";
import { assertSameOrigin } from "@/infrastructure/http/same-origin";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

const noStoreHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};
const maximumMultipartOverheadBytes = 65_536;

function safeError(error: unknown, id: string) {
  const response = apiErrorResponse(error, {
    route: "/api/analysis-sessions/[id]/uploaded-audio",
    sessionId: id,
  });
  for (const [name, value] of Object.entries(noStoreHeaders))
    response.headers.set(name, value);
  return response;
}

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  try {
    return NextResponse.json(
      {
        assets: createUploadedAudioService().list(id),
        maximumBytes: getServerEnv().UPLOADED_AUDIO_MAX_BYTES,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return safeError(error, id);
  }
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  try {
    assertSameOrigin(request);
    if (
      !request.headers.get("content-type")?.startsWith("multipart/form-data;")
    )
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_FILE_REQUIRED",
        "A multipart audio upload is required.",
      );
    const maximumBytes = getServerEnv().UPLOADED_AUDIO_MAX_BYTES;
    const contentLengthHeader = request.headers.get("content-length");
    const contentLength =
      contentLengthHeader && /^\d+$/u.test(contentLengthHeader)
        ? Number(contentLengthHeader)
        : Number.NaN;
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength <= 0 ||
      contentLength > maximumBytes + maximumMultipartOverheadBytes
    )
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_SIZE_INVALID",
        "A bounded positive Content-Length is required for audio upload.",
      );
    const formData = await request.formData();
    const allowed = new Set(["actionId", "speakerRole", "file"]);
    if (
      [...formData.keys()].some((key) => !allowed.has(key)) ||
      [...allowed].some((key) => formData.getAll(key).length !== 1)
    )
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_FILE_REQUIRED",
        "The multipart upload fields were invalid.",
      );
    const file = formData.get("file");
    if (!(file instanceof File))
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_FILE_REQUIRED",
        "An audio file is required.",
      );
    if (!file.size || file.size > maximumBytes)
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_SIZE_INVALID",
        "The audio file is empty or exceeds the configured size limit.",
      );
    const result = await createUploadedAudioService().upload(
      id,
      {
        actionId: formData.get("actionId"),
        speakerRole: formData.get("speakerRole"),
        originalFilename: file.name,
        mimeType: file.type,
        byteSize: file.size,
      },
      new Uint8Array(await file.arrayBuffer()),
    );
    return NextResponse.json(result, {
      status: result.duplicated ? 200 : 201,
      headers: noStoreHeaders,
    });
  } catch (error) {
    return safeError(error, id);
  }
}
