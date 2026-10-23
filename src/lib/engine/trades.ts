import { optimizeLineup, type LineupPlayer } from "./lineup";
import { round } from "./values";
import { ACTIVE_SLOTS, type Slot } from "../rules/schema";

export interface TradePlayer {
  playerId: number;
  name: string;
  positions: string[];
  /** Per-game z-score in each category under this league's scoring. */
  categoryZ: Record<string, number>;
  gamesRemaining: number;
  tradeable: boolean; // false for IL slots and players ruled out
}

export interface TradeTeam {
  teamId: number;
  name: string;
  players: TradePlayer[];
}

export interface TradeIdea {
  partnerTeamId: number;
  partnerName: string;
  give: { playerId: number; name: string }[];
  get: { playerId: number; name: string }[];
  /** Rest-of-season value change, weighted by each team's category needs. */
  myGain: number;
  partnerGain: number;
  /** Rest-of-season category changes for each side (unweighted). */
  myCategories: Record<string, number>;
  partnerCategories: Record<string, number>;
  reason: string;
}

/**
 * How much each team needs each category: 1.0 for the league's best team in it,
 * up to 1.5 for the worst, from the sum of the team's per-game z-scores.
 */
export function categoryNeeds(teams: TradeTeam[], categories: string[]): Map<number, Record<string, number>> {
  const out = new Map<number, Record<string, number>>();
  for (const t of teams) out.set(t.teamId, {});
  for (const cat of categories) {
    const strength = teams
      .map((t) => ({ id: t.teamId, s: t.players.reduce((sum, p) => sum + (p.categoryZ[cat] ?? 0), 0) }))
      .sort((a, b) => b.s - a.s);
    strength.forEach(({ id }, rank) => {
      out.get(id)![cat] = 1 + (teams.length > 1 ? (0.5 * rank) / (teams.length - 1) : 0);
    });
  }
  return out;
}

function seasonLine(players: TradePlayer[], categories: string[]): Record<string, number> {
  const line: Record<string, number> = {};
  for (const c of categories) line[c] = players.reduce((s, p) => s + (p.categoryZ[c] ?? 0) * p.gamesRemaining, 0);
  return line;
}

function weighted(line: Record<string, number>, needs: Record<string, number>): number {
  return Object.entries(line).reduce((s, [c, v]) => s + v * (needs[c] ?? 1), 0);
}

/** Whether a roster can still fill every starting slot (positions only). */
function canFillStarters(players: TradePlayer[], slots: Partial<Record<Slot, number>>): boolean {
  const needed = ACTIVE_SLOTS.reduce((s, slot) => s + (slots[slot] ?? 0), 0);
  const lp: LineupPlayer[] = players
    .filter((p) => p.tradeable)
    .map((p) => ({ playerId: p.playerId, positions: p.positions, value: 1, hasGame: true }));
  return optimizeLineup(lp, slots).starters >= Math.min(needed, lp.length);
}

function combos<T>(items: T[], size: number): T[][] {
  if (size === 1) return items.map((i) => [i]);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) out.push([items[i], items[j]]);
  return out;
}

/**
 * 1-for-1 and 2-for-1 trades (either direction) that help you while the other team
 * loses nothing, measured over the rest of the season with each team's category
 * needs. The side receiving two players drops its least valuable player; the side
 * sending two picks up the best free agent with the open spot.
 * Both rosters must still fill their starting slots.
 */
export function findTrades(input: {
  me: TradeTeam;
  others: TradeTeam[];
  categories: string[];
  rosterSlots: Partial<Record<Slot, number>>;
  /** The best free agent: a team left with an open roster spot picks him up. */
  replacement?: TradePlayer;
  maxIdeas?: number;
}): TradeIdea[] {
  const { me, others, categories, rosterSlots } = input;
  const needs = categoryNeeds([me, ...others], categories);
  const value = (team: TradeTeam, ps: TradePlayer[]) => weighted(seasonLine(ps, categories), needs.get(team.teamId)!);
  const candidates: (TradeIdea & { _give: TradePlayer[]; _get: TradePlayer[]; _partner: TradeTeam })[] = [];

  for (const partner of others) {
    const mine = me.players.filter((p) => p.tradeable);
    const theirs = partner.players.filter((p) => p.tradeable);
    for (const [g, r] of [
      [1, 1],
      [2, 1],
      [1, 2],
    ] as const) {
      for (const give of combos(mine, g)) {
        for (const get of combos(theirs, r)) {
          const after = (team: TradeTeam, out: TradePlayer[], inn: TradePlayer[]) => {
            let roster = [...team.players.filter((p) => !out.includes(p)), ...inn];
            // Sending more players than you receive frees a spot for the best free agent.
            for (let open = out.length - inn.length; open > 0 && input.replacement; open--) roster.push(input.replacement);
            // Receiving more players than you send means dropping your least valuable one.
            for (let extra = inn.length - out.length; extra > 0; extra--) {
              const cut = roster.filter((p) => p.tradeable && !inn.includes(p)).sort((a, b) => value(team, [a]) - value(team, [b]))[0];
              roster = roster.filter((p) => p !== cut);
            }
            return roster;
          };
          const myAfter = after(me, give, get);
          const theirAfter = after(partner, get, give);
          const myGain = value(me, myAfter) - value(me, me.players);
          const partnerGain = value(partner, theirAfter) - value(partner, partner.players);
          if (myGain <= 0 || partnerGain < 0) continue;
          const myCats = diff(seasonLine(myAfter, categories), seasonLine(me.players, categories));
          const theirCats = diff(seasonLine(theirAfter, categories), seasonLine(partner.players, categories));
          candidates.push({
            partnerTeamId: partner.teamId,
            partnerName: partner.name,
            give: give.map((p) => ({ playerId: p.playerId, name: p.name })),
            get: get.map((p) => ({ playerId: p.playerId, name: p.name })),
            myGain: round(myGain, 1),
            partnerGain: round(partnerGain, 1),
            myCategories: myCats,
            partnerCategories: theirCats,
            reason: `You gain ${top(myCats)}; ${partner.name} gains ${top(theirCats)}`,
            _give: give,
            _get: get,
            _partner: partner,
          });
        }
      }
    }
  }

  // Best for you first; check roster legality only for the ones that would be shown.
  candidates.sort((a, b) => b.myGain - a.myGain);
  const out: TradeIdea[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (out.length >= (input.maxIdeas ?? 5)) break;
    const key = [...c.give.map((p) => p.playerId)].sort().join(",");
    if (seen.has(key)) continue; // one idea per package you'd give up
    if (out.filter((o) => o.partnerTeamId === c.partnerTeamId).length >= 2) continue; // spread across teams
    const myAfter = [...me.players.filter((p) => !c._give.includes(p)), ...c._get];
    const theirAfter = [...c._partner.players.filter((p) => !c._get.includes(p)), ...c._give];
    if (!canFillStarters(myAfter, rosterSlots) || !canFillStarters(theirAfter, rosterSlots)) continue;
    seen.add(key);
    const { _give, _get, _partner, ...idea } = c;
    void _give;
    void _get;
    void _partner;
    out.push(idea);
  }
  return out;
}

function diff(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.keys(a).map((k) => [k, round(a[k] - (b[k] ?? 0), 1)]));
}

/** The two categories that improve most, e.g. "BLK, REB". */
function top(cats: Record<string, number>): string {
  const best = Object.entries(cats)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);
  return best.length ? best.join(", ") : "overall value";
}
