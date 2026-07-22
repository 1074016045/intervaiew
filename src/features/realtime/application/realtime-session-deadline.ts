export class RealtimeSessionDeadline {
  private warningTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  start(input: {
    maxSessionSeconds: number;
    onWarning: () => void;
    onExpired: () => void;
  }) {
    this.clear();
    const warningMs = Math.max(0, (input.maxSessionSeconds - 60) * 1000);
    this.warningTimer = setTimeout(input.onWarning, warningMs);
    this.endTimer = setTimeout(input.onExpired, input.maxSessionSeconds * 1000);
  }

  clear() {
    if (this.warningTimer) clearTimeout(this.warningTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.warningTimer = null;
    this.endTimer = null;
  }
}
