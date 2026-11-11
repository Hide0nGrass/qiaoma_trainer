import {
  prewarm,
  analyzeHand, countsOf, decompose, describe, handType, isWin, judgeDiscard,
  newRound, shanten, tileName, tileShort, ukeireAfter,
} from '../engine.mjs';
import { faceSVG } from './tiles.js';
import { createReadMode } from './readmode.js';

const $ = (id) => document.getElementById(id);
const els = {
  hand: $('hand'), river: $('river'), preview: $('preview'),
  tilewall: $('tilewall'), groupSwitch: $('groupSwitch'), previewSwitch: $('previewSwitch'),
  badge: $('badge'), headline: $('headline'), metrics: $('metrics'),
  coach: $('coach'), coachText: $('coachText'), coachMeta: $('coachMeta'),
  roundChip: $('roundChip'), wallInfo: $('wallInfo'), shantenInfo: $('shantenInfo'),
  advice: $('advice'),
  stRounds: $('stRounds'), stRate: $('stRate'), stStreak: $('stStreak'),
  toast: $('toast'),
  rulesModal: $('rulesModal'), rulesBtn: $('rulesBtn'), rulesClose: $('rulesClose'),
  winOverlay: $('winOverlay'), winSub: $('winSub'), winHand: $('winHand'), winStats: $('winStats'),
  winReplay: $('winReplay'), winNext: $('winNext'),
  newBtn: $('newBtn'), replayBtn: $('replayBtn'), forceBtn: $('forceBtn'),
  historyBtn: $('historyBtn'), historyModal: $('historyModal'), historyClose: $('historyClose'),
  histList: $('histList'), histCount: $('histCount'), histClear: $('histClear'),
  mistakeBtn: $('mistakeBtn'), mistakeModal: $('mistakeModal'), mistakeClose: $('mistakeClose'),
  mistakeList: $('mistakeList'), mistakeCount: $('mistakeCount'), mistakeClear: $('mistakeClear'),
  saveFav: $('saveFav'), favBtn: $('favBtn'), favModal: $('favModal'), favList: $('favList'),
  favCount: $('favCount'), favClear: $('favClear'), favClose: $('favClose'),
  modeTrain: $('modeTrain'), modeRead: $('modeRead'),
  trainArea: $('trainArea'), readArea: $('readArea'),
  rdHand: $('rdHand'), oppHand: $('oppHand'), rdOppRiver: $('rdOppRiver'),
  rdNo: $('rdNo'), rdKnock: $('rdKnock'), rdRate: $('rdRate'), rdTag: $('rdTag'),
  quizQ: $('quizQ'), ansDanger: $('ansDanger'), ansSafe: $('ansSafe'), nextQ: $('nextQ'),
  rdFb: $('rdFb'),
};

const VERDICT_LABEL = { best: '最优', good: '优', sub: '次优', wrong: '退向听' };
const VERDICT_TEXT = { best: '最优（一阶最优且后续更好）', good: '优（一阶等价，但后续稍差）', sub: '次优（进张少）', wrong: '退向听' };
const isTop = (v) => v === 'best' || v === 'good';

const S = {
  seed: 0,
  hand: [],        // 13 张（有序）或 14 张（前 13 有序 + 末尾为刚摸的牌）
  wall: [], cursor: 0,
  river: [],
  roundNo: 0,
  judged: 0, correct: 0, streak: 0, bestStreak: 0,
  busy: false, done: false,
  coachSeq: 0, coachAbort: null,
  lastPayload: null,
  coachOff: false, coachStreaming: false, localText: '',
  hintTimer: 0,
  undoStack: [],   // 每一手「已出牌」之前的快照
  pending: null,   // 打错了但还没决定「就这样打」的一手
  rec: null,       // 当前局的记录
  history: [],     // 历史牌局
  mistakes: [], favs: [],    // 错题本
  groups: [],      // 当前手牌的分块（供悬停预览显示形名）
};

const HIST_KEY = 'qiaoma.history.v1';
const HIST_MAX = 60;
const MIST_KEY = 'qiaoma.mistakes.v1';
const FAV_KEY = 'qiaoma.favs.v1';
const MIST_MAX = 100;
const FAV_MAX = 100;
const GROUP_KEY = 'qiaoma.groups.v1';
const PREVIEW_KEY = 'qiaoma.preview.v1';

