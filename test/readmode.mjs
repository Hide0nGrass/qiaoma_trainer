// 摇铃「一局多题」验收：判分只看牌河推断，真手牌只在点炮/整局结束时揭晓。
import { connect } from './cdp-lib.mjs';
import { makeRound, readRound } from '../public/readmode.js';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);

/* ---------- 0. Node 侧：发牌与推断 ---------- */
let rounds = 0;
let tilesOk = true;
let countsOk = true;
for (let i = 0; i < 40; i++) {
  const r = makeRound(3000 + i * 97);
  if (!r) continue;
  rounds++;
  if (r.hand.length !== 13 || r.bag.length !== 12) tilesOk = false;
  // 他手上的 + 他打过的 + 我的，同一种牌不能超过 4 张
  const cnt = new Array(27).fill(0);
  for (const t of [...r.hand, ...r.frozen, ...r.discards]) cnt[t]++;
  if (cnt.some((n) => n > 4)) countsOk = false;
}
check('能造出局', rounds > 0, String(rounds));
check('手牌 13 张、牌串 12 张', tilesOk);
check('四种牌总数不超 4', countsOk);

// 推断：排名 1..27 各出现一次，概率之和为正
const sc = makeRound(3000);
const inf = readRound(sc, 120);
const ranks = [...inf.rank.values()].sort((a, b) => a - b);
check('排名覆盖 1..27', ranks.length === 27 && ranks.every((v, i) => v === i + 1), String(ranks.length));
const sumP = [...inf.p.values()].reduce((a, b) => a + b, 0);
check('概率之和归一为 1', Math.abs(sumP - 1) < 0.01, sumP.toFixed(3));

// 区分度：真听张在前 5 名的比例应当高于真安全牌（独立发牌后约 2 倍）
let hitTop = 0, nTop = 0, hitRest = 0, nRest = 0;
for (let i = 0; i < 30; i++) {
  const r = makeRound(5000 + i * 131);
  if (!r) continue;
  const rd = readRound(r, 120);
  for (const t of r.bag) {
    const top = rd.rank.get(t) <= 5;
    if (r.waits.includes(t)) { nTop++; if (top) hitTop++; } else { nRest++; if (top) hitRest++; }
  }
}
const lift = (hitTop / Math.max(1, nTop)) / Math.max(1e-9, hitRest / Math.max(1, nRest));
check('真听张更容易进前 5（lift > 1.1）', lift > 1.1, `lift=${lift.toFixed(2)} ${hitTop}/${nTop} vs ${hitRest}/${nRest}`);

/* ---------- 1. 浏览器侧 ---------- */
const c = await connect({ port: 9352, profile: '.chrome-cdp92', url: 'http://127.0.0.1:8788/' });
await c.sleep(1200);
await c.evaluate("document.getElementById('modeRead').click(); 1");
await c.sleep(1200);

const space = async () => {
  await c.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); 1");
  await c.sleep(300);
};
const snap = () => c.evaluate(`JSON.stringify({
  no: document.getElementById('rdNo').textContent,
  tiles: document.querySelectorAll('#quizTile .tile').length,
  faces: document.querySelectorAll('#oppHand .tile[data-tile]').length,
  myRiver: document.querySelectorAll('#rdMyRiver .tile').length,
  nextShown: !document.getElementById('nextQ').hidden,
  nextText: document.getElementById('nextQ').textContent,
  fb: document.getElementById('rdFb').hidden ? '' : document.getElementById('rdFb').textContent.trim(),
  state: __mjRead().state, qi: __mjRead().qi,
  danger: __mjRead().danger, modelDanger: __mjRead().modelDanger,
  rank: __mjRead().rank, p: __mjRead().p, result: __mjRead().result,
  river: __mjRead().scenario.discards.length,
})`);
const answer = async (v) => { await c.evaluate(`__mjAnswer('${v}'); 1`); await c.sleep(220); };

// 1. 开局
const s1 = JSON.parse(await snap());
check('只显示一张牌', s1.tiles === 1, String(s1.tiles));
check('不显示我的手牌', (await c.evaluate("document.querySelectorAll('#rdHand').length")) === 0);
check('他的牌是背面', s1.faces === 0, String(s1.faces));
check('牌河张数 = 他打出的张数', (await c.evaluate("document.querySelectorAll('#rdOppRiver .tile').length")) === s1.river);
check('牌河有「敲」标记', (await c.evaluate("document.querySelectorAll('#rdOppRiver .knock-sep').length")) === 1);
check('题号是本局', s1.no === '第 1 局', s1.no);
check('还在答题状态', s1.state === 'question');
check('牌河排名已算好', s1.rank >= 1 && s1.rank <= 27, String(s1.rank));

// 2. 跟着牌河推断答 → 停在反馈，按空格才进下一张
await answer(s1.modelDanger ? 'danger' : 'safe');
const s2 = JSON.parse(await snap());
check('跟着牌河答算对', s2.result === 'ok', s2.result);
check('答完停在反馈不自动跳', s2.state === 'revealed' && s2.qi === 1, `${s2.state}/${s2.qi}`);
check('给出「继续」按钮', s2.nextShown === true && /继续/.test(s2.nextText), s2.nextText);
check('反馈给的是牌河概率', /牌河估/.test(s2.fb), s2.fb.slice(0, 30));
check('答对后他的牌仍隐藏', s2.faces === 0, String(s2.faces));
await space();
const s3 = JSON.parse(await snap());
check('空格后进入下一张', s3.state === 'question' && s3.qi === 1, `${s3.state}/${s3.qi}`);
check('同一局继续', s3.no === '第 1 局', s3.no);

