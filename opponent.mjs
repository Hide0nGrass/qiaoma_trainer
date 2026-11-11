// 对手模拟器：随机发牌 → 用与判定器同源的「最优出张」走完整条路径 → 听牌后敲
// 生成的是自洽路径（不是随机弃牌），所以弃牌序列带信息，能被 read.mjs 反推。
import { analyzeHand, countsOf, shanten, ukeire } from './engine.mjs';

const KINDS = 27;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newDeck() {
  const d = [];
  for (let t = 0; t < KINDS; t++) for (let i = 0; i < 4; i++) d.push(t);
  return d;
}

export function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 13 张手牌的听牌枚数（不是听牌返回 null） */
export function waitsOf(hand13) {
  const c = countsOf(hand13);
  if (shanten(c) !== 0) return null;
  return ukeire(c).list;
}

/**
 * 模拟一局：他摸打 turns 手，第一次听牌即「敲」并冻结手牌。
 * @returns {{hand:number[], wall:number[], path:Array, knockAt:number, frozenHand:number[]|null, waits:Array|null}}
 */
export function simulateRound(seed, turns = 10) {
  const rnd = mulberry32(seed);
  const deck = shuffle(newDeck(), rnd);
  const hand = deck.slice(0, 13);
  const wall = deck.slice(13, 13 + turns);

  let h = [...hand];
  const path = [];
  let knockAt = -1;
  let frozenHand = null;
  let waits = null;

  for (let i = 0; i < turns; i++) {
    const draw = wall[i];
    const h14 = [...h, draw];
    const cands = analyzeHand(h14);
    const best = cands[0];
    const idx = h14.indexOf(best.tile);
    h = h14.slice(0, idx).concat(h14.slice(idx + 1));
    // tsumogiri = 刚摸到的那张直接打掉（手里原本没有它）；否则是从手牌里挑出来打的
    path.push({ draw, discard: best.tile, tsumogiri: draw === best.tile, shanten: best.shanten, ukeire: best.ukeire });

    if (best.shanten === 0 && knockAt < 0) {
      knockAt = i;
      frozenHand = [...h];
      waits = waitsOf(h);
      // 敲完就停：之后他的手牌冻结，读牌问题从这里开始
      break;
    }
    if (best.shanten < 0) break; // 已经自摸
  }

  return { hand, wall, path, knockAt, frozenHand, waits };
}
