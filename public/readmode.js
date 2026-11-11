// 摇铃练习：他敲牌之后的读牌二选一。
//
// 每题：模拟出一个「已经敲了」的对手（牌河 + 冻结的 13 张），发我 13 张手牌，
// 指定其中一张问「打这张出去，危不危险」，我点危险 / 不危险，立刻判分并揭底。
//
// 题目是平衡的：一半来自他真正的听张（危险），一半不在他的听张里（不危险），
// 否则一路点「不危险」也能有八成正确率，练不出东西。
import { decompose, tileName } from '../engine.mjs';
import { mulberry32, shuffle, newDeck } from '../opponent.mjs';
import { simulateRound } from '../opponent.mjs';
import { faceSVG } from './tiles.js';

const KINDS = 27;
const MIN_RIVER = 5;   // 至少 5 张弃牌才出题，否则等于让玩家猜
const MAX_TURNS = 16;  // simulateRound 的上限：他最多摸 16 手就要听牌
const STAT_KEY = 'qiaoma.readquiz.v1';

function counts(arr) {
  const c = new Array(KINDS).fill(0);
  for (const t of arr) c[t]++;
  return c;
}

/** 用种子造一道题；失败返回 null（那局他没敲） */
export function makeScenario(seed) {
  const sim = simulateRound(seed, MAX_TURNS);
  if (sim.knockAt < MIN_RIVER || !sim.waits?.length || !sim.frozenHand) return null;

  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const discards = sim.path.map((x) => x.discard);
  const visible = counts(discards);
  const waitsTiles = sim.waits.map((w) => w.tile);
  const isWait = new Set(waitsTiles);

  // 他的手牌 + 牌河是「已知」的，牌池里剩下的才是能发给我的
  const used = counts([...sim.frozenHand, ...discards]);

  const pickFrom = (pool) => (pool.length ? pool[Math.floor(rnd() * pool.length)] : null);

  // 一半问「他真在等的牌」，一半问「他不要的牌」
  const wantDanger = rnd() < 0.5;
  let q = null;
  if (wantDanger) {
    const pool = [];
    for (const t of waitsTiles) if (used[t] < 4) pool.push(t);
    q = pickFrom(pool);
  }
  if (q === null) {
    const pool = [];
    for (let t = 0; t < KINDS; t++) if (!isWait.has(t) && used[t] < 4) pool.push(t);
    q = pickFrom(pool);
  }
  if (q === null) return null;

  // 剩下的牌里发 12 张给我，凑成 13 张
  const bag = [];
  for (let t = 0; t < KINDS; t++) {
    const n = 4 - used[t] - (t === q ? 1 : 0);
    for (let i = 0; i < n; i++) bag.push(t);
  }
  shuffle(bag, rnd);
  const hand = [q, ...bag.slice(0, 12)].sort((a, b) => a - b);

  return {
    seed,
    hand,
    q,
    qIdx: hand.indexOf(q),
    danger: isWait.has(q),
    discards,
    knockTurn: sim.path.length,
    frozen: sim.frozenHand,
    waits: waitsTiles,
    visible: counts(hand).map((n, t) => Math.min(4, n + visible[t])),
  };
}

