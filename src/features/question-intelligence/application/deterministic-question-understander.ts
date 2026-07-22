import {
  questionUnderstandingAnalysisSchema,
  requestedDimensionVocabulary,
  type ClarificationReason,
  type ExpectedAnswerMode,
  type QuestionFamily,
  type QuestionUnderstandingAnalysis,
  type RequestedDimension,
} from "../domain/question-understanding";

type NamedRule = Readonly<{ code: string; patterns: ReadonlyArray<RegExp> }>;
type FamilyRule = NamedRule & Readonly<{ family: QuestionFamily; mode: ExpectedAnswerMode; confidence: number }>;
export type DeterministicUnderstandingResult = Readonly<QuestionUnderstandingAnalysis & {
  signals: ReadonlyArray<string>;
  ambiguous: boolean;
  multiIntent: boolean;
}>;

const familyRules: ReadonlyArray<FamilyRule> = [
  { code: "clarification", family: "clarification", mode: "concise_fact", confidence: .94, patterns: [/\b(?:could you|can you) clarify\b|\bwhat do you mean\b|\bcould you repeat\b/iu, /(?:请澄清|什么意思|能再说一遍|可以解释一下你的问题)/u] },
  { code: "motivation", family: "motivation", mode: "explanation", confidence: .94, patterns: [/\bwhy (?:this|our) company\b|\bwhy do you want to (?:work|join)\b/iu, /为什么选择(?:我们|这家公司)|为什么想加入/u] },
  { code: "role_fit", family: "role_fit", mode: "explanation", confidence: .94, patterns: [/\bwhy (?:this|the) role\b|\bwhy should we hire you\b|\bwhy are you (?:a )?(?:good )?fit\b/iu, /为什么(?:你)?适合|为什么应该录用你|为什么选择这个岗位/u] },
  { code: "leadership", family: "leadership", mode: "narrative", confidence: .92, patterns: [/\b(?:led|lead|leadership|managed a team|influenced)\b/iu, /(?:领导|带领团队|管理团队|影响他人)/u] },
  { code: "collaboration", family: "collaboration", mode: "narrative", confidence: .91, patterns: [/\b(?:collaborat|teamwork|stakeholder|cross-functional|conflict|disagreement)\w*\b/iu, /(?:协作|合作|团队合作|跨部门|利益相关者|冲突|分歧)/u] },
  { code: "project", family: "project_experience", mode: "narrative", confidence: .95, patterns: [/\b(?:tell me about|describe|walk me through) (?:a |your )?project\b/iu, /(?:介绍一个项目|讲讲你的项目|描述你的项目|介绍你的项目)/u] },
  { code: "system_design", family: "system_design", mode: "design", confidence: .95, patterns: [/\b(?:system design|design|architect)\b|\bhow (?:would|do) you scale\b/iu, /(?:系统设计|设计一个|架构|如何扩展)/u] },
  { code: "coding", family: "coding", mode: "code", confidence: .95, patterns: [/\b(?:implement|write code|algorithm|data structure)\b/iu, /(?:实现|写代码|算法|数据结构)/u] },
  { code: "quantitative", family: "quantitative", mode: "calculation", confidence: .95, patterns: [/\b(?:calculate|estimate|probability|expected value)\b/iu, /(?:计算|估算|概率|期望)/u] },
  { code: "situational", family: "situational", mode: "narrative", confidence: .92, patterns: [/\b(?:what would you do|how would you handle|suppose|if you)\b/iu, /^(?:如果|你会怎么|你将如何处理)/u] },
  { code: "behavioral", family: "behavioral", mode: "narrative", confidence: .95, patterns: [/\b(?:tell me about a time|describe a situation|give me an example)\b/iu, /(?:讲一次|描述一个经历|举个例子)/u] },
  { code: "technical", family: "technical_concept", mode: "explanation", confidence: .9, patterns: [/\b(?:explain|what is|how does)\b/iu, /(?:为什么|是什么|如何工作|请解释)/u] },
];

