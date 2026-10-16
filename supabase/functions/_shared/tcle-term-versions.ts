/**
 * A retry is bound to the exact document already stored. Historical versions
 * are recovery-only: they never become eligible for a new submission.
 * Identity, request limits and signature checks remain in the caller.
 */
export function matchesStoredTcleVersion(
  previous: Record<string, unknown>,
  payload: Record<string, unknown>,
  type: string,
  knownHashes: Readonly<Record<string, string>>,
): boolean {
  const version = previous.versao_termo;
  if (typeof version !== "string" || !Object.hasOwn(knownHashes, version)) {
    return false;
  }
  const hash = knownHashes[version];
  return previous.tipo === type && payload.tipo === type &&
    previous.termo_sha256 === hash && payload.versao_termo === version &&
    payload.termo_sha256 === hash;
}