let groupsOn = (() => {
  try { return localStorage.getItem(GROUP_KEY) !== '0'; } catch { return true; }
})();
let previewOn = (() => {
  try { return localStorage.getItem(PREVIEW_KEY) !== '0'; } catch { return true; }
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */
function tileEl(tile, idx, { drawn = false, enter = false, extra = '' } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tile' + (drawn ? ' drawn' : '') + (enter ? ' enter' : '') + (extra ? ' ' + extra : '');
  b.dataset.tile = String(tile);
  b.dataset.idx = String(idx);
  b.setAttribute('aria-label', tileName(tile));
  b.innerHTML = faceSVG(tile);
  return b;
}

function renderHand({ animate = 'none' } = {}) {
  const n = S.hand.length;
  const mainCount = n === 14 ? 13 : n;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < mainCount; i++) {
    frag.appendChild(tileEl(S.hand[i], i, { enter: animate === 'all' }));
  }
  if (n === 14) {
    frag.appendChild(tileEl(S.hand[13], 13, { drawn: true, enter: animate === 'all' || animate === 'drawn' }));
  }
  els.hand.replaceChildren(frag);
  paintGroups();
  paintFavState();
}

/* ------------------------------------------------------------------ *
 * 结构可视化：面子 / 搭子 / 将 / 孤张
 * ------------------------------------------------------------------ */
const BLK_HINT = {
  顺子: '三张连号，已经是一组面子',
  刻子: '三张相同，已经是一组面子',
  两面: '连着的两张，两头都能进张，是最宽的搭子',
  嵌张: '隔一张的两张，只能等中间那张，比两面窄一半',
  边张: '12 或 89，只有一头能进张，最窄的搭子',
  对子: '两张相同，再摸一张成刻子，也可以当将',
  将: '这副牌定下的将牌（对子）',
  孤张: '周围没有搭子的单张，通常第一个打掉',
};

/** 手牌 → 每个位置属于哪一块；块按牌序排列 */
function structureOf(hand) {
  const d = decompose(hand);
  const used = new Set();
  const groups = [];
  for (const blk of d.blocks) {
    const idxs = [];
    for (const t of blk.tiles) {
      const i = hand.findIndex((x, k) => x === t && !used.has(k));
      if (i >= 0) { used.add(i); idxs.push(i); }
    }
    // 块内按牌值排（刚摸进来的那张才不会插在中间）
    if (idxs.length) groups.push({ blk, idxs: idxs.sort((a, b) => hand[a] - hand[b] || a - b) });
  }
  // 没被分到块的（理论上不会有）当孤张
  const rest = [];
  for (let i = 0; i < hand.length; i++) if (!used.has(i)) rest.push(i);
  if (rest.length) groups.push({ blk: { kind: 'single', shape: '孤张', tiles: rest.map((i) => hand[i]) }, idxs: rest });
  groups.sort((a, b) => hand[a.idxs[0]] - hand[b.idxs[0]] || a.idxs[0] - b.idxs[0]);
  return { sevenPairs: d.sevenPairs, shanten: d.shanten, groups };
}

function paintGroups() {
  const tiles = [...els.hand.children];
  for (const t of tiles) {
    t.style.removeProperty('margin-right');
    t.style.removeProperty('order');
    t.classList.remove('grp-end');
    delete t.dataset.blk;
  }
  els.hand.classList.toggle('grouped', groupsOn);
  if (!S.hand.length) return;

  let st;
  try { st = structureOf(S.hand); } catch { return; }
  S.groups = st.groups;
  for (const g of st.groups) {
    for (const i of g.idxs) {
      const el = tiles[i];
      if (el) el.dataset.blk = g.blk.shape;
    }
  }
  if (!groupsOn) return;

  // 理牌：面子 → 搭子 → 将 → 散张；散张并成一组放在最右
  const real = st.groups.filter((g) => g.blk.kind !== 'single');
  const loose = st.groups.filter((g) => g.blk.kind === 'single').flatMap((g) => g.idxs);
  real.sort((a, b) => S.hand[a.idxs[0]] - S.hand[b.idxs[0]]);
  const seq = real.map((g) => g.idxs);
  if (loose.length) seq.push(loose);

  let pos = 0;
  seq.forEach((idxs, gi) => {
    for (const i of idxs) {
      const el = tiles[i];
      if (el) el.style.order = String(pos++);
    }
    if (gi === seq.length - 1) return;
    const last = tiles[idxs[idxs.length - 1]];
    if (last) last.classList.add('grp-end');
  });
  for (const t of tiles) if (!t.style.order) t.style.order = String(pos++);
}

/* ------------------------------------------------------------------ *
 * 悬停预览：打这张会变成什么样
 * ------------------------------------------------------------------ */
let previewCache = new Map();
let previewIdx = -1;
let lastResult = null;
let lastHandKey = '';

function previewOf(idx) {
  const key = `${S.hand.join(',')}#${idx}`;
  if (previewCache.has(key)) return previewCache.get(key);
  const hand = S.hand.slice();
  const tile = hand[idx];
  if (tile === undefined) return null;
  let r = null;
  try { r = judgeDiscard(hand, tile); } catch { r = null; }
  if (previewCache.size > 600) previewCache.clear();
  previewCache.set(key, r);
  return r;
}

function showPreview(el, idx) {
  if (!previewOn || !el || S.busy || S.done || S.hand.length < 14) return;
  const r = previewOf(idx);
  if (!r) return;
  const { verdict, chosen, maxUkeire, bestShanten } = r;
  const word = VERDICT_LABEL[verdict];
  const gap = maxUkeire - chosen.ukeire;
  const second = bestShanten < chosen.shanten
    ? `现在最优能保持 ${bestShanten} 向听`
    : isTop(verdict)
      ? '现在这手进张最宽'
      : `现在最优 ${maxUkeire} 张 · 少 ${gap} 张`;
  const shape = el.dataset.blk || '';
  els.preview.className = `preview ${verdict}`;
  els.preview.innerHTML =
    `<span class="pv-line">打它 → <b>${chosen.shanten === 0 ? '听牌' : chosen.shanten + ' 向听'}</b>` +
    `<span class="pv-sep">·</span><b>${chosen.ukeire}</b> 张 <em>${word}</em></span>` +
    `<span class="pv-sub">${second}</span>` +
    (shape ? `<span class="pv-sub pv-shape">${shape}${BLK_HINT[shape] ? ` · ${BLK_HINT[shape]}` : ''}</span>` : '');
  els.preview.hidden = false;

  const box = el.getBoundingClientRect();
  const pw = els.preview.offsetWidth;
  let left = box.left + box.width / 2 - pw / 2;
  left = Math.max(10, Math.min(left, window.innerWidth - pw - 10));
  els.preview.style.left = `${left}px`;
  // 上方放不下就翻到牌下方（矮窗口 / 长条形布局）
  const ph = els.preview.offsetHeight;
  const below = box.top - 6 - ph < 8;
  els.preview.classList.toggle('below', below);
  els.preview.style.top = below ? `${box.bottom + 8}px` : `${box.top - 6}px`;
  previewIdx = idx;
}

function hidePreview() {
  if (els.preview) els.preview.hidden = true;
  previewIdx = -1;
}


function renderRiver(freshTile = null) {
  if (!S.river.length) {
    els.river.innerHTML = '<span class="river-empty">还没有出牌</span>';
    return;
  }
  const frag = document.createDocumentFragment();
  S.river.forEach((t, i) => {
    const d = document.createElement('div');
    const isFresh = freshTile !== null && i === S.river.length - 1;
    d.className = 'rtile' + (isFresh ? ' fresh' : '');
    d.innerHTML = faceSVG(t);
    frag.appendChild(d);
  });
  els.river.replaceChildren(frag);
}

function updateMeta() {
  const n = S.hand.length;
  let sh = null;
  let seven = false;
  let info = null;
  try {
    if (n === 14) { info = analyzeHand(S.hand); sh = info[0].shanten; }
    else sh = shanten(countsOf(S.hand));
    if (n >= 13) seven = decompose(S.hand).sevenPairs;
  } catch { /* ignore */ }
  els.roundChip.textContent = `第 ${S.roundNo} 局`;
  els.wallInfo.textContent = `牌墙 ${Math.max(0, S.wall.length - S.cursor)} 张`;
  els.shantenInfo.textContent = sh === null
    ? '向听 —'
    : `向听 ${sh}${sh === 0 ? ' · 听牌' : ''}${seven ? ' · 七对路线' : ''}`;
  paintAdvice(info);
}

// 敲不敲：按「你已经摸到第几手」判断值不值得再等
// 前提（用户的番规）：平胡 0 番和不了，门清 1 番是最低，碰碰胡 / 七对 2 番，除非杠开
const ADV_Q = 0.08;   // 假设对手每手 8% 先和
function paintAdvice(info) {
  if (!els.advice) return;
  const wall = Math.max(0, S.wall.length - S.cursor);
  const no = S.cursor + 1;
  const head = `<span class="adv-k">第 ${no} 手</span><span class="adv-sep">·</span>`
    + `<span>牌墙 ${wall} 张</span>`;
  if (S.hand.length !== 14 || !info || !info.length || wall <= 0) {
    els.advice.innerHTML = head + `<span class="adv-sep">·</span><span>起手中</span>`;
    return;
  }
  const best = info[0];
  const sh = best.shanten;
  const c = countsOf(S.hand);
  const pairs = c.reduce((a, v) => a + (v >= 4 ? 2 : v >= 2 ? 1 : 0), 0);
  const trips = c.filter((v) => v >= 3).length;
  const suits = [c.slice(0, 9).some(Boolean), c.slice(9, 18).some(Boolean), c.slice(18).some(Boolean)]
    .filter(Boolean).length;
  let hasRun = false;
  let sevenNow = false;
  try {
    const st = decompose(S.hand);
    sevenNow = st.sevenPairs;
    hasRun = st.blocks.some((b) => b.shape === '顺子');
  } catch { /* ignore */ }

  if (sh > 0) {
    els.advice.innerHTML = head
      + `<span class="adv-sep">·</span><span>还差 <b>${sh}</b> 步</span>`
      + `<span class="adv-verdict mute">没听牌，谈不上敲</span>`;
    return;
  }

  const k = best.ukeire;
  const p = k / wall;
  const decay = Math.min(0.9, p + ADV_Q);
  const mMax = decay > 0 && decay < 1 ? Math.floor(Math.log(2) / -Math.log(1 - decay)) : 0;
  const route = sevenNow || pairs >= 6 ? '七对'
    : (!hasRun && trips >= 3) ? '碰碰胡'
    : suits === 1 ? '清一色'
    : null;
  // 做大牌的那张：手上唯一没成刻/对的那张（单吊）
  let bigTile = -1;
  if (route === '碰碰胡' || route === '七对') {
    for (let i = 0; i < c.length; i++) {
      if (c[i] === 1) { bigTile = i; break; }
    }
  }
  const bigK = bigTile >= 0 ? Math.max(0, 4 - c[bigTile] - 0) : 0;
  const hold = !!route && mMax >= 1;

  els.advice.innerHTML = head
    + `<span class="adv-sep">·</span><span>听 <b>${k}</b> 张</span>`
    + `<span class="adv-sep">·</span><span>门清 1 番</span>`
    + `<span class="adv-verdict ${hold ? 'hold' : 'now'}">${hold ? `再等 ≤${mMax} 手` : '现在敲'}</span>`
    + `<span class="adv-why">${hold
      ? `单吊 ${bigTile >= 0 ? tileName(bigTile) : '将'} 做${route}：2 番，但只剩 ${bigK} 张；最晚第 ${no + mMax} 手必须敲`
      : `不敲就等于这手不和；再等一手和率少 ${Math.round(decay * 100)}%${route ? `，${route} 太远` : ''}`}</span>`;
}

function updateStats() {
  els.stRounds.textContent = String(S.roundNo);
  els.stRate.textContent = S.judged ? Math.round((S.correct / S.judged) * 100) + '%' : '—';
  els.stStreak.textContent = String(S.streak);
}

function clearCoach() {
  lastResult = null;
  lastHandKey = '';
  S.lastPayload = null;
  S.coachStreaming = false;
  S.localText = '';
  els.badge.className = 'badge idle';
  els.badge.textContent = '待出牌';
  els.headline.textContent = '';
  els.metrics.replaceChildren();
  if (els.tilewall) { els.tilewall.hidden = true; els.tilewall.replaceChildren(); }
  hidePreview();
  els.coach.className = 'coach idle';
  els.coachText.innerHTML = '<span class="muted">点一张牌打出去，立刻给判定和理由。</span>';
  els.coachMeta.textContent = '';
  setForce(null);
}

function metric(html, cls = '') {
  const s = document.createElement('span');
  s.className = 'metric' + (cls ? ' ' + cls : '');
  s.innerHTML = html;
  return s;
}

function renderMetrics() {
  if (!lastResult) { els.metrics.replaceChildren(); return; }
  const { verdict, chosen, maxUkeire, bestTiles, bestShanten } = lastResult;
  // 摸牌之后手牌已经变了，面板里的「最佳」属于刚才那一手，要标出来，免得和悬停预览对不上
  const stale = lastHandKey !== S.hand.join(',');
  const bits = [
    metric(`向听 <b>${chosen.shanten}</b>`, verdict === 'wrong' ? 'bad' : ''),
    metric(`进张 <b>${chosen.ukeire}</b> 张 · ${chosen.kinds} 种`, verdict === 'sub' ? 'bad' : 'good'),
  ];
  if (verdict !== 'best') {
    const names = bestTiles.map((b) => tileName(b.tile)).slice(0, 3).join('/');
    // 向听不同时不能拿进张数比大小（会自相矛盾），只报“能保持几向听”
    const label = bestShanten < chosen.shanten
      ? `最佳 <b>${names}</b> · ${bestShanten === 0 ? '保持听牌' : `保持 ${bestShanten} 向听`}`
      : `最佳 <b>${names}</b> · ${maxUkeire} 张`;
    bits.push(metric(label + (stale ? ' <i class="q">刚才那手</i>' : '')));
  }
  if (chosen.shanten === 0) {
    bits.push(metric(`听 <b>${chosen.waits.map(tileName).join(' ')}</b>`));
  }
  els.metrics.replaceChildren(...bits);
}

function showVerdict(result, text, hand14 = S.hand) {
  const { verdict, chosen } = result;
  lastResult = result;
  lastHandKey = hand14.join(',');
  els.badge.className = 'badge ' + verdict;
  els.badge.textContent = VERDICT_LABEL[verdict];
  els.headline.textContent = text.title;
  els.coach.className = 'coach ' + verdict;
  paintTileWall(hand14, chosen.tile, result);
  renderMetrics();

  els.coachText.innerHTML = '';
  const tag = document.createElement('span');
  tag.className = 'ai-tag';
  tag.textContent = '本地';
  const body = document.createElement('span');
  S.localText = text.detail + (text.extra ? text.extra : '');
  body.textContent = S.localText;
  els.coachText.append(tag, body);
  els.coachMeta.textContent = '';
}

/* ---- 进张牌墙：把「能进哪些牌」画成真牌，宽度直接可比 ---- */
function miniTile(t, count) {
  const s = document.createElement('span');
  s.className = 'mtile';
  s.innerHTML = faceSVG(t);
  if (count > 1) {
    const b = document.createElement('i');
    b.className = 'mc';
    b.textContent = String(count);
    s.appendChild(b);
  }
  s.title = `${tileName(t)} · 还剩 ${count} 张`;
  return s;
}

let wallArgs = null;
function paintTileWall(hand14, tile, result) {
  wallArgs = { hand14, tile, result };
  const wall = els.tilewall;
  if (!wall) return;
  wall.replaceChildren();
  let mine;
  try { mine = ukeireAfter(hand14, tile); } catch { mine = null; }
  if (!mine || !mine.list.length) { wall.hidden = true; return; }

  const LIMIT = window.innerWidth < 640 ? 5 : 9;
  const imprOf = (t) => {
    const c = result.cands.find((x) => x.tile === t);
    return c && c.impr !== undefined ? c.impr : null;
  };
  const rows = [{
    label: `打${tileName(tile)}`,
    u: mine,
    cls: isTop(result.verdict) ? 'good' : 'bad',
    impr: imprOf(tile),
  }];
  if (result.verdict !== 'best') {
    const bt = result.bestTiles[0];
    if (bt && bt.tile !== tile) {
      let bu = null;
      try { bu = ukeireAfter(hand14, bt.tile); } catch { bu = null; }
      if (bu && bu.total) rows.push({ label: `最佳 ${tileName(bt.tile)}`, u: bu, cls: 'best', impr: bt.impr ?? null });
    }
  }
  const maxTotal = Math.max(...rows.map((r) => r.u.total), 1);
  // 两行向听不同时，进张数不可比（少的那行可能是更优解），改用向听标签
  const diffShanten = rows.length > 1 && rows[0].u.base !== rows[1].u.base;

  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'tw-row ' + r.cls;
    const lab = document.createElement('span');
    lab.className = 'tw-label';
    lab.textContent = r.label;
    const list = document.createElement('span');
    list.className = 'tw-tiles';
    const shown = r.u.list.slice(0, LIMIT);
    for (const x of shown) list.appendChild(miniTile(x.tile, x.count));
    if (r.u.list.length > shown.length) {
      const more = document.createElement('span');
      more.className = 'tw-more';
      more.textContent = `+${r.u.list.length - shown.length}`;
      more.title = `另外 ${r.u.list.length - shown.length} 种能进的牌`;
      list.appendChild(more);
    }
    const right = document.createElement('span');
    right.className = 'tw-right';
    if (diffShanten) {
      const sh = document.createElement('span');
      sh.className = 'tw-shanten';
      sh.innerHTML = `<b>${r.u.base}</b> 向听`;
      right.append(sh);
    } else {
      const bar = document.createElement('span');
      bar.className = 'tw-bar';
      const fill = document.createElement('span');
      fill.style.width = `${Math.round((r.u.total / maxTotal) * 100)}%`;
      bar.appendChild(fill);
      right.append(bar);
    }
    const tot = document.createElement('span');
    tot.className = 'tw-total';
    tot.innerHTML = `<b>${r.u.total}</b> 张`;
    right.append(tot);
    if (r.impr !== null && r.impr !== undefined) {
      const im = document.createElement('span');
      im.className = 'tw-impr';
      im.innerHTML = `改良 <b>${r.impr}</b>`;
      im.title = '摸到能把这手进张做宽的牌，还有多少张';
      right.append(im);
    }
    row.append(lab, list, right);
    wall.appendChild(row);
  }
  wall.hidden = false;
}


