import { NextResponse } from "next/server";
import { RecordingStorageService } from "@/features/recording/application/recording-storage-service";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  try {
    return NextResponse.json({
      recordings: new RecordingStorageService().list(id),
    });
  } catch (error) {
    return apiErrorResponse(error, {
      route: "/api/interviews/[id]/recordings",
      sessionId: id,
    });
  }
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  try {
    const asset = await new RecordingStorageService().upload(
      id,
      await request.formData(),
    );
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, {
      route: "/api/interviews/[id]/recordings",
      sessionId: id,
    });
  }
}
