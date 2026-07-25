import { parentPort, workerData } from "node:worker_threads";
import { createDatabase } from "@/infrastructure/db/client";
import { SqliteTranscriptionJobQueue } from "@/features/uploaded-audio/infrastructure/sqlite/sqlite-transcription-job-queue";
import { UploadedAudioTranscriptionWorker } from "@/features/uploaded-audio/application/uploaded-audio-transcription-worker";

type RaceWorkerData = Readonly<{
  databasePath: string;
  command: "enqueue" | "claim" | "run-worker";
  input: Record<string, unknown>;
  receiptId: string;
  providerCounter?: SharedArrayBuffer;
}>;

const data = workerData as RaceWorkerData;
const connection = createDatabase(data.databasePath);
const queue = new SqliteTranscriptionJobQueue(connection.db, () => data.receiptId);

parentPort?.postMessage({ kind: "ready" });
parentPort?.once("message", async () => {
  try {
    let result: unknown;
    if (data.command === "enqueue")
      result = queue.enqueue(
        data.input as Parameters<SqliteTranscriptionJobQueue["enqueue"]>[0],
      );
    if (data.command === "claim")
      result = queue.claimNext(
        data.input as Parameters<SqliteTranscriptionJobQueue["claimNext"]>[0],
      );
    if (data.command === "run-worker") {
      const counter = new Int32Array(data.providerCounter!);
      const worker = new UploadedAudioTranscriptionWorker(
        queue,
        {
          read: async () => new Uint8Array([1]),
        } as never,
        {
          label: "race-provider",
          transcribe: async () => {
            Atomics.add(counter, 0, 1);
            return [{ text: "race", startMs: 0, endMs: 1 }];
          },
        },
        { ingestUploadedAudio: () => ({ kind: "created", segments: [] }) } as never,
        () => Number(data.input.now),
        () => String(data.input.leaseToken),
      );
      result = await worker.runOneIteration();
    }
    parentPort?.postMessage({ kind: "result", result });
  } catch (error) {
    parentPort?.postMessage({
      kind: "error",
      message: error instanceof Error ? error.message : "worker failed",
    });
  } finally {
    connection.sqlite.close();
  }
});
