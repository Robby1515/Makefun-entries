// The token radar's model, second edition: one snapshot of the protocol universe in, one ranked board out.
//
// What this model does differently from a flat TVL multiple:
//
// 1. Peer-priced base. A launch is priced by the market against protocols that already trade. For each
//    category, the model takes every live-token protocol in the snapshot in that category, computes its
//    market-cap-to-TVL ratio, and uses the category median, shrunk toward the global median by the peer
//    count (a category with one traded peer is mostly prior, a category with fifteen is mostly evidence):
//        peer = (n x categoryMedian + 4 x globalMedian) / (n + 4), clamped to [0.05, 1.25].
//    implied base = TVL x peer. A lending market and a curator network do not trade at the same
//    multiple, and the board should not pretend they do.
//
// 2. Momentum, damped. The 7-day TVL change enters once, clamped to [-50, +100] percent and weighted
//    0.35, so one hot week can lift a row by at most a third and one bad week cannot bury it.
//
// 3. Maturity. Protocols DefiLlama has tracked longer have survived more market weather: a factor from
//    0.70 (brand new) to 1.00 (three years or more). An unknown listing date is scored at the median
//    age of the snapshot's pre-token protocols, a figure the data states, not a guess.
//
// 4. Breadth. Each extra chain a protocol already runs on is distribution a launch does not have to
//    buy: +4% per chain beyond the first, capped at five extra chains.
//
// implied = TVL x peer x momentum x maturity x breadth, rounded to whole dollars, at least 1.
//
// The board covers every slug in the snapshot's watchlist and adds early rows below the watchlist
// floor. Early rows pass the same screen the watchlist definition uses: pre-token, not a versioned
// pool of another protocol, not a wrapped, staked or bridged product of one that trades, not an
// exchange. No protocol name is ever special-cased: the same functions score every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  peer_prior_weight: number;
  peer_min: number;
  peer_max: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  peer_prior_weight: 4,
  peer_min: 0.05,
  peer_max: 1.25,
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  breadth_per_chain: 0.04,
  breadth_max_extra: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 170;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 30;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  signal: 'Strong' | 'Moderate' | 'Early';
  model: {
    peer_multiple: number;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  signal: 'Strong' | 'Moderate' | 'Early';
  peer_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_peer_median: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Category medians of market-cap-to-TVL among live-token protocols, and the global median. */
export interface PeerTable {
  globalMedian: number;
  byCategory: Map<string, { median: number; count: number }>;
}

/** Build the peer table from the snapshot's live-token protocols (market cap and TVL both recorded). */
export function peerTable(snapshot: Snapshot): PeerTable {
  const ratios: number[] = [];
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(r) || r <= 0) continue;
    ratios.push(r);
    if (p.category !== null) {
      const list = byCat.get(p.category) ?? [];
      list.push(r);
      byCat.set(p.category, list);
    }
  }
  const byCategory = new Map<string, { median: number; count: number }>();
  for (const [cat, list] of byCat) byCategory.set(cat, { median: median(list), count: list.length });
  return { globalMedian: ratios.length > 0 ? median(ratios) : 0.2, byCategory };
}

/** One category's peer multiple: its median shrunk toward the global median by its peer count, clamped. */
export function peerMultiple(peers: PeerTable, category: string | null, model: ModelConstants = MODEL): { multiple: number; count: number } {
  const entry = category !== null ? peers.byCategory.get(category) : undefined;
  const n = entry?.count ?? 0;
  const catMedian = entry?.median ?? peers.globalMedian;
  const shrunk = (n * catMedian + model.peer_prior_weight * peers.globalMedian) / (n + model.peer_prior_weight);
  return { multiple: Math.min(model.peer_max, Math.max(model.peer_min, shrunk)), count: n };
}

/** The median age, in days, of the snapshot's pre-token protocols with a known listing date. */
export function medianPreTokenAge(snapshot: Snapshot): number {
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const a = ageDays(snapshot.as_of, p.listed_at);
    if (a !== null) ages.push(a);
  }
  return ages.length > 0 ? Math.round(median(ages)) : 365;
}

/** The factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: PeerTable,
  unknownAgeDays: number,
  model: ModelConstants = MODEL,
): { implied: number; peer: number; peerCount: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple: peer, count: peerCount } = peerMultiple(peers, protocol.category, model);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? unknownAgeDays;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * peer * growthMult * maturityMult * breadthMult));
  return { implied, peer, peerCount, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words that mark a wrapped or staked product of another protocol. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are that exchange's product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Categories that are products of another protocol's token, per the watchlist's own definition. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a versioned pool, a wrapped or
 * staked product, a bridge product, or an exchange's own product. The watchlist's screen, applied
 * to the whole snapshot, above and below the floor alike.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** A display signal from facts the snapshot states: scale, track record, breadth, momentum, coverage. */
