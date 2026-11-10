import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9391, profile: '.chrome-cdp51', url: 'http://127.0.0.1:8788/' });
await c.sleep(1200);

// 二四六 777 万 + 11 24 9 筒 + 34 8 条
const m = (n) => n - 1, p = (n) => 8 + n, s = (n) => 17 + n;
const hand = [m(2), m(4), m(6), m(7), m(7), m(7), p(1), p(1), p(2), p(4), p(9), s(3), s(4), s(8)];
const wall = [p(3), p(5), p(6), p(7), p(8), s(1), s(2), s(5), s(6), s(7), m(1), m(3), m(5), m(8), m(9)];

async function play(tile, shot, pressA) {
  await c.evaluate(`window.__mj.setHand(${JSON.stringify(hand)}, ${JSON.stringify(wall)}); 1`);
  await c.sleep(600);
  const idx = await c.evaluate(`window.__mj.state.hand.indexOf(${tile})`);
  await c.evaluate(`document.querySelector('#hand .tile[data-idx="${idx}"]').click(); 1`);
  await c.sleep(320);
  const info = await c.evaluate(`JSON.stringify({
    badge: document.getElementById('badge').textContent,
    cls: document.getElementById('badge').className,
    head: document.getElementById('headline').textContent,
    text: document.getElementById('coachText').textContent.slice(0, 90),
  })`);
  console.log(tile, info);
  if (pressA) {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a' });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' });
    await c.sleep(1500);
    console.log('  AI:', await c.evaluate(`document.getElementById('coachText').textContent.slice(0, 120)`));
  }
  await c.screenshot(shot);
}

console.log('--- 最优档 ---');
await play(p(9), 'shot-tier-best.png', true);
await c.evaluate("document.getElementById('winOverlay').hidden = true; 1");
await play(s(8), 'shot-tier-good.png', true);
console.log('errors', c.logs);
await c.close();
