import { NextResponse } from "next/server";
import { z } from "zod";
import { InterviewService } from "@/features/interviews/application/interview-service";
import { RealtimeError } from "@/features/realtime/domain/realtime-errors";
import { createOpenAIRealtimeClientSecret } from "@/features/realtime/infrastructure/server/openai-realtime-client-secret";
import { consumeRealtimeTokenAllowance } from "@/features/realtime/infrastructure/server/realtime-token-rate-limiter";
import { getServerEnv } from "@/infrastructure/env/server-env";
import { assertSameOrigin } from "@/infrastructure/http/same-origin";
import { RealtimeRepository } from "@/infrastructure/repositories/realtime.repository";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";

const requestSchema = z
  .object({ interviewId: z.uuid() })
  .strict();

const noStoreHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

export async function POST(request: Request) {
  let interviewId: string | undefined;
  try {
    assertSameOrigin(request);
    const input = requestSchema.parse(await request.json());
    interviewId = input.interviewId;
    const interview = new InterviewService().get(input.interviewId);
    if (
      !interview ||
      !interview.questions.length ||
      (interview.status !== "ready" && interview.status !== "active")
    )
      throw new RealtimeError(
        "REALTIME_INTERVIEW_NOT_READY",
        "Generate a question plan before starting voice mode.",
      );
    consumeRealtimeTokenAllowance(input.interviewId);
    const env = getServerEnv();
    if (process.env.NODE_ENV !== "production" && env.REALTIME_FAKE_ENABLED) {
      const attempt = new RealtimeRepository().createAttempt({
        sessionId: input.interviewId,
        provider: "fake",
        model: "fake-realtime",
        voice: "fake-voice",
      });
      return NextResponse.json(
        {
          clientSecret: `ek_fake_${crypto.randomUUID()}`,
          expiresAt: Math.floor(Date.now() / 1000) + 3300,
          model: "fake-realtime",
          voice: "fake-voice",
          baseUrl: "http://127.0.0.1",
          transcriptionModel: "fake-transcription",
          silenceDurationMs: 1200,
          maxSessionSeconds: 3300,
          connectTimeoutMs: 20000,
          attemptId: attempt.id,
        },
        { headers: noStoreHeaders },
      );
    }
    const secret = await createOpenAIRealtimeClientSecret(env, {
      title: interview.title,
      language: interview.language,
    });
    const attempt = new RealtimeRepository().createAttempt({
      sessionId: input.interviewId,
      provider: "openai",
      model: env.OPENAI_REALTIME_MODEL,
      voice: env.OPENAI_REALTIME_VOICE,
    });
    return NextResponse.json(
      {
        clientSecret: secret.value,
        expiresAt: secret.expires_at,
        model: env.OPENAI_REALTIME_MODEL,
        voice: env.OPENAI_REALTIME_VOICE,
        baseUrl: env.OPENAI_REALTIME_BASE_URL,
        transcriptionModel: env.OPENAI_REALTIME_TRANSCRIPTION_MODEL,
        silenceDurationMs: env.OPENAI_REALTIME_SILENCE_DURATION_MS,
        maxSessionSeconds: env.OPENAI_REALTIME_MAX_SESSION_SECONDS,
        connectTimeoutMs: env.OPENAI_REALTIME_CONNECT_TIMEOUT_MS,
        attemptId: attempt.id,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    const response = apiErrorResponse(error, {
      route: "/api/realtime/client-secret",
      sessionId: interviewId,
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Pragma", "no-cache");
    return response;
  }
}
