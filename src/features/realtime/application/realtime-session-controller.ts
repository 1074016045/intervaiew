import { RealtimeError } from "../domain/realtime-errors";
import type { RealtimeConnectionState } from "../domain/realtime.types";

const transitions: Record<RealtimeConnectionState, RealtimeConnectionState[]> = {
  idle: ["requesting-permission", "connecting", "disconnected"],
  "requesting-permission": ["connecting", "idle", "failed"],
  connecting: ["connected", "disconnecting", "disconnected", "failed"],
  connected: ["reconnecting", "disconnecting", "disconnected", "failed"],
  reconnecting: ["connected", "disconnecting", "disconnected", "failed"],
  disconnecting: ["disconnected"],
  disconnected: ["reconnecting", "connecting", "idle"],
  failed: ["connecting", "reconnecting", "disconnecting", "disconnected"],
};

export class RealtimeSessionController {
  constructor(private state: RealtimeConnectionState = "idle") {}

  getState() {
    return this.state;
  }

  transition(next: RealtimeConnectionState) {
    if (next === this.state) return this.state;
    if (!transitions[this.state].includes(next)) {
      throw new RealtimeError(
        "REALTIME_INVALID_STATE",
        `Cannot transition realtime connection from ${this.state} to ${next}.`,
      );
    }
    this.state = next;
    return this.state;
  }
}
