// 摇铃练习：他敲牌之后，你一张一张地出牌，判断会不会点炮。
//
// 一「局」= 一个已经敲了的对手（牌河 + 冻结的 13 张）。你手上有一串还没打的牌，
// 每次只把下一张拿出来问「打这张出去，危不危险」：
//   答对  → 这张按你的判断处理（说安全就打出去进你的牌河，说危险就扣下），继续下一张
//   答错  → 他荣和，本局结束，点炮那张进你的牌河
// 撑过 MAX_Q 张没点炮 = 本局逃掉。之后才换新的一局。
//
// 题目是平衡的：每局的牌串里一半是他的听张（危险）、一半不在听张里（安全），
// 否则一路点「不危险」也能有八成正确率，练不出东西。
import { decompose, tileName } from '../engine.mjs';
import { mulberry32, shuffle, simulateRound } from '../opponent.mjs';
import { faceSVG } from './tiles.js';

const KINDS = 27;
const MIN_RIVER = 5;   // 至少 5 张弃牌才出题，否则等于让玩家猜
const MAX_TURNS = 16;  // simulateRound 的上限：他最多摸 16 手就要听牌
const MAX_Q = 12;      // 撑过 12 张算「逃掉」
const STAT_KEY = 'qiaoma.readquiz.v2';

function counts(arr) {
  const c = new Array(KINDS).fill(0);
  for (const t of arr) c[t]++;
  return c;
}

/** 造一局：已敲的对手 + 一串待打的牌（一半危险一半安全） */
export function makeRound(seed) {
  const sim = simulateRound(seed, MAX_TURNS);
  if (sim.knockAt < MIN_RIVER || !sim.waits?.length || !sim.frozenHand) return null;

  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const discards = sim.path.map((x) => x.discard);
  const isWait = new Set(sim.waits.map((w) => w.tile));

  // 他手上的 + 他打出的，都不是我能摸到的
  const used = counts([...sim.frozenHand, ...discards]);
  const avail = (t) => 4 - used[t];

  // 危险池 / 安全池，各取一半
  const dangerPool = [];
  for (let t = 0; t < KINDS; t++) if (isWait.has(t)) for (let i = 0; i < avail(t); i++) dangerPool.push(t);
  const safePool = [];
  for (let t = 0; t < KINDS; t++) if (!isWait.has(t)) for (let i = 0; i < avail(t); i++) safePool.push(t);

  shuffle(dangerPool, rnd);
  shuffle(safePool, rnd);

  const half = Math.floor(MAX_Q / 2);
  const nd = Math.min(half, dangerPool.length);
  const ns = Math.min(MAX_Q - nd, safePool.length);
  const bag = [...dangerPool.slice(0, nd), ...safePool.slice(0, ns)];
  // 一边不够时用另一边补
  let bi = nd, si = ns;
  while (bag.length < MAX_Q && (bi < dangerPool.length || si < safePool.length)) {
    bag.push(bi < dangerPool.length ? dangerPool[bi++] : safePool[si++]);
  }
  shuffle(bag, rnd);

  return {
    seed,
    bag,
    discards,
    knockTurn: sim.path.length,
    frozen: sim.frozenHand,
    waits: sim.waits.map((w) => w.tile),
    visible: used,
  };
}

