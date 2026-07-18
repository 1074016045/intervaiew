import { AiError } from "../domain/ai-errors";

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof AiError) ||
        !error.retryable ||
        attempt >= maxRetries
      )
        throw error;
      await sleep(Math.min(250 * 2 ** attempt, 2_000));
      attempt += 1;
    }
  }
}
