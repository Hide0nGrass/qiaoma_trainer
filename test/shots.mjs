/** 出牌后等 AI 点评完成，截桌面图 + 移动端图 */
import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9337, profile: '.chrome-cdp5' });
try {
  for (let i = 0; i < 40; i++) {
    if (await c.evaluate('Boolean(window.__mj && window.__mj.state.hand.length)')) break;
    await c.sleep(150);
  }
  // 打一张最优的牌：打对会直接摸牌，不会触发自动 AI
  const bestIdx = await c.evaluate(`(() => {
    const S = __mj.state;
    const cands = __mj.analyzeHand(S.hand);
    return S.hand.indexOf(cands[0].tile);
  })()`);
  await c.evaluate(`document.querySelectorAll('#hand .tile')[${bestIdx}].click()`);
  await c.sleep(700);
  // 按 A 让 AI 讲逻辑（按需，不自动请求）
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a' });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' });
  for (let i = 0; i < 50; i++) {
    const meta = await c.evaluate("document.getElementById('coachMeta').textContent");
    if (/全文|本地分析|未连通|响应慢|已结束/.test(meta)) break;
    await c.sleep(200);
  }
  console.log('meta', await c.evaluate("document.getElementById('coachMeta').textContent"));
  console.log('text', await c.evaluate("document.getElementById('coachText').textContent"));

  await c.sleep(300);
  console.log('desktop', await c.screenshot('shot-desktop.png'));

  await c.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 880, deviceScaleFactor: 2, mobile: true });
  await c.sleep(400);
  console.log('mobile', await c.screenshot('shot-mobile.png'));
  await c.send('Emulation.clearDeviceMetricsOverride');
  console.log('errors', JSON.stringify(c.logs));
} finally {
  await c.close();
}
