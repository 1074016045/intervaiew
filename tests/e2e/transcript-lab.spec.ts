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
    "Tell me about a project you are proud of.",
  );

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByTestId("stream-status")).toHaveText("paused");
  await page.waitForTimeout(1_600);
  await expect(page.getByTestId("final-segment")).toHaveCount(1);
  await expect(page.getByTestId("interim-transcript")).toHaveText(
    "No interim transcript.",
  );

  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByTestId("stream-status")).toHaveText("streaming");
  await expect(page.getByTestId("interim-transcript")).toContainText(
    "What was your",
  );
  await expect(page.getByTestId("final-segment")).toHaveCount(2);
  await expect(page.getByTestId("final-transcript")).toContainText(
    "What was your specific contribution?",
  );
  await expect(page.getByTestId("interim-transcript")).toHaveText(
    "This trailing interim stays local",
  );

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByTestId("stream-status")).toHaveText("stopped");
  await page.reload();
  await expect(page.getByTestId("stream-status")).toHaveText("idle");
  await expect(page.getByTestId("final-segment")).toHaveCount(2);
  await expect(page.getByTestId("final-transcript")).toContainText(
    "Tell me about a project you are proud of.",
  );
  await expect(page.getByTestId("final-transcript")).toContainText(
    "What was your specific contribution?",
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
