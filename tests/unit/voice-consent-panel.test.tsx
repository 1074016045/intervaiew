// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoiceConsentPanel } from "@/features/realtime/components/voice-consent-panel";

describe("VoiceConsentPanel", () => {
  it("keeps recording consent separate and off by default", () => {
    render(
      <VoiceConsentPanel
        audioConsent={false}
        recordingConsent={false}
        recordingsEnabled
        disabled={false}
        onAudioConsent={vi.fn()}
        onRecordingConsent={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/microphone audio will be sent/i)).not.toBeChecked();
    expect(screen.getByLabelText(/two local audio tracks/i)).not.toBeChecked();
  });
});
