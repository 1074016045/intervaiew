import { InterviewForm } from "@/features/interviews/components/interview-form";
export default function NewInterviewPage() {
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Practice Mode</p>
        <h1 style={{ fontSize: "3rem" }}>Create a practice interview</h1>
        <p className="lead">
          Your resume and job description are stored locally. In external
          provider modes, they are sent only when generating the question plan.
        </p>
      </div>
      <InterviewForm />
    </div>
  );
}