/** 「就这样打」按钮：仅在打错、牌已退回手里时出现 */
function setForce(on) {
  const b = els.forceBtn;
  if (!b) return;
  b.hidden = !on;
}

/* ------------------------------------------------------------------ *
 * 点评（流式）
 * ------------------------------------------------------------------ */function paintCoach(text, streaming) {
  els.coachText.replaceChildren();
  const tag = document.createElement('span');
  tag.className = 'ai-tag';
  tag.textContent = 'AI';
  const body = document.createElement('span');
  body.textContent = text;
  els.coachText.append(tag, body);
  if (streaming) {
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = '▍';
    els.coachText.append(caret);
  }
  // 把引擎给出的判断留在下面，AI 说的话不覆盖它
  if (S.localText && !streaming) {
    const note = document.createElement('div');
    note.className = 'local-note';
    note.textContent = '引擎：' + S.localText;
    els.coachText.append(note);
  }
  els.coachText.scrollTop = els.coachText.scrollHeight;
}

async function askCoach(payload) {
  const my = ++S.coachSeq;
  S.coachCalls = (S.coachCalls || 0) + 1;
  if (S.coachAbort) S.coachAbort.abort();
  const ctrl = new AbortController();
  S.coachAbort = ctrl;
  const t0 = performance.now();
  let doneSeen = false;
  let timedOut = false;

  // 兜底：模型偶尔会卡住，12 秒没说完就先让用户继续练
  const guard = setTimeout(() => {
    if (my !== S.coachSeq || doneSeen) return;
    timedOut = true;
    els.coachMeta.textContent = 'DeepSeek 响应慢 · 先按本地判定继续练';
    ctrl.abort();
  }, 12000);

  try {
    const res = await fetch('/api/coach', {
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
    let firstMs = 0;
    let usedFallback = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done || my !== S.coachSeq) break;
      buf += dec.decode(value, { stream: true });
      let cut;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const packet = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const line = packet.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (ev.fallback) usedFallback = true;
        if (typeof ev.t === 'string' && ev.t) {
          if (!firstMs) firstMs = performance.now() - t0;
          ai += ev.t;
          paintCoach(ai, true);
        }
        if (ev.done) {
          doneSeen = true;
          const total = Math.round(ev.ms ?? (performance.now() - t0));
          els.coachMeta.textContent = usedFallback
            ? '本地分析（未接入模型 API）'
            : `DeepSeek 实时点评 · 首字 ${Math.round(firstMs || ev.first || 0)}ms · 全文 ${total}ms`;
          if (ai) paintCoach(ai, false);
        }
      }
    }
    if (my === S.coachSeq && !doneSeen && ai) {
      els.coachMeta.textContent = '点评已结束 · 本地判定为准';
      paintCoach(ai, false);
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
    if (my === S.coachSeq) els.coachMeta.textContent = '模型点评未连通 · 上方为本地牌效引擎结果';
  } finally {
    clearTimeout(guard);
    if (timedOut && my === S.coachSeq && S.coachAbort === ctrl) S.coachAbort = null;
  }
}

