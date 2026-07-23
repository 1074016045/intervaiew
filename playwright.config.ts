import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

const e2eDirectory = join(tmpdir(), `intervaiew-e2e-${process.pid}`);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm db:migrate && pnpm dev --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AI_PROVIDER: "mock",
      DATABASE_PATH: join(e2eDirectory, "intervaiew.db"),
      REALTIME_FAKE_ENABLED: "true",
      TRANSCRIPT_LAB_FAKE_ENABLED: "true",
      QUESTION_BOUNDARY_FAKE_SEMANTIC_ENABLED: "true",
      QUESTION_UNDERSTANDING_FAKE_SEMANTIC_ENABLED: "true",
      QUESTION_BOUNDARY_SHORT_PAUSE_MS: "500",
      QUESTION_BOUNDARY_MEDIUM_PAUSE_MS: "1400",
      QUESTION_BOUNDARY_LONG_PAUSE_MS: "3000",
      OPENAI_REALTIME_ENABLED: "false",
      RECORDINGS_ENABLED: "true",
      RECORDINGS_PATH: join(e2eDirectory, "recordings"),
      UPLOADED_AUDIO_ENABLED: "true",
      UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED: "true",
      UPLOADED_AUDIO_MAX_BYTES: "26214400",
      UPLOADED_AUDIO_PATH: join(e2eDirectory, "uploaded-audio"),
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
