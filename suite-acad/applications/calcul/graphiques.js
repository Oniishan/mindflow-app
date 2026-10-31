// Calcul — graphiques (rendu SVG)
export const TYPES_GRAPHIQUES = [
  ['colonnes', 'Histogramme', 'chart-column'], ['barres', 'Barres', 'chart-bar'], ['lignes', 'Courbes', 'chart-line'], ['aires', 'Aires', 'chart-area'],
  ['secteurs', 'Secteurs', 'chart-pie'], ['anneau', 'Anneau', 'circle-dashed'], ['nuage', 'Nuage de points', 'chart-scatter'],
];
export const PALETTE = ['#2456B0', '#E07B00', '#1E7444', '#B0261E', '#6B4FA3', '#0E7380', '#8A6D00', '#C2185B', '#5B6B82', '#3E8E41'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => { if (!isFinite(n)) return ''; const a = Math.abs(n); const t = a >= 1e6 ? (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M' : a >= 1e4 ? (n / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k' : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }); return t.replace(/ /g, ' '); };

/** Extrait catégories et séries d'une matrice de valeurs. */
export function donneesGraphique(m, { serieEnLignes = false } = {}) {
  if (serieEnLignes) m = m[0].map((_, j) => m.map(r => r[j]));
  if (!m.length || !m[0].length) return { categories: [], series: [] };
  const estTexte = v => typeof v === 'string' && v !== '';
  const entete = m[0].slice(1).some(estTexte) || (m[0].length === 1 && estTexte(m[0][0]));
  const colCat = m.slice(entete ? 1 : 0).some(r => estTexte(r[0])) || (m[0].length > 1 && entete && !estTexte(m[0][0]) && m[0][0] == null);
  const lignes = m.slice(entete ? 1 : 0);
  const debut = colCat ? 1 : 0;
  const categories = lignes.map((r, i) => colCat ? (r[0] == null ? '' : String(r[0])) : String(i + 1));
  const series = [];
  for (let j = debut; j < m[0].length; j++) series.push({ nom: entete ? String(m[0][j] ?? `Série ${j - debut + 1}`) : `Série ${j - debut + 1}`, valeurs: lignes.map(r => typeof r[j] === 'number' ? r[j] : (typeof r[j] === 'string' && r[j] !== '' && !isNaN(parseFloat(r[j].replace(',', '.'))) ? parseFloat(r[j].replace(',', '.')) : null)) });
  return { categories, series };
}

function graduations(min, max, n = 5) {
  if (min === max) { if (min === 0) max = 1; else if (min > 0) min = 0; else max = 0; }
  const brut = (max - min) / n; const p = Math.pow(10, Math.floor(Math.log10(brut))); const f = brut / p;
  const pas = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const a = Math.floor(min / pas) * pas, b = Math.ceil(max / pas) * pas;
  const t = []; for (let v = a; v <= b + pas / 2; v += pas) t.push(+v.toPrecision(12));
  return t;
}

