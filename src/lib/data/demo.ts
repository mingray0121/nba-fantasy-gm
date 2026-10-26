/**
 * Demo mode: a fake 12-team league drafted once from the real player pool is kept
 * under a "demo:template" user. Each visitor gets a throwaway user with a copy of it;
 * copies expire after DEMO_MAX_AGE and are deleted (with everything under them, via
 * cascades) when the next demo starts.
 */
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, like, lt, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { HttpError } from "../api";
import { DEMO_GUID_PREFIX, DEMO_MAX_AGE } from "../session";
import { today } from "../dates";
import { saveRuleVersion } from "./rules";
import { loadLeagueContext, thisWeek } from "./model";
import { slotAccepts } from "../engine/lineup";
import { ACTIVE_SLOTS, DEFAULT_RULES, type LeagueRules, type Slot } from "../rules/schema";

const MAX_LIVE_DEMOS = 100;
/** The demo user that holds the original demo league (never expires). */
const DEMO_TEMPLATE_GUID = `${DEMO_GUID_PREFIX}template`;

export const DEMO_RULES: LeagueRules = {
  ...DEFAULT_RULES,
  categories: ["FG%", "FT%", "3P%", "3PM", "PTS", "REB", "AST", "STL", "BLK", "TO", "A/T"],
  max_adds_per_week: 6,
};

const CELEBRITIES = [
  "Trump", "Elon", "Zuckerberg", "Kanye", "Taylor Swift", "Drake", "The Rock", "Snoop Dogg",
  "Gordon Ramsay", "Keanu", "Bezos", "MrBeast", "Kim Kardashian", "Shaq", "Nicolas Cage", "Oprah",
];
const ADJECTIVES = [
  "Awesome", "Marvelous", "Magnificent", "Legendary", "Glorious", "Unstoppable", "Spectacular",
  "Majestic", "Fabulous", "Tremendous", "Epic", "Colossal", "Stupendous", "Phenomenal",
];

/** Small seeded PRNG (mulberry32): every demo starts from the same names and draft order. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** "Trump's Magnificent Team", twelve of them, no name or adjective repeated. */
export function demoTeamNames(rand: () => number, n = 12): string[] {
  const who = shuffled(CELEBRITIES, rand).slice(0, n);
  const adj = shuffled(ADJECTIVES, rand);
  return who.map((w, i) => `${w}'s ${adj[i]} Team`);
}

export interface DraftPlayer {
  playerId: number;
  positions: string[];
  value: number;
}

/**
 * Snake draft: each pick is a random one of the 6 best players left. A team whose
 * remaining picks just cover its open starting slots only takes players who fit one.
 * Returns each team's picks with the slot they fill (BN once starters are full).
 */
export function snakeDraft(
  pool: DraftPlayer[],
  teams: number,
  slots: Partial<Record<Slot, number>>,
  rand: () => number,
): { playerId: number; slot: string }[][] {
  const starters: Slot[] = ACTIVE_SLOTS.flatMap((s) => Array<Slot>(slots[s] ?? 0).fill(s));
  const rounds = starters.length + (slots.BN ?? 0);
  const left = [...pool].sort((a, b) => b.value - a.value);
  const rosters = Array.from({ length: teams }, () => ({ open: [...starters], picks: [] as { playerId: number; slot: string }[] }));
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < teams; i++) {
      const team = rosters[r % 2 === 0 ? i : teams - 1 - i];
      const mustFit = rounds - r <= team.open.length;
      const choices = left.filter((p) => !mustFit || team.open.some((s) => slotAccepts(s, p.positions))).slice(0, 6);
      if (choices.length === 0) continue;
      const pick = choices[Math.floor(rand() * choices.length)];
      left.splice(left.indexOf(pick), 1);
      const at = team.open.findIndex((s) => slotAccepts(s, pick.positions));
      team.picks.push({ playerId: pick.playerId, slot: at >= 0 ? team.open.splice(at, 1)[0] : "BN" });
    }
  }
  return rosters.map((t) => t.picks);
}

