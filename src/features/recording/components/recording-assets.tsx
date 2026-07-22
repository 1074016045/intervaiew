"use client";

import { useCallback, useEffect, useState } from "react";

type RecordingAssetView = {
  id: string;
  trackRole: "candidate" | "interviewer";
  fileName: string;
  mimeType: string;
  byteSize: number;
  durationMs: number | null;
  startOffsetMs: number;
  createdAt: string;
};

export function RecordingAssets({ interviewId }: { interviewId: string }) {
  const [assets, setAssets] = useState<RecordingAssetView[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/interviews/${interviewId}/recordings`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      recordings?: RecordingAssetView[];
      error?: { message: string };
    };
    if (!response.ok)
      throw new Error(payload.error?.message ?? "Could not load recordings.");
    setAssets(payload.recordings ?? []);
  }, [interviewId]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Could not load recordings."),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function remove(asset: RecordingAssetView) {
    if (!window.confirm(`Delete the ${asset.trackRole} recording?`)) return;
    const response = await fetch(
      `/api/interviews/${interviewId}/recordings/${asset.id}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const payload = (await response.json()) as { error?: { message: string } };
      setError(payload.error?.message ?? "Could not delete recording.");
      return;
    }
    await load();
  }
  return (
    <section className="card stack">
      <div>
        <p className="eyebrow">Optional local media</p>
        <h2>Recordings</h2>
      </div>
      {!assets.length ? (
        <p className="muted">No recording assets were saved.</p>
      ) : (
        assets.map((asset) => (
          <article className="recording-asset" key={asset.id}>
            <div>
              <strong>{asset.trackRole === "candidate" ? "Candidate" : "Interviewer"} track</strong>
              <p className="muted">
                {asset.mimeType} · {Math.ceil(asset.byteSize / 1024).toLocaleString()} KB
                {asset.durationMs == null ? "" : ` · ${(asset.durationMs / 1000).toFixed(1)}s`}
              </p>
            </div>
            <audio controls preload="metadata" src={`/api/interviews/${interviewId}/recordings/${asset.id}`} />
            <div className="actions">
              <a className="button secondary" href={`/api/interviews/${interviewId}/recordings/${asset.id}?download=1`}>Download</a>
              <button className="button danger" onClick={() => void remove(asset)}>Delete recording</button>
            </div>
          </article>
        ))
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
