// 摇铃练习：他敲牌之后，你一张一张地出牌，判断会不会点炮。
//
// 一「局」= 一个已经敲了的对手（牌河 + 冻结的 13 张）再加你独立发到的 13 张牌。
// 每次只把下一张拿出来问「打这张出去，危不危险」：
//   和牌河推断一致 → 这张按你的判断处理（说安全就打出去，说危险就扣下），继续下一张
//   不一致         → 连对断；如果打了真听张，他荣和，本局结束
// 撑过 MAX_Q 张没点炮 = 本局逃掉。之后才换新的一局。
//
// 关键：判分看的是「牌河推断」（read.mjs），不是你猜没猜中他的真手牌。
// 他的真手牌只决定「打出去会不会被和」，并且只在整局结束时揭晓——
// 这样练的是读牌，不是透视。
import { decompose, tileName } from '../engine.mjs';
import { mulberry32, shuffle, simulateRound } from '../opponent.mjs';
import { dangerTable, inferWaits } from '../read.mjs';
import { faceSVG } from './tiles.js';

const KINDS = 27;
const MIN_RIVER = 5;   // 至少 5 张弃牌才出题，否则等于让玩家猜
const MAX_TURNS = 16;  // simulateRound 的上限：他最多摸 16 手就要听牌
const MAX_Q = 12;      // 撑过 12 张算「逃掉」
const READ_SAMPLES = 240; // 推断采样数：约 230ms / 局，开局算一次，之后复用
const DANGER_TOPK = 5;    // 推断前 5 名算「牌河说危险」（top-5 的区分度约 2 倍于安全牌）
const STAT_KEY = 'qiaoma.readquiz.v3';

function counts(arr) {
  const c = new Array(KINDS).fill(0);
  for (const t of arr) c[t]++;
  return c;
}

const SHAPE_NOTE = {
  两面: '两张连号，两边都能进张',
  嵌张: '只等中间那一张',
  边张: '只有一头能进张',
  双碰: '两个对子，等哪一张先成刻',
  单吊: '单张牌等成对',
};
const glossOf = (shape) => (SHAPE_NOTE[shape] ? `${shape} · ${SHAPE_NOTE[shape]}` : shape);

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
    else if (max >= 5 && mine < max) soft.push(`他${SUITS[bySuit.indexOf(max)]}打得最多，${SUITS[s]}很少打`);
  }
  return { hard, soft };
}

/**
 * 造一局：已敲的对手 + 我独立发到的 13 张牌。
 *
 * 我的牌**不能**从他的听张里挑：那样等于出题时就把答案塞进题面，
 * 而且会把他的听张从推断的牌池里抽干（实测排名会整个反过来）。
 * 这里只做一件事——从「他没摸到过的牌」里随机发 13 张。
 */
export function makeRound(seed) {
  const sim = simulateRound(seed, MAX_TURNS);
  if (sim.knockAt < MIN_RIVER || !sim.waits?.length || !sim.frozenHand) return null;

  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const discards = sim.path.map((x) => x.discard);

  // 他摸到过的牌 = 冻结的手牌 + 打掉的牌，这些不可能在我手里
  const used = counts([...sim.frozenHand, ...discards]);
  const rest = [];
  for (let t = 0; t < KINDS; t++) for (let i = 0; i < 4 - used[t]; i++) rest.push(t);
  if (rest.length < MAX_Q + 1) return null;
  shuffle(rest, rnd);

  const hand = rest.slice(0, MAX_Q + 1);   // 第 13 张留作「刚摸到的」，不出题
  const bag = hand.slice(0, MAX_Q);
  const visible = counts([...discards, ...hand]);

  return {
    seed,
    bag,
    hand,
    discards,
    knockTurn: sim.path.length,
    frozen: sim.frozenHand,
    waits: sim.waits.map((w) => w.tile),
    visible,
  };
}

/** 只根据牌河 + 可见牌推断他的听张概率，返回每种牌的危险排名 */
export function readRound(sc, samples = READ_SAMPLES) {
  const read = inferWaits({
    discards: sc.discards,
    visible: sc.visible,
    samples,
    seed: (Math.imul(sc.seed, 2654435761) ^ 0x9e37) >>> 0,
  });
  const rows = dangerTable(read, sc.visible);
  const rank = new Map(rows.map((r, i) => [r.tile, i + 1]));
  return { read, rows, rank, p: read.p, topK: DANGER_TOPK };
}

const pct = (x) => `${Math.round((x || 0) * 100)}%`;

