import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { RecordingStorageService } from "@/features/recording/application/recording-storage-service";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; assetId: string }> };

export async function GET(request: Request, context: Context) {
  const { id, assetId } = await context.params;
  try {
    const { asset, path, byteSize } = await new RecordingStorageService().read(id, assetId);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/u);
    const requestedStart = range?.[1] ? Number(range[1]) : 0;
    const requestedEnd = range?.[2] ? Number(range[2]) : byteSize - 1;
    const partial = Boolean(range);
    if (
      !Number.isSafeInteger(requestedStart) ||
      !Number.isSafeInteger(requestedEnd) ||
      requestedStart < 0 ||
      requestedEnd < requestedStart ||
      requestedEnd >= byteSize
    )
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${byteSize}` },
      });
    const length = requestedEnd - requestedStart + 1;
    const stream = createReadStream(path, {
      start: requestedStart,
      end: requestedEnd,
    });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: partial ? 206 : 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asset.fileName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Accept-Ranges": "bytes",
        ...(partial
          ? { "Content-Range": `bytes ${requestedStart}-${requestedEnd}/${byteSize}` }
          : {}),
      },
    });
  } catch (error) {
    return apiErrorResponse(error, {
      route: "/api/interviews/[id]/recordings/[assetId]",
      sessionId: id,
    });
  }
}

export async function DELETE(_: Request, context: Context) {
  const { id, assetId } = await context.params;
  try {
    return Response.json({
      deleted: await new RecordingStorageService().delete(id, assetId),
    });
  } catch (error) {
    return apiErrorResponse(error, {
      route: "/api/interviews/[id]/recordings/[assetId]",
      sessionId: id,
    });
  }
}
