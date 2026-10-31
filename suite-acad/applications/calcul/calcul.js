// Calcul — tableur
import { $, $$, el, esc, ico, toast, dialogue, confirmer, demander, menu, fermerMenu, creerRuban, raccourcis, debounce, choisirCouleur, nomSansExtension } from './commun/ui.js';
import { creerDocument } from './commun/document.js';
import * as Fi from './commun/fichiers.js';
import { evaluer, compiler, decouper, ERR, Erreur, estErreur, colLettre, lettreCol, lirePlage, adresse, decalerFormule, ajusterFormule, renommerFeuilleDansFormule, LISTE_FONCTIONS, FONCTIONS, serieDate, Plage } from './formules.js';
import { formaterValeur, analyserSaisie, texteEdition, FORMATS, changerDecimales, estFormatDate } from './format.js';
import { nouveauClasseur, nouvelleFeuille, cle, deCle, etendue, COLS_MAX, LIGNES_MAX, LARGEUR_DEF, HAUTEUR_DEF, serialiser, deserialiser } from './modele.js';
import { ecrireXlsx, lireClasseur, ecrireOds, ecrireCSV } from './xlsx.js';
import { rendreGraphique, donneesGraphique, TYPES_GRAPHIQUES, svgVersPng } from './graphiques.js';
import { MODELES } from './modeles.js';

const zone = $('#zone-grille'), defile = $('#defile'), contenu = $('#contenu'), calque = $('#calque-cellules');
const EC = 24, EL = 46; // hauteur des en-têtes de colonnes, largeur des en-têtes de lignes
let C = nouveauClasseur();
const S = { r: 0, c: 0, r1: 0, c1: 0, r2: 0, c2: 0 }; // sélection
const V = { zoom: 1, nL: 1000, nC: 52, edition: null, copie: null, graphSel: null, montrerFormules: false };
const F = () => C.feuilles[C.active];

// ---------- Calcul ----------
const memo = new Map(); const enCours = new Set(); const etendues = new Map(); let volatiles = false;
function valeur(fi, r, c) {
  const f = C.feuilles[fi]; if (!f) return ERR.REF;
  const k = cle(r, c); const cel = f.cellules.get(k);
  if (!cel) return null;
  if (!cel.f) { const v = cel.v; if (typeof v === 'string' && /^#(N\/A|NOM\?|VALEUR!|REF!|DIV\/0!|NOMBRE!|NUL!)$/.test(v)) return Object.values(ERR).find(e => e.code === v) || v; return v ?? null; }
  const mk = fi * 2e10 + k;
  if (memo.has(mk)) return memo.get(mk);
  if (enCours.has(mk)) return ERR.CIRC;
  enCours.add(mk);
  const v = evaluer(cel.f, contexte(fi, r, c));
  enCours.delete(mk); memo.set(mk, v);
  return v;
}
function contexte(fi, r, c) {
  return {
    feuille: fi, ligne: r, colonne: c, valeur,
    etendue: f => { if (!etendues.has(f)) etendues.set(f, etendue(C.feuilles[f])); return etendues.get(f); },
    feuilleNommee: n => { const i = C.feuilles.findIndex(x => x.nom.toLowerCase() === String(n).toLowerCase()); return i < 0 ? null : i; },
    formater: (v, code) => formaterValeur(v, code).texte,
  };
}
function recalculer() {
  memo.clear(); etendues.clear(); enCours.clear();
  // évaluation dans l'ordre des lignes pour limiter la profondeur de récursion
  C.feuilles.forEach((f, fi) => { const ks = [...f.cellules.entries()].filter(([, c]) => c.f).map(([k]) => k).sort((a, b) => a - b); for (const k of ks) { const [r, c] = deCle(k); valeur(fi, r, c); } });
}
const val = (r, c) => valeur(C.active, r, c);

// ---------- Géométrie ----------
let posC = new Float64Array(1), posL = new Float64Array(1);
let lignesFiltrees = new Set();
const larg = c => (F().colMasquees.includes(c) ? 0 : (F().largeurs[c] ?? LARGEUR_DEF)) * V.zoom;
const haut = r => (F().ligMasquees.includes(r) || lignesFiltrees.has(r) ? 0 : (F().hauteurs[r] ?? HAUTEUR_DEF)) * V.zoom;
function calculerGeometrie() {
  const u = etendue(F());
  V.nL = Math.min(LIGNES_MAX, Math.max(V.nL, 1000, u.r2 + 200, S.r2 + 60));
  V.nC = Math.min(COLS_MAX, Math.max(V.nC, 52, u.c2 + 12, S.c2 + 12));
  calculerFiltre();
  posC = new Float64Array(V.nC + 1); for (let c = 0; c < V.nC; c++) posC[c + 1] = posC[c] + larg(c);
  posL = new Float64Array(V.nL + 1); for (let r = 0; r < V.nL; r++) posL[r + 1] = posL[r] + haut(r);
  contenu.style.width = posC[V.nC] + 'px'; contenu.style.height = posL[V.nL] + 'px';
}
const chercheIndex = (pos, n, v) => { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pos[m] <= v) lo = m; else hi = m - 1; } return lo; };
const ligneA = y => chercheIndex(posL, V.nL, y), colA = x => chercheIndex(posC, V.nC, x);
const figeH = () => posL[Math.min(F().figer.l, V.nL)], figeL = () => posC[Math.min(F().figer.c, V.nC)];
function fusionDe(r, c) { return F().fusions.find(m => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2); }
// Position à l'écran (repère du calque de vue) d'une cellule ou plage
function rectVue(r1, c1, r2, c2) {
  const fl = F().figer.l, fc = F().figer.c;
  const y = r => r < fl ? posL[r] : posL[r] - defile.scrollTop;
  const x = c => c < fc ? posC[c] : posC[c] - defile.scrollLeft;
  let top = y(r1), bas = y(r2 + 1) - (r2 + 1 > fl || r2 + 1 === fl ? 0 : 0);
  if (r2 + 1 > fl && r1 < fl) bas = posL[r2 + 1] - defile.scrollTop;
  let gauche = x(c1), droite = (c2 + 1 > fc && c1 < fc) ? posC[c2 + 1] - defile.scrollLeft : x(c2 + 1);
  if (r1 >= fl && top < figeH()) top = Math.max(top, figeH() - 0.01) === top ? top : top; // la plage passe sous les volets figés
  return { left: gauche, top, width: Math.max(0, droite - gauche), height: Math.max(0, bas - top) };
}
function celluleAuPoint(cx, cy) {
  const z = zone.getBoundingClientRect();
  let x = cx - z.left - EL, y = cy - z.top - EC;
  const xs = x < figeL() ? x : x + defile.scrollLeft, ys = y < figeH() ? y : y + defile.scrollTop;
  return { r: ligneA(Math.max(0, ys)), c: colA(Math.max(0, xs)), x, y };
}

// ---------- Style effectif (mise en forme conditionnelle) ----------
const cacheMFC = new Map();
function styleMFC(r, c, v) {
  let s = null;
  for (const m of F().mfc || []) {
    if (r < m.r1 || r > m.r2 || c < m.c1 || c > m.c2) continue;
    if (m.type === 'echelle' || m.type === 'barres') {
      if (typeof v !== 'number') continue;
      const k = JSON.stringify([C.active, m.r1, m.c1, m.r2, m.c2]);
      if (!cacheMFC.has(k)) { const l = []; const u = etendue(F()); for (let i = m.r1; i <= Math.min(m.r2, u.r2); i++) for (let j = m.c1; j <= Math.min(m.c2, u.c2); j++) { const x = val(i, j); if (typeof x === 'number') l.push(x); } cacheMFC.set(k, [Math.min(...l), Math.max(...l)]); }
      const [mn, mx] = cacheMFC.get(k); const t = mx > mn ? (v - mn) / (mx - mn) : 1;
      if (m.type === 'echelle') { const a = hexRgb(m.couleur1 || '#F8696B'), b = hexRgb(m.couleur2 || '#63BE7B'); s = { ...(s || {}), fond: `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(',')})` }; }
      else s = { ...(s || {}), barreDonnees: { t: Math.max(0.02, t), couleur: m.couleur || '#638EC6' } };
      continue;
    }
    let ok = false;
    const n = typeof v === 'number' ? v : null, num = x => { const y = parseFloat(String(x).replace(',', '.')); return isNaN(y) ? x : y; };
    const a = num(m.v1), b = num(m.v2);
    switch (m.op) {
      case 'sup': ok = n != null && typeof a === 'number' ? n > a : v != null && String(v) > String(a); break;
      case 'inf': ok = n != null && typeof a === 'number' ? n < a : false; break;
      case 'supeg': ok = n != null && n >= a; break;
      case 'infeg': ok = n != null && n <= a; break;
      case 'egal': ok = typeof a === 'number' ? n === a : v != null && String(v).toLowerCase() === String(a).toLowerCase(); break;
      case 'diff': ok = typeof a === 'number' ? n !== a : String(v ?? '').toLowerCase() !== String(a).toLowerCase(); break;
      case 'entre': ok = n != null && n >= Math.min(a, b) && n <= Math.max(a, b); break;
      case 'contient': ok = v != null && String(v).toLowerCase().includes(String(m.v1).toLowerCase()); break;
      case 'doublons': { if (v == null || v === '') break; let k = 0; const u = etendue(F()); for (let i = m.r1; i <= Math.min(m.r2, u.r2); i++) for (let j = m.c1; j <= Math.min(m.c2, u.c2); j++) if (val(i, j) === v) k++; ok = k > 1; break; }
    }
    if (ok) s = { ...(s || {}), ...m.style };
  }
  return s;
}
const hexRgb = h => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h) || [0, 'ff', 'ff', 'ff']; return [1, 2, 3].map(i => parseInt(m[i], 16)); };
const cssBord = b => b ? `${b.style === 'thick' ? 3 : b.style === 'medium' ? 2 : 1}px ${b.style === 'dashed' ? 'dashed' : b.style === 'dotted' ? 'dotted' : b.style === 'double' ? 'double' : 'solid'} ${b.couleur || '#000'}` : null;

