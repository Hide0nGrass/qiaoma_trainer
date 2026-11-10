// 快练 + 错题本 冒烟测试
import { connect } from './cdp-lib.mjs';

const PORT = 9347;
const c = await connect({ port: PORT, profile: '.chrome-cdp13', url: 'http://127.0.0.1:8788/' });
const pass = [];
const fail = [];
const ok = (name, cond, extra = '') => (cond ? pass : fail).push(name + (extra ? ` (${extra})` : ''));

await c.sleep(1200);
ok('无控制台错误(初始)', c.logs.length === 0, c.logs.join('|'));

// --- 搭子分组 ---
const st = await c.evaluate(`(() => {
  const hand = document.getElementById('hand');
  const ts = [...hand.children].sort((a, b) => a.offsetLeft - b.offsetLeft);
  const xs = ts.map(t => t.offsetLeft);
  const gaps = xs.map((x, i) => i ? x - (xs[i-1] + ts[i-1].offsetWidth) : 0).slice(1);
  return {
    hand: ts.length,
    grouped: hand.classList.contains('grouped'),
    sw: document.getElementById('groupSwitch').classList.contains('on'),
    big: gaps.filter(g => g > 15).length,
    orders: ts.filter(t => t.style.order).length,
    markers: ts.filter(t => t.classList.contains('grp-end')).length,
  };
})()`);
ok('手牌 14 张', st.hand === 14, String(st.hand));
ok('默认开启搭子分组', st.grouped && st.sw, JSON.stringify(st));
ok('块之间留出明显空隙', st.big >= 2, `${st.big} 处大间隙`);
ok('分组时按块重排（有 order）', st.orders === 14, String(st.orders));
ok('块尾标记数量 = 块数-1', st.markers >= 1 && st.markers === st.big, `${st.markers}/${st.big}`);

// 开关能关掉
await c.evaluate("document.getElementById('groupSwitch').click(); 1");
await c.sleep(250);
const off = await c.evaluate(`(() => {
  const hand = document.getElementById('hand');
  const ts = [...hand.children].sort((a, b) => a.offsetLeft - b.offsetLeft);
  const xs = ts.map(t => t.offsetLeft);
  const gaps = xs.map((x, i) => i ? x - (xs[i-1] + ts[i-1].offsetWidth) : 0).slice(1);
  return { grouped: hand.classList.contains('grouped'), big: gaps.filter(g => g > 15).length,
           orders: ts.filter(t => t.style.order).length, markers: ts.filter(t => t.classList.contains('grp-end')).length };
})()`);
ok('开关可关闭分组', !off.grouped && off.orders === 0 && off.markers === 0, JSON.stringify(off));
await c.evaluate("document.getElementById('groupSwitch').click(); 1");
await c.sleep(250);

// --- 悬停预览 ---
await c.evaluate(`(() => {
  const t = document.querySelectorAll('#hand .tile')[3];
  const r = t.getBoundingClientRect();
  t.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: r.x + 8, clientY: r.y + 8 }));
  return 1;
})()`);
await c.sleep(150);
const pv = await c.evaluate(`(() => {
  const p = document.getElementById('preview');
  return { hidden: p.hidden, text: p.textContent.trim() };
})()`);
ok('悬停预览出现', !pv.hidden && /向听|听牌/.test(pv.text), pv.text);

  // 开关关掉后不再弹提示
  await c.evaluate("document.getElementById('previewSwitch').click(); 1");
  await c.sleep(150);
  const pvOff = await c.evaluate("document.getElementById('preview').hidden");
  ok('开关关掉后提示隐藏', pvOff === true, String(pvOff));
  await c.evaluate("document.getElementById('previewSwitch').click(); 1");
  await c.sleep(150);
  const pvOn = await c.evaluate("document.getElementById('previewSwitch').classList.contains('on')");
  ok('开关可以再打开', pvOn === true, String(pvOn));

