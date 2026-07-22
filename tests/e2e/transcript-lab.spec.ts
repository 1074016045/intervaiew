import { expect, test } from "@playwright/test";

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
