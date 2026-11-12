import { connect } from './cdp-lib.mjs';
const pass = [], fail = [];
const t = (name, cond, extra = '') => (cond ? pass : fail).push(name + (extra ? ' :: ' + extra : ''));

const c = await connect({ port: 9520, profile: '.chrome-cdp170', url: 'http://127.0.0.1:8788/' });
await c.sleep(1200);
await c.evaluate("document.getElementById('modeRead').click(); 1");
await c.sleep(1200);

t('默认不展开', await c.evaluate("document.getElementById('rdDangerPanel').hidden"));

await c.evaluate("document.getElementById('rdDanger').click(); 1");
await c.sleep(300);
const cells = await c.evaluate("document.querySelectorAll('#rdDangerList .danger-tile').length");
t('展开后列出 8 张', cells === 8, String(cells));
t('标签带名次和概率', await c.evaluate("document.querySelector('#rdDangerList .danger-pct').textContent.startsWith('#1')"));
t('打开后页面不滚动', (await c.evaluate('document.documentElement.scrollHeight - document.documentElement.clientHeight')) === 0);

await c.evaluate("document.querySelectorAll('#rdDangerList .danger-tile')[0].click(); 1");
await c.sleep(2600);
const why = await c.evaluate("document.getElementById('rdDangerWhy').textContent");
t('点牌后出现解释', /AI/.test(why) && why.length > 30, why.slice(0, 40));
t('解释里有名次或概率', /牌河估|第\s*\d+\s*危险|#1/.test(why));

await c.evaluate("document.getElementById('rdDanger').click(); 1");
await c.sleep(250);
t('再点收起', await c.evaluate("document.getElementById('rdDangerPanel').hidden"));
t('收起后真的不可见', (await c.evaluate("getComputedStyle(document.getElementById('rdDangerPanel')).display")) === 'none');

console.log('PASS', pass.length, pass);
if (fail.length) { console.log('FAIL', fail.length, fail); process.exitCode = 1; }
console.log('errors', c.logs);
await c.close();
