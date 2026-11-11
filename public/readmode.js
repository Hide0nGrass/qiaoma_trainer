// 摇铃模式：一个按最优出张打牌的对手，他敲之后你来读他的听牌、避开点炮。
//
// M1 范围：单对手、门清、不带吃碰杠；他打完整条路径并在第一次听牌时敲，
// 敲后手牌冻结（敲麻规则：敲后摸到不能和的牌只能原样打出）。读牌概率面板在 M2。
import { tileName, countsOf, isWin, shanten, analyzeHand } from '../engine.mjs';
import { mulberry32, shuffle, newDeck } from '../opponent.mjs';
import { faceSVG } from './tiles.js';

export function createReadMode(els, { toast, onRoundEnd } = {}) {
  const R = {
    on: false,
    seed: 0,
    round: 0,
    my: [],
    his: [],
    wall: [],
    myRiver: [],
    hisRiver: [],
    knocked: false,
    knockTurn: 0,
    frozen: [],
    turn: 'me',
    over: false,
    busy: false,
    cheat: false,
    turnNo: 0,
    result: '',
  };

  /* ---------- 渲染 ---------- */

  function tileEl(tile, idx, { drawn = false, small = false } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile' + (drawn ? ' drawn' : '') + (small ? ' sm' : '');
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

  function paint() {
    const frag = document.createDocumentFragment();
    const n = R.my.length;
    const main = n === 14 ? 13 : n;
    for (let i = 0; i < main; i++) frag.appendChild(tileEl(R.my[i], i));
    if (n === 14) frag.appendChild(tileEl(R.my[13], 13, { drawn: true }));
    els.hand.replaceChildren(frag);
    els.hand.classList.toggle('waiting', R.turn !== 'me' || R.over);

    const his = document.createDocumentFragment();
    for (let i = 0; i < R.his.length; i++) {
      his.appendChild(R.cheat ? tileEl(R.his[i], -1, { small: true }) : backEl());
    }
    els.oppHand.replaceChildren(his);

    const riv = [];
    R.hisRiver.forEach((t, i) => {
      riv.push(tileEl(t, -1, { small: true }));
      if (R.knocked && i + 1 === R.knockTurn) {
        const sp = document.createElement('span');
        sp.className = 'knock-sep';
        sp.textContent = '敲';
        sp.title = '他从这里开始手牌冻结';
        riv.push(sp);
      }
    });
    els.oppRiver.replaceChildren(...riv);
    els.myRiver.replaceChildren(...R.myRiver.map((t) => tileEl(t, -1, { small: true })));

    els.round.textContent = `第 ${R.round} 局`;
    els.wall.textContent = `牌墙 ${R.wall.length} 张`;
    els.turn.textContent = R.over ? '本局结束' : R.turn === 'me' ? '轮到你' : '他在摸打…';
    els.tag.textContent = R.knocked ? `已敲 · 第 ${R.knockTurn} 手` : '门清 · 未敲';
    els.tag.classList.toggle('knocked', R.knocked);
    els.cheat.classList.toggle('on', R.cheat);
    els.cheat.setAttribute('aria-checked', String(R.cheat));
  }

  function banner(kind, title, sub) {
    els.over.hidden = false;
    els.over.className = `read-over ${kind}`;
    els.overTitle.textContent = title;
    els.overSub.textContent = sub;
  }

  function render() {
    paint();
  }

  function finish(kind) {
    R.over = true;
    R.turn = 'none';
    R.result = kind;
    paint();
    if (kind === 'me') banner('win', '自摸', `第 ${R.turnNo} 手，牌墙剩 ${R.wall.length} 张`);
    else if (kind === 'his') banner('lose', '他自摸了', `他第 ${R.knockTurn} 手敲，第 ${R.turnNo} 手自摸`);
    else banner('draw', '荒牌', '牌墙摸完，谁也没和');
    onRoundEnd?.(R);
  }

  /* ---------- 流程 ---------- */

  function start(seed) {
    R.seed = seed >>> 0;
    const rnd = mulberry32(R.seed);
    const deck = shuffle(newDeck(), rnd);
    R.my = deck.slice(0, 13).sort((a, b) => a - b);
    R.his = deck.slice(13, 26).sort((a, b) => a - b);
    R.wall = deck.slice(26);
    R.myRiver = [];
    R.hisRiver = [];
    R.knocked = false;
    R.knockTurn = 0;
    R.frozen = [];
    R.over = false;
    R.busy = false;
    R.turnNo = 0;
    R.result = '';
    R.turn = 'me';
    els.over.hidden = true;
    drawMine();
  }

  function drawMine() {
    if (R.over) return;
    if (!R.wall.length) return finish('draw');
    R.my.push(R.wall.pop());
    R.turnNo++;
    paint();
    if (isWin(countsOf(R.my))) finish('me');
  }

  function myDiscard(idx) {
    if (!R.on || R.over || R.busy || R.turn !== 'me') return;
    if (R.my.length !== 14) return;
    const tile = R.my[idx];
    if (tile === undefined) return;
    R.my.splice(idx, 1);
    R.my.sort((a, b) => a - b);          // 打出的那张不一定是刚摸的，打完重新理牌
    R.myRiver.push(tile);
    R.turn = 'him';
    R.busy = true;
    paint();
    setTimeout(hisTurn, 380);
  }

  function hisTurn() {
    if (R.over) { R.busy = false; return; }
    if (!R.wall.length) { R.busy = false; return finish('draw'); }

    const t = R.wall.pop();
    R.turnNo++;

    // 敲后冻结：摸什么打什么
    if (R.knocked) {
      if (isWin(countsOf([...R.frozen, t]))) {
        R.hisRiver.push(t);
        R.busy = false;
        return finish('his');
      }
      R.hisRiver.push(t);
      R.turn = 'me';
      R.busy = false;
      paint();
      return drawMine();
    }

    const h14 = [...R.his, t];
    if (isWin(countsOf(h14))) {
      R.hisRiver.push(t);
      R.busy = false;
      return finish('his');
    }
    const best = analyzeHand(h14)[0];
    const i = h14.indexOf(best.tile);
    h14.splice(i, 1);
    R.his = h14.sort((a, b) => a - b);
    R.hisRiver.push(best.tile);

    if (shanten(countsOf(R.his)) === 0) {
      R.knocked = true;
      R.knockTurn = R.hisRiver.length;
      R.frozen = R.his.slice();
      paint();
      toast?.('他敲了 —— 手牌冻结，之后只会摸什么打什么');
    }

    R.turn = 'me';
    R.busy = false;
    paint();
    drawMine();
  }

  /* ---------- 事件 ---------- */

  els.hand.addEventListener('click', (e) => {
    const el = e.target.closest('.tile');
    if (!el || el.dataset.idx === undefined) return;
    myDiscard(Number(el.dataset.idx));
  });
  els.cheat.addEventListener('click', () => { R.cheat = !R.cheat; paint(); });
  els.next?.addEventListener('click', () => { R.round++; start((Math.random() * 0xffffffff) >>> 0); });

  return {
    get state() { return R; },
    enter() {
      R.on = true;
      els.area.hidden = false;
      if (!R.my.length) {
        R.round = Math.max(1, R.round);
        start((Math.random() * 0xffffffff) >>> 0);
      }
    },
    leave() { R.on = false; els.area.hidden = true; },
    newRound() { R.round = Math.max(1, R.round); R.round++; start((Math.random() * 0xffffffff) >>> 0); },
    startSeed(seed) { R.round = Math.max(1, R.round); start(seed); },
    replay() { if (R.seed) start(R.seed); },
    toggleCheat() { R.cheat = !R.cheat; paint(); },
    get active() { return R.on; },
  };
}
