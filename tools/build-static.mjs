// 把仓库打成可以直接静态托管的 site/：
// public/* 提到根目录，引擎模块也放根目录，并把 `../engine.mjs` 这类引用改成 `./engine.mjs`。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 1) 静态资源
for (const f of fs.readdirSync(path.join(ROOT, 'public'))) {
  fs.copyFileSync(path.join(ROOT, 'public', f), path.join(OUT, f));
}

// 2) 共用模块
const MODULES = ['engine.mjs', 'opponent.mjs', 'read.mjs', 'prompts.mjs'];
for (const m of MODULES) fs.copyFileSync(path.join(ROOT, m), path.join(OUT, m));

// 3) 改写 public/*.js 里的 '../xxx.mjs' → './xxx.mjs'
const REWRITE = /from '\.\.\/(engine|opponent|read|prompts)\.mjs'/g;
for (const f of fs.readdirSync(OUT)) {
  if (!f.endsWith('.js') && !f.endsWith('.mjs')) continue;
  const p = path.join(OUT, f);
  const src = fs.readFileSync(p, 'utf8');
  const out = src.replace(REWRITE, "from './$1.mjs'");
  if (out !== src) fs.writeFileSync(p, out, 'utf8');
}

// 4) 让 GitHub Pages 不要跑 Jekyll
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const files = fs.readdirSync(OUT).sort();
console.log(`site/ 就绪：${files.length} 个文件`);
console.log(files.join('  '));
