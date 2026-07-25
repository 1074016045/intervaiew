// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadedAudioPanel } from "@/features/uploaded-audio/components/uploaded-audio-panel";
import type {
  PublicTranscriptionJobSummary,
  TranscriptionJobStatus,
  UploadedAudioAssetView,
  UploadedAudioStatus,
} from "@/features/uploaded-audio/domain/uploaded-audio";

const sessionId = "11111111-1111-4111-8111-111111111111";
const firstActionId = "22222222-2222-4222-8222-222222222222";
const secondActionId = "33333333-3333-4333-8333-333333333333";
const visibilityDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "visibilityState",
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function job(
  status: TranscriptionJobStatus,
  overrides: Partial<PublicTranscriptionJobSummary> = {},
): PublicTranscriptionJobSummary {
  return Object.freeze({
    id: `job-${status}`,
    status,
    attemptCount: status === "running" ? 1 : 0,
    maximumAttempts: 3,
    availableAt: 20_000,
    safeErrorCode:
      status === "failed" ? "UPLOADED_AUDIO_PROVIDER_TEMPORARY" : null,
    createdAt: 10_000,
    updatedAt: 11_000,
    completedAt: status === "completed" ? 11_000 : null,
    failedAt: status === "failed" ? 11_000 : null,
    cancelledAt: status === "cancelled" ? 11_000 : null,
    ...overrides,
  });
}

