import { ACTIVE_SLOTS, type Slot } from "../rules/schema";

/** Which player positions can fill each starting slot. */
export function slotAccepts(slot: Slot, positions: string[]): boolean {
  switch (slot) {
    case "UTIL":
      return positions.length > 0;
    case "G":
      return positions.some((p) => p === "PG" || p === "SG" || p === "G");
    case "F":
      return positions.some((p) => p === "SF" || p === "PF" || p === "F");
    default:
      return positions.includes(slot);
  }
}

export interface LineupPlayer {
  playerId: number;
  positions: string[];
  /** Expected value today (already zero for players with no game or ruled out). */
  value: number;
  hasGame: boolean;
  /** Players in an IL slot stay there. */
  onInjuredList?: boolean;
}

export interface LineupResult {
  assignments: Map<number, Slot | "BN" | "IL">;
  starters: number;
  totalValue: number;
}

/**
 * Fills the starting slots to maximize the number of players with a game who
 * start, then the total value. Solved exactly with a DP over slot bitmasks
 * (a roster has ~10 starting slots, so at most ~1k masks per player).
 */
export function optimizeLineup(
  players: LineupPlayer[],
  slotCounts: Partial<Record<Slot, number>>,
): LineupResult {
  const slots: Slot[] = [];
  for (const s of ACTIVE_SLOTS) for (let i = 0; i < (slotCounts[s] ?? 0); i++) slots.push(s);

  const assignments = new Map<number, Slot | "BN" | "IL">();
  const candidates = players.filter((p) => {
    if (p.onInjuredList) {
      assignments.set(p.playerId, "IL");
      return false;
    }
    assignments.set(p.playerId, "BN");
    return p.hasGame;
  });

  if (slots.length > 18) return greedy(candidates, slots, assignments);

  // Starting a player always beats leaving a slot empty; value breaks ties.
  const BIG = 1e6;
  const score = (p: LineupPlayer) => BIG + p.value;

  // best[mask] = best score using the first i candidates with slots `mask` filled.
  type State = { score: number; picks: [number, number][] }; // [candidateIdx, slotIdx]
  let best = new Map<number, State>([[0, { score: 0, picks: [] }]]);
  candidates.forEach((p, ci) => {
    const next = new Map(best);
    for (const [mask, state] of best) {
      for (let si = 0; si < slots.length; si++) {
        if (mask & (1 << si)) continue;
        // Identical slots are interchangeable: only try the first free copy.
        if (si > 0 && slots[si - 1] === slots[si] && !(mask & (1 << (si - 1)))) continue;
        if (!slotAccepts(slots[si], p.positions)) continue;
        const m = mask | (1 << si);
        const s = state.score + score(p);
        const cur = next.get(m);
        if (!cur || s > cur.score) next.set(m, { score: s, picks: [...state.picks, [ci, si]] });
      }
    }
    best = next;
  });

  let top: State = { score: 0, picks: [] };
  for (const st of best.values()) if (st.score > top.score) top = st;
  let totalValue = 0;
  for (const [ci, si] of top.picks) {
    assignments.set(candidates[ci].playerId, slots[si]);
    totalValue += candidates[ci].value;
  }
  return { assignments, starters: top.picks.length, totalValue };
}

function greedy(
  candidates: LineupPlayer[],
  slots: Slot[],
  assignments: Map<number, Slot | "BN" | "IL">,
): LineupResult {
  // Most restrictive slots first, best players first.
  const order = [...slots].sort((a, b) => Number(a === "UTIL") - Number(b === "UTIL"));
  const sorted = [...candidates].sort((a, b) => b.value - a.value);
  const used = new Set<number>();
  let totalValue = 0;
  for (const slot of order) {
    const p = sorted.find((c) => !used.has(c.playerId) && slotAccepts(slot, c.positions));
    if (!p) continue;
    used.add(p.playerId);
    assignments.set(p.playerId, slot);
    totalValue += p.value;
  }
  return { assignments, starters: used.size, totalValue };
}