const dimensionRules: ReadonlyArray<NamedRule & { dimension: RequestedDimension }> = [
  { code: "context", dimension: "context", patterns: [/\b(?:context|situation|background)\b/iu, /(?:背景|情境|情况)/u] },
  { code: "goal", dimension: "goal", patterns: [/\b(?:goal|objective)\b/iu, /(?:目标)/u] },
  { code: "challenge", dimension: "challenge", patterns: [/\b(?:challenge|difficult)\w*\b/iu, /(?:挑战|困难|难点)/u] },
  { code: "responsibility", dimension: "responsibility", patterns: [/\b(?:your role|responsibilit)\w*\b/iu, /(?:你的角色|职责|负责)/u] },
  { code: "actions", dimension: "actions", patterns: [/\b(?:actions?|steps?|what did you do)\b/iu, /(?:行动|步骤|怎么做|做了什么)/u] },
  { code: "reasoning", dimension: "reasoning", patterns: [/\b(?:reasoning|why|rationale)\b/iu, /(?:为什么|理由|推理)/u] },
  { code: "implementation", dimension: "implementation", patterns: [/\b(?:implement|implementation)\b/iu, /(?:实现)/u] },
  { code: "technical_details", dimension: "technical_details", patterns: [/\b(?:technical details?|internals?)\b/iu, /(?:技术细节|内部原理)/u] },
  { code: "assumptions", dimension: "assumptions", patterns: [/\b(?:assumptions?|assume)\b/iu, /(?:假设|前提)/u] },
  { code: "constraints", dimension: "constraints", patterns: [/\b(?:constraints?|limitations?)\b/iu, /(?:约束|限制)/u] },
  { code: "tradeoffs", dimension: "tradeoffs", patterns: [/\btrade[- ]?offs?\b/iu, /(?:权衡|取舍)/u] },
  { code: "alternatives", dimension: "alternatives", patterns: [/\b(?:alternatives?|other approaches?)\b/iu, /(?:替代方案|其他方案)/u] },
  { code: "collaboration_dim", dimension: "collaboration", patterns: [/\b(?:collaborat|teamwork|stakeholder)\w*\b/iu, /(?:协作|合作|团队|跨部门)/u] },
  { code: "leadership_dim", dimension: "leadership", patterns: [/\b(?:leadership|led|lead a team)\b/iu, /(?:领导|带领团队)/u] },
  { code: "conflict", dimension: "conflict", patterns: [/\b(?:conflict|disagreement)\b/iu, /(?:冲突|分歧)/u] },
  { code: "failure", dimension: "failure", patterns: [/\b(?:fail|mistake|went wrong)\w*\b/iu, /(?:失败|错误|失误)/u] },
  { code: "recovery", dimension: "recovery", patterns: [/\b(?:recover|recovery|fixed it|remediat)\w*\b/iu, /(?:恢复|补救|修复)/u] },
  { code: "outcome", dimension: "outcome", patterns: [/\b(?:outcome|result)\w*\b/iu, /(?:结果|成果)/u] },
  { code: "impact", dimension: "impact", patterns: [/\bimpact\b/iu, /(?:影响|价值)/u] },
  { code: "metrics", dimension: "metrics", patterns: [/\b(?:metrics?|measure|quantif)\w*\b/iu, /(?:指标|数据|量化)/u] },
  { code: "lessons", dimension: "lessons", patterns: [/\b(?:lesson|learned|takeaway)\w*\b/iu, /(?:教训|学到|收获)/u] },
  { code: "complexity", dimension: "complexity", patterns: [/\b(?:complexity|big[- ]?o)\b/iu, /(?:复杂度)/u] },
  { code: "edge_cases", dimension: "edge_cases", patterns: [/\bedge cases?\b/iu, /(?:边界情况|边界条件)/u] },
  { code: "testing", dimension: "testing", patterns: [/\b(?:test|testing)\b/iu, /(?:测试)/u] },
  { code: "scalability", dimension: "scalability", patterns: [/\b(?:scale|scalability|scalable)\b/iu, /(?:扩展|可扩展性)/u] },
  { code: "reliability", dimension: "reliability", patterns: [/\b(?:reliability|reliable|availability)\b/iu, /(?:可靠性|可用性)/u] },
  { code: "security", dimension: "security", patterns: [/\b(?:security|secure|privacy)\b/iu, /(?:安全|隐私)/u] },
  { code: "clarification_dim", dimension: "clarification", patterns: [/\bclarif\w*\b/iu, /(?:澄清)/u] },
];

