// 3-7 都打过时，4/5/6 还危险吗？（筋的形态差别 + 时机）
// 用法：node test/rules-37.mjs [局数，默认 1200]
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
    const t3 = suit * 9 + 2, t4 = suit * 9 + 3, t5 = suit * 9 + 4, t6 = suit * 9 + 5, t7 = suit * 9 + 6;
    const i3 = idx.has(t3) ? idx.get(t3) : -1;
    const i7 = idx.has(t7) ? idx.get(t7) : -1;

    // 基线：无条件下 4/5/6 各自
    add('base4', waits.has(t4));
    add('base5', waits.has(t5));
    add('base6', waits.has(t6));

    if (i3 < 0 || i7 < 0) continue;
    const both = waits.has(t4) || waits.has(t5) || waits.has(t6);
    add('any456', both);
    add('mid4', waits.has(t4));
    add('mid5', waits.has(t5));
    add('mid6', waits.has(t6));

    const e3 = i3 < 3, e7 = i7 < 3, l3 = i3 >= 8, l7 = i7 >= 8;
    if (e3 && e7) { add('allEarly', both); add('early4', waits.has(t4)); add('early5', waits.has(t5)); add('early6', waits.has(t6)); }
    if (l3 && l7) { add('allLate', both); add('late4', waits.has(t4)); add('late5', waits.has(t5)); add('late6', waits.has(t6)); }
  }
}

const pct = (k) => { const x = b.get(k); return x ? `${(x.hit / x.n * 100).toFixed(1)}%` : '-'; };
const nn = (k) => { const x = b.get(k); return x ? x.n : 0; };

console.log(`局数 ${rounds}\n`);
console.log('| 情况 | 4 | 5 | 6 | 任一 (4/5/6) |');
console.log('|---|---|---|---|---|');
console.log(`| 基线（无条件下单张） | ${pct('base4')} | ${pct('base5')} | ${pct('base6')} | — |`);
console.log(`| 3、7 都打过 | ${pct('mid4')} (n=${nn('mid4')}) | ${pct('mid5')} (n=${nn('mid5')}) | ${pct('mid6')} (n=${nn('mid6')}) | ${pct('any456')} (n=${nn('any456')}) |`);
console.log(`| 3、7 都在前期打 | ${pct('early4')} (n=${nn('early4')}) | ${pct('early5')} (n=${nn('early5')}) | ${pct('early6')} (n=${nn('early6')}) | ${pct('allEarly')} (n=${nn('allEarly')}) |`);
console.log(`| 3、7 都在后期打 | ${pct('late4')} (n=${nn('late4')}) | ${pct('late5')} (n=${nn('late5')}) | ${pct('late6')} (n=${nn('late6')}) | ${pct('allLate')} (n=${nn('allLate')}) |`);
