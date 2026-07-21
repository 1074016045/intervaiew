import "server-only";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { RealtimeError } from "@/features/realtime/domain/realtime-errors";

export function safeRecordingPath(basePath: string, relativePath: string) {
  if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/u).includes("..")
  )
    throw new RealtimeError(
      "UNSAFE_RECORDING_PATH",
      "The recording path was rejected.",
    );
  const base = resolve(basePath);
  const target = resolve(base, relativePath);
  const fromBase = relative(base, target);
  if (!fromBase || fromBase.startsWith(`..${sep}`) || isAbsolute(fromBase))
    throw new RealtimeError(
      "UNSAFE_RECORDING_PATH",
      "The recording path was rejected.",
    );
  return target;
}

export function safeRecordingRelativePath(
  sessionId: string,
  serverFileName: string,
) {
  if (!/^[0-9a-f-]{36}$/iu.test(sessionId))
    throw new RealtimeError(
      "UNSAFE_RECORDING_PATH",
      "The recording path was rejected.",
    );
  if (!/^[0-9a-f-]+\.[a-z0-9]+$/iu.test(serverFileName))
    throw new RealtimeError(
      "UNSAFE_RECORDING_PATH",
      "The recording path was rejected.",
    );
  return `${sessionId}/${serverFileName}`;
}
