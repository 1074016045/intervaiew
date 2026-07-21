export function VoiceLevelIndicator({ active }: { active: boolean }) {
  return (
    <span className={`voice-level ${active ? "active" : ""}`} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}
