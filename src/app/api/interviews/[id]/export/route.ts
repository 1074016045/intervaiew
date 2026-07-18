import { InterviewService } from "@/features/interviews/application/interview-service";
import { InterviewDomainError } from "@/features/interviews/domain/interview-errors";
import {
  buildJsonExport,
  buildTxtExport,
  safeExportFilename,
} from "@/features/transcript/application/export-interview";
import { apiErrorResponse } from "@/shared/errors/api-error";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const format = new URL(request.url).searchParams.get("format");
    if (format !== "txt" && format !== "json")
      throw new InterviewDomainError(
        "INVALID_EXPORT_FORMAT",
        "Export format must be txt or json.",
      );
    const service = new InterviewService();
    const session = service.get(id);
    if (!session)
      throw new InterviewDomainError(
        "INTERVIEW_NOT_FOUND",
        "The interview could not be found.",
      );
    const transcript = service.transcript(id);
    const body =
      format === "txt"
        ? buildTxtExport(session, transcript)
        : JSON.stringify(buildJsonExport(session, transcript), null, 2);
    return new Response(body, {
      headers: {
        "Content-Type":
          format === "txt"
            ? "text/plain; charset=utf-8"
            : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeExportFilename(session.title, format)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error, {
      route: "/api/interviews/[id]/export",
      sessionId: id,
    });
  }
}
