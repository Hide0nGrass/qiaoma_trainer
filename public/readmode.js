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

const SUITS = ['万子', '筒子', '条子'];
const suitOf = (t) => Math.floor(t / 9);

/**
 * 从「他的牌河」读线索。hard = 能证明的（現物 / 筋）；soft = 倾向性的（花色分布）。
 */
function riverClues(sc, tile) {
  const seen = counts(sc.discards);
  const hard = [];
  const soft = [];
  if (seen[tile]) hard.push(`他自己打过这张（現物${seen[tile] > 1 ? `×${seen[tile]}` : ''}）`);

  const s = suitOf(tile);
  const sameSuit = (t) => t >= 0 && t < KINDS && suitOf(t) === s;
  if (sameSuit(tile - 3) && seen[tile - 3]) hard.push(`${tileName(tile - 3)} 是他的筋`);
  else if (sameSuit(tile + 3) && seen[tile + 3]) hard.push(`${tileName(tile + 3)} 是他的筋`);

  if (sc.discards.length >= 5 && (seen[tile] || 0) === 0) {
    const bySuit = [0, 0, 0];
    for (const t of sc.discards) bySuit[suitOf(t)]++;
    const mine = bySuit[s];
    const max = Math.max(...bySuit);
    if (mine === max && mine >= 3) soft.push(`他打得最多的是${SUITS[s]}（${mine}/${sc.discards.length} 张）`);
    else if (mine === 0) soft.push(`他一张${SUITS[s]}都没打过`);
    else if (max >= 5 && mine < max) soft.push(`${SUITS[bySuit.indexOf(max)]}打得最多，${SUITS[s]}很少碰`);
  }
  return { hard, soft };
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

  /* ---------- AI（DeepSeek）讲解 ---------- */

  const coach = { seq: 0, abort: null, on: true, calls: 0, off: false };

  async function askReadCoach(payload) {
    const my = ++coach.seq;
    coach.calls++;
    if (coach.abort) coach.abort.abort();
    const ctrl = new AbortController();
    coach.abort = ctrl;
    const t0 = performance.now();
    let firstMs = 0;
    let doneSeen = false;
    const guard = setTimeout(() => { if (my === coach.seq && !doneSeen) ctrl.abort(); }, 12000);
    try {
      const res = await fetch('/api/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error('http ' + res.status);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let ai = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done || my !== coach.seq) break;
        buf += dec.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const packet = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const line = packet.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (ev.t) {
            if (!firstMs) firstMs = Math.round(performance.now() - t0);
            ai += ev.t;
            if (my === coach.seq) paintAi(ai);
          }
          if (ev.done) {
            doneSeen = true;
            paintAi(ai, { firstMs, totalMs: Math.round(performance.now() - t0), cached: ev.cached, failed: ev.failed });
          }
        }
      }
      if (!doneSeen && my === coach.seq) paintAi(ai, { firstMs, totalMs: Math.round(performance.now() - t0), failed: true });
    } catch {
      if (my === coach.seq) paintAi('', { failed: true });
    } finally {
      clearTimeout(guard);
    }
  }

  function paintAi(text, meta = {}) {
    if (!els.fbAi) return;
    if (!text) {
      els.fbAi.hidden = true;
      els.fbAi.textContent = '';
      return;
    }
    els.fbAi.hidden = false;
    els.fbAi.textContent = text.trim();
    if (meta.failed) els.fbAi.textContent += '（AI 未接通，下面是本地引擎的结论）';
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
    els.tag.innerHTML = shown
      ? `<b>他听 ${sc.waits.map(tileName).join(' / ')}</b>`
      : '<b>已敲 · 手牌冻结</b> · 判定用本地引擎 · 讲解走 DeepSeek';

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
    const clues = riverClues(sc, R.dealtTile);
    const hardBit = clues.hard.length ? `${clues.hard.join('、')}。` : '';

    // 他剩下那一组是什么形——只知道「形 + 等几种」，不知道具体牌
    const groups = hisGroups(sc);
    const waitGrp = groups.find((g) => g.wait);
    const shapeRaw = waitGrp ? waitGrp.shape : '';
    const shape = shapeRaw === '孤张' ? '单吊' : shapeRaw === '对子' ? '双碰' : shapeRaw;
    const k = sc.waits.length;
    const shapeBit = shape ? `${shape}，等 ${k} 种牌` : '';

    let why;
    if (conservative) {
      why = `这张其实是安全的（${shapeBit ? `补不上他${shapeBit}` : '不在他的听张里'}）。${hardBit}你白白扣了一张——没点炮，但连对断了。`;
    } else if (R.state === 'over') {
      why = R.danger
        ? `他等的就是 <b>${waits}</b>（${shape}）；${q} 正好补上。${hardBit}`
        : `他等的就是 <b>${waits}</b>（${shape}）；${q} 补不上。${hardBit}`;
    } else if (R.danger) {
      why = `${q} 正好补进他等的${shapeBit ? `那一组（${shapeBit}）` : '那一组'}——这张出去就是炮。${hardBit}`;
    } else {
      why = `${q} 补不上他等的${shapeBit ? `那一组（${shapeBit}）` : '那一组'}，可以打。${hardBit}`;
    }
    const note = [
      clues.soft.length ? `牌河上：${clues.soft.join('；')}。` : '',
      sc.discards.includes(R.dealtTile)
        ? '注：敲麻没有振听，現物理论上仍可能点炮——只是实战概率极低。' : '',
    ].filter(Boolean).join(' ');

    const plainWhy = why.replace(/<[^>]+>/g, '');
    els.fb.hidden = false;
    els.fb.className = `feedback ${correct ? 'ok' : 'bad'}`;
    els.fb.innerHTML =
      `<span class="fb-mark">${correct ? '对' : conservative ? '保守' : '错'}</span>` +
      `<span class="fb-body">` +
      `<span class="fb-ai" hidden></span>` +
      `<span class="fb-local">${why}` +
      (R.state === 'over' && R.result === 'deal'
        ? ' 这一张打出去他就荣和了，本局结束。'
        : R.state === 'over' ? ' 这一局他没等到牌，你逃掉了。' : '') +
      `</span>` +
      `${note ? `<span class="fb-note">${note}</span>` : ''}</span>` +
      `<span class="fb-score">连对 ${R.streak} · 最长 ${R.best}</span>`;

    // AI 讲解：默认走 DeepSeek；没配 key 时服务端会回退到下面这段本地结论
    els.fbAi = els.fb.querySelector('.fb-ai');
    if (els.fbAi) { els.fbAi.hidden = true; els.fbAi.textContent = ''; }
    if (coach.on) {
      askReadCoach({
        knockTurn: sc.knockTurn,
        discardsText: sc.discards.map(tileName).join(' '),
        shape,
        waitKinds: k,
        waitsText: R.state === 'over' ? sc.waits.map(tileName).join(' / ') : '',
        tile: q,
        danger: R.danger,
        cluesText: clues.hard.join('、'),
        softText: clues.soft.join('；'),
        resultText: R.state === 'over'
          ? (R.result === 'deal' ? '他荣和，本局结束' : '他没等到，本局结束')
          : conservative ? '没点炮，但连对断了' : '还在继续',
        fallback: plainWhy,
      });
    }
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
