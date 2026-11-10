/** 验证「按需 AI」：点击出牌不自动请求模型，按 A 才请求 */
import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9339, profile: '.chrome-cdp7' });
try {
  for (let i = 0; i < 40; i++) {
    if (await c.evaluate('Boolean(window.__mj && window.__mj.state.hand.length)')) break;
    await c.sleep(150);
  }

  const coachCalls = `(__mj.state.coachCalls || 0)`;
  console.log('before  coach calls', await c.evaluate(coachCalls));

  // 点最优的那张（打对不请求 AI）
  const bestIdx = await c.evaluate(`(() => {
    const a = __mj.analyzeHand(__mj.state.hand);
    return __mj.state.hand.findIndex((t) => t === a[0].tile);
  })()`);
  await c.evaluate(`document.querySelectorAll('#hand .tile')[${bestIdx}].click()`);
  await c.sleep(1400);
  console.log('after   coach calls', await c.evaluate(coachCalls));
  console.log('meta    ', await c.evaluate("document.getElementById('coachMeta').textContent"));
  console.log('askBtn  ', JSON.stringify({
    disabled: await c.evaluate("document.getElementById('askAi').disabled"),
    label: await c.evaluate("document.getElementById('askAi').textContent"),
  }));

  // 按 A
  const t0 = Date.now();
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a' });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' });
  let first = 0;
  for (let i = 0; i < 60; i++) {
    const meta = await c.evaluate("document.getElementById('coachMeta').textContent");
    if (!first && /AI 正在|…/.test(meta) === false && meta.includes('首字')) first = Date.now() - t0;
    if (/全文|未连通|响应慢/.test(meta)) { console.log('meta2   ', meta); break; }
    await c.sleep(120);
  }
  console.log('elapsed ', Date.now() - t0, 'ms');
  console.log('text    ', await c.evaluate("document.getElementById('coachText').textContent"));
  console.log('calls2  ', await c.evaluate(coachCalls));
  console.log('errors  ', JSON.stringify(c.logs));

  await c.sleep(300);
  console.log('shot    ', await c.screenshot('shot-coach.png'));
} finally {
  await c.close();
}