// ---------- Rendu des cellules ----------
function htmlCellule(r, c, x, y) {
  const f = F(); const m = fusionDe(r, c);
  if (m && (m.r1 !== r || m.c1 !== c)) return '';
  let w = larg(c), h = haut(r);
  if (m) { w = posC[m.c2 + 1] - posC[m.c1]; h = posL[m.r2 + 1] - posL[m.r1]; }
  if (!w || !h) return '';
  const cel = f.cellules.get(cle(r, c));
  const v = cel ? (V.montrerFormules && cel.f ? cel.f : val(r, c)) : null;
  const sBase = cel?.s || null;
  const sm = f.mfc.length ? styleMFC(r, c, v) : null;
  const s = sm ? { ...(sBase || {}), ...sm } : sBase;
  let cls = 'c', st = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`, txt = '', extra = '';
  if (v != null) {
    const fm = formaterValeur(v, V.montrerFormules && cel?.f ? '@' : (s?.format || 'General'), Math.max(4, Math.floor(w / 7.2)));
    txt = fm.texte;
    if (fm.erreur) cls += ' erreur';
    else if (fm.nombre && !s?.alignH) cls += ' nombre';
    else if (fm.centre && !s?.alignH) cls += ' centre';
    if (fm.couleur) st += `color:${fm.couleur};`;
    // un nombre trop large s'affiche en ###
    if (fm.nombre && !s?.retour && txt.length * 7.2 * (s?.taille ? s.taille / 11 : 1) * V.zoom > w + 2) txt = '#'.repeat(Math.max(1, Math.floor(w / 8)));
  }
  if (s) {
    if (s.gras) st += 'font-weight:700;'; if (s.italique) st += 'font-style:italic;';
    const deco = [s.souligne && 'underline', s.barre && 'line-through'].filter(Boolean).join(' '); if (deco) st += `text-decoration:${deco};`;
    if (s.couleur && !/color:/.test(st.replace(/background-color/g, ''))) st += `color:${s.couleur};`;
    if (s.fond) st += `background:${s.fond};`;
    if (s.police) st += `font-family:"${s.police}",Calibri,Carlito,sans-serif;`;
    if (s.alignH) cls += ' ' + { gauche: 'ag', centre: 'ac', droite: 'ad', justifie: 'aj' }[s.alignH];
    if (s.alignV === 'haut') cls += ' vh'; else if (s.alignV === 'milieu') cls += ' vm'; else if (s.retour) cls += ' vb';
    if (s.retour) cls += ' retour';
    if (s.retrait) st += `padding-left:${4 + s.retrait * 9}px;`;
    if (s.bordures) { const b = s.bordures; if (b.h) st += `border-top:${cssBord(b.h)};`; if (b.b) st += `border-bottom:${cssBord(b.b)};`; if (b.g) st += `border-left:${cssBord(b.g)};`; if (b.d) st += `border-right:${cssBord(b.d)};`; }
    if (s.barreDonnees) extra += `<i class="barre-donnees" style="width:calc(${(s.barreDonnees.t * 100).toFixed(1)}% - 4px);background:${s.barreDonnees.couleur}"></i>`;
  }
  st += `font-size:${((s?.taille || 11) * 1.18 * V.zoom).toFixed(1)}px;`;
  // débordement du texte sur les cellules vides voisines
  if (typeof v === 'string' && !s?.retour && !m && txt && (!s?.alignH || s.alignH === 'gauche')) {
    const besoin = txt.length * 7 * (s?.taille ? s.taille / 11 : 1) * V.zoom + 8;
    if (besoin > w) { let k = c + 1, ww = w; while (ww < besoin && k < V.nC && k < c + 20 && !f.cellules.get(cle(r, k))?.v && !f.cellules.get(cle(r, k))?.f && !fusionDe(r, k)) { ww += larg(k); k++; } if (ww > w) { cls += ' debord'; st = st.replace(`width:${w}px`, `width:${ww}px`); if (!s?.fond) st += 'background:#fff;'; } }
  }
  if (cel?.n) extra += '<i class="note-coin"></i>';
  if (f.filtre && r === f.filtre.r1 && c >= f.filtre.c1 && c <= f.filtre.c2) { st += 'padding-right:22px;'; } if (f.filtre && r === f.filtre.r1 && c >= f.filtre.c1 && c <= f.filtre.c2) extra += `<span class="filtre-btn ${f.filtre.criteres?.[c] ? 'actif' : ''}" data-filtre="${c}">${ico(f.filtre.criteres?.[c] ? 'funnel' : 'chevron-down', 'p')}</span>`;
  if (r === S.r && c === S.c && validationDe(r, c)) extra += `<span class="liste-fleche" data-liste="1">${ico('chevron-down', 'p')}</span>`;
  return `<div class="${cls}" style="${st}" data-r="${r}" data-c="${c}"><span class="t">${esc(txt)}</span>${extra}</div>`;
}
let rendreDemande = false;
function rendre() { if (rendreDemande) return; rendreDemande = true; requestAnimationFrame(() => { rendreDemande = false; rendreMaintenant(); }); }
function rendreMaintenant() {
  const f = F(); cacheMFC.clear();
  const fl = Math.min(f.figer.l, V.nL), fc = Math.min(f.figer.c, V.nC);
  const st = defile.scrollTop, sl = defile.scrollLeft, H = defile.clientHeight, W = defile.clientWidth;
  // étendre la grille en approchant du bord
  if (st + H > posL[V.nL] - 300 && V.nL < LIGNES_MAX) { V.nL = Math.min(LIGNES_MAX, V.nL + 1000); calculerGeometrie(); }
  if (sl + W > posC[V.nC] - 300 && V.nC < COLS_MAX) { V.nC = Math.min(COLS_MAX, V.nC + 26); calculerGeometrie(); }
  const r0 = Math.max(fl, ligneA(st + figeH())), r1 = Math.min(V.nL - 1, ligneA(st + H) + 1);
  const c0 = Math.max(fc, colA(sl + figeL())), c1 = Math.min(V.nC - 1, colA(sl + W) + 1);
  zone.classList.toggle('sans-grille', f.quadrillage === false);
  // les cellules fusionnées qui commencent hors champ doivent être rendues
  const debutsFusion = new Set();
  for (const m of f.fusions) if (m.r2 >= r0 && m.r1 <= r1 && m.c2 >= c0 && m.c1 <= c1) debutsFusion.add(cle(m.r1, m.c1));
  let h = '';
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) h += htmlCellule(r, c, posC[c], posL[r]);
  for (const k of debutsFusion) { const [r, c] = deCle(k); if (r < r0 || c < c0) h += htmlCellule(r, c, posC[c], posL[r]); }
  // cellules débordantes situées à gauche du champ visible
  for (let r = r0; r <= r1; r++) for (let c = Math.max(fc, c0 - 6); c < c0; c++) { const x = f.cellules.get(cle(r, c)); if (x && typeof (x.f ? val(r, c) : x.v) === 'string') h += htmlCellule(r, c, posC[c], posL[r]); }
  calque.innerHTML = h;
  // volets figés
  const fh = $('#fige-haut'), fg = $('#fige-gauche'), fco = $('#fige-coin');
  const sbW = defile.offsetWidth - defile.clientWidth, sbH = defile.offsetHeight - defile.clientHeight;
  fh.classList.toggle('on', fl > 0); fg.classList.toggle('on', fc > 0); fco.classList.toggle('on', fl > 0 && fc > 0);
  if (fl > 0) { fh.style.height = figeH() + 'px'; fh.style.right = sbW + 'px'; let x = ''; for (let r = 0; r < fl; r++) for (let c = c0; c <= c1; c++) x += htmlCellule(r, c, posC[c], posL[r]); $('#fige-haut-int').innerHTML = x; $('#fige-haut-int').style.transform = `translateX(${-sl}px)`; }
  if (fc > 0) { fg.style.width = figeL() + 'px'; fg.style.bottom = sbH + 'px'; let x = ''; for (let r = r0; r <= r1; r++) for (let c = 0; c < fc; c++) x += htmlCellule(r, c, posC[c], posL[r]); $('#fige-gauche-int').innerHTML = x; $('#fige-gauche-int').style.transform = `translateY(${-st}px)`; }
  if (fl > 0 && fc > 0) { fco.style.width = figeL() + 'px'; fco.style.height = figeH() + 'px'; let x = ''; for (let r = 0; r < fl; r++) for (let c = 0; c < fc; c++) x += htmlCellule(r, c, posC[c], posL[r]); fco.innerHTML = x; }
  // en-têtes
  let ec = '';
  const enteteCol = c => { const w = larg(c); if (!w) return ''; const s = c >= S.c1 && c <= S.c2; const tout = s && S.r1 === 0 && S.r2 >= V.nL - 1; return `<div class="ec ${s ? 'sel' : ''} ${tout ? 'tout' : ''}" style="left:${(c < fc ? posC[c] : posC[c] - sl)}px;width:${w}px" data-col="${c}">${colLettre(c)}<span class="poignee-taille" data-tc="${c}"></span></div>`; };
  for (let c = 0; c < fc; c++) ec += enteteCol(c);
  for (let c = c0; c <= c1; c++) ec += enteteCol(c);
  $('#entetes-col').innerHTML = ec;
  let el2 = '';
  const enteteLig = r => { const hh = haut(r); if (!hh) return ''; const s = r >= S.r1 && r <= S.r2; const tout = s && S.c1 === 0 && S.c2 >= V.nC - 1; return `<div class="el ${s ? 'sel' : ''} ${tout ? 'tout' : ''}" style="top:${(r < fl ? posL[r] : posL[r] - st)}px;height:${hh}px" data-lig="${r}">${r + 1}<span class="poignee-taille" data-tl="${r}"></span></div>`; };
  for (let r = 0; r < fl; r++) el2 += enteteLig(r);
  for (let r = r0; r <= r1; r++) el2 += enteteLig(r);
  $('#entetes-lig').innerHTML = el2;
  rendreSelection(); rendreGraphiques();
}
function rendreSelection() {
  const p = rectVue(S.r1, S.c1, S.r2, S.c2);
  Object.assign($('#sel-plage').style, { left: p.left + 'px', top: p.top + 'px', width: p.width + 'px', height: p.height + 'px', display: (S.r1 === S.r2 && S.c1 === S.c2) ? 'none' : 'block' });
  const m = fusionDe(S.r, S.c);
  const a = m ? rectVue(m.r1, m.c1, m.r2, m.c2) : rectVue(S.r, S.c, S.r, S.c);
  Object.assign($('#sel-active').style, { left: a.left - 1 + 'px', top: a.top - 1 + 'px', width: a.width + 1 + 'px', height: a.height + 1 + 'px' });
  Object.assign($('#poignee').style, { left: p.left + p.width - 4 + 'px', top: p.top + p.height - 4 + 'px' });
  const cp = $('#sel-copie');
  if (V.copie && V.copie.feuille === C.active) { const q = rectVue(V.copie.r1, V.copie.c1, V.copie.r2, V.copie.c2); cp.classList.remove('masque'); Object.assign(cp.style, { left: q.left + 'px', top: q.top + 'px', width: q.width + 'px', height: q.height + 'px' }); }
  else cp.classList.add('masque');
  if (V.edition) placerEditeur();
}
defile.addEventListener('scroll', () => { rendre(); });
new ResizeObserver(() => rendre()).observe(zone);

// ---------- Graphiques ----------
function rendreGraphiques() {
  const z = $('#calque-graphiques'); const f = F();
  const existants = new Map($$('.graphique', z).map(e => [e.dataset.id, e]));
  for (const g of f.graphiques) {
    let e = existants.get(g.id); existants.delete(g.id);
    if (!e) { e = el(`<div class="graphique" data-id="${g.id}" tabindex="0" role="img"><div class="svg"></div><span class="redim"></span></div>`); z.appendChild(e); brancherGraphique(e); }
    Object.assign(e.style, { left: g.x * V.zoom + 'px', top: g.y * V.zoom + 'px', width: g.l * V.zoom + 'px', height: g.h * V.zoom + 'px' });
    e.classList.toggle('sel', V.graphSel === g.id);
    const fi = g.feuille ?? C.active;
    const m = []; for (let r = g.plage.r1; r <= g.plage.r2; r++) { const l = []; for (let c = g.plage.c1; c <= g.plage.c2; c++) l.push(valeur(fi, r, c)); m.push(l); }
    const svg = rendreGraphique(g, donneesGraphique(m, { serieEnLignes: g.serieEnLignes }), g.l, g.h);
    if (e.dataset.svg !== svg) { $('.svg', e).innerHTML = svg; e.dataset.svg = svg; e.setAttribute('aria-label', g.titre || 'Graphique'); }
  }
  existants.forEach(e => e.remove());
}
function brancherGraphique(e) {
  e.addEventListener('mousedown', ev => {
    ev.stopPropagation(); ev.preventDefault(); const g = F().graphiques.find(x => x.id === e.dataset.id); if (!g) return;
    selectionnerGraphique(g.id);
    const redim = ev.target.classList.contains('redim');
    const x0 = ev.clientX, y0 = ev.clientY, g0 = { ...g }; let bouge = false;
    const mv = m => { const dx = (m.clientX - x0) / V.zoom, dy = (m.clientY - y0) / V.zoom; if (!bouge && Math.abs(dx) + Math.abs(dy) > 3) { bouge = true; avant(); } if (!bouge) return; if (redim) { g.l = Math.max(160, g0.l + dx); g.h = Math.max(110, g0.h + dy); } else { g.x = Math.max(0, g0.x + dx); g.y = Math.max(0, g0.y + dy); } rendreGraphiques(); };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); if (bouge) modifie(); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
  e.addEventListener('dblclick', () => modifierGraphique());
  e.addEventListener('keydown', ev => { if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); selectionnerGraphique(e.dataset.id); supprimerGraphique(); } });
}
function selectionnerGraphique(id) { V.graphSel = id; ruban.contextuel('graphique', !!id); if (id) ruban.afficher('graphique'); rendreGraphiques(); if (id) $('#recepteur').focus(); }

// ---------- Sélection ----------
function selectionner(r, c, { etendre = false, r2, c2 } = {}) {
  r = Math.max(0, Math.min(LIGNES_MAX - 1, r)); c = Math.max(0, Math.min(COLS_MAX - 1, c));
  if (etendre) { S.r2x = r; S.c2x = c; S.r1 = Math.min(S.r, r); S.r2 = Math.max(S.r, r); S.c1 = Math.min(S.c, c); S.c2 = Math.max(S.c, c); }
  else { S.r = r; S.c = c; S.r1 = r; S.c1 = c; S.r2 = r2 ?? r; S.c2 = c2 ?? c; S.r2x = S.r2; S.c2x = S.c2; const m = fusionDe(r, c); if (m && r2 == null) { S.r1 = m.r1; S.c1 = m.c1; S.r2 = m.r2; S.c2 = m.c2; } }
  // étendre pour inclure entièrement les fusions
  for (let k = 0; k < 4; k++) for (const m of F().fusions) if (m.r2 >= S.r1 && m.r1 <= S.r2 && m.c2 >= S.c1 && m.c1 <= S.c2) { S.r1 = Math.min(S.r1, m.r1); S.c1 = Math.min(S.c1, m.c1); S.r2 = Math.max(S.r2, m.r2); S.c2 = Math.max(S.c2, m.c2); }
  if (S.r2 >= V.nL - 50 && S.r2 < LIGNES_MAX - 1 && !(S.r1 === 0 && S.r2 === LIGNES_MAX - 1)) calculerGeometrie();
  if (V.graphSel) selectionnerGraphique(null);
  majBarreFormule(); rendre(); majEtat(); majRubanEtat();
}
function rendreVisible(r, c) {
  const f = F(); const st = defile.scrollTop, sl = defile.scrollLeft;
  if (r >= f.figer.l) { const y = posL[r], h = posL[r + 1]; if (y < st + figeH()) defile.scrollTop = y - figeH(); else if (h > st + defile.clientHeight) defile.scrollTop = h - defile.clientHeight; }
  if (c >= f.figer.c) { const x = posC[c], w = posC[c + 1]; if (x < sl + figeL()) defile.scrollLeft = x - figeL(); else if (w > sl + defile.clientWidth) defile.scrollLeft = w - defile.clientWidth; }
}
const plageSel = () => ({ r1: S.r1, c1: S.c1, r2: Math.min(S.r2, Math.max(etendue(F()).r2, S.r1)), c2: Math.min(S.c2, Math.max(etendue(F()).c2, S.c1)) });
const texteAdresse = () => (S.r1 === S.r2 && S.c1 === S.c2) || (fusionDe(S.r, S.c) && (() => { const m = fusionDe(S.r, S.c); return m.r1 === S.r1 && m.r2 === S.r2 && m.c1 === S.c1 && m.c2 === S.c2; })()) ? adresse(S.r, S.c) : `${adresse(S.r1, S.c1)}:${adresse(S.r2, S.c2)}`;
function majBarreFormule() {
  $('#zone-nom').value = texteAdresse();
  if (V.edition) return;
  const cel = F().cellules.get(cle(S.r, S.c));
  $('#saisie-formule').value = cel ? (cel.f || texteEdition(cel.v, cel.s?.format)) : '';
}

// ---------- Souris ----------
let glisse = null;
zone.addEventListener('mousedown', e => {
  if (e.button !== 0 && e.button !== 2) return;
  const t = e.target;
  if (t.closest('.editeur') || t.closest('.aide-fonction')) return;
  if (t.closest('.graphique')) return;
  const tc = t.dataset.tc, tl = t.dataset.tl;
  if (tc !== undefined || tl !== undefined) { e.preventDefault(); redimensionner(e, tc !== undefined ? 'c' : 'l', +(tc ?? tl)); return; }
  if (t.closest('.filtre-btn')) { e.preventDefault(); e.stopPropagation(); ouvrirFiltre(+t.closest('.filtre-btn').dataset.filtre, t.closest('.filtre-btn')); return; }
  if (t.closest('.liste-fleche')) { e.preventDefault(); ouvrirListeValidation(); return; }
  if (t.id === 'poignee') { e.preventDefault(); recopieSouris(e); return; }
  e.preventDefault();
  if (V.edition && V.edition.texte.startsWith('=') && pointPossible() && e.button === 0) { pointerReference(e); return; }
  if (V.edition) validerEdition();
  if (e.button === 2) { const p = celluleAuPoint(e.clientX, e.clientY); if (!(p.r >= S.r1 && p.r <= S.r2 && p.c >= S.c1 && p.c <= S.c2) && !t.closest('.ec,.el')) selectionner(p.r, p.c); return; }
  $('#recepteur').focus({ preventScroll: true });
  const ecol = t.closest('.ec'), elig = t.closest('.el');
  if (t.closest('#coin')) { selectionner(0, 0, { r2: LIGNES_MAX - 1, c2: COLS_MAX - 1 }); return; }
  if (ecol) { const c = +ecol.dataset.col; if (e.shiftKey) { S.c1 = Math.min(S.c, c); S.c2 = Math.max(S.c, c); S.r1 = 0; S.r2 = LIGNES_MAX - 1; rendre(); majBarreFormule(); majEtat(); } else selectionner(0, c, { r2: LIGNES_MAX - 1, c2: c }); glisse = { type: 'col', debut: c }; }
  else if (elig) { const r = +elig.dataset.lig; if (e.shiftKey) { S.r1 = Math.min(S.r, r); S.r2 = Math.max(S.r, r); S.c1 = 0; S.c2 = COLS_MAX - 1; rendre(); majBarreFormule(); majEtat(); } else selectionner(r, 0, { r2: r, c2: COLS_MAX - 1 }); glisse = { type: 'lig', debut: r }; }
  else { const p = celluleAuPoint(e.clientX, e.clientY); if (e.shiftKey) selectionner(p.r, p.c, { etendre: true }); else selectionner(p.r, p.c); glisse = { type: 'cel' }; }
  const mv = ev => {
    if (!glisse) return;
    const p = celluleAuPoint(ev.clientX, ev.clientY);
    if (glisse.type === 'cel') { if (p.r !== S.r2x || p.c !== S.c2x) selectionner(p.r, p.c, { etendre: true }); }
    else if (glisse.type === 'col') { S.c1 = Math.min(glisse.debut, p.c); S.c2 = Math.max(glisse.debut, p.c); rendre(); majBarreFormule(); majEtat(); }
    else { S.r1 = Math.min(glisse.debut, p.r); S.r2 = Math.max(glisse.debut, p.r); rendre(); majBarreFormule(); majEtat(); }
    defilementAuto(ev);
  };
  const up = () => { glisse = null; removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
  addEventListener('mousemove', mv); addEventListener('mouseup', up);
});
function defilementAuto(ev) {
  const z = defile.getBoundingClientRect();
  if (ev.clientY > z.bottom - 10) defile.scrollTop += 22; else if (ev.clientY < z.top + 4) defile.scrollTop -= 22;
  if (ev.clientX > z.right - 10) defile.scrollLeft += 40; else if (ev.clientX < z.left + 4) defile.scrollLeft -= 40;
}
zone.addEventListener('dblclick', e => {
  if (e.target.dataset.tc !== undefined) { ajusterLargeur(+e.target.dataset.tc); return; }
  if (e.target.dataset.tl !== undefined) { ajusterHauteur(+e.target.dataset.tl); return; }
  if (e.target.closest('.ec,.el,#coin,.graphique')) return;
  const p = celluleAuPoint(e.clientX, e.clientY);
  if (p.r === S.r && p.c === S.c) commencerEdition({ garder: true });
});
zone.addEventListener('contextmenu', e => {
  if (e.target.closest('.editeur')) return;
  e.preventDefault();
  if (e.target.closest('.graphique')) { menu([{ label: 'Modifier le graphique…', ico: 'pencil', faire: modifierGraphique }, { label: 'Supprimer le graphique', ico: 'trash-2', danger: true, faire: supprimerGraphique }], e.clientX, e.clientY); return; }
  const surCol = e.target.closest('.ec'), surLig = e.target.closest('.el');
  menu([
    { label: 'Couper', ico: 'scissors', raccourci: 'Ctrl+X', faire: () => copier(true) },
    { label: 'Copier', ico: 'copy', raccourci: 'Ctrl+C', faire: () => copier(false) },
    { label: 'Coller', ico: 'clipboard-paste', raccourci: 'Ctrl+V', faire: () => collerDepuisPressePapiers() },
    { label: 'Collage spécial…', ico: 'clipboard-list', faire: collageSpecial },
    '-',
    surCol ? { label: 'Insérer une colonne', faire: () => inserer('c', S.c1, S.c2 - S.c1 + 1) } : surLig ? { label: 'Insérer une ligne', faire: () => inserer('r', S.r1, S.r2 - S.r1 + 1) } : { label: 'Insérer…', faire: () => dialogueInserer() },
    surCol ? { label: 'Supprimer la colonne', faire: () => supprimer('c', S.c1, S.c2 - S.c1 + 1) } : surLig ? { label: 'Supprimer la ligne', faire: () => supprimer('r', S.r1, S.r2 - S.r1 + 1) } : { label: 'Supprimer…', faire: () => dialogueSupprimer() },
    { label: 'Effacer le contenu', ico: 'eraser', raccourci: 'Suppr', faire: () => effacer('contenu') },
    surCol ? { label: 'Masquer', faire: () => masquer('c') } : surLig ? { label: 'Masquer', faire: () => masquer('r') } : null,
    surCol || surLig ? { label: 'Afficher', faire: () => afficherMasques(surCol ? 'c' : 'r') } : null,
    surCol ? { label: 'Largeur de colonne…', faire: () => dialogueTaille('c') } : surLig ? { label: 'Hauteur de ligne…', faire: () => dialogueTaille('r') } : null,
    '-',
    { label: 'Trier de A à Z', ico: 'arrow-down-a-z', faire: () => trier([{ col: S.c, ordre: 1 }]) },
    { label: 'Trier de Z à A', ico: 'arrow-down-z-a', faire: () => trier([{ col: S.c, ordre: -1 }]) },
    '-',
    { label: F().cellules.get(cle(S.r, S.c))?.n ? 'Modifier la note' : 'Insérer une note', ico: 'sticky-note', faire: noteCellule },
    { label: 'Format de cellule…', ico: 'settings-2', raccourci: 'Ctrl+1', faire: dialogueFormat },
    { label: 'Lien hypertexte…', ico: 'link', faire: insererLien },
  ], e.clientX, e.clientY);
});
// Notes au survol
zone.addEventListener('mousemove', e => {
  const ib = $('#infobulle-note');
  if (glisse || V.edition) { ib.classList.add('masque'); return; }
  const d = e.target.closest('.c'); if (!d) { ib.classList.add('masque'); return; }
  const cel = F().cellules.get(cle(+d.dataset.r, +d.dataset.c));
  if (!cel?.n) { ib.classList.add('masque'); return; }
  const z = zone.getBoundingClientRect(), r = d.getBoundingClientRect();
  ib.textContent = cel.n; ib.classList.remove('masque'); ib.style.left = (r.right - z.left + 6) + 'px'; ib.style.top = (r.top - z.top) + 'px';
});

function redimensionner(e, axe, i) {
  const x0 = axe === 'c' ? e.clientX : e.clientY; const t0 = axe === 'c' ? (F().largeurs[i] ?? LARGEUR_DEF) : (F().hauteurs[i] ?? HAUTEUR_DEF);
  const cibles = axe === 'c' && i >= S.c1 && i <= S.c2 && S.r1 === 0 && S.r2 >= LIGNES_MAX - 1 ? range(S.c1, S.c2) : axe === 'l' && i >= S.r1 && i <= S.r2 && S.c1 === 0 && S.c2 >= COLS_MAX - 1 ? range(S.r1, S.r2) : [i];
  avant();
  const mv = m => { const v = Math.max(axe === 'c' ? 8 : 6, Math.round(t0 + ((axe === 'c' ? m.clientX : m.clientY) - x0) / V.zoom)); cibles.forEach(k => { if (axe === 'c') F().largeurs[k] = v; else F().hauteurs[k] = v; }); calculerGeometrie(); rendre(); };
  const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); modifie(); };
  addEventListener('mousemove', mv); addEventListener('mouseup', up);
}
const range = (a, b) => { const l = []; for (let i = a; i <= b; i++) l.push(i); return l; };
function mesurerTexte(t, s) { const cv = mesurerTexte.c || (mesurerTexte.c = document.createElement('canvas').getContext('2d')); cv.font = `${s?.gras ? 'bold ' : ''}${s?.italique ? 'italic ' : ''}${((s?.taille || 11) * 1.18).toFixed(1)}px ${s?.police ? `"${s.police}",` : ''}Calibri,Carlito,sans-serif`; return cv.measureText(t).width; }
function ajusterLargeur(c, sansHist) {
  const f = F(); const u = etendue(f); let m = 20;
  for (let r = 0; r <= u.r2; r++) { const cel = f.cellules.get(cle(r, c)); if (!cel) continue; const v = val(r, c); if (v == null) continue; const t = formaterValeur(v, cel.s?.format || 'General', 30).texte; m = Math.max(m, mesurerTexte(t, cel.s) + 14); }
  if (!sansHist) avant(); f.largeurs[c] = Math.min(600, Math.ceil(m)); calculerGeometrie(); rendre(); modifie();
}
function ajusterHauteur(r) {
  const f = F(); let m = HAUTEUR_DEF; const u = etendue(f);
  for (let c = 0; c <= u.c2; c++) { const cel = f.cellules.get(cle(r, c)); if (!cel) continue; const lignes = String(formaterValeur(val(r, c), cel.s?.format).texte).split('\n').length; const t = (cel.s?.taille || 11) * 1.18 * 1.25; let n = lignes; if (cel.s?.retour) { const w = larg(c) / V.zoom - 8; n = Math.max(lignes, Math.ceil(mesurerTexte(String(val(r, c) ?? ''), cel.s) / Math.max(10, w))); } m = Math.max(m, Math.ceil(n * t + 6)); }
  avant(); if (m === HAUTEUR_DEF) delete f.hauteurs[r]; else f.hauteurs[r] = m; calculerGeometrie(); rendre(); modifie();
}

// ---------- Historique ----------
const pile = [], futur = [];
function etat() { return JSON.stringify({ c: serialiser(C), s: { ...S } }); }
function avant() { const e = etat(); if (pile[pile.length - 1] !== e) pile.push(e); if (pile.length > 80) pile.shift(); futur.length = 0; }
function restaurer(e) { const o = JSON.parse(e); C = deserialiser(o.c); Object.assign(S, o.s); toutRecalculer(); }
function annuler() { if (V.edition) { annulerEdition(); return; } if (!pile.length) return; futur.push(etat()); restaurer(pile.pop()); doc.marquerModifie(); }
function retablir() { if (!futur.length) return; pile.push(etat()); restaurer(futur.pop()); doc.marquerModifie(); }
function modifie() { doc.marquerModifie(); }
function toutRecalculer() { recalculer(); calculerGeometrie(); rendreOnglets(); rendre(); majBarreFormule(); majEtat(); majRubanEtat(); }

// ---------- Écriture de cellules ----------
function ecrire(r, c, saisie, { fi = C.active } = {}) {
  const f = C.feuilles[fi]; const k = cle(r, c); const ancien = f.cellules.get(k);
  const a = analyserSaisie(saisie);
  const cel = { ...(ancien || {}) }; delete cel.v; delete cel.f;
  if (a.formule) {
    let fo = a.formule;
    // compléter les parenthèses manquantes, majuscules des fonctions
    const ouv = (fo.match(/\(/g) || []).length - (fo.match(/\)/g) || []).length; if (ouv > 0 && !/"[^"]*$/.test(fo)) fo += ')'.repeat(ouv);
    try { fo = '=' + decouper(fo.slice(1)).map(t => t.type === 'fn' ? t.v.toUpperCase() : t.type === 'ref' ? t.v.toUpperCase().replace(/^(.*!)/, m => t.feuille ? (/^[A-Za-zÀ-ÿ_][\wÀ-ÿ.]*$/.test(t.feuille) ? t.feuille : `'${t.feuille.replace(/'/g, "''")}'`) + '!' : m) : (t.brut ?? t.v)).join(''); } catch { }
    cel.f = fo;
  } else if (a.valeur != null) cel.v = a.valeur;
  if (a.format && !(ancien?.s?.format && ancien.s.format !== 'General' && !a.texteForce && estFormatDate(ancien.s.format) === estFormatDate(a.format))) cel.s = { ...(cel.s || {}), format: a.format };
  if (a.texteForce) cel.s = { ...(cel.s || {}), format: cel.s?.format || '@' };
  if (cel.v === undefined && !cel.f && !cel.s && !cel.n) f.cellules.delete(k); else f.cellules.set(k, cel);
}
function definirCellule(f, r, c, cel) { const k = cle(r, c); if (!cel || (cel.v == null && !cel.f && !cel.s && !cel.n)) f.cellules.delete(k); else f.cellules.set(k, cel); }

