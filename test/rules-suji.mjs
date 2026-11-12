// 筋（2-5 都打过 → 3-4 安全吗）的时机效应实测。
// 用法：node test/rules-suji.mjs [局数，默认 1200]
import { simulateRound } from '../opponent.mjs';

const ROUNDS = Number(process.argv[2] || 1200);
const b = new Map();
const add = (k, y) => { const x = b.get(k) || { n: 0, hit: 0 }; x.n++; if (y) x.hit++; b.set(k, x); };

let rounds = 0;
for (let seed = 1; seed <= ROUNDS; seed++) {
  const sim = simulateRound(seed * 104729, 16);
  if (!sim.waits?.length || sim.knockAt < 5) continue;
  rounds++;
  const waits = new Set(sim.waits.map((w) => w.tile));
  const disc = sim.path.map((s) => s.discard);
  const idx = new Map();
  disc.forEach((t, i) => { if (!idx.has(t)) idx.set(t, i); });

  for (let suit = 0; suit < 3; suit++) {
    const t2 = suit * 9 + 1, t3 = suit * 9 + 2, t4 = suit * 9 + 3, t5 = suit * 9 + 4;
    const i2 = idx.has(t2) ? idx.get(t2) : -1;
    const i5 = idx.has(t5) ? idx.get(t5) : -1;
    const hit = waits.has(t3) || waits.has(t4);

    add('all', hit);
    if (i2 >= 0 && i5 >= 0) {
      add('both', hit);
      const e2 = i2 < 3, e5 = i5 < 3, l2 = i2 >= 8, l5 = i5 >= 8;
      if (e2 && e5) add('bothEarly', hit);
      if (e2 && l5) add('early2_late5', hit);
      if (l2 && l5) add('bothLate', hit);
    } else if (i2 >= 0) add('only2', hit);
    else if (i5 >= 0) add('only5', hit);
  }
}

const pct = (k) => { const x = b.get(k); return x ? `${(x.hit / x.n * 100).toFixed(1)}%` : '-'; };
const n = (k) => { const x = b.get(k); return x ? x.n : 0; };

console.log(`局数 ${rounds}\n`);
console.log('| 情况 | 3-4 是听张的概率 | 样本 |');
console.log('|---|---|---|');
for (const [label, k] of [
  ['基线（无任何条件）', 'all'],
  ['只打了 2', 'only2'],
  ['只打了 5', 'only5'],
  ['2 和 5 都打了', 'both'],
  ['2、5 都在前期打（前 3 手）', 'bothEarly'],
  ['2 前期、5 后期', 'early2_late5'],
  ['2、5 都在后期打（8 手后）', 'bothLate'],
]) console.log(`| ${label} | ${pct(k)} | ${n(k)} |`);
