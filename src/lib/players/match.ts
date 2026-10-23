/** Linking Yahoo players to NBA person ids by name and team. */

/** Yahoo editorial team abbreviations that differ from NBA tricodes. */
const YAHOO_TO_NBA_TEAM: Record<string, string> = {
  GS: "GSW",
  GSW: "GSW",
  NY: "NYK",
  NO: "NOP",
  NOR: "NOP",
  SA: "SAS",
  PHO: "PHX",
  UTAH: "UTA",
  WAS: "WAS",
  WSH: "WAS",
  BKN: "BKN",
  BRK: "BKN",
  CHA: "CHA",
  CHO: "CHA",
};

export function nbaTeamAbbr(yahooAbbr: string | null | undefined): string | null {
  if (!yahooAbbr) return null;
  const up = yahooAbbr.toUpperCase();
  return YAHOO_TO_NBA_TEAM[up] ?? up;
}

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** "Luka Dončić" -> "luka doncic", "Jaren Jackson Jr." -> "jaren jackson", "P.J. Washington" -> "pj washington" */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SUFFIXES.has(w))
    .join(" ");
}

export interface MatchCandidate {
  id: number;
  name: string;
  teamAbbr: string | null;
}

/**
 * Picks the candidate with the same normalized name, preferring the same team.
 * Returns null when nothing matches or the match is ambiguous.
 */
export function matchPlayer<T extends MatchCandidate>(
  target: { name: string; teamAbbr: string | null },
  candidates: T[],
): T | null {
  const key = normalizeName(target.name);
  const sameName = candidates.filter((c) => normalizeName(c.name) === key);
  if (sameName.length === 1) return sameName[0];
  const team = nbaTeamAbbr(target.teamAbbr);
  if (team) {
    const sameTeam = sameName.filter((c) => c.teamAbbr === team);
    if (sameTeam.length === 1) return sameTeam[0];
  }
  return null;
}
