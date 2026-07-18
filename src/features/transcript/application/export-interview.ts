type ExportDetail = NonNullable<
  ReturnType<
    import("@/features/interviews/application/interview-service").InterviewService["get"]
  >
>;
type ExportTranscript = ReturnType<
  import("@/features/interviews/application/interview-service").InterviewService["transcript"]
>;

export function buildJsonExport(
  session: ExportDetail,
  transcript: ExportTranscript,
) {
  return {
    session,
    questionPlan: {
      summary: session.questionPlanSummary,
      questions: session.questions,
    },
    transcript,
  };
}

export function buildTxtExport(
  session: ExportDetail,
  transcript: ExportTranscript,
) {
  const duration =
    session.durationSeconds == null ? "—" : `${session.durationSeconds}s`;
  const questionPlan = session.questions
    .map((question) => `${question.sequence}. ${question.question}`)
    .join("\n");
  const base = session.startedAt?.getTime() ?? session.createdAt.getTime();
  const items = transcript
    .map((item) => {
      const elapsed = Math.max(
        0,
        Math.floor((item.createdAt.getTime() - base) / 1000),
      );
      const time = new Date(elapsed * 1000).toISOString().slice(11, 19);
      const role = item.role[0].toUpperCase() + item.role.slice(1);
      return `[${time}] ${role}\n${item.text}`;
    })
    .join("\n\n");
  return `IntervAIew — 面面具到

Title: ${session.title}
Target role: ${session.targetRole}
Company: ${session.targetCompany ?? "—"}
Interview type: ${session.interviewType}
Difficulty: ${session.difficulty}
Language: ${session.language}
AI provider: ${session.aiProvider ?? "—"}
Date: ${session.createdAt.toISOString()}
Duration: ${duration}
Status: ${session.status}

Question Plan

${questionPlan}

Transcript

${items}
`;
}

export function safeExportFilename(title: string, extension: "txt" | "json") {
  const safe =
    title
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "interview";
  return `${safe}.${extension}`;
}
