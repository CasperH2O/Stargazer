// Our own glyphs for Stargazer (no stock or firmware art). 200x200 box, white shapes with navy
// cut-outs, in the classic Jibo icon style. Used by make-icons.mjs (and the phase-1 mockups).
export const NAVY = '#1A2563';
const S = (w = 14) => `fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const star4 = (x, y, L, fill = '#fff') => { const w = L * 0.2; return `<path d="M${x} ${y - L} L${x + w} ${y - w} L${x + L} ${y} L${x + w} ${y + w} L${x} ${y + L} L${x - w} ${y + w} L${x - L} ${y} L${x - w} ${y - w} Z" fill="${fill}"/>`; };
const hex = (cx, cy, r) => { let d = ''; for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; d += `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)} `; } return `<path d="${d}Z" fill="#fff"/>`; };
export const glyphs = {
  telescope: `<g transform="rotate(-28 100 100)"><rect x="28" y="70" width="118" height="44" rx="10" fill="#fff"/><rect x="142" y="62" width="26" height="60" rx="8" fill="#fff"/><rect x="12" y="78" width="20" height="28" rx="5" fill="#fff"/><rect x="62" y="84" width="9" height="16" rx="3" fill="${NAVY}"/></g><path d="M96 122 L70 176 M100 122 L100 178 M104 122 L132 176" ${S(11)}/>${star4(160, 34, 16)}${star4(40, 40, 10)}`,
  apod: `<circle cx="100" cy="100" r="44" fill="#fff"/><ellipse cx="100" cy="104" rx="84" ry="24" fill="none" stroke="#fff" stroke-width="11" transform="rotate(-18 100 104)"/><path d="M58 86 A44 44 0 0 1 142 86" fill="none" stroke="${NAVY}" stroke-width="7" opacity=".5"/>${star4(166, 40, 14)}`,
  hubble: `<g transform="rotate(-20 100 100)"><rect x="70" y="62" width="64" height="88" rx="12" fill="#fff"/><rect x="74" y="44" width="56" height="22" rx="6" fill="#fff"/><rect x="18" y="86" width="44" height="40" rx="4" fill="#fff"/><rect x="142" y="86" width="44" height="40" rx="4" fill="#fff"/><rect x="62" y="102" width="12" height="8" fill="#fff"/><rect x="132" y="102" width="12" height="8" fill="#fff"/><path d="M40 86 V126 M164 86 V126" stroke="${NAVY}" stroke-width="5"/><rect x="80" y="70" width="44" height="8" rx="3" fill="${NAVY}"/></g>`,
  webb: hex(100, 100, 25) + hex(100, 56, 25) + hex(100, 144, 25) + hex(62, 78, 25) + hex(138, 78, 25) + hex(62, 122, 25) + hex(138, 122, 25) + `<circle cx="100" cy="100" r="7" fill="${NAVY}"/>`,
  eso: `<path d="M40 128 A60 60 0 0 1 160 128 Z" fill="#fff"/><rect x="30" y="128" width="140" height="44" rx="6" fill="#fff"/><path d="M92 70 L108 70 L112 128 L88 128 Z" fill="${NAVY}"/><rect x="88" y="146" width="24" height="26" fill="${NAVY}"/>${star4(160, 40, 14)}${star4(48, 46, 9)}`,
  noirlab: `<path d="M14 176 L74 92 L102 126 L130 88 L186 176 Z" fill="#fff"/><path d="M114 88 A16 16 0 0 1 146 88 Z" fill="#fff"/><rect x="112" y="88" width="36" height="10" fill="#fff"/><path d="M74 92 L88 112 L60 112 Z" fill="${NAVY}" opacity=".35"/>${star4(60, 40, 14)}${star4(160, 34, 9)}`,
  iotd: `<rect x="24" y="40" width="152" height="120" rx="16" fill="#fff"/><path d="M40 146 L82 96 L110 128 L130 108 L160 146 Z" fill="${NAVY}"/><circle cx="138" cy="72" r="13" fill="${NAVY}"/>`,
  epic: `<circle cx="100" cy="100" r="74" fill="#fff"/><path d="M100 26 C66 60 66 140 100 174 M100 26 C134 60 134 140 100 174 M30 76 H170 M30 124 H170" fill="none" stroke="${NAVY}" stroke-width="7"/>`,
  efs: `<path d="M18 182 A150 150 0 0 1 182 182" fill="none" stroke="#fff" stroke-width="12"/><g transform="rotate(-30 104 84)"><rect x="84" y="66" width="40" height="36" rx="6" fill="#fff"/><rect x="34" y="72" width="44" height="24" rx="3" fill="#fff"/><rect x="130" y="72" width="44" height="24" rx="3" fill="#fff"/><path d="M56 72 V96 M152 72 V96" stroke="${NAVY}" stroke-width="5"/><circle cx="104" cy="112" r="9" fill="#fff"/></g>`,
  kenburns: `<rect x="22" y="44" width="156" height="112" rx="12" ${S(12)}/><rect x="70" y="78" width="70" height="50" rx="6" fill="#fff"/><path d="M42 140 L70 120" ${S(10)}/><path d="M60 116 L72 119 L69 131" ${S(8)}/>`,
  iris: `<circle cx="100" cy="100" r="76" ${S(12)}/><circle cx="100" cy="100" r="34" fill="#fff"/><path d="M100 24 L120 70 M176 100 L130 120 M100 176 L80 130 M24 100 L70 80" ${S(9)}/>`,
  lookup: `<circle cx="100" cy="118" r="54" fill="#fff"/><path d="M68 40 L100 14 L132 40" ${S(14)}/>`,
  starfield: star4(100, 96, 56) + star4(158, 46, 20) + star4(48, 150, 18) + star4(156, 150, 12) + star4(44, 52, 10),
  speak: `<path d="M30 44 H170 Q180 44 180 54 V124 Q180 134 170 134 H86 L50 166 L56 134 H30 Q20 134 20 124 V54 Q20 44 30 44 Z" fill="#fff"/><path d="M52 78 H148 M52 104 H120" stroke="${NAVY}" stroke-width="10" stroke-linecap="round"/>`,
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
