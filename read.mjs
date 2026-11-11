// 读牌推断：给定对手的弃牌序列 + 全体可见牌，反推「他敲的时候在等哪些牌」。
//
// 做法（枚举听牌手牌 + 似然加权，不做逐手硬匹配）：
//   1. 从未知牌池里采样一手「已经听牌」的 13 张（先凑成 4 面子 + 1 将，再抽掉一张）；
//   2. 他打过的牌，如果正好是这手牌的听张，说明这手手牌不太可能是他的 —— 加权降低；
//      越靠后的弃牌越可信（他当时已经在收形），惩罚越重；
//   3. 加权累加每张牌「是不是他的和牌」→ 归一化成概率。
//
// 为什么不做「逐手模拟他再比对弃牌」：实测 1000 个样本只有 4~5 个能复现两手弃牌，
// 样本量会塌到无法排名；而弃牌真正提供的信息是「他不要什么」，直接用它当约束更稳。
import { countsOf, shanten, ukeire } from './engine.mjs';
import { mulberry32, newDeck, shuffle } from './opponent.mjs';

const KINDS = 27;

/** 从剩余牌池里随机凑一手和牌（4 面子 + 1 将），凑不出返回 null */
function sampleWinHand(pool, rnd) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const c = pool.slice();
    const tiles = [];

    const pairs = [];
    for (let t = 0; t < KINDS; t++) if (c[t] >= 2) pairs.push(t);
    if (!pairs.length) return null;
    const pt = pairs[Math.floor(rnd() * pairs.length)];
    c[pt] -= 2;
    tiles.push(pt, pt);

    let ok = true;
    for (let m = 0; m < 4; m++) {
      const opts = [];
      for (let t = 0; t < KINDS; t++) {
        if (c[t] >= 3) opts.push([t, t, t]);
        if (t % 9 <= 6 && c[t] && c[t + 1] && c[t + 2]) opts.push([t, t + 1, t + 2]);
      }
      if (!opts.length) { ok = false; break; }
      const pick = opts[Math.floor(rnd() * opts.length)];
      for (const t of pick) { c[t]--; tiles.push(t); }
    }
    if (ok) return tiles;
  }
  return null;
}

/**
 * @param {object} o
 * @param {number[]} o.discards  对手打出的牌（按顺序）
 * @param {number[]} o.visible   可见牌计数（长度 27；自己手牌 + 四家牌河 + 副露）
 * @param {number} [o.samples]
 * @param {number} [o.seed]
 * @param {number} [o.recent]    最近多少张算「收形期」，惩罚更重
 */
export function inferWaits({ discards, visible, samples = 300, seed = 1, recent = 4 }) {
  const rnd = mulberry32(seed >>> 0);
  const pool = [];
  for (let t = 0; t < KINDS; t++) {
    const n = 4 - (visible[t] || 0);
    for (let i = 0; i < n; i++) pool.push(t);
  }
  const poolCounts = new Uint8Array(KINDS);
  for (const t of pool) poolCounts[t]++;

  // 每张弃牌的惩罚系数：越靠后越重
  const penalty = new Map();
  for (let i = 0; i < discards.length; i++) {
    const age = discards.length - i;
    const f = age <= recent ? 0.08 : 0.35;
    penalty.set(discards[i], (penalty.get(discards[i]) ?? 1) * f);
  }

  // 他打过的牌，说明「对他来说没用」：候选手牌里还留着这些牌就越可疑
  const hold = new Map();
  for (let i = 0; i < discards.length; i++) {
    const d = discards[i];
    const w = discards.length - i <= recent ? 0.35 : 0.75;
    hold.set(d, (hold.get(d) ?? 1) * w);
  }

  const tally = new Float64Array(KINDS);
  let totalW = 0;
  let survivors = 0;

  for (let s = 0; s < samples; s++) {
    const win = sampleWinHand(poolCounts, rnd);
    if (!win) break;
    const drop = win[Math.floor(rnd() * win.length)];
    const idx = win.indexOf(drop);
    const hand = win.slice(0, idx).concat(win.slice(idx + 1));

    const c13 = countsOf(hand);
    if (shanten(c13) !== 0) continue;
    const waits = ukeire(c13).list;
    if (!waits.length) continue;

    let w = 1;
    for (const { tile } of waits) {
      const f = penalty.get(tile);
      if (f !== undefined) w *= f;
    }
    // 他还留着「早就打掉过」的牌，越靠后打掉的越可疑
    for (const [d, f] of hold) {
      const n = c13[d];
      if (n > 0) w *= Math.pow(f, n);
    }
    if (w <= 1e-6) continue;

    survivors++;
    totalW += w;
    for (const { tile } of waits) tally[tile] += w;
  }

  const p = new Map();
  for (let t = 0; t < KINDS; t++) if (tally[t]) p.set(t, tally[t] / (totalW || 1));
  return { p, totalW, survivors, samples };
}

/** 我打这张牌的绝对风险：概率 × 池里还剩几张 */
export function dangerTable(read, visible) {
  const rows = [];
  for (let t = 0; t < KINDS; t++) {
    const pr = read.p.get(t) || 0;
    const left = Math.max(0, 4 - (visible[t] || 0));
    rows.push({ tile: t, p: pr, left, score: pr * left });
  }
  rows.sort((a, b) => b.score - a.score || b.p - a.p || a.tile - b.tile);
  return rows;
}