// ---------- Édition ----------
const editeur = $('#editeur'), edTexte = $('#editeur-texte'), barre = $('#saisie-formule');
function commencerEdition({ garder = false, texte = null, depuisBarre = false } = {}) {
  if (F().protegee) { toast('La feuille est protégée.'); return; }
  const cel = F().cellules.get(cle(S.r, S.c));
  const init = texte != null ? texte : (garder ? (cel ? (cel.f || texteEdition(cel.v, cel.s?.format)) : '') : '');
  V.edition = { r: S.r, c: S.c, texte: init, depuisBarre };
  edTexte.value = init; barre.value = init;
  editeur.classList.remove('masque');
  const s = cel?.s;
  edTexte.style.fontWeight = s?.gras ? '700' : ''; edTexte.style.fontStyle = s?.italique ? 'italic' : '';
  edTexte.style.fontSize = ((s?.taille || 11) * 1.18 * V.zoom) + 'px';
  edTexte.style.textAlign = s?.alignH === 'droite' ? 'right' : s?.alignH === 'centre' ? 'center' : '';
  placerEditeur();
  if (depuisBarre) barre.focus(); else { edTexte.focus(); edTexte.setSelectionRange(edTexte.value.length, edTexte.value.length); }
  majAideFonction();
}
function placerEditeur() {
  const e = V.edition; if (!e) return;
  const m = fusionDe(e.r, e.c); const p = m ? rectVue(m.r1, m.c1, m.r2, m.c2) : rectVue(e.r, e.c, e.r, e.c);
  const besoin = Math.max(p.width, mesurerTexte(edTexte.value || ' ', F().cellules.get(cle(e.r, e.c))?.s) * V.zoom + 20);
  const lignes = (edTexte.value.match(/\n/g) || []).length + 1;
  Object.assign(editeur.style, { left: EL + p.left + 'px', top: EC + p.top + 'px', width: Math.min(besoin, zone.clientWidth - EL - p.left - 4) + 'px', height: Math.max(p.height, lignes * 18 * V.zoom + 6) + 'px' });
  majRefsFormule();
}
function validerEdition(dir = 'bas') {
  const e = V.edition; if (!e) return;
  const t = e.texte;
  // validation des données
  const vd = validationDe(e.r, e.c);
  if (vd && t !== '' && !vd.liste.some(x => x.toLowerCase() === t.trim().toLowerCase())) {
    toast(`La valeur « ${t} » n'est pas autorisée dans cette cellule. Choisissez une valeur de la liste.`, 'erreur');
    edTexte.focus(); return false;
  }
  avant();
  const cibles = e.multiple ? null : null; void cibles;
  if (e.remplirSelection && (S.r1 !== S.r2 || S.c1 !== S.c2)) {
    for (let r = S.r1; r <= S.r2; r++) for (let c = S.c1; c <= S.c2; c++) ecrire(r, c, t.startsWith('=') ? decalerFormule(t, r - e.r, c - e.c) : t);
  } else ecrire(e.r, e.c, vd ? (vd.liste.find(x => x.toLowerCase() === t.trim().toLowerCase()) ?? t) : t);
  fermerEditeur();
  recalculer(); calculerGeometrie();
  modifie();
  if (dir === 'bas') deplacer(1, 0, false, true); else if (dir === 'haut') deplacer(-1, 0, false, true); else if (dir === 'droite') deplacer(0, 1, false, true); else if (dir === 'gauche') deplacer(0, -1, false, true);
  else { rendre(); majBarreFormule(); }
  majEtat();
  return true;
}
function annulerEdition() { fermerEditeur(); majBarreFormule(); rendre(); }
function fermerEditeur() { V.edition = null; editeur.classList.add('masque'); $('#aide-fonction').classList.add('masque'); $('#calque-refs').innerHTML = ''; $('#recepteur').focus({ preventScroll: true }); }
function majTexteEdition(t, source) {
  if (!V.edition) return; V.edition.texte = t;
  if (source !== 'cellule') edTexte.value = t; if (source !== 'barre') barre.value = t;
  placerEditeur(); majAideFonction();
}
edTexte.addEventListener('input', () => majTexteEdition(edTexte.value, 'cellule'));
barre.addEventListener('input', () => { if (!V.edition) commencerEdition({ texte: barre.value, depuisBarre: true }); majTexteEdition(barre.value, 'barre'); });
barre.addEventListener('focus', () => { if (!V.edition) { const cel = F().cellules.get(cle(S.r, S.c)); commencerEdition({ garder: true, depuisBarre: true }); void cel; } });
function toucheEdition(e, source) {
  const aide = $('#aide-fonction');
  const listeVisible = !aide.classList.contains('masque') && $('.liste-fn', aide);
  if (listeVisible && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const b = $$('.liste-fn button', aide); let i = b.findIndex(x => x.classList.contains('actif')); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length; b.forEach((x, k) => x.classList.toggle('actif', k === i)); b[i].scrollIntoView({ block: 'nearest' }); return; }
  if (listeVisible && (e.key === 'Tab' || (e.key === 'Enter' && $('.liste-fn button.actif', aide)))) { e.preventDefault(); $('.liste-fn button.actif', aide)?.click(); return; }
  if (e.key === 'Enter' && e.altKey) { e.preventDefault(); const t = e.target; const p = t.selectionStart; t.value = t.value.slice(0, p) + '\n' + t.value.slice(t.selectionEnd); t.setSelectionRange(p + 1, p + 1); majTexteEdition(t.value, source); return; }
  if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); V.edition.remplirSelection = true; validerEdition('aucune'); return; }
  if (e.key === 'Enter') { e.preventDefault(); validerEdition(e.shiftKey ? 'haut' : 'bas'); return; }
  if (e.key === 'Tab') { e.preventDefault(); validerEdition(e.shiftKey ? 'gauche' : 'droite'); return; }
  if (e.key === 'Escape') { e.preventDefault(); annulerEdition(); return; }
  if (e.key === 'F4') { e.preventDefault(); basculerAbsolu(e.target, source); return; }
  if (!V.edition.depuisBarre && source === 'cellule' && !V.edition.texte.startsWith('=') && !V.edition.garder && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !V.edition.clavierLibre) {
    e.preventDefault(); validerEdition({ ArrowUp: 'haut', ArrowDown: 'bas', ArrowLeft: 'gauche', ArrowRight: 'droite' }[e.key]); return;
  }
}
edTexte.addEventListener('keydown', e => toucheEdition(e, 'cellule'));
barre.addEventListener('keydown', e => { if (V.edition) toucheEdition(e, 'barre'); });
edTexte.addEventListener('mousedown', () => { if (V.edition) V.edition.clavierLibre = true; });
function basculerAbsolu(t, source) {
  // F4 : A1 → $A$1 → A$1 → $A1 → A1 sur la référence sous le curseur
  const p = t.selectionStart; const v = t.value;
  const re = /(\$?)([A-Z]{1,3})(\$?)(\d+)/gi; let m;
  while ((m = re.exec(v))) {
    if (p >= m.index && p <= m.index + m[0].length) {
      const etats = [['', ''], ['$', '$'], ['', '$'], ['$', '']]; const i = etats.findIndex(x => x[0] === m[1] && x[1] === m[3]);
      const [a, b] = etats[(i + 1) % 4]; const n = `${a}${m[2]}${b}${m[4]}`;
      t.value = v.slice(0, m.index) + n + v.slice(m.index + m[0].length); t.setSelectionRange(m.index + n.length, m.index + n.length);
      majTexteEdition(t.value, source); return;
    }
  }
}
// Pointage de références pendant la saisie d'une formule
function pointPossible() { const t = V.edition.depuisBarre ? barre : edTexte; const avant = t.value.slice(0, t.selectionStart).trimEnd(); return /[=(;+\-*/^&<>:]$/.test(avant) || V.edition.pointage; }
function pointerReference(e) {
  const t = V.edition.depuisBarre ? barre : edTexte;
  const p0 = celluleAuPoint(e.clientX, e.clientY);
  const debut = V.edition.pointage ? V.edition.pointage.debut : t.selectionStart;
  const inserer = (r1, c1, r2, c2) => {
    const ref = (r1 === r2 && c1 === c2) ? adresse(r1, c1) : `${adresse(Math.min(r1, r2), Math.min(c1, c2))}:${adresse(Math.max(r1, r2), Math.max(c1, c2))}`;
    const fin = V.edition.pointage ? V.edition.pointage.fin : t.selectionEnd;
    t.value = t.value.slice(0, debut) + ref + t.value.slice(fin);
    V.edition.pointage = { debut, fin: debut + ref.length };
    t.setSelectionRange(debut + ref.length, debut + ref.length);
    majTexteEdition(t.value, t === barre ? 'barre' : 'cellule');
  };
  inserer(p0.r, p0.c, p0.r, p0.c);
  const mv = m => { const p = celluleAuPoint(m.clientX, m.clientY); inserer(p0.r, p0.c, p.r, p.c); };
  const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); t.focus(); };
  addEventListener('mousemove', mv); addEventListener('mouseup', up);
}
[edTexte, barre].forEach(t => t.addEventListener('keydown', e => { if (V.edition && !['Shift', 'Control', 'Alt'].includes(e.key)) V.edition.pointage = null; }));
const COULEURS_REF = ['#2456B0', '#C0392B', '#7D3C98', '#1E8449', '#B9770E', '#117A65'];
function majRefsFormule() {
  const z = $('#calque-refs'); const e = V.edition;
  if (!e || !e.texte.startsWith('=')) { z.innerHTML = ''; return; }
  let toks; try { toks = decouper(e.texte.slice(1)); } catch { z.innerHTML = ''; return; }
  let h = '', i = 0;
  for (const t of toks) {
    if (t.type !== 'ref' || (t.feuille && t.feuille !== F().nom)) continue;
    const p = lirePlage(t.cible.replace(/\$/g, '')); if (!p) continue;
    const q = rectVue(p.r1, p.c1, Math.min(p.r2, V.nL - 1), Math.min(p.c2, V.nC - 1)); const col = COULEURS_REF[i++ % COULEURS_REF.length];
    h += `<div class="ref-formule" style="left:${q.left}px;top:${q.top}px;width:${q.width}px;height:${q.height}px;border-color:${col};background:${col}14"></div>`;
  }
  z.innerHTML = h;
}
// Aide à la saisie des fonctions
function choisirFonction(nom) {
  const e = V.edition; if (!e) return;
  const t2 = e.depuisBarre ? barre : edTexte; const p = t2.selectionStart; const av = t2.value.slice(0, p).replace(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.]*)$/, nom + '(');
  t2.value = av + t2.value.slice(p); t2.setSelectionRange(av.length, av.length); majTexteEdition(t2.value, e.depuisBarre ? 'barre' : 'cellule'); t2.focus();
}
function majAideFonction() {
  const aide = $('#aide-fonction'); const e = V.edition;
  if (!e || !e.texte.startsWith('=')) { aide.classList.add('masque'); return; }
  const t = e.depuisBarre ? barre : edTexte; const avant = t.value.slice(0, t.selectionStart ?? t.value.length);
  const mot = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.]*)$/.exec(avant);
  let html = '';
  if (mot && !/^[A-Z]{1,3}\d+$/i.test(mot[1]) && mot[1].length >= 1) {
    const q = mot[1].toUpperCase();
    const l = LISTE_FONCTIONS.filter(f => f.fr.startsWith(q)).slice(0, 12);
    if (l.length && !(l.length === 1 && l[0].fr === q)) html = `<div class="liste-fn">${l.map((f, i) => `<button class="${i === 0 ? 'actif' : ''}" data-fn="${f.fr}"><b>${f.fr}</b><small>${esc(f.desc)}</small></button>`).join('')}</div>`;
  }
  if (!html) {
    // fonction en cours : compter les parenthèses
    let prof = 0, nom = null, arg = 0;
    for (let i = avant.length - 1; i >= 0; i--) { const ch = avant[i]; if (ch === ')') prof++; else if (ch === '(') { if (prof === 0) { const m = /([A-Za-zÀ-ÿ][\wÀ-ÿ.]*)$/.exec(avant.slice(0, i)); nom = m ? m[1].toUpperCase() : null; break; } prof--; } else if (ch === ';' && prof === 0) arg++; }
    const d = nom && FONCTIONS[nom];
    if (d) { const parts = d.syn.replace(/^[^(]+\(/, '').replace(/\)$/, '').split(';'); html = `<div class="syntaxe">${esc(d.fr)}(${parts.map((p, i) => i === Math.min(arg, parts.length - 1) ? `<b>${esc(p.trim())}</b>` : esc(p.trim())).join('; ')})</div>`; }
  }
  if (!html) { aide.classList.add('masque'); return; }
  aide.innerHTML = html; aide.classList.remove('masque');
  const r = (e.depuisBarre ? barre : editeur).getBoundingClientRect(), z = zone.getBoundingClientRect();
  aide.style.left = Math.max(0, r.left - z.left) + 'px'; aide.style.top = (r.bottom - z.top + 2) + 'px';
  $$('.liste-fn button', aide).forEach(b => { b.onmousedown = ev => ev.preventDefault(); b.onclick = () => choisirFonction(b.dataset.fn); });
}
[edTexte, barre].forEach(t => t.addEventListener('keyup', e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) majAideFonction(); }));

// ---------- Clavier sur la grille ----------
const recepteur = $('#recepteur');
function bordDonnees(r, c, dr, dc) {
  // Ctrl+flèche : saute au bord du bloc de données
  const plein = (r2, c2) => { const x = F().cellules.get(cle(r2, c2)); return !!x && (x.v != null || x.f); };
  let nr = r, nc = c; const lim = (a, b) => a >= 0 && b >= 0 && a < LIGNES_MAX && b < COLS_MAX;
  const u = etendue(F());
  if (plein(r, c) && lim(r + dr, c + dc) && plein(r + dr, c + dc)) { while (lim(nr + dr, nc + dc) && plein(nr + dr, nc + dc)) { nr += dr; nc += dc; } }
  else { nr += dr; nc += dc; while (lim(nr, nc) && !plein(nr, nc) && nr <= u.r2 + 1 && nc <= u.c2 + 1 && nr >= 0 && nc >= 0) { nr += dr; nc += dc; } if (!lim(nr, nc) || nr > u.r2 || nc > u.c2) { nr = Math.max(0, Math.min(nr, dr > 0 ? Math.max(u.r2, r) : nr)); nc = Math.max(0, Math.min(nc, dc > 0 ? Math.max(u.c2, c) : nc)); if (dr < 0) nr = Math.max(0, nr); if (dc < 0) nc = Math.max(0, nc); } }
  return [Math.max(0, nr), Math.max(0, nc)];
}
function deplacer(dr, dc, etendre = false, depuisEdition = false) {
  let r = etendre ? S.r2x ?? S.r : S.r, c = etendre ? S.c2x ?? S.c : S.c;
  // dans une sélection multiple, Entrée/Tab se déplacent à l'intérieur
  if (depuisEdition && (S.r1 !== S.r2 || S.c1 !== S.c2) && !fusionDe(S.r, S.c)) {
    let nr = S.r + dr, nc = S.c + dc;
    if (nc > S.c2) { nc = S.c1; nr++; } if (nc < S.c1) { nc = S.c2; nr--; } if (nr > S.r2) { nr = S.r1; nc = dc ? nc : nc + 1 > S.c2 ? S.c1 : nc + 1; } if (nr < S.r1) nr = S.r2;
    S.r = nr; S.c = nc; rendre(); majBarreFormule(); rendreVisible(nr, nc); return;
  }
  const m = fusionDe(r, c); if (m && !etendre) { if (dr > 0) r = m.r2; if (dc > 0) c = m.c2; }
  r += dr; c += dc;
  while (dr && r >= 0 && r < V.nL && haut(r) === 0) r += dr;
  while (dc && c >= 0 && c < V.nC && larg(c) === 0) c += dc;
  r = Math.max(0, r); c = Math.max(0, c);
  selectionner(r, c, { etendre }); rendreVisible(r, c);
}
recepteur.addEventListener('keydown', e => {
  if (V.edition) return;
  const k = e.key, ctrl = e.ctrlKey || e.metaKey;
  if (V.graphSel && (k === 'Delete' || k === 'Backspace')) { e.preventDefault(); supprimerGraphique(); return; }
  const fleches = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (fleches[k]) {
    e.preventDefault(); const [dr, dc] = fleches[k];
    if (ctrl) { const [r, c] = bordDonnees(e.shiftKey ? (S.r2x ?? S.r) : S.r, e.shiftKey ? (S.c2x ?? S.c) : S.c, dr, dc); selectionner(r, c, { etendre: e.shiftKey }); rendreVisible(r, c); }
    else deplacer(dr, dc, e.shiftKey);
    return;
  }
  if (k === 'Enter') { e.preventDefault(); deplacer(e.shiftKey ? -1 : 1, 0, false, true); return; }
  if (k === 'Tab') { e.preventDefault(); deplacer(0, e.shiftKey ? -1 : 1, false, true); return; }
  if (k === 'Home') { e.preventDefault(); const r = ctrl ? 0 : S.r; selectionner(r, 0, { etendre: e.shiftKey }); rendreVisible(r, 0); return; }
  if (k === 'End' && ctrl) { e.preventDefault(); const u = etendue(F()); selectionner(Math.max(0, u.r2), Math.max(0, u.c2), { etendre: e.shiftKey }); rendreVisible(Math.max(0, u.r2), Math.max(0, u.c2)); return; }
  if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); const n = Math.max(1, Math.floor(defile.clientHeight / (HAUTEUR_DEF * V.zoom)) - 1); deplacer(k === 'PageDown' ? n : -n, 0, e.shiftKey); return; }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (k === 'Backspace') { commencerEdition({ texte: '' }); return; } effacer('contenu'); return; }
  if (k === 'F2') { e.preventDefault(); commencerEdition({ garder: true }); V.edition.clavierLibre = true; return; }
  if (k === 'Escape') { if (V.copie) { V.copie = null; rendreSelection(); } return; }
  if (ctrl && (k === ';' || k === ',')) { e.preventDefault(); const d = new Date(); avant(); ecrire(S.r, S.c, d.toLocaleDateString('fr-FR')); recalculer(); rendre(); majBarreFormule(); modifie(); return; }
  if (ctrl && e.shiftKey && (k === ':' || k === '.')) { e.preventDefault(); const d = new Date(); avant(); ecrire(S.r, S.c, d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })); recalculer(); rendre(); majBarreFormule(); modifie(); return; }
  if (!ctrl && !e.altKey && k.length === 1) { e.preventDefault(); commencerEdition({ texte: k }); return; }
});
recepteur.addEventListener('input', () => { if (!V.edition && recepteur.value) { commencerEdition({ texte: recepteur.value }); } recepteur.value = ''; });

