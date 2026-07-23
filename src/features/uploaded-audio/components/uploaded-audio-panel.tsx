"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  UploadedAudioAssetView,
  UploadedAudioSpeakerRole,
} from "../domain/uploaded-audio";

type ApiErrorPayload = { error?: { message: string } };

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/analysis-sessions/${sessionId}/uploaded-audio`,
        { cache: "no-store", signal },
      );
      const payload = (await response.json()) as {
        assets?: ReadonlyArray<UploadedAudioAssetView>;
        maximumBytes?: number;
      } & ApiErrorPayload;
      if (!response.ok || !payload.assets)
        throw new Error(
          payload.error?.message ?? "Uploaded audio could not be loaded.",
        );
      setAssets(payload.assets);
      setMaximumBytes(payload.maximumBytes ?? 0);
    },
    [sessionId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const scheduled = window.setTimeout(() => {
      void load(controller.signal).catch((caught) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError"))
          setError(
            caught instanceof Error
              ? caught.message
              : "Uploaded audio could not be loaded.",
          );
      });
    }, 0);
    return () => {
      window.clearTimeout(scheduled);
      controller.abort();
    };
  }, [load]);

  async function upload() {
    if (!file || busyId) return;
    setBusyId("upload");
    setError("");
    try {
      const formData = new FormData();
      formData.set("actionId", crypto.randomUUID());
      formData.set("speakerRole", speakerRole);
      formData.set("file", file);
      const response = await fetch(
        `/api/analysis-sessions/${sessionId}/uploaded-audio`,
        { method: "POST", body: formData, cache: "no-store" },
      );
      const payload = (await response.json()) as ApiErrorPayload;
      if (!response.ok)
        throw new Error(payload.error?.message ?? "Audio upload failed.");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Audio upload failed.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function transcribe(assetId: string) {
    if (busyId) return;
    setBusyId(assetId);
    setError("");
    try {
      const response = await fetch(
        `/api/analysis-sessions/${sessionId}/uploaded-audio/${assetId}/transcribe`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionId: crypto.randomUUID() }),
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as ApiErrorPayload;
      if (!response.ok)
        throw new Error(
          payload.error?.message ?? "Audio transcription failed safely.",
        );
      await Promise.all([load(), onTranscriptCommitted()]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Audio transcription failed safely.",
      );
      await load().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(assetId: string) {
    if (
      busyId ||
      !window.confirm(
        "Delete this uploaded file and its metadata? Final transcript segments already committed will remain.",
      )
    )
      return;
    setBusyId(assetId);
    setError("");
    try {
      const response = await fetch(
        `/api/analysis-sessions/${sessionId}/uploaded-audio/${assetId}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionId: crypto.randomUUID() }),
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as ApiErrorPayload;
      if (!response.ok)
        throw new Error(payload.error?.message ?? "Audio deletion failed.");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Audio deletion failed.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card stack" aria-labelledby="uploaded-audio-title">
      <div>
        <p className="question-number">Practice / Authorized Demo · v0.4</p>
        <h2 id="uploaded-audio-title">Uploaded Audio</h2>
      </div>
      <p>
        Upload a prerecorded file you are authorized to process. Uploading does
        not transcribe it; transcription runs only after you select the visible
        <strong> Transcribe</strong> action.
      </p>
      <p className="muted">
        v0.4 performs no speaker diarization. Choose one role for the whole
        file. It does not capture a microphone, system/tab audio, or another
        application.
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
        >
          Upload audio
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {assets.length ? (
        <ol className="segment-timeline" data-testid="uploaded-audio-assets">
          {assets.map((asset) => (
            <li key={asset.id} data-testid="uploaded-audio-asset">
              <div className="message-head">
                <strong>{asset.originalFilename}</strong>
                <span data-testid="uploaded-audio-status">{asset.status}</span>
              </div>
              <p className="muted">
                {asset.speakerRole} · {asset.mimeType} · {asset.byteSize} bytes
                {asset.providerLabel ? ` · ${asset.providerLabel}` : ""}
              </p>
              {asset.status === "failed" ? (
                <p className="error">
                  Transcription failed safely ({asset.errorCode ?? "safe error"}
                  ). Retry uses a new explicit action.
                </p>
              ) : null}
              <div className="actions compact-actions">
                <button
                  className="button secondary"
                  type="button"
                  disabled={
                    Boolean(busyId) ||
                    asset.status === "completed" ||
                    asset.status === "transcribing" ||
                    asset.status === "deleting"
                  }
                  onClick={() => void transcribe(asset.id)}
                >
                  {asset.status === "failed"
                    ? "Retry Transcribe"
                    : "Transcribe"}
                </button>
                <button
                  className="button danger"
                  type="button"
                  disabled={Boolean(busyId) || asset.status === "transcribing"}
                  onClick={() => void remove(asset.id)}
                >
                  {asset.status === "deleting"
                    ? "Retry Delete"
                    : "Delete uploaded audio"}
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No uploaded audio assets.</p>
      )}
      <p className="muted">
        Deleting an asset removes its metadata and stored file bytes. Final
        transcript segments already committed remain in Transcript Lab and are
        deleted only with the analysis session.
      </p>
    </section>
  );
}
