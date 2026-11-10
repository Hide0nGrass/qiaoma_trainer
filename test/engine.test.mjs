import assert from 'node:assert/strict';
import {
  countsOf, tileName, shantenOfTiles, isWin, waitsOf, ukeire, analyzeHand,
  judgeDiscard, describe, handType, newRound, mulberry32, buildWall, tilesOf, shanten,
} from '../engine.mjs';

const T = (suit, ...ranks) => ranks.map((r) => suit * 9 + r - 1);
const M = (...r) => T(0, ...r), P = (...r) => T(1, ...r), S = (...r) => T(2, ...r);
const show = (h) => tilesOf(countsOf(h)).map(tileName).join(' ');
let pass = 0;

function ok(name, fn) {
  fn();
  pass++;
  console.log('  ✓', name);
}

console.log('向听 / 胡牌');

ok('标准胡牌 123m456m789m123p99s = -1', () => {
  const h = [...M(1, 2, 3, 4, 5, 6, 7, 8, 9), ...P(1, 2, 3), ...S(9, 9)];
  assert.equal(h.length, 14);
  assert.equal(shantenOfTiles(h), -1);
  assert.equal(isWin(countsOf(h)), true);
});

ok('七对胡牌 = -1', () => {
  const h = [...M(1, 1, 2, 2, 3, 3), ...P(4, 4, 5, 5), ...S(6, 6, 7, 7)];
  assert.equal(shantenOfTiles(h), -1);
});

ok('听牌 123m456m789m11p23p：0 向听，听 1p/4p', () => {
  const h = [...M(1, 2, 3, 4, 5, 6, 7, 8, 9), ...P(1, 1, 2, 3)];
  assert.equal(h.length, 13);
  assert.equal(shantenOfTiles(h), 0);
  const w = waitsOf(countsOf(h)).map((x) => x.tile);
  assert.deepEqual(w.sort((a, b) => a - b), [...P(1), ...P(4)].sort((a, b) => a - b));
});

ok('单钓 123m456m789m123p + 9s：0 向听，听 9s', () => {
  const h = [...M(1, 2, 3, 4, 5, 6, 7, 8, 9), ...P(1, 2, 3), ...S(9)];
  assert.equal(shantenOfTiles(h), 0);
  assert.deepEqual(waitsOf(countsOf(h)).map((x) => x.tile), S(9));
});

ok('七对听牌：6 对 + 单张，0 向听', () => {
  const h = [...M(1, 1, 2, 2, 3, 3), ...P(4, 4, 5, 5), ...S(6, 6, 7)];
  assert.equal(shantenOfTiles(h), 0);
  assert.deepEqual(waitsOf(countsOf(h)).map((x) => x.tile), S(7));
});

console.log('进张');

ok('11p23p 听牌进张 = 6 张（1p×2 + 4p×4）', () => {
  const h = [...M(1, 2, 3, 4, 5, 6, 7, 8, 9), ...P(1, 1, 2, 3)];
  const u = ukeire(countsOf(h));
  assert.equal(u.total, 6);
  assert.deepEqual(u.list.map((x) => x.tile).sort((a, b) => a - b), [...P(1), ...P(4)]);
});

ok('一向听 13 张：进张覆盖多种牌', () => {
  const h = [...M(1, 2, 3, 4, 5, 6), ...P(2, 3, 4), ...S(4, 5), 27 - 1].slice(0, 13);
  const u = ukeire(countsOf(h));
  assert.ok(u.total > 0);
});

console.log('拆搭评估');

ok('两张孤张单钓形：打 5s / 9s 同属最高档（最优或优）', () => {
  const h = [...M(1, 2, 3, 4, 5, 6, 7, 8, 9), ...P(1, 2, 3), ...S(5, 9)];
  assert.equal(h.length, 14);
  const a = judgeDiscard(h, S(5)[0]);
  const b = judgeDiscard(h, S(9)[0]);
  assert.ok(a.verdict === 'best' || a.verdict === 'good');
  assert.ok(b.verdict === 'best' || b.verdict === 'good');
  assert.equal(a.verdict, b.verdict);
  assert.equal(a.bestShanten, 0);
});

ok('一阶打平时，后续改良多的那张才是「最优」', () => {
  // 二四六 777 万 + 11 24 9 筒 + 34 8 条：打九筒与打八条同向听同进张，但留九筒改良更多
  const h = [...M(2, 4, 6, 7, 7, 7), ...P(1, 1, 2, 4, 9), ...S(3, 4, 8)];
  assert.equal(h.length, 14);
  const bestCut = judgeDiscard(h, P(9)[0]);
  const goodCut = judgeDiscard(h, S(8)[0]);
  assert.equal(bestCut.verdict, 'best');
  assert.equal(goodCut.verdict, 'good');
  assert.ok(bestCut.chosen.impr > goodCut.chosen.impr);
  assert.ok(bestCut.bestImpr >= goodCut.chosen.impr);
  const dBest = describe(bestCut, h);
  const dGood = describe(goodCut, h);
  assert.match(dBest.title, /最优/);
  assert.match(dGood.title, /优$/);
  assert.match(dGood.extra, /改良/);
});