const focusPatterns: ReadonlyArray<Readonly<{ normalized: string; pattern: RegExp }>> = [
  { normalized: "python", pattern: /\bPython\b/iu }, { normalized: "javascript", pattern: /\bJavaScript\b/iu },
  { normalized: "sql", pattern: /\bSQL\b/iu }, { normalized: "react", pattern: /\bReact\b/iu },
  { normalized: "api", pattern: /\bAPI(?:s)?\b/u }, { normalized: "database", pattern: /\bdatabases?\b/iu },
  { normalized: "cache", pattern: /\bcach(?:e|ing)\b/iu }, { normalized: "microservices", pattern: /\bmicroservices?\b/iu },
  { normalized: "distributed system", pattern: /\bdistributed systems?\b/iu }, { normalized: "机器学习", pattern: /机器学习/u },
  { normalized: "数据库", pattern: /数据库/u }, { normalized: "缓存", pattern: /缓存/u }, { normalized: "微服务", pattern: /微服务/u },
];

function language(text: string): "en" | "zh" | "mixed" | "unknown" {
  const zh = /\p{Script=Han}/u.test(text); const en = /[A-Za-z]/u.test(text);
  return zh && en ? "mixed" : zh ? "zh" : en ? "en" : "unknown";
}
function matches(rule: NamedRule, text: string) { return rule.patterns.some((pattern) => pattern.test(text)); }
function sourceMatch(text: string, pattern: RegExp) { const match = pattern.exec(text); return match?.[0] ?? null; }

