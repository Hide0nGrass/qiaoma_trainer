// 分组开关：桌面开 / 桌面关 / 移动端
import { connect } from './cdp-lib.mjs';

const c = await connect({ port: 9356, profile: '.chrome-cdp21', url: 'http://127.0.0.1:8788/' });
await c.sleep(1300);

await c.evaluate("window.__mj.state.judged === 0; 1");
await c.screenshot('shot-groups-on.png');
console.log('on  ', await c.evaluate("document.getElementById('hand').classList.contains('grouped')"));

await c.evaluate("document.getElementById('groupSwitch').click(); 1");
await c.sleep(300);
await c.screenshot('shot-groups-off.png');
console.log('off ', await c.evaluate("document.getElementById('hand').classList.contains('grouped')"));
await c.evaluate("document.getElementById('groupSwitch').click(); 1");
await c.sleep(300);

await c.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 880, deviceScaleFactor: 2, mobile: true });
await c.sleep(500);
await c.screenshot('shot-groups-mobile.png');
console.log('errors', c.logs);
await c.close();
