import { connect } from './cdp-lib.mjs';
const c = await connect({ port: 9374, profile: '.chrome-cdp34', url: 'http://127.0.0.1:8788/' });
await c.sleep(1100);
const sizes = [[1424,749],[1424,560],[1424,460],[1200,400],[980,340],[760,320],[860,380],[390,780],[430,880]];
for (const [w, h] of sizes) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await c.sleep(360);
  const r = await c.evaluate(`JSON.stringify({ over: document.documentElement.scrollHeight - document.documentElement.clientHeight, tile: Math.round(document.querySelector('.tile').getBoundingClientRect().width), handW: Math.round(document.getElementById('hand').getBoundingClientRect().width), wrapW: Math.round(document.querySelector('.hand-wrap').clientWidth) })`);
  console.log(`${w}x${h}`, r);
}
await c.send('Emulation.setDeviceMetricsOverride', { width: 980, height: 340, deviceScaleFactor: 1, mobile: false });
await c.sleep(350); await c.screenshot('shot-strip.png');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1424, height: 520, deviceScaleFactor: 1, mobile: false });
await c.sleep(350); await c.screenshot('shot-strip2.png');
console.log('errors', c.logs);
await c.close();
