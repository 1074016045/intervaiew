import type { AiProviderName } from "./ai-provider-name";
import type { TextModelRequest, TextModelResponse } from "./text-model.types";

export interface TextModelProvider {
  readonly name: AiProviderName;
  generate(request: TextModelRequest): Promise<TextModelResponse>;
}
