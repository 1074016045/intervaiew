const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

export type RetentionPolicyCandidate = Readonly<{
  createdAt: string;
  tieBreaker: string;
}>;

export type RetentionPolicySelection<T extends RetentionPolicyCandidate> =
  Readonly<{
    eligible: readonly T[];
    retainedByAge: readonly T[];
    retainedByKeepLatest: readonly T[];
  }>;

function compareTieBreakerDescending(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

export function selectBackupRetentionCandidates<
  T extends RetentionPolicyCandidate,
>(
  candidates: readonly T[],
  policy: Readonly<{ maxAgeDays: number; keepLatest: number; now: Date }>,
): RetentionPolicySelection<T> {
  const newestFirst = [...candidates].sort((left, right) => {
    const dateOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return (
      dateOrder ||
      compareTieBreakerDescending(left.tieBreaker, right.tieBreaker)
    );
  });
  const protectedCandidates = new Set(newestFirst.slice(0, policy.keepLatest));
  const cutoff = policy.now.valueOf() - policy.maxAgeDays * DAY_MILLISECONDS;
  const eligible: T[] = [];
  const retainedByAge: T[] = [];
  const retainedByKeepLatest: T[] = [];

  for (const candidate of newestFirst) {
    if (protectedCandidates.has(candidate)) {
      retainedByKeepLatest.push(candidate);
    } else if (Date.parse(candidate.createdAt) < cutoff) {
      eligible.push(candidate);
    } else {
      retainedByAge.push(candidate);
    }
  }
  return Object.freeze({ eligible, retainedByAge, retainedByKeepLatest });
}
