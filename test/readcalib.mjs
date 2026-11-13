// M0 校准台：模拟一批「对手按最优出张走到敲」的局，
// 只用他的牌河去反推听牌，量一下到底准不准。
//
// 指标：
//   top3   —— 真实听牌中至少一张落在前三危险牌里的比例（随机基线 ≈ 3/27）
//   brier  —— 每张牌 (p − 实际是否听这张)² 的平均，越小越好
//   base   —— 全 0 预测的 brier（听牌种数 / 27），用来对比
import { simulateRound, waitsOf, newDeck } from '../opponent.mjs';
import { inferWaits, dangerTable, featureRead } from '../read.mjs';
import { countsOf, tileName } from '../engine.mjs';

const ROUNDS = Number(process.argv[2] || 24);
const SAMPLES = Number(process.argv[3] || 160);
const BETA = Number(process.argv[4] || 1.2);
const ADJ = Number(process.argv[5] || 0);
const SUIT = Number(process.argv[6] || 0);
const MIN_D = Number(process.argv[7] || 0);
const MODE = process.argv[8] || 'sample'; // sample | feat | blend

let hit3 = 0, hit5 = 0, trials = 0;
let brierSum = 0, baseSum = 0, survivorSum = 0, msSum = 0;
let noKnock = 0;

const t0 = Date.now();
for (let g = 0; g < ROUNDS; g++) {
  const r = simulateRound(1000 + g * 7919, 12);
  if (r.knockAt < 0 || !r.waits || !r.waits.length) { noKnock++; continue; }
  if (MIN_D && r.path.length < MIN_D) { noKnock++; continue; }

  // 可见牌 = 他的牌河 + 我的 13 张（独立发牌，不能拿他的起手当我的手牌，
  // 否则会把他的听张从牌池里扣掉，排名直接反相关）
  const visible = countsOf(r.path.map((x) => x.discard));
  const mine = newDeck();
  for (let i = mine.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [mine[i], mine[j]] = [mine[j], mine[i]];
  }
  const myHand = [];
  for (const t of mine) {
    if (visible[t] >= 4) continue;
    myHand.push(t);
    visible[t] += 1;
    if (myHand.length === 13) break;
  }
  const v = visible.map((n) => Math.min(4, n));

  const start = Date.now();
  const dpath = r.path.map((x) => x.discard);
  let read;
  if (MODE === 'feat') read = featureRead(dpath, v);
  else if (MODE === 'blend') {
    const a = inferWaits({ discards: dpath, visible: v, samples: SAMPLES, seed: g + 1, adjacency: ADJ, suitFocus: SUIT });
    const b = featureRead(dpath, v);
    const p = new Map();
    for (let t = 0; t < 27; t++) p.set(t, 0.5 * (a.p.get(t) || 0) + 0.5 * (b.p.get(t) || 0));
    read = { p, totalW: a.totalW, survivors: a.survivors, samples: SAMPLES };
  } else read = inferWaits({ discards: dpath, visible: v, samples: SAMPLES, seed: g + 1, adjacency: ADJ, suitFocus: SUIT });
  msSum += Date.now() - start;

  const truth = new Set(r.waits.map((w) => w.tile));
  const rows = dangerTable(read, v);
  const top3 = new Set(rows.slice(0, 3).map((x) => x.tile));
  const top5 = new Set(rows.slice(0, 5).map((x) => x.tile));

  const t3 = [...truth].some((t) => top3.has(t));
  const t5 = [...truth].some((t) => top5.has(t));
  if (t3) hit3++;
  if (t5) hit5++;
  trials++;
  survivorSum += read.survivors;

  let brier = 0;
  for (let t = 0; t < 27; t++) {
    const y = truth.has(t) ? 1 : 0;
    const p = read.p.get(t) || 0;
    brier += (p - y) * (p - y);
  }
  brierSum += brier / 27;
  baseSum += truth.size / 27;

  if (g < 8 || t3 === false) {
    console.log(
      `局${g + 1}: 听 ${[...truth].map(tileName).join('/')} | 前三 ${rows.slice(0, 3).map((x) => `${tileName(x.tile)}${(x.p * 100).toFixed(0)}%`).join(' ')} | ${t3 ? '✓' : '✗'} | 存活 ${read.survivors}`,
    );
  }
}

console.log(`\n局数 ${ROUNDS}（未敲 ${noKnock}）  用 ${trials} 局评估`);
console.log(`top3 ${hit3}/${trials} = ${((hit3 / trials) * 100).toFixed(0)}%   top5 ${hit5}/${trials} = ${((hit5 / trials) * 100).toFixed(0)}%`);
console.log(`brier ${(brierSum / trials).toFixed(4)}  基线(全 0) ${(baseSum / trials).toFixed(4)}`);
console.log(`平均存活 ${(survivorSum / trials).toFixed(1)} / ${SAMPLES}   平均耗时 ${(msSum / trials).toFixed(0)}ms`);
console.log(`总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
