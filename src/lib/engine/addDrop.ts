import { round } from "./values";

export interface AddDropPlayer {
  playerId: number;
  name: string;
  valuePerGame: number; // rest-of-season per-game value
  gamesThisWeek: number; // games left this fantasy week
  playProbability: number;
  onInjuredList?: boolean;
}

export interface AddDropSuggestion {
  add: AddDropPlayer;
  drop: AddDropPlayer;
  perGameGain: number;
  restOfWeekGain: number;
  reason: string;
}

/**
 * Pairs the best free agents with your weakest players. A swap is suggested
 * only when the free agent's per-game value beats the drop by at least
 * `dropMargin`. Players in IL slots are never dropped, and free agents who
 * are ruled out are skipped.
 */
export function suggestAddDrops(
  roster: AddDropPlayer[],
  freeAgents: AddDropPlayer[],
  dropMargin: number,
  maxSuggestions = 5,
): AddDropSuggestion[] {
  const droppable = roster
    .filter((p) => !p.onInjuredList)
    .sort((a, b) => a.valuePerGame - b.valuePerGame);
  const pickups = freeAgents
    .filter((p) => p.playProbability > 0)
    .sort((a, b) => b.valuePerGame - a.valuePerGame);

  const out: AddDropSuggestion[] = [];
  for (const add of pickups) {
    const drop = droppable[0];
    if (!drop || out.length >= maxSuggestions) break;
    const perGameGain = add.valuePerGame - drop.valuePerGame;
    if (perGameGain < dropMargin) break; // pickups are sorted, nothing later beats this
    droppable.shift();
    const restOfWeekGain =
      add.valuePerGame * add.gamesThisWeek * add.playProbability -
      drop.valuePerGame * drop.gamesThisWeek * drop.playProbability;
    out.push({
      add,
      drop,
      perGameGain: round(perGameGain, 2),
      restOfWeekGain: round(restOfWeekGain, 2),
      reason:
        `${add.name} is worth ${round(perGameGain, 2)} more per game than ${drop.name}` +
        (add.gamesThisWeek !== drop.gamesThisWeek
          ? ` and has ${plural(add.gamesThisWeek, "game")} left this week vs ${drop.gamesThisWeek}`
          : ""),
    });
  }
  return out;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