// ---------- Presse-papiers ----------
function matriceSelection(p = plageSel(), affichage = true) {
  const m = []; for (let r = p.r1; r <= p.r2; r++) { if (haut(r) === 0 && lignesFiltrees.has(r)) continue; const l = []; for (let c = p.c1; c <= p.c2; c++) { const cel = F().cellules.get(cle(r, c)); const v = val(r, c); l.push(affichage ? (v == null ? '' : formaterValeur(v, cel?.s?.format || 'General', 50).texte.replace(/ /g, ' ')) : v); } m.push(l); }
  return m;
}
function texteTSV(p) { return matriceSelection(p).map(l => l.map(t => /[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t).join('\t')).join('\r\n'); }
function htmlTableau(p) {
  let h = '<table>';
  for (let r = p.r1; r <= p.r2; r++) { h += '<tr>'; for (let c = p.c1; c <= p.c2; c++) { const cel = F().cellules.get(cle(r, c)); const v = val(r, c); const s = cel?.s || {}; const st = [s.gras && 'font-weight:bold', s.italique && 'font-style:italic', s.couleur && `color:${s.couleur}`, s.fond && `background:${s.fond}`].filter(Boolean).join(';'); h += `<td${st ? ` style="${st}"` : ''}>${esc(v == null ? '' : formaterValeur(v, s.format || 'General', 50).texte)}</td>`; } h += '</tr>'; }
  return h + '</table>';
}
function copier(couper) {
  const p = plageSel();
  const cells = []; for (let r = p.r1; r <= p.r2; r++) { const l = []; for (let c = p.c1; c <= p.c2; c++) { const x = F().cellules.get(cle(r, c)); l.push(x ? JSON.parse(JSON.stringify(x)) : null); } cells.push(l); }
  V.copie = { feuille: C.active, ...p, cells, couper, texte: texteTSV(p) };
  try { navigator.clipboard.writeText(V.copie.texte).catch(() => { }); } catch { }
  rendreSelection();
}
document.addEventListener('copy', e => { if (V.edition || !zone.contains(document.activeElement) && document.activeElement !== recepteur) return; e.preventDefault(); copier(false); e.clipboardData.setData('text/plain', V.copie.texte); e.clipboardData.setData('text/html', htmlTableau(plageSel())); });
document.addEventListener('cut', e => { if (V.edition || document.activeElement !== recepteur) return; e.preventDefault(); copier(true); e.clipboardData.setData('text/plain', V.copie.texte); });
document.addEventListener('paste', e => {
  if (V.edition || document.activeElement !== recepteur) return;
  e.preventDefault();
  const t = e.clipboardData.getData('text/plain'), h = e.clipboardData.getData('text/html');
  coller(t, h);
});
async function collerDepuisPressePapiers() { let t = ''; try { t = await navigator.clipboard.readText(); } catch { } coller(t, ''); }
function coller(texte, html, mode = 'tout') {
  // collage interne (formules et mises en forme conservées)
  if (V.copie && (!texte || texte.replace(/\r/g, '') === V.copie.texte.replace(/\r/g, ''))) return collerInterne(mode);
  let lignes;
  if (html && /<table/i.test(html)) { const d = new DOMParser().parseFromString(html, 'text/html'); lignes = [...d.querySelectorAll('tr')].map(tr => [...tr.cells].map(td => td.innerText.trim())); }
  else lignes = lireTSV(texte || '');
  if (!lignes.length) return;
  avant();
  const nbR = lignes.length, nbC = Math.max(...lignes.map(l => l.length));
  // répéter si la sélection est un multiple de la zone copiée
  const rep = (S.r2 - S.r1 + 1) % nbR === 0 && (S.c2 - S.c1 + 1) % nbC === 0 && (S.r2 - S.r1 + 1) <= 5000;
  const totR = rep ? S.r2 - S.r1 + 1 : nbR, totC = rep ? S.c2 - S.c1 + 1 : nbC;
  for (let i = 0; i < totR; i++) for (let j = 0; j < totC; j++) { const v = lignes[i % nbR][j % nbC]; if (v === undefined) continue; ecrire(S.r1 + i, S.c1 + j, v); }
  S.r2 = S.r1 + totR - 1; S.c2 = S.c1 + totC - 1;
  apresModif();
}
function lireTSV(t) {
  const l = []; let ligne = [], champ = '', q = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i]; if (q) { if (ch === '"') { if (t[i + 1] === '"') { champ += '"'; i++; } else q = false; } else champ += ch; continue; } if (ch === '"' && champ === '') { q = true; continue; } if (ch === '\t') { ligne.push(champ); champ = ''; continue; } if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; ligne.push(champ); l.push(ligne); ligne = []; champ = ''; continue; } champ += ch; }
  if (champ !== '' || ligne.length) { ligne.push(champ); l.push(ligne); }
  return l;
}
function collerInterne(mode = 'tout') {
  const cp = V.copie; avant();
  const nbR = cp.cells.length, nbC = cp.cells[0].length;
  const transposer = mode === 'transposer';
  const rep = !transposer && (S.r2 - S.r1 + 1) % nbR === 0 && (S.c2 - S.c1 + 1) % nbC === 0;
  const totR = transposer ? nbC : rep ? S.r2 - S.r1 + 1 : nbR, totC = transposer ? nbR : rep ? S.c2 - S.c1 + 1 : nbC;
  const src = C.feuilles[cp.feuille];
  if (cp.couper) for (let i = 0; i < nbR; i++) for (let j = 0; j < nbC; j++) src.cellules.delete(cle(cp.r1 + i, cp.c1 + j));
  for (let i = 0; i < totR; i++) for (let j = 0; j < totC; j++) {
    const o = transposer ? cp.cells[j][i] : cp.cells[i % nbR][j % nbC];
    const r = S.r1 + i, c = S.c1 + j;
    const ancien = F().cellules.get(cle(r, c));
    if (!o) { if (mode === 'tout' || mode === 'transposer') F().cellules.delete(cle(r, c)); continue; }
    const n = {};
    const dr = r - (transposer ? cp.r1 + j : cp.r1 + (i % nbR)), dc = c - (transposer ? cp.c1 + i : cp.c1 + (j % nbC));
    if (mode === 'formats') { definirCellule(F(), r, c, { ...(ancien || {}), s: o.s }); continue; }
    if (mode === 'valeurs') { const v = o.f ? valeur(cp.feuille, cp.r1 + (transposer ? j : i % nbR), cp.c1 + (transposer ? i : j % nbC)) : o.v; definirCellule(F(), r, c, { ...(ancien || {}), v: estErreur(v) ? v.code : v, f: undefined }); continue; }
    if (o.f) n.f = cp.couper ? o.f : decalerFormule(o.f, dr, dc); else if (o.v !== undefined) n.v = o.v;
    if (o.s) n.s = o.s; if (o.n) n.n = o.n;
    definirCellule(F(), r, c, n);
  }
  S.r2 = S.r1 + totR - 1; S.c2 = S.c1 + totC - 1;
  if (cp.couper) V.copie = null;
  apresModif();
}
async function collageSpecial() {
  if (!V.copie) return toast('Copiez d\'abord des cellules (Ctrl+C).');
  const r = await dialogue({ titre: 'Collage spécial', contenu: `<div style="display:flex;flex-direction:column;gap:8px">${[['tout', 'Tout'], ['valeurs', 'Valeurs uniquement'], ['formats', 'Mises en forme uniquement'], ['transposer', 'Transposer (lignes ↔ colonnes)']].map(([v, l], i) => `<label class="case"><input type="radio" name="mode" value="${v}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}</div>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Coller', valeur: true, primaire: true }] });
  if (r) collerInterne(r.mode);
}
function apresModif() { recalculer(); calculerGeometrie(); rendre(); majBarreFormule(); majEtat(); modifie(); }

// ---------- Recopie (poignée) ----------
function recopieSouris(e) {
  const p0 = { ...S }; const cadre = $('#sel-recopie');
  let cible = null;
  const mv = m => {
    const p = celluleAuPoint(m.clientX, m.clientY);
    const dB = p.r - p0.r2, dH = p0.r1 - p.r, dD = p.c - p0.c2, dG = p0.c1 - p.c;
    const max = Math.max(dB, dH, dD, dG);
    if (max <= 0) { cible = null; cadre.classList.add('masque'); return; }
    if (max === dB || max === dH) cible = dB >= dH ? { r1: p0.r1, c1: p0.c1, r2: p.r, c2: p0.c2, sens: 'bas' } : { r1: p.r, c1: p0.c1, r2: p0.r2, c2: p0.c2, sens: 'haut' };
    else cible = dD >= dG ? { r1: p0.r1, c1: p0.c1, r2: p0.r2, c2: p.c, sens: 'droite' } : { r1: p0.r1, c1: p.c, r2: p0.r2, c2: p0.c2, sens: 'gauche' };
    const q = rectVue(cible.r1, cible.c1, cible.r2, cible.c2); cadre.classList.remove('masque'); Object.assign(cadre.style, { left: q.left + 'px', top: q.top + 'px', width: q.width + 'px', height: q.height + 'px' });
    defilementAuto(m);
  };
  const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); cadre.classList.add('masque'); if (cible) recopier(p0, cible); };
  addEventListener('mousemove', mv); addEventListener('mouseup', up);
}
const JOURS_S = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'], MOIS_S = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function serie(valeurs, n) {
  // prolonge une série : nombres (pas constant), dates, jours, mois, « texte 1 »
  const vs = valeurs.map(c => c?.f ? null : c?.v);
  if (vs.every(v => typeof v === 'number')) { const pas = vs.length > 1 ? (vs[vs.length - 1] - vs[0]) / (vs.length - 1) : (valeurs[0]?.s?.format && estFormatDate(valeurs[0].s.format) ? 1 : (valeurs.length === 1 ? 0 : 1)); return k => vs[vs.length - 1] + pas * (k + 1); }
  if (vs.every(v => typeof v === 'string')) {
    const low = vs.map(v => v.toLowerCase());
    for (const liste of [JOURS_S, MOIS_S]) { const idx = low.map(v => liste.indexOf(v)); if (idx.every(i => i >= 0)) { const pas = idx.length > 1 ? idx[1] - idx[0] : 1; const maj = vs[0][0] === vs[0][0].toUpperCase(); return k => { const n = liste.length; const t = liste[(((idx[idx.length - 1] + pas * (k + 1)) % n) + n) % n]; return maj ? t[0].toUpperCase() + t.slice(1) : t; }; } }
    const m = vs.map(v => /^(.*?)(\d+)(\D*)$/.exec(v));
    if (m.every(Boolean) && m.every(x => x[1] === m[0][1] && x[3] === m[0][3])) { const ns = m.map(x => +x[2]); const pas = ns.length > 1 ? ns[ns.length - 1] - ns[ns.length - 2] : 1; return k => m[0][1] + (ns[ns.length - 1] + pas * (k + 1)) + m[0][3]; }
  }
  return null;
}
function recopier(src, cible) {
  avant();
  const f = F();
  const vertical = cible.sens === 'bas' || cible.sens === 'haut';
  const n = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
  const lignes = vertical ? range(src.c1, src.c2) : range(src.r1, src.r2);
  for (const a of lignes) {
    const sources = range(0, n - 1).map(i => vertical ? f.cellules.get(cle(src.r1 + i, a)) : f.cellules.get(cle(a, src.c1 + i)));
    const fs = serie(sources.filter(Boolean).length === n ? sources : sources, n);
    const total = vertical ? cible.r2 - cible.r1 + 1 : cible.c2 - cible.c1 + 1;
    const avantSrc = cible.sens === 'haut' || cible.sens === 'gauche';
    for (let k = 0; k < total - n; k++) {
      const idx = avantSrc ? (n - 1 - (k % n)) : (k % n);
      const o = sources[idx];
      const pos = avantSrc ? (vertical ? src.r1 - 1 - k : src.c1 - 1 - k) : (vertical ? src.r2 + 1 + k : src.c2 + 1 + k);
      const r = vertical ? pos : a, c = vertical ? a : pos;
      if (!o) { f.cellules.delete(cle(r, c)); continue; }
      const nv = {}; if (o.s) nv.s = o.s;
      if (o.f) { const or = vertical ? src.r1 + idx : a, oc = vertical ? a : src.c1 + idx; nv.f = decalerFormule(o.f, r - or, c - oc); }
      else if (fs && !avantSrc) nv.v = fs(k);
      else if (fs && avantSrc) { const vs = sources.map(s => s?.v); if (typeof vs[0] === 'number') { const pas = vs.length > 1 ? (vs[vs.length - 1] - vs[0]) / (vs.length - 1) : 0; nv.v = vs[0] - pas * (k + 1); } else nv.v = o.v; }
      else nv.v = o.v;
      definirCellule(f, r, c, nv);
    }
  }
  S.r1 = cible.r1; S.c1 = cible.c1; S.r2 = cible.r2; S.c2 = cible.c2;
  apresModif();
}
function recopierVers(sens) { // Ctrl+D (bas) et Ctrl+R (droite)
  if (sens === 'bas') { if (S.r1 === S.r2) { if (S.r1 === 0) return; recopier({ ...S, r1: S.r1 - 1, r2: S.r1 - 1 }, { r1: S.r1 - 1, c1: S.c1, r2: S.r2, c2: S.c2, sens: 'bas' }); } else recopier({ ...S, r2: S.r1 }, { ...S, sens: 'bas' }); }
  else { if (S.c1 === S.c2) { if (S.c1 === 0) return; recopier({ ...S, c1: S.c1 - 1, c2: S.c1 - 1 }, { r1: S.r1, c1: S.c1 - 1, r2: S.r2, c2: S.c2, sens: 'droite' }); } else recopier({ ...S, c2: S.c1 }, { ...S, sens: 'droite' }); }
}

// ---------- Mise en forme ----------
function cellulesSelection(creer = true) {
  const p = plageSel(); const l = [];
  const r2 = S.r2 >= LIGNES_MAX - 1 ? Math.max(p.r2, 999) : S.r2, c2 = S.c2 >= COLS_MAX - 1 ? Math.max(p.c2, 51) : S.c2;
  for (let r = S.r1; r <= r2; r++) for (let c = S.c1; c <= c2; c++) { let x = F().cellules.get(cle(r, c)); if (!x && creer) { x = {}; F().cellules.set(cle(r, c), x); } if (x) l.push([r, c, x]); }
  return l;
}
function appliquerStyle(maj) {
  if (F().protegee) return toast('La feuille est protégée.');
  avant();
  for (const [r, c, x] of cellulesSelection()) {
    const s = { ...(x.s || {}) };
    for (const [k, v] of Object.entries(typeof maj === 'function' ? maj(s, r, c) : maj)) { if (v == null || v === false) delete s[k]; else s[k] = v; }
    if (Object.keys(s).length) x.s = s; else delete x.s;
    if (x.v == null && !x.f && !x.s && !x.n) F().cellules.delete(cle(r, c));
  }
  recalculer(); rendre(); majRubanEtat(); modifie();
}
const styleActif = () => F().cellules.get(cle(S.r, S.c))?.s || {};
function basculer(prop) { const v = !styleActif()[prop]; appliquerStyle({ [prop]: v }); }
function bordures(type, style = 'thin', couleur = '#000000') {
  avant();
  const b = { style, couleur };
  for (const [r, c, x] of cellulesSelection()) {
    const s = { ...(x.s || {}) }; const bd = { ...(s.bordures || {}) };
    const haut = r === S.r1, gauche = c === S.c1, droite = c === S.c2;
    if (type === 'aucune') { delete s.bordures; x.s = s; continue; }
    if (type === 'toutes') { bd.h = bd.b = bd.g = bd.d = b; }
    if (type === 'contour') { if (haut) bd.h = b; if (r === S.r2) bd.b = b; if (gauche) bd.g = b; if (droite) bd.d = b; }
    if (type === 'contour-epais') { const e = { ...b, style: 'medium' }; if (haut) bd.h = e; if (r === S.r2) bd.b = e; if (gauche) bd.g = e; if (droite) bd.d = e; }
    if (type === 'bas') { if (r === S.r2) bd.b = b; } if (type === 'haut') { if (haut) bd.h = b; } if (type === 'gauche') { if (gauche) bd.g = b; } if (type === 'droite') { if (droite) bd.d = b; }
    if (type === 'double-bas') { if (r === S.r2) bd.b = { ...b, style: 'double' }; }
    s.bordures = bd; x.s = s;
  }
  rendre(); modifie();
}
function fusionner(centrer = true, parLigne = false) {
  const p = { r1: S.r1, c1: S.c1, r2: S.r2, c2: S.c2 };
  if (p.r1 === p.r2 && p.c1 === p.c2) { const m = fusionDe(S.r, S.c); if (m) return defusionner(); return toast('Sélectionnez plusieurs cellules à fusionner.'); }
  const existante = F().fusions.find(m => m.r1 === p.r1 && m.c1 === p.c1 && m.r2 === p.r2 && m.c2 === p.c2);
  if (existante) return defusionner();
  const pleines = []; for (let r = p.r1; r <= p.r2; r++) for (let c = p.c1; c <= p.c2; c++) { const x = F().cellules.get(cle(r, c)); if (x && (x.v != null || x.f)) pleines.push([r, c]); }
  avant();
  F().fusions = F().fusions.filter(m => m.r2 < p.r1 || m.r1 > p.r2 || m.c2 < p.c1 || m.c1 > p.c2);
  const blocs = parLigne ? range(p.r1, p.r2).map(r => ({ r1: r, r2: r, c1: p.c1, c2: p.c2 })) : [p];
  for (const b of blocs) {
    for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) if (r !== b.r1 || c !== b.c1) { const x = F().cellules.get(cle(r, c)); if (x) { delete x.v; delete x.f; if (!x.s) F().cellules.delete(cle(r, c)); } }
    F().fusions.push(b);
    if (centrer) { const x = F().cellules.get(cle(b.r1, b.c1)) || {}; x.s = { ...(x.s || {}), alignH: 'centre' }; F().cellules.set(cle(b.r1, b.c1), x); }
  }
  if (pleines.length > 1) toast('La fusion ne conserve que la valeur de la cellule en haut à gauche.');
  selectionner(p.r1, p.c1, { r2: p.r2, c2: p.c2 }); apresModif();
}
function defusionner() { avant(); F().fusions = F().fusions.filter(m => m.r2 < S.r1 || m.r1 > S.r2 || m.c2 < S.c1 || m.c1 > S.c2); apresModif(); }
function effacer(quoi) {
  if (F().protegee) return toast('La feuille est protégée.');
  avant();
  for (const [r, c, x] of cellulesSelection(false)) {
    if (quoi === 'tout') F().cellules.delete(cle(r, c));
    else if (quoi === 'contenu') { delete x.v; delete x.f; if (!x.s && !x.n) F().cellules.delete(cle(r, c)); }
    else if (quoi === 'formats') { delete x.s; if (x.v == null && !x.f && !x.n) F().cellules.delete(cle(r, c)); }
    else if (quoi === 'notes') { delete x.n; if (x.v == null && !x.f && !x.s) F().cellules.delete(cle(r, c)); }
  }
  if (quoi === 'tout' || quoi === 'formats') F().mfc = F().mfc.filter(m => m.r2 < S.r1 || m.r1 > S.r2 || m.c2 < S.c1 || m.c1 > S.c2);
  apresModif();
}

