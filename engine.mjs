/**
 * 敲麻拆搭训练器 · 牌效率引擎
 * 108 张：万/筒/条 各 1-9，每种 4 张，无字牌。
 * 目标：4 面子 + 1 将；另计七对。
 */

export const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
export const SUIT = ['万', '筒', '条'];
export const TYPES = 27;

export function tileName(t) {
  return NUM[t % 9] + SUIT[(t / 9) | 0];
}
export function tileShort(t) {
  return String((t % 9) + 1) + SUIT[(t / 9) | 0];
}
export function countsOf(tiles) {
  const c = new Uint8Array(TYPES);
  for (const t of tiles) c[t]++;
  return c;
}
export function tilesOf(c) {
  const out = [];
  for (let i = 0; i < TYPES; i++) for (let k = 0; k < c[i]; k++) out.push(i);
  return out;
}

/* ------------------------------------------------------------------ *
 * 向听数
 * ------------------------------------------------------------------ */

const cache = new Map();

function ckey(c) {
  let s = '';
  for (let i = 0; i < TYPES; i++) s += c[i];
  return s;
}

/** 枚举面子/搭子，返回 melds*8 + partials（melds 优先，其次 partials） */
function search(c, i, m, p) {
  while (i < TYPES && c[i] === 0) i++;
  if (i >= TYPES) return m * 8 + p;
  let best = -1;
  const upd = (v) => { if (v > best) best = v; };

  if (m < 4) {
    // 刻子
    if (c[i] >= 3) {
      c[i] -= 3;
      upd(search(c, i, m + 1, p));
      c[i] += 3;
    }
    // 顺子
    if (i % 9 <= 6 && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      upd(search(c, i, m + 1, p));
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
  }
  if (m + p < 4) {
    // 对子搭
    if (c[i] >= 2) {
      c[i] -= 2;
      upd(search(c, i, m, p + 1));
      c[i] += 2;
    }
    // 两面/边张搭
    if (i % 9 <= 7 && c[i + 1]) {
      c[i]--; c[i + 1]--;
      upd(search(c, i, m, p + 1));
      c[i]++; c[i + 1]++;
    }
    // 嵌张搭
    if (i % 9 <= 6 && c[i + 2]) {
      c[i]--; c[i + 2]--;
      upd(search(c, i, m, p + 1));
      c[i]++; c[i + 2]++;
    }
  }
  // 弃掉该种牌
  const n = c[i];
  c[i] = 0;
  upd(search(c, i + 1, m, p));
  c[i] = n;
  return best;
}

export function standardShanten(c) {
  let best = 8;
  for (let i = 0; i < TYPES; i++) {
    if (c[i] >= 2) {
      c[i] -= 2;
      const r = search(c, 0, 0, 0);
      c[i] += 2;
      const m = r >> 3;
      const p = Math.min(r & 7, 4 - m);
      const sh = 8 - 2 * m - p - 1;
      if (sh < best) best = sh;
    }
  }
  const r = search(c, 0, 0, 0);
  const m = r >> 3;
  const p = Math.min(r & 7, 4 - m);
  const sh = 8 - 2 * m - p;
  if (sh < best) best = sh;
  return best;
}

export function chiitoiShanten(c) {
  let pairs = 0, kinds = 0;
  for (let i = 0; i < TYPES; i++) {
    if (c[i] > 0) kinds++;
    if (c[i] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

export function shanten(c) {
  const k = ckey(c);
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  const v = Math.min(standardShanten(c), chiitoiShanten(c));
  if (cache.size > 200000) cache.clear();
  cache.set(k, v);
  return v;
}

export function shantenOfTiles(tiles) {
  return shanten(countsOf(tiles));
}

export function isWin(c) {
  return shanten(c) === -1;
}

/* ------------------------------------------------------------------ *
 * 进张 / 听牌
 * ------------------------------------------------------------------ */

/** c 为 13 张；返回当前向听下能降低向听的有效牌 */
export function ukeire(c) {
  const base = shanten(c);
  const list = [];
  let total = 0;
  for (let t = 0; t < TYPES; t++) {
    if (c[t] >= 4) continue;
    c[t]++;
    const s = shanten(c);
    c[t]--;
    if (s < base) {
      const n = 4 - c[t];
      list.push({ tile: t, count: n });
      total += n;
    }
  }
  return { base, total, list };
}

/** 13 张手牌的听牌（胡牌张） */
export function waitsOf(c) {
  const out = [];
  for (let t = 0; t < TYPES; t++) {
    if (c[t] >= 4) continue;
    c[t]++;
    if (isWin(c)) out.push({ tile: t, count: 4 - c[t] + 1 });
    c[t]--;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 拆搭评估
 * ------------------------------------------------------------------ */

function isolation(c, t) {
  // c 为打掉一张后的 13 张
  let n = c[t] * 2;
  const suit = (t / 9) | 0;
  for (const d of [-2, -1, 1, 2]) {
    const u = t + d;
    if (u < 0 || u >= TYPES) continue;
    if (((u / 9) | 0) !== suit) continue;
    n += c[u];
  }
  return n;
}

function edgeRank(t) {
  const r = t % 9;
  if (r === 0 || r === 8) return 0;
  if (r === 1 || r === 7) return 1;
  return 2;
}

/** 14 张手牌里「打完最优」的结果（只评估最小向听的那几张，省时间） */
function bestAfterDrawCounts(c) {
  let bs = 99;
  const tiles = [];
  for (let t = 0; t < TYPES; t++) {
    if (!c[t]) continue;
    c[t]--;
    const s = shanten(c);
    c[t]++;
    if (s < bs) { bs = s; tiles.length = 0; tiles.push(t); }
    else if (s === bs) tiles.push(t);
  }
  let bu = -1;
  for (const t of tiles) {
    c[t]--;
    const u = ukeire(c).total;
    c[t]++;
    if (u > bu) bu = u;
  }
  return { shanten: bs, ukeire: bu };
}

/** t 是否和手里的牌有联系（有同牌或 ±2 内的邻牌），孤立牌摸进来不可能改良 */
function related(c, t) {
  if (c[t]) return true;
  const suit = (t / 9) | 0;
  for (let d = -2; d <= 2; d++) {
    if (!d) continue;
    const u = t + d;
    if (u < 0 || u >= TYPES) continue;
    if (((u / 9) | 0) !== suit) continue;
    if (c[u]) return true;
  }
  return false;
}

/**
 * 改良：13 张手牌，摸到哪些牌之后（仍是同一向听）能让有效进张变多。
 * 返回按剩余枚数加权的张数，以及这些牌本身。
 */
function improveOf(h13, baseShanten, baseUkeire) {
  const c = countsOf(h13);
  let count = 0;
  let kinds = 0;
  const tiles = [];
  for (let t = 0; t < TYPES; t++) {
    if (c[t] >= 4) continue;
    if (!related(c, t)) continue;
    c[t]++;
    const s1 = shanten(c);
    if (s1 !== baseShanten) { c[t]--; continue; } // 进张（更低）或更差，都不算改良
    const r = bestAfterDrawCounts(c);
    c[t]--;
    if (r.ukeire > baseUkeire) {
      count += 3 - c[t];
      kinds++;
      tiles.push(t);
    }
  }
  return { count, kinds, tiles };
}

export function analyzeHand(hand) {
  const c = countsOf(hand);
  const cands = [];
  for (let t = 0; t < TYPES; t++) {
    if (!c[t]) continue;
    c[t]--;
    const s = shanten(c);
    const u = ukeire(c);
    const iso = isolation(c, t);
    c[t]++;
    cands.push({
      tile: t,
      shanten: s,
      ukeire: u.total,
      kinds: u.list.length,
      waits: u.list.map((x) => x.tile),
      iso,
    });
  }
  cands.sort((a, b) =>
    a.shanten - b.shanten ||
    b.ukeire - a.ukeire ||
    a.iso - b.iso ||
    edgeRank(a.tile) - edgeRank(b.tile) ||
    a.tile - b.tile
  );
  return cands;
}

/**
 * 评估一次出牌。
 * verdict: good | sub | wrong
 */
const handInfoCache = new Map();

/** 手牌级别的分析结果：与「打哪张」无关的部分，整手算一次即可复用 */
function handInfo(hand) {
  const key = hand.join(',');
  const hit = handInfoCache.get(key);
  if (hit) return hit;
  const cands = analyzeHand(hand);
  const bestShanten = Math.min(...cands.map((c) => c.shanten));
  const atBest = cands.filter((c) => c.shanten === bestShanten);
  const maxUkeire = Math.max(...atBest.map((c) => c.ukeire));
  const tied = atBest.filter((c) => c.ukeire === maxUkeire);

  // 一阶打平的候选，再看「改良」：摸到哪些牌还能把进张做宽
  let bestImpr = null;
  if (tied.length > 1) {
    for (const c of tied) {
      const h13 = hand.slice();
      h13.splice(h13.indexOf(c.tile), 1);
      const im = improveOf(h13, c.shanten, c.ukeire);
      c.impr = im.count;
      c.imprKinds = im.kinds;
      if (bestImpr === null || c.impr > bestImpr) bestImpr = c.impr;
    }
  }
  const bestTiles = bestImpr === null ? tied : tied.filter((c) => c.impr === bestImpr);
  const info = { cands, bestShanten, maxUkeire, tied, bestTiles, bestImpr };
  if (handInfoCache.size > 24) handInfoCache.clear();
  handInfoCache.set(key, info);
  return info;
}

/** 提前把某一手算好（摸完牌后空闲时调用，点牌时就不用等） */
export function prewarm(hand) {
  try { handInfo(hand); } catch { /* ignore */ }
}

export function judgeDiscard(hand, tile) {
  const { cands, bestShanten, maxUkeire, tied, bestTiles, bestImpr } = handInfo(hand);
  const chosen = cands.find((c) => c.tile === tile);
  // 最优 = 一阶最优且后续改良不掉队；优 = 一阶等价但后续稍差；次优 = 进张更少；退向听 = 向听退步
  let verdict = 'wrong';
  if (chosen.shanten === bestShanten) {
    if (chosen.ukeire < maxUkeire) verdict = 'sub';
    else if (bestImpr === null || (chosen.impr ?? bestImpr) >= bestImpr) verdict = 'best';
    else verdict = 'good';
  }
  return { verdict, chosen, bestShanten, maxUkeire, bestTiles, cands, bestImpr, tied: tied.length };
}

/** 中文评语（本地即时生成，不依赖网络） */
export function describe(result, hand) {
  const { verdict, chosen, bestShanten, maxUkeire, bestTiles, tied } = result;
  const name = tileName(chosen.tile);
  const names = (list) => list.map((b) => tileName(b.tile)).slice(0, 3).join(' / ');
  const bestName = names(bestTiles);
  const isTenpai = chosen.shanten === 0;
  const state = isTenpai ? '已听牌' : `仍 ${chosen.shanten} 向听`;

  if (verdict === 'best') {
    const detail = `${state}，有效进张 ${chosen.ukeire} 张（${chosen.kinds} 种）`;
    if (tied > 1 && chosen.impr !== undefined) {
      const same = result.cands.filter(
        (c) => c.shanten === bestShanten && c.ukeire === maxUkeire && c.tile !== chosen.tile && (c.impr ?? chosen.impr) < chosen.impr,
      );
      const lowest = Math.min(...same.map((c) => c.impr));
      const gain = Number.isFinite(lowest) ? chosen.impr - lowest : 0;
      return {
        title: `打${name}，最优`,
        detail: `${detail}，而且留它最划算。`,
        extra: same.length
          ? `打 ${names(same)} 现在和它一样（同向听、同进张），但后续改良少 ${gain} 张，改听会窄一点。`
          : '',
      };
    }
    return {
      title: `打${name}，最优`,
      detail: `${detail}，是这一手最好的选择。`,
      extra: bestTiles.length > 1 ? `同样可打的还有 ${bestName}。` : '',
    };
  }

  if (verdict === 'good') {
    const best = bestTiles[0];
    const gain = best && best.impr !== undefined && chosen.impr !== undefined ? best.impr - chosen.impr : 0;
    return {
      title: `打${name}，优`,
      detail: `和 ${names(bestTiles)} 现在完全等价（${chosen.shanten} 向听、${chosen.ukeire} 张）${isTenpai ? '、都已听牌' : ''}，这样打不算错。`,
      extra: gain > 0
        ? `差别在后面：留 ${names(bestTiles)} 能多 ${gain} 张改良，摸到后牌面更宽。`
        : `差别在后面：留 ${names(bestTiles)} 的后续更好。`,
    };
  }

  if (verdict === 'sub') {
    const gap = maxUkeire - chosen.ukeire;
    return {
      title: `打${name}，次优`,
      detail: `向听没退（${chosen.shanten} 向听），但有效进张只有 ${chosen.ukeire} 张，比最佳少 ${gap} 张。`,
      extra: `最佳是 ${bestName}（${maxUkeire} 张）。`,
    };
  }

  return {
    title: `打${name}，退向听`,
    detail: `打出后变成 ${chosen.shanten} 向听，而打 ${bestName} 可以${bestShanten === 0 ? '直接听牌' : `保持 ${bestShanten} 向听`}。`,
    extra: '拆搭先看向听，再看进张：向听退一步，胡牌就慢一圈。',
  };
}

/* ------------------------------------------------------------------ *
 * 拆解：把手牌拆成「面子 / 搭子 / 将 / 孤张」，给界面画结构用
 * ------------------------------------------------------------------ */

const SUIT_SHAPE = (i) => i % 9; // 0..8

function partialShape(i) {
  const r = SUIT_SHAPE(i);
  if (r === 0) return { shape: '边张', name: '12' };
  if (r === 7) return { shape: '边张', name: '89' };
  return { shape: '两面', name: '两面' };
}

/** 搭子要的那几张牌（用于界面上写「等 X/Y」） */
function waitsFor(shape, a, b) {
  const suit = (a / 9) | 0;
  const same = (t) => t >= suit * 9 && t < suit * 9 + 9;
  const out = [];
  if (b === undefined) {
    out.push(a); // 对子：再来一张成刻子，或当将
  } else if (b - a === 1) {
    if (a - 1 >= 0 && same(a - 1)) out.push(a - 1);
    if (b + 1 < TYPES && same(b + 1)) out.push(b + 1);
  } else if (b - a === 2) {
    out.push(a + 1);
  }
  return out;
}

function betterBlock(a, b) {
  if (!b) return true;
  if (a.shanten !== b.shanten) return a.shanten < b.shanten;
  if (a.m !== b.m) return a.m > b.m;
  if (a.singles !== b.singles) return a.singles < b.singles;
  if (a.p !== b.p) return a.p > b.p;
  return false;
}

function bestStructure(c) {
  let best = null;

  function record(m, p, pair, blocks) {
    const pp = Math.min(p, 4 - m);
    const shanten = 8 - 2 * m - pp - (pair ? 1 : 0);
    const singles = blocks.reduce((n, b) => n + (b.kind === 'single' ? b.tiles.length : 0), 0);
    const cand = { shanten, m, p: pp, singles, pair, blocks: blocks.slice() };
    if (betterBlock(cand, best)) best = cand;
  }

  function walk(m, p, pair, blocks) {
    let i = 0;
    while (i < TYPES && !c[i]) i++;
    if (i >= TYPES) { record(m, p, pair, blocks); return; }

    if (m < 4) {
      if (c[i] >= 3) {
        c[i] -= 3;
        blocks.push({ kind: 'meld', shape: '刻子', tiles: [i, i, i] });
        walk(m + 1, p, pair, blocks);
        blocks.pop();
        c[i] += 3;
      }
      if (i % 9 <= 6 && c[i + 1] && c[i + 2]) {
        c[i]--; c[i + 1]--; c[i + 2]--;
        blocks.push({ kind: 'meld', shape: '顺子', tiles: [i, i + 1, i + 2] });
        walk(m + 1, p, pair, blocks);
        blocks.pop();
        c[i]++; c[i + 1]++; c[i + 2]++;
      }
    }
    if (m + p < 4) {
      if (c[i] >= 2) {
        c[i] -= 2;
        blocks.push({ kind: 'partial', shape: pair ? '对子' : '对子', tiles: [i, i] });
        walk(m, p + 1, pair, blocks);
        blocks.pop();
        c[i] += 2;
      }
      if (i % 9 <= 7 && c[i + 1]) {
        const s = partialShape(i);
        c[i]--; c[i + 1]--;
        blocks.push({ kind: 'partial', shape: s.shape, tiles: [i, i + 1] });
        walk(m, p + 1, pair, blocks);
        blocks.pop();
        c[i]++; c[i + 1]++;
      }
      if (i % 9 <= 6 && c[i + 2]) {
        c[i]--; c[i + 2]--;
        blocks.push({ kind: 'partial', shape: '嵌张', tiles: [i, i + 2] });
        walk(m, p + 1, pair, blocks);
        blocks.pop();
        c[i]++; c[i + 2]++;
      }
    }
    // 当作孤张
    c[i]--;
    blocks.push({ kind: 'single', shape: '孤张', tiles: [i] });
    walk(m, p, pair, blocks);
    blocks.pop();
    c[i]++;
  }

  // 无将
  walk(0, 0, false, []);
  // 每一对当将
  for (let t = 0; t < TYPES; t++) {
    if (c[t] >= 2) {
      c[t] -= 2;
      walk(0, 0, true, [{ kind: 'pair', shape: '将', tiles: [t, t] }]);
      c[t] += 2;
    }
  }
  return best;
}

/**
 * 手牌拆解（与向听数口径一致）。
 * 返回 { shanten, blocks:[{kind,shape,tiles,waitText?}], sevenPairs }
 */
export function decompose(hand) {
  const c = countsOf(hand);
  const seven = chiitoiShanten(c);
  const best = bestStructure(c);
  const isSevenShape = seven === -1 && c.every((n) => n === 0 || n === 2);

  if (seven < best.shanten || isSevenShape) {
    const blocks = [];
    let singles = [];
    for (let t = 0; t < TYPES; t++) {
      const n = c[t];
      if (n >= 2) {
        for (let k = 0; k < n >> 1; k++) {
          blocks.push({ kind: 'pair', shape: '对子', tiles: [t, t], waitText: '等 1 张成刻' });
        }
        if (n % 2) singles.push(t);
      } else if (n === 1) singles.push(t);
    }
    blocks.push(...singles.map((t) => ({ kind: 'single', shape: '孤张', tiles: [t] })));
    return { shanten: seven, blocks, sevenPairs: true };
  }

  const blocks = best.blocks.map((b) => {
    const out = { ...b, tiles: b.tiles.slice() };
    if (b.kind === 'partial') {
      const w = waitsFor(b.shape, b.tiles[0], b.tiles[1]);
      if (b.shape === '对子') out.waitText = '等成刻 / 当将';
      else out.waitText = '等 ' + w.map(tileShort).join(' / ');
    }
    return out;
  });
  // 稳定排序：面子 → 搭子 → 将 → 孤张，内部按首张
  const order = { meld: 0, partial: 1, pair: 2, single: 3 };
  blocks.sort((a, b) => order[a.kind] - order[b.kind] || a.tiles[0] - b.tiles[0]);
  return { shanten: best.shanten, blocks, sevenPairs: false };
}

/** 打掉某张之后的有效进张列表（按张数降序） */
export function ukeireAfter(hand, tile) {
  const c = countsOf(hand);
  if (!c[tile]) return { base: 0, total: 0, list: [] };
  c[tile]--;
  const u = ukeire(c);
  u.list.sort((a, b) => b.count - a.count || a.tile - b.tile);
  return u;
}


/* ------------------------------------------------------------------ *
 * 牌型 / 发牌
 * ------------------------------------------------------------------ */

export function handType(c) {
  const types = [];
  let suits = new Set();
  let pairs = 0, allEven = true;
  for (let i = 0; i < TYPES; i++) {
    if (c[i] > 0) suits.add((i / 9) | 0);
    if (c[i] >= 2) pairs++;
    if (c[i] % 2 !== 0) allEven = false;
  }
  if (allEven && pairs === 7) types.push('七对');
  if (suits.size === 1) types.push('清一色');
  // 碰碰胡：去掉将后每种牌数量都是 3 的倍数
  let pengpeng = false;
  for (let i = 0; i < TYPES; i++) {
    if (c[i] >= 2) {
      const d = c.slice();
      d[i] -= 2;
      let ok = true;
      for (let j = 0; j < TYPES; j++) if (d[j] % 3 !== 0) { ok = false; break; }
      if (ok) { pengpeng = true; break; }
    }
  }
  if (pengpeng) types.push('碰碰胡');
  if (!types.length) types.push('平胡');
  return types;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildWall() {
  const wall = [];
  for (let t = 0; t < TYPES; t++) for (let k = 0; k < 4; k++) wall.push(t);
  return wall;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function newRound(seed = (Date.now() >>> 0)) {
  const rng = mulberry32(seed);
  let hand, wall;
  for (let attempt = 0; attempt < 80; attempt++) {
    wall = shuffle(buildWall(), rng);
    hand = wall.slice(0, 14).sort((a, b) => a - b);
    if (shanten(countsOf(hand)) <= 4) break;
  }
  return { seed, hand, wall: wall.slice(14), cursor: 0 };
}
