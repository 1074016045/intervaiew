export type AudioDeletionStageResult = "staged" | "already-staged" | "missing";

export interface UploadedAudioStoragePort {
  write(
    input: Readonly<{
      analysisSessionId: string;
      assetId: string;
      extension: string;
      bytes: Uint8Array;
    }>,
  ): Promise<Readonly<{ relativePath: string; sha256: string }>>;
  read(relativePath: string): Promise<Uint8Array>;
  delete(relativePath: string): Promise<void>;
  createTombstoneRelativePath(
    analysisSessionId: string,
    deletionFileId: string,
  ): string;
  stageDelete(
    originalRelativePath: string,
    tombstoneRelativePath: string,
  ): Promise<AudioDeletionStageResult>;
  finalizeDelete(tombstoneRelativePath: string): Promise<void>;
  rollbackDelete(
    originalRelativePath: string,
    tombstoneRelativePath: string,
  ): Promise<void>;
}