// 3. 牌河说安全、你答危险 → 保守（不是点炮）
let foundSafe = false;
for (let i = 0; i < 10 && !foundSafe; i++) {
  const st = JSON.parse(await snap());
  if (st.state !== 'question') break;
  if (!st.modelDanger) { foundSafe = true; break; }
  await answer('danger');
  await space();
}
if (foundSafe) {
  await answer('danger');
  const s4 = JSON.parse(await snap());
  check('牌河说不危险却扣下 → 保守', s4.result === 'conservative' && s4.state === 'revealed', `${s4.result}/${s4.state}`);
  check('保守时说明没点炮', /没点炮/.test(s4.fb), s4.fb.slice(0, 40));
  await space();
} else {
  check('牌河说不危险却扣下 → 保守', true, 'skip');
  check('保守时说明没点炮', true, 'skip');
}

// 4. 找一个种子：牌串里有「牌河说危险（前 5）+ 真值也是听张」的牌，答安全 → 点炮
//    排名受采样噪声影响，所以条件用浏览器里实际算出来的排名判断，不在 Node 侧写死
let dealSeed = 0;
let dealAt = -1;
for (let s = 1; s <= 40 && !dealSeed; s++) {
  await c.evaluate(`__mjReadStart(${s}); 1`);
  await c.sleep(700);
  const info = JSON.parse(await c.evaluate(`JSON.stringify({
    bag: __mjRead().scenario.bag,
    waits: __mjRead().scenario.waits,
    ranks: [...__mjRead().infer.rank.entries()],
  })`));
  const rm = new Map(info.ranks);
  // 第 5 名是「压线题」（答了不计分），点炮要用前 4 名
  const at = info.bag.findIndex((t) => info.waits.includes(t) && rm.get(t) <= 4);
  if (at >= 0) { dealSeed = s; dealAt = at; }
}
check('能找到可点炮的种子', dealSeed > 0, `seed=${dealSeed} at=${dealAt}`);

let hitDeal = false;
if (dealSeed) {
  // 已经在这一局里：先跟着牌河把前面的牌答完
  for (let i = 0; i < dealAt; i++) {
    const st = JSON.parse(await snap());
    if (st.state !== 'question') break;
    await answer(st.modelDanger ? 'danger' : 'safe');
    const after = JSON.parse(await snap());
    if (after.state === 'revealed') await space();
    else if (after.state !== 'question') break;
  }
  const st = JSON.parse(await snap());
  hitDeal = st.state === 'question' && st.modelDanger && st.danger;
}
check('轮到了那张可点炮的牌', hitDeal);
if (hitDeal) {
  await answer('safe');
  const s5 = JSON.parse(await snap());
  check('打了真听张 → 点炮', s5.state === 'over' && s5.result === 'deal', `${s5.state}/${s5.result}`);
  check('点炮后翻开他的牌', s5.faces === 13, String(s5.faces));
  check('点炮后按钮变「下一局」', s5.nextShown && /下一局/.test(s5.nextText), s5.nextText);
  check('点炮反馈揭晓真实听张', /等的其实是/.test(s5.fb) && /荣和/.test(s5.fb), s5.fb.slice(0, 46));
} else {
  check('打了真听张 → 点炮', true, 'skip');
  check('点炮后翻开他的牌', true, 'skip');
  check('点炮后按钮变「下一局」', true, 'skip');
  check('点炮反馈揭晓真实听张', true, 'skip');
}

// 4b. 走上限：一路跟着牌河答，撑到结束也应揭底
await c.evaluate(`__mjReadStart(${dealSeed || 1}); 1`);
await c.sleep(900);
for (let i = 0; i < 40; i++) {
  const st = JSON.parse(await snap());
  if (st.state === 'over') break;
  if (st.state === 'revealed') await space();
  else await answer(st.modelDanger ? 'danger' : 'safe');
}
const sEnd = JSON.parse(await snap());
check('本局能走到结束', sEnd.state === 'over', `${sEnd.state}/${sEnd.result}`);
check('结束时翻开他的牌', sEnd.faces === 13, String(sEnd.faces));
check('结束时揭晓真实听张', /等的其实是/.test(sEnd.fb), sEnd.fb.slice(-40));
await c.evaluate("document.getElementById('nextQ').click(); 1");
await c.sleep(900);

// 5. 下一局重新开始
const s6 = JSON.parse(await snap());
check('下一局从零开始', s6.qi === 0 && s6.myRiver === 0 && s6.state === 'question', `${s6.qi}/${s6.myRiver}/${s6.state}`);
check('下一局他又是暗牌', s6.faces === 0, String(s6.faces));

// 6. 键盘 1 能作答
await c.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true })); 1");
await c.sleep(250);
check('键盘 1 能作答', (await c.evaluate('__mjRead().state')) === 'revealed');

// 7. 切回拆搭，原局还在
await c.evaluate("document.getElementById('modeTrain').click(); 1");
await c.sleep(600);
const s7 = JSON.parse(await c.evaluate(`JSON.stringify({
  readHidden: document.getElementById('readArea').hidden,
  hand: document.querySelectorAll('#hand .tile').length,
})`));
check('切回拆搭后摇铃区隐藏', s7.readHidden === true);
check('拆搭手牌仍在', s7.hand === 14, String(s7.hand));

check('无控制台错误', c.logs.length === 0, JSON.stringify(c.logs.slice(0, 2)));

console.log(results.join('\n'));
console.log('PASS', results.filter((r) => r.startsWith('PASS')).length, '/', results.length);
await c.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
