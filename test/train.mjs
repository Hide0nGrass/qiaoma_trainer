// 训练「交叉特征」读牌模型：把弃牌序列拆成特征，用模拟数据拟合 logistic 回归。
// 用法：node test/train.mjs [局数]
import { writeFileSync } from 'node:fs';
import { simulateRound, newDeck } from '../opponent.mjs';

const ROUNDS = Number(process.argv[2] || 600);
const KINDS = 27;
const FEATS = 11;

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

// 特征（顺序固定，训练和线上必须一致）：
// 0 偏置 | 1 他打过这张 | 2 他在后 4 张打过这张 | 3 两边筋都在牌河
// 4 两边筋都是早期打的 | 5 这一门弃牌占比 | 6 已见/4 | 7 中张 3-5
// 8 后 4 张手切的 ±1/±2 邻居数/3 | 9 前 3 张弃牌的邻居数/3 | 10 剩余枚数/4
function featsOf(ds, visible) {
  const n = ds.length;
  const tiles = ds.map((d) => d.tile);
  const suitDisc = [0, 0, 0];
  for (const t of tiles) suitDisc[(t / 9) | 0]++;
  const lateCut = [], earlyCut = [];
  for (let i = 0; i < n; i++) {
    if (n - i <= 4 && !ds[i].tsumogiri) lateCut.push(tiles[i]);
    if (i < 3) earlyCut.push(tiles[i]);
  }
  const own = new Map();
  for (let i = 0; i < n; i++) {
    const cur = own.get(tiles[i]) || { n: 0, late: 0 };
    cur.n++;
    if (n - i <= 4) cur.late++;
    own.set(tiles[i], cur);
  }
  const near = (list, t) => {
    const suit = (t / 9) | 0, rank = t % 9;
    let c = 0;
    for (const x of list) {
      if (((x / 9) | 0) !== suit) continue;
      const d = Math.abs((x % 9) - rank);
      if (d === 1 || d === 2) c++;
    }
    return c;
  };

  const rows = [];
  for (let t = 0; t < KINDS; t++) {
    const suit = (t / 9) | 0, rank = t % 9;
    const o = own.get(t) || { n: 0, late: 0 };
    const sa = t - 3 >= suit * 9 ? t - 3 : -1;
    const sb = t + 3 <= suit * 9 + 8 ? t + 3 : -1;
    const a = sa >= 0 && tiles.includes(sa) ? 1 : 0;
    const b = sb >= 0 && tiles.includes(sb) ? 1 : 0;
    rows.push([
      1,
      o.n ? 1 : 0,
      o.late ? 1 : 0,
      a && b ? 1 : 0,
      a && b && earlyCut.includes(sa) && earlyCut.includes(sb) ? 1 : 0,
      suitDisc[suit] / (n || 1),
      (visible[t] || 0) / 4,
      rank >= 3 && rank <= 5 ? 1 : 0,
      near(lateCut, t) / 3,
      near(earlyCut, t) / 3,
      Math.max(0, 4 - (visible[t] || 0)) / 4,
    ]);
  }
  return rows;
}

const X = [], Y = [], G = [];
for (let g = 0; g < ROUNDS; g++) {
  const r = simulateRound(5000 + g * 104729, 16);
  if (!r || r.knockAt < 0 || !r.waits || !r.waits.length) continue;
  const ds = r.path.map((x) => ({ tile: x.discard, tsumogiri: !!x.tsumogiri }));
  if (ds.length < 5) continue;

  const visible = new Array(KINDS).fill(0);
  for (const d of ds) visible[d.tile]++;
  let need = 13;
  for (const t of shuffle(newDeck())) {
    if (visible[t] >= 4) continue;
    visible[t]++; need--;
    if (!need) break;
  }

  const truth = new Set(r.waits.map((w) => w.tile));
  const rows = featsOf(ds, visible);
  for (let t = 0; t < KINDS; t++) {
    X.push(rows[t]); Y.push(truth.has(t) ? 1 : 0); G.push(g);
  }
}

const ids = [...new Set(G)];
const cut = Math.floor(ids.length * 0.8);
const train = new Set(ids.slice(0, cut));
const w = new Float64Array(FEATS).fill(0);
const lr = 0.15, l2 = 0.002;

for (let epoch = 0; epoch < 400; epoch++) {
  const grad = new Float64Array(FEATS);
  let cnt = 0;
  for (let i = 0; i < X.length; i++) {
    if (!train.has(G[i])) continue;
    const x = X[i];
    let z = 0;
    for (let k = 0; k < FEATS; k++) z += w[k] * x[k];
    const p = 1 / (1 + Math.exp(-z));
    const d = p - Y[i];
    for (let k = 0; k < FEATS; k++) grad[k] += d * x[k];
    cnt++;
  }
  for (let k = 0; k < FEATS; k++) {
    w[k] -= lr * (grad[k] / cnt + l2 * w[k]);
  }
}

// holdout 评估：每局取分数前 3/5 名
let hit3 = 0, hit5 = 0, trials = 0, brier = 0;
for (let i = 0; i < X.length; i += KINDS) {
  if (train.has(G[i])) continue;
  const scores = [];
  for (let t = 0; t < KINDS; t++) {
    const x = X[i + t];
    let z = 0;
    for (let k = 0; k < FEATS; k++) z += w[k] * x[k];
    scores.push({ t, s: z, y: Y[i + t] });
  }
  scores.sort((a, b) => b.s - a.s);
  const truth = scores.filter((r) => r.y).map((r) => r.t);
  const top3 = new Set(scores.slice(0, 3).map((r) => r.t));
  const top5 = new Set(scores.slice(0, 5).map((r) => r.t));
  if (truth.some((t) => top3.has(t))) hit3++;
  if (truth.some((t) => top5.has(t))) hit5++;
  for (const r of scores) {
    const p = 1 / (1 + Math.exp(-r.s));
    brier += (p - r.y) ** 2;
  }
  trials++;
}
console.log('训练局', train.size, '验证局', trials);
console.log('权重', [...w].map((v) => v.toFixed(3)).join(', '));
console.log(`验证 top3 ${(hit3 / trials * 100).toFixed(0)}%  top5 ${(hit5 / trials * 100).toFixed(0)}%  brier ${(brier / (trials * KINDS)).toFixed(4)}`);
writeFileSync('test/read-weights.json', JSON.stringify([...w]), 'utf8');
