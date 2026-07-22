import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  getDatabase,
  resetDatabaseForTests,
} from "@/infrastructure/db/client";
import {
  resetServerEnvForTests,
} from "@/infrastructure/env/server-env";
import { InterviewRepository } from "@/infrastructure/repositories/interview.repository";
import { StructuredQuestionPlanner } from "@/features/question-planner/application/structured-question-planner";
import { MockTextModelProvider } from "@/features/ai/infrastructure/mock/mock-text-model-provider";
import { resetRealtimeTokenRateLimiterForTests } from "@/features/realtime/infrastructure/server/realtime-token-rate-limiter";
import { POST } from "@/app/api/realtime/client-secret/route";

const input = {
  title: "Token route practice",
  targetRole: "Engineer",
  targetCompany: null,
  interviewType: "software-engineering" as const,
  difficulty: "mid-level" as const,
  language: "English" as const,
  questionCount: 3,
  resumeText: "Built robust realtime browser applications with secure media handling.",
  jobDescription: "Build secure realtime browser media products and reliable state machines.",
};

describe("realtime client-secret route", () => {
  let directory: string;
  let interviewId: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "intervaiew-token-route-"));
    resetDatabaseForTests();
    process.env.DATABASE_PATH = join(directory, "test.db");
    process.env.REALTIME_FAKE_ENABLED = "true";
    process.env.OPENAI_REALTIME_ENABLED = "false";
    resetServerEnvForTests();
    resetRealtimeTokenRateLimiterForTests();
    const { db } = getDatabase();
    migrate(db, { migrationsFolder: resolve("src/infrastructure/db/migrations") });
    const repository = new InterviewRepository(db);
    interviewId = repository.create(input)!.id;
    repository.beginPlanning(interviewId, "planning");
    const plan = await new StructuredQuestionPlanner(new MockTextModelProvider()).createPlan(input);
    repository.savePlan(interviewId, plan, "mock", "mock-deterministic");
  });

  afterEach(() => {
    resetDatabaseForTests();
    resetServerEnvForTests();
    resetRealtimeTokenRateLimiterForTests();
    delete process.env.DATABASE_PATH;
    delete process.env.REALTIME_FAKE_ENABLED;
    delete process.env.OPENAI_REALTIME_ENABLED;
    rmSync(directory, { recursive: true, force: true });
  });

  it("returns only safe fake token metadata with no-store headers", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(
      new Request("http://localhost/api/realtime/client-secret", {
        method: "POST",
        headers: { Origin: "http://localhost", "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId }),
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(String(payload.clientSecret)).toMatch(/^ek_fake_/);
    expect(payload).not.toHaveProperty("apiKey");
    expect(payload).not.toHaveProperty("instructions");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(String(payload.clientSecret));
  });

  it("rejects client-selected model and voice", async () => {
    const response = await POST(
      new Request("http://localhost/api/realtime/client-secret", {
        method: "POST",
        headers: { Origin: "http://localhost", "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId, model: "client-model", voice: "client-voice" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects requests without a verified same origin", async () => {
    const response = await POST(
      new Request("http://localhost/api/realtime/client-secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId }),
      }),
    );
    expect(response.status).toBe(403);
  });
});