// ---------- Insertion / suppression de lignes et colonnes ----------
function decalerStructure(f, axe, index, nb) {
  // nb > 0 : insertion ; nb < 0 : suppression de -nb éléments à partir de index
  const nouv = new Map();
  for (const [k, x] of f.cellules) {
    let [r, c] = deCle(k); const v = axe === 'r' ? r : c;
    if (nb < 0 && v >= index && v < index - nb) continue;
    if (v >= index) { if (axe === 'r') r += nb; else c += nb; }
    if (r < 0 || c < 0) continue;
    nouv.set(cle(r, c), x);
  }
  f.cellules = nouv;
  const decTaille = (obj) => { const n = {}; for (const [k, v] of Object.entries(obj)) { const i = +k; if (nb < 0 && i >= index && i < index - nb) continue; n[i >= index ? i + nb : i] = v; } return n; };
  const decListe = l => l.filter(i => !(nb < 0 && i >= index && i < index - nb)).map(i => i >= index ? i + nb : i);
  if (axe === 'r') { f.hauteurs = decTaille(f.hauteurs); f.ligMasquees = decListe(f.ligMasquees); } else { f.largeurs = decTaille(f.largeurs); f.colMasquees = decListe(f.colMasquees); }
  const decPlage = p => {
    const [a, b] = axe === 'r' ? ['r1', 'r2'] : ['c1', 'c2'];
    if (nb > 0) { if (p[a] >= index) p[a] += nb; if (p[b] >= index) p[b] += nb; return p; }
    const fin = index - nb - 1;
    if (p[a] > fin) p[a] += nb; else if (p[a] >= index) p[a] = index;
    if (p[b] > fin) p[b] += nb; else if (p[b] >= index) p[b] = index - 1;
    return p[b] < p[a] ? null : p;
  };
  f.fusions = f.fusions.map(m => decPlage({ ...m })).filter(m => m && (m.r1 !== m.r2 || m.c1 !== m.c2));
  f.validations = f.validations.map(v => decPlage({ ...v })).filter(Boolean);
  f.mfc = f.mfc.map(v => decPlage({ ...v })).filter(Boolean);
  if (f.filtre) { f.filtre = decPlage({ ...f.filtre }); }
  f.graphiques.forEach(g => { const p = decPlage({ ...g.plage }); if (p) g.plage = p; });
}
function inserer(axe, index, nb) {
  if (F().protegee) return toast('La feuille est protégée.');
  avant();
  const f = F();
  decalerStructure(f, axe, index, nb);
  C.feuilles.forEach((g, gi) => { for (const x of g.cellules.values()) if (x.f) x.f = ajusterFormule(x.f, { feuilleNom: f.nom, estFeuilleCourante: gi === C.active, axe: axe === 'r' ? 'r' : 'c', index, nb }); });
  apresModif();
}
function supprimer(axe, index, nb) {
  if (F().protegee) return toast('La feuille est protégée.');
  avant();
  const f = F();
  C.feuilles.forEach((g, gi) => { for (const x of g.cellules.values()) if (x.f) x.f = ajusterFormule(x.f, { feuilleNom: f.nom, estFeuilleCourante: gi === C.active, axe: axe === 'r' ? 'r' : 'c', index, nb: -nb }); });
  decalerStructure(f, axe, index, -nb);
  if (axe === 'r') selectionner(Math.min(S.r1, LIGNES_MAX - 1), S.c1, { r2: S.r2 >= LIGNES_MAX - 1 ? undefined : undefined }); else selectionner(S.r1, S.c1);
  apresModif();
}
async function dialogueInserer() {
  const r = await dialogue({ titre: 'Insérer', contenu: `<div style="display:flex;flex-direction:column;gap:8px">${[['bas', 'Décaler les cellules vers le bas'], ['droite', 'Décaler les cellules vers la droite'], ['ligne', 'Ligne entière'], ['colonne', 'Colonne entière']].map(([v, l], i) => `<label class="case"><input type="radio" name="m" value="${v}" ${i === 2 ? 'checked' : ''}> ${l}</label>`).join('')}</div>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'OK', valeur: true, primaire: true }] });
  if (!r) return;
  if (r.m === 'ligne') inserer('r', S.r1, S.r2 - S.r1 + 1);
  else if (r.m === 'colonne') inserer('c', S.c1, S.c2 - S.c1 + 1);
  else decalerCellules(r.m, 1);
}
async function dialogueSupprimer() {
  const r = await dialogue({ titre: 'Supprimer', contenu: `<div style="display:flex;flex-direction:column;gap:8px">${[['haut', 'Décaler les cellules vers le haut'], ['gauche', 'Décaler les cellules vers la gauche'], ['ligne', 'Ligne entière'], ['colonne', 'Colonne entière']].map(([v, l], i) => `<label class="case"><input type="radio" name="m" value="${v}" ${i === 2 ? 'checked' : ''}> ${l}</label>`).join('')}</div>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'OK', valeur: true, primaire: true }] });
  if (!r) return;
  if (r.m === 'ligne') supprimer('r', S.r1, S.r2 - S.r1 + 1);
  else if (r.m === 'colonne') supprimer('c', S.c1, S.c2 - S.c1 + 1);
  else decalerCellules(r.m, -1);
}
function decalerCellules(sens, signe) {
  avant(); const f = F(); const p = { ...S }; const u = etendue(f);
  const vert = sens === 'bas' || sens === 'haut';
  const n = vert ? p.r2 - p.r1 + 1 : p.c2 - p.c1 + 1;
  const nouv = new Map();
  for (const [k, x] of f.cellules) {
    let [r, c] = deCle(k);
    const dans = vert ? (c >= p.c1 && c <= p.c2) : (r >= p.r1 && r <= p.r2);
    if (dans) {
      const v = vert ? r : c, debut = vert ? p.r1 : p.c1;
      if (signe < 0 && v >= debut && v < debut + n) continue;
      if (v >= debut) { if (vert) r += signe * n; else c += signe * n; }
    }
    nouv.set(cle(r, c), x);
  }
  f.cellules = nouv; void u;
  apresModif();
}
function masquer(axe) { avant(); const f = F(); if (axe === 'c') { for (let c = S.c1; c <= Math.min(S.c2, V.nC); c++) if (!f.colMasquees.includes(c)) f.colMasquees.push(c); } else { for (let r = S.r1; r <= Math.min(S.r2, V.nL); r++) if (!f.ligMasquees.includes(r)) f.ligMasquees.push(r); } apresModif(); }
function afficherMasques(axe) { avant(); const f = F(); if (axe === 'c') f.colMasquees = f.colMasquees.filter(c => c < S.c1 - 1 || c > S.c2 + 1); else f.ligMasquees = f.ligMasquees.filter(r => r < S.r1 - 1 || r > S.r2 + 1); apresModif(); }
async function dialogueTaille(axe) {
  const f = F(); const v0 = axe === 'c' ? (f.largeurs[S.c] ?? LARGEUR_DEF) : (f.hauteurs[S.r] ?? HAUTEUR_DEF);
  const v = await demander(axe === 'c' ? 'Largeur de colonne' : 'Hauteur de ligne', axe === 'c' ? 'Largeur (pixels)' : 'Hauteur (pixels)', v0, 'number');
  if (!v || !(+v > 0)) return; avant();
  if (axe === 'c') for (let c = S.c1; c <= Math.min(S.c2, V.nC); c++) f.largeurs[c] = +v; else for (let r = S.r1; r <= Math.min(S.r2, V.nL); r++) f.hauteurs[r] = +v;
  apresModif();
}

// ---------- Tri, filtres, doublons, validation ----------
function regionCourante() {
  // zone de données contiguë autour de la cellule active (comme Excel)
  if (S.r1 !== S.r2 || S.c1 !== S.c2) return plageSel();
  const plein = (r, c) => { const x = F().cellules.get(cle(r, c)); return !!x && (x.v != null || x.f); };
  let p = { r1: S.r, c1: S.c, r2: S.r, c2: S.c }, change = true;
  while (change) {
    change = false;
    if (p.r1 > 0 && range(p.c1 - (p.c1 > 0 ? 1 : 0), p.c2 + 1).some(c => plein(p.r1 - 1, c))) { p.r1--; change = true; }
    if (range(p.c1 - (p.c1 > 0 ? 1 : 0), p.c2 + 1).some(c => plein(p.r2 + 1, c))) { p.r2++; change = true; }
    if (p.c1 > 0 && range(p.r1 - (p.r1 > 0 ? 1 : 0), p.r2 + 1).some(r => plein(r, p.c1 - 1))) { p.c1--; change = true; }
    if (range(p.r1 - (p.r1 > 0 ? 1 : 0), p.r2 + 1).some(r => plein(r, p.c2 + 1))) { p.c2++; change = true; }
  }
  return p;
}
function aEntete(p) {
  const ligne = range(p.c1, p.c2).map(c => val(p.r1, c)); const suivante = range(p.c1, p.c2).map(c => val(p.r1 + 1, c));
  return ligne.every(v => typeof v === 'string' && v !== '') && suivante.some(v => typeof v === 'number' || v === null || typeof v === 'string');
}
function trier(cles, plage, entete) {
  const p = plage || (F().filtre && S.r >= F().filtre.r1 && S.r <= F().filtre.r2 && S.c >= F().filtre.c1 && S.c <= F().filtre.c2 ? { ...F().filtre } : regionCourante());
  const e = entete ?? (F().filtre && p.r1 === F().filtre.r1 ? true : aEntete(p));
  const r0 = p.r1 + (e ? 1 : 0); if (r0 >= p.r2 + 1) return;
  avant();
  const f = F();
  const lignes = range(r0, p.r2).map(r => ({ r, cells: range(p.c1, p.c2).map(c => f.cellules.get(cle(r, c))), cles: cles.map(k => val(r, k.col)) }));
  const cmp = (a, b) => { if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1; const ta = typeof a === 'number' ? 0 : typeof a === 'string' ? 1 : 2, tb = typeof b === 'number' ? 0 : typeof b === 'string' ? 1 : 2; if (ta !== tb) return ta - tb; if (ta === 1) return a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }); return a < b ? -1 : a > b ? 1 : 0; };
  lignes.sort((a, b) => { for (let i = 0; i < cles.length; i++) { const vA = a.cles[i], vB = b.cles[i]; if (vA == null || vB == null) { const x = cmp(vA, vB); if (x) return x; continue; } const x = cmp(vA, vB) * cles[i].ordre; if (x) return x; } return a.r - b.r; });
  lignes.forEach((l, i) => { const r = r0 + i; l.cells.forEach((x, j) => { const c = p.c1 + j; if (!x) { f.cellules.delete(cle(r, c)); return; } const n = { ...x }; if (n.f) n.f = decalerFormule(n.f, r - l.r, 0); f.cellules.set(cle(r, c), n); }); });
  apresModif();
}
async function triPersonnalise() {
  const p = regionCourante(); const e = aEntete(p);
  const noms = range(p.c1, p.c2).map(c => [c, e ? String(val(p.r1, c)) : 'Colonne ' + colLettre(c)]);
  const opts = noms.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('');
  const niv = i => `<div class="grille-champs" style="grid-template-columns:2fr 1fr"><label class="champ">${i === 0 ? 'Trier par' : 'Puis par'}<select name="col${i}">${i ? '<option value="">(aucun)</option>' : ''}${opts}</select></label><label class="champ">Ordre<select name="ordre${i}"><option value="1">Croissant</option><option value="-1">Décroissant</option></select></label></div>`;
  const r = await dialogue({ titre: 'Tri personnalisé', contenu: `${niv(0)}${niv(1)}${niv(2)}<label class="case"><input type="checkbox" name="entete" ${e ? 'checked' : ''}> Mes données ont des en-têtes</label>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Trier', valeur: true, primaire: true }] });
  if (!r) return;
  const cles = [0, 1, 2].filter(i => r['col' + i] !== '' && r['col' + i] !== undefined).map(i => ({ col: +r['col' + i], ordre: +r['ordre' + i] }));
  trier(cles, p, r.entete);
}
function basculerFiltre() {
  avant();
  if (F().filtre) { F().filtre = null; lignesFiltrees.clear(); }
  else { const p = regionCourante(); F().filtre = { ...p, criteres: {} }; }
  apresModif();
}
function calculerFiltre() {
  lignesFiltrees = new Set(); const f = F().filtre; if (!f || !f.criteres) return;
  for (const [c, cr] of Object.entries(f.criteres)) {
    if (!cr) continue;
    const ok = new Set(cr.valeurs);
    for (let r = f.r1 + 1; r <= f.r2; r++) { const v = val(r, +c); const t = v == null ? '' : formaterValeur(v, F().cellules.get(cle(r, +c))?.s?.format || 'General', 60).texte; if (!ok.has(t)) lignesFiltrees.add(r); }
  }
}
function ouvrirFiltre(c, ancre) {
  const f = F().filtre; if (!f) return;
  // étendre la plage filtrée aux données ajoutées dessous
  const u = etendue(F()); if (u.r2 > f.r2) { let r = f.r2 + 1; while (r <= u.r2 && range(f.c1, f.c2).some(k => F().cellules.get(cle(r, k)))) r++; f.r2 = r - 1; }
  const vals = new Map();
  for (let r = f.r1 + 1; r <= f.r2; r++) { const v = val(r, c); const t = v == null ? '' : formaterValeur(v, F().cellules.get(cle(r, c))?.s?.format || 'General', 60).texte; if (!vals.has(t)) vals.set(t, v); }
  const tri = [...vals.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : (typeof a[1] === 'number' && typeof b[1] === 'number' ? a[1] - b[1] : a[0].localeCompare(b[0], 'fr', { numeric: true }))));
  const actuel = f.criteres?.[c]?.valeurs; const coche = t => !actuel || actuel.includes(t);
  const p = el(`<div class="filtre-panneau"><button class="item-m" data-a="az">${ico('arrow-down-a-z', 'p')} Trier de A à Z</button><button class="item-m" data-a="za">${ico('arrow-down-z-a', 'p')} Trier de Z à A</button><hr><input type="search" placeholder="Rechercher" class="rech"><div class="valeurs"><label><input type="checkbox" data-tout ${!actuel ? 'checked' : ''}> (Sélectionner tout)</label>${tri.map(([t]) => `<label><input type="checkbox" value="${esc(t)}" ${coche(t) ? 'checked' : ''}> ${t === '' ? '(Vides)' : esc(t)}</label>`).join('')}</div><div class="actions"><button class="btn" data-a="effacer">Effacer le filtre</button><button class="btn primaire" data-a="ok">OK</button></div></div>`);
  menu([{ element: p }], 0, 0, ancre);
  $('.rech', p).oninput = e => { const q = e.target.value.toLowerCase(); $$('.valeurs label', p).forEach((l, i) => { if (i) l.style.display = l.textContent.toLowerCase().includes(q) ? '' : 'none'; }); };
  $('[data-tout]', p).onchange = e => $$('.valeurs input:not([data-tout])', p).forEach(i => i.checked = e.target.checked);
  p.onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'az' || a === 'za') { fermerMenu(); trier([{ col: c, ordre: a === 'az' ? 1 : -1 }], { r1: f.r1, c1: f.c1, r2: f.r2, c2: f.c2 }, true); return; }
    avant();
    if (a === 'effacer') delete f.criteres[c];
    else { const l = $$('.valeurs input:not([data-tout])', p).filter(i => i.checked && i.closest('label').style.display !== 'none').map(i => i.value); f.criteres = f.criteres || {}; if (l.length === tri.length) delete f.criteres[c]; else f.criteres[c] = { valeurs: l }; }
    fermerMenu(); apresModif();
    const n = lignesFiltrees.size; if (n) toast(`${f.r2 - f.r1 - n} enregistrement(s) sur ${f.r2 - f.r1} affiché(s).`);
  };
}
function effacerFiltres() { if (!F().filtre) return; avant(); F().filtre.criteres = {}; apresModif(); }
async function supprimerDoublons() {
  const p = regionCourante(); const e = aEntete(p);
  const r = await dialogue({ titre: 'Supprimer les doublons', contenu: `<p>Colonnes à comparer :</p><div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto">${range(p.c1, p.c2).map(c => `<label class="case"><input type="checkbox" name="c${c}" checked> ${esc(e ? String(val(p.r1, c)) : 'Colonne ' + colLettre(c))}</label>`).join('')}</div><label class="case"><input type="checkbox" name="entete" ${e ? 'checked' : ''}> Mes données ont des en-têtes</label>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'OK', valeur: true, primaire: true }] });
  if (!r) return;
  const cols = range(p.c1, p.c2).filter(c => r['c' + c]); if (!cols.length) return;
  avant(); const f = F(); const r0 = p.r1 + (r.entete ? 1 : 0);
  const vu = new Set(); const garder = [];
  for (let k = r0; k <= p.r2; k++) { const cl = JSON.stringify(cols.map(c => val(k, c))); if (vu.has(cl)) continue; vu.add(cl); garder.push(range(p.c1, p.c2).map(c => f.cellules.get(cle(k, c)))); }
  const avantN = p.r2 - r0 + 1;
  for (let k = r0; k <= p.r2; k++) for (let c = p.c1; c <= p.c2; c++) f.cellules.delete(cle(k, c));
  garder.forEach((l, i) => l.forEach((x, j) => { if (x) f.cellules.set(cle(r0 + i, p.c1 + j), x); }));
  apresModif();
  toast(`${avantN - garder.length} doublon(s) supprimé(s), ${garder.length} valeur(s) unique(s) conservée(s).`, 'succes');
}
const validationDe = (r, c) => (F().validations || []).find(v => r >= v.r1 && r <= v.r2 && c >= v.c1 && c <= v.c2);
async function dialogueValidation() {
  const ex = validationDe(S.r, S.c);
  const r = await dialogue({ titre: 'Validation des données', contenu: `<p>Limiter la saisie à une liste de valeurs (une liste déroulante s'affiche dans les cellules).</p><label class="champ">Valeurs autorisées (séparées par des points-virgules)<input type="text" name="liste" value="${esc(ex ? ex.liste.join(';') : '')}" placeholder="Oui;Non;En attente"></label>`, boutons: [ex ? { label: 'Tout effacer', valeur: 'suppr', gauche: true } : null, { label: 'Annuler', valeur: null }, { label: 'OK', valeur: 'ok', primaire: true }].filter(Boolean) });
  if (!r) return;
  avant(); const p = { r1: S.r1, c1: S.c1, r2: Math.min(S.r2, 9999), c2: Math.min(S.c2, 999) };
  F().validations = F().validations.filter(v => v.r2 < p.r1 || v.r1 > p.r2 || v.c2 < p.c1 || v.c1 > p.c2);
  if (r.valeur === 'ok') { const l = r.liste.split(';').map(s => s.trim()).filter(Boolean); if (l.length) F().validations.push({ ...p, liste: l }); }
  apresModif();
}
function ouvrirListeValidation() {
  const v = validationDe(S.r, S.c); if (!v) return;
  const d = calque.querySelector(`.c[data-r="${S.r}"][data-c="${S.c}"]`) || zone;
  menu([...v.liste.map(x => ({ label: x, faire: () => { avant(); ecrire(S.r, S.c, x); apresModif(); } })), '-', { label: '(Effacer)', faire: () => { avant(); ecrire(S.r, S.c, ''); apresModif(); } }], 0, 0, d);
}
async function dialogueMFC(type) {
  const p = { r1: S.r1, c1: S.c1, r2: Math.min(S.r2, 9999), c2: Math.min(S.c2, 999) };
  if (type === 'effacer') { avant(); F().mfc = F().mfc.filter(m => m.r2 < p.r1 || m.r1 > p.r2 || m.c2 < p.c1 || m.c1 > p.c2); apresModif(); return; }
  if (type === 'effacer-tout') { avant(); F().mfc = []; apresModif(); return; }
  if (type === 'echelle' || type === 'barres') { avant(); F().mfc.push({ ...p, type, couleur1: '#F8696B', couleur2: '#63BE7B', couleur: '#638EC6' }); apresModif(); return; }
  const libs = { sup: 'Supérieur à', inf: 'Inférieur à', entre: 'Entre', egal: 'Égal à', contient: 'Texte qui contient', doublons: 'Valeurs en double' };
  const r = await dialogue({ titre: 'Règle de mise en surbrillance', contenu: `<p>${libs[type]} :</p>${type === 'doublons' ? '' : `<div class="grille-champs"><label class="champ">Valeur<input type="text" name="v1"></label>${type === 'entre' ? '<label class="champ">et<input type="text" name="v2"></label>' : '<span></span>'}</div>`}<label class="champ">Mise en forme<select name="style"><option value="rouge">Remplissage rouge clair avec texte rouge foncé</option><option value="jaune">Remplissage jaune avec texte jaune foncé</option><option value="vert">Remplissage vert avec texte vert foncé</option><option value="texte-rouge">Texte rouge</option><option value="gras">Gras</option></select></label>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'OK', valeur: true, primaire: true }] });
  if (!r) return;
  const styles = { rouge: { fond: '#FFC7CE', couleur: '#9C0006' }, jaune: { fond: '#FFEB9C', couleur: '#9C5700' }, vert: { fond: '#C6EFCE', couleur: '#006100' }, 'texte-rouge': { couleur: '#C00000' }, gras: { gras: true } };
  avant(); F().mfc.push({ ...p, type: 'valeur', op: type, v1: r.v1 ?? '', v2: r.v2 ?? '', style: styles[r.style] }); apresModif();
}

// ---------- Notes, liens, rechercher ----------
async function noteCellule() {
  const x = F().cellules.get(cle(S.r, S.c));
  const r = await dialogue({ titre: x?.n ? 'Modifier la note' : 'Insérer une note', contenu: `<label class="champ">Note<textarea name="n" rows="4">${esc(x?.n || '')}</textarea></label>`, boutons: [x?.n ? { label: 'Supprimer', valeur: 'suppr', gauche: true } : null, { label: 'Annuler', valeur: null }, { label: 'OK', valeur: 'ok', primaire: true }].filter(Boolean) });
  if (!r) return; avant();
  const c = F().cellules.get(cle(S.r, S.c)) || {};
  if (r.valeur === 'suppr' || !r.n.trim()) delete c.n; else c.n = r.n.trim();
  definirCellule(F(), S.r, S.c, c); apresModif();
}
async function insererLien() {
  const r = await dialogue({ titre: 'Insérer un lien hypertexte', contenu: `<label class="champ">Texte à afficher<input type="text" name="t" value="${esc(String(val(S.r, S.c) ?? ''))}"></label><label class="champ">Adresse<input type="text" name="u" value="https://"></label>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'OK', valeur: true, primaire: true }] });
  if (!r || !r.u || r.u === 'https://') return;
  avant(); ecrire(S.r, S.c, `=LIEN_HYPERTEXTE("${r.u.replace(/"/g, '""')}";"${(r.t || r.u).replace(/"/g, '""')}")`); apresModif();
}
async function rechercher(remplacer = false) {
  let resultats = [], i = -1;
  const r = await dialogue({
    titre: remplacer ? 'Rechercher et remplacer' : 'Rechercher', taille: 'large',
    contenu: `<div class="grille-champs"><label class="champ">Rechercher<input type="text" name="q"></label><label class="champ">Remplacer par<input type="text" name="rep" ${remplacer ? '' : 'disabled'}></label></div>
      <div style="display:flex;gap:16px;flex-wrap:wrap"><label class="case"><input type="checkbox" name="casse"> Respecter la casse</label><label class="case"><input type="checkbox" name="entier"> Cellule entière</label><label class="case"><input type="checkbox" name="formules"> Chercher dans les formules</label><label class="case"><input type="checkbox" name="classeur"> Tout le classeur</label></div>
      <p class="res-rech" style="min-height:20px"></p>`,
    boutons: [{ label: 'Fermer', valeur: null }, { label: 'Tout remplacer', valeur: 'tout', id: 'tout-remplacer' }, { label: 'Remplacer', valeur: 'un', id: 'remplacer-un' }, { label: 'Suivant', valeur: 'suivant', primaire: true, id: 'suivant' }],
    init: (corps, v) => {
      const lire = () => Object.fromEntries($$('[name]', corps).map(i => [i.name, i.type === 'checkbox' ? i.checked : i.value]));
      const chercherTout = () => {
        const o = lire(); resultats = []; i = -1; if (!o.q) return;
        const fs = o.classeur ? C.feuilles.map((_, k) => k) : [C.active];
        for (const fi of fs) { const f = C.feuilles[fi]; const ks = [...f.cellules.keys()].sort((a, b) => a - b); for (const k of ks) { const x = f.cellules.get(k); const [rr, cc] = deCle(k); const t = o.formules && x.f ? x.f : (() => { const v = valeur(fi, rr, cc); return v == null ? '' : formaterValeur(v, x.s?.format || 'General', 60).texte; })(); const a = o.casse ? t : t.toLowerCase(), b = o.casse ? o.q : o.q.toLowerCase(); if (o.entier ? a === b : a.includes(b)) resultats.push({ fi, r: rr, c: cc }); } }
      };
      const aller = () => { if (!resultats.length) { $('.res-rech', corps).textContent = 'Aucun résultat.'; return; } i = (i + 1) % resultats.length; const x = resultats[i]; if (x.fi !== C.active) changerFeuille(x.fi); selectionner(x.r, x.c); rendreVisible(x.r, x.c); $('.res-rech', corps).textContent = `${i + 1} sur ${resultats.length} — ${C.feuilles[x.fi].nom}!${adresse(x.r, x.c)}`; };
      const rempl = (x) => { const o = lire(); const f = C.feuilles[x.fi]; const cel = f.cellules.get(cle(x.r, x.c)); if (!cel) return 0; const re = new RegExp(o.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), o.casse ? 'g' : 'gi'); if (cel.f) { if (!o.formules) return 0; cel.f = cel.f.replace(re, o.rep); return 1; } if (typeof cel.v === 'string') { const n = o.entier ? o.rep : cel.v.replace(re, o.rep); const a = analyserSaisie(n); cel.v = a.valeur; return 1; } if (typeof cel.v === 'number') { const t = formaterValeur(cel.v, cel.s?.format || 'General', 60).texte; const n = o.entier ? o.rep : t.replace(re, o.rep); const a = analyserSaisie(n); if (a.formule) cel.f = a.formule; else cel.v = a.valeur; return 1; } return 0; };
      $$('[name]', corps).forEach(e => e.addEventListener('input', () => { chercherTout(); $('.res-rech', corps).textContent = lire().q ? `${resultats.length} résultat(s)` : ''; }));
      $('[data-id="suivant"]', v).onclick = () => { if (i < 0) chercherTout(); aller(); };
      $('[data-id="remplacer-un"]', v).onclick = () => { if (!remplacer) return; if (i < 0) { chercherTout(); aller(); return; } avant(); rempl(resultats[i]); apresModif(); chercherTout(); aller(); };
      $('[data-id="tout-remplacer"]', v).onclick = () => { if (!remplacer) return; chercherTout(); if (!resultats.length) return; avant(); let n = 0; resultats.forEach(x => n += rempl(x)); apresModif(); $('.res-rech', corps).textContent = `${n} remplacement(s) effectué(s).`; resultats = []; };
      if (!remplacer) { $('[data-id="tout-remplacer"]', v).style.display = 'none'; $('[data-id="remplacer-un"]', v).style.display = 'none'; }
    }
  });
  void r;
}

