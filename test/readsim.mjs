// 读牌可行性实验：用「最优出张」模拟对手整条出牌路径，
// 再用 ABC（采样整条路径、按前缀匹配）反推他敲的时候在等哪些牌。
import { analyzeHand, countsOf, shanten, ukeire, tileName } from '../engine.mjs';

const KINDS = 27;
function freshDeck() {
  const d = [];
  for (let t = 0; t < KINDS; t++) for (let i = 0; i < 4; i++) d.push(t);
  return d;
}
function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 效率出张：向听最小 → 进张最多（引擎 analyzeHand 已排好）
function bestDiscard(hand14) {
  return analyzeHand(hand14)[0];
}

function simulate(hand13, wall, turns, rnd) {
  let h = [...hand13];
  const out = [];
  let tenpaiAtTurn = -1;
  let tenpaiHand = null;
  for (let i = 0; i < turns; i++) {
    const t = wall[i];
    const h14 = [...h, t];
    const cands = analyzeHand(h14);
    const c = cands[0];
    // 用下标删（同值牌任意一张都等价）
    const idx = h14.indexOf(c.tile);
    h = h14.slice(0, idx).concat(h14.slice(idx + 1));
    out.push(c.tile);
    if (tenpaiAtTurn < 0 && c.shanten === 0) { tenpaiAtTurn = i; tenpaiHand = [...h]; }
  }
  return { discs: out, tenpaiAtTurn, tenpaiHand, endHand: h };
}

function waitsOf13(hand13) {
  const c = countsOf(hand13);
  if (shanten(c) !== 0) return [];
  return ukeire(c).list.map((x) => x.tile);
}

const rnd = mulberry32(20251111);
const TURNS = 8;
const SAMPLES = 1000;
const PREFIX = 1;

let hit3 = 0, hit5 = 0, trials = 0, survivorsSum = 0;

for (let g = 0; g < 10; g++) {
  const deck = shuffle(freshDeck(), rnd);
  const opp = deck.slice(0, 13);
  const wall = deck.slice(13, 13 + TURNS + 2);
  const truth = simulate(opp, wall, TURNS, rnd);
  if (truth.tenpaiAtTurn < 0) continue;
  const trueWaits = new Set(waitsOf13(truth.tenpaiHand));
  if (!trueWaits.size) continue;

  // 未知牌池：全牌去掉他打过的
  const discCount = new Map();
  for (const t of truth.discs) discCount.set(t, (discCount.get(t) || 0) + 1);

  const tally = new Map();
  let survivors = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const d2 = shuffle(freshDeck(), rnd);
    // 手牌与牌墙都从全牌抽，保证分布一致（不额外做条件化）
    const h13 = d2.slice(0, 13);
    const w = d2.slice(13, 13 + PREFIX + 2);
    const sim = simulate(h13, w, PREFIX, rnd);
    let ok = true;
    for (let i = 0; i < PREFIX; i++) if (sim.discs[i] !== truth.discs[i]) { ok = false; break; }
    if (!ok) continue;
    survivors++;
    const ws = waitsOf13(sim.endHand);
    for (const t of ws) tally.set(t, (tally.get(t) || 0) + 1);
  }
  if (!survivors) continue;

  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const top3 = new Set(ranked.slice(0, 3).map(([t]) => t));
  const top5 = new Set(ranked.slice(0, 5).map(([t]) => t));
  const t3 = [...trueWaits].some((t) => top3.has(t));
  const t5 = [...trueWaits].some((t) => top5.has(t));
  hit3 += t3 ? 1 : 0; hit5 += t5 ? 1 : 0; trials++; survivorsSum += survivors;

  console.log(
    `局 ${g + 1}: 真听 ${[...trueWaits].map(tileName).join('/')} | 存活 ${survivors} | ` +
    `top3 ${[...top3].map(tileName).join('/')} ${t3 ? '✓' : '✗'} | top5 ${t5 ? '✓' : '✗'}`,
  );
}

console.log(`\n命中率 top3 ${hit3}/${trials}  top5 ${hit5}/${trials}  平均存活 ${(survivorsSum / Math.max(1, trials)).toFixed(1)} / ${SAMPLES}`);
