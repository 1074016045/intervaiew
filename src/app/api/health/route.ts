import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { createTextModelProvider } from "@/features/ai/application/text-model-provider-factory";
import { getDatabase } from "@/infrastructure/db/client";
import { getServerEnv } from "@/infrastructure/env/server-env";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
export async function GET() {
  try {
    const env = getServerEnv();
    const provider = createTextModelProvider(env);
    getDatabase().db.run(sql`select 1`);
    const model =
      provider.name === "mock"
        ? "mock-deterministic"
        : provider.name === "deepseek"
          ? env.DEEPSEEK_TEXT_MODEL
          : env.OPENAI_TEXT_MODEL!;
    return NextResponse.json({
      status: "ok",
      provider: provider.name,
      model,
      database: "ok",
    });
  } catch (error) {
    return apiErrorResponse(error, { route: "/api/health" });
  }
}
