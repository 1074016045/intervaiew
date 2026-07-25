"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  UploadedAudioAssetView,
  UploadedAudioSpeakerRole,
} from "../domain/uploaded-audio";

type ApiErrorPayload = { error?: { message: string } };
const hasActiveJob = (assets: ReadonlyArray<UploadedAudioAssetView>) =>
  assets.some(
    (asset) =>
      asset.latestJob?.status === "queued" ||
      asset.latestJob?.status === "running",
  );

export function UploadedAudioPanel({
  sessionId,
  onTranscriptCommitted,
}: {
  sessionId: string;
  onTranscriptCommitted: () => Promise<void>;
}) {
  const [assets, setAssets] = useState<ReadonlyArray<UploadedAudioAssetView>>(
    [],
  );
  const [maximumBytes, setMaximumBytes] = useState(0);
  const [speakerRole, setSpeakerRole] =
    useState<UploadedAudioSpeakerRole>("interviewer");
  const [file, setFile] = useState<File | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);
  const pollingRequestRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  const actionAbortRef = useRef<AbortController | null>(null);
  const loadRequestSequenceRef = useRef(0);
  const onTranscriptCommittedRef = useRef(onTranscriptCommitted);
  const notifiedCompletedJobs = useRef(new Set<string>());
  const assetsRef = useRef<ReadonlyArray<UploadedAudioAssetView>>([]);
  const scheduleNextPollRef = useRef<() => void>(() => undefined);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const requestSequence = ++loadRequestSequenceRef.current;
      const response = await fetch(
        `/api/analysis-sessions/${sessionId}/uploaded-audio`,
        { cache: "no-store", signal },
      );
      const payload = (await response.json()) as {
        assets?: ReadonlyArray<UploadedAudioAssetView>;
        maximumBytes?: number;
      } & ApiErrorPayload;
      if (
        !mountedRef.current ||
        signal?.aborted ||
        requestSequence !== loadRequestSequenceRef.current
      )
        return undefined;
      if (!response.ok || !payload.assets)
        throw new Error(
          payload.error?.message ?? "Uploaded audio could not be loaded.",
        );
      assetsRef.current = payload.assets;
      setAssets(payload.assets);
      setMaximumBytes(payload.maximumBytes ?? 0);
      for (const asset of payload.assets) {
        const job = asset.latestJob;
        if (
          !mountedRef.current ||
          job?.status !== "completed" ||
          notifiedCompletedJobs.current.has(job.id)
        )
          continue;
        notifiedCompletedJobs.current.add(job.id);
        await onTranscriptCommittedRef.current();
      }
      if (
        !mountedRef.current ||
        signal?.aborted ||
        requestSequence !== loadRequestSequenceRef.current
      )
        return undefined;
      return payload.assets;
    },
    [sessionId],
  );

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
  }, []);

  const schedulePoll = useCallback(
    (delayMs = document.visibilityState === "hidden" ? 2_000 : 1_000) => {
      if (!mountedRef.current || pollTimerRef.current !== null) return;
      pollTimerRef.current = window.setTimeout(async () => {
        pollTimerRef.current = null;
        if (!mountedRef.current) return;
        if (pollingRequestRef.current) {
          scheduleNextPollRef.current();
          return;
        }
        pollingRequestRef.current = true;
        const controller = new AbortController();
        pollAbortRef.current = controller;
        try {
          const current = await load(controller.signal);
          if (mountedRef.current) {
            setError("");
            if (current && hasActiveJob(current)) scheduleNextPollRef.current();
          }
        } catch (caught) {
          if (
            mountedRef.current &&
            !controller.signal.aborted &&
            !(caught instanceof DOMException && caught.name === "AbortError")
          ) {
            setError(
              caught instanceof Error
                ? caught.message
                : "Uploaded audio could not be loaded.",
            );
            if (hasActiveJob(assetsRef.current))
              scheduleNextPollRef.current();
          }
        } finally {
          pollingRequestRef.current = false;
          if (pollAbortRef.current === controller) pollAbortRef.current = null;
        }
      }, delayMs);
    },
    [load],
  );

  useEffect(() => {
    onTranscriptCommittedRef.current = onTranscriptCommitted;
  }, [onTranscriptCommitted]);

  useEffect(() => {
    scheduleNextPollRef.current = () => schedulePoll();
  }, [schedulePoll]);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    void load(controller.signal)
      .then((current) => {
        if (current && hasActiveJob(current)) schedulePoll();
      })
      .catch((caught) => {
        if (
          mountedRef.current &&
          !controller.signal.aborted &&
          !(caught instanceof DOMException && caught.name === "AbortError")
        )
          setError(
            caught instanceof Error
              ? caught.message
              : "Uploaded audio could not be loaded.",
          );
      })
      .finally(() => {
        if (mountedRef.current && !controller.signal.aborted)
          setInitialLoading(false);
      });
    const visibilityChanged = () => {
      if (!hasActiveJob(assetsRef.current)) return;
      stopPolling();
      schedulePoll();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      mountedRef.current = false;
      loadRequestSequenceRef.current += 1;
      controller.abort();
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      stopPolling();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [load, schedulePoll, stopPolling]);

  async function upload() {
    if (!file || busyId) return;
    setBusyId("upload");
    setError("");
    const controller = new AbortController();
    actionAbortRef.current = controller;
    try {
      const formData = new FormData();
      formData.set("actionId", crypto.randomUUID());
      formData.set("speakerRole", speakerRole);
      formData.set("file", file);
      const response = await fetch(
        `/api/analysis-sessions/${sessionId}/uploaded-audio`,
        {
          method: "POST",
          body: formData,
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const payload = (await response.json()) as ApiErrorPayload;
      if (!response.ok)
        throw new Error(payload.error?.message ?? "Audio upload failed.");
      if (!mountedRef.current || controller.signal.aborted) return;
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await load(controller.signal);
    } catch (caught) {
      if (
        mountedRef.current &&
        !controller.signal.aborted &&
        !(caught instanceof DOMException && caught.name === "AbortError")
      )
        setError(
          caught instanceof Error ? caught.message : "Audio upload failed.",
        );
    } finally {
      if (actionAbortRef.current === controller) actionAbortRef.current = null;
      if (mountedRef.current) setBusyId(null);
    }
  }

  async function transcribe(assetId: string) {
    if (busyId) return;
    setBusyId(assetId);
    setError("");
    const controller = new AbortController();
    actionAbortRef.current = controller;
    try {
      const response = await fetch(
        `/api/analysis-sessions/${sessionId}/uploaded-audio/${assetId}/transcribe`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionId: crypto.randomUUID() }),
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const payload = (await response.json()) as ApiErrorPayload;
      if (!response.ok)
        throw new Error(
          payload.error?.message ?? "Audio transcription could not be queued.",
        );
      if (!mountedRef.current || controller.signal.aborted) return;
      const current = await load(controller.signal);
      if (response.status === 202 && current && hasActiveJob(current))
        schedulePoll();
    } catch (caught) {
      if (
        mountedRef.current &&
        !controller.signal.aborted &&
        !(caught instanceof DOMException && caught.name === "AbortError")
      ) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Audio transcription could not be queued.",
        );
        await load(controller.signal).catch(() => undefined);
      }
    } finally {
      if (actionAbortRef.current === controller) actionAbortRef.current = null;
      if (mountedRef.current) setBusyId(null);
    }
  }

  async function remove(assetId: string) {
    if (
      busyId ||
      !window.confirm(
        "Delete this uploaded file and its metadata? Active transcription will be cancelled; already committed transcript segments remain.",
      )
    )
      return;
    setBusyId(assetId);
    setDeletingId(assetId);
    setError("");
    const controller = new AbortController();
    actionAbortRef.current = controller;
    try {
      const response = await fetch(
        `/api/analysis-sessions/${sessionId}/uploaded-audio/${assetId}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionId: crypto.randomUUID() }),
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const payload = (await response.json()) as ApiErrorPayload;
      if (!response.ok)
        throw new Error(payload.error?.message ?? "Audio deletion failed.");
      if (!mountedRef.current || controller.signal.aborted) return;
      stopPolling();
      const current = await load(controller.signal);
      if (current && hasActiveJob(current)) schedulePoll();
    } catch (caught) {
      if (
        mountedRef.current &&
        !controller.signal.aborted &&
        !(caught instanceof DOMException && caught.name === "AbortError")
      )
        setError(
          caught instanceof Error ? caught.message : "Audio deletion failed.",
        );
    } finally {
      if (actionAbortRef.current === controller) actionAbortRef.current = null;
      if (mountedRef.current) {
        setBusyId(null);
        setDeletingId(null);
      }
    }
  }

  function statusLabel(asset: UploadedAudioAssetView) {
    if (deletingId === asset.id || asset.status === "deleting")
      return "Cancelling/deleting";
    const job = asset.latestJob;
    if (!job) return asset.status === "completed" ? "Completed" : asset.status;
    if (job.status === "queued")
      return job.attemptCount > 0 ? "Retrying" : "Queued";
    if (job.status === "running") return "Transcribing";
    if (job.status === "completed") return "Completed";
    if (job.status === "failed") return "Failed";
    return "Cancelled";
  }

  return (
    <section className="card stack" aria-labelledby="uploaded-audio-title">
      <div>
        <p className="question-number">Practice / Authorized Demo · v0.5</p>
        <h2 id="uploaded-audio-title">Uploaded Audio</h2>
      </div>
      <p>
        Uploading never transcribes. The visible Transcribe action queues
        bounded local processing and returns immediately.
      </p>
      <p className="muted">
        One declared role applies to the whole file. There is no diarization,
        microphone, system/tab capture, scoring, or answer generation.
      </p>
      <div className="form-grid">
        <label>
          Audio file
          <input
            ref={inputRef}
            type="file"
            accept=".wav,.mp3,.m4a,.mp4,.ogg,.oga,.webm,.flac,audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/flac"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          One speaker role for the whole file
          <select
            value={speakerRole}
            onChange={(event) =>
              setSpeakerRole(event.target.value as UploadedAudioSpeakerRole)
            }
          >
            <option value="interviewer">interviewer</option>
            <option value="candidate">candidate</option>
          </select>
        </label>
      </div>
      <p className="muted">
        Supported: WAV, MP3, M4A/MP4, OGG, WebM, FLAC. Maximum:{" "}
        {maximumBytes
          ? `${Math.floor(maximumBytes / 1_048_576)} MiB`
          : "server configured"}
        .
      </p>
      <div className="actions">
        <button
          className="button"
          type="button"
          disabled={!file || Boolean(busyId)}
          onClick={() => void upload()}
          aria-label="Upload selected practice audio"
        >
          Upload audio
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {initialLoading ? (
        <p className="muted" role="status">
          Loading uploaded audio…
        </p>
      ) : assets.length ? (
        <ol className="segment-timeline" data-testid="uploaded-audio-assets">
          {assets.map((asset) => {
            const active =
              asset.latestJob?.status === "queued" ||
              asset.latestJob?.status === "running";
            const deleting =
              deletingId === asset.id || asset.status === "deleting";
            const canRetry =
              asset.latestJob?.status === "failed" &&
              asset.status !== "deleting";
            const canStart = !asset.latestJob && asset.status === "uploaded";
            return (
              <li
                key={asset.id}
                data-testid="uploaded-audio-asset"
                aria-busy={active || busyId === asset.id || deleting}
              >
                <div className="message-head">
                  <strong>{asset.originalFilename}</strong>
                  <span aria-live="polite" data-testid="uploaded-audio-status">
                    {statusLabel(asset)}
                  </span>
                </div>
                <p className="muted">
                  {asset.speakerRole} · {asset.mimeType} · {asset.byteSize}{" "}
                  bytes
                  {asset.providerLabel ? ` · ${asset.providerLabel}` : ""}
                </p>
                {asset.latestJob?.status === "failed" ? (
                  <p className="error" role="alert">
                    Transcription failed safely (
                    {asset.latestJob.safeErrorCode ?? "safe error"}).
                  </p>
                ) : null}
                <div className="actions compact-actions">
                  <button
                    className="button secondary"
                    type="button"
                    disabled={Boolean(busyId) || (!canStart && !canRetry)}
                    onClick={() => void transcribe(asset.id)}
                    aria-label={`${canRetry ? "Retry transcription for" : "Transcribe"} ${asset.originalFilename}`}
                  >
                    {canRetry ? "Retry Transcribe" : "Transcribe"}
                  </button>
                  <button
                    className="button danger"
                    type="button"
                    disabled={Boolean(busyId) || deleting}
                    onClick={() => void remove(asset.id)}
                    aria-label={`${
                      deleting
                        ? "Cancelling/deleting uploaded audio"
                        : "Delete uploaded audio"
                    } ${asset.originalFilename}`}
                  >
                    {deleting ? "Cancelling/deleting" : "Delete uploaded audio"}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted">No uploaded audio assets.</p>
      )}
      <p className="muted">
        Cancelling cannot stop provider code already in memory, but stale output
        cannot commit. Final transcript segments already committed survive asset
        deletion.
      </p>
    </section>
  );
}
