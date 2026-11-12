// 读牌规律实测：用模拟器的真值（他敲牌时的真实听张）给每个特征记账。
// 用法：node test/rules.mjs [局数，默认 600]
import { simulateRound } from '../opponent.mjs';

const ROUNDS = Number(process.argv[2] || 600);
const suitOf = (t) => Math.floor(t / 9);
const rankOf = (t) => t % 9;
const isEdge = (t) => rankOf(t) === 0 || rankOf(t) === 8;
const isMid = (t) => rankOf(t) >= 3 && rankOf(t) <= 5;

function tally() {
  const m = new Map();
  return {
    add(k, y) { const x = m.get(k) || { n: 0, hit: 0 }; x.n++; if (y) x.hit++; m.set(k, x); },
    p(k) { const x = m.get(k); return x ? x.hit / x.n : null; },
    n(k) { const x = m.get(k); return x ? x.n : 0; },
    all: m,
  };
}

const T = tally();   // 单张特征
const N = tally();   // 邻居特征
let rounds = 0, tiles = 0, hits = 0, waitsAll = 0, waitsLeast = 0, waitsMid = 0;

for (let seed = 1; seed <= ROUNDS; seed++) {
  const sim = simulateRound(seed * 7919, 16);
  if (!sim.waits?.length || sim.knockAt < 5) continue;
  rounds++;

  const waits = new Set(sim.waits.map((w) => w.tile));
  const discards = sim.path.map((s) => s.discard);
  const seen = new Array(27).fill(0);
  for (const d of discards) seen[d]++;

  const bySuit = [0, 0, 0];
  for (const d of discards) bySuit[suitOf(d)]++;
  const spread = Math.max(...bySuit) - Math.min(...bySuit);
  const minS = bySuit.indexOf(Math.min(...bySuit));
  const maxS = bySuit.indexOf(Math.max(...bySuit));

  // 我的手牌：从剩余牌里随机 13 张（用可复现的线性同余洗牌）
  const pool = [];
  for (let t = 0; t < 27; t++) for (let i = 0; i < 4 - seen[t]; i++) pool.push(t);
  let s0 = (seed * 9301 + 49297) % 233280;
  for (let i = pool.length - 1; i > 0; i--) {
    s0 = (s0 * 9301 + 49297) % 233280;
    const j = Math.floor((s0 / 233280) * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const mine = new Array(27).fill(0);
  for (const t of pool.slice(0, 13)) mine[t]++;

  waitsAll += waits.size;
  for (const t of waits) {
    if (suitOf(t) === minS && spread >= 2) waitsLeast++;
    if (isMid(t)) waitsMid++;
  }

  for (let t = 0; t < 27; t++) {
    const y = waits.has(t);
    tiles++; if (y) hits++;
    const s = suitOf(t);
    const vis = seen[t] + mine[t];
    const suji = !seen[t] && (
      (t - 3 >= 0 && suitOf(t - 3) === s && seen[t - 3]) ||
      (t + 3 < 27 && suitOf(t + 3) === s && seen[t + 3])
    );
    const least = !seen[t] && s === minS && spread >= 2;
    const most = !seen[t] && s === maxS && spread >= 2;

    T.add('all', y);
    if (seen[t] === 1) T.add('own1', y);
    if (seen[t] >= 2) T.add('own2', y);
    if (suji) T.add('suji', y);
    if (!seen[t] && !suji) T.add('plain', y);
    if (vis >= 4) T.add('dead', y);
    else if (vis === 3) T.add('seen3', y);
    if (isEdge(t)) T.add('edge', y);
    if (isMid(t)) T.add('mid', y);
    if (least) T.add('suitLeast', y);
    if (most) T.add('suitMost', y);
    if (!seen[t]) T.add(`mid${isMid(t) ? 'Y' : 'N'}|least${least ? 'Y' : 'N'}`, y);
    if (!seen[t]) T.add(`edge${isEdge(t) ? 'Y' : 'N'}|least${least ? 'Y' : 'N'}`, y);
  }

  sim.path.forEach((step, i) => {
    const t = step.discard;
    const kind = step.draw === step.discard ? 'tsumo' : 'te';
    const phase = i < 3 ? 'early' : i < 8 ? 'mid' : 'late';
    for (const d of [-2, -1, 1, 2]) {
      const n2 = t + d;
      if (n2 < 0 || n2 >= 27 || suitOf(n2) !== suitOf(t)) continue;
      N.add(`${phase}|${kind}|${Math.abs(d)}`, waits.has(n2));
    }
  });
}

const base = hits / tiles;
const row = (label, k, t = T) => {
  const p = t.p(k);
  if (p === null) return `| ${label} | - | - | - |`;
  return `| ${label} | ${(p * 100).toFixed(1)}% | ${(p / base).toFixed(2)}× | ${t.n(k)} |`;
};

console.log(`局数 ${rounds} / 牌张 ${tiles} / 基线 ${(base * 100).toFixed(2)}% / 他平均听 ${(waitsAll / rounds).toFixed(2)} 张\n`);
console.log('| 特征 | 他是听张的概率 | 相对基线 | 样本 |');
console.log('|---|---|---|---|');
for (const [l, k] of [
  ['全部牌（基线）', 'all'],
  ['現物（他打过 1 张）', 'own1'],
  ['現物（打过 2 张以上）', 'own2'],
  ['已见 3 张（壁）', 'seen3'],
  ['已见 4 张（死牌）', 'dead'],
  ['筋', 'suji'],
  ['无任何标记', 'plain'],
  ['幺九（1/9）', 'edge'],
  ['中张（4-6）', 'mid'],
  ['他打得最少的那门', 'suitLeast'],
  ['他打得最多的那门', 'suitMost'],
]) console.log(row(l, k));

console.log('\n| 组合 | 概率 | 相对基线 | 样本 |');
console.log('|---|---|---|---|');
for (const [l, k] of [
  ['中张 + 少打门', 'midY|leastY'],
  ['中张 + 非少打门', 'midY|leastN'],
  ['非中张 + 少打门', 'midN|leastY'],
  ['非中张 + 非少打门', 'midN|leastN'],
  ['幺九 + 少打门', 'edgeY|leastY'],
  ['幺九 + 非少打门', 'edgeY|leastN'],
]) console.log(row(l, k));

console.log('\n| 他这张怎么打的 | 邻居距离 | 概率 | 相对基线 | 样本 |');
console.log('|---|---|---|---|---|');
for (const phase of ['early', 'mid', 'late']) {
  const name = phase === 'early' ? '前 3 手' : phase === 'mid' ? '中段' : '后期（8 手后）';
  for (const kind of ['te', 'tsumo']) {
    for (const d of [1, 2]) {
      const k = `${phase}|${kind}|${d}`;
      const p = N.p(k);
      if (p === null) continue;
      console.log(`| ${name} · ${kind === 'te' ? '手切' : '摸切'} | ±${d} | ${(p * 100).toFixed(1)}% | ${(p / base).toFixed(2)}× | ${N.n(k)} |`);
    }
  }
}

console.log(`\n覆盖：听张落在「少打那门」${(waitsLeast / waitsAll * 100).toFixed(1)}%；听张是「中张 4-6」${(waitsMid / waitsAll * 100).toFixed(1)}%`);
