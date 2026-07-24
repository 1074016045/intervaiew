import { expect, test } from "@playwright/test";

function syntheticWav() {
  const bytes = Buffer.alloc(48);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(40, 4);
  bytes.write("WAVEfmt ", 8, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8_000, 24);
  bytes.writeUInt32LE(16_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(4, 40);
  return bytes;
}

test("explicitly uploads, transcribes, restores, and deletes uploaded audio", async ({
  page,
}) => {
  await page.goto("/lab/transcript");
  await page.getByLabel("Session title").fill("E2E Uploaded Audio");
  await page
    .getByRole("button", { name: "Create Transcript Lab session" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Uploaded Audio", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/There is no diarization/),
  ).toBeVisible();
  await page
    .getByLabel("One speaker role for the whole file")
    .selectOption("interviewer");
  await page.getByLabel("Audio file").setInputFiles({
    name: "synthetic.wav",
    mimeType: "audio/wav",
    buffer: syntheticWav(),
  });
  await page.getByRole("button", { name: /Upload selected practice audio/ }).click();

  await expect(page.getByTestId("uploaded-audio-asset")).toHaveCount(1);
  await expect(page.getByTestId("uploaded-audio-status")).toHaveText(
    "uploaded",
  );
  await expect(page.getByTestId("final-segment")).toHaveCount(0);

  await page.getByRole("button", { name: /Transcribe synthetic\.wav/ }).click();
  await expect(page.getByTestId("uploaded-audio-status")).toHaveText(
    "Completed",
  );
  await expect(page.getByTestId("final-segment")).toHaveCount(2);
  await expect(page.getByTestId("final-transcript")).toContainText(
    "Tell me about a project you are proud of?",
  );
  await expect(page.getByTestId("question-candidate")).toContainText(
    "What tradeoffs did you consider?",
  );

  await page.reload();
  await expect(page.getByTestId("uploaded-audio-status")).toHaveText(
    "Completed",
  );
  await expect(page.getByTestId("final-segment")).toHaveCount(2);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Delete uploaded audio synthetic\.wav/ }).click();
  await expect(page.getByTestId("uploaded-audio-asset")).toHaveCount(0);
  await expect(page.getByTestId("final-segment")).toHaveCount(2);
  await expect(page.getByTestId("final-transcript")).toContainText(
    "Tell me about a project you are proud of?",
  );

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Session" }).click();
  await expect(page).toHaveURL(/\/lab\/transcript$/u);
});

test("persists only final Transcript Lab segments across refresh", async ({
  page,
}) => {
  await page.goto("/lab/transcript");
  await expect(
    page.getByRole("heading", { name: "Transcript Lab" }),
  ).toBeVisible();
  await expect(page.getByText("Practice / Authorized Demo only")).toBeVisible();

  await page.getByLabel("Session title").fill("E2E Transcript Lab");
  await page
    .getByRole("button", { name: "Create Transcript Lab session" })
    .click();
  await expect(page).toHaveURL(/\/lab\/transcript\/[0-9a-f-]+$/u);
  await expect(page.getByTestId("stream-status")).toHaveText("idle");
  await expect(page.getByTestId("final-segment")).toHaveCount(0);

  await page.getByRole("button", { name: "Start Fake Stream" }).click();
  await expect(page.getByTestId("stream-status")).toHaveText("streaming");
  await expect(page.getByTestId("interim-transcript")).toContainText(
    "Tell me about",
  );
  await expect(page.getByTestId("final-segment")).toHaveCount(1);
  await expect(page.getByTestId("final-transcript")).toContainText(
    "Tell me about a project you are proud of and",
  );

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByTestId("stream-status")).toHaveText("paused");

  const interimAtPause =
    (await page.getByTestId("interim-transcript").textContent()) ?? "";

  await page.waitForTimeout(1_600);
  await expect(page.getByTestId("final-segment")).toHaveCount(1);
  await expect(page.getByTestId("interim-transcript")).toHaveText(
    interimAtPause,
  );

  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByTestId("stream-status")).toHaveText("streaming");
  await expect(page.getByTestId("interim-transcript")).toContainText(
    "what made it challenging",
  );
  await expect(page.getByTestId("final-segment")).toHaveCount(2);
  await expect(page.getByTestId("final-transcript")).toContainText(
    "what made it challenging?",
  );
  await expect(page.getByTestId("interim-transcript")).toHaveText(
    "This trailing interim stays local",
  );

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByTestId("stream-status")).toHaveText("stopped");
  await page.reload();
  await expect(page.getByTestId("stream-status")).toHaveText("idle");
  await expect(page.getByTestId("final-segment")).toHaveCount(3);
  await expect(page.getByTestId("final-transcript")).toContainText(
    "Tell me about a project you are proud of and",
  );
  await expect(page.getByTestId("final-transcript")).toContainText(
    "what made it challenging?",
  );
  await expect(page.getByTestId("interim-transcript")).toHaveText(
    "No interim transcript.",
  );
  await expect(page.getByText("This trailing interim stays local")).toHaveCount(
    0,
  );

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Session" }).click();
  await expect(page).toHaveURL(/\/lab\/transcript$/u);
  await expect(
    page.getByRole("heading", { name: "Transcript Lab" }),
  ).toBeVisible();
});