async function newDemoLeague(userId: number) {
  const db = getDb();
  const [league] = await db
    .insert(schema.leagues)
    .values({ userId, source: "manual", season: new Date().getFullYear(), name: "Demo League", numTeams: 12 })
    .returning();
  await db.insert(schema.leagueSettings).values({ leagueId: league.id });
  await saveRuleVersion(league.id, DEMO_RULES, "manual_edit");
  return league;
}

/**
 * The original demo league, kept under its own demo user: twelve named teams and a
 * drafted roster each. Created once on first use; every visitor gets a copy of it.
 */
async function demoTemplate() {
  const db = getDb();
  let [user] = await db.select().from(schema.users).where(eq(schema.users.yahooGuid, DEMO_TEMPLATE_GUID));
  if (!user) {
    [user] = await db.insert(schema.users).values({ yahooGuid: DEMO_TEMPLATE_GUID }).onConflictDoNothing().returning();
    if (!user) throw new HttpError(503, "The demo is being set up, please try again in a moment");
    const rand = rng(2026);
    const league = await newDemoLeague(user.id);
    const teams = await db
      .insert(schema.fantasyTeams)
      .values(demoTeamNames(rand).map((name, i) => ({ leagueId: league.id, name, isMine: i === 0 })))
      .returning();
    // Draft from every player the league can see (all are free agents before rosters exist).
    const ctx = await loadLeagueContext(league.id);
    const pool = ctx.freeAgents.flatMap((f) => {
      const p = ctx.players.get(f.playerId);
      return p && p.positions.length ? [{ playerId: p.id, positions: p.positions, value: p.valuePerGame }] : [];
    });
    const picks = snakeDraft(pool, teams.length, DEMO_RULES.roster_slots, rand);
    await db.insert(schema.rosterEntries).values(
      picks.flatMap((ps, i) => ps.map((p) => ({ leagueId: league.id, fantasyTeamId: teams[i].id, playerId: p.playerId, date: today(), slot: p.slot }))),
    );
  }
  const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.userId, user.id));
  if (!league) throw new HttpError(503, "The demo is being set up, please try again in a moment");
  const teams = await db.select().from(schema.fantasyTeams).where(eq(schema.fantasyTeams.leagueId, league.id)).orderBy(asc(schema.fantasyTeams.id));
  const roster = await db.select().from(schema.rosterEntries).where(eq(schema.rosterEntries.leagueId, league.id));
  return { teams, roster };
}

/** Creates a demo user with a copy of the demo league; returns the user and league ids. */
export async function createDemo(): Promise<{ userId: number; leagueId: number }> {
  const db = getDb();
  const visitors = and(like(schema.users.yahooGuid, `${DEMO_GUID_PREFIX}%`), ne(schema.users.yahooGuid, DEMO_TEMPLATE_GUID));
  await db.delete(schema.users).where(and(visitors, lt(schema.users.createdAt, new Date(Date.now() - DEMO_MAX_AGE * 1000))));
  const [{ live }] = await db.select({ live: count() }).from(schema.users).where(visitors);
  if (live >= MAX_LIVE_DEMOS) throw new HttpError(503, "The demo is busy right now, please try again later");

  const template = await demoTemplate();
  const [user] = await db.insert(schema.users).values({ yahooGuid: `${DEMO_GUID_PREFIX}${randomUUID()}` }).returning();
  const league = await newDemoLeague(user.id);
  const teams = await db
    .insert(schema.fantasyTeams)
    .values(template.teams.map((t) => ({ leagueId: league.id, name: t.name, isMine: t.isMine })))
    .returning();
  const teamFor = new Map(template.teams.map((t, i) => [t.id, teams[i].id]));

  // Rosters start on the first day of this week, so the matchup already has this week's games.
  const week = await thisWeek(league.id);
  await db.insert(schema.rosterEntries).values(
    template.roster.map((r) => ({ leagueId: league.id, fantasyTeamId: teamFor.get(r.fantasyTeamId)!, playerId: r.playerId, date: week.start, slot: r.slot })),
  );
  await db.insert(schema.matchups).values(
    Array.from({ length: teams.length / 2 }, (_, i) => ({
      leagueId: league.id,
      week: week.week,
      weekStart: week.start,
      weekEnd: week.end,
      teamId: teams[i].id,
      opponentTeamId: teams[teams.length - 1 - i].id,
    })),
  );
  return { userId: user.id, leagueId: league.id };
}