// --- 收藏 ---
const favInit = await c.evaluate(`(() => ({
  save: !!document.getElementById('saveFav'),
  disabled: document.getElementById('saveFav').disabled,
  text: document.getElementById('saveFav').textContent,
  drill: !!document.getElementById('drill'),
  drillBtn: !!document.getElementById('drillBtn'),
}))()`);
ok('快练已移除', favInit.drill === false && favInit.drillBtn === false, JSON.stringify(favInit));
ok('收藏按钮可用', favInit.save && favInit.disabled === false, JSON.stringify(favInit));

await c.evaluate("document.getElementById('saveFav').click(); 1");
await c.sleep(220);
const favSaved = await c.evaluate(`(() => ({
  n: __mj.state.favs.length,
  text: document.getElementById('saveFav').textContent,
  on: document.getElementById('saveFav').classList.contains('on'),
}))()`);
ok('点一下收藏成功', favSaved.n === 1 && favSaved.on && favSaved.text.includes('已收藏'), JSON.stringify(favSaved));

await c.evaluate("document.getElementById('favBtn').click(); 1");
await c.sleep(260);
const favPanel = await c.evaluate(`(() => ({
  open: !document.getElementById('favModal').hidden,
  rows: document.querySelectorAll('#favList .hist-row').length,
  count: document.getElementById('favCount').textContent,
}))()`);
ok('收藏面板打开', favPanel.open && favPanel.rows === 1, JSON.stringify(favPanel));

const favWall = await c.evaluate("__mj.state.wall.length");
await c.evaluate("document.querySelector('#favList .hist-row').click(); 1");
await c.sleep(300);
const favReplay = await c.evaluate(`(() => ({
  modal: document.getElementById('favModal').hidden,
  hand: __mj.state.hand.length,
  on: document.getElementById('saveFav').classList.contains('on'),
}))()`);
ok('点收藏重打这一手', favReplay.modal && favReplay.hand === 14, JSON.stringify({ ...favReplay, favWall }));

await c.evaluate("document.getElementById('saveFav').click(); 1");
await c.sleep(220);
const favOff = await c.evaluate("__mj.state.favs.length");
ok('可以取消收藏', favOff === 0, String(favOff));

// --- 错题本 ---
const wrong = await c.evaluate(`(() => {
  const s = __mj.state;
  const cands = __mj.analyzeHand(s.hand);
  const worst = cands[cands.length - 1];
  const idx = s.hand.indexOf(worst.tile);
  const el = document.querySelectorAll('#hand .tile')[idx];
  el.click();
  return { tile: worst.tile, idx };
})()`);
await c.sleep(900);
const mist = await c.evaluate(`(() => ({
  stored: JSON.parse(localStorage.getItem('qiaoma.mistakes.v1') || '[]').length,
  rows: (document.getElementById('mistakeBtn').click(), document.querySelectorAll('#mistakeList .mist-row').length),
  open: !document.getElementById('mistakeModal').hidden,
  first: (document.querySelector('#mistakeList .mist-text') || {}).textContent || '',
}))()`);
ok('打错记进错题本', mist.stored >= 1, String(mist.stored));
ok('错题本面板打开', mist.open && mist.rows >= 1, `${mist.rows}`);
ok('错题行有「你打/应打」', /你打/.test(mist.first) && /应打/.test(mist.first), mist.first);

// 点击重打
const rep = await c.evaluate(`(() => {
  document.querySelector('#mistakeList .mist-row').click();
  const s = __mj.state;
  return { hand: s.hand.length, river: s.river.length, modal: document.getElementById('mistakeModal').hidden };
})()`);
ok('点错题重打这一手', rep.hand === 14 && rep.river === 0 && rep.modal, JSON.stringify(rep));

ok('无控制台错误(全程)', c.logs.length === 0, c.logs.join('|'));

console.log(fail.length ? `FAIL ${fail.length}` : `PASS ${pass.length}`, pass);
if (fail.length) console.log('FAILED:', fail);
await c.close();