// ---------- Fonctions, formats ----------
async function insererFonction(nom) {
  const cats = [...new Set(LISTE_FONCTIONS.map(f => f.cat))];
  const r = await dialogue({
    titre: 'Insérer une fonction', taille: 'large',
    contenu: `<div class="grille-champs"><label class="champ">Rechercher une fonction<input type="search" name="q" placeholder="Décrivez ce que vous voulez faire"></label><label class="champ">Catégorie<select name="cat"><option value="">Toutes</option>${cats.map(c => `<option>${c}</option>`).join('')}</select></label></div><div class="liste-fonctions" id="lf"></div><div class="desc-fonction" id="df"></div><input type="hidden" name="fn">`,
    boutons: [{ label: 'Annuler', valeur: null }, { label: 'Insérer', valeur: true, primaire: true }],
    init: (corps) => {
      const lf = $('#lf', corps), df = $('#df', corps), h = $('[name="fn"]', corps);
      const remplir = () => {
        const q = $('[name="q"]', corps).value.toLowerCase(), cat = $('[name="cat"]', corps).value;
        const l = LISTE_FONCTIONS.filter(f => (!cat || f.cat === cat) && (!q || f.fr.toLowerCase().includes(q) || f.desc.toLowerCase().includes(q) || f.en.toLowerCase().includes(q))).sort((a, b) => a.fr.localeCompare(b.fr));
        lf.innerHTML = l.map(f => `<button type="button" data-fn="${f.fr}">${f.fr}</button>`).join('');
        $$('button', lf).forEach(b => { b.onclick = () => { $$('button', lf).forEach(x => x.classList.remove('actif')); b.classList.add('actif'); const f = FONCTIONS[b.dataset.fn]; h.value = f.fr; df.innerHTML = `<b>${esc(f.syn)}</b><br>${esc(f.desc)}<br><small>Catégorie : ${esc(f.cat)} · Nom anglais : ${esc(f.en)}</small>`; }; b.ondblclick = () => $('.dialogue .btn.primaire').click(); });
        const p = $('button', lf); if (p) p.click();
      };
      $('[name="q"]', corps).oninput = remplir; $('[name="cat"]', corps).onchange = remplir; remplir();
      if (nom) { const b = $(`button[data-fn="${nom}"]`, lf); if (b) b.click(); }
    }
  });
  if (!r || !r.fn) return;
  if (V.edition) { const t = V.edition.depuisBarre ? barre : edTexte; const p = t.selectionStart; t.value = t.value.slice(0, p) + r.fn + '(' + t.value.slice(p); majTexteEdition(t.value, V.edition.depuisBarre ? 'barre' : 'cellule'); t.focus(); t.setSelectionRange(p + r.fn.length + 1, p + r.fn.length + 1); }
  else { commencerEdition({ texte: '=' + r.fn + '(' }); }
}
function sommeAuto(fn = 'SOMME') {
  // =SOMME() de la plage numérique au-dessus (ou à gauche)
  if (S.r1 !== S.r2 || S.c1 !== S.c2) {
    avant();
    const u = plageSel();
    for (let c = u.c1; c <= u.c2; c++) { let r = u.r2 + 1; if (!F().cellules.get(cle(u.r2, c)) || val(u.r2, c) === null) r = u.r2; ecrire(r, c, `=${fn}(${adresse(u.r1, c)}:${adresse(r - 1, c)})`); }
    apresModif(); return;
  }
  let r = S.r - 1; while (r >= 0 && typeof val(r, S.c) === 'number') r--;
  let plage;
  if (r < S.r - 1) plage = `${adresse(r + 1, S.c)}:${adresse(S.r - 1, S.c)}`;
  else { let c = S.c - 1; while (c >= 0 && typeof val(S.r, c) === 'number') c--; plage = c < S.c - 1 ? `${adresse(S.r, c + 1)}:${adresse(S.r, S.c - 1)}` : ''; }
  commencerEdition({ texte: `=${fn}(${plage})` });
  if (plage) { const t = edTexte; t.setSelectionRange(fn.length + 2, fn.length + 2 + plage.length); }
}
async function dialogueFormat() {
  const s = styleActif(); const v = val(S.r, S.c);
  const r = await dialogue({
    titre: 'Format de cellule', taille: 'large',
    contenu: `<div class="grille-champs"><label class="champ">Catégorie<select name="cat">${FORMATS.map(f => `<option value="${esc(f.id)}" ${f.id === (s.format || 'General') ? 'selected' : ''}>${f.nom}</option>`).join('')}<option value="__perso">Personnalisée</option></select></label><label class="champ">Code de format<input type="text" name="code" value="${esc(s.format || 'General')}"></label></div>
      <div class="apercu-format" id="apf"></div>
      <div class="grille-champs"><label class="champ">Alignement horizontal<select name="alignH"><option value="">Standard</option><option value="gauche">Gauche</option><option value="centre">Centré</option><option value="droite">Droite</option></select></label><label class="champ">Alignement vertical<select name="alignV"><option value="">Bas</option><option value="milieu">Centré</option><option value="haut">Haut</option></select></label></div>
      <div style="display:flex;gap:16px;flex-wrap:wrap"><label class="case"><input type="checkbox" name="retour" ${s.retour ? 'checked' : ''}> Renvoyer à la ligne automatiquement</label><label class="champ" style="flex-direction:row;align-items:center;gap:8px">Retrait <input type="number" name="retrait" min="0" max="15" value="${s.retrait || 0}" style="width:60px"></label></div>
      <div class="grille-champs"><label class="champ">Police<input type="text" name="police" value="${esc(s.police || 'Calibri')}"></label><label class="champ">Taille<input type="number" name="taille" min="6" max="72" value="${s.taille || 11}"></label></div>`,
    boutons: [{ label: 'Annuler', valeur: null }, { label: 'OK', valeur: true, primaire: true }],
    init: (corps) => {
      $('[name="alignH"]', corps).value = s.alignH || ''; $('[name="alignV"]', corps).value = s.alignV || '';
      const ap = () => { const code = $('[name="code"]', corps).value || 'General'; $('#apf', corps).textContent = 'Aperçu : ' + (v == null ? '' : formaterValeur(typeof v === 'number' ? v : v, code, 40).texte); };
      $('[name="cat"]', corps).onchange = e => { if (e.target.value !== '__perso') $('[name="code"]', corps).value = e.target.value; ap(); };
      $('[name="code"]', corps).oninput = ap; ap();
    }
  });
  if (!r) return;
  appliquerStyle({ format: r.code && r.code !== 'General' ? r.code : null, alignH: r.alignH || null, alignV: r.alignV || null, retour: r.retour || null, retrait: +r.retrait || null, police: r.police && r.police !== 'Calibri' ? r.police : null, taille: +r.taille && +r.taille !== 11 ? +r.taille : null });
}

// ---------- Graphiques (insertion, modification) ----------
function insererGraphique(type) {
  const p = regionCourante();
  if (p.r1 === p.r2 && p.c1 === p.c2 && val(p.r1, p.c1) == null) return toast('Sélectionnez les données à représenter (avec les en-têtes).');
  avant();
  const id = 'g' + Date.now().toString(36);
  const x = (posC[p.c2 + 1] || 0) / V.zoom + 24, y = Math.max(0, (posL[p.r1] || 0) / V.zoom);
  const titre = p.r1 < p.r2 && p.c1 < p.c2 && typeof val(p.r1, p.c1) === 'string' ? '' : '';
  F().graphiques.push({ id, type, titre: titre || 'Titre du graphique', plage: p, legende: type === 'secteurs' || type === 'anneau' ? 'droite' : 'bas', x, y, l: 480, h: 300 });
  modifie(); rendreGraphiques(); selectionnerGraphique(id);
}
const graphCourant = () => F().graphiques.find(g => g.id === V.graphSel);
async function modifierGraphique() {
  const g = graphCourant(); if (!g) return;
  const plageTxt = `${adresse(g.plage.r1, g.plage.c1)}:${adresse(g.plage.r2, g.plage.c2)}`;
  const r = await dialogue({ titre: 'Modifier le graphique', contenu: `<label class="champ">Titre<input type="text" name="titre" value="${esc(g.titre || '')}"></label><div class="grille-champs"><label class="champ">Type<select name="type">${TYPES_GRAPHIQUES.map(([v, l]) => `<option value="${v}" ${v === g.type ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label class="champ">Données<input type="text" name="plage" value="${plageTxt}"></label><label class="champ">Légende<select name="legende"><option value="bas">En bas</option><option value="droite">À droite</option><option value="aucune">Aucune</option></select></label><label class="champ">Séries<select name="series"><option value="col">En colonnes</option><option value="lig">En lignes</option></select></label></div><label class="case"><input type="checkbox" name="etiquettes" ${g.etiquettes ? 'checked' : ''}> Afficher les étiquettes de données</label>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'OK', valeur: true, primaire: true }], init: c => { $('[name="legende"]', c).value = g.legende || 'bas'; $('[name="series"]', c).value = g.serieEnLignes ? 'lig' : 'col'; } });
  if (!r) return;
  const p = lirePlage(r.plage.replace(/\$/g, '')); if (!p) return toast('Plage de données invalide.', 'erreur');
  avant(); Object.assign(g, { titre: r.titre, type: r.type, plage: p, legende: r.legende, etiquettes: r.etiquettes, serieEnLignes: r.series === 'lig' }); modifie(); rendreGraphiques();
}
function supprimerGraphique() { const g = graphCourant(); if (!g) return; avant(); F().graphiques = F().graphiques.filter(x => x !== g); selectionnerGraphique(null); modifie(); rendreGraphiques(); }

// ---------- Feuilles ----------
function rendreOnglets() {
  const b = $('#barre-onglets');
  b.innerHTML = `<div class="nav"><button class="ajout-feuille" data-a="prec" title="Feuille précédente">${ico('chevron-left', 'p')}</button><button class="ajout-feuille" data-a="suiv" title="Feuille suivante">${ico('chevron-right', 'p')}</button></div>` + C.feuilles.map((f, i) => `<button class="onglet-f ${i === C.active ? 'actif' : ''}" data-i="${i}" draggable="true" title="${esc(f.nom)}">${esc(f.nom)}${f.couleurOnglet ? `<span class="pastille-c" style="background:${f.couleurOnglet}"></span>` : ''}</button>`).join('') + `<button class="ajout-feuille" data-a="ajout" title="Nouvelle feuille (Maj+F11)" aria-label="Nouvelle feuille">${ico('plus')}</button>`;
  $$('.onglet-f', b).forEach(o => {
    o.onclick = () => changerFeuille(+o.dataset.i);
    o.ondblclick = () => renommerFeuille(+o.dataset.i);
    o.oncontextmenu = e => { e.preventDefault(); changerFeuille(+o.dataset.i); menuFeuille(e.clientX, e.clientY); };
    o.ondragstart = e => { e.dataTransfer.setData('text/plain', o.dataset.i); };
    o.ondragover = e => e.preventDefault();
    o.ondrop = e => { e.preventDefault(); const de = +e.dataTransfer.getData('text/plain'), vers = +o.dataset.i; if (de === vers) return; avant(); const [f] = C.feuilles.splice(de, 1); C.feuilles.splice(vers, 0, f); C.active = vers; toutRecalculer(); modifie(); };
  });
  b.onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'ajout') ajouterFeuille(); if (a === 'prec' && C.active > 0) changerFeuille(C.active - 1); if (a === 'suiv' && C.active < C.feuilles.length - 1) changerFeuille(C.active + 1); };
}
function menuFeuille(x, y) {
  menu([
    { label: 'Insérer une feuille', ico: 'plus', faire: ajouterFeuille },
    { label: 'Supprimer', ico: 'trash-2', faire: supprimerFeuille, desactive: C.feuilles.length < 2 },
    { label: 'Renommer', ico: 'pencil', faire: () => renommerFeuille(C.active) },
    { label: 'Dupliquer', ico: 'copy', faire: dupliquerFeuille },
    { label: 'Couleur d\'onglet…', ico: 'palette', faire: async () => { const c = await choisirCouleur($(`.onglet-f[data-i="${C.active}"]`), { aucune: true }); if (c) { avant(); F().couleurOnglet = c === 'transparent' ? null : c; rendreOnglets(); modifie(); } } },
    '-',
    { label: 'Déplacer vers la gauche', faire: () => deplacerFeuille(-1), desactive: C.active === 0 },
    { label: 'Déplacer vers la droite', faire: () => deplacerFeuille(1), desactive: C.active === C.feuilles.length - 1 },
    '-',
    { label: F().protegee ? 'Ôter la protection de la feuille' : 'Protéger la feuille', ico: 'lock', faire: () => { avant(); F().protegee = !F().protegee; modifie(); toast(F().protegee ? 'Feuille protégée : les cellules ne peuvent plus être modifiées.' : 'Protection ôtée.'); } },
  ], x, y);
}
function changerFeuille(i) { if (V.edition) validerEdition('aucune'); C.active = i; V.graphSel = null; ruban.contextuel('graphique', false); defile.scrollTop = 0; defile.scrollLeft = 0; S.r = S.c = S.r1 = S.c1 = S.r2 = S.c2 = 0; calculerGeometrie(); rendreOnglets(); selectionner(0, 0); majRubanEtat(); }
function nomLibre(base) { let n = C.feuilles.length + 1; while (C.feuilles.some(f => f.nom.toLowerCase() === `${base}${n}`.toLowerCase())) n++; return base + n; }
function ajouterFeuille() { avant(); C.feuilles.splice(C.active + 1, 0, nouvelleFeuille(nomLibre('Feuil'))); changerFeuille(C.active + 1); modifie(); }
async function supprimerFeuille() {
  if (C.feuilles.length < 2) return;
  if (F().cellules.size && !(await confirmer('Supprimer la feuille', `La feuille « ${F().nom} » et son contenu seront supprimés.`, 'Supprimer', true))) return;
  avant(); C.feuilles.splice(C.active, 1); changerFeuille(Math.max(0, C.active - 1)); toutRecalculer(); modifie();
}
async function renommerFeuille(i) {
  const ancien = C.feuilles[i].nom;
  const n = await demander('Renommer la feuille', 'Nom de la feuille', ancien);
  if (n == null) return; const nom = n.trim().slice(0, 31);
  if (!nom || /[\\/?*[\]:]/.test(nom)) return toast('Nom invalide : 31 caractères au plus, sans \\ / ? * [ ] :', 'erreur');
  if (C.feuilles.some((f, k) => k !== i && f.nom.toLowerCase() === nom.toLowerCase())) return toast('Une feuille porte déjà ce nom.', 'erreur');
  avant(); C.feuilles[i].nom = nom;
  C.feuilles.forEach(f => { for (const x of f.cellules.values()) if (x.f) x.f = renommerFeuilleDansFormule(x.f, ancien, nom); });
  toutRecalculer(); modifie();
}
function dupliquerFeuille() { avant(); const o = serialiser({ ...C, feuilles: [F()] }); const copie = deserialiser(o).feuilles[0]; copie.nom = nomLibre(F().nom.replace(/\s*\(\d+\)$/, '') + ' ('); copie.nom = `${F().nom} (2)`; let k = 2; while (C.feuilles.some(f => f.nom === copie.nom)) copie.nom = `${F().nom} (${++k})`; copie.graphiques.forEach(g => g.id = 'g' + Math.random().toString(36).slice(2, 8)); C.feuilles.splice(C.active + 1, 0, copie); changerFeuille(C.active + 1); modifie(); }
function deplacerFeuille(d) { avant(); const i = C.active, j = i + d; [C.feuilles[i], C.feuilles[j]] = [C.feuilles[j], C.feuilles[i]]; C.active = j; rendreOnglets(); modifie(); }

// ---------- Figer, zoom, affichage ----------
function figer(mode) {
  avant(); const f = F();
  if (mode === 'aucun' || (mode === 'selection' && (f.figer.l || f.figer.c))) f.figer = { l: 0, c: 0 };
  else if (mode === 'ligne') f.figer = { l: 1, c: 0 };
  else if (mode === 'colonne') f.figer = { l: 0, c: 1 };
  else f.figer = { l: S.r, c: S.c };
  defile.scrollTop = 0; defile.scrollLeft = 0; calculerGeometrie(); rendre(); modifie();
}
function definirZoom(z) { V.zoom = Math.min(4, Math.max(0.25, Math.round(z * 100) / 100)); calculerGeometrie(); rendre(); $('#zoom-val').textContent = Math.round(V.zoom * 100) + ' %'; $('#zoom-curseur').value = Math.round(V.zoom * 100); }