function asset(
  options: {
    status?: UploadedAudioStatus;
    latestJob?: PublicTranscriptionJobSummary | null;
    filename?: string;
    id?: string;
  } = {},
): UploadedAudioAssetView {
  const status = options.status ?? "uploaded";
  return Object.freeze({
    id: options.id ?? "asset-one",
    analysisSessionId: sessionId,
    speakerRole: "interviewer",
    originalFilename: options.filename ?? "practice.wav",
    mimeType: "audio/wav",
    byteSize: 44,
    sha256: "a".repeat(64),
    status,
    providerLabel: status === "completed" ? "deterministic-fake" : null,
    createdAt: 10_000,
    updatedAt: 11_000,
    completedAt: status === "completed" ? 11_000 : null,
    failedAt: status === "failed" ? 11_000 : null,
    errorCode: status === "failed" ? "SAFE_ASSET_FAILURE" : null,
    transcriptSegmentCount: status === "completed" ? 2 : 0,
    latestJob: options.latestJob ?? null,
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function listResponse(assets: ReadonlyArray<UploadedAudioAssetView>) {
  return jsonResponse({ assets, maximumBytes: 26_214_400 });
}

function fetchSequence(
  ...responses: ReadonlyArray<Response | Promise<Response>>
) {
  const mock = vi.fn<typeof fetch>();
  for (const response of responses)
    mock.mockImplementationOnce(() => Promise.resolve(response));
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function flushPromises() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function renderPanel(onTranscriptCommitted = vi.fn(async () => undefined)) {
  const rendered = render(
    <UploadedAudioPanel
      sessionId={sessionId}
      onTranscriptCommitted={onTranscriptCommitted}
    />,
  );
  return { ...rendered, onTranscriptCommitted };
}

function requestMethod(call: Parameters<typeof fetch>) {
  return call[1]?.method ?? "GET";
}

function setVisibility(value: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (visibilityDescriptor)
    Object.defineProperty(document, "visibilityState", visibilityDescriptor);
  else
    delete (document as unknown as { visibilityState?: string })
      .visibilityState;
});

describe("UploadedAudioPanel public states", () => {
  it("shows initial loading, then an empty state without polling or transcription", async () => {
    const pending = deferred<Response>();
    const fetchMock = fetchSequence(pending.promise);
    renderPanel();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading uploaded audio",
    );
    expect(
      screen.queryByText("No uploaded audio assets."),
    ).not.toBeInTheDocument();

    pending.resolve(listResponse([]));
    await flushPromises();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("No uploaded audio assets.")).toBeVisible();
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(
      fetchMock.mock.calls.some((call) => requestMethod(call) === "POST"),
    ).toBe(false);
  });

  it("renders uploaded metadata and enabled explicit actions without auto-transcribing", async () => {
    const fetchMock = fetchSequence(listResponse([asset()]));
    renderPanel();
    await flushPromises();

    const card = screen.getByTestId("uploaded-audio-asset");
    expect(card).toHaveTextContent("practice.wav");
    expect(card).toHaveTextContent("interviewer · audio/wav · 44 bytes");
    expect(
      within(card).getByRole("button", { name: /Transcribe practice\.wav/ }),
    ).toBeEnabled();
    expect(
      within(card).getByRole("button", {
        name: /Delete uploaded audio practice\.wav/,
      }),
    ).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["queued", "Queued"],
    ["running", "Transcribing"],
  ] as const)(
    "renders an active %s job and schedules polling",
    async (status, label) => {
      fetchSequence(
        listResponse([
          asset({
            status: status === "running" ? "transcribing" : "uploaded",
            latestJob: job(status),
          }),
        ]),
      );
      renderPanel();
      await flushPromises();

      const card = screen.getByTestId("uploaded-audio-asset");
      expect(
        within(card).getByTestId("uploaded-audio-status"),
      ).toHaveTextContent(label);
      expect(within(card).getByTestId("uploaded-audio-status")).toHaveAttribute(
        "aria-live",
        "polite",
      );
      expect(card).toHaveAttribute("aria-busy", "true");
      expect(
        within(card).getByRole("button", { name: /Transcribe practice\.wav/ }),
      ).toBeDisabled();
      expect(
        within(card).getByRole("button", {
          name: /Delete uploaded audio practice\.wav/,
        }),
      ).toBeEnabled();
      expect(vi.getTimerCount()).toBe(1);
    },
  );

  it("renders a future queued retry as Retrying without inventing a status", async () => {
    fetchSequence(
      listResponse([
        asset({
          latestJob: job("queued", {
            attemptCount: 1,
            availableAt: Date.now() + 5_000,
          }),
        }),
      ]),
    );
    renderPanel();
    await flushPromises();

    expect(screen.getByTestId("uploaded-audio-status")).toHaveTextContent(
      "Retrying",
    );
    expect(
      screen.queryByText("retrying", { exact: true }),
    ).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("renders a completed job, stops polling, and announces completion once", async () => {
    const committed = vi.fn(async () => undefined);
    fetchSequence(
      listResponse([
        asset({ status: "completed", latestJob: job("completed") }),
      ]),
    );
    renderPanel(committed);
    await flushPromises();

    expect(screen.getByTestId("uploaded-audio-status")).toHaveTextContent(
      "Completed",
    );
    expect(screen.getByTestId("uploaded-audio-asset")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(committed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not repeat a completion callback for identical GET results in one mount", async () => {
    const committed = vi.fn(async () => undefined);
    const completed = asset({
      status: "completed",
      latestJob: job("completed", { id: "stable-completed-job" }),
    });
    const queued = asset({
      id: "asset-two",
      latestJob: job("queued", { id: "active-job" }),
    });
    fetchSequence(
      listResponse([completed, queued]),
      listResponse([completed, queued]),
    );
    renderPanel(committed);
    await flushPromises();
    await advance(1_000);

    expect(committed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("emits completion once for each newly observed completed job", async () => {
    const committed = vi.fn(async () => undefined);
    const firstCompleted = asset({
      status: "completed",
      latestJob: job("completed", { id: "completed-job-one" }),
    });
    const active = asset({
      id: "asset-two",
      latestJob: job("queued", { id: "active-job" }),
    });
    const secondCompleted = asset({
      id: "asset-two",
      status: "completed",
      latestJob: job("completed", { id: "completed-job-two" }),
    });
    fetchSequence(
      listResponse([firstCompleted, active]),
      listResponse([firstCompleted, secondCompleted]),
    );
    renderPanel(committed);
    await flushPromises();
    await advance(1_000);

    expect(committed).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders failed status and a safe alert while enabling retry and stopping polling", async () => {
    fetchSequence(
      listResponse([asset({ status: "failed", latestJob: job("failed") })]),
    );
    renderPanel();
    await flushPromises();

    const card = screen.getByTestId("uploaded-audio-asset");
    expect(within(card).getByTestId("uploaded-audio-status")).toHaveTextContent(
      "Failed",
    );
    expect(within(card).getByRole("alert")).toHaveTextContent(
      "UPLOADED_AUDIO_PROVIDER_TEMPORARY",
    );
    expect(
      within(card).getByRole("button", {
        name: /Retry transcription for practice\.wav/,
      }),
    ).toBeEnabled();
    expect(
      within(card).getByRole("button", {
        name: /Delete uploaded audio practice\.wav/,
      }),
    ).toBeEnabled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["cancelled", "transcribing", "Cancelled", "false", true],
    ["cancelled", "deleting", "Cancelling/deleting", "true", false],
  ] as const)(
    "renders terminal/deleting state for a %s job on a %s asset",
    async (jobStatus, assetStatus, label, ariaBusy, deleteEnabled) => {
      fetchSequence(
        listResponse([
          asset({
            status: assetStatus,
            latestJob: job(jobStatus),
          }),
        ]),
      );
      renderPanel();
      await flushPromises();

      const card = screen.getByTestId("uploaded-audio-asset");
      expect(
        within(card).getByTestId("uploaded-audio-status"),
      ).toHaveTextContent(label);
      expect(card).toHaveAttribute("aria-busy", ariaBusy);
      expect(
        within(card).getByRole("button", { name: /Transcribe practice\.wav/ }),
      ).toBeDisabled();
      const deleteButton = within(card).getByRole("button", {
        name:
          assetStatus === "deleting"
            ? /Cancelling\/deleting uploaded audio/
            : /Delete uploaded audio/,
      });
      expect(deleteButton).toHaveProperty("disabled", !deleteEnabled);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe("UploadedAudioPanel polling lifecycle", () => {
  it("uses recursive timeouts and never overlaps an unresolved polling GET", async () => {
    const polling = deferred<Response>();
    const interval = vi.spyOn(window, "setInterval");
    const fetchMock = fetchSequence(
      listResponse([asset({ latestJob: job("queued") })]),
      polling.promise,
    );
    renderPanel();
    await flushPromises();

    expect(interval).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);

    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    polling.resolve(listResponse([asset({ latestJob: job("queued") })]));
    await flushPromises();
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "stops polling after a %s terminal result",
    async (terminal) => {
      const terminalAsset = asset({
        status:
          terminal === "completed"
            ? "completed"
            : terminal === "failed"
              ? "failed"
              : "transcribing",
        latestJob: job(terminal),
      });
      const fetchMock = fetchSequence(
        listResponse([asset({ latestJob: job("queued") })]),
        listResponse([terminalAsset]),
      );
      renderPanel();
      await flushPromises();
      await advance(1_000);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
      expect(screen.getByTestId("uploaded-audio-status")).toHaveTextContent(
        terminal === "completed"
          ? "Completed"
          : terminal === "failed"
            ? "Failed"
            : "Cancelled",
      );
    },
  );

  it("does not schedule another poll when terminal completion notification fails", async () => {
    const committed = vi.fn(async () => {
      throw new Error("Transcript refresh failed");
    });
    const fetchMock = fetchSequence(
      listResponse([asset({ latestJob: job("queued") })]),
      listResponse([
        asset({ status: "completed", latestJob: job("completed") }),
      ]),
    );
    renderPanel(committed);
    await flushPromises();
    await advance(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(committed).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Transcript refresh failed",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears pending timers and aborts the initial GET on unmount", async () => {
    const pending = deferred<Response>();
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      signal = init?.signal ?? undefined;
      return pending.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderPanel();

    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    pending.resolve(
      listResponse([
        asset({ status: "completed", latestJob: job("completed") }),
      ]),
    );
    await flushPromises();
  });

  it("aborts an in-flight poll and ignores late completion after unmount", async () => {
    const polling = deferred<Response>();
    const committed = vi.fn(async () => undefined);
    const fetchMock = fetchSequence(
      listResponse([asset({ latestJob: job("running") })]),
      polling.promise,
    );
    const { unmount } = renderPanel(committed);
    await flushPromises();
    await advance(1_000);
    const pollingSignal = fetchMock.mock.calls[1]?.[1]?.signal;

    unmount();
    expect(pollingSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    polling.resolve(
      listResponse([
        asset({ status: "completed", latestJob: job("completed") }),
      ]),
    );
    await flushPromises();
    expect(committed).not.toHaveBeenCalled();
  });

  it("handles a polling rejection after unmount without scheduling work", async () => {
    const polling = deferred<Response>();
    const fetchMock = fetchSequence(
      listResponse([asset({ latestJob: job("running") })]),
      polling.promise,
    );
    const { unmount } = renderPanel();
    await flushPromises();
    await advance(1_000);
    const pollingSignal = fetchMock.mock.calls[1]?.[1]?.signal;

    unmount();
    polling.reject(new Error("Late polling rejection"));
    await flushPromises();

    expect(pollingSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a pending recursive poll timer on unmount", async () => {
    fetchSequence(listResponse([asset({ latestJob: job("queued") })]));
    const { unmount } = renderPanel();
    await flushPromises();

    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves state, retries a transient failure, recovers, and handles the rejection", async () => {
    const unhandled = vi.fn();
    const failedPoll = deferred<Response>();
    window.addEventListener("unhandledrejection", unhandled);
    try {
      const fetchMock = fetchSequence(
        listResponse([
          asset({ status: "transcribing", latestJob: job("running") }),
        ]),
        failedPoll.promise,
        listResponse([
          asset({ status: "completed", latestJob: job("completed") }),
        ]),
      );
      renderPanel();
      await flushPromises();
      await advance(1_000);
      failedPoll.reject(new Error("Temporary polling failure"));
      await flushPromises();

      expect(screen.getByTestId("uploaded-audio-status")).toHaveTextContent(
        "Transcribing",
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Temporary polling failure",
      );
      expect(vi.getTimerCount()).toBe(1);

      await advance(1_000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId("uploaded-audio-status")).toHaveTextContent(
        "Completed",
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(vi.getTimerCount()).toBe(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("unhandledrejection", unhandled);
    }
  });

  it("avoids overlap while hidden and safely resumes active polling when visible", async () => {
    const polling = deferred<Response>();
    const fetchMock = fetchSequence(
      listResponse([asset({ latestJob: job("queued") })]),
      polling.promise,
      listResponse([asset({ latestJob: job("running") })]),
    );
    renderPanel();
    await flushPromises();

    setVisibility("hidden");
    await advance(1_999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    setVisibility("visible");
    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    polling.resolve(listResponse([asset({ latestJob: job("queued") })]));
    await flushPromises();
    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not resume a terminal job on visibility changes and removes its listener", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const fetchMock = fetchSequence(
      listResponse([
        asset({ status: "completed", latestJob: job("completed") }),
      ]),
    );
    const { unmount } = renderPanel();
    await flushPromises();

    setVisibility("hidden");
    setVisibility("visible");
    await advance(5_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    const listener = add.mock.calls.find(
      ([type]) => type === "visibilitychange",
    )?.[1];
    expect(listener).toBeDefined();

    unmount();
    expect(remove).toHaveBeenCalledWith("visibilitychange", listener);
  });

  it("keeps keyboard focus during a polling refresh", async () => {
    fetchSequence(
      listResponse([
        asset({ status: "transcribing", latestJob: job("running") }),
      ]),
      listResponse([
        asset({
          status: "transcribing",
          latestJob: job("running", { attemptCount: 2, updatedAt: 12_000 }),
        }),
      ]),
    );
    renderPanel();
    await flushPromises();
    const deleteButton = screen.getByRole("button", {
      name: /Delete uploaded audio practice\.wav/,
    });
    deleteButton.focus();

    await advance(1_000);
    expect(deleteButton).toHaveFocus();
  });
});

describe("UploadedAudioPanel actions and accessibility", () => {
  it("posts a fresh action ID only after explicit Transcribe and renders the queued state", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(firstActionId);
    const fetchMock = fetchSequence(
      listResponse([asset()]),
      jsonResponse({ job: { status: "queued" } }, 202),
      listResponse([asset({ latestJob: job("queued") })]),
    );
    const callback = vi.fn(async () => undefined);
    const { rerender } = renderPanel(callback);
    await flushPromises();
    rerender(
      <UploadedAudioPanel
        sessionId={sessionId}
        onTranscriptCommitted={callback}
      />,
    );
    expect(
      fetchMock.mock.calls.filter((call) => requestMethod(call) === "POST"),
    ).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", { name: /Transcribe practice\.wav/ }),
    );
    await flushPromises();

    const post = fetchMock.mock.calls.find(
      (call) => requestMethod(call) === "POST",
    );
    expect(post?.[0]).toContain("/asset-one/transcribe");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      actionId: firstActionId,
    });
    expect(screen.getByTestId("uploaded-audio-status")).toHaveTextContent(
      "Queued",
    );
    expect(screen.getByTestId("uploaded-audio-asset")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("never posts from mount, rerender, polling, or visibility changes", async () => {
    const fetchMock = fetchSequence(
      listResponse([asset({ latestJob: job("queued") })]),
      listResponse([asset({ latestJob: job("running") })]),
    );
    const { rerender } = renderPanel();
    await flushPromises();

    rerender(
      <UploadedAudioPanel
        sessionId={sessionId}
        onTranscriptCommitted={vi.fn(async () => undefined)}
      />,
    );
    setVisibility("hidden");
    setVisibility("visible");
    await advance(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.every((call) => requestMethod(call) === "GET"),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("aborts an active Transcribe request and ignores its late success after unmount", async () => {
    const transcribeRequest = deferred<Response>();
    const fetchMock = fetchSequence(
      listResponse([asset()]),
      transcribeRequest.promise,
    );
    const { unmount } = renderPanel();
    await flushPromises();
    fireEvent.click(
      screen.getByRole("button", { name: /Transcribe practice\.wav/ }),
    );
    await flushPromises();
    const actionSignal = fetchMock.mock.calls[1]?.[1]?.signal;

    unmount();
    expect(actionSignal?.aborted).toBe(true);
    transcribeRequest.resolve(jsonResponse({ job: { status: "queued" } }, 202));
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses a different action ID for each retry after terminal failure", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(firstActionId)
      .mockReturnValueOnce(secondActionId);
    const failed = asset({ status: "failed", latestJob: job("failed") });
    fetchSequence(
      listResponse([failed]),
      jsonResponse({ job: { status: "queued" } }, 202),
      listResponse([
        asset({
          status: "failed",
          latestJob: job("failed", { id: "failed-again" }),
        }),
      ]),
      jsonResponse({ job: { status: "queued" } }, 202),
      listResponse([
        asset({ latestJob: job("queued", { id: "second-retry-job" }) }),
      ]),
    );
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    renderPanel();
    await flushPromises();

    fireEvent.click(
      screen.getByRole("button", { name: /Retry transcription/ }),
    );
    await flushPromises();
    fireEvent.click(
      screen.getByRole("button", { name: /Retry transcription/ }),
    );
    await flushPromises();

    const calls = fetchMock.mock.calls as Array<Parameters<typeof fetch>>;
    const bodies = calls
      .filter((call) => requestMethod(call) === "POST")
      .map((call) => JSON.parse(String(call[1]?.body)).actionId);
    expect(bodies).toEqual([firstActionId, secondActionId]);
  });

  it("respects delete confirmation, exposes deletion as busy, and sends no transcript mutation", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(firstActionId);
    const confirmation = vi.spyOn(window, "confirm");
    confirmation.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const deletion = deferred<Response>();
    const fetchMock = fetchSequence(
      listResponse([asset({ latestJob: job("queued") })]),
      deletion.promise,
      listResponse([]),
    );
    renderPanel();
    await flushPromises();
    const deleteButton = screen.getByRole("button", {
      name: /Delete uploaded audio practice\.wav/,
    });

    fireEvent.click(deleteButton);
    expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(deleteButton);
    await flushPromises();

    expect(screen.getByTestId("uploaded-audio-status")).toHaveTextContent(
      "Cancelling/deleting",
    );
    expect(screen.getByTestId("uploaded-audio-asset")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(
      screen.getByRole("button", {
        name: /Cancelling\/deleting uploaded audio/,
      }),
    ).toBeDisabled();
    const request = fetchMock.mock.calls[1];
    expect(requestMethod(request)).toBe("DELETE");
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      actionId: firstActionId,
    });

    deletion.resolve(jsonResponse({ deleted: true }));
    await flushPromises();
    expect(screen.getByText("No uploaded audio assets.")).toBeVisible();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("transcript-segments"),
      ),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some((call) => requestMethod(call) === "POST"),
    ).toBe(false);
  });

  it("does not let an older polling response restore a deleted asset", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(firstActionId);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const stalePoll = deferred<Response>();
    const fetchMock = fetchSequence(
      listResponse([asset({ latestJob: job("running") })]),
      stalePoll.promise,
      jsonResponse({ deleted: true }),
      listResponse([]),
    );
    renderPanel();
    await flushPromises();
    await advance(1_000);

    fireEvent.click(
      screen.getByRole("button", {
        name: /Delete uploaded audio practice\.wav/,
      }),
    );
    await flushPromises();
    expect(screen.getByText("No uploaded audio assets.")).toBeVisible();

    stalePoll.resolve(
      listResponse([
        asset({ status: "completed", latestJob: job("completed") }),
      ]),
    );
    await flushPromises();

    expect(screen.getByText("No uploaded audio assets.")).toBeVisible();
    expect(screen.queryByTestId("uploaded-audio-asset")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders only a safe public request error and restores retry controls", async () => {
    const failed = asset({ status: "failed", latestJob: job("failed") });
    const fetchMock = fetchSequence(
      listResponse([failed]),
      jsonResponse(
        {
          error: {
            message: "Transcription is temporarily unavailable.",
            stack: "secret stack /private/path database.sqlite SQL lease-token",
            providerPayload: { transcript: "private transcript text" },
          },
        },
        503,
      ),
      listResponse([failed]),
    );
    renderPanel();
    await flushPromises();
    fireEvent.click(
      screen.getByRole("button", { name: /Retry transcription/ }),
    );
    await flushPromises();

    expect(
      screen
        .getAllByRole("alert")
        .some((alert) =>
          alert.textContent?.includes(
            "Transcription is temporarily unavailable.",
          ),
        ),
    ).toBe(true);
    expect(document.body).not.toHaveTextContent("secret stack");
    expect(document.body).not.toHaveTextContent("/private/path");
    expect(document.body).not.toHaveTextContent("database.sqlite");
    expect(document.body).not.toHaveTextContent("lease-token");
    expect(document.body).not.toHaveTextContent("private transcript text");
    expect(
      screen.getByRole("button", { name: /Retry transcription/ }),
    ).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps labelled Upload, role, Transcribe, and Delete controls keyboard reachable", async () => {
    fetchSequence(listResponse([asset()]));
    renderPanel();
    await flushPromises();
    const fileInput = screen.getByLabelText("Audio file");
    const roleSelect = screen.getByLabelText(
      "One speaker role for the whole file",
    );
    const uploadButton = screen.getByRole("button", {
      name: "Upload selected practice audio",
    });
    const transcribeButton = screen.getByRole("button", {
      name: /Transcribe practice\.wav/,
    });
    const deleteButton = screen.getByRole("button", {
      name: /Delete uploaded audio practice\.wav/,
    });
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File([new Uint8Array([1])], "new.wav", { type: "audio/wav" }),
        ],
      },
    });
    expect(uploadButton).toBeEnabled();

    vi.clearAllTimers();
    vi.useRealTimers();
    const user = userEvent.setup();
    await user.tab();
    expect(fileInput).toHaveFocus();
    await user.tab();
    expect(roleSelect).toHaveFocus();
    await user.tab();
    expect(uploadButton).toHaveFocus();
    await user.tab();
    expect(transcribeButton).toHaveFocus();
    await user.tab();
    expect(deleteButton).toHaveFocus();
  });
});