function coachPayload(hand14, tile, result, text) {
  const { chosen, bestTiles, maxUkeire, bestShanten, verdict } = result;
  return {
    handText: hand14.map(tileName).join(' '),
    discard: tileName(tile),
    shanten: chosen.shanten,
    ukeire: chosen.ukeire,
    kinds: chosen.kinds,
    verdict,
    verdictText: VERDICT_TEXT[verdict],
    bestText: bestTiles.map((b) => tileName(b.tile)).slice(0, 2).join(' / '),
    bestShanten,
    bestUkeire: maxUkeire,
    impr: chosen.impr ?? null,
    bestImpr: result.bestImpr ?? null,
    tied: result.tied ?? 0,
    waitsText: chosen.shanten === 0 ? chosen.waits.map(tileName).join(' ') : '',
    fallback: text.detail + (text.extra ? text.extra : ''),
  };
}

/* ------------------------------------------------------------------ *
 * 出牌流程
 * ------------------------------------------------------------------ */
async function onDiscard(idx) {
  if (S.busy || S.done) return;
  const tile = S.hand[idx];
  if (tile === undefined) return;

  S.busy = true;
  clearHint();
  setForce(false);
  hidePreview();

  const hand14 = S.hand.slice();
  const result = judgeDiscard(hand14, tile);
  const text = describe(result, hand14);
  const snap = snapshot();      // 这一手之前的局面，撤销用
  const good = isTop(result.verdict);

  // 1) 立刻判定（同步，无网络）
  showVerdict(result, text, hand14);

  // 2) 退场
  const el = els.hand.querySelector(`[data-idx="${idx}"]`);
  if (el) el.classList.add('leaving');
  await wait(180);

  // 3) 统计（每次尝试都记）
  S.judged++;
  if (S.rec) S.rec.attempts++;
  if (good) {
    S.correct++;
    if (S.rec) S.rec.correct++;
    S.streak++;
    S.bestStreak = Math.max(S.bestStreak, S.streak);
  } else {
    S.streak = 0;
  }
  updateStats();

  S.lastPayload = coachPayload(hand14, tile, result, text);

  if (good) {
    // 打对了：不调用 AI，直接进牌河 + 摸牌
    S.undoStack.push(snap);
    if (S.undoStack.length > 400) S.undoStack.shift();
    commitDiscard(idx, tile);
    if (S.rec) S.rec.moves++;
    await wait(110);
    drawTile();
    S.busy = false;
    return;
  }

  // 打错了：牌退回手里、不摸牌，直接请 AI 讲两句
  recordMistake(hand14, tile, result);
  S.pending = { idx, tile, snap };
  renderHand({ animate: 'all' });
  updateMeta();
  setForce(true);
  els.coachMeta.textContent = '这手还能更好 · 换一张再试，或点「就这样打」';
  S.coachStreaming = false;
  S.busy = false;
  explainLast();
}

