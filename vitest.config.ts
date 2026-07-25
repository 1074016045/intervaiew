import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/fixtures/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.ts",
    ],
    env: {
      AI_PROVIDER: "mock",
      DATABASE_PATH: ":memory:",
      QUESTION_BOUNDARY_FAKE_SEMANTIC_ENABLED: "true",
      QUESTION_UNDERSTANDING_FAKE_SEMANTIC_ENABLED: "true",
      UPLOADED_AUDIO_ENABLED: "true",
      UPLOADED_AUDIO_TRANSCRIPTION_WORKER_ENABLED: "true",
      UPLOADED_AUDIO_FAKE_TRANSCRIPTION_ENABLED: "true",
      UPLOADED_AUDIO_MAX_BYTES: "26214400",
      QUESTION_BOUNDARY_SHORT_PAUSE_MS: "500",
      QUESTION_BOUNDARY_MEDIUM_PAUSE_MS: "1400",
      QUESTION_BOUNDARY_LONG_PAUSE_MS: "3000",
    },
    restoreMocks: true,
  },
});
