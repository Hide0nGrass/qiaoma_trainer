/** 胡牌流程 + 提示 + 下一局 自测 */
import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9336, profile: '.chrome-cdp4' });
try {
  for (let i = 0; i < 40; i++) {
    if (await c.evaluate('Boolean(window.__mj && window.__mj.state.hand.length)')) break;
    await c.sleep(150);
  }

  // 123456789万 + 11筒 + 45筒（听 3/6筒），多一张 8 条待打；牌墙首张 = 3筒
  await c.evaluate(`(window.__mj.setHand([0,1,2,3,4,5,6,7,8, 9,9, 12,13, 26], [11,14,20,21,22,23,24,25]), true)`);
  console.log('hand', await c.evaluate('window.__mj.state.hand.length'),
    'dom', await c.evaluate("document.querySelectorAll('#hand .tile').length"),
    'shanten', await c.evaluate("document.getElementById('shantenInfo').textContent"));

  // 点最后一张（8条）
  const click = await c.evaluate(`(() => {
    const tiles = document.querySelectorAll('#hand .tile');
    const el = tiles[tiles.length - 1];
    el.click();
    return { badge: document.getElementById('badge').textContent, head: document.getElementById('headline').textContent };
  })()`);
  console.log('click', JSON.stringify(click));

  await c.sleep(1200);
  const win = await c.evaluate(`({
    visible: !document.getElementById('winOverlay').hidden,
    sub: document.getElementById('winSub').textContent,
    stats: document.getElementById('winStats').textContent,
    tiles: document.querySelectorAll('#winHand .tile').length,
    done: window.__mj.state.done,
  })`);
  console.log('win', JSON.stringify(win));
  await c.screenshot('shot-win.png');

  // 下一局
  await c.evaluate("document.getElementById('winNext').click()");
  await c.sleep(400);
  console.log('afterNext', JSON.stringify(await c.evaluate(`({
    hidden: document.getElementById('winOverlay').hidden,
    hand: window.__mj.state.hand.length,
    round: window.__mj.state.roundNo,
  })`)));

  // 提示：H 键
  await c.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true }))");
  await c.sleep(200);
  console.log('hints', await c.evaluate("document.querySelectorAll('#hand .tile.hint').length"));

  // 悬停高亮：真实鼠标移动
  const box = await c.evaluate(`(() => { const r = document.querySelector('#hand .tile').getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await c.sleep(350);
  await c.screenshot('shot-hover.png');
  console.log('errors', JSON.stringify(c.logs));
} finally {
  await c.close();
}
