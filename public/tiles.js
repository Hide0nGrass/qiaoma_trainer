/** 牌面 SVG 生成：万=汉字，筒=圆环，条=竹节（1条为鸟） */

const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const INK = '#1b2a45';
const RED = '#b3242d';
const BLUE = '#1d5f86';
const GREEN = '#1f7a52';
const GREEN_L = '#2f9c6b';
const DEEP = '#12513a';

const POS = {
  1: [[0.5, 0.5]],
  2: [[0.5, 0.27], [0.5, 0.73]],
  3: [[0.24, 0.2], [0.5, 0.5], [0.76, 0.8]],
  4: [[0.28, 0.27], [0.72, 0.27], [0.28, 0.73], [0.72, 0.73]],
  5: [[0.26, 0.23], [0.74, 0.23], [0.5, 0.5], [0.26, 0.77], [0.74, 0.77]],
  6: [[0.3, 0.18], [0.7, 0.18], [0.3, 0.5], [0.7, 0.5], [0.3, 0.82], [0.7, 0.82]],
  7: [[0.24, 0.16], [0.5, 0.16], [0.76, 0.16], [0.3, 0.55], [0.7, 0.55], [0.3, 0.85], [0.7, 0.85]],
  8: [[0.3, 0.14], [0.7, 0.14], [0.3, 0.38], [0.7, 0.38], [0.3, 0.62], [0.7, 0.62], [0.3, 0.86], [0.7, 0.86]],
  9: [[0.23, 0.17], [0.5, 0.17], [0.77, 0.17], [0.23, 0.5], [0.5, 0.5], [0.77, 0.5], [0.23, 0.83], [0.5, 0.83], [0.77, 0.83]],
};

const X = (u) => 7 + u * 52;
const Y = (v) => 6 + v * 78;
const f = (n) => Number(n).toFixed(1);

/** 筒：双环 */
function ring(cx, cy, r, color) {
  return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="#fffdf8" stroke="${color}" stroke-width="${f(r * 0.4)}"/>`
    + `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.36)}" fill="${color}"/>`;
}

/** 条：竹节（带节疤的细竹竿） */
function stick(cx, cy, h) {
  const w = 8.4;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const r = 2.6;
  return `<g>
    <rect x="${f(x)}" y="${f(y)}" width="${w}" height="${f(h)}" rx="${r}" fill="${GREEN}"/>
    <rect x="${f(x + 1.5)}" y="${f(y + 2.4)}" width="1.6" height="${f(h - 5)}" rx="0.8" fill="#ffffff" opacity="0.42"/>
    <rect x="${f(x)}" y="${f(cy - 0.9)}" width="${w}" height="1.8" fill="${DEEP}" opacity="0.8"/>
    <rect x="${f(x)}" y="${f(y + h * 0.2)}" width="${w}" height="1.1" fill="#ffffff" opacity="0.35"/>
    <rect x="${f(x)}" y="${f(y + h * 0.8 - 1.1)}" width="${w}" height="1.1" fill="#ffffff" opacity="0.35"/>
    <rect x="${f(x + 0.9)}" y="${f(y + 0.6)}" width="${f(w - 1.8)}" height="1.4" rx="0.7" fill="${GREEN_L}" opacity="0.9"/>
  </g>`;
}

/** 1 条：麻雀（敲麻里的一索） */
function bird() {
  return `<g>
    <path d="M30 62 L19 80 L27.5 76 L26 83 L35 67 Z" fill="${DEEP}"/>
    <path d="M30 60 L42 78 L34.5 74 L37 81 L30 67 Z" fill="${GREEN}"/>
    <ellipse cx="33" cy="47" rx="12.5" ry="17.5" fill="${GREEN}"/>
    <path d="M33 32 C43 34 48 44 45 55 C41 65 30 66 25 58 C20 49 24 34 33 32 Z" fill="${GREEN_L}" opacity="0.85"/>
    <path d="M30 39 C37 40 41 46 39.5 53 C37 60 29 59 27 52 C25 45 25 39 30 39 Z" fill="#9fe0bd" opacity="0.35"/>
    <circle cx="33" cy="25" r="9.6" fill="${GREEN}"/>
    <path d="M42 23.5 L51 26.5 L42 29.5 Z" fill="${RED}"/>
    <circle cx="36" cy="22.5" r="2.4" fill="#ffffff"/>
    <circle cx="36.4" cy="22.5" r="1.2" fill="${INK}"/>
    <path d="M29 16.5 L33 7.5 L37 16.5 Z" fill="${RED}"/>
    <path d="M27 74 L27 80 M27 80 L23.5 83 M27 80 L30.5 83" stroke="${RED}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M39 74 L39 80 M39 80 L35.5 83 M39 80 L42.5 83" stroke="${RED}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </g>`;
}

export function faceSVG(t) {
  const suit = (t / 9) | 0;
  const rank = (t % 9) + 1;
  const pos = POS[rank];

  if (suit === 0) {
    return `<svg viewBox="0 0 66 90" xml:space="preserve">
      <text x="33" y="40" text-anchor="middle" font-family="Songti SC, SimSun, serif" font-weight="700" font-size="38" fill="${INK}">${NUM[rank - 1]}</text>
      <text x="33" y="81" text-anchor="middle" font-family="Songti SC, SimSun, serif" font-weight="700" font-size="34" fill="${RED}">萬</text>
    </svg>`;
  }

  if (suit === 1) {
    const r = rank === 1 ? 16.5 : rank === 2 ? 13 : 9.6;
    const body = pos.map(([u, v], i) => {
      const c = rank === 5 && i === 2 ? RED : (rank % 2 === 1 && i === 0 ? BLUE : (i % 2 === 0 ? BLUE : GREEN));
      return ring(X(u), Y(v), r, c);
    }).join('');
    return `<svg viewBox="0 0 66 90">${body}</svg>`;
  }

  if (rank === 1) return `<svg viewBox="0 0 66 90"><g transform="translate(33,45) scale(1.12) translate(-33,-45)">${bird()}</g></svg>`;

  const h = rank === 8 ? 16 : rank === 2 ? 23 : rank <= 4 ? 30 : 23;
  const body = pos.map(([u, v]) => stick(X(u), Y(v), h)).join('');
  return `<svg viewBox="0 0 66 90">${body}</svg>`;
}