/** 真的把这张牌打出去（进牌河） */
function commitDiscard(idx, tile) {
  S.hand.splice(idx, 1);
  S.hand.sort((a, b) => a - b);
  S.river.push(tile);
  renderHand();
  renderRiver(tile);
  updateMeta();
}

/** 打错了但用户坚持：照打并摸牌 */
function forceCommit() {
  if (!S.pending || S.busy || S.done) return;
  const p = S.pending;
  S.pending = null;
  setForce(false);
  S.busy = true;
  if (p.snap) {
    S.undoStack.push(p.snap);
    if (S.undoStack.length > 400) S.undoStack.shift();
  }
  commitDiscard(p.idx, p.tile);
  if (S.rec) S.rec.moves++;
  els.coachMeta.textContent = '已按你的选择打出';
  drawTile();
  S.busy = false;
}

/** 按需：让 AI 解释刚才这一手 */
function explainLast() {
  if (!S.lastPayload || S.coachStreaming) return;
  if (S.coachOff) {
    toast('未接入 AI · 复制 coach.config.example.json 为 coach.config.json 并填入 key 后重启');
    return;
  }
  S.coachStreaming = true;
  els.coachMeta.textContent = 'AI 正在组织语言…';
  askCoach(S.lastPayload).finally(() => {
    S.coachStreaming = false;
  });
}

/* ------------------------------------------------------------------ *
 * 撤销 / 历史
 * ------------------------------------------------------------------ */
function snapshot() {
  return {
    hand: S.hand.slice(), cursor: S.cursor, river: S.river.slice(),
    judged: S.judged, correct: S.correct, streak: S.streak, bestStreak: S.bestStreak,
    rec: S.rec ? { ...S.rec } : null,
  };
}

function applySnapshot(s) {
  S.hand = s.hand.slice();
  S.cursor = s.cursor;
  S.river = s.river.slice();
  S.judged = s.judged;
  S.correct = s.correct;
  S.streak = s.streak;
  S.bestStreak = s.bestStreak;
  S.rec = s.rec ? { ...s.rec } : null;
  S.done = false;
  renderHand();
  renderRiver();
  updateMeta();
  updateStats();
}

/** 后退一步：回到上一张牌打出去之前 */
function undo() {
  if (S.busy) return;
  if (S.pending) {
    S.pending = null;
    setForce(false);
    toast('已取消这一手');
    return;
  }
  const s = S.undoStack.pop();
  if (!s) { toast('已经退到最初的一手了'); return; }
  S.coachSeq++;
  if (S.coachAbort) { S.coachAbort.abort(); S.coachAbort = null; }
  if (S.hintTimer) { clearTimeout(S.hintTimer); S.hintTimer = 0; }
  applySnapshot(s);
  clearCoach();
  els.winOverlay.hidden = true;
  toast('退回上一手');
}

/* ---- 历史 ---- */
function loadHistory() {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    S.history = Array.isArray(arr) ? arr.filter((r) => r && typeof r.seed === 'number') : [];
  } catch { S.history = []; }
}

function saveHistory() {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(S.history.slice(0, HIST_MAX))); } catch { /* 隐私模式就算了 */ }
}

/** 把当前这一局写进历史（胡牌或换局时调用，一局只记一次） */
function archiveRound() {
  const r = S.rec;
  if (!r || r.archived || !r.attempts) return;
  r.archived = true;
  S.history.unshift({ ...r });
  S.history = S.history.slice(0, HIST_MAX);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  if (!els.histList) return;
  els.histCount.textContent = S.history.length ? `共 ${S.history.length} 局` : '';
  if (!S.history.length) {
    els.histList.innerHTML = '<p class="hist-empty">还没有记录。打完一局（出过牌）就会自动记在这里。</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  S.history.forEach((r) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'hist-row';
    const rate = r.attempts ? Math.round((r.correct / r.attempts) * 100) : 0;
    row.innerHTML =
      `<span class="hist-round">第 ${r.round} 局</span>` +
      `<span class="hist-meta">出牌 ${r.moves} 张 · 正确 ${r.correct}/${r.attempts} · ${rate}%</span>` +
      `<span class="hist-tag ${r.won ? 'won' : ''}">${r.won ? '胡牌' : '未完'}</span>` +
      `<span class="hist-again">重玩 ↻</span>`;
    row.title = `重玩第 ${r.round} 局（同一副牌）`;
    row.addEventListener('click', () => {
      closeHistory();
      startRound(r.seed);
      toast(`重玩第 ${r.round} 局`);
    });
    frag.appendChild(row);
  });
  els.histList.replaceChildren(frag);
}

