import { RealtimeError } from "../../domain/realtime-errors";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 3;
const attempts = new Map<string, number[]>();

export function consumeRealtimeTokenAllowance(sessionId: string, now = Date.now()) {
  for (const [key, values] of attempts) {
    const active = values.filter((time) => now - time < WINDOW_MS);
    if (active.length) attempts.set(key, active);
    else attempts.delete(key);
  }
  const active = attempts.get(sessionId) ?? [];
  if (active.length >= MAX_PER_WINDOW)
    throw new RealtimeError(
      "REALTIME_RATE_LIMITED",
      "Voice connection preparation is temporarily rate limited.",
    );
  active.push(now);
  attempts.set(sessionId, active);
}

export function resetRealtimeTokenRateLimiterForTests() {
  attempts.clear();
}
