import type { ClarificationReason, ExpectedAnswerMode, QuestionFamily, RequestedDimension } from "../domain/question-understanding";

export type QuestionUnderstandingFixture = Readonly<{
  id: string; text: string; expectedFamily: QuestionFamily; expectedMode: ExpectedAnswerMode;
  expectedDimensions: ReadonlyArray<RequestedDimension>; expectedClarification: boolean;
  expectedClarificationReasons?: ReadonlyArray<ClarificationReason>;
}>;

const f = (id: string, text: string, expectedFamily: QuestionFamily, expectedMode: ExpectedAnswerMode, expectedDimensions: ReadonlyArray<RequestedDimension> = [], expectedClarification = false, expectedClarificationReasons?: ReadonlyArray<ClarificationReason>): QuestionUnderstandingFixture =>
  Object.freeze({ id, text, expectedFamily, expectedMode, expectedDimensions: Object.freeze([...expectedDimensions]), expectedClarification, expectedClarificationReasons });

export const questionUnderstandingFixtures: ReadonlyArray<QuestionUnderstandingFixture> = Object.freeze([
  f("behavioral-en-1", "Tell me about a time you faced a challenge and what you learned.", "behavioral", "narrative", ["context", "challenge", "actions", "outcome", "lessons"]),
  f("behavioral-en-2", "Describe a situation where you made a mistake and recovered.", "behavioral", "narrative", ["context", "challenge", "actions", "failure", "recovery", "outcome", "lessons"]),
  f("behavioral-en-3", "Give me an example of a difficult decision and its outcome.", "behavioral", "narrative", ["context", "challenge", "actions", "outcome", "lessons"]),
  f("behavioral-zh-1", "讲一次你遇到挑战并采取行动的经历，以及最终结果。", "behavioral", "narrative", ["context", "challenge", "actions", "outcome", "lessons"]),
  f("behavioral-zh-2", "描述一个经历：你犯了错误后如何补救，又学到了什么？", "behavioral", "narrative", ["context", "challenge", "actions", "failure", "recovery", "outcome", "lessons"]),
  f("behavioral-zh-3", "举个例子，说明你怎样解决困难并量化结果。", "behavioral", "narrative", ["context", "challenge", "actions", "outcome", "metrics", "lessons"]),

  f("project-en-1", "Tell me about a project and your role, implementation, and impact.", "project_experience", "narrative", ["context", "responsibility", "implementation", "outcome", "impact"]),
  f("project-en-2", "Describe your project, its technical details, and the metrics you used.", "project_experience", "narrative", ["context", "responsibility", "implementation", "technical_details", "outcome", "impact", "metrics"]),
  f("project-zh-1", "介绍一个项目，说明你的职责、实现细节和成果。", "project_experience", "narrative", ["context", "responsibility", "implementation", "outcome", "impact"]),
  f("project-zh-2", "讲讲你的项目，以及项目的难点和量化影响。", "project_experience", "narrative", ["context", "challenge", "responsibility", "implementation", "outcome", "impact", "metrics"]),

  f("technical-en-1", "Explain how a database index works.", "technical_concept", "explanation", ["technical_details" ]),
  f("technical-en-2", "What is eventual consistency and what are its tradeoffs?", "technical_concept", "explanation", ["tradeoffs", "reliability"]),
  f("technical-en-3", "How does caching improve scalability and reliability?", "technical_concept", "explanation", ["scalability", "reliability"]),
  f("technical-zh-1", "为什么数据库索引可以提高查询速度？", "technical_concept", "explanation", ["reasoning"]),
  f("technical-zh-2", "最终一致性是什么，它有哪些权衡？", "technical_concept", "explanation", ["tradeoffs", "reliability"]),
  f("technical-zh-3", "缓存是如何工作的？请说明技术细节。", "technical_concept", "explanation", ["technical_details"]),

  f("coding-en-1", "Implement a queue using Python and explain complexity and edge cases.", "coding", "code", ["implementation", "complexity", "edge_cases", "testing"]),
  f("coding-en-2", "Write code for this algorithm and describe testing.", "coding", "code", ["implementation", "complexity", "edge_cases", "testing"]),
  f("coding-zh-1", "使用 Python 实现一个队列，并说明复杂度和边界情况。", "coding", "code", ["implementation", "complexity", "edge_cases", "testing"]),
  f("coding-zh-2", "写代码实现这个算法，并说明如何测试。", "coding", "code", ["implementation", "complexity", "edge_cases", "testing"]),

  f("quant-en-1", "Calculate the probability and state your assumptions.", "quantitative", "calculation", ["reasoning", "assumptions"]),
  f("quant-en-2", "Estimate the expected value in two minutes.", "quantitative", "calculation", ["assumptions", "reasoning"]),
  f("quant-zh-1", "计算这个事件的概率，并说明假设。", "quantitative", "calculation", ["reasoning", "assumptions"]),
  f("quant-zh-2", "在两分钟内估算期望值。", "quantitative", "calculation", ["assumptions", "reasoning"]),

  f("design-en-1", "Design a distributed system and discuss assumptions, constraints, tradeoffs, scalability, reliability, and security.", "system_design", "design", ["assumptions", "constraints", "tradeoffs", "scalability", "reliability", "security"]),
  f("design-en-2", "Architect a secure API that can scale.", "system_design", "design", ["assumptions", "constraints", "tradeoffs", "scalability", "reliability", "security"]),
  f("design-zh-1", "设计一个可扩展且可靠的缓存系统，并讨论权衡。", "system_design", "design", ["assumptions", "constraints", "tradeoffs", "scalability", "reliability"]),
  f("design-zh-2", "系统设计：如何扩展数据库并保证安全？", "system_design", "design", ["assumptions", "constraints", "tradeoffs", "scalability", "reliability", "security"]),

  f("situational-en-1", "What would you do if a production deployment failed?", "situational", "narrative", ["actions", "reasoning", "failure", "outcome"]),
  f("situational-en-2", "How would you handle an unclear requirement?", "situational", "narrative", ["actions", "reasoning", "outcome"]),
  f("situational-zh-1", "如果上线失败，你会怎么处理和恢复？", "situational", "narrative", ["actions", "reasoning", "failure", "recovery", "outcome"]),
  f("situational-zh-2", "你会怎么处理需求范围不明确的情况？", "situational", "narrative", ["actions", "reasoning", "outcome"]),

  f("motivation-en-1", "Why this company? Give me three reasons.", "motivation", "explanation"),
  f("motivation-en-2", "Why do you want to join our company?", "motivation", "explanation"),
  f("motivation-zh-1", "为什么选择我们这家公司？请给出三个理由。", "motivation", "explanation", ["reasoning"]),
  f("role-fit-en-1", "Why this role?", "role_fit", "explanation"),
  f("role-fit-en-2", "Why should we hire you for this role?", "role_fit", "explanation"),
  f("role-fit-zh-1", "为什么你适合这个岗位？", "role_fit", "explanation", ["reasoning"]),

  f("collab-en-1", "Tell me about a conflict with a stakeholder and how you collaborated.", "collaboration", "narrative", ["context", "challenge", "actions", "collaboration", "conflict", "outcome"]),
  f("collab-zh-1", "讲一次跨部门协作中的分歧，以及你采取的行动和结果。", "collaboration", "narrative", ["context", "challenge", "actions", "collaboration", "conflict", "outcome"]),
  f("leadership-en-1", "Tell me about a time you led a team and measured the impact.", "leadership", "narrative", ["context", "actions", "leadership", "impact", "metrics"]),
  f("leadership-zh-1", "描述一个你带领团队完成目标并产生影响的经历。", "leadership", "narrative", ["context", "goal", "actions", "leadership", "impact"]),

  f("clarify-en-1", "Could you clarify what scope you mean?", "clarification", "concise_fact", ["clarification"]),
  f("clarify-zh-1", "请澄清你所说的范围是什么意思？", "clarification", "concise_fact", ["clarification"]),
  f("other-en-1", "How are you today?", "other", "concise_fact", [], true, ["ambiguous_subject"]),
  f("other-zh-1", "今天感觉怎么样？", "other", "concise_fact", [], true, ["ambiguous_subject"]),

  f("comparison-en", "Compare SQL and NoSQL databases.", "other", "comparison", [], true, ["ambiguous_subject"]),
  f("comparison-zh", "比较 SQL 和 NoSQL 数据库。", "other", "comparison", [], true, ["ambiguous_subject"]),
  f("multiple-en", "Explain caching? Then design a scalable cache?", "system_design", "mixed", ["assumptions", "constraints", "tradeoffs", "scalability", "reliability"], true, ["multiple_questions"]),
  f("multiple-zh", "缓存是什么？然后设计一个可扩展缓存？", "system_design", "mixed", ["assumptions", "constraints", "tradeoffs", "scalability", "reliability"], true, ["multiple_questions"]),
  f("incomplete-en", "Tell me about a time when", "behavioral", "narrative", ["context", "challenge", "actions", "outcome", "lessons"], true, ["incomplete_question"]),
  f("incomplete-zh", "讲一次你遇到挑战如果", "behavioral", "narrative", ["context", "challenge", "actions", "outcome", "lessons"], true, ["incomplete_question"]),
  f("reference-en", "What about that?", "other", "concise_fact", [], true, ["unclear_reference"]),
  f("reference-zh", "这个怎么样？", "other", "concise_fact", [], true, ["unclear_reference"]),
  f("mixed-language", "请 explain how database caching works？", "technical_concept", "explanation", ["technical_details"]),
  f("fake-fallback", "How are you today? [fake-fail]", "other", "concise_fact", [], true, ["ambiguous_subject"]),
]);