export function createReadMode(els, { toast } = {}) {
  const R = {
    on: false,
    no: 0,
    right: 0,
    total: 0,
    streak: 0,
    best: 0,
    scenario: null,
    state: 'idle',     // idle | question | revealed
    answer: null,
    showHand: false,
  };

  try {
    const saved = JSON.parse(localStorage.getItem(STAT_KEY) || '{}');
    R.total = saved.total | 0;
    R.right = saved.right | 0;
    R.best = saved.best | 0;
  } catch { /* 隐私模式 */ }

  function saveStats() {
    try {
      localStorage.setItem(STAT_KEY, JSON.stringify({ total: R.total, right: R.right, best: R.best }));
    } catch { /* ignore */ }
  }

  /* ---------- 渲染 ---------- */

  function tileEl(tile, { small = false, mark = false, idx = -1 } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile' + (small ? ' sm' : '') + (mark ? ' q' : '');
    b.dataset.tile = String(tile);
    if (idx >= 0) b.dataset.idx = String(idx);
    b.setAttribute('aria-label', tileName(tile));
    b.innerHTML = faceSVG(tile);
    return b;
  }

  function backEl() {
    const d = document.createElement('div');
    d.className = 'tile back';
    d.setAttribute('aria-hidden', 'true');
    return d;
  }

  /** 把他的 13 张按「面子 / 等待的那组 / 将」分好，用于揭底时讲解 */
  function hisGroups(sc) {
    const left = counts(sc.frozen);
    const take = (tiles) => {
      const out = [];
      for (const t of tiles) {
        if (left[t] > 0) { left[t]--; out.push(t); }
      }
      return out;
    };
    const blocks = decompose(sc.frozen).blocks;
    const groups = [];
    for (const b of blocks) {
      const tiles = take(b.tiles);
      if (!tiles.length) continue;
      const wait =
        b.kind === 'partial' ||
        (b.kind === 'single' && sc.waits.includes(tiles[0]));
      groups.push({ tiles, shape: b.shape, wait });
    }
    // 兜底：没被任何块吃掉的牌单独列出
    const rest = [];
    for (let t = 0; t < KINDS; t++) for (let i = 0; i < left[t]; i++) rest.push(t);
    if (rest.length) groups.push({ tiles: rest, shape: '', wait: false });
    return groups;
  }

  function paint() {
    const sc = R.scenario;
    if (!sc) return;
    const revealed = R.state === 'revealed';

    // 他的手牌：答完才翻开（翻开时按块分组，等待的那组描金）
    const his = document.createDocumentFragment();
    if (revealed) {
      for (const g of hisGroups(sc)) {
        const grp = document.createElement('span');
        grp.className = 'opp-grp' + (g.wait ? ' wait' : '');
        if (g.wait) grp.title = `这组在等 ${sc.waits.map(tileName).join(' / ')}`;
        for (const t of g.tiles) grp.appendChild(tileEl(t, { small: true }));
        his.appendChild(grp);
      }
    } else {
      for (let i = 0; i < sc.frozen.length; i++) his.appendChild(backEl());
    }
    els.oppHand.replaceChildren(his);

    // 牌河 + 敲的标记
    const riv = [];
    sc.discards.forEach((t, i) => {
      riv.push(tileEl(t, { small: true }));
      if (i + 1 === sc.knockTurn) {
        const sp = document.createElement('span');
        sp.className = 'knock-sep';
        sp.textContent = '敲';
        sp.title = '从这里开始他手牌冻结';
        riv.push(sp);
      }
    });
    els.oppRiver.replaceChildren(...riv);

    // 我的手牌，问题牌描金
    const frag = document.createDocumentFragment();
    sc.hand.forEach((t, i) => {
      const el = tileEl(t, { mark: i === sc.qIdx });
      if (i === sc.qIdx) el.title = '问的就是这张';
      frag.appendChild(el);
    });
    els.hand.replaceChildren(frag);

    els.no.textContent = `第 ${R.no} 题`;
    els.knock.textContent = `他第 ${sc.knockTurn} 手敲`;
    els.rate.textContent = R.total ? `正确 ${R.right}/${R.total} · ${Math.round((R.right / R.total) * 100)}%` : '正确 —';
    els.tag.textContent = revealed ? `他听 ${sc.waits.map(tileName).join(' / ')}` : '已敲 · 手牌冻结';
    els.tag.classList.toggle('knocked', true);

    if (els.quizQ) {
      els.quizQ.innerHTML = revealed
        ? `打 <b>${tileName(sc.q)}</b> 出去${sc.danger ? '会点炮' : '是安全的'}`
        : `打 <b>${tileName(sc.q)}</b> 出去，危不危险？`;
    }
    els.ansDanger.hidden = revealed;
    els.ansSafe.hidden = revealed;
    els.nextQ.hidden = !revealed;
    els.ansDanger.classList.toggle('picked', R.answer === 'danger');
    els.ansSafe.classList.toggle('picked', R.answer === 'safe');
  }

  function paintFeedback() {
    const sc = R.scenario;
    const correct = (R.answer === 'danger') === sc.danger;
    const cls = correct ? 'ok' : 'bad';
    const waits = sc.waits.map(tileName).join(' / ');
    const q = tileName(sc.q);

    // 用他真实的牌型讲清楚「为什么」：他把 4 组面子做完了，只剩一组在等
    const groups = hisGroups(sc);
    const waitGrp = groups.find((g) => g.wait);
    const grpName = waitGrp ? waitGrp.tiles.map(tileName).join('') : '';
    const grpShape = waitGrp ? waitGrp.shape : '';
    const why = sc.danger
      ? `他的 <b>${grpName}</b> 是${grpShape}，只等 <b>${waits}</b>；你打的 ${q} 正好补进这一组。`
      : `他的 <b>${grpName}</b> 是${grpShape}，只等 <b>${waits}</b>；你打的 ${q} 补不上任何一组，进不来。`;
    const meldN = groups.filter((g) => g.shape === '顺子' || g.shape === '刻子').length;
    const pairN = groups.filter((g) => g.shape === '将').length;
    const note = sc.discards.includes(sc.q)
      ? `顺带：这张他自己打过（現物）——敲麻没有振听，理论上还能等，但实战里几乎不会。`
      : '';

    els.fb.hidden = false;
    els.fb.className = `feedback ${cls}`;
    els.fb.innerHTML =
      `<span class="fb-mark">${correct ? '对' : '错'}</span>` +
      `<span class="fb-body">${sc.danger ? '他确实在等这张。' : '这张不在他的听张里。'}${why} ` +
      `他第 ${sc.knockTurn} 手敲，${meldN} 个面子 + ${pairN} 对将都已成形，牌河 ${sc.discards.length} 张。` +
      `${note ? `<span class="fb-note">${note}</span>` : ''}</span>` +
      `<span class="fb-score">连对 ${R.streak} · 最长 ${R.best}</span>`;
  }

  /* ---------- 流程 ---------- */

  function nextQuestion(seed) {
    let sc = null;
    let s = seed >>> 0;
    for (let i = 0; i < 60 && !sc; i++) sc = makeScenario((s + i * 7919) >>> 0);
    if (!sc) { toast?.('没造出题，再试一次'); return; }
    R.scenario = sc;
    R.state = 'question';
    R.answer = null;
    R.no++;
    els.fb.hidden = true;
    paint();
  }

  function answer(choice) {
    if (R.state !== 'question') return;
    const sc = R.scenario;
    R.answer = choice;
    R.state = 'revealed';
    const correct = (choice === 'danger') === sc.danger;
    R.total++;
    if (correct) {
      R.right++;
      R.streak++;
      if (R.streak > R.best) R.best = R.streak;
    } else {
      R.streak = 0;
    }
    saveStats();
    paint();
    paintFeedback();
  }

  /* ---------- 事件 ---------- */

  els.ansDanger.addEventListener('click', () => answer('danger'));
  els.ansSafe.addEventListener('click', () => answer('safe'));
  els.nextQ.addEventListener('click', () => nextQuestion((Math.random() * 0xffffffff) >>> 0));
  els.hand.addEventListener('click', (e) => {
    const el = e.target.closest('.tile');
    if (!el) return;
    if (Number(el.dataset.idx) === R.scenario?.qIdx) toast?.('问的就是这张，点下面的「危险 / 不危险」');
  });

  return {
    get state() { return R; },
    get active() { return R.on; },
    enter() {
      R.on = true;
      els.area.hidden = false;
      if (!R.scenario) nextQuestion((Math.random() * 0xffffffff) >>> 0);
    },
    leave() { R.on = false; els.area.hidden = true; },
    next() { nextQuestion((Math.random() * 0xffffffff) >>> 0); },
    answer,
    loadSeed(seed) { nextQuestion(seed); },
  };
}
