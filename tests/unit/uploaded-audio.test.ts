import { describe, expect, it } from "vitest";
import {
  isSupportedAudioType,
  isValidAudioSignature,
  normalizeDisplayFilename,
  uploadedAudioActionSchema,
  uploadAudioMetadataSchema,
} from "@/features/uploaded-audio/domain/uploaded-audio";
import { FakeAudioTranscriptionProvider } from "@/features/uploaded-audio/infrastructure/fake/fake-audio-transcription-provider";
import {
  resolveUploadedAudioPath,
  safeUploadedAudioRelativePath,
} from "@/features/uploaded-audio/infrastructure/filesystem/uploaded-audio-paths";

const sessionId = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";

function wavBytes() {
  const bytes = new Uint8Array(44);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
}

describe("Uploaded Audio domain", () => {
  it("accepts only the two declared whole-file speaker roles", () => {
    const base = {
      actionId: "33333333-3333-4333-8333-333333333333",
      originalFilename: "practice.wav",
      mimeType: "audio/wav",
      byteSize: 44,
    };
    expect(
      uploadAudioMetadataSchema.parse({ ...base, speakerRole: "interviewer" }),
    ).toMatchObject({ speakerRole: "interviewer" });
    expect(() =>
      uploadAudioMetadataSchema.parse({ ...base, speakerRole: "unknown" }),
    ).toThrow();
    expect(() =>
      uploadAudioMetadataSchema.parse({
        ...base,
        speakerRole: "candidate",
        status: "completed",
      }),
    ).toThrow();
  });

  it("requires strict UUID action bodies", () => {
    expect(
      uploadedAudioActionSchema.parse({
        actionId: "33333333-3333-4333-8333-333333333333",
      }),
    ).toBeTruthy();
    expect(() =>
      uploadedAudioActionSchema.parse({ actionId: "not-an-id" }),
    ).toThrow();
    expect(() =>
      uploadedAudioActionSchema.parse({
        actionId: "33333333-3333-4333-8333-333333333333",
        transcript: "forged",
      }),
    ).toThrow();
  });

  it("validates MIME/extension pairs and file signatures", () => {
    expect(isSupportedAudioType("practice.wav", "audio/wav")).toBe(true);
    expect(isSupportedAudioType("practice.mp3", "audio/wav")).toBe(false);
    expect(isSupportedAudioType("practice.exe", "audio/mpeg")).toBe(false);
    expect(isValidAudioSignature("audio/wav", wavBytes())).toBe(true);
    expect(isValidAudioSignature("audio/mpeg", wavBytes())).toBe(false);
  });

  it("bounds and neutralizes display filenames without using them as paths", () => {
    expect(normalizeDisplayFilename("../../secret\u0000.wav")).toBe(
      ".._.._secret_.wav",
    );
    expect(normalizeDisplayFilename("x".repeat(300))).toHaveLength(180);
  });
});

describe("Uploaded Audio Fake provider", () => {
  it("is deterministic and provides role-specific finalized chunks", async () => {
    const provider = new FakeAudioTranscriptionProvider();
    const interviewer = await provider.transcribe({
      assetId,
      speakerRole: "interviewer",
      mimeType: "audio/wav",
      bytes: wavBytes(),
    });
    const candidate = await provider.transcribe({
      assetId: sessionId,
      speakerRole: "candidate",
      mimeType: "audio/wav",
      bytes: wavBytes(),
    });
    expect(interviewer).toHaveLength(2);
    expect(interviewer[0]?.text).toContain("project");
    expect(candidate).toHaveLength(1);
    expect(candidate[0]?.text).toContain("migration");
  });

  it("supports controlled failure and retry without a network", async () => {
    const provider = new FakeAudioTranscriptionProvider("once-per-asset");
    const input = {
      assetId,
      speakerRole: "interviewer" as const,
      mimeType: "audio/wav",
      bytes: wavBytes(),
    };
    await expect(provider.transcribe(input)).rejects.toThrow(/configured/);
    await expect(provider.transcribe(input)).resolves.toHaveLength(2);
    expect(provider.attemptCount(assetId)).toBe(2);
  });
});

describe("Uploaded Audio path helpers", () => {
  it("creates only server-ID relative paths", () => {
    const relativePath = safeUploadedAudioRelativePath(
      sessionId,
      assetId,
      "wav",
    );
    expect(relativePath).toBe(`${sessionId}/${assetId}.wav`);
    expect(resolveUploadedAudioPath("/safe/root", relativePath).target).toBe(
      `/safe/root/${relativePath}`,
    );
  });

  it("rejects traversal, absolute paths, and unsafe identifiers", () => {
    expect(() =>
      resolveUploadedAudioPath("/safe/root", "../escape.wav"),
    ).toThrow(/rejected/);
    expect(() => resolveUploadedAudioPath("/safe/root", "/escape.wav")).toThrow(
      /rejected/,
    );
    expect(() =>
      safeUploadedAudioRelativePath("../../session", assetId, "wav"),
    ).toThrow(/rejected/);
  });
});