ok('拆好搭子会被判退向听', () => {
  // 123m 456m 789m 11p 23p + 5s  → 打 2p 拆两面搭
  const h = [...M(1, 2, 3, 4, 5, 6, 7, 8, 9), ...P(1, 1, 2, 3), ...S(5)];
  assert.equal(h.length, 14);
  const r = judgeDiscard(h, P(2)[0]);
  assert.equal(r.verdict, 'wrong');
  const txt = describe(r, h);
  assert.match(txt.title, /退向听/);
});

ok('describe 三种评级都能生成文案', () => {
  const h = [...M(1, 2, 3, 4, 5, 6, 7, 8, 9), ...P(1, 1, 2, 3), ...S(5)];
  const r = judgeDiscard(h, P(2)[0]);
  assert.ok(describe(r, h).detail.length > 0);
});

console.log('构造性验证');

ok('随机构造 400 副胡牌，全部 isWin', () => {
  const rng = mulberry32(20261110);
  for (let n = 0; n < 400; n++) {
    const c = new Uint8Array(27);
    const suits = [0, 1, 2];
    let okBuild = false;
    for (let attempt = 0; attempt < 50 && !okBuild; attempt++) {
      c.fill(0);
      let good = true;
      for (let k = 0; k < 4; k++) {
        const suit = suits[Math.floor(rng() * 3)];
        if (rng() < 0.35) {
          const t = suit * 9 + Math.floor(rng() * 9);
          if (c[t] > 1) { good = false; break; }
          c[t] += 3;
        } else {
          const start = Math.floor(rng() * 7);
          const base = suit * 9 + start;
          if (c[base] > 1 || c[base + 1] > 1 || c[base + 2] > 1) { good = false; break; }
          c[base]++; c[base + 1]++; c[base + 2]++;
        }
      }
      if (!good) continue;
      const suit = suits[Math.floor(rng() * 3)];
      const t = suit * 9 + Math.floor(rng() * 9);
      if (c[t] > 2) continue;
      c[t] += 2;
      okBuild = true;
    }
    if (!okBuild) continue;
    assert.equal(shanten(c), -1, '构造胡牌却未判胡: ' + tilesOf(c).map(tileName).join(' '));
    // 去掉一张应听牌，且听这张
    for (let t = 0; t < 27; t++) {
      if (!c[t]) continue;
      c[t]--;
      assert.equal(shanten(c), 0, '胡牌拆一张应为 0 向听');
      assert.ok(waitsOf(c).some((w) => w.tile === t), '应听回被拆的那张');
      c[t]++;
      break;
    }
  }
});

ok('随机 14 张：向听在 [-1,8]，分析不崩', () => {
  const rng = mulberry32(7);
  for (let n = 0; n < 300; n++) {
    const wall = buildWall();
    for (let i = wall.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [wall[i], wall[j]] = [wall[j], wall[i]];
    }
    const h = wall.slice(0, 14);
    const s = shantenOfTiles(h);
    assert.ok(s >= -1 && s <= 8, 'shanten 越界 ' + s);
    const cands = analyzeHand(h);
    assert.equal(cands.length, new Set(h).size);
    assert.equal(cands[0].shanten, Math.min(...cands.map((x) => x.shanten)));
    for (const cd of cands) {
      const c2 = countsOf(h);
      c2[cd.tile]--;
      assert.equal(shanten(c2), cd.shanten, '候选向听不一致');
    }
  }
});

ok('发牌：14 张、牌张合法、手牌不太烂', () => {
  for (let i = 0; i < 60; i++) {
    const r = newRound(1000 + i);
    assert.equal(r.hand.length, 14);
    assert.equal(r.wall.length, 94);
    assert.ok(shantenOfTiles(r.hand) <= 4);
    const all = [...r.hand, ...r.wall];
    assert.equal(all.length, 108);
    const c = countsOf(all);
    for (let t = 0; t < 27; t++) assert.equal(c[t], 4);
  }
});

ok('同一 seed 发牌可复现', () => {
  const a = newRound(42), b = newRound(42);
  assert.deepEqual(a.hand, b.hand);
  assert.deepEqual(a.wall, b.wall);
});

ok('牌型：七对 / 清一色 / 碰碰胡', () => {
  assert.ok(handType(countsOf([...M(1, 1, 2, 2, 3, 3), ...P(4, 4, 5, 5), ...S(6, 6, 7, 7)])).includes('七对'));
  assert.ok(handType(countsOf([...M(1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 5, 5)])).includes('清一色'));
  assert.ok(handType(countsOf([...M(1, 1, 1, 2, 2, 2, 3, 3, 3), ...P(4, 4, 4), ...S(9, 9)])).includes('碰碰胡'));
});

console.log('性能');

ok('analyzeHand 平均 < 12ms', () => {
  const rng = mulberry32(99);
  const hands = [];
  for (let i = 0; i < 40; i++) hands.push(newRound(2000 + i).hand);
  const t0 = performance.now();
  for (const h of hands) analyzeHand(h);
  const avg = (performance.now() - t0) / hands.length;
  console.log(`    平均 ${avg.toFixed(2)}ms / 手`);
  assert.ok(avg < 12, '太慢: ' + avg);
});

console.log(`\n全部通过：${pass} 项`);
