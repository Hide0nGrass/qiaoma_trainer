import { connect } from './cdp-lib.mjs';
const c = await connect({ port: 9421, profile: '.chrome-cdp81', url: 'http://127.0.0.1:8788/' });
await c.sleep(1200);
await c.evaluate("document.getElementById('modeRead').click(); 1");
await c.sleep(900);
await c.screenshot('shot-quiz-1.png');
// 找一道安全题，答对，看理由
for (let i = 0; i < 8; i++) {
  const d = await c.evaluate('__mjRead().danger');
  if (!d) break;
  await c.evaluate("__mjAnswer('danger'); 1"); await c.sleep(180);
  await c.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true})); 1"); await c.sleep(280);
}
await c.evaluate("__mjAnswer('safe'); 1");
await c.sleep(300);
console.log('SAFE FB:', await c.evaluate("document.getElementById('rdFb').textContent.replace(/\\s+/g,' ')"));
await c.screenshot('shot-quiz-safe.png');
await c.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true})); 1"); await c.sleep(300);
for (let i = 0; i < 8; i++) {
  const d = await c.evaluate('__mjRead().danger');
  if (d) break;
  await c.evaluate("__mjAnswer('safe'); 1"); await c.sleep(180);
  await c.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true})); 1"); await c.sleep(280);
}
await c.evaluate("__mjAnswer('danger'); 1");
await c.sleep(300);
console.log('DANGER FB:', await c.evaluate("document.getElementById('rdFb').textContent.replace(/\\s+/g,' ')"));
await c.screenshot('shot-quiz-danger.png');
console.log('errors', c.logs);
await c.close();