export function rendreGraphique(g, d, l = 480, h = 300) {
  const { categories, series } = d;
  const titre = g.titre || '';
  const legende = g.legende || 'bas';
  const coul = i => (g.couleurs && g.couleurs[i]) || PALETTE[i % PALETTE.length];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${l} ${h}" width="${l}" height="${h}" font-family="Segoe UI, Arial, sans-serif" role="img" aria-label="${esc(titre || 'Graphique')}"><rect width="${l}" height="${h}" fill="#fff"/>`;
  let haut = 10;
  if (titre) { svg += `<text x="${l / 2}" y="24" text-anchor="middle" font-size="15" font-weight="600" fill="#1b1b1b">${esc(titre)}</text>`; haut = 38; }
  if (!series.length || !categories.length) return svg + `<text x="${l / 2}" y="${h / 2}" text-anchor="middle" font-size="13" fill="#888">Sélectionnez des données numériques</text></svg>`;
  const camembert = g.type === 'secteurs' || g.type === 'anneau';
  const elemsLegende = camembert ? categories.map((c, i) => [c, coul(i)]) : series.map((s, i) => [s.nom, coul(i)]);
  let bas = h - 10, droite = l - 10;
  if (legende === 'bas' && elemsLegende.length) bas -= 26;
  if (legende === 'droite' && elemsLegende.length) droite -= Math.min(160, 30 + Math.max(...elemsLegende.map(e => String(e[0]).length)) * 7);
  // légende
  if (legende === 'bas' && elemsLegende.length) {
    const larg = elemsLegende.map(e => 22 + String(e[0]).length * 6.6 + 12); const tot = larg.reduce((a, b) => a + b, 0);
    let x = Math.max(8, (l - tot) / 2);
    elemsLegende.forEach((e, i) => { svg += `<rect x="${x}" y="${h - 26}" width="12" height="12" rx="2" fill="${e[1]}"/><text x="${x + 17}" y="${h - 16}" font-size="12" fill="#333">${esc(e[0])}</text>`; x += larg[i]; });
  } else if (legende === 'droite' && elemsLegende.length) {
    elemsLegende.forEach((e, i) => { const y = haut + 10 + i * 20; svg += `<rect x="${droite + 12}" y="${y}" width="12" height="12" rx="2" fill="${e[1]}"/><text x="${droite + 29}" y="${y + 10}" font-size="12" fill="#333">${esc(String(e[0]).slice(0, 22))}</text>`; });
  }
  if (camembert) {
    const v = series[0].valeurs.map(x => Math.max(0, x || 0)); const tot = v.reduce((a, b) => a + b, 0) || 1;
    const cx = (droite + 10) / 2, cy = (haut + bas) / 2, r = Math.max(10, Math.min(droite - 20, bas - haut) / 2 - 6), ri = g.type === 'anneau' ? r * 0.55 : 0;
    let a = -Math.PI / 2;
    v.forEach((x, i) => {
      const da = x / tot * Math.PI * 2; if (!da) return;
      const a2 = a + da, gr = da > Math.PI ? 1 : 0;
      const p = (rr, ang) => [cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)];
      const [x1, y1] = p(r, a), [x2, y2] = p(r, a2);
      if (da >= Math.PI * 2 - 1e-9) svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${coul(i)}"/>${ri ? `<circle cx="${cx}" cy="${cy}" r="${ri}" fill="#fff"/>` : ''}`;
      else if (ri) { const [x3, y3] = p(ri, a2), [x4, y4] = p(ri, a); svg += `<path d="M${x1},${y1}A${r},${r} 0 ${gr} 1 ${x2},${y2}L${x3},${y3}A${ri},${ri} 0 ${gr} 0 ${x4},${y4}Z" fill="${coul(i)}" stroke="#fff" stroke-width="1.5"/>`; }
      else svg += `<path d="M${cx},${cy}L${x1},${y1}A${r},${r} 0 ${gr} 1 ${x2},${y2}Z" fill="${coul(i)}" stroke="#fff" stroke-width="1.5"/>`;
      if (g.etiquettes !== false && da > 0.25) { const [tx, ty] = p((r + ri) / 2 + (ri ? 0 : r * 0.1), a + da / 2); svg += `<text x="${tx}" y="${ty + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="#fff">${Math.round(x / tot * 100)} %</text>`; }
      a = a2;
    });
    return svg + '</svg>';
  }
  const horizontal = g.type === 'barres';
  const nuage = g.type === 'nuage';
  const toutes = series.flatMap(s => s.valeurs).filter(v => v != null);
  let min = Math.min(0, ...toutes), max = Math.max(0, ...toutes);
  if (nuage || g.type === 'lignes') { min = Math.min(...toutes); max = Math.max(...toutes); if (min > 0 && min < max * 0.5) min = 0; }
  const t = graduations(min, max); min = t[0]; max = t[t.length - 1];
  const largEt = Math.max(...t.map(v => fmt(v).length)) * 6.8 + 10;
  const gauche = horizontal ? 10 + Math.min(130, Math.max(...categories.map(c => c.length)) * 6.5) : 10 + largEt;
  const basZone = bas - (horizontal ? 18 : 22);
  const zl = droite - gauche, zh = basZone - haut;
  const echelle = v => horizontal ? gauche + (v - min) / (max - min) * zl : basZone - (v - min) / (max - min) * zh;
  // grille et axe des valeurs
  t.forEach(v => {
    const p = echelle(v);
    if (horizontal) svg += `<line x1="${p}" y1="${haut}" x2="${p}" y2="${basZone}" stroke="#e3e6eb"/><text x="${p}" y="${basZone + 14}" text-anchor="middle" font-size="11" fill="#666">${fmt(v)}</text>`;
    else svg += `<line x1="${gauche}" y1="${p}" x2="${droite}" y2="${p}" stroke="#e3e6eb"/><text x="${gauche - 6}" y="${p + 4}" text-anchor="end" font-size="11" fill="#666">${fmt(v)}</text>`;
  });
  const n = categories.length, ns = series.length;
  if (nuage) {
    const xs = categories.map(c => parseFloat(String(c).replace(',', '.'))).map((v, i) => isNaN(v) ? i + 1 : v);
    const tx = graduations(Math.min(...xs), Math.max(...xs)); const ex = v => gauche + (v - tx[0]) / (tx[tx.length - 1] - tx[0] || 1) * zl;
    tx.forEach(v => svg += `<text x="${ex(v)}" y="${basZone + 15}" text-anchor="middle" font-size="11" fill="#666">${fmt(v)}</text>`);
    series.forEach((s, k) => s.valeurs.forEach((v, i) => { if (v != null) svg += `<circle cx="${ex(xs[i])}" cy="${echelle(v)}" r="4" fill="${coul(k)}" fill-opacity=".85"/>`; }));
  } else {
    const pasCat = (horizontal ? zh : zl) / n;
    // étiquettes de catégories
    const saut = Math.ceil(n / Math.max(1, Math.floor((horizontal ? zh : zl) / (horizontal ? 16 : 54))));
    categories.forEach((c, i) => {
      if (i % saut) return;
      const p = (horizontal ? haut : gauche) + pasCat * (i + 0.5);
      if (horizontal) svg += `<text x="${gauche - 6}" y="${p + 4}" text-anchor="end" font-size="11" fill="#444">${esc(c.slice(0, 20))}</text>`;
      else svg += `<text x="${p}" y="${basZone + 16}" text-anchor="middle" font-size="11" fill="#444">${esc(c.slice(0, Math.max(4, Math.floor(pasCat * saut / 6.5))))}</text>`;
    });
    if (g.type === 'colonnes' || g.type === 'barres') {
      const lg = pasCat * 0.72 / ns;
      series.forEach((s, k) => s.valeurs.forEach((v, i) => {
        if (v == null) return;
        const p0 = echelle(0), p1 = echelle(v);
        const off = (horizontal ? haut : gauche) + pasCat * i + pasCat * 0.14 + lg * k;
        if (horizontal) svg += `<rect x="${Math.min(p0, p1)}" y="${off}" width="${Math.abs(p1 - p0)}" height="${Math.max(1, lg - 1)}" fill="${coul(k)}" rx="1.5"><title>${esc(s.nom)} · ${esc(categories[i])} : ${fmt(v)}</title></rect>`;
        else svg += `<rect x="${off}" y="${Math.min(p0, p1)}" width="${Math.max(1, lg - 1)}" height="${Math.abs(p1 - p0)}" fill="${coul(k)}" rx="1.5"><title>${esc(s.nom)} · ${esc(categories[i])} : ${fmt(v)}</title></rect>`;
        if (g.etiquettes && lg > 14) svg += horizontal ? `<text x="${Math.max(p0, p1) + 4}" y="${off + lg / 2 + 4}" font-size="10" fill="#333">${fmt(v)}</text>` : `<text x="${off + lg / 2}" y="${Math.min(p0, p1) - 4}" text-anchor="middle" font-size="10" fill="#333">${fmt(v)}</text>`;
      }));
    } else {
      series.forEach((s, k) => {
        const pts = s.valeurs.map((v, i) => v == null ? null : [gauche + pasCat * (i + 0.5), echelle(v)]).filter(Boolean);
        if (!pts.length) return;
        if (g.type === 'aires') svg += `<path d="M${pts[0][0]},${echelle(Math.max(0, min))}L${pts.map(p => p.join(',')).join('L')}L${pts[pts.length - 1][0]},${echelle(Math.max(0, min))}Z" fill="${coul(k)}" fill-opacity=".28"/>`;
        svg += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${coul(k)}" stroke-width="2.4" stroke-linejoin="round"/>`;
        pts.forEach(p => svg += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#fff" stroke="${coul(k)}" stroke-width="2"/>`);
        if (g.etiquettes) s.valeurs.forEach((v, i) => { if (v != null) svg += `<text x="${gauche + pasCat * (i + 0.5)}" y="${echelle(v) - 8}" text-anchor="middle" font-size="10" fill="#333">${fmt(v)}</text>`; });
      });
    }
  }
  svg += horizontal ? `<line x1="${echelle(0)}" y1="${haut}" x2="${echelle(0)}" y2="${basZone}" stroke="#888"/>` : `<line x1="${gauche}" y1="${echelle(Math.max(min, 0))}" x2="${droite}" y2="${echelle(Math.max(min, 0))}" stroke="#888"/>`;
  return svg + '</svg>';
}

export async function svgVersPng(svg, l, h) {
  const img = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = url; });
  const c = document.createElement('canvas'); c.width = l * 2; c.height = h * 2; const x = c.getContext('2d'); x.scale(2, 2); x.drawImage(img, 0, 0, l, h); URL.revokeObjectURL(url);
  const b = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await b.arrayBuffer());
}
