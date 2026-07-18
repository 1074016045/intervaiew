// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TranscriptPanel } from "@/features/transcript/components/transcript-panel";

describe("TranscriptPanel", () => {
  it("renders user text as inert text rather than HTML", () => {
    render(
      <TranscriptPanel
        items={[
          {
            id: "stable-id",
            sessionId: "session",
            sequence: 1,
            role: "candidate",
            source: "text",
            eventType: "answer",
            text: '<img src=x onerror="alert(1)">',
            questionSequence: 1,
            actionId: "action",
            createdAt: new Date(0).toISOString(),
          },
        ]}
      />,
    );
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
  });
});
