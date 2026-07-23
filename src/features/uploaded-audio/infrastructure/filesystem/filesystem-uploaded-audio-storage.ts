import "server-only";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  AudioDeletionStageResult,
  UploadedAudioStoragePort,
} from "../../application/uploaded-audio-storage.port";
import { UploadedAudioError } from "../../domain/uploaded-audio-error";
import {
  isPathWithin,
  resolveUploadedAudioPath,
  safeUploadedAudioRelativePath,
  safeUploadedAudioTombstoneRelativePath,
} from "./uploaded-audio-paths";

function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export class FilesystemUploadedAudioStorage implements UploadedAudioStoragePort {
  constructor(private readonly rootPath: string) {}

  async write(input: Parameters<UploadedAudioStoragePort["write"]>[0]) {
    const relativePath = safeUploadedAudioRelativePath(
      input.analysisSessionId,
      input.assetId,
      input.extension,
    );
    const { target } = resolveUploadedAudioPath(this.rootPath, relativePath);
    await this.ensureSafeDirectory(dirname(target));
    const temporaryPath = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(input.bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, target);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    return Object.freeze({
      relativePath,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
    });
  }

  async read(relativePath: string) {
    const target = await this.assertSafeFile(relativePath);
    const handle = await open(target, "r");
    try {
      return new Uint8Array(await handle.readFile());
    } finally {
      await handle.close();
    }
  }

  async delete(relativePath: string) {
    let target: string;
    try {
      target = await this.assertSafeFile(relativePath);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    await unlink(target).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
  }

  createTombstoneRelativePath(
    analysisSessionId: string,
    deletionFileId: string,
  ) {
    return safeUploadedAudioTombstoneRelativePath(
      analysisSessionId,
      deletionFileId,
    );
  }

  async stageDelete(
    originalRelativePath: string,
    tombstoneRelativePath: string,
  ): Promise<AudioDeletionStageResult> {
    const original = await this.optionalSafeFile(originalRelativePath);
    const tombstone = await this.optionalSafeFile(tombstoneRelativePath);
    if (original && tombstone)
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_STORAGE_FAILED",
        "Both original and staged uploaded-audio bytes exist.",
      );
    if (tombstone) return "already-staged";
    if (!original) return "missing";
    const { target } = resolveUploadedAudioPath(
      this.rootPath,
      tombstoneRelativePath,
    );
    await rename(original, target);
    return "staged";
  }

  async finalizeDelete(tombstoneRelativePath: string) {
    const tombstone = await this.optionalSafeFile(tombstoneRelativePath);
    if (!tombstone) return;
    await unlink(tombstone).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
  }

  async rollbackDelete(
    originalRelativePath: string,
    tombstoneRelativePath: string,
  ) {
    const original = await this.optionalSafeFile(originalRelativePath);
    const tombstone = await this.optionalSafeFile(tombstoneRelativePath);
    if (original && tombstone)
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_STORAGE_FAILED",
        "Uploaded-audio deletion rollback found conflicting files.",
      );
    if (original || !tombstone) return;
    const { target } = resolveUploadedAudioPath(
      this.rootPath,
      originalRelativePath,
    );
    await rename(tombstone, target);
  }

  private async ensureSafeDirectory(directory: string) {
    const { base } = resolveUploadedAudioPath(
      this.rootPath,
      `${directory.split(/[\\/]/u).at(-1) ?? "invalid"}/00000000-0000-4000-8000-000000000000.wav`,
    );
    await mkdir(base, { recursive: true, mode: 0o700 });
    const rootStat = await lstat(base);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_PATH_UNSAFE",
        "The uploaded-audio storage root was rejected.",
      );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const directoryStat = await lstat(directory);
    const realRoot = await realpath(base);
    const realDirectory = await realpath(directory);
    if (
      !directoryStat.isDirectory() ||
      directoryStat.isSymbolicLink() ||
      !isPathWithin(realRoot, realDirectory)
    )
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_PATH_UNSAFE",
        "The uploaded-audio storage directory was rejected.",
      );
  }

  private async assertSafeFile(relativePath: string) {
    const { base, target } = resolveUploadedAudioPath(
      this.rootPath,
      relativePath,
    );
    const rootStat = await lstat(base);
    const parentStat = await lstat(dirname(target));
    const targetStat = await lstat(target);
    if (
      !rootStat.isDirectory() ||
      rootStat.isSymbolicLink() ||
      !parentStat.isDirectory() ||
      parentStat.isSymbolicLink() ||
      !targetStat.isFile() ||
      targetStat.isSymbolicLink()
    )
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_PATH_UNSAFE",
        "The uploaded-audio file path was rejected.",
      );
    const realRoot = await realpath(base);
    const realTarget = await realpath(target);
    if (!isPathWithin(realRoot, realTarget))
      throw new UploadedAudioError(
        "UPLOADED_AUDIO_PATH_UNSAFE",
        "The uploaded-audio file path was rejected.",
      );
    return target;
  }

  private async optionalSafeFile(relativePath: string) {
    try {
      return await this.assertSafeFile(relativePath);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
}