// ---------- Barre d'état ----------
function majEtat() {
  const p = plageSel(); let n = 0, nb = 0, s = 0, mn = Infinity, mx = -Infinity;
  if ((p.r2 - p.r1 + 1) * (p.c2 - p.c1 + 1) <= 200000) for (let r = p.r1; r <= p.r2; r++) for (let c = p.c1; c <= p.c2; c++) { if (lignesFiltrees.has(r)) continue; const v = val(r, c); if (v == null || v === '') continue; n++; if (typeof v === 'number') { nb++; s += v; mn = Math.min(mn, v); mx = Math.max(mx, v); } }
  const fmt = x => formaterValeur(x, styleActif().format && !estFormatDate(styleActif().format) ? styleActif().format : 'General', 16).texte;
  $('#etat-stats').textContent = n > 1 ? (nb ? `Moyenne : ${fmt(s / nb)}   Nb : ${n}   Somme : ${fmt(s)}${nb > 1 ? `   Min : ${fmt(mn)}   Max : ${fmt(mx)}` : ''}` : `Nb : ${n}`) : '';
  $('#etat-mode').textContent = V.edition ? 'Modifier' : 'Prêt';
}

// ---------- Ruban ----------
const POLICES = ['Calibri', 'Arial', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Marianne', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const ruban = creerRuban($('#zone-ruban'), [
  { id: 'accueil', titre: 'Accueil', groupes: [
    { titre: 'Presse-papiers', items: [{ type: 'bouton', id: 'coller', ico: 'clipboard-paste', label: 'Coller', grand: true }, { type: 'pile', items: [{ type: 'bouton', id: 'couper', ico: 'scissors', label: 'Couper', avecLabel: true }, { type: 'bouton', id: 'copier', ico: 'copy', label: 'Copier', avecLabel: true }, { type: 'bouton', id: 'collage-special', ico: 'clipboard-list', label: 'Collage spécial', avecLabel: true }] }] },
    { titre: 'Police', items: [{ type: 'pile', items: [
      { type: 'ligne', items: [{ type: 'select', id: 'police', title: 'Police', options: POLICES, largeur: 130 }, { type: 'select', id: 'taille', title: 'Taille de police', options: ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '36'], largeur: 54 }, { type: 'bouton', id: 'agrandir', ico: 'a-arrow-up', title: 'Augmenter la taille de police' }, { type: 'bouton', id: 'reduire', ico: 'a-arrow-down', title: 'Diminuer la taille de police' }] },
      { type: 'ligne', items: [{ type: 'bascule', id: 'gras', ico: 'bold', title: 'Gras (Ctrl+G)' }, { type: 'bascule', id: 'italique', ico: 'italic', title: 'Italique (Ctrl+I)' }, { type: 'bascule', id: 'souligne', ico: 'underline', title: 'Souligné (Ctrl+U)' }, { type: 'bascule', id: 'barre', ico: 'strikethrough', title: 'Barré' }, { type: 'sep' },
        { type: 'menu', id: 'bordures', ico: 'grid-2x2', title: 'Bordures', items: () => [['toutes', 'Toutes les bordures', 'grid-3x3'], ['contour', 'Bordure extérieure', 'square'], ['contour-epais', 'Bordure épaisse en encadré', 'square'], ['bas', 'Bordure inférieure', 'panel-bottom'], ['haut', 'Bordure supérieure', 'panel-top'], ['gauche', 'Bordure gauche', 'panel-left'], ['droite', 'Bordure droite', 'panel-right'], ['double-bas', 'Double bordure inférieure', 'equal'], ['aucune', 'Aucune bordure', 'square-dashed']].map(([t, l, i]) => ({ label: l, ico: i, faire: () => bordures(t) })) },
        { type: 'couleur', id: 'fond', ico: 'paint-bucket', title: 'Couleur de remplissage', defaut: '#FFFF00', aucune: true, labelAucune: 'Aucun remplissage', applicationDirecte: true },
        { type: 'couleur', id: 'couleur-texte', ico: 'baseline', title: 'Couleur de police', defaut: '#C00000', aucune: true, labelAucune: 'Automatique', applicationDirecte: true }] },
    ] }] },
    { titre: 'Alignement', items: [{ type: 'pile', items: [
      { type: 'ligne', items: [{ type: 'bascule', id: 'v-haut', ico: 'align-vertical-justify-start', title: 'Aligner en haut' }, { type: 'bascule', id: 'v-milieu', ico: 'align-vertical-justify-center', title: 'Aligner au centre' }, { type: 'bascule', id: 'v-bas', ico: 'align-vertical-justify-end', title: 'Aligner en bas' }, { type: 'sep' }, { type: 'bascule', id: 'retour', ico: 'wrap-text', title: 'Renvoyer à la ligne automatiquement' }] },
      { type: 'ligne', items: [{ type: 'bascule', id: 'a-gauche', ico: 'align-left', title: 'Aligner à gauche' }, { type: 'bascule', id: 'a-centre', ico: 'align-center', title: 'Centrer' }, { type: 'bascule', id: 'a-droite', ico: 'align-right', title: 'Aligner à droite' }, { type: 'bouton', id: 'retrait-moins', ico: 'indent-decrease', title: 'Diminuer le retrait' }, { type: 'bouton', id: 'retrait-plus', ico: 'indent-increase', title: 'Augmenter le retrait' }] },
    ] }, { type: 'menu', id: 'fusion', ico: 'combine', label: 'Fusionner et centrer', grand: true, items: () => [{ label: 'Fusionner et centrer', faire: () => fusionner(true) }, { label: 'Fusionner sur chaque ligne', faire: () => fusionner(false, true) }, { label: 'Fusionner les cellules', faire: () => fusionner(false) }, { label: 'Annuler la fusion', faire: defusionner }] }] },
    { titre: 'Nombre', items: [{ type: 'pile', items: [
      { type: 'select', id: 'format', title: 'Format de nombre', options: FORMATS.map(f => [f.id, f.nom]), largeur: 150 },
      { type: 'ligne', items: [{ type: 'bouton', id: 'f-euro', ico: 'euro', title: 'Format monétaire' }, { type: 'bouton', id: 'f-pct', ico: 'percent', title: 'Style de pourcentage' }, { type: 'bouton', id: 'f-milliers', ico: 'hash', title: 'Séparateur de milliers' }, { type: 'bouton', id: 'dec-plus', ico: 'decimals-arrow-right', title: 'Ajouter une décimale' }, { type: 'bouton', id: 'dec-moins', ico: 'decimals-arrow-left', title: 'Réduire les décimales' }] },
    ] }] },
    { titre: 'Styles', items: [{ type: 'menu', id: 'mfc', ico: 'paintbrush-vertical', label: 'Mise en forme cond.', title: 'Mise en forme conditionnelle', grand: true, items: () => [{ titre: 'Règles de mise en surbrillance' }, { label: 'Supérieur à…', faire: () => dialogueMFC('sup') }, { label: 'Inférieur à…', faire: () => dialogueMFC('inf') }, { label: 'Entre…', faire: () => dialogueMFC('entre') }, { label: 'Égal à…', faire: () => dialogueMFC('egal') }, { label: 'Texte qui contient…', faire: () => dialogueMFC('contient') }, { label: 'Valeurs en double', faire: () => dialogueMFC('doublons') }, '-', { label: 'Barres de données', ico: 'chart-bar', faire: () => dialogueMFC('barres') }, { label: 'Nuances de couleurs', ico: 'palette', faire: () => dialogueMFC('echelle') }, '-', { label: 'Effacer les règles des cellules sélectionnées', faire: () => dialogueMFC('effacer') }, { label: 'Effacer les règles de la feuille', faire: () => dialogueMFC('effacer-tout') }] }, { type: 'menu', id: 'styles-cellules', ico: 'swatch-book', label: 'Styles de cellules', grand: true, items: () => [['Titre', { gras: true, taille: 15, couleur: '#1F3864' }], ['En-tête', { gras: true, fond: '#1E7444', couleur: '#FFFFFF' }], ['Total', { gras: true, bordures: { h: { style: 'thin', couleur: '#1E7444' }, b: { style: 'double', couleur: '#1E7444' } } }], ['Bon', { fond: '#C6EFCE', couleur: '#006100' }], ['Neutre', { fond: '#FFEB9C', couleur: '#9C5700' }], ['Insatisfaisant', { fond: '#FFC7CE', couleur: '#9C0006' }], ['Remarque', { fond: '#FFFFCC', bordures: { h: { style: 'thin', couleur: '#B2B2B2' }, b: { style: 'thin', couleur: '#B2B2B2' }, g: { style: 'thin', couleur: '#B2B2B2' }, d: { style: 'thin', couleur: '#B2B2B2' } } }], ['Normal', null]].map(([l, s]) => ({ label: l, faire: () => appliquerStyle(s ? s : { gras: null, italique: null, souligne: null, barre: null, couleur: null, fond: null, taille: null, police: null, bordures: null, alignH: null, alignV: null, retour: null }) })) }] },
    { titre: 'Cellules', items: [{ type: 'pile', items: [{ type: 'menu', id: 'inserer', ico: 'table-rows-split', label: 'Insérer', avecLabel: true, items: () => [{ label: 'Insérer des cellules…', faire: dialogueInserer }, { label: 'Insérer des lignes', faire: () => inserer('r', S.r1, S.r2 - S.r1 + 1) }, { label: 'Insérer des colonnes', faire: () => inserer('c', S.c1, S.c2 - S.c1 + 1) }, { label: 'Insérer une feuille', faire: ajouterFeuille }] }, { type: 'menu', id: 'supprimer', ico: 'table-columns-split', label: 'Supprimer', avecLabel: true, items: () => [{ label: 'Supprimer des cellules…', faire: dialogueSupprimer }, { label: 'Supprimer des lignes', faire: () => supprimer('r', S.r1, Math.min(S.r2, 99999) - S.r1 + 1) }, { label: 'Supprimer des colonnes', faire: () => supprimer('c', S.c1, Math.min(S.c2, 9999) - S.c1 + 1) }, { label: 'Supprimer la feuille', faire: supprimerFeuille }] }, { type: 'menu', id: 'format-cel', ico: 'settings-2', label: 'Format', avecLabel: true, items: () => [{ label: 'Hauteur de ligne…', faire: () => dialogueTaille('r') }, { label: 'Ajuster la hauteur de ligne', faire: () => ajusterHauteur(S.r) }, { label: 'Largeur de colonne…', faire: () => dialogueTaille('c') }, { label: 'Ajuster la largeur de colonne', faire: () => { avant(); for (let c = S.c1; c <= Math.min(S.c2, etendue(F()).c2); c++) ajusterLargeur(c, true); } }, '-', { label: 'Masquer les lignes', faire: () => masquer('r') }, { label: 'Masquer les colonnes', faire: () => masquer('c') }, { label: 'Afficher les lignes', faire: () => afficherMasques('r') }, { label: 'Afficher les colonnes', faire: () => afficherMasques('c') }, '-', { label: 'Renommer la feuille', faire: () => renommerFeuille(C.active) }, { label: F().protegee ? 'Ôter la protection de la feuille' : 'Protéger la feuille', faire: () => { avant(); F().protegee = !F().protegee; modifie(); } }, '-', { label: 'Format de cellule…', faire: dialogueFormat }] }] }] },
    { titre: 'Édition', items: [{ type: 'pile', items: [
      { type: 'menu', id: 'somme-auto', ico: 'sigma', label: 'Somme automatique', avecLabel: true, items: () => [['SOMME', 'Somme'], ['MOYENNE', 'Moyenne'], ['NB', 'Nombres'], ['MAX', 'Max'], ['MIN', 'Min']].map(([f, l]) => ({ label: l, faire: () => sommeAuto(f) })).concat(['-', { label: 'Autres fonctions…', faire: () => insererFonction() }]) },
      { type: 'menu', id: 'effacer', ico: 'eraser', label: 'Effacer', avecLabel: true, items: () => [{ label: 'Effacer tout', faire: () => effacer('tout') }, { label: 'Effacer les formats', faire: () => effacer('formats') }, { label: 'Effacer le contenu', faire: () => effacer('contenu') }, { label: 'Effacer les notes', faire: () => effacer('notes') }] },
      { type: 'menu', id: 'recopier', ico: 'arrow-down-to-line', label: 'Recopier', avecLabel: true, items: () => [{ label: 'En bas (Ctrl+D)', faire: () => recopierVers('bas') }, { label: 'À droite (Ctrl+R)', faire: () => recopierVers('droite') }] },
    ] }, { type: 'pile', items: [
      { type: 'menu', id: 'trier-filtrer', ico: 'arrow-down-wide-narrow', label: 'Trier et filtrer', avecLabel: true, items: () => [{ label: 'Trier de A à Z', ico: 'arrow-down-a-z', faire: () => trier([{ col: S.c, ordre: 1 }]) }, { label: 'Trier de Z à A', ico: 'arrow-down-z-a', faire: () => trier([{ col: S.c, ordre: -1 }]) }, { label: 'Tri personnalisé…', faire: triPersonnalise }, '-', { label: F().filtre ? 'Retirer le filtre' : 'Filtrer', ico: 'funnel', faire: basculerFiltre }, { label: 'Effacer les filtres', faire: effacerFiltres, desactive: !F().filtre }] },
      { type: 'bouton', id: 'rechercher', ico: 'search', label: 'Rechercher', avecLabel: true },
      { type: 'bouton', id: 'remplacer', ico: 'replace', label: 'Remplacer', avecLabel: true },
    ] }] },
  ] },
  { id: 'insertion', titre: 'Insertion', groupes: [
    { titre: 'Graphiques', items: TYPES_GRAPHIQUES.map(([t, l, i]) => ({ type: 'bouton', id: 'g-' + t, ico: i, label: l, grand: true })) },
    { titre: 'Liens', items: [{ type: 'bouton', id: 'lien', ico: 'link', label: 'Lien', grand: true }] },
    { titre: 'Notes', items: [{ type: 'bouton', id: 'note', ico: 'sticky-note', label: 'Note', grand: true }] },
    { titre: 'Données', items: [{ type: 'bouton', id: 'ins-date', ico: 'calendar', label: 'Date du jour', grand: true }, { type: 'bouton', id: 'ins-heure', ico: 'clock', label: 'Heure', grand: true }] },
  ] },
  { id: 'formules', titre: 'Formules', groupes: [
    { titre: 'Bibliothèque de fonctions', items: [{ type: 'bouton', id: 'fx', ico: 'square-function', label: 'Insérer une fonction', grand: true }, { type: 'menu', id: 'somme-auto2', ico: 'sigma', label: 'Somme automatique', grand: true, items: () => [['SOMME', 'Somme'], ['MOYENNE', 'Moyenne'], ['NB', 'Nombres'], ['MAX', 'Max'], ['MIN', 'Min']].map(([f, l]) => ({ label: l, faire: () => sommeAuto(f) })) },
      ...['Maths', 'Statistiques', 'Logique', 'Texte', 'Date et heure', 'Recherche', 'Finances', 'Information'].map(cat => ({ type: 'menu', id: 'cat-' + cat, ico: { Maths: 'calculator', Statistiques: 'chart-column', Logique: 'git-branch', Texte: 'type', 'Date et heure': 'calendar', Recherche: 'search', Finances: 'landmark', Information: 'info' }[cat], label: cat, grand: true, items: () => LISTE_FONCTIONS.filter(f => f.cat === cat).sort((a, b) => a.fr.localeCompare(b.fr)).map(f => ({ label: f.fr, faire: () => insererFonction(f.fr) })) }))] },
    { titre: 'Audit', items: [{ type: 'bascule', id: 'voir-formules', ico: 'eye', label: 'Afficher les formules', grand: true }, { type: 'bouton', id: 'recalculer', ico: 'refresh-cw', label: 'Calculer maintenant', grand: true }] },
  ] },
  { id: 'donnees', titre: 'Données', groupes: [
    { titre: 'Trier et filtrer', items: [{ type: 'bouton', id: 'tri-az', ico: 'arrow-down-a-z', label: 'Trier A→Z', grand: true }, { type: 'bouton', id: 'tri-za', ico: 'arrow-down-z-a', label: 'Trier Z→A', grand: true }, { type: 'bouton', id: 'tri-perso', ico: 'arrow-down-wide-narrow', label: 'Trier…', grand: true }, { type: 'bascule', id: 'filtrer', ico: 'funnel', label: 'Filtrer', grand: true }, { type: 'bouton', id: 'effacer-filtres', ico: 'funnel-x', label: 'Effacer', grand: true }] },
    { titre: 'Outils de données', items: [{ type: 'bouton', id: 'doublons', ico: 'copy-x', label: 'Supprimer les doublons', grand: true }, { type: 'bouton', id: 'validation', ico: 'list-checks', label: 'Validation des données', grand: true }, { type: 'bouton', id: 'convertir', ico: 'columns-3', label: 'Convertir', grand: true, title: 'Convertir le texte en colonnes' }] },
  ] },
  { id: 'mise-en-page', titre: 'Mise en page', groupes: [
    { titre: 'Mise en page', items: [{ type: 'menu', id: 'orientation', ico: 'rotate-ccw-square', label: 'Orientation', grand: true, items: () => [{ label: 'Portrait', coche: !F().impression?.paysage, faire: () => { F().impression = { ...(F().impression || {}), paysage: false }; modifie(); } }, { label: 'Paysage', coche: !!F().impression?.paysage, faire: () => { F().impression = { ...(F().impression || {}), paysage: true }; modifie(); } }] }, { type: 'bascule', id: 'ajuster', ico: 'shrink', label: 'Ajuster à la largeur', grand: true }, { type: 'bascule', id: 'imp-grille', ico: 'grid-3x3', label: 'Imprimer le quadrillage', grand: true }] },
  ] },
  { id: 'affichage', titre: 'Affichage', groupes: [
    { titre: 'Afficher', items: [{ type: 'bascule', id: 'quadrillage', ico: 'grid-3x3', label: 'Quadrillage', grand: true }] },
    { titre: 'Zoom', items: [{ type: 'bouton', id: 'zoom-100', ico: 'zoom-in', label: '100 %', grand: true }, { type: 'bouton', id: 'zoom-sel', ico: 'scan', label: 'Zoom sur la sélection', grand: true }] },
    { titre: 'Fenêtre', items: [{ type: 'menu', id: 'figer', ico: 'snowflake', label: 'Figer les volets', grand: true, items: () => [{ label: (F().figer.l || F().figer.c) ? 'Libérer les volets' : 'Figer les volets', faire: () => figer((F().figer.l || F().figer.c) ? 'aucun' : 'selection') }, { label: 'Figer la ligne supérieure', faire: () => figer('ligne') }, { label: 'Figer la première colonne', faire: () => figer('colonne') }] }, { type: 'bouton', id: 'nouvelle-fenetre', ico: 'app-window', label: 'Nouvelle fenêtre', grand: true }] },
  ] },
  { id: 'graphique', titre: 'Graphique', contextuel: true, groupes: [
    { titre: 'Type', items: TYPES_GRAPHIQUES.map(([t, l, i]) => ({ type: 'bouton', id: 'gt-' + t, ico: i, label: l, grand: true })) },
    { titre: 'Graphique', items: [{ type: 'bouton', id: 'g-modifier', ico: 'pencil', label: 'Modifier', grand: true }, { type: 'bouton', id: 'g-supprimer', ico: 'trash-2', label: 'Supprimer', grand: true }] },
  ] },
], {
  onFichier: () => doc.ouvrirCoulisses('accueil'),
  actions: {
    coller: () => collerDepuisPressePapiers(), couper: () => copier(true), copier: () => copier(false), 'collage-special': collageSpecial,
    police: v => appliquerStyle({ police: v === 'Calibri' ? null : v }), taille: v => appliquerStyle({ taille: +v === 11 ? null : +v }),
    agrandir: () => appliquerStyle(s => ({ taille: Math.min(72, (s.taille || 11) + 1) })), reduire: () => appliquerStyle(s => ({ taille: Math.max(6, (s.taille || 11) - 1) })),
    gras: () => basculer('gras'), italique: () => basculer('italique'), souligne: () => basculer('souligne'), barre: () => basculer('barre'),
    fond: c => appliquerStyle({ fond: c === 'transparent' ? null : c }), 'couleur-texte': c => appliquerStyle({ couleur: c === 'transparent' ? null : c }),
    'v-haut': () => appliquerStyle({ alignV: 'haut' }), 'v-milieu': () => appliquerStyle({ alignV: 'milieu' }), 'v-bas': () => appliquerStyle({ alignV: null }), retour: () => basculer('retour'),
    'a-gauche': () => appliquerStyle({ alignH: styleActif().alignH === 'gauche' ? null : 'gauche' }), 'a-centre': () => appliquerStyle({ alignH: styleActif().alignH === 'centre' ? null : 'centre' }), 'a-droite': () => appliquerStyle({ alignH: styleActif().alignH === 'droite' ? null : 'droite' }),
    'retrait-plus': () => appliquerStyle(s => ({ retrait: Math.min(15, (s.retrait || 0) + 1), alignH: s.alignH === 'droite' ? 'droite' : 'gauche' })), 'retrait-moins': () => appliquerStyle(s => ({ retrait: Math.max(0, (s.retrait || 0) - 1) || null })),
    format: v => appliquerStyle({ format: v === 'General' ? null : v }),
    'f-euro': () => appliquerStyle({ format: '#,##0.00 "€"' }), 'f-pct': () => appliquerStyle({ format: '0%' }), 'f-milliers': () => appliquerStyle({ format: '#,##0.00' }),
    'dec-plus': () => appliquerStyle(s => ({ format: changerDecimales(s.format || 'General', 1) })), 'dec-moins': () => appliquerStyle(s => ({ format: changerDecimales(s.format || 'General', -1) })),
    rechercher: () => rechercher(false), remplacer: () => rechercher(true),
    lien: insererLien, note: noteCellule, 'ins-date': () => { avant(); ecrire(S.r, S.c, new Date().toLocaleDateString('fr-FR')); apresModif(); }, 'ins-heure': () => { avant(); ecrire(S.r, S.c, new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })); apresModif(); },
    fx: () => insererFonction(), 'voir-formules': () => { V.montrerFormules = !V.montrerFormules; ruban.actif('voir-formules', V.montrerFormules); rendre(); }, recalculer: () => { recalculer(); rendre(); toast('Classeur recalculé.'); },
    'tri-az': () => trier([{ col: S.c, ordre: 1 }]), 'tri-za': () => trier([{ col: S.c, ordre: -1 }]), 'tri-perso': triPersonnalise, filtrer: basculerFiltre, 'effacer-filtres': effacerFiltres,
    doublons: supprimerDoublons, validation: dialogueValidation, convertir: convertirColonnes,
    ajuster: () => { avant(); F().impression = { ...(F().impression || {}), ajuster: !F().impression?.ajuster }; majRubanEtat(); modifie(); },
    'imp-grille': () => { avant(); F().impression = { ...(F().impression || {}), grille: !F().impression?.grille }; majRubanEtat(); modifie(); },
    quadrillage: () => { avant(); F().quadrillage = F().quadrillage === false; majRubanEtat(); rendre(); modifie(); },
    'zoom-100': () => definirZoom(1), 'zoom-sel': () => { const w = posC[S.c2 + 1] - posC[S.c1], h = posL[S.r2 + 1] - posL[S.r1]; definirZoom(V.zoom * Math.min(defile.clientWidth / Math.max(w, 1), defile.clientHeight / Math.max(h, 1), 4)); rendreVisible(S.r1, S.c1); },
    'nouvelle-fenetre': () => Fi.NATIF ? Fi.appelApi('/api/lancer-app', { id: 'calcul' }) : window.open(location.href, '_blank'),
    'g-modifier': modifierGraphique, 'g-supprimer': supprimerGraphique,
    ...Object.fromEntries(TYPES_GRAPHIQUES.map(([t]) => ['g-' + t, () => insererGraphique(t)])),
    ...Object.fromEntries(TYPES_GRAPHIQUES.map(([t]) => ['gt-' + t, () => { const g = graphCourant(); if (g) { avant(); g.type = t; modifie(); rendreGraphiques(); } }])),
  }
});
function majRubanEtat() {
  const s = styleActif();
  ruban.actif('gras', !!s.gras); ruban.actif('italique', !!s.italique); ruban.actif('souligne', !!s.souligne); ruban.actif('barre', !!s.barre);
  ruban.actif('a-gauche', s.alignH === 'gauche'); ruban.actif('a-centre', s.alignH === 'centre'); ruban.actif('a-droite', s.alignH === 'droite');
  ruban.actif('v-haut', s.alignV === 'haut'); ruban.actif('v-milieu', s.alignV === 'milieu'); ruban.actif('v-bas', !s.alignV); ruban.actif('retour', !!s.retour);
  ruban.valeur('police', s.police || 'Calibri'); ruban.valeur('taille', String(s.taille || 11));
  ruban.valeur('format', FORMATS.some(f => f.id === (s.format || 'General')) ? (s.format || 'General') : '');
  ruban.actif('filtrer', !!F().filtre); ruban.actif('quadrillage', F().quadrillage !== false);
  ruban.actif('ajuster', !!F().impression?.ajuster); ruban.actif('imp-grille', !!F().impression?.grille);
}
async function convertirColonnes() {
  const r = await dialogue({ titre: 'Convertir le texte en colonnes', contenu: `<p>Sépare le contenu des cellules sélectionnées (une colonne) en plusieurs colonnes.</p><label class="champ">Séparateur<select name="sep"><option value=";">Point-virgule</option><option value=",">Virgule</option><option value="\t">Tabulation</option><option value=" ">Espace</option><option value="autre">Autre…</option></select></label><label class="champ">Autre séparateur<input type="text" name="autre" maxlength="3"></label>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Convertir', valeur: true, primaire: true }] });
  if (!r) return; const sep = r.sep === 'autre' ? r.autre : r.sep; if (!sep) return;
  avant(); const p = plageSel();
  for (let rr = p.r1; rr <= p.r2; rr++) { const v = val(rr, p.c1); if (typeof v !== 'string') continue; v.split(sep).forEach((x, j) => ecrire(rr, p.c1 + j, x.trim())); }
  apresModif();
}

// ---------- Impression ----------
function preparerImpression(selection = false) {
  const z = $('#zone-impression'); const f = F();
  const p = selection && (S.r1 !== S.r2 || S.c1 !== S.c2) ? plageSel() : (() => { const u = etendue(f); return { r1: 0, c1: 0, r2: Math.max(0, u.r2), c2: Math.max(0, u.c2) }; })();
  let h = `<table>`;
  const largeurs = range(p.c1, p.c2).map(c => f.colMasquees.includes(c) ? 0 : (f.largeurs[c] ?? LARGEUR_DEF));
  h += `<colgroup>${largeurs.map(w => `<col style="width:${w}px">`).join('')}</colgroup>`;
  for (let r = p.r1; r <= p.r2; r++) {
    if (f.ligMasquees.includes(r) || lignesFiltrees.has(r)) continue;
    h += `<tr style="height:${f.hauteurs[r] ?? HAUTEUR_DEF}px">`;
    for (let c = p.c1; c <= p.c2; c++) {
      if (f.colMasquees.includes(c)) continue;
      const m = fusionDe(r, c); if (m && (m.r1 !== r || m.c1 !== c)) continue;
      const x = f.cellules.get(cle(r, c)); const v = val(r, c); const s = { ...(x?.s || {}), ...(styleMFC(r, c, v) || {}) };
      const fm = v == null ? { texte: '' } : formaterValeur(v, s.format || 'General', 40);
      const st = [s.gras && 'font-weight:bold', s.italique && 'font-style:italic', s.souligne && 'text-decoration:underline', s.couleur && `color:${s.couleur}`, fm.couleur && `color:${fm.couleur}`, s.fond && `background:${s.fond}`, s.taille && `font-size:${s.taille}pt`, `text-align:${s.alignH ? { gauche: 'left', centre: 'center', droite: 'right' }[s.alignH] : fm.nombre ? 'right' : fm.centre ? 'center' : 'left'}`, s.retour && 'white-space:normal', s.bordures?.h && `border-top:${cssBord(s.bordures.h)}`, s.bordures?.b && `border-bottom:${cssBord(s.bordures.b)}`, s.bordures?.g && `border-left:${cssBord(s.bordures.g)}`, s.bordures?.d && `border-right:${cssBord(s.bordures.d)}`, s.alignV === 'haut' ? 'vertical-align:top' : s.alignV === 'milieu' ? 'vertical-align:middle' : ''].filter(Boolean).join(';');
      h += `<td${m ? ` colspan="${m.c2 - m.c1 + 1}" rowspan="${m.r2 - m.r1 + 1}"` : ''} style="${st}">${esc(fm.texte)}</td>`;
    }
    h += '</tr>';
  }
  h += '</table>';
  for (const g of f.graphiques) { const e = $(`.graphique[data-id="${g.id}"] .svg`); if (e) h += `<div class="graph-imp">${e.innerHTML}</div>`; }
  z.innerHTML = h; z.classList.toggle('grille', !!f.impression?.grille);
  const tl = largeurs.reduce((a, b) => a + b, 0);
  const pays = !!f.impression?.paysage; const dispo = (pays ? 277 : 190) * 3.78;
  const zoom = f.impression?.ajuster && tl > dispo ? dispo / tl : 1;
  $('#style-impression').textContent = `@page{size:A4 ${pays ? 'landscape' : 'portrait'};margin:10mm;@bottom-center{content:"${f.nom.replace(/"/g, '')} — page " counter(page) " / " counter(pages);font:9pt Arial;color:#666}} .zone-impression table{zoom:${zoom}}`;
}
function imprimer() { preparerImpression(false); setTimeout(() => window.print(), 50); }

// ---------- Document ----------
async function ecrireXlsxActuel() {
  const images = [];
  for (const [fi, f] of C.feuilles.entries()) for (const g of f.graphiques) {
    const m = []; for (let r = g.plage.r1; r <= g.plage.r2; r++) { const l = []; for (let c = g.plage.c1; c <= g.plage.c2; c++) l.push(valeur(fi, r, c)); m.push(l); }
    try {
      const svg = rendreGraphique(g, donneesGraphique(m, { serieEnLignes: g.serieEnLignes }), g.l, g.h);
      const png = await svgVersPng(svg, g.l, g.h);
      // position : cellule d'ancrage
      let c = 0, x = g.x; while (x > (f.largeurs[c] ?? LARGEUR_DEF)) { x -= (f.largeurs[c] ?? LARGEUR_DEF); c++; }
      let r = 0, y = g.y; while (y > (f.hauteurs[r] ?? HAUTEUR_DEF)) { y -= (f.hauteurs[r] ?? HAUTEUR_DEF); r++; }
      images.push({ feuille: fi, png, r, c, dx: x, dy: y, l: g.l, h: g.h, titre: g.titre });
    } catch (e) { console.warn('graphique', e); }
  }
  return ecrireXlsx(C, { valeur, images });
}
function chargerClasseur(c) {
  if (V.edition) fermerEditeur();
  C = c; C.active = Math.min(C.active || 0, C.feuilles.length - 1);
  pile.length = 0; futur.length = 0; V.copie = null; V.graphSel = null; V.nL = 1000; V.nC = 52;
  defile.scrollTop = 0; defile.scrollLeft = 0;
  S.r = S.c = S.r1 = S.c1 = S.r2 = S.c2 = 0;
  toutRecalculer(); selectionner(0, 0);
}
/** Contrôle qu'un fichier de classeur se relit (utilisé avant écriture, pour l'historique et la restauration). */
async function verifierClasseur(octets, ext) {
  try {
    if (!octets || !octets.length) return { ok: false, detail: 'fichier vide' };
    const c = await lireClasseur(octets, ext === 'xls' ? 'xls' : ext);
    if (!c || !c.feuilles || !c.feuilles.length) return { ok: false, detail: 'aucune feuille lisible' };
    return { ok: true, detail: `${c.feuilles.length} feuille(s) relue(s)` };
  } catch (e) { return { ok: false, detail: e.message || String(e) }; }
}
const doc = creerDocument({
  focus: () => $('#recepteur').focus({ preventScroll: true }),
  app: 'calcul', nomApp: 'Calcul', lettre: 'Ca', barreTitre: $('#barre-titre'),
  formatsOuverture: [{ nom: 'Classeurs Excel', ext: ['xlsx', 'xlsm', 'xls'] }, { nom: 'Classeurs OpenDocument', ext: ['ods'] }, { nom: 'Fichiers CSV', ext: ['csv', 'tsv', 'txt'] }],
  formatsEnregistrement: [{ nom: 'Classeur Excel', ext: 'xlsx', ecrire: ecrireXlsxActuel }, { nom: 'Classeur OpenDocument', ext: 'ods', ecrire: async () => ecrireOds(C, valeur) }, { nom: 'CSV (séparateur point-virgule)', ext: 'csv', ecrire: async () => ecrireCSV(F(), C.active, valeur) }],
  exports: [
    { id: 'pdf', label: 'PDF', ico: 'file-type', desc: 'Ouvre l\'impression : choisissez « Microsoft Print to PDF » ou « Enregistrer au format PDF ».', faire: () => imprimer() },
    { id: 'xlsx', label: 'Classeur Excel (.xlsx)', ico: 'sheet', ext: 'xlsx', desc: 'Compatible Microsoft Excel et LibreOffice Calc.', ecrire: ecrireXlsxActuel },
    { id: 'ods', label: 'Classeur OpenDocument (.ods)', ico: 'sheet', ext: 'ods', desc: 'Format ouvert, compatible LibreOffice Calc.', ecrire: async () => ecrireOds(C, valeur) },
    { id: 'csv', label: 'CSV (.csv)', ico: 'file-spreadsheet', ext: 'csv', desc: 'Feuille active, séparateur point-virgule, UTF-8.', ecrire: async () => ecrireCSV(F(), C.active, valeur) },
    { id: 'html', label: 'Page web (.html)', ico: 'globe', ext: 'html', desc: 'Tableau de la feuille active.', ecrire: async () => { preparerImpression(false); return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(F().nom)}</title><style>table{border-collapse:collapse;font:13px Calibri,Arial,sans-serif}td{border:1px solid #ccc;padding:2px 6px}</style></head><body>${$('#zone-impression').innerHTML}</body></html>`; } },
  ],
  modeles: MODELES,
  // historique des versions partagé avec Dépannage (espace « classeurs »)
  historique: { espace: 'classeurs' },
  verifierOctets: verifierClasseur,
  async nouveau(modele) { chargerClasseur((modele || MODELES[0]).creer()); },
  async charger({ octets, ext }) {
    if (ext === 'xls') throw new Error('l\'ancien format .xls n\'est lu qu\'en partie : enregistrez-le d\'abord en .xlsx');
    chargerClasseur(await lireClasseur(octets, ext));
  },
  informations: async () => { let n = 0, fo = 0; C.feuilles.forEach(f => { n += f.cellules.size; for (const x of f.cellules.values()) if (x.f) fo++; }); return [['Feuilles', String(C.feuilles.length)], ['Cellules remplies', n.toLocaleString('fr-FR')], ['Formules', fo.toLocaleString('fr-FR')]]; },
  annuler, retablir, imprimer,
  commandes: () => ruban.commandes(),
});

// ---------- Raccourcis globaux ----------
raccourcis({
  'Ctrl+Z': () => { if (document.activeElement === barre || document.activeElement === edTexte) return false; annuler(); },
  'Ctrl+Y': () => { if (V.edition) return false; retablir(); },
  'Ctrl+G': () => { if (V.edition) return false; basculer('gras'); }, 'Ctrl+B': () => { if (V.edition) return false; basculer('gras'); },
  'Ctrl+I': () => { if (V.edition) return false; basculer('italique'); }, 'Ctrl+U': () => { if (V.edition) return false; basculer('souligne'); },
  'Ctrl+A': () => { if (V.edition || document.activeElement?.tagName === 'INPUT') return false; const p = regionCourante(); if (S.r1 === p.r1 && S.r2 === p.r2 && S.c1 === p.c1 && S.c2 === p.c2) selectionner(0, 0, { r2: LIGNES_MAX - 1, c2: COLS_MAX - 1 }); else { S.r1 = p.r1; S.r2 = p.r2; S.c1 = p.c1; S.c2 = p.c2; rendre(); majEtat(); majBarreFormule(); } },
  'Ctrl+D': () => { if (V.edition) return false; recopierVers('bas'); }, 'Ctrl+R': () => { if (V.edition) return false; recopierVers('droite'); },
  'Ctrl+F': () => rechercher(false), 'Ctrl+H': () => rechercher(true), 'Ctrl+1': () => dialogueFormat(), 'Ctrl+K': () => insererLien(),
  'Alt+=': () => sommeAuto(), 'Maj+F11': () => ajouterFeuille(), 'Maj+F3': () => insererFonction(),
  'Ctrl+PageDown': () => { if (C.active < C.feuilles.length - 1) changerFeuille(C.active + 1); }, 'Ctrl+PageUp': () => { if (C.active > 0) changerFeuille(C.active - 1); },
  'Ctrl+Maj++': () => dialogueInserer(), 'Ctrl+-': () => { if (V.edition) return false; dialogueSupprimer(); },
  'Ctrl+Maj+L': () => basculerFiltre(), 'Ctrl+Maj+$': () => appliquerStyle({ format: '#,##0.00 "€"' }), 'Ctrl+Maj+%': () => appliquerStyle({ format: '0%' }),
  'F9': () => { recalculer(); rendre(); },
});
// Zone Nom : aller à une adresse
$('#zone-nom').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return; e.preventDefault();
  const t = e.target.value.trim(); const m = /^(?:'?(.+?)'?!)?(.+)$/.exec(t);
  if (m[1]) { const i = C.feuilles.findIndex(f => f.nom.toLowerCase() === m[1].toLowerCase()); if (i >= 0) changerFeuille(i); }
  const p = lirePlage(m[2]); if (!p) { toast('Adresse invalide.', 'erreur'); return; }
  selectionner(p.r1, p.c1, { r2: p.r2, c2: p.c2 }); rendreVisible(p.r1, p.c1); recepteur.focus();
});
$('#b-fx').onclick = () => insererFonction();

// ---------- Barre d'état ----------
$('#barre-etat').innerHTML = `<span id="etat-mode">Prêt</span><span class="espace"></span><span id="etat-stats"></span><span class="zoom"><button id="zoom-moins" aria-label="Zoom arrière">−</button><input type="range" id="zoom-curseur" min="25" max="400" value="100" aria-label="Zoom"><button id="zoom-plus" aria-label="Zoom avant">+</button><button id="zoom-val">100 %</button></span>`;
$('#zoom-curseur').oninput = e => definirZoom(e.target.value / 100);
$('#zoom-moins').onclick = () => definirZoom(V.zoom - 0.1); $('#zoom-plus').onclick = () => definirZoom(V.zoom + 0.1);
$('#zoom-val').onclick = () => menu([50, 75, 100, 125, 150, 200].map(z => ({ label: z + ' %', faire: () => definirZoom(z / 100) })), 0, 0, $('#zoom-val'));
zone.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); definirZoom(V.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });

// Fonction LIEN_HYPERTEXTE (affiche le texte, Ctrl+clic ouvre le lien)
LISTE_FONCTIONS.push({ fr: 'LIEN_HYPERTEXTE', en: 'HYPERLINK', cat: 'Recherche', syn: 'LIEN_HYPERTEXTE(adresse; [nom_convivial])', desc: 'Crée un lien vers une adresse web.', f: ([a, n]) => n ?? a });
FONCTIONS.LIEN_HYPERTEXTE = FONCTIONS.HYPERLINK = LISTE_FONCTIONS[LISTE_FONCTIONS.length - 1];
zone.addEventListener('click', e => {
  if (!(e.ctrlKey || e.metaKey)) return; const d = e.target.closest('.c'); if (!d) return;
  const x = F().cellules.get(cle(+d.dataset.r, +d.dataset.c)); const m = x?.f && /^=LIEN_HYPERTEXTE\("([^"]+)"/i.exec(x.f); if (m) Fi.ouvrirLien(m[1]);
});

window.__calcul = { C: () => C, S, V, val, valeur, ecrire, selectionner, recalculer, toutRecalculer, doc, chargerClasseur, F, rendreMaintenant, apresModif, avant };
(async () => {
  calculerGeometrie(); rendreOnglets();
  await doc.demarrer();
  recepteur.focus();
})();
