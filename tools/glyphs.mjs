// Our own glyphs for Stargazer (no stock or firmware art). 200x200 box, white shapes with navy
// cut-outs, in the classic Jibo icon style. Used by make-icons.mjs (and the phase-1 mockups).
export const NAVY = '#1A2563';
const S = (w = 14) => `fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const star4 = (x, y, L, fill = '#fff') => { const w = L * 0.2; return `<path d="M${x} ${y - L} L${x + w} ${y - w} L${x + L} ${y} L${x + w} ${y + w} L${x} ${y + L} L${x - w} ${y + w} L${x - L} ${y} L${x - w} ${y - w} Z" fill="${fill}"/>`; };
const hex = (cx, cy, r) => { let d = ''; for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; d += `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)} `; } return `<path d="${d}Z" fill="#fff"/>`; };
export const glyphs = {
  telescope: `<g transform="rotate(-28 100 100)"><rect x="28" y="70" width="118" height="44" rx="10" fill="#fff"/><rect x="142" y="62" width="26" height="60" rx="8" fill="#fff"/><rect x="12" y="78" width="20" height="28" rx="5" fill="#fff"/><rect x="62" y="84" width="9" height="16" rx="3" fill="${NAVY}"/></g><path d="M96 122 L70 176 M100 122 L100 178 M104 122 L132 176" ${S(11)}/>${star4(160, 34, 16)}${star4(40, 40, 10)}`,
  hubble: `<g transform="rotate(-20 100 100)"><rect x="70" y="62" width="64" height="88" rx="12" fill="#fff"/><rect x="74" y="44" width="56" height="22" rx="6" fill="#fff"/><rect x="18" y="86" width="44" height="40" rx="4" fill="#fff"/><rect x="142" y="86" width="44" height="40" rx="4" fill="#fff"/><rect x="62" y="102" width="12" height="8" fill="#fff"/><rect x="132" y="102" width="12" height="8" fill="#fff"/><path d="M40 86 V126 M164 86 V126" stroke="${NAVY}" stroke-width="5"/><rect x="80" y="70" width="44" height="8" rx="3" fill="${NAVY}"/></g>`,
  webb: hex(100, 100, 25) + hex(100, 56, 25) + hex(100, 144, 25) + hex(62, 78, 25) + hex(138, 78, 25) + hex(62, 122, 25) + hex(138, 122, 25) + `<circle cx="100" cy="100" r="7" fill="${NAVY}"/>`,
  noirlab: `<path d="M14 176 L74 92 L102 126 L130 88 L186 176 Z" fill="#fff"/><path d="M114 88 A16 16 0 0 1 146 88 Z" fill="#fff"/><rect x="112" y="88" width="36" height="10" fill="#fff"/><path d="M74 92 L88 112 L60 112 Z" fill="${NAVY}" opacity=".35"/>${star4(60, 40, 14)}${star4(160, 34, 9)}`,
  kenburns: `<rect x="22" y="44" width="156" height="112" rx="12" ${S(12)}/><rect x="70" y="78" width="70" height="50" rx="6" fill="#fff"/><path d="M42 140 L70 120" ${S(10)}/><path d="M60 116 L72 119 L69 131" ${S(8)}/>`,
  iris: `<circle cx="100" cy="100" r="76" ${S(12)}/><circle cx="100" cy="100" r="34" fill="#fff"/><path d="M100 24 L120 70 M176 100 L130 120 M100 176 L80 130 M24 100 L70 80" ${S(9)}/>`,
  lookup: `<circle cx="100" cy="118" r="54" fill="#fff"/><path d="M68 40 L100 14 L132 40" ${S(14)}/>`,
  starfield: star4(100, 96, 56) + star4(158, 46, 20) + star4(48, 150, 18) + star4(156, 150, 12) + star4(44, 52, 10),
  speak: `<path d="M30 44 H170 Q180 44 180 54 V124 Q180 134 170 134 H86 L50 166 L56 134 H30 Q20 134 20 124 V54 Q20 44 30 44 Z" fill="#fff"/><path d="M52 78 H148 M52 104 H120" stroke="${NAVY}" stroke-width="10" stroke-linecap="round"/>`,
  sound: `<path d="M24 76 H58 L104 36 V164 L58 124 H24 Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/><path d="M128 72 Q146 100 128 128 M150 50 Q186 100 150 150" ${S(12)}/>`,
  caption: `<rect x="22" y="40" width="156" height="120" rx="14" ${S(12)}/><path d="M46 112 H124 M46 136 H98" ${S(12)}/>`,
  slideshow: `<rect x="22" y="40" width="156" height="120" rx="14" ${S(12)}/><path d="M84 72 L130 100 L84 128 Z" fill="#fff"/>`,
  layers: `<path d="M100 30 L176 70 L100 110 L24 70 Z" fill="#fff"/><path d="M24 102 L100 142 L176 102 M24 134 L100 174 L176 134" ${S(12)}/>`,
  gear: (() => { let t = ''; for (let i = 0; i < 8; i++) t += `<rect x="88" y="26" width="24" height="40" rx="7" fill="#fff" transform="rotate(${i * 45} 100 100)"/>`; return t + `<circle cx="100" cy="100" r="52" fill="#fff"/><circle cx="100" cy="100" r="22" fill="${NAVY}"/>`; })(),
  refresh: `<path d="M152 104 A52 52 0 1 1 136 64" ${S(17)}/><path d="M156 34 L150 82 L104 70 Z" fill="#fff"/>`,
  prev: `<path d="M122 40 L62 100 L122 160" ${S(24)}/>`,
  next: `<path d="M78 40 L138 100 L78 160" ${S(24)}/>`,
  check: `<path d="M48 104 L84 140 L154 64" ${S(24)}/>`,
  timer: `<circle cx="100" cy="108" r="64" ${S(13)}/><path d="M100 108 V70 M100 108 L128 124" ${S(12)}/><rect x="84" y="22" width="32" height="14" rx="6" fill="#fff"/>`,
  off: `<circle cx="100" cy="100" r="62" ${S(14)}/><path d="M56 144 L144 56" ${S(14)}/>`,
};
