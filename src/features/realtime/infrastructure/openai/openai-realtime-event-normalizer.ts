import type { RealtimeItem } from "@openai/agents/realtime";
import type { RealtimeTranscriptEvent } from "../../domain/realtime.types";
import { z } from "zod";

const transportEventSchema = z.object({
  type: z.string(),
  item_id: z.string().optional(),
  delta: z.string().optional(),
});

export function normalizeRealtimeTransportEvent(event: unknown) {
  const parsed = transportEventSchema.safeParse(event);
  return parsed.success ? parsed.data : null;
}

export function normalizeRealtimeHistory(
  history: RealtimeItem[],
): RealtimeTranscriptEvent[] {
  const now = Date.now();
  const events: RealtimeTranscriptEvent[] = [];
  for (const item of history) {
    if (item.type !== "message" || item.role === "system") continue;
    if (item.role === "user") {
      for (const content of item.content) {
        if (content.type !== "input_audio" || !content.transcript?.trim())
          continue;
        events.push({
          providerItemId: item.itemId,
          role: "candidate",
          text: content.transcript,
          isFinal: item.status === "completed",
          createdAt: now,
        });
      }
      continue;
    }
    for (const content of item.content) {
      const text =
        content.type === "output_audio" ? content.transcript : content.text;
      if (!text?.trim()) continue;
      events.push({
        providerItemId: item.itemId,
        role: "interviewer",
        text,
        isFinal: item.status === "completed",
        createdAt: now,
      });
    }
  }
  return events;
}