function openHistory() {
  archiveRound();
  renderHistory();
  els.historyModal.hidden = false;
}

function closeHistory() {
  els.historyModal.hidden = true;
}

/* ------------------------------------------------------------------ *
 * 错题本：打错/没打最好的手，存起来重打
 * ------------------------------------------------------------------ */
function loadMistakes() {
  try {
    const arr = JSON.parse(localStorage.getItem(MIST_KEY) || '[]');
    S.mistakes = Array.isArray(arr)
      ? arr.filter((m) => m && Array.isArray(m.hand) && m.hand.length === 14 && typeof m.tile === 'number')
      : [];
  } catch { S.mistakes = []; }
}

function saveMistakes() {
  try { localStorage.setItem(MIST_KEY, JSON.stringify(S.mistakes.slice(0, MIST_MAX))); } catch { /* 隐私模式 */ }
}

/** 记一笔（同一手牌 + 同一张只记一次） */
function recordMistake(hand14, tile, result) {
  const best = result.bestTiles[0];
  if (!best) return;
  const sig = `${hand14.join(',')}|${tile}`;
  if (S.mistakes.some((m) => m.sig === sig)) return;
  S.mistakes.unshift({
    sig,
    hand: hand14.slice(),
    tile,
    best: best.tile,
    shanten: result.chosen.shanten,
    ukeire: result.chosen.ukeire,
    bestShanten: result.bestShanten,
    bestUkeire: result.maxUkeire,
    ts: Date.now(),
  });
  S.mistakes = S.mistakes.slice(0, MIST_MAX);
  saveMistakes();
  renderMistakes();
}

function renderMistakes() {
  if (!els.mistakeList) return;
  els.mistakeCount.textContent = S.mistakes.length ? `共 ${S.mistakes.length} 手` : '';
  if (!S.mistakes.length) {
    els.mistakeList.innerHTML =
      '<p class="hist-empty">还没有错题。打错或没打到最优时，这一手会自动收进来。</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  S.mistakes.forEach((m) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'hist-row mist-row';
    const tiles = m.hand.slice().sort((a, b) => a - b)
      .map((t) => `<span class="mtile">${faceSVG(t)}</span>`).join('');
    const gap = m.bestShanten < m.shanten
      ? `向听 ${m.shanten} → ${m.bestShanten}`
      : `进张 ${m.ukeire} / ${m.bestUkeire} 张`;
    row.innerHTML =
      `<span class="mist-hand">${tiles}</span>` +
      `<span class="mist-text">你打 <b class="bad">${tileName(m.tile)}</b>` +
      `<i> · 应打</i> <b class="ok">${tileName(m.best)}</b></span>` +
      `<span class="mist-meta">${gap}</span>`;
    row.title = '点一下重打这一手';
    row.addEventListener('click', () => replayMistake(m));
    frag.appendChild(row);
  });
  els.mistakeList.replaceChildren(frag);
}

function openMistakes() {
  renderMistakes();
  els.mistakeModal.hidden = false;
}

function closeMistakes() {
  els.mistakeModal.hidden = true;
}

/** 用错题里的 14 张牌开一局（牌墙从剩下的牌里随机） */
function replayMistake(m) {
  closeMistakes();
  startRound(nextSeed());
  const hand = m.hand.slice().sort((a, b) => a - b);
  const c = countsOf(hand);
  const rest = [];
  for (let t = 0; t < 27; t++) for (let k = c[t]; k < 4; k++) rest.push(t);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  S.hand = hand;
  S.wall = rest;
  S.cursor = 0;
  renderHand({ animate: 'all' });
  renderRiver();
  updateMeta();
  toast('重打这一手');
}


/* ------------------------------------------------------------------ *
 * 收藏：把想反复拆的手存下来
 * ------------------------------------------------------------------ */
function loadFavs() {
  try {
    const arr = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    S.favs = Array.isArray(arr)
      ? arr.filter((f) => f && Array.isArray(f.hand) && f.hand.length === 14)
      : [];
  } catch { S.favs = []; }
}

function saveFavs() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(S.favs.slice(0, FAV_MAX))); } catch { /* 隐私模式 */ }
}

function favModalOpen() { return els.favModal && !els.favModal.hidden; }

function favSig(hand) { return hand.join(','); }

/** 当前这手是否已收藏 */
function favIdx() {
  if (S.hand.length !== 14) return -1;
  const sig = favSig(S.hand.slice().sort((a, b) => a - b));
  return S.favs.findIndex((f) => f.sig === sig);
}

function paintFavState() {
  if (!els.saveFav) return;
  const on = favIdx() >= 0;
  els.saveFav.disabled = S.hand.length !== 14 || S.done;
  els.saveFav.classList.toggle('on', on);
  els.saveFav.innerHTML = on ? '★ 已收藏' : '☆ 收藏这一手';
}

function toggleFav() {
  if (S.hand.length !== 14 || S.done) return;
  const hand = S.hand.slice().sort((a, b) => a - b);
  const sig = favSig(hand);
  const i = S.favs.findIndex((f) => f.sig === sig);
  if (i >= 0) {
    S.favs.splice(i, 1);
    toast('已取消收藏');
  } else {
    S.favs.unshift({
      sig,
      hand,
      wall: S.wall.slice(S.cursor),
      shanten: shanten(countsOf(hand)),
      round: S.roundNo,
      ts: Date.now(),
    });
    S.favs = S.favs.slice(0, FAV_MAX);
    toast('已收藏这一手 · 按 F 打开列表');
  }
  saveFavs();
  paintFavState();
}

function renderFavs() {
  if (!els.favList) return;
  els.favCount.textContent = S.favs.length ? `共 ${S.favs.length} 手` : '';
  if (!S.favs.length) {
    els.favList.innerHTML = '<p class="hist-empty">还没有收藏。点「☆ 收藏这一手」把想反复拆的牌存下来。</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  S.favs.forEach((f, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'hist-row mist-row';
    const tiles = f.hand.map((t) => `<span class="mtile">${faceSVG(t)}</span>`).join('');
    const d = new Date(f.ts);
    const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    row.innerHTML =
      `<span class="mist-hand">${tiles}</span>` +
      `<span class="mist-text">${f.shanten === 0 ? '听牌' : `${f.shanten} 向听`}</span>` +
      `<span class="mist-meta">${when}</span>` +
      `<span class="fav-del" title="取消收藏">×</span>`;
    row.title = '点一下重打这一手';
    row.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('fav-del')) {
        S.favs.splice(i, 1);
        saveFavs();
        renderFavs();
        paintFavState();
        return;
      }
      replayFav(f);
    });
    frag.appendChild(row);
  });
  els.favList.replaceChildren(frag);
}