export class DeterministicQuestionUnderstander {
  analyze(source: string): DeterministicUnderstandingResult {
    const text = source.trim();
    const matchedFamilies = familyRules.filter((rule) => matches(rule, text));
    const selected = matchedFamilies[0] ?? { family: "other" as const, mode: "concise_fact" as const, confidence: .45, code: "other" };
    const multipleQuestions = (text.match(/[?？]/gu)?.length ?? 0) > 1 || /\bthen\s+(?:design|explain|calculate|implement)\b|然后(?:设计|解释|计算|实现)/iu.test(text);
    const comparison = /\bcompare\b|\bversus\b|\bvs\.?\b|(?:比较|对比).+(?:和|与)/iu.test(text);
    const mode: ExpectedAnswerMode = multipleQuestions ? "mixed" : comparison ? "comparison" : selected.mode;

    const dimensionSet = new Set<RequestedDimension>();
    const signals = matchedFamilies.map((rule) => `family:${rule.code}`);
    for (const rule of dimensionRules) if (matches(rule, text)) { dimensionSet.add(rule.dimension); signals.push(`dimension:${rule.code}`); }
    const defaults: Partial<Record<QuestionFamily, ReadonlyArray<RequestedDimension>>> = {
      behavioral: ["context", "challenge", "actions", "outcome", "lessons"],
      project_experience: ["context", "responsibility", "implementation", "outcome", "impact"],
      system_design: ["assumptions", "constraints", "tradeoffs", "scalability", "reliability"],
      coding: ["implementation", "complexity", "edge_cases", "testing"],
      quantitative: ["assumptions", "reasoning"], situational: ["actions", "reasoning", "outcome"],
      collaboration: ["context", "collaboration", "conflict", "actions", "outcome"],
      leadership: ["context", "leadership", "actions", "impact"],
    };
    for (const item of defaults[selected.family] ?? []) dimensionSet.add(item);
    const requestedDimensions = requestedDimensionVocabulary.filter((item) => dimensionSet.has(item)).slice(0, 16);

    const rawConstraints: Array<{ kind: "time_limit" | "count" | "technology" | "role" | "scope" | "comparison" | "format"; value: string; sourceText: string; index: number }> = [];
    const constraintPatterns = [
      { kind: "time_limit" as const, pattern: /\b(?:in|within)\s+(?:\d+|one|two|three|four|five)\s+(?:seconds?|minutes?)\b/giu },
      { kind: "time_limit" as const, pattern: /(?:在|用)\s*[一二三四五六七八九十\d]+\s*(?:秒|分钟)(?:内)?/gu },
      { kind: "count" as const, pattern: /\b(?:give|name|list|provide)(?: me)?\s+(?:\d+|one|two|three|four|five)\b/giu },
      { kind: "count" as const, pattern: /(?:给出|列出|说出)\s*[一二三四五六七八九十\d]+(?:个|条|点)/gu },
      { kind: "technology" as const, pattern: /\busing\s+[A-Za-z][A-Za-z0-9+#.-]{0,39}\b/giu },
      { kind: "technology" as const, pattern: /(?:使用|用)\s*(?:Python|JavaScript|Java|C\+\+|Go|Rust|SQL|React)/gu },
      { kind: "role" as const, pattern: /\bas (?:the |a |an )?[A-Za-z][A-Za-z -]{1,50}\b/giu },
      { kind: "role" as const, pattern: /作为[^，。！？,?]{1,30}/gu },
      { kind: "scope" as const, pattern: /\bfocus(?:ing)? on\s+[^,.?]{1,80}/giu },
      { kind: "scope" as const, pattern: /(?:只讨论|重点讨论|聚焦于)[^，。！？]{1,80}/gu },
      { kind: "comparison" as const, pattern: /\bcompare\s+[^,.?]{1,60}\s+(?:and|with|to|versus|vs\.?)\s+[^,.?]{1,60}/giu },
      { kind: "comparison" as const, pattern: /(?:比较|对比)[^，。！？]{1,40}(?:和|与)[^，。！？]{1,40}/gu },
      { kind: "format" as const, pattern: /\b(?:in|as) (?:bullet points?|a table|JSON|pseudocode)\b/giu },
      { kind: "format" as const, pattern: /(?:用|以)(?:要点|表格|JSON|伪代码)(?:形式)?/gu },
    ];
    for (const entry of constraintPatterns) for (const match of text.matchAll(entry.pattern)) rawConstraints.push({ kind: entry.kind, value: match[0].trim().toLocaleLowerCase(), sourceText: match[0], index: match.index });
    rawConstraints.sort((a, b) => a.index - b.index);
    const seenConstraints = new Set<string>();
    const explicitConstraints = rawConstraints.filter((item) => { const key = `${item.kind}:${item.value}`; if (seenConstraints.has(key)) return false; seenConstraints.add(key); return true; }).slice(0, 12).map((item, index) => ({ kind: item.kind, value: item.value, sourceText: item.sourceText, sequence: index + 1 }));

    const rawFocus = focusPatterns.map((item) => { const found = sourceMatch(text, item.pattern); return found ? { normalized: item.normalized, sourceText: found, index: text.indexOf(found) } : null; }).filter((item): item is NonNullable<typeof item> => Boolean(item)).sort((a, b) => a.index - b.index);
    const seenFocus = new Set<string>();
    const focusTerms = rawFocus.filter((item) => { if (seenFocus.has(item.normalized)) return false; seenFocus.add(item.normalized); return true; }).slice(0, 12).map((item, index) => ({ normalized: item.normalized, sourceText: item.sourceText, sequence: index + 1 }));

    const reasons: ClarificationReason[] = [];
    const incomplete = /(?:\b(?:and|but|because|if|when|such as)|(?:以及|但是|因为|如果|例如|比如))\s*[,，.。?？…-]*$/iu.test(text) || text.length < 4;
    if (multipleQuestions) reasons.push("multiple_questions");
    if (incomplete) reasons.push("incomplete_question");
    if (/^(?:what about|how about|why (?:it|that)|can (?:it|that)|它|这个|那个|这件事|那件事)/iu.test(text)) reasons.push("unclear_reference");
    if ((selected.family === "system_design" || selected.family === "coding") && !focusTerms.length && text.length < 12 && text.split(/\s+/u).length < 5) reasons.push("missing_scope");
    const ambiguous = selected.family === "other" || reasons.length > 0;
    if (selected.family === "other" && !reasons.length) reasons.push("ambiguous_subject");
    const requiresClarification = reasons.length > 0;
    const confidence = Math.max(.2, Math.min(1, selected.confidence - (multipleQuestions ? .18 : 0) - (incomplete ? .2 : 0)));
    const parsed = questionUnderstandingAnalysisSchema.parse({
      language: language(text), questionFamily: selected.family, expectedAnswerMode: mode,
      requestedDimensions, explicitConstraints, focusTerms, requiresClarification,
      clarificationReasons: requiresClarification ? reasons : ["none"], confidence,
      decidedBy: "deterministic", semanticProviderUsed: false, status: "completed",
    });
    return Object.freeze({ ...parsed, signals: Object.freeze(signals), ambiguous, multiIntent: multipleQuestions });
  }
}
