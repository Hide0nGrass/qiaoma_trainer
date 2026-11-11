/** 摇铃回归：打出去的真听张必须触发荣和，不管牌河判没判到
 *  用法：CHROME_BIN=<msedge.exe> node test/deal.mjs（需要 8788 上已起服务） */
import { connect } from './cdp-lib.mjs';

const { evaluate, close, sleep, logs } = await connect({ port: 9337, profile: '.chrome-deal' });
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const state = () => evaluate(`(() => { const st = window.__mjRead(); return {
  state: st.state, result: st.result, missed: st.missedByModel, rank: st.rank,
  danger: st.danger, modelDanger: st.modelDanger, tile: st.dealtTile,
  fb: document.querySelector('.fb-local')?.textContent || '',
}; })()`);

try {
  await sleep(900);
  await evaluate(`document.querySelector('#modeRead').click()`);
  await sleep(1200);

  // 找一个「模型漏判」的题：这张确实是他的听张，但排名在 5 名之外
  let missSeed = null;
  for (let seed = 1; seed <= 120 && missSeed === null; seed++) {
    await evaluate(`window.__mjReadStart(${seed})`);
    await sleep(500);
    const st = await evaluate(`(() => { const s = window.__mjRead(); return { danger: s.danger, rank: s.rank, modelDanger: s.modelDanger }; })()`);
    if (st.danger && !st.modelDanger) missSeed = { seed, rank: st.rank };
  }
  check('找到模型漏判的题（真听张、排名 > 5）', !!missSeed, JSON.stringify(missSeed));

  if (missSeed) {
    check('漏判题的模型判断是「安全」', (await state()).modelDanger === false);
    await evaluate(`window.__mjAnswer('safe')`);
    await sleep(400);
    const s = await state();
    check('打出去后本局结束', s.state === 'over', JSON.stringify({ state: s.state, result: s.result }));
    check('结果是点炮', s.result === 'deal');
    check('标记为「牌河漏判」', s.missed === true);
    check('反馈里写明点炮/漏判', /点炮|漏判/.test(s.fb), s.fb.slice(0, 60));
    check('没有继续下一题（nextQ 变成「下一局」）',
      (await evaluate(`document.querySelector('#nextQ').textContent`)).includes('下一局'));
  }

  // 对照：模型判对、牌也安全时，打出去应该继续
  let okSeed = null;
  for (let seed = 200; seed <= 320 && okSeed === null; seed++) {
    await evaluate(`window.__mjReadStart(${seed})`);
    await sleep(500);
    const st = await evaluate(`(() => { const s = window.__mjRead(); return { danger: s.danger, modelDanger: s.modelDanger }; })()`);
    if (!st.danger && !st.modelDanger) okSeed = seed;
  }
  check('找到安全题的种子', !!okSeed, String(okSeed));
  if (okSeed) {
    await evaluate(`window.__mjAnswer('safe')`);
    await sleep(400);
    const s = await state();
    check('安全牌打出去不结束本局', s.state === 'revealed', s.state);
    check('结果仍记「对」', s.result === 'ok', s.result);
  }

  check('无 JS 报错', logs.length === 0, logs.join(' | '));
  console.log(`\n${pass} pass, ${fail} fail`);
} catch (e) {
  console.error('ERROR', e.message);
  console.error(logs.join('\n'));
  fail++;
} finally {
  await close();
  process.exit(fail ? 1 : 0);
}
