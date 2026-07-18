import type { QuestionView } from "@/features/interviews/domain/interview-view.types";

export function QuestionPlanView({
  summary,
  questions,
}: {
  summary: string | null;
  questions: QuestionView[];
}) {
  if (!questions.length)
    return (
      <div className="card">
        <h3>Question plan</h3>
        <p className="muted">No questions generated yet.</p>
      </div>
    );
  return (
    <section className="card stack" aria-label="Question plan">
      <div>
        <h2>Question plan</h2>
        {summary && <p className="muted">{summary}</p>}
      </div>
      {questions.map((item) => (
        <article className="question" key={item.id}>
          <p className="question-number">
            Question {item.sequence} · {item.competency}
          </p>
          <h3>{item.question}</h3>
          <p className="muted">
            <strong>Why this question:</strong> {item.rationale}
          </p>
        </article>
      ))}
    </section>
  );
}
