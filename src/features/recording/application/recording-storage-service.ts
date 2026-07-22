import "server-only";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  recordingTrackRoles,
  safeRecordingMimeTypes,
} from "../domain/recording-asset";
import { safeRecordingPath, safeRecordingRelativePath } from "../infrastructure/recording-paths";
import { getServerEnv } from "@/infrastructure/env/server-env";
import { RecordingRepository } from "@/infrastructure/repositories/recording.repository";
import { RealtimeError } from "@/features/realtime/domain/realtime-errors";
import { safeLogger } from "@/infrastructure/logging/safe-logger";

const metadataSchema = z.object({
  attemptId: z.uuid(),
  trackRole: z.enum(recordingTrackRoles),
  durationMs: z.coerce.number().int().min(0).max(86_400_000).nullable(),
  startOffsetMs: z.coerce.number().int().min(0).max(86_400_000),
});

function extensionForMime(mime: string) {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

export class RecordingStorageService {
  constructor(private readonly repository = new RecordingRepository()) {}

  list(sessionId: string) {
    return this.repository.list(sessionId);
  }

  async upload(sessionId: string, formData: FormData) {
    const env = getServerEnv();
    if (!env.RECORDINGS_ENABLED)
      throw new RealtimeError(
        "RECORDING_DISABLED",
        "Recording storage is not enabled.",
      );
    const file = formData.get("file");
    if (!(file instanceof File))
      throw new RealtimeError(
        "RECORDING_FILE_REQUIRED",
        "A recording file is required.",
      );
    const metadata = metadataSchema.parse({
      attemptId: formData.get("attemptId"),
      trackRole: formData.get("trackRole"),
      durationMs: formData.get("durationMs") || null,
      startOffsetMs: formData.get("startOffsetMs") ?? 0,
    });
    if (!safeRecordingMimeTypes.includes(file.type as (typeof safeRecordingMimeTypes)[number]))
      throw new RealtimeError(
        "UNSAFE_RECORDING_MIME",
        "This recording format is not accepted.",
      );
    if (!file.size || file.size > env.MAX_RECORDING_BYTES)
      throw new RealtimeError(
        "RECORDING_SIZE_INVALID",
        "The recording is empty or exceeds the configured size limit.",
      );
    this.repository.verifySessionAttempt(sessionId, metadata.attemptId);
    const serverFileName = `${crypto.randomUUID()}.${extensionForMime(file.type)}`;
    const relativePath = safeRecordingRelativePath(sessionId, serverFileName);
    const finalPath = safeRecordingPath(env.RECORDINGS_PATH, relativePath);
    const temporaryPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
    await mkdir(dirname(finalPath), { recursive: true, mode: 0o700 });
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(Buffer.from(await file.arrayBuffer()));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, finalPath);
      try {
        return this.repository.create({
          sessionId,
          realtimeAttemptId: metadata.attemptId,
          trackRole: metadata.trackRole,
          relativePath,
          fileName: `${metadata.trackRole}.${extensionForMime(file.type)}`,
          mimeType: file.type,
          byteSize: file.size,
          durationMs: metadata.durationMs,
          startOffsetMs: metadata.startOffsetMs,
        });
      } catch (error) {
        await unlink(finalPath).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async read(sessionId: string, assetId: string) {
    const asset = this.repository.get(sessionId, assetId);
    if (!asset)
      throw new RealtimeError(
        "RECORDING_NOT_FOUND",
        "The recording could not be found.",
      );
    const path = safeRecordingPath(
      getServerEnv().RECORDINGS_PATH,
      asset.relativePath,
    );
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat?.isFile())
      throw new RealtimeError(
        "RECORDING_NOT_FOUND",
        "The recording could not be found.",
      );
    return { asset, path, byteSize: fileStat.size };
  }

  async delete(sessionId: string, assetId: string) {
    const asset = this.repository.get(sessionId, assetId);
    if (!asset) return false;
    const path = safeRecordingPath(
      getServerEnv().RECORDINGS_PATH,
      asset.relativePath,
    );
    await unlink(path).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
        throw error;
    });
    this.repository.delete(sessionId, assetId);
    return true;
  }

  async deleteForInterview(sessionId: string) {
    for (const asset of this.repository.list(sessionId)) {
      try {
        const path = safeRecordingPath(
          getServerEnv().RECORDINGS_PATH,
          asset.relativePath,
        );
        await unlink(path).catch((error: unknown) => {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
            throw error;
        });
      } catch {
        safeLogger.error("Recording cleanup failed", {
          errorCode: "RECORDING_FILE_CLEANUP_FAILED",
          sessionId,
          trackRole: asset.trackRole,
          recordingByteSize: asset.byteSize,
        });
      }
    }
  }
}
