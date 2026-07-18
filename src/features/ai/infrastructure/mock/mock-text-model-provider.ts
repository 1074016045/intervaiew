import type { TextModelProvider } from "../../domain/text-model.port";
import type {
  TextModelRequest,
  TextModelResponse,
} from "../../domain/text-model.types";

type MockSettings = {
  interviewType?: string;
  language?: string;
  questionCount?: number;
  targetRole?: string;
};
const pools: Record<string, string[]> = {
  behavioral: [
    "Tell me about a time you navigated an ambiguous goal.",
    "Describe a difficult collaboration and how you handled it.",
    "How have you learned from a professional setback?",
  ],
  "general-technical": [
    "Explain a technical decision you made and the trade-offs.",
    "How do you diagnose an unfamiliar production issue?",
    "How do you keep technical knowledge current?",
  ],
  "software-engineering": [
    "Walk through a system you built from requirement to deployment.",
    "How do you design reliable automated tests?",
    "How would you improve a slow and fragile service?",
  ],
  "data-science": [
    "How would you turn an ambiguous business question into an analysis?",
    "How do you detect leakage and bias in a dataset?",
    "How would you communicate uncertainty to stakeholders?",
  ],
  "machine-learning": [
    "Describe how you select a baseline and evaluation metrics.",
    "How do you diagnose model drift in production?",
    "When would you prefer a simpler model?",
  ],
  "llm-generative-ai": [
    "How would you evaluate an LLM feature beyond offline accuracy?",
    "How do you control hallucinations and unsafe output?",
    "How would you choose between prompting, retrieval, and fine-tuning?",
  ],
  "ai-agent-engineering": [
    "Please introduce an AI agent system you designed or studied.",
    "How would you design agent state, tool calls, and error recovery?",
    "How would you evaluate agent reliability and task completion quality?",
    "When should a deterministic workflow be used instead of an autonomous agent?",
    "How do you defend against prompt injection and dangerous tool calls?",
  ],
  "system-design": [
    "Design a reliable service for a rapidly growing workload.",
    "How would you partition data and handle hot keys?",
    "Explain your observability and failure-recovery strategy.",
  ],
  custom: [
    "Which experience best demonstrates your fit for this role?",
    "What is the hardest problem relevant to this position that you have solved?",
    "How would you approach your first ninety days in this role?",
  ],
};

function parseSettings(prompt: string): MockSettings {
  const match = prompt.match(
    /<settings_json>\s*([\s\S]*?)\s*<\/settings_json>/,
  );
  if (!match) return {};
  try {
    return JSON.parse(match[1]) as MockSettings;
  } catch {
    return {};
  }
}
function localize(text: string, language: string | undefined): string {
  if (language === "Chinese") return `请回答：${text}`;
  if (language === "Bilingual") return `${text} / 请用中英文任选其一回答。`;
  return text;
}

export class MockTextModelProvider implements TextModelProvider {
  readonly name = "mock" as const;
  async generate(request: TextModelRequest): Promise<TextModelResponse> {
    const settings = parseSettings(request.userPrompt);
    const count = Math.min(10, Math.max(3, settings.questionCount ?? 3));
    const pool = pools[settings.interviewType ?? "custom"] ?? pools.custom;
    const questions = Array.from({ length: count }, (_, index) => {
      const base = pool[index % pool.length];
      return {
        sequence: index + 1,
        question: localize(base, settings.language),
        competency: [
          "experience",
          "design judgment",
          "reliability",
          "communication",
        ][index % 4],
        rationale: `Assesses evidence and judgment relevant to ${settings.targetRole ?? "the target role"}.`,
        clarification: `Focus on your own experience, decisions, constraints, and measurable outcome for this question.`,
      };
    });
    return {
      content:
        request.responseFormat === "json"
          ? JSON.stringify({
              sessionSummary: `Deterministic practice plan for ${settings.targetRole ?? "the target role"}.`,
              questions,
            })
          : questions.map((question) => question.question).join("\n"),
      provider: this.name,
      model: "mock-deterministic",
    };
  }
}