export function createReadMode(els, { toast } = {}) {
  const R = {
    on: false,
    roundNo: 0,
    scenario: null,
    state: 'question',   // question | revealed | over
    qi: 0,               // 本局第几张
    answer: null,
    result: null,        // 'clear' | 'deal'
    dealtTile: -1,
    myRiver: [],
    streak: 0,
    best: 0,
    total: 0,
    right: 0,
    cleared: 0,
  };

  try {
    const saved = JSON.parse(localStorage.getItem(STAT_KEY) || '{}');
    R.total = saved.total | 0;
    R.right = saved.right | 0;
    R.best = saved.best | 0;
    R.cleared = saved.cleared | 0;
  } catch { /* 隐私模式 */ }

  function saveStats() {
    try {
      localStorage.setItem(STAT_KEY, JSON.stringify({
        total: R.total, right: R.right, best: R.best, cleared: R.cleared,
      }));
    } catch { /* ignore */ }
  }

  /* ---------- 渲染 ---------- */

  function tileEl(tile, { small = false, mark = false } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile' + (small ? ' sm' : '') + (mark ? ' q' : '');
    b.dataset.tile = String(tile);
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
      for (const t of tiles) if (left[t] > 0) { left[t]--; out.push(t); }
      return out;
    };
    const groups = [];
    for (const b of decompose(sc.frozen).blocks) {
      const tiles = take(b.tiles);
      if (!tiles.length) continue;
      const wait = b.kind === 'partial' || (b.kind === 'single' && sc.waits.includes(tiles[0]));
      groups.push({ tiles, shape: b.shape, wait });
    }
    const rest = [];
    for (let t = 0; t < KINDS; t++) for (let i = 0; i < left[t]; i++) rest.push(t);
    if (rest.length) groups.push({ tiles: rest, shape: '', wait: false });
    return groups;
  }

  function paint() {
    const sc = R.scenario;
    if (!sc) return;
    const shown = R.state === 'over';   // 只有本局结束才翻牌，否则后面的题被剧透

    const his = document.createDocumentFragment();
    if (shown) {
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

    // 他的牌河 + 敲的标记
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

    // 我的牌河：打出去的那些
    els.myRiver.replaceChildren(...R.myRiver.map((t) => tileEl(t, { small: true })));

    // 只显示要打的那一张
    els.quizTile.replaceChildren(
      R.dealtTile >= 0 ? tileEl(R.dealtTile) : document.createTextNode(''),
    );

    els.no.textContent = `第 ${R.roundNo} 局`;
    els.knock.textContent = `他第 ${sc.knockTurn} 手敲`;
    els.rate.textContent = `本局 ${R.qi} / ${MAX_Q} · 连对 ${R.streak}` +
      (R.cleared ? ` · 已逃 ${R.cleared} 局` : '');
    els.tag.textContent = shown ? `他听 ${sc.waits.map(tileName).join(' / ')}` : '已敲 · 手牌冻结';

    let q = '';
    if (R.state === 'question') q = '这张牌打出去，危不危险？';
    else if (R.state === 'revealed') q = R.danger ? '他确实在等这张' : '这张是安全的';
    else q = R.result === 'deal' ? '点炮了' : `撑过 ${MAX_Q} 张，这局逃掉了`;
    els.quizQ.textContent = q;

    const over = R.state === 'over';
    els.ansDanger.hidden = R.state !== 'question';
    els.ansSafe.hidden = R.state !== 'question';
    els.nextQ.hidden = R.state === 'question';
    if (!els.nextQ.hidden) {
      els.nextQ.innerHTML = (R.state === 'over' ? '下一局' : '继续') + ' <kbd>Space</kbd>';
    }
    els.ansDanger.classList.toggle('picked', R.answer === 'danger');
    els.ansSafe.classList.toggle('picked', R.answer === 'safe');
  }

  function paintFeedback() {
    const sc = R.scenario;
    const correct = (R.answer === 'danger') === R.danger;
    const conservative = R.result === 'conservative';
    const waits = sc.waits.map(tileName).join(' / ');
    const q = tileName(R.dealtTile);

    let why;
    if (conservative) {
      why = `这张其实是安全的（不在他等的牌里），你白白扣了一张——没点炮，但连对断了。`;
    } else if (R.state === 'over') {
      const groups = hisGroups(sc);
      const waitGrp = groups.find((g) => g.wait);
      const grpName = waitGrp ? waitGrp.tiles.map(tileName).join('') : '';
      const grpShape = waitGrp ? waitGrp.shape : '';
      why = R.danger
        ? `他的 <b>${grpName}</b> 是${grpShape}，只等 <b>${waits}</b>；${q} 正好补进这一组。`
        : `他的 <b>${grpName}</b> 是${grpShape}，只等 <b>${waits}</b>；${q} 补不上任何一组。`;
    } else {
      // 进行中不报听张，留给你自己读
      why = R.danger ? `${q} 确实在他等的牌里，扣下。` : `${q} 不在他等的牌里，可以打。`;
    }
    const note = sc.discards.includes(R.dealtTile)
      ? `顺带：这张他自己打过（現物）——敲麻没有振听，理论上还能等，但实战里几乎不会。`
      : '';

    els.fb.hidden = false;
    els.fb.className = `feedback ${correct ? 'ok' : 'bad'}`;
    els.fb.innerHTML =
      `<span class="fb-mark">${correct ? '对' : conservative ? '保守' : '错'}</span>` +
      `<span class="fb-body">${why}` +
      (R.state === 'over' && R.result === 'deal'
        ? ' 这一张打出去他就荣和了，本局结束。'
        : R.state === 'over' ? ' 这一局他没等到牌，你逃掉了。' : '') +
      `${note ? `<span class="fb-note">${note}</span>` : ''}</span>` +
      `<span class="fb-score">连对 ${R.streak} · 最长 ${R.best}</span>`;
  }

  /* ---------- 流程 ---------- */

  function startRound(seed) {
    let sc = null;
    let s = seed >>> 0;
    for (let i = 0; i < 80 && !sc; i++) sc = makeRound((s + i * 7919) >>> 0);
    if (!sc) { toast?.('没造出局，再试一次'); return; }
    R.scenario = sc;
    R.roundNo++;
    R.qi = 0;
    R.state = 'question';
    R.answer = null;
    R.result = null;
    R.myRiver = [];
    R.dealtTile = sc.bag[0];
    R.danger = sc.waits.includes(R.dealtTile);
    els.fb.hidden = true;
    paint();
  }

  function answer(choice) {
    if (R.state !== 'question') return;
    R.answer = choice;
    const correct = (choice === 'danger') === R.danger;
    R.total++;
    R.qi++;
    if (correct) {
      R.right++;
      R.streak++;
      if (R.streak > R.best) R.best = R.streak;
      // 说安全就真打出去，说危险就扣下
      if (choice === 'safe') R.myRiver.push(R.dealtTile);
      saveStats();
      if (R.qi >= MAX_Q || R.qi >= R.scenario.bag.length) {
        R.state = 'over';
        R.result = 'clear';
        R.cleared++;
        saveStats();
      } else {
        R.state = 'revealed';
      }
    } else {
      R.streak = 0;
      R.myRiver.push(R.dealtTile);
      if (R.danger) {
        // 真危险却打了出去 —— 点炮，本局结束
        R.state = 'over';
        R.result = 'deal';
      } else {
        // 其实安全，只是你保守了：不算点炮，继续这一局
        R.result = 'conservative';
        R.state = 'revealed';
      }
      saveStats();
    }
    paint();
    paintFeedback();
  }

  function advance() {
    if (R.state !== 'revealed') return;
    if (R.qi >= R.scenario.bag.length) { R.state = 'over'; R.result = 'clear'; paint(); return; }
    R.dealtTile = R.scenario.bag[R.qi];
    R.danger = R.scenario.waits.includes(R.dealtTile);
    R.state = 'question';
    R.answer = null;
    els.fb.hidden = true;
    paint();
  }

  /* ---------- 事件 ---------- */

  els.ansDanger.addEventListener('click', () => answer('danger'));
  els.ansSafe.addEventListener('click', () => answer('safe'));
  els.nextQ.addEventListener('click', () => {
    if (R.state === 'over') startRound((Math.random() * 0xffffffff) >>> 0);
    else advance();
  });

  return {
    get state() { return R; },
    get active() { return R.on; },
    enter() {
      R.on = true;
      els.area.hidden = false;
      if (!R.scenario) startRound((Math.random() * 0xffffffff) >>> 0);
    },
    leave() { R.on = false; els.area.hidden = true; },
    next() {
      if (R.state === 'over') startRound((Math.random() * 0xffffffff) >>> 0);
      else advance();
    },
    answer,
    loadSeed(seed) { startRound(seed); },
    MAX_Q,
  };
}