export function createReadMode(els, { toast } = {}) {
  const R = {
    on: false,
    roundNo: 0,
    scenario: null,
    state: 'question',   // question | revealed | over
    qi: 0,               // 本局已答的题数
    pos: 0,              // 当前是牌串里的第几张
    answer: null,
    result: null,        // ok | edge | conservative | overread | deal | clear
    dealtTile: -1,
    infer: null,         // readRound() 的结果：rank / p
    inferMs: 0,
    p: 0,                // 牌河估的这张被等的概率
    rank: KINDS,         // 牌河里的危险排名（1 最危险）
    modelDanger: false,  // 牌河说危险（rank <= DANGER_TOPK）——判分依据
    danger: false,       // 真值：这张确实是他的听张（只决定会不会被和）
    myRiver: [],
    peek: false,         // 手动翻开对家 13 张（只给牌面，不标搭子）
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
    const peeked = R.peek && !shown;

    const his = document.createDocumentFragment();
    if (shown) {
      for (const g of hisGroups(sc)) {
        const grp = document.createElement('span');
        grp.className = 'opp-grp' + (g.wait ? ' wait' : '');
        if (g.wait) grp.title = `这组在等 ${sc.waits.map(tileName).join(' / ')}`;
        for (const t of g.tiles) grp.appendChild(tileEl(t, { small: true }));
        his.appendChild(grp);
      }
    } else if (peeked) {
      // 手动翻看：只摊牌面，不按搭子分组、不标等待那组，尽量少给结构提示
      for (const t of [...sc.frozen].sort((a, b) => a - b)) {
        his.appendChild(tileEl(t, { small: true }));
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
      : `<b>已敲 · 手牌冻结</b> · 判定看牌河（前 ${DANGER_TOPK} 名算危险）· 讲解走 DeepSeek`;

    if (els.peek) {
      els.peek.setAttribute('aria-pressed', String(R.peek));
      els.peek.innerHTML = (R.peek ? '收起对家牌' : '看对家牌') + ' <kbd>C</kbd>';
    }

    let q = '';
    if (R.state === 'question') q = '这张牌打出去，危不危险？';
    else if (R.state === 'revealed') q = `牌河估：${pct(R.p)} · 27 种里第 ${R.rank} 危险`;
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
    const q = tileName(R.dealtTile);
    const clues = riverClues(sc, R.dealtTile);
    const hardBit = clues.hard.length ? `${clues.hard.join('、')}。` : '';
    const readBit = `牌河估 ${pct(R.p)}，27 种里第 ${R.rank} 危险`;
    const res = R.result;
    const over = R.state === 'over';

    // 他的形和听张只有本局结束才揭晓——中途给出来就是答案
    let shape = '';
    let waitsBit = '';
    if (over) {
      const waitGrp = hisGroups(sc).find((g) => g.wait);
      const shapeRaw = waitGrp ? waitGrp.shape : '';
      shape = shapeRaw === '孤张' ? '单吊' : shapeRaw === '对子' ? '双碰' : shapeRaw;
      const shapeBit = shape ? `（${glossOf(shape)}，${sc.waits.length} 种）` : '';
      waitsBit = ` 他敲时等的其实是 ${sc.waits.map(tileName).join(' / ')}${shapeBit}。`;
    }

    let mark = '对';
    let why;
    switch (res) {
      case 'ok':
        why = R.modelDanger
          ? `${readBit}——这张确实排进前 ${DANGER_TOPK}，你扣下了，和牌河判断一致。${hardBit}`
          : `${readBit}——没进前 ${DANGER_TOPK}，你打了，和牌河判断一致。${hardBit}`;
        break;
      case 'edge':
        mark = '边界';
        why = `${readBit}，正好压在分界线上（前 ${DANGER_TOPK} 名算危险）。这题不计分——两种判断都说得过去。`;
        break;
      case 'conservative':
        mark = '保守';
        why = `${readBit}——牌河没把它排进危险区，你却扣下了。${hardBit}没点炮，但白扣一张，连对断了。`;
        break;
      case 'overread':
        mark = '估高';
        why = `${readBit}——你按牌河打了出去；他其实没在等这张。${hardBit}读牌模型本来就有误差，这种「牌河该避、其实没事」的牌会一直出现。`;
        break;
      case 'deal':
        mark = '点炮';
        why = `${readBit}——你打了，他荣和。${hardBit}`;
        break;
      default:
        mark = '过';
        why = `${readBit}——这一局撑下来了。`;
    }
    if (over) why += waitsBit;
    const note = [
      clues.soft.length ? `牌河上：${clues.soft.join('；')}。` : '',
      sc.discards.includes(R.dealtTile)
        ? '注：敲麻没有振听，現物理论上仍可能点炮——只是实战概率极低。' : '',
    ].filter(Boolean).join(' ');

    const plainWhy = why.replace(/<[^>]+>/g, '');
    const tone = res === 'ok' ? 'ok'
      : res === 'edge' || res === 'conservative' ? 'blind'
        : res === 'clear' ? 'ok' : 'bad';
    els.fb.hidden = false;
    els.fb.className = `feedback ${tone}`;
    els.fb.innerHTML =
      `<span class="fb-mark">${mark}</span>` +
      `<span class="fb-body">` +
      `<span class="fb-ai" hidden></span>` +
      `<span class="fb-local">${why}` +
      (over && res === 'deal'
        ? ' 这一张打出去他就荣和了，本局结束。'
        : over ? ' 这 12 张里他没等到牌，本局结束。' : '') +
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
        tile: q,
        p: Math.round(R.p * 1000) / 1000,
        rank: R.rank,
        kinds: KINDS,
        modelDanger: R.modelDanger,
        agree: res === 'ok' ? true : res === 'edge' ? null : false,
        choice: R.answer,
        over,
        shape: over ? (shape && SHAPE_NOTE[shape] ? `${shape}（${SHAPE_NOTE[shape]}）` : shape) : '',
        waitKinds: over ? sc.waits.length : 0,
        waitsText: over ? sc.waits.map(tileName).join(' / ') : '',
        cluesText: clues.hard.join('、'),
        softText: clues.soft.join('；'),
        resultText: over
          ? (res === 'deal' ? '他荣和，本局结束' : '他没等到，本局结束')
          : res === 'conservative' ? '没点炮，但连对断了' : '还在继续',
        fallback: plainWhy,
      });
    }
  }

  /* ---------- 流程 ---------- */

  /** 把牌串里的第 pos 张摆上台面，并查好它在牌河里的危险排名 */
  function handOut(sc, pos) {
    const tile = sc.bag[pos];
    R.pos = pos;
    R.dealtTile = tile;
    R.danger = sc.waits.includes(tile);        // 真值：只决定打出去会不会被和
    R.p = R.infer.p.get(tile) || 0;
    R.rank = R.infer.rank.get(tile) || KINDS;
    R.modelDanger = R.rank <= DANGER_TOPK;     // 判分依据：牌河推断
    R.answer = null;
  }

  /** 手动翻开 / 收起对家 13 张；只影响显示，不参与判分 */
  function togglePeek() {
    if (!R.scenario) return;
    R.peek = !R.peek;
    paint();
  }

  function startRound(seed) {
    let sc = null;
    let s = seed >>> 0;
    for (let i = 0; i < 80 && !sc; i++) sc = makeRound((s + i * 7919) >>> 0);
    if (!sc) { toast?.('没造出局，再试一次'); return; }
    const t0 = performance.now();
    R.infer = readRound(sc);
    R.inferMs = Math.round(performance.now() - t0);
    R.scenario = sc;
    R.roundNo++;
    R.qi = 0;
    R.state = 'question';
    R.result = null;
    R.myRiver = [];
    R.peek = false;   // 每局重新扣上，免得上一局的翻开状态带到新题
    handOut(sc, 0);
    els.fb.hidden = true;
    paint();
  }

  /** 一题收尾：撑满 MAX_Q / 问完牌串就算逃掉 */
  function settle() {
    if (R.qi >= MAX_Q || R.pos >= R.scenario.bag.length - 1) {
      R.state = 'over';
      R.result = 'clear';
      R.cleared++;
      saveStats();
      return true;
    }
    R.state = 'revealed';
    return false;
  }

  function answer(choice) {
    if (R.state !== 'question') return;
    R.answer = choice;
    const wantDanger = choice === 'danger';
    const agree = wantDanger === R.modelDanger;
    // 压线题：排名正好卡在第 5 / 6，两种判断都说得过去，不计分也不断连对
    const edge = !agree && (R.rank === DANGER_TOPK || R.rank === DANGER_TOPK + 1);
    R.qi = R.pos + 1;

    if (agree) {
      R.total++;
      R.right++;
      R.streak++;
      if (R.streak > R.best) R.best = R.streak;
      R.result = 'ok';
      if (!wantDanger) R.myRiver.push(R.dealtTile);
      settle();
    } else if (edge) {
      R.result = 'edge';
      if (!wantDanger) R.myRiver.push(R.dealtTile);
      settle();
    } else {
      R.total++;
      R.streak = 0;
      if (!wantDanger) {
        R.myRiver.push(R.dealtTile);
        if (R.danger) {
          // 牌河没排进危险区，但真值偏偏是听张 —— 点炮
          R.state = 'over';
          R.result = 'deal';
        } else {
          R.result = 'overread';
          settle();
        }
      } else {
        R.result = 'conservative';
        settle();
      }
    }
    saveStats();
    paint();
    paintFeedback();
  }

  function advance() {
    if (R.state !== 'revealed') return;
    if (R.pos + 1 >= R.scenario.bag.length) {
      R.state = 'over';
      R.result = 'clear';
      R.cleared++;
      saveStats();
      paint();
      return;
    }
    handOut(R.scenario, R.pos + 1);
    R.state = 'question';
    els.fb.hidden = true;
    paint();
  }

  /* ---------- 事件 ---------- */

  els.ansDanger.addEventListener('click', () => answer('danger'));
  els.ansSafe.addEventListener('click', () => answer('safe'));
  els.peek?.addEventListener('click', togglePeek);
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
    peek: togglePeek,
    loadSeed(seed) { startRound(seed); },
    MAX_Q,
  };
}