export function signalFor(p: SnapshotProtocol, age: number | null, onWatchlist: boolean): 'Strong' | 'Moderate' | 'Early' {
  let score = 0;
  if (onWatchlist) score += 2;
  if (p.tvl_usd >= 250_000_000) score += 1;
  if (age !== null && age >= 365) score += 1;
  if (p.chains.length >= 3) score += 1;
  if (p.change_7d !== null && p.change_7d > 0) score += 1;
  if (score >= 4) return 'Strong';
  if (score >= 2) return 'Moderate';
  return 'Early';
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is on the board.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const peers = peerTable(snapshot);
  const unknownAge = medianPreTokenAge(snapshot);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, peers, unknownAge, model);
    return { p, ...v, onWatchlist: watch.has(p.slug) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: s.onWatchlist,
    age_days: s.age,
    implied_value_usd: s.implied,
    signal: signalFor(s.p, s.age, s.onWatchlist),
    model: {
      peer_multiple: round4(s.peer),
      peer_count: s.peerCount,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core position: the one action that makes a wallet a real user of this protocol. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into one of ${name}'s curated vaults on ${chain}; curator vaults are where its users actually sit.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral to ${name} on ${chain} and leave the supply position open.`;
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC on ${name} on ${chain} and open one small position in its main market.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC from ${chain} to one of ${name}'s other chains and keep the bridged funds working there.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt in the wallet.`;
  if (c.includes('rwa')) return `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} through its own app and hold it in the wallet.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain}, the position its yield is paid on.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${name}'s chain and hold it there as the wallet's working balance.`;
  if (c.includes('payment')) return `Fund the wallet with $${capital} and make one real payment through ${name} on ${chain}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('stable') || c.includes('yield')) return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the yield position open.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position in a liquid market on ${name}.`;
  if (c.includes('option')) return `Deposit $${capital} of USDC into one of ${name}'s option vaults on ${chain}.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second action: the behaviour that separates a user from a one-click deposit. */
function secondAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `Split a second $${Math.round(capital / 2)} across a vault from a different curator on ${name}, so the wallet shows up in more than one vault's holder set.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow about a third of the supplied value against the position and hold the borrowed asset; an open borrow is the strongest usage signal a lending market records.`;
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual')) return `Add a small hedge or a second trade in a different market on ${name}, so the wallet's history is trading, not a single deposit.`;
  if (c.includes('bridge')) return `Use the bridged funds in one app on the destination chain, then bridge a smaller amount back a week later; round trips count, one-way dumps do not.`;
  if (c.includes('staking') || c.includes('restak')) return `Pick an operator or vault inside ${name} deliberately and keep the same one; operator choice is part of the record a snapshot reads.`;
  if (c.includes('rwa')) return `Hold the asset across a full distribution cycle and keep any distribution it pays in the same wallet.`;
  if (c.includes('basis')) return `Leave the position untouched through at least two funding cycles; basis vaults reward duration, not entries.`;
  if (c.includes('chain')) return `Use two different native apps on ${name}'s chain with the bridged funds, so the wallet has contract interactions, not just a balance.`;
  if (c.includes('payment')) return `Make a second, smaller payment in a later week; repeat usage is what a payments protocol can count.`;
  if (c.includes('insurance')) return `Stake a small amount in ${name}'s underwriting pool as well if it offers one, and keep the stake beside the policy.`;
  if (c.includes('stable') || c.includes('yield')) return `Claim or compound the yield once, on the protocol's own page, so the wallet records a rewards interaction.`;
  if (c.includes('prediction')) return `Settle the position at expiry instead of selling out early; a settled market is a completed record.`;
  if (c.includes('option')) return `Let one vault epoch roll over before withdrawing anything; epochs are the unit option vaults count.`;
  return `Repeat the core action once in a later week with a smaller amount, so the wallet's history spans more than one day.`;
}

/** The weekly cadence action, in the words a farmer can follow. */
function weeklyAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Once a week, adjust the ${name} position once: a small top-up, a partial repay or a collateral swap.`;
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual')) return `Once a week, place one small trade on ${name} at a normal size for the wallet; steady cadence beats one large trade.`;
  if (c.includes('chain') || c.includes('bridge')) return `Once a week, make one ordinary transaction through ${name}: a transfer, a swap or an app interaction.`;
  if (c.includes('prediction') || c.includes('payment')) return `Once a week, use ${name} once for its actual purpose, at a size the wallet can repeat for a month.`;
  return `Once a week, make one qualifying action on ${name}: a deposit, a claim, a vote or a small adjustment to the position.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const multi = p.chains.length > 1 ? ` It runs on ${p.chains.length} chains; start on ${chain}, where its record is longest.` : '';
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, keep its seed phrase offline, and fund it on ${chain}.${multi}`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: coreAction(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(p, capital, chain),
      cost: `about $${Math.max(2, Math.round(capital / 25))} of gas`,
      time: '10 minutes',
    },
    {
      text: weeklyAction(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot; most points and eligibility snapshots are taken unannounced, and a position opened and closed inside one week is the pattern they filter out.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes; then write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    signal: row.signal,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerTable(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_peer_median: round4(peers.globalMedian),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
