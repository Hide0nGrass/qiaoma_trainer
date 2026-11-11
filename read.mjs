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
 * @param {Array<number|{tile:number, tsumogiri?:boolean}>} o.discards
 *        对手打出的牌（按顺序）。给对象形式时带「是不是摸切」标记：
 *        摸切 = 刚摸到就打掉，手里原本没有这张；手切 = 从手牌里挑出来打的。
 * @param {number[]} o.visible   可见牌计数（长度 27；自己手牌 + 四家牌河 + 副露）
 * @param {number} [o.samples]
 * @param {number} [o.seed]
 * @param {number} [o.recent]    最近多少张算「收形期」，惩罚更重
 * @param {'off'|'weak'|'strong'} [o.tsumogiri] 摸切惩罚系数怎么调（off = 与手切一样）
 * @param {'off'|'strong'} [o.tsumogiriHold] 摸切的牌在「他还留着？」上是否罚得更重
 * @param {boolean} [o.wall]     壁：某张牌 4 张全见时，依赖它的等待直接判死
 */
export function inferWaits({
  discards,
  visible,
  samples = 300,
  seed = 1,
  recent = 4,
  nearPenalty = 0.08,
  farPenalty = 0.35,
  tsumogiri = 'off',
  tsumogiriHold = 'off',
  wall = false,
}) {
  const rnd = mulberry32(seed >>> 0);
  const ds = discards.map((d) => (typeof d === 'number' ? { tile: d, tsumogiri: false } : d));
  const pool = [];
  for (let t = 0; t < KINDS; t++) {
    const n = 4 - (visible[t] || 0);
    for (let i = 0; i < n; i++) pool.push(t);
  }
  const poolCounts = new Uint8Array(KINDS);
  for (const t of pool) poolCounts[t]++;

  // 每张弃牌的惩罚系数：越靠后越重
  // 摸切（刚摸到就打）说明手里原本没有这张，对「他不要什么」的证据比手切更弱/更强，
  // 由 tsumogiri 参数决定：weak = 往 1 靠（当成弱证据），strong = 更狠。
  const penalty = new Map();
  for (let i = 0; i < ds.length; i++) {
    const age = ds.length - i;
    let f = age <= recent ? nearPenalty : farPenalty;
    if (ds[i].tsumogiri) {
      if (tsumogiri === 'weak') f = 1 - (1 - f) * 0.5;
      else if (tsumogiri === 'strong') f *= 0.5;
    }
    penalty.set(ds[i].tile, (penalty.get(ds[i].tile) ?? 1) * f);
  }

  // 他打过的牌，说明「对他来说没用」：候选手牌里还留着这些牌就越可疑。
  // 摸切（手里原本没有、刚摸到就打）比手切更能证明「他手里没这张」，
  // 所以 tsumogiriHold = 'strong' 时给摸切的牌更重的惩罚。
  const hold = new Map();
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i].tile;
    let w = ds.length - i <= recent ? 0.35 : 0.75;
    if (ds[i].tsumogiri && tsumogiriHold === 'strong') w *= 0.7;
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
    let waits = ukeire(c13).list;
    // 壁：如果这张的剩余牌全在可见牌里（4 张全见），或者全在他自己手里，
    // 他就没法靠它和牌 —— 依赖它的等待直接作废（否则样本里会混进死听）。
    if (wall) waits = waits.filter((w) => poolCounts[w.tile] - c13[w.tile] > 0);
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
