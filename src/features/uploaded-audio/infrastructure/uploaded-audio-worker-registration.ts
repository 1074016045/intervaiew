export type StartableUploadedAudioWorker = Readonly<{ start(): void }>;

export type UploadedAudioWorkerModule = Readonly<{
  uploadedAudioWorkerIsExplicitlyEnabled(): boolean;
  createUploadedAudioTranscriptionWorker(): StartableUploadedAudioWorker;
}>;

const workerKey = Symbol.for("intervaiew.uploadedAudioTranscriptionWorker.v0.5");
const initializationKey = Symbol.for(
  "intervaiew.uploadedAudioTranscriptionWorkerInitialization.v0.5",
);

type WorkerGlobal = typeof globalThis & {
  [workerKey]?: StartableUploadedAudioWorker;
  [initializationKey]?: Promise<void>;
};

export function initializeUploadedAudioWorker(
  loadModule: () => Promise<UploadedAudioWorkerModule>,
  singleton: WorkerGlobal = globalThis as WorkerGlobal,
) {
  if (singleton[workerKey]) return Promise.resolve();
  if (singleton[initializationKey]) return singleton[initializationKey];

  const initialization = (async () => {
    const workerModule = await loadModule();
    if (!workerModule.uploadedAudioWorkerIsExplicitlyEnabled()) return;
    if (singleton[workerKey]) return;
    const worker = workerModule.createUploadedAudioTranscriptionWorker();
    singleton[workerKey] = worker;
    try {
      worker.start();
    } catch (error) {
      if (singleton[workerKey] === worker) delete singleton[workerKey];
      throw error;
    }
  })();
  singleton[initializationKey] = initialization;

  return initialization.finally(() => {
    if (singleton[initializationKey] === initialization)
      delete singleton[initializationKey];
  });
}
