import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9401, profile: '.chrome-cdp61', url: 'http://127.0.0.1:8788/' });
await c.sleep(1300);

const state = () => c.evaluate(`JSON.stringify({
  drill: !!document.getElementById('drill'),
  drillBtn: !!document.getElementById('drillBtn'),
  askAi: !!document.getElementById('askAi'),
  saveFav: !!document.getElementById('saveFav'),
  favText: document.getElementById('saveFav')?.textContent,
  favDisabled: document.getElementById('saveFav')?.disabled,
  favs: window.__mj.state.favs.length,
  meta: document.getElementById('coachMeta').textContent,
  keys: document.querySelector('.keys').textContent.replace(/\\s+/g, ' ').trim(),
  hand: window.__mj.state.hand.length,
})`);
console.log('init ', await state());

// 收藏一手
await c.evaluate("document.getElementById('saveFav').click(); 1");
await c.sleep(250);
console.log('saved', await state());

// 打开收藏面板
await c.evaluate("document.getElementById('favBtn').click(); 1");
await c.sleep(300);
console.log('panel', await c.evaluate(`JSON.stringify({
  open: !document.getElementById('favModal').hidden,
  rows: document.querySelectorAll('#favList .hist-row').length,
  count: document.getElementById('favCount').textContent,
})`));
await c.screenshot('shot-favs.png');

// 点行重打
const seedBefore = await c.evaluate('window.__mj.state.seed');
await c.evaluate("document.querySelector('#favList .hist-row').click(); 1");
await c.sleep(400);
console.log('replay', await c.evaluate(`JSON.stringify({
  modal: document.getElementById('favModal').hidden,
  hand: window.__mj.state.hand.length,
  wall: window.__mj.state.wall.length,
  favOn: document.getElementById('saveFav').classList.contains('on'),
})`));

// 取消收藏
await c.evaluate("document.getElementById('saveFav').click(); 1");
await c.sleep(250);
console.log('unsaved', await state());

console.log('errors', c.logs);
await c.close();
