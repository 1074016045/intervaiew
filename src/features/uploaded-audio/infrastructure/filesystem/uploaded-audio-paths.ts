import "server-only";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { UploadedAudioError } from "../../domain/uploaded-audio-error";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function safeUploadedAudioRelativePath(
  analysisSessionId: string,
  assetId: string,
  extension: string,
) {
  if (
    !uuidPattern.test(analysisSessionId) ||
    !uuidPattern.test(assetId) ||
    !/^[a-z0-9]{2,5}$/u.test(extension)
  )
    throw new UploadedAudioError(
      "UPLOADED_AUDIO_PATH_UNSAFE",
      "The uploaded-audio storage path was rejected.",
    );
  return `${analysisSessionId}/${assetId}.${extension}`;
}

export function safeUploadedAudioTombstoneRelativePath(
  analysisSessionId: string,
  deletionFileId: string,
) {
  if (!uuidPattern.test(analysisSessionId) || !uuidPattern.test(deletionFileId))
    throw new UploadedAudioError(
      "UPLOADED_AUDIO_PATH_UNSAFE",
      "The uploaded-audio tombstone path was rejected.",
    );
  return `${analysisSessionId}/${deletionFileId}.delete`;
}

export function resolveUploadedAudioPath(
  basePath: string,
  relativePath: string,
) {
  if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/u).includes("..") ||
    !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:[a-z0-9]{2,5}|delete)$/iu.test(
      relativePath,
    )
  )
    throw new UploadedAudioError(
      "UPLOADED_AUDIO_PATH_UNSAFE",
      "The uploaded-audio storage path was rejected.",
    );
  const base = resolve(basePath);
  const target = resolve(base, relativePath);
  const fromBase = relative(base, target);
  if (!fromBase || fromBase.startsWith(`..${sep}`) || isAbsolute(fromBase))
    throw new UploadedAudioError(
      "UPLOADED_AUDIO_PATH_UNSAFE",
      "The uploaded-audio storage path was rejected.",
    );
  return { base, target } as const;
}

export function isPathWithin(base: string, target: string) {
  const fromBase = relative(resolve(base), resolve(target));
  return Boolean(
    fromBase && !fromBase.startsWith(`..${sep}`) && !isAbsolute(fromBase),
  );
}
