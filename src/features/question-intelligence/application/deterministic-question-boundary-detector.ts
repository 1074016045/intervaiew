import type { QuestionBoundaryDetector } from "./question-boundary-detector.port";
import type {
  BoundarySignal,
  DeterministicBoundaryResult,
  QuestionCandidate,
} from "../domain/question-boundary";

const englishQuestionPatterns: ReadonlyArray<readonly [string, RegExp]> = [
  ["english_wh_question", /^(?:who|what|when|where|why|how)\b/iu],
  ["english_tell_me", /\btell me about\b/iu],
  ["english_describe", /^(?:please\s+)?describe\b/iu],
  ["english_explain", /^(?:please\s+)?explain\b/iu],
  ["english_walk_through", /\bwalk me through\b/iu],
  ["english_example_request", /\bgive me an example\b/iu],
  [
    "english_auxiliary_question",
    /^(?:could you|can you|have you|do you|did you|would you)\b/iu,
  ],
  ["english_task_question", /^(?:compare|design|estimate)\b/iu],
];

const chineseQuestionPatterns: ReadonlyArray<readonly [string, RegExp]> = [
  [
    "chinese_question_word",
    /(?:什么|为什么|怎么|如何|哪些|哪一个|是否|能不能)/u,
  ],
  ["chinese_introduction", /(?:可以介绍|请介绍)/u],
  ["chinese_description", /(?:请描述|请解释)/u],
  ["chinese_example_request", /举一个例子/u],
  ["chinese_discuss", /(?:谈谈|说说|讲一下)/u],
  ["chinese_experience", /你有没有/u],
  ["chinese_approach", /(?:你如何|你会怎么)/u],
  ["chinese_task_question", /(?:设计一个|请设计一个|估算)/u],
];

const englishIncompleteEnding =
  /(?:\b(?:and|but|because|so|then|which|that|when|if)|\bfor example|\bsuch as|\bin terms of|\bwith respect to)\s*[,;:.!?…-]*$/iu;
const chineseIncompleteEnding =
  /(?:然后|以及|并且|但是|因为|所以|如果|比如|例如|关于|针对|在(?:…|\.\.\.)方面|还有|或者)\s*[，。！？；：、…-]*$/u;
const connectorOnly =
  /^(?:(?:and|but|because|so|then|which|that|when|if|for example|such as|in terms of|with respect to)|(?:然后|以及|并且|但是|因为|所以|如果|比如|例如|关于|针对|在(?:…|\.\.\.)方面|还有|或者))[\s,.;:!?，。！？；：、…-]*$/iu;
const noiseOnly = /^(?:[\s\p{P}\p{S}]|(?:um+|uh+|erm+|hmm+|嗯+|呃+|啊+))+$/iu;

function signal(
  code: string,
  kind: BoundarySignal["kind"],
  confidence: number,
): BoundarySignal {
  return Object.freeze({ code, kind, confidence });
}

function languageHint(
  text: string,
): DeterministicBoundaryResult["languageHint"] {
  const chinese = /\p{Script=Han}/u.test(text);
  const english = /[A-Za-z]/u.test(text);
  if (chinese && english) return "mixed";
  if (chinese) return "zh";
  if (english) return "en";
  return "unknown";
}

function hasSufficientPhraseContent(text: string) {
  const latinWords =
    text.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/gu)?.length ?? 0;
  const hanCharacters = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  return latinWords >= 4 || hanCharacters >= 6;
}

export class DeterministicQuestionBoundaryDetector implements QuestionBoundaryDetector {
  detect(candidate: QuestionCandidate): DeterministicBoundaryResult {
    const text = candidate.text.trim();
    const signals: BoundarySignal[] = [];
    const language = languageHint(text);

    if (!text || noiseOnly.test(text)) {
      signals.push(signal("meaningless_content", "invalid", 1));
      return this.result("invalid", 1, false, language, signals);
    }

    if (connectorOnly.test(text)) {
      signals.push(signal("connector_only", "invalid", 1));
      return this.result("invalid", 1, false, language, signals);
    }

    const incompleteEnglish = englishIncompleteEnding.test(text);
    const incompleteChinese = chineseIncompleteEnding.test(text);
    if (incompleteEnglish)
      signals.push(signal("english_connector_ending", "incomplete", 0.98));
    if (incompleteChinese)
      signals.push(signal("chinese_connector_ending", "incomplete", 0.98));

    const textWithoutTrailingConnector =
      !incompleteEnglish && !incompleteChinese;
    if (/[?？]\s*$/u.test(text))
      signals.push(signal("question_mark", "complete", 0.9));

    for (const [code, pattern] of englishQuestionPatterns)
      if (pattern.test(text)) signals.push(signal(code, "complete", 0.9));
    for (const [code, pattern] of chineseQuestionPatterns)
      if (pattern.test(text)) signals.push(signal(code, "complete", 0.9));

    const validContent =
      signals.some((item) => item.kind === "complete") ||
      hasSufficientPhraseContent(text);
    if (!validContent) signals.push(signal("short_phrase", "invalid", 0.9));

    if (!textWithoutTrailingConnector)
      return this.result("incomplete", 0.98, validContent, language, signals);
    if (signals.some((item) => item.kind === "complete"))
      return this.result("complete", 0.92, true, language, signals);
    if (!validContent)
      return this.result("invalid", 0.9, false, language, signals);
    signals.push(signal("no_strong_boundary", "incomplete", 0.55));
    return this.result("gray", 0.55, true, language, signals);
  }

  private result(
    classification: DeterministicBoundaryResult["classification"],
    confidence: number,
    validContent: boolean,
    language: DeterministicBoundaryResult["languageHint"],
    signals: ReadonlyArray<BoundarySignal>,
  ): DeterministicBoundaryResult {
    return Object.freeze({
      classification,
      confidence,
      validContent,
      languageHint: language,
      signals: Object.freeze([...signals]),
    });
  }
}
