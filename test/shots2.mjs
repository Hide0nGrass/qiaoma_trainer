/** 截图：打错状态（含「就这样打」+ AI）与历史面板 */
import { connect } from './cdp-lib.mjs';
import { writeFileSync } from 'node:fs';

const c = await connect({ port: 9342, profile: '.chrome-cdpA' });
try {
  for (let i = 0; i < 60; i++) {
    if (await c.evaluate('Boolean(window.__mj && window.__mj.state.hand.length)')) break;
    await c.sleep(150);
  }
  await c.evaluate(`(() => { document.getElementById('historyModal').hidden = true; })()`);

  const worstIdx = await c.evaluate(`(() => {
    const S = __mj.state;
    const cands = __mj.analyzeHand(S.hand);
    const worst = cands[cands.length - 1];
    return S.hand.indexOf(worst.tile);
  })()`);
  await c.evaluate(`document.querySelectorAll('#hand .tile')[${worstIdx}].click()`);
  await c.sleep(300);
  for (let i = 0; i < 50; i++) {
    const m = await c.evaluate("document.getElementById('coachMeta').textContent");
    if (!m.includes('组织语言') && !m.includes('正在想')) break;
    await c.sleep(200);
  }
  await c.sleep(300);
  let r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot-wrong.png', Buffer.from(r.data, 'base64'));
  console.log('wrong', await c.evaluate("document.getElementById('coachText').textContent.slice(0,60)"));

  // 移动端同一状态
  await c.send('Emulation.setDeviceMetricsOverride', {
    width: 430, height: 880, deviceScaleFactor: 2, mobile: true,
  });
  await c.sleep(500);
  r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot-wrong-mobile.png', Buffer.from(r.data, 'base64'));
  await c.send('Emulation.clearDeviceMetricsOverride', {});
  await c.sleep(300);

  // 造点历史，打开面板
  await c.evaluate('__mj.state.rec.attempts = 3; __mj.startRound(424242)');
  await c.sleep(200);
  await c.evaluate("document.getElementById('historyBtn').click()");
  await c.sleep(400);
  r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot-history.png', Buffer.from(r.data, 'base64'));
  console.log('errors', JSON.stringify(c.logs));
} finally {
  await c.close();
}