test("detects, merges, undoes, and restores question boundaries", async ({
  page,
}) => {
  await page.goto("/lab/transcript");
  await page.getByLabel("Session title").fill("E2E Question Boundary");
  await page
    .getByRole("button", { name: "Create Transcript Lab session" })
    .click();

  await expect(page.getByTestId("stream-status")).toHaveText("idle");
  await expect(page.getByTestId("question-candidate")).toHaveText(
    "No current interviewer candidate.",
  );
  await expect(
    page.getByRole("button", { name: "Evaluate Boundary" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Start Fake Stream" }).click();
  await expect(page.getByTestId("final-segment")).toHaveCount(1);
  await expect(page.getByTestId("question-candidate")).toContainText(
    "proud of and",
  );
  await expect(page.getByTestId("candidate-revision")).toHaveText("1");

  await page.getByRole("button", { name: "Evaluate Boundary" }).click();
  await expect(page.getByTestId("boundary-status")).toHaveText("waiting");
  await expect(page.getByTestId("finalized-question")).toHaveCount(0);

  await expect(page.getByTestId("final-segment")).toHaveCount(2);
  await expect(page.getByTestId("candidate-revision")).toHaveText("2");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Evaluate Boundary" }).click();
  await expect(page.getByTestId("finalized-question")).toHaveCount(1);
  await expect(page.getByTestId("question-candidate")).toHaveText(
    "No current interviewer candidate.",
  );

  await expect(page.getByTestId("final-segment")).toHaveCount(3);
  await expect(page.getByTestId("question-candidate")).toContainText(
    "recommendation system",
  );
  await page.waitForTimeout(3_100);
  await page.getByRole("button", { name: "Evaluate Boundary" }).click();
  await expect(page.getByTestId("finalized-question")).toHaveCount(2);

  await page
    .getByRole("button", { name: "Merge with Previous" })
    .nth(1)
    .click();
  await expect(page.getByTestId("finalized-question").nth(0)).toContainText(
    "revision 2",
  );
  await expect(page.getByTestId("finalized-question").nth(1)).toContainText(
    "undone",
  );

  await page.getByRole("button", { name: "Undo Finalize" }).nth(0).click();
  await expect(page.getByTestId("finalized-question").nth(0)).toContainText(
    "undone",
  );
  await expect(page.getByTestId("question-candidate")).toContainText(
    "Tell me about",
  );

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.reload();
  await expect(page.getByTestId("stream-status")).toHaveText("idle");
  await expect(page.getByTestId("candidate-revision")).not.toHaveText("—");
  await expect(page.getByTestId("finalized-question")).toHaveCount(2);
  await expect(page.getByTestId("finalized-question").nth(0)).toContainText(
    "undone",
  );

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Session" }).click();
  await expect(page).toHaveURL(/\/lab\/transcript$/u);
  await expect(
    page.getByRole("heading", { name: "Transcript Lab" }),
  ).toBeVisible();
});

test("explicitly analyzes a finalized question and restores understanding", async ({
  page,
}) => {
  await page.goto("/lab/transcript");
  await page.getByLabel("Session title").fill("E2E Question Understanding");
  await page
    .getByRole("button", { name: "Create Transcript Lab session" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Question Understanding",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Finalize a question before analyzing it."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Start Fake Stream" }).click();
  await expect(page.getByTestId("final-segment")).toHaveCount(2);
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Evaluate Boundary" }).click();
  await expect(page.getByTestId("finalized-question")).toHaveCount(1);
  const card = page.getByTestId("question-understanding");
  await expect(card).toContainText("not analyzed");
  await expect(card).toContainText("No understanding result");

  await card.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(card).toContainText("project_experience");
  await expect(card).toContainText("completed");
  await expect(card).toContainText("Fake semantic used");
  await expect(card).not.toContainText("suggested answer");

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.reload();
  await expect(page.getByTestId("question-understanding")).toContainText(
    "project_experience",
  );
  await expect(page.getByTestId("question-understanding")).toContainText(
    "source revision 1",
  );

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Session" }).click();
  await expect(page).toHaveURL(/\/lab\/transcript$/u);
});
