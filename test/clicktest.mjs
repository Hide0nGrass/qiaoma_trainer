/** 点一张牌，观察点评流式落字过程 */
import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9335, profile: '.chrome-cdp3' });
try {
  for (let i = 0; i < 40; i++) {
    if (await c.evaluate('Boolean(window.__mj && window.__mj.state.hand.length)')) break;
    await c.sleep(150);
  }
  console.log('visibility', await c.evaluate('document.visibilityState'));
  const t0 = Date.now();
  await c.evaluate("document.querySelector('#hand .tile').click()");
  await c.sleep(400);
  console.log('判定期 |', await c.evaluate("document.getElementById('coachMeta').textContent"));
  // 按 A 才请求模型
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a' });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' });
  for (let i = 0; i < 20; i++) {
    const s = await c.evaluate(`({
      t: Math.round(performance.now()),
      text: document.getElementById('coachText').textContent,
      meta: document.getElementById('coachMeta').textContent,
    })`);
    console.log(String(Date.now() - t0).padStart(5), 'ms |', s.meta.slice(0, 40), '|', s.text.slice(0, 50));
    await c.sleep(400);
  }
  console.log('errors', JSON.stringify(c.logs));
} finally {
  await c.close();
}
