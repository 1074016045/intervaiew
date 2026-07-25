import { initializeUploadedAudioWorker } from "@/features/uploaded-audio/infrastructure/uploaded-audio-worker-registration";

export async function register() {
  if (typeof process === "undefined") return;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "production") return;
  await initializeUploadedAudioWorker(
    () =>
      import(
        "@/features/uploaded-audio/infrastructure/uploaded-audio-worker-factory"
      ),
  );
}
