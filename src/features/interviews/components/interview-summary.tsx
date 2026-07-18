import type { InterviewDetailView } from "../domain/interview-view.types";
export function InterviewSummary({
  interview,
}: {
  interview: InterviewDetailView;
}) {
  return (
    <dl className="metadata">
      <div>
        <dt>Target role</dt>
        <dd>{interview.targetRole}</dd>
      </div>
      <div>
        <dt>Company</dt>
        <dd>{interview.targetCompany ?? "—"}</dd>
      </div>
      <div>
        <dt>Type</dt>
        <dd>{interview.interviewType}</dd>
      </div>
      <div>
        <dt>Difficulty</dt>
        <dd>{interview.difficulty}</dd>
      </div>
      <div>
        <dt>Language</dt>
        <dd>{interview.language}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>
          <span className="pill">{interview.status}</span>
        </dd>
      </div>
      <div>
        <dt>Questions</dt>
        <dd>{interview.questionCount}</dd>
      </div>
      <div>
        <dt>Resume</dt>
        <dd>{interview.resumeCharacters.toLocaleString()} characters</dd>
      </div>
      <div>
        <dt>Job description</dt>
        <dd>
          {interview.jobDescriptionCharacters.toLocaleString()} characters
        </dd>
      </div>
    </dl>
  );
}
