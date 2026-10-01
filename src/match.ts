/**
 * Normalizes a game/app name so that small differences between Steam and the
 * host app list (case, trademark symbols, accents, punctuation) do not matter.
 */
export function normalizeName(name: string): string {
  return name
    .replace(/[™®©'’`]/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Returns the host app matching the game name, if any. */
export function findHostApp(gameName: string, apps: readonly string[]): string | null {
  if (apps.includes(gameName)) {
    return gameName;
  }

  const normalized = normalizeName(gameName);
  return apps.find((app) => normalizeName(app) === normalized) ?? null;
}

/** Faster lookup for many games against the same app list. */
export function createMatcher(apps: readonly string[]): (gameName: string) => string | null {
  const byName = new Map<string, string>();
  for (const app of apps) {
    const key = normalizeName(app);
    if (!byName.has(key)) {
      byName.set(key, app);
    }
  }
  return (gameName) => (apps.includes(gameName) ? gameName : byName.get(normalizeName(gameName)) ?? null);
}

export interface HostGame {
  host: string;
  hostApp: string;
}

/** Hosts whose app list has the game, with the matching app name, in the given order. */
export function findHostsForGame(gameName: string, hosts: ReadonlyArray<{ name: string; apps: readonly string[] }>): HostGame[] {
  const result: HostGame[] = [];
  for (const host of hosts) {
    const hostApp = findHostApp(gameName, host.apps);
    if (hostApp !== null) {
      result.push({ host: host.name, hostApp });
    }
  }
  return result;
}