function openFavs() {
  renderFavs();
  els.favModal.hidden = false;
}

function closeFavs() {
  if (els.favModal) els.favModal.hidden = true;
}

function replayFav(f) {
  closeFavs();
  startRound(nextSeed());
  S.hand = f.hand.slice().sort((a, b) => a - b);
  const wall = Array.isArray(f.wall) && f.wall.length ? f.wall.slice() : [];
  if (!wall.length) {
    const c = countsOf(S.hand);
    for (let t = 0; t < 27; t++) for (let k = c[t]; k < 4; k++) wall.push(t);
    for (let i = wall.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [wall[i], wall[j]] = [wall[j], wall[i]];
    }
  }
  S.wall = wall;
  S.cursor = 0;
  renderHand({ animate: 'all' });
  renderRiver();
  updateMeta();
  paintFavState();
  toast('重打这一手');
}

let prewarmTimer = 0;
/** 摸完牌后在空闲里把「这一手怎么打」算好，点牌时判定就是 0ms */
function schedulePrewarm() {
  clearTimeout(prewarmTimer);
  prewarmTimer = setTimeout(() => {
    const hand = S.hand.slice().sort((a, b) => a - b);
    if (hand.length === 14) prewarm(hand);
  }, 60);
}

function drawTile() {
  if (S.cursor >= S.wall.length) {
    toast('牌墙摸完了，这局算流局');
    setTimeout(() => startRound(nextSeed()), 900);
    return;
  }
  const t = S.wall[S.cursor++];
  S.hand.push(t);
  renderHand({ animate: 'drawn' });
  updateMeta();
  renderMetrics();
  if (!isWin(countsOf(S.hand))) schedulePrewarm();

  if (isWin(countsOf(S.hand))) {
    S.done = true;
    setTimeout(showWin, 240);
  }
}

function showWin() {
  S.done = true;
  const c = countsOf(S.hand);
  els.winSub.textContent = `自摸 · ${handType(c).join(' · ')}`;
  const frag = document.createDocumentFragment();
  for (const t of S.hand.slice().sort((a, b) => a - b)) frag.appendChild(tileEl(t, -1));
  els.winHand.replaceChildren(frag);
  els.winStats.textContent =
    `第 ${S.roundNo} 局 · 共出牌 ${S.river.length} 张 · 正确 ${S.correct}/${S.judged} · 最长连对 ${S.bestStreak}`;
  els.winOverlay.hidden = false;
  if (S.rec) S.rec.won = true;
  archiveRound();
  updateMeta();
}

/* ------------------------------------------------------------------ *
 * 局面控制
 * ------------------------------------------------------------------ */
function nextSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

function startRound(seed, { count = true } = {}) {
  archiveRound();               // 换局前把上一局记进历史
  const r = newRound(seed);
  S.seed = seed;
  S.hand = r.hand.slice();
  S.wall = r.wall;
  S.cursor = 0;
  S.river = [];
  S.busy = false;
  S.done = false;
  S.pending = null;
  S.undoStack = [];
  S.coachSeq++;
  if (S.coachAbort) { S.coachAbort.abort(); S.coachAbort = null; }
  if (count) S.roundNo++;
  S.rec = { round: S.roundNo, seed, moves: 0, attempts: 0, correct: 0, won: false, archived: false };
  els.winOverlay.hidden = true;
  clearCoach();
  renderHand({ animate: 'all' });
  renderRiver();
  updateMeta();
  updateStats();
  schedulePrewarm();
}

function replayRound() {
  startRound(S.seed, { count: false });
}

/* ------------------------------------------------------------------ *
 * 提示
 * ------------------------------------------------------------------ */
function clearHint() {
  clearTimeout(S.hintTimer);
  els.hand.querySelectorAll('.tile.hint').forEach((t) => t.classList.remove('hint'));
}

function showHint() {
  if (S.done || S.hand.length < 14) return;
  clearHint();
  const probe = judgeDiscard(S.hand, S.hand[0]);
  const cands = analyzeHand(S.hand);
  const targets = probe.bestTiles.length ? probe.bestTiles : cands.slice(0, 1);
  const set = new Set(targets.map((t) => t.tile));
  els.hand.querySelectorAll('.tile').forEach((t) => {
    if (set.has(Number(t.dataset.tile))) t.classList.add('hint');
  });
  S.hintTimer = setTimeout(clearHint, 2600);
}

/* ------------------------------------------------------------------ *
 * 杂项 UI
 * ------------------------------------------------------------------ */
let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

/* ------------------------------------------------------------------ *
 * 事件
 * ------------------------------------------------------------------ */
els.hand.addEventListener('click', (e) => {
  const t = e.target.closest('.tile');
  if (!t) return;
  hidePreview();
  onDiscard(Number(t.dataset.idx));
});

els.hand.addEventListener('pointerover', (e) => {
  const t = e.target.closest('.tile');
  if (!t) return;
  const idx = Number(t.dataset.idx);
  if (idx === previewIdx && !els.preview.hidden) return;
  showPreview(t, idx);
});

els.hand.addEventListener('pointerout', (e) => {
  const t = e.target.closest('.tile');
  if (!t) return;
  if (t.contains(e.relatedTarget)) return;
  hidePreview();
});

document.querySelector('.hand-wrap')?.addEventListener('scroll', hidePreview, { passive: true });

// 窗口尺寸变了，牌的宽度跟着变，括号和标签要重新量（防抖）
let structTimer = 0;
function repaintStruct() {
  clearTimeout(structTimer);
  structTimer = setTimeout(() => { hidePreview(); paintGroups(); }, 80);
}
let wallTimer = null;
window.addEventListener('resize', () => {
  hidePreview();
  repaintStruct();
  clearTimeout(wallTimer);
  wallTimer = setTimeout(() => {
    if (wallArgs && !els.tilewall.hidden) {
      const { hand14, tile, result } = wallArgs;
      paintTileWall(hand14, tile, result);
    }
  }, 160);
});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(repaintStruct);

els.newBtn.addEventListener('click', () => startRound(nextSeed()));
els.replayBtn.addEventListener('click', replayRound);
els.winNext.addEventListener('click', () => startRound(nextSeed()));
els.winReplay.addEventListener('click', replayRound);

els.rulesBtn.addEventListener('click', () => { els.rulesModal.hidden = false; });
els.rulesClose.addEventListener('click', () => { els.rulesModal.hidden = true; });
els.rulesModal.addEventListener('click', (e) => {
  if (e.target === els.rulesModal) els.rulesModal.hidden = true;
});
els.forceBtn.addEventListener('click', () => { forceCommit(); els.forceBtn.blur(); });

