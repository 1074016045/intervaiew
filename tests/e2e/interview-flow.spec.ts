import { expect, test } from "@playwright/test";

test("completes and deletes a three-question Mock interview", async ({
  page,
}) => {
  const existing = await page.request.get("/api/interviews");
  if (existing.ok()) {
    const payload = (await existing.json()) as {
      interviews: Array<{ id: string }>;
    };
    for (const interview of payload.interviews)
      await page.request.delete(`/api/interviews/${interview.id}`);
  }
  await page.goto("/");
  await expect(
    page.getByText("Practice clearly. Answer confidently."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Start Practice" }).click();
  await page.getByLabel("Title").fill("E2E Agent Practice");
  await page.getByLabel("Target role").fill("AI Agent Engineer");
  await page.getByLabel("Interview type").selectOption("ai-agent-engineering");
  await page.getByLabel("Difficulty").selectOption("graduate");
  await page.getByLabel("Language").selectOption("Chinese");
  await page.getByLabel("Question count").selectOption("3");
  await page
    .getByLabel("Resume text")
    .fill(
      "I built an AI agent orchestration service with safe tool execution and deterministic recovery mechanisms.",
    );
  await page
    .getByLabel("Job Description")
    .fill(
      "Build production AI agents, tool calling, prompt injection defenses, evaluation, observability, and recovery.",
    );
  await page.getByRole("button", { name: "Create interview" }).click();
  await expect(page).toHaveURL(/\/prepare$/);
  await expect(page.getByText("No external API calls")).toBeVisible();
  await page.getByRole("button", { name: "Generate questions" }).click();
  await expect(
    page.getByRole("heading", { name: "Question plan" }),
  ).toBeVisible();
  await expect(page.locator(".question")).toHaveCount(3);
  await page.getByRole("button", { name: "Start Text Interview" }).click();
  await expect(page).toHaveURL(/\/text$/);
  await expect(page.getByText("Question 1 of 3")).toBeVisible();
  await page
    .getByLabel("Your answer")
    .fill("I designed explicit state, bounded tools, and durable checkpoints.");
  await page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(page.getByText("Question 2 of 3")).toBeVisible();
  await page.getByRole("button", { name: "Ask for Clarification" }).click();
  await expect(
    page.getByText("The candidate asked for clarification."),
  ).toBeVisible();
  await page
    .getByLabel("Your answer")
    .fill("I used typed tool contracts and compensating actions.");
  await page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(page.getByText("Question 3 of 3")).toBeVisible();
  await page.getByRole("button", { name: "Repeat Question" }).click();
  await expect(
    page.getByText("The candidate asked to repeat the question."),
  ).toBeVisible();
  await page
    .getByLabel("Your answer")
    .fill("I evaluate completion, safety, latency, and recovery under faults.");
  await page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(
    page.getByRole("heading", { name: "Practice complete" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "View history" }).click();
  await expect(page.getByText("E2E Agent Practice")).toBeVisible();
  await page.getByRole("link", { name: "Open" }).click();
  await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
  const txt = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export TXT" }).click();
  expect((await txt).suggestedFilename()).toMatch(/\.txt$/);
  const json = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export JSON" }).click();
  expect((await json).suggestedFilename()).toMatch(/\.json$/);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Interview" }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(
    page.getByRole("heading", { name: "No interviews found" }),
  ).toBeVisible();
});
