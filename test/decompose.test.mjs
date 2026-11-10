/** 拆解功能自测：结构合法、与向听数一致、性能 */
import {
  countsOf, decompose, newRound, shanten, tileName, ukeireAfter,
} from '../engine.mjs';

const ok = [];
const bad = [];
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` (${extra})` : ''));

function rebuild(blocks) {
  const c = new Uint8Array(27);
  for (const b of blocks) for (const t of b.tiles) c[t]++;
  return c;
}

// 1) 手洗的一手，检查结构张数与手牌完全一致
const hand = [0, 1, 2, 3, 4, 9, 9, 10, 11, 18, 19, 19, 20, 20];
const d = decompose(hand);
console.log('blocks', d.blocks.map((b) => `${b.shape}:${b.tiles.map(tileName).join('')}`).join(' | '));
check('拆解张数守恒', JSON.stringify(Array.from(rebuild(d.blocks))) === JSON.stringify(Array.from(countsOf(hand))));
check('拆解向听与引擎一致', d.shanten === shanten(countsOf(hand)), `${d.shanten} vs ${shanten(countsOf(hand))}`);
check('有面子块', d.blocks.some((b) => b.kind === 'meld'));
check('块内牌数合法', d.blocks.every((b) => (b.kind === 'meld' ? b.tiles.length === 3 : b.kind === 'single' ? b.tiles.length === 1 : b.tiles.length === 2)));

// 2) 边张 / 嵌张 / 两面 的命名
const shapes = (tiles) => decompose(tiles).blocks.filter((b) => b.kind === 'partial').map((b) => b.shape);
check('12 判边张', shapes([0, 1, 9, 9, 10, 10, 11, 11, 18, 18, 19, 19, 20]).includes('边张'));
check('89 判边张', shapes([7, 8, 9, 9, 10, 10, 11, 11, 18, 18, 19, 19, 20]).includes('边张'));
check('13 判嵌张', shapes([0, 2, 9, 9, 10, 10, 11, 11, 18, 18, 19, 19, 20]).includes('嵌张'));
const edge = decompose([0, 1, 9, 9, 10, 10, 11, 11, 18, 18, 19, 19, 20]);
check('12 边张 waitText 含 3万', edge.blocks.some((b) => b.shape === '边张' && /3万/.test(b.waitText || '')),
  edge.blocks.map((b) => b.shape + ':' + b.waitText).join(','));

// 3) 七对
const chi = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
const dc = decompose(chi);
check('七对识别', dc.sevenPairs === true && dc.shanten === shanten(countsOf(chi)), `${dc.sevenPairs} ${dc.shanten}`);

// 4) 每种块的 tiles 都能在手里找到（张数不超）
function legal(blocks, tiles) {
  const c = countsOf(tiles);
  const used = new Uint8Array(27);
  for (const b of blocks) for (const t of b.tiles) used[t]++;
  return used.every((n, i) => n <= c[i]);
}
check('不超用牌', legal(dc.blocks, chi));

// 5) 随机 200 手：向听一致 + 张数守恒 + 性能
let worst = 0;
let sum = 0;
let consistent = 0;
for (let k = 0; k < 200; k++) {
  const r = newRound(1000 + k);
  const t0 = performance.now();
  const dd = decompose(r.hand);
  const dt = performance.now() - t0;
  worst = Math.max(worst, dt);
  sum += dt;
  if (dd.shanten === shanten(countsOf(r.hand))) consistent++;
  if (JSON.stringify(Array.from(rebuild(dd.blocks))) !== JSON.stringify(Array.from(countsOf(r.hand)))) {
    check('随机手张数守恒', false, `seed ${1000 + k}`);
    break;
  }
}
check('200 手向听一致', consistent === 200, `${consistent}/200`);
console.log(`拆解平均 ${(sum / 200).toFixed(2)}ms / 手，最慢 ${worst.toFixed(1)}ms`);
check('拆解平均 < 25ms', sum / 200 < 25);

// 6) ukeireAfter
const u = ukeireAfter(hand, 0);
check('ukeireAfter 有结果', u.total > 0 && u.list.length > 0, `${u.total}张`);
check('ukeireAfter 排序', u.list.every((x, i) => i === 0 || u.list[i - 1].count >= x.count));

console.log('\nPASS', ok.length, ok);
if (bad.length) { console.log('FAIL', bad.length, bad); process.exitCode = 1; }