els.historyBtn.addEventListener('click', openHistory);
els.historyClose.addEventListener('click', closeHistory);
els.historyModal.addEventListener('click', (e) => { if (e.target === els.historyModal) closeHistory(); });
els.histClear.addEventListener('click', () => {
  if (!S.history.length) return;
  S.history = [];
  saveHistory();
  renderHistory();
  toast('历史已清空');
});

els.mistakeBtn.addEventListener('click', openMistakes);
els.mistakeClose.addEventListener('click', closeMistakes);
els.mistakeModal.addEventListener('click', (e) => { if (e.target === els.mistakeModal) closeMistakes(); });
els.mistakeClear.addEventListener('click', () => {
  if (!S.mistakes.length) return;
  S.mistakes = [];
  saveMistakes();
  renderMistakes();
  toast('错题本已清空');
});

function applyPreview(on, { silent = false } = {}) {
  previewOn = on;
  try { localStorage.setItem(PREVIEW_KEY, on ? '1' : '0'); } catch { /* 隐私模式 */ }
  els.previewSwitch.classList.toggle('on', on);
  els.previewSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
  if (!on) hidePreview();
  if (!silent) toast(on ? '悬停提示：开' : '悬停提示：关');
}

function applyGroups(on, { silent = false } = {}) {
  groupsOn = on;
  try { localStorage.setItem(GROUP_KEY, on ? '1' : '0'); } catch { /* 隐私模式 */ }
  els.groupSwitch.classList.toggle('on', on);
  els.groupSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
  paintGroups();
  if (!silent) {
    toast(on
      ? '已开启搭子分组'
      : '已关闭搭子分组');
  }
}

els.groupSwitch.addEventListener('click', () => { applyGroups(!groupsOn); els.groupSwitch.blur(); });
els.previewSwitch.addEventListener('click', () => { applyPreview(!previewOn); els.previewSwitch.blur(); });
els.saveFav.addEventListener('click', () => { toggleFav(); els.saveFav.blur(); });
els.favBtn.addEventListener('click', () => { openFavs(); els.favBtn.blur(); });
els.favClose.addEventListener('click', closeFavs);
els.favClear.addEventListener('click', () => { S.favs = []; saveFavs(); renderFavs(); paintFavState(); });
els.favModal.addEventListener('click', (e) => { if (e.target === els.favModal) closeFavs(); });

document.addEventListener('keydown', (e) => {
  const onButton = e.target instanceof HTMLElement && e.target.closest('button');
  if (e.key === 'Escape') { els.rulesModal.hidden = true; closeHistory(); closeMistakes(); closeFavs(); return; }
  // 弹层打开时只响应 Esc，避免误触 A / 空格等快捷键
  const modalOpen = !els.rulesModal.hidden || !els.historyModal.hidden || !els.mistakeModal.hidden || favModalOpen();
  if (modalOpen) return;
  // 摇铃模式有自己的按键：空格新一局、R 重打、C 看牌
  if (mode === 'read') {
    if (e.key === '1') { readMode.answer('danger'); return; }
    if (e.key === '2') { readMode.answer('safe'); return; }
    if (e.code === 'Space' || e.key === ' ') {
      if (onButton) return;
      e.preventDefault();
      if (readMode.state.state === 'revealed') readMode.next();
      return;
    }
    return;
  }
  if (e.code === 'Space' || e.key === ' ') {
    if (onButton) return;
    e.preventDefault();
    startRound(nextSeed());
    return;
  }
  if (e.key === 'Enter') { forceCommit(); return; }
  if (e.key === 'z' || e.key === 'Z') { undo(); return; }
  if (e.key === 'l' || e.key === 'L') { openHistory(); return; }
  if (e.key === 'm' || e.key === 'M') { openMistakes(); return; }
  if (e.key === 'f' || e.key === 'F') { if (favModalOpen()) closeFavs(); else toggleFav(); return; }
  if (e.key === 'g' || e.key === 'G') { applyGroups(!groupsOn); return; }
  if (e.key === 'v' || e.key === 'V') { applyPreview(!previewOn); return; }
  if (e.key === 'r' || e.key === 'R') { replayRound(); return; }
  if (e.key === 'h' || e.key === 'H') { showHint(); return; }
  if (e.key === 'a' || e.key === 'A') { explainLast(); return; }
});

/* ------------------------------------------------------------------ *
 * 模式切换：拆搭 / 摇铃
 * ------------------------------------------------------------------ */
let mode = 'train';

const readMode = createReadMode(
  {
    area: els.readArea, hand: els.rdHand, oppHand: els.oppHand, oppRiver: els.rdOppRiver,
    no: els.rdNo, knock: els.rdKnock, rate: els.rdRate, tag: els.rdTag,
    quizQ: els.quizQ, ansDanger: els.ansDanger, ansSafe: els.ansSafe, nextQ: els.nextQ,
    fb: els.rdFb,
  },
  { toast },
);

function setMode(m) {
  if (m === mode) return;
  mode = m;
  const read = m === 'read';
  document.body.classList.toggle('mode-read', read);
  els.trainArea.hidden = read;
  els.coach.hidden = read;
  els.modeTrain.classList.toggle('on', !read);
  els.modeRead.classList.toggle('on', read);
  els.modeTrain.setAttribute('aria-selected', String(!read));
  els.modeRead.setAttribute('aria-selected', String(read));
  if (read) { hidePreview(); readMode.enter(); }
  else readMode.leave();
}

els.modeTrain.addEventListener('click', () => setMode('train'));
els.modeRead.addEventListener('click', () => setMode('read'));

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
loadHistory();
loadMistakes();
loadFavs();
renderMistakes();
startRound(nextSeed());
applyGroups(groupsOn, { silent: true });
fetch('/api/health')
  .then((r) => r.json())
  .then((j) => { S.coachOff = !j.coach; })
  .catch(() => { S.coachOff = true; });

// 调试/自动化钩子
window.__mj = {
  state: S,
  startRound,
  nextSeed,
  analyzeHand,
  judgeDiscard,
  setHand(tiles, wall) {
    S.hand = tiles.slice();
    if (wall) { S.wall = wall.slice(); S.cursor = 0; }
    S.river = [];
    S.done = false;
    S.busy = false;
    renderHand({ animate: 'all' });
    renderRiver();
    updateMeta();
    clearCoach();
  },
};

// 摇铃模式：给自动化测试用
window.__mjRead = () => readMode.state;
window.__mjMode = setMode;
window.__mjReadStart = (seed) => readMode.loadSeed(seed);
window.__mjReadNext = () => readMode.next();
window.__mjAnswer = (c) => readMode.answer(c);
