// PDF — lecture, annotation, organisation et protection de documents PDF
import { $, $$, el, esc, ico, toast, dialogue, confirmer, demander, menu, fermerMenu, creerRuban, raccourcis, debounce, nomSansExtension } from './commun/ui.js';
import { creerDocument } from './commun/document.js';
import * as Fi from './commun/fichiers.js';
import { pdfjs, SOURCES, A4, chargerSource, rendrePage, construire, ouvrirPourLecture, texteDuDocument, pageEnImage, preparerImage, dimsAffichage } from './moteur.js';

// ---------- État ----------
let P = vide(); let M = {}; // document et médias (images)
function vide() { return { pages: [], filigrane: null, numerotation: null, meta: {}, protection: null, champs: {}, aplatir: false }; }
const V = { zoom: 1, mode: 'largeur', courante: 0, outil: 'selection', sel: [], pageSel: null, edition: null, pagesSel: new Set(), miniatures: true, style: { couleur: '#C00000', surligneur: '#FFE500', texte: '#1B2A4A', epaisseur: 2, taille: 14, police: 'helvetica', remplissage: 'transparent' } };
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const S = () => V.zoom * 4 / 3; // pixels CSS par point
const vis = $('#visionneuse'), zonePages = $('#pages');
const pageDe = id => P.pages.find(p => p.id === id);
const idx = id => P.pages.findIndex(p => p.id === id);
const pageCourante = () => P.pages[V.courante];
const POLICES_CSS = { helvetica: 'Arial,Helvetica,sans-serif', times: '"Times New Roman",Times,serif', courier: '"Courier New",Courier,monospace' };
const OUTILS_DESSIN = ['surligneur', 'crayon', 'rect', 'ellipse', 'ligne', 'fleche', 'caviardage'];
const STICKY = ['surligneur', 'crayon', 'caviardage'];

// ---------- Historique ----------
const pile = [], futur = [];
const etat = () => JSON.stringify(P);
function avant() { const e = etat(); if (pile[pile.length - 1] !== e) pile.push(e); if (pile.length > 80) pile.shift(); futur.length = 0; }
function appliquerEtat(s) { P = JSON.parse(s); V.sel = []; V.edition = null; V.pagesSel.clear(); V.courante = Math.min(V.courante, Math.max(0, P.pages.length - 1)); rendre(true); }
function annuler() { if (V.edition) quitterEdition(); if (!pile.length) return; futur.push(etat()); appliquerEtat(pile.pop()); doc.marquerModifie(); }
function retablir() { if (!futur.length) return; pile.push(etat()); appliquerEtat(futur.pop()); doc.marquerModifie(); }
function modifie() { doc.marquerModifie(); }
function apres(structure = false) { modifie(); rendre(structure); }

// ---------- Chargement de documents ----------
const demanderMdp = async (incorrect) => {
  const r = await dialogue({ titre: 'Document protégé', contenu: `<p>${incorrect ? 'Mot de passe incorrect. ' : ''}Ce document est protégé par un mot de passe.</p><label class="champ">Mot de passe<input type="password" name="m" autocomplete="off"></label>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Ouvrir', valeur: true, primaire: true }], init: c => setTimeout(() => $('input', c).focus(), 30) });
  return r ? r.m : null;
};
async function pagesDepuisPdf(octets, nom) {
  const s = await chargerSource(octets, nom, demanderMdp);
  return { source: s, pages: s.pages.map((g, n) => ({ id: uid('p'), src: s.id, n, l: g.l, h: g.h, rot: 0, annots: [] })) };
}
async function pagesDepuisImages(fichiers) {
  const pages = [];
  for (const f of fichiers) {
    const im = await preparerImage(f.octets, f.nom); const id = uid('m'); M[id] = im.url;
    const paysage = im.l > im.h; const l = paysage ? A4.h : A4.l, h = paysage ? A4.l : A4.h;
    const k = Math.min(l / im.l, h / im.h); const w = im.l * k, hh = im.h * k;
    pages.push({ id: uid('p'), src: null, n: 0, l, h, rot: 0, annots: [{ id: uid('a'), type: 'image', x: (l - w) / 2, y: (h - hh) / 2, l: w, h: hh, src: 'media:' + id, page: true }] });
  }
  return pages;
}
const estImage = nom => /\.(png|jpe?g|gif|bmp|webp|svg|tiff?)$/i.test(nom);
async function pagesDepuisFichiers(fichiers) {
  let pages = [];
  for (const f of fichiers) {
    if (estImage(f.nom)) pages = pages.concat(await pagesDepuisImages([f]));
    else { const r = await pagesDepuisPdf(f.octets, f.nom); pages = pages.concat(r.pages); if (!P.meta.titre && r.source.meta.titre && !P.pages.length) P.meta = { ...r.source.meta }; }
  }
  return pages;
}
function reinitialiser() { P = vide(); M = {}; V.sel = []; V.edition = null; V.pagesSel.clear(); V.courante = 0; pile.length = 0; futur.length = 0; for (const s of SOURCES.values()) try { s.pdf.destroy(); } catch { } SOURCES.clear(); rendus.clear(); textes.clear(); formulaires.clear(); }
async function insererFichiers(fichiers, position = V.courante + 1) {
  const pages = await pagesDepuisFichiers(fichiers);
  if (!pages.length) return;
  avant(); P.pages.splice(Math.min(position, P.pages.length), 0, ...pages); V.courante = Math.min(position, P.pages.length - 1); apres(true);
  allerPage(V.courante); toast(`${pages.length} page${pages.length > 1 ? 's' : ''} ajoutée${pages.length > 1 ? 's' : ''}.`, 'succes');
}

// ---------- Géométrie ----------
function transformInterieur(p, w, h) { // w,h : dimensions de base en px
  if (p.rot === 90) return `translate(${h}px,0) rotate(90deg)`;
  if (p.rot === 180) return `translate(${w}px,${h}px) rotate(180deg)`;
  if (p.rot === 270) return `translate(0,${w}px) rotate(270deg)`;
  return 'none';
}
function versInterieur(pageEl, p, ev) {
  const r = pageEl.getBoundingClientRect(); const X = (ev.clientX - r.left) / S(), Y = (ev.clientY - r.top) / S();
  if (p.rot === 90) return [Y, p.h - X]; if (p.rot === 180) return [p.l - X, p.h - Y]; if (p.rot === 270) return [p.l - Y, X];
  return [X, Y];
}
function ajusterZoom() {
  const p = pageCourante() || P.pages[0]; if (!p) return;
  const d = dimsAffichage(p); const largeur = vis.clientWidth - 60, hauteur = vis.clientHeight - 40;
  if (V.mode === 'largeur') V.zoom = Math.max(0.1, Math.min(4, largeur / (Math.max(...P.pages.map(x => dimsAffichage(x).l)) * 4 / 3)));
  if (V.mode === 'page') V.zoom = Math.max(0.1, Math.min(4, Math.min(largeur / (d.l * 4 / 3), hauteur / (d.h * 4 / 3))));
}
function definirZoom(z, mode = null) {
  const p0 = V.courante; const el0 = $(`.page[data-id="${P.pages[p0]?.id}"]`); const rel = el0 ? (vis.scrollTop - el0.offsetTop) / el0.offsetHeight : 0;
  V.mode = mode; if (mode) ajusterZoom(); else V.zoom = Math.max(0.1, Math.min(5, z));
  rendre(true);
  const el1 = $(`.page[data-id="${P.pages[p0]?.id}"]`); if (el1) vis.scrollTop = el1.offsetTop + rel * el1.offsetHeight;
  majEtat();
}
new ResizeObserver(debounce(() => { if (V.mode) { const z = V.zoom; ajusterZoom(); if (Math.abs(z - V.zoom) > 0.001) rendre(true); } }, 120)).observe(vis);

// ---------- Rendu des pages ----------
const rendus = new Map(); // id page -> { canvas, echelle, cle }
const textes = new Map(); // id page -> { contenu, divs }
const formulaires = new Map(); // id source#n -> widgets
const enCours = new Set();
const obs = new IntersectionObserver(entrees => { for (const e of entrees) if (e.isIntersecting) rendreCanevas(e.target.dataset.id); }, { root: vis, rootMargin: '800px 0px' });
function htmlAnnot(a, s) {
  const pos = `left:${a.x * s}px;top:${a.y * s}px;width:${Math.max(a.l, 0.5) * s}px;height:${Math.max(a.h, 0.5) * s}px;`;
  const op = a.opacite != null && a.opacite !== 1 ? `opacity:${a.opacite};` : '';
  const img = a.src?.startsWith('media:') ? M[a.src.slice(6)] : a.src;
  switch (a.type) {
    case 'texte': return `<div class="annot a-texte" data-a="${a.id}" style="${pos}${op}padding:${4 * s}px;font-family:${POLICES_CSS[a.police || 'helvetica']};font-size:${(a.taille || 14) * s}px;color:${a.couleur || '#1B2A4A'};${a.remplissage && a.remplissage !== 'transparent' ? `background:${a.remplissage};` : ''}${a.gras ? 'font-weight:700;' : ''}${a.italique ? 'font-style:italic;' : ''}${a.souligne ? 'text-decoration:underline;' : ''}text-align:${a.align || 'left'}">${esc(a.texte || '')}</div>`;
    case 'tampon': return `<div class="annot a-tampon" data-a="${a.id}" style="${pos}opacity:${a.opacite ?? 0.9};font-size:${(a.taille || 18) * s}px;color:${a.couleur};border:${2.5 * s}px solid ${a.couleur}">${esc(a.texte)}</div>`;
    case 'surlignage': return `<div class="annot a-surlignage" data-a="${a.id}" style="${pos}background:${a.couleur || '#FFE500'};opacity:${a.opacite ?? 0.4}"></div>`;
    case 'caviardage': return `<div class="annot a-caviardage" data-a="${a.id}" style="${pos}" title="Zone caviardée : le contenu sera supprimé à l'enregistrement"></div>`;
    case 'image': return `<div class="annot" data-a="${a.id}" style="${pos}${op}cursor:move">${img ? `<img src="${img}" alt="" draggable="false">` : ''}</div>`;
    case 'rect': case 'ellipse': {
      const st = `fill="${a.remplissage && a.remplissage !== 'transparent' ? a.remplissage : 'none'}" stroke="${a.couleur && a.couleur !== 'transparent' ? a.couleur : 'none'}" stroke-width="${a.epaisseur || 2}"`;
      const forme = a.type === 'rect' ? `<rect x="0" y="0" width="${a.l}" height="${a.h}" ${st}/>` : `<ellipse cx="${a.l / 2}" cy="${a.h / 2}" rx="${a.l / 2}" ry="${a.h / 2}" ${st}/>`;
      return `<div class="annot" data-a="${a.id}" style="${pos}${op}cursor:move"><svg width="${a.l * s}" height="${a.h * s}" viewBox="0 0 ${a.l} ${a.h}">${forme}</svg></div>`;
    }
    case 'ligne': case 'fleche': {
      const [x1, y1, x2, y2] = a.pts; const ep = a.epaisseur || 2; const t = Math.max(8, ep * 4); const ang = Math.atan2(y2 - y1, x2 - x1);
      const tete = a.type === 'fleche' ? `<path d="M${x2} ${y2}L${x2 - t * Math.cos(ang - 0.45)} ${y2 - t * Math.sin(ang - 0.45)}L${x2 - t * Math.cos(ang + 0.45)} ${y2 - t * Math.sin(ang + 0.45)}Z" fill="${a.couleur}"/>` : '';
      const marge = 6 / s;
      return `<div class="annot" data-a="${a.id}" style="left:${(a.x - marge) * s}px;top:${(a.y - marge) * s}px;width:${(a.l + 2 * marge) * s}px;height:${(a.h + 2 * marge) * s}px;${op}cursor:move"><svg width="${(a.l + 2 * marge) * s}" height="${(a.h + 2 * marge) * s}" viewBox="${-marge} ${-marge} ${a.l + 2 * marge} ${a.h + 2 * marge}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${a.couleur}" stroke-width="${ep}" stroke-linecap="round"/>${tete}</svg></div>`;
    }
    case 'trait': {
      const d = (a.traits || []).map(t => t.length ? `M${t[0]} ${t[1]}` + t.slice(2).reduce((acc, v, i) => acc + (i % 2 === 0 ? `L${v}` : ` ${v}`), '') : '').join(' ');
      return `<div class="annot" data-a="${a.id}" style="${pos}${op}cursor:move"><svg width="${Math.max(a.l, 0.5) * s}" height="${Math.max(a.h, 0.5) * s}" viewBox="0 0 ${Math.max(a.l, 0.5)} ${Math.max(a.h, 0.5)}"><path d="${d}" fill="none" stroke="${a.couleur}" stroke-width="${a.epaisseur || 2}" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
    }
  }
  return '';
}
function htmlSurcouches(p, i, s) {
  const d = dimsAffichage(p); let h = '';
  const f = P.filigrane; if (f?.texte) h += `<div class="filigrane" style="font-size:${(f.taille || 60) * s}px;color:${f.couleur || '#B0261E'};opacity:${f.opacite ?? 0.2};transform:translate(-50%,-50%) rotate(${-(f.angle ?? 45)}deg)">${esc(f.texte)}</div>`;
  const N = P.numerotation;
  if (N && !(N.ignorerPremiere && i === 0)) {
    const n = i + (N.debut ?? 1) - (N.ignorerPremiere ? 1 : 0), tot = P.pages.length + (N.debut ?? 1) - 1 - (N.ignorerPremiere ? 1 : 0);
    const t = (N.format || 'Page {n} sur {total}').replace('{n}', n).replace('{total}', tot);
    const [v, hz] = (N.position || 'bas-centre').split('-'); const m = (N.marge ?? 28) * s, taille = (N.taille || 10) * s;
    const pos = `${v === 'haut' ? `top:${m}px;` : `bottom:${m - taille * 0.2}px;`}${hz === 'gauche' ? `left:${m}px;` : hz === 'droite' ? `right:${m}px;` : `left:0;right:0;text-align:center;`}`;
    h += `<div class="numero-page" style="${pos}font-size:${taille}px;color:${N.couleur || '#333'}">${esc(t)}</div>`;
  }
  void d; return h;
}
function htmlCadres(p, s) {
  return V.sel.filter(() => V.pageSel === p.id).map(id => {
    const a = p.annots.find(x => x.id === id); if (!a) return '';
    if (a.type === 'ligne' || a.type === 'fleche') return `<div class="cadre-sel" data-a="${a.id}" style="left:${a.x * s}px;top:${a.y * s}px;width:${a.l * s}px;height:${a.h * s}px;border-color:transparent">${V.sel.length === 1 ? `<span class="p bout" data-p="p1" style="left:${a.pts[0] * s - 6}px;top:${a.pts[1] * s - 6}px"></span><span class="p bout" data-p="p2" style="left:${a.pts[2] * s - 6}px;top:${a.pts[3] * s - 6}px"></span>` : ''}</div>`;
    return `<div class="cadre-sel" data-a="${a.id}" style="left:${a.x * s - 1}px;top:${a.y * s - 1}px;width:${a.l * s + 2}px;height:${a.h * s + 2}px">${V.sel.length === 1 && V.edition !== a.id ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(q => `<span class="p" data-p="${q}"></span>`).join('') : ''}</div>`;
  }).join('');
}
const dernierAnnots = new Map();
function rendre(structure = false) {
  $('#vide').classList.toggle('masque', P.pages.length > 0);
  if (V.courante >= P.pages.length) V.courante = Math.max(0, P.pages.length - 1);
  if (structure && V.mode) ajusterZoom();
  const s = S();
  const existants = new Map($$('.page', zonePages).map(e => [e.dataset.id, e]));
  let precedent = null;
  P.pages.forEach((p, i) => {
    let e = existants.get(p.id);
    if (!e) {
      e = el(`<div class="page" data-id="${p.id}"><div class="contenu-page"><canvas></canvas><div class="couche-texte"></div><div class="couche-formulaire"></div><div class="couche-annot"></div><div class="couche-sel"></div></div><div class="surcouche"></div></div>`);
      obs.observe(e);
    }
    existants.delete(p.id);
    if ((precedent ? precedent.nextSibling : zonePages.firstChild) !== e) zonePages.insertBefore(e, precedent ? precedent.nextSibling : zonePages.firstChild);
    precedent = e;
    const d = dimsAffichage(p);
    const geo = `${d.l * s}|${d.h * s}|${p.rot}`;
    if (e.dataset.geo !== geo) {
      e.dataset.geo = geo; e.style.width = d.l * s + 'px'; e.style.height = d.h * s + 'px';
      const ci = $('.contenu-page', e); ci.style.width = p.l * s + 'px'; ci.style.height = p.h * s + 'px'; ci.style.transform = transformInterieur(p, p.l * s, p.h * s);
      e.dataset.annots = ''; // forcer le rendu des couches
      const ct = $('.couche-texte', e); ct.innerHTML = ''; ct.dataset.e = ''; $('.couche-formulaire', e).innerHTML = ''; $('.couche-formulaire', e).dataset.e = '';
      if (isVisible(e)) rendreCanevas(p.id);
    }
    const cle = JSON.stringify(p.annots) + s + (P.filigrane ? JSON.stringify(P.filigrane) : '') + (P.numerotation ? JSON.stringify(P.numerotation) + i + P.pages.length : '');
    if (e.dataset.annots !== cle && !(V.edition && V.pageSel === p.id)) {
      e.dataset.annots = cle;
      $('.couche-annot', e).innerHTML = p.annots.map(a => htmlAnnot(a, s)).join('');
      $('.surcouche', e).innerHTML = htmlSurcouches(p, i, s);
    }
    $('.couche-sel', e).innerHTML = htmlCadres(p, s);
    e.className = 'page' + (OUTILS_DESSIN.includes(V.outil) ? ' outil-dessin' : '') + (V.outil === 'texte' ? ' outil-texte' : '');
  });
  for (const [id, e] of existants) { obs.unobserve(e); e.remove(); rendus.delete(id); }
  vis.classList.toggle('outil-main', V.outil === 'main');
  majValeursFormulaires();
  majMiniatures(); majEtat(); majRuban();
}
const isVisible = e => { const r = e.getBoundingClientRect(), rv = vis.getBoundingClientRect(); return r.bottom > rv.top - 800 && r.top < rv.bottom + 800; };
async function rendreCanevas(id) {
  const p = pageDe(id); const e = $(`.page[data-id="${id}"]`); if (!p || !e) return;
  const echelle = S() * (window.devicePixelRatio || 1);
  const cle = `${p.src}#${p.n}@${echelle.toFixed(3)}`;
  const r = rendus.get(id);
  if (r && r.cle === cle) { if (!e.contains(r.canvas)) $('.contenu-page canvas', e).replaceWith(r.canvas); }
  else if (!enCours.has(id)) {
    enCours.add(id);
    try {
      const c = document.createElement('canvas');
      await rendrePage(p, c, echelle);
      const e2 = $(`.page[data-id="${id}"]`);
      if (e2) { $('.contenu-page canvas', e2).replaceWith(c); rendus.set(id, { canvas: c, cle }); }
    } catch (err) { if (!/cancel/i.test(err?.message || '')) console.warn('rendu', err); }
    finally { enCours.delete(id); }
    const r2 = rendus.get(id); if (!r2 || r2.cle !== `${p.src}#${p.n}@${(S() * (window.devicePixelRatio || 1)).toFixed(3)}`) { if (pageDe(id)) setTimeout(() => rendreCanevas(id), 0); return; }
  }
  rendreTexte(id); rendreFormulaire(id);
}
async function contenuTexte(p) {
  if (!p.src) return null;
  const k = p.src + '#' + p.n; if (textes.has(k)) return textes.get(k);
  const pg = await SOURCES.get(p.src).pdf.getPage(p.n + 1); const tc = await pg.getTextContent();
  textes.set(k, tc); return tc;
}
async function rendreTexte(id) {
  const p = pageDe(id); const e = $(`.page[data-id="${id}"]`); if (!p || !e || !p.src) return;
  const ct = $('.couche-texte', e); const s = S(); if (ct.dataset.e === String(s)) return;
  ct.dataset.e = String(s);
  const tc = await contenuTexte(p); const pg = await SOURCES.get(p.src).pdf.getPage(p.n + 1);
  ct.innerHTML = ''; ct.style.setProperty('--scale-factor', s);
  const tl = new pdfjs.TextLayer({ textContentSource: tc, container: ct, viewport: pg.getViewport({ scale: s }) });
  await tl.render(); ct.__divs = tl.textDivs;
  if (R.q) surlignerPage(id);
}
async function widgets(p) {
  if (!p.src) return [];
  const k = p.src + '#' + p.n; if (formulaires.has(k)) return formulaires.get(k);
  const pg = await SOURCES.get(p.src).pdf.getPage(p.n + 1);
  const l = (await pg.getAnnotations({ intent: 'display' })).filter(a => a.subtype === 'Widget' && a.fieldName && !a.hidden && ['Tx', 'Btn', 'Ch'].includes(a.fieldType) && !a.pushButton);
  formulaires.set(k, l); return l;
}
const cleChamp = (p, w) => p.src + '|' + w.fieldName;
function valeurInitiale(w) { if (w.fieldType === 'Btn') return w.checkBox ? (w.fieldValue && w.fieldValue !== 'Off' && w.fieldValue === w.exportValue) : (w.fieldValue === w.buttonValue ? w.buttonValue : null); return w.fieldValue ?? ''; }
async function rendreFormulaire(id) {
  const p = pageDe(id); const e = $(`.page[data-id="${id}"]`); if (!p || !e || !p.src) return;
  const cf = $('.couche-formulaire', e); const s = S(); if (cf.dataset.e === String(s)) return; cf.dataset.e = String(s);
  const ws = await widgets(p); if (!ws.length) { cf.innerHTML = ''; return; }
  const vt = SOURCES.get(p.src).pages[p.n].vt;
  const ap = (x, y) => [vt[0] * x + vt[2] * y + vt[4], vt[1] * x + vt[3] * y + vt[5]];
  cf.innerHTML = '';
  for (const w of ws) {
    const [x1, y1] = ap(w.rect[0], w.rect[1]), [x2, y2] = ap(w.rect[2], w.rect[3]);
    const x = Math.min(x1, x2), y = Math.min(y1, y2), l = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    const style = `left:${x * s}px;top:${y * s}px;width:${l * s}px;height:${h * s}px;font-size:${Math.min(h * 0.68, 12) * s}px`;
    const k = cleChamp(p, w); const v = k in P.champs ? P.champs[k] : valeurInitiale(w);
    let n;
    if (w.fieldType === 'Tx') n = el(w.multiLine ? `<textarea class="champ-pdf" style="${style}"></textarea>` : `<input class="champ-pdf" type="text" style="${style}" ${w.maxLen ? `maxlength="${w.maxLen}"` : ''}>`);
    else if (w.fieldType === 'Ch') { n = el(`<select class="champ-pdf" style="${style}"><option value=""></option>${(w.options || []).map(o => `<option value="${esc(o.exportValue)}">${esc(o.displayValue)}</option>`).join('')}</select>`); }
    else if (w.checkBox) n = el(`<input class="champ-pdf" type="checkbox" style="${style}">`);
    else n = el(`<input class="champ-pdf" type="radio" name="${esc(p.id + '|' + w.fieldName)}" style="${style}">`);
    n.dataset.cle = k; n.dataset.bv = w.buttonValue || ''; n.title = w.alternativeText || w.fieldName; n.setAttribute('aria-label', w.alternativeText || w.fieldName);
    if (w.readOnly) n.disabled = true;
    ecrireValeurChamp(n, v);
    const maj = () => { avant(); P.champs[k] = n.type === 'checkbox' ? n.checked : n.type === 'radio' ? (n.checked ? n.dataset.bv : P.champs[k]) : n.value; modifie(); synchroniserChamp(k, n); };
    n.addEventListener(n.tagName === 'SELECT' || n.type === 'checkbox' || n.type === 'radio' ? 'change' : 'input', n.tagName === 'SELECT' || n.type === 'checkbox' || n.type === 'radio' ? maj : debounce(maj, 250));
    cf.appendChild(n);
  }
}
function ecrireValeurChamp(n, v) { if (n.type === 'checkbox') n.checked = !!v; else if (n.type === 'radio') n.checked = v != null && v === n.dataset.bv; else if (document.activeElement !== n) n.value = v ?? ''; }
function synchroniserChamp(k, source) { $$('.champ-pdf').forEach(n => { if (n !== source && n.dataset.cle === k) ecrireValeurChamp(n, P.champs[k]); }); }
function majValeursFormulaires() { $$('.champ-pdf').forEach(n => { if (n.dataset.cle in P.champs) ecrireValeurChamp(n, P.champs[n.dataset.cle]); }); }

// ---------- Miniatures ----------
const rendusMini = new Map();
const obsMini = new IntersectionObserver(entrees => { for (const e of entrees) if (e.isIntersecting) rendreMini(e.target); }, { rootMargin: '400px 0px' });
function htmlMiniature(p, i, largeur) {
  const d = dimsAffichage(p); const k = largeur / Math.max(d.l, d.h * 0.75); const w = d.l * k, h = d.h * k;
  return `<div class="miniature ${i === V.courante ? 'courante' : ''} ${V.pagesSel.has(p.id) ? 'choisie' : ''}" data-id="${p.id}" data-i="${i}" draggable="true" tabindex="-1" aria-label="Page ${i + 1}"><div class="cadre-m" style="width:${w}px;height:${h}px"><div class="interieur" style="width:${p.l * k}px;height:${p.h * k}px;transform:${transformInterieur(p, p.l * k, p.h * k)}" data-k="${k}"><canvas></canvas><div style="position:absolute;inset:0">${p.annots.map(a => htmlAnnot(a, k)).join('')}</div></div><div style="position:absolute;inset:0">${htmlSurcouches(p, i, k)}</div></div><span class="num">${i + 1}</span></div>`;
}
async function rendreMini(m) {
  const p = pageDe(m.dataset.id); if (!p) return; const int = $('.interieur', m); const k = +int.dataset.k;
  const cle = `${p.src}#${p.n}@${k.toFixed(3)}`;
  let c = rendusMini.get(cle);
  if (!c) { c = document.createElement('canvas'); try { await rendrePage(p, c, k * 2, { formulaires: false }); } catch { return; } rendusMini.set(cle, c); }
  const cible = $('canvas', int); if (cible && cible !== c) { const copie = c.cloneNode(); copie.getContext('2d').drawImage(c, 0, 0); cible.replaceWith(copie); }
}
function remplirMiniatures(conteneur, largeur) {
  conteneur.innerHTML = P.pages.map((p, i) => htmlMiniature(p, i, largeur)).join('');
  $$('.miniature', conteneur).forEach(m => { obsMini.observe(m); brancherMiniature(m, conteneur); });
}
const majMiniatures = debounce(() => {
  if (V.miniatures) remplirMiniatures($('#miniatures'), 132);
  if (!$('#organiseur').classList.contains('masque')) { remplirMiniatures($('#grille-org'), 190); majBarreOrg(); }
  $('.miniature.courante', $('#miniatures'))?.scrollIntoView({ block: 'nearest' });
}, 60);
function brancherMiniature(m, conteneur) {
  const id = m.dataset.id, i = +m.dataset.i;
  m.onclick = ev => {
    if (ev.ctrlKey || ev.metaKey) { V.pagesSel.has(id) ? V.pagesSel.delete(id) : V.pagesSel.add(id); }
    else if (ev.shiftKey && V.ancre != null) { const a = Math.min(V.ancre, i), b = Math.max(V.ancre, i); V.pagesSel = new Set(P.pages.slice(a, b + 1).map(p => p.id)); }
    else { V.pagesSel = new Set([id]); V.ancre = i; }
    if (conteneur.id === 'miniatures') allerPage(i); else { V.courante = i; }
    $$('.miniature', conteneur).forEach(x => x.classList.toggle('choisie', V.pagesSel.has(x.dataset.id)));
    majBarreOrg(); conteneur.focus({ preventScroll: true });
  };
  m.ondblclick = () => { if (conteneur.id === 'grille-org') { fermerOrganiseur(); allerPage(i); } };
  m.oncontextmenu = ev => { ev.preventDefault(); if (!V.pagesSel.has(id)) { V.pagesSel = new Set([id]); $$('.miniature', conteneur).forEach(x => x.classList.toggle('choisie', V.pagesSel.has(x.dataset.id))); } V.courante = i; menuPages(ev.clientX, ev.clientY); };
  m.ondragstart = ev => { if (!V.pagesSel.has(id)) V.pagesSel = new Set([id]); ev.dataTransfer.setData('text/x-atelier-pages', '1'); ev.dataTransfer.effectAllowed = 'move'; };
  m.ondragover = ev => { if (!ev.dataTransfer.types.includes('text/x-atelier-pages')) return; ev.preventDefault(); const r = m.getBoundingClientRect(); const apresM = conteneur.id === 'grille-org' ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2; $$('.glisse-avant,.glisse-apres', conteneur).forEach(x => x.classList.remove('glisse-avant', 'glisse-apres')); m.classList.add(apresM ? 'glisse-apres' : 'glisse-avant'); m.dataset.apres = apresM ? '1' : ''; };
  m.ondragleave = () => m.classList.remove('glisse-avant', 'glisse-apres');
  m.ondrop = ev => { if (!ev.dataTransfer.types.includes('text/x-atelier-pages')) return; ev.preventDefault(); ev.stopPropagation(); const apresM = !!m.dataset.apres; m.classList.remove('glisse-avant', 'glisse-apres'); deplacerPages([...V.pagesSel], i + (apresM ? 1 : 0)); };
}

// ---------- Navigation ----------
function allerPage(i, { haut = true } = {}) {
  if (!P.pages.length) return;
  V.courante = Math.max(0, Math.min(P.pages.length - 1, i));
  const e = $(`.page[data-id="${P.pages[V.courante].id}"]`); if (e && haut) vis.scrollTop = e.offsetTop - 12;
  majEtat(); $$('#miniatures .miniature').forEach(m => m.classList.toggle('courante', +m.dataset.i === V.courante)); $('#miniatures .miniature.courante')?.scrollIntoView({ block: 'nearest' });
}
vis.addEventListener('scroll', debounce(() => {
  const milieu = vis.scrollTop + vis.clientHeight * 0.3; let meilleur = 0;
  $$('.page', zonePages).forEach((e, i) => { if (e.offsetTop <= milieu) meilleur = i; });
  if (meilleur !== V.courante) { V.courante = meilleur; majEtat(); $$('#miniatures .miniature').forEach(m => m.classList.toggle('courante', +m.dataset.i === V.courante)); $('#miniatures .miniature.courante')?.scrollIntoView({ block: 'nearest' }); }
}, 60));

// ---------- Opérations sur les pages ----------
const pagesCiblees = () => { const l = P.pages.filter(p => V.pagesSel.has(p.id)); return l.length ? l : (pageCourante() ? [pageCourante()] : []); };
function pivoter(sens) { const l = pagesCiblees(); if (!l.length) return; avant(); l.forEach(p => p.rot = ((p.rot || 0) + (sens > 0 ? 90 : 270)) % 360); apres(true); }
async function supprimerPages() {
  const l = pagesCiblees(); if (!l.length) return;
  if (l.length > 1 && !(await confirmer('Supprimer des pages', `Supprimer ${l.length} pages ?`, 'Supprimer', true))) return;
  avant(); const ids = new Set(l.map(p => p.id)); P.pages = P.pages.filter(p => !ids.has(p.id)); V.pagesSel.clear(); apres(true);
}
function dupliquerPages() { const l = pagesCiblees(); if (!l.length) return; avant(); const fin = idx(l[l.length - 1].id) + 1; const copies = l.map(p => ({ ...JSON.parse(JSON.stringify(p)), id: uid('p'), annots: p.annots.map(a => ({ ...JSON.parse(JSON.stringify(a)), id: uid('a') })) })); P.pages.splice(fin, 0, ...copies); V.courante = fin; apres(true); }
function deplacerPages(ids, vers) {
  if (!ids.length) return; avant();
  const bloc = P.pages.filter(p => ids.includes(p.id)); const avantCible = P.pages.slice(0, vers).filter(p => ids.includes(p.id)).length;
  P.pages = P.pages.filter(p => !ids.includes(p.id)); const pos = Math.max(0, vers - avantCible);
  P.pages.splice(pos, 0, ...bloc); V.courante = pos; apres(true);
}
function insererVierge() { const ref = pageCourante(); avant(); const l = ref ? dimsAffichage(ref).l : A4.l, h = ref ? dimsAffichage(ref).h : A4.h; P.pages.splice(V.courante + 1, 0, { id: uid('p'), src: null, n: 0, l, h, rot: 0, annots: [] }); V.courante = Math.min(V.courante + 1, P.pages.length - 1); apres(true); allerPage(V.courante); }
async function insererDepuisFichier() {
  const f = await Fi.ouvrirFichiers({ titre: 'Insérer des pages', filtres: [{ nom: 'PDF et images', ext: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }], multiple: true });
  if (f) try { await insererFichiers(f, P.pages.length ? V.courante + 1 : 0); } catch (e) { toast('Insertion impossible : ' + e.message, 'erreur'); }
}
async function enregistrerPages(pages, nomSuggere, titre = 'Enregistrer les pages') {
  const octets = await construire({ ...P, pages }, { medias: M, aplatirFormulaires: P.aplatir });
  return Fi.enregistrerFichier({ octets, nomSuggere, filtres: [{ nom: 'Document PDF', ext: ['pdf'] }], titre });
}
async function extrairePages() {
  const l = pagesCiblees(); if (!l.length) return;
  const r = await enregistrerPages(l, `${nomSansExtension(doc.nom)} (pages ${l.map(p => idx(p.id) + 1).join(', ')})`.slice(0, 120), 'Extraire les pages');
  if (r) toast(`${l.length} page${l.length > 1 ? 's' : ''} extraite${l.length > 1 ? 's' : ''} : ${r.nom}`, 'succes');
}
function analyserPlages(t, n) {
  const groupes = [];
  for (const partie of t.split(/[;\n]+/).map(x => x.trim()).filter(Boolean)) {
    const pages = [];
    for (const m of partie.split(',').map(x => x.trim()).filter(Boolean)) {
      const r = /^(\d+)\s*(?:-\s*(\d+|fin))?$/i.exec(m); if (!r) throw new Error(`plage invalide : « ${m} »`);
      const a = +r[1], b = r[2] ? (/fin/i.test(r[2]) ? n : +r[2]) : a;
      if (a < 1 || b > n || a > b) throw new Error(`plage hors du document : « ${m} »`);
      for (let k = a; k <= b; k++) pages.push(k - 1);
    }
    groupes.push(pages);
  }
  return groupes;
}
async function fractionner() {
  const n = P.pages.length; if (!n) return;
  const r = await dialogue({ titre: 'Fractionner le document', contenu: `
    <div style="display:flex;flex-direction:column;gap:10px;min-width:440px">
      <label class="case"><input type="radio" name="mode" value="chaque" checked> Un fichier par page (${n} fichiers)</label>
      <label class="case"><input type="radio" name="mode" value="n"> Un fichier toutes les <input type="number" name="nb" value="2" min="1" max="${n}" style="width:64px;margin:0 6px"> pages</label>
      <label class="case"><input type="radio" name="mode" value="plages"> Selon des plages :</label>
      <input type="text" name="plages" placeholder="Exemple : 1-3 ; 4-6 ; 7-fin" style="margin-left:26px">
      <p style="margin:4px 0 0;color:var(--encre-2);font-size:13px">Séparez les fichiers par « ; » et les pages d'un même fichier par « , ».</p>
    </div>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Fractionner', valeur: true, primaire: true }],
    valider: d => { if (d.mode === 'plages') try { analyserPlages(d.plages, n); } catch (e) { return 'Plages : ' + e.message; } if (d.mode === 'n' && !(+d.nb >= 1)) return 'Nombre de pages invalide'; } });
  if (!r) return;
  let groupes;
  if (r.mode === 'chaque') groupes = P.pages.map((_, i) => [i]);
  else if (r.mode === 'n') { groupes = []; for (let i = 0; i < n; i += +r.nb) groupes.push([...Array(Math.min(+r.nb, n - i)).keys()].map(k => i + k)); }
  else groupes = analyserPlages(r.plages, n);
  const base = nomSansExtension(doc.nom);
  let dossier = null;
  if (Fi.NATIF) { dossier = await Fi.choisirDossier('Dossier de destination'); if (!dossier) return; }
  const sep = dossier && dossier.includes('\\') ? '\\' : '/';
  let k = 0;
  for (const g of groupes) {
    k++; const octets = await construire({ ...P, pages: g.map(i => P.pages[i]) }, { medias: M, aplatirFormulaires: P.aplatir });
    const nom = `${base} - partie ${String(k).padStart(String(groupes.length).length, '0')}.pdf`;
    await Fi.enregistrerFichier({ octets, chemin: dossier ? dossier.replace(/[\\/]$/, '') + sep + nom : null, nomSuggere: nom, filtres: [{ nom: 'Document PDF', ext: ['pdf'] }] });
  }
  toast(`${groupes.length} fichier${groupes.length > 1 ? 's' : ''} créé${groupes.length > 1 ? 's' : ''}${dossier ? ' dans ' + dossier : ''}.`, 'succes');
}
function menuPages(x, y) {
  const n = pagesCiblees().length; const pl = n > 1 ? `${n} pages` : 'la page';
  menu([
    { label: 'Faire pivoter à droite', ico: 'rotate-cw', faire: () => pivoter(1) }, { label: 'Faire pivoter à gauche', ico: 'rotate-ccw', faire: () => pivoter(-1) }, '-',
    { label: `Dupliquer ${pl}`, ico: 'copy', faire: dupliquerPages }, { label: `Extraire ${pl}…`, ico: 'file-output', faire: extrairePages }, { label: `Supprimer ${pl}`, ico: 'trash-2', faire: supprimerPages }, '-',
    { label: 'Insérer une page vierge', ico: 'file-plus', faire: insererVierge }, { label: 'Insérer des pages depuis un fichier…', ico: 'file-input', faire: insererDepuisFichier },
  ], x, y);
}

// ---------- Organiseur ----------
function ouvrirOrganiseur() { $('#organiseur').style.setProperty('--haut-org', ($('#zone-ruban').getBoundingClientRect().bottom) + 'px'); $('#organiseur').classList.remove('masque'); ruban.actif('organiser', true); remplirMiniatures($('#grille-org'), 190); majBarreOrg(); $('#grille-org').focus(); }
function fermerOrganiseur() { $('#organiseur').classList.add('masque'); ruban.actif('organiser', false); }
function majBarreOrg() {
  const b = $('#barre-org'); if ($('#organiseur').classList.contains('masque')) return;
  if (!b.firstChild) {
    b.innerHTML = [['org-gauche', 'rotate-ccw', 'Pivoter à gauche'], ['org-droite', 'rotate-cw', 'Pivoter à droite'], ['org-dupliquer', 'copy', 'Dupliquer'], ['org-extraire', 'file-output', 'Extraire'], ['org-supprimer', 'trash-2', 'Supprimer'], ['org-vierge', 'file-plus', 'Page vierge'], ['org-inserer', 'file-input', 'Insérer un fichier']].map(([id, i, l]) => `<button class="btn" data-o="${id}">${ico(i, 'p')}${l}</button>`).join('') + '<span class="info"></span><button class="btn primaire" data-o="org-fermer">Fermer</button>';
    $$('button', b).forEach(x => x.onclick = () => ({ 'org-gauche': () => pivoter(-1), 'org-droite': () => pivoter(1), 'org-dupliquer': dupliquerPages, 'org-extraire': extrairePages, 'org-supprimer': supprimerPages, 'org-vierge': insererVierge, 'org-inserer': insererDepuisFichier, 'org-fermer': fermerOrganiseur })[x.dataset.o]());
  }
  $('.info', b).textContent = V.pagesSel.size ? `${V.pagesSel.size} page${V.pagesSel.size > 1 ? 's' : ''} sélectionnée${V.pagesSel.size > 1 ? 's' : ''} sur ${P.pages.length}` : `${P.pages.length} page${P.pages.length > 1 ? 's' : ''} — cliquez, Ctrl+clic ou Maj+clic pour sélectionner, glissez pour déplacer`;
}
for (const z of [$('#miniatures'), $('#grille-org')]) z.addEventListener('keydown', ev => {
  if (ev.key === 'Delete') { ev.preventDefault(); supprimerPages(); }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a') { ev.preventDefault(); V.pagesSel = new Set(P.pages.map(p => p.id)); $$('.miniature', z).forEach(x => x.classList.add('choisie')); majBarreOrg(); }
  if (z.id === 'miniatures' && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) { ev.preventDefault(); const i = V.courante + (ev.key === 'ArrowDown' ? 1 : -1); if (i >= 0 && i < P.pages.length) { V.pagesSel = new Set([P.pages[i].id]); allerPage(i); $$('.miniature', z).forEach(x => x.classList.toggle('choisie', V.pagesSel.has(x.dataset.id))); } }
});

// ---------- Annotations : création et manipulation ----------
function nouvelleAnnot(p, a) { avant(); a.id = uid('a'); p.annots.push(a); V.sel = [a.id]; V.pageSel = p.id; apres(); return a; }
const annotsSel = () => { const p = pageDe(V.pageSel); return p ? p.annots.filter(a => V.sel.includes(a.id)) : []; };
function supprimerAnnots() { const p = pageDe(V.pageSel); if (!p || !V.sel.length) return; avant(); p.annots = p.annots.filter(a => !V.sel.includes(a.id)); V.sel = []; apres(); }
let presse = null;
function copierAnnots(couper) { const l = annotsSel(); if (!l.length) return; presse = JSON.parse(JSON.stringify(l)); if (couper) supprimerAnnots(); }
function collerAnnots() { const p = pageDe(V.pageSel) || pageCourante(); if (!presse || !p) return; avant(); const n = presse.map(a => ({ ...JSON.parse(JSON.stringify(a)), id: uid('a'), x: a.x + 12, y: a.y + 12 })); p.annots.push(...n); V.sel = n.map(a => a.id); V.pageSel = p.id; presse = JSON.parse(JSON.stringify(n)); apres(); }
function choisirOutil(o) {
  if (V.edition) quitterEdition();
  V.outil = V.outil === o && o !== 'selection' ? 'selection' : o;
  if (V.outil !== 'selection') { V.sel = []; }
  if (V.outil === 'caviardage') toast('Tracez les zones à masquer. À l\'enregistrement, le contenu situé dessous est supprimé définitivement (la page concernée est convertie en image).');
  rendre();
}
function entrerEdition(a, p) {
  V.sel = [a.id]; V.pageSel = p.id; V.edition = null; rendre(); V.edition = a.id;
  const n = $(`.page[data-id="${p.id}"] .annot[data-a="${a.id}"]`); if (!n) return;
  n.contentEditable = 'plaintext-only'; if (n.contentEditable !== 'plaintext-only') n.contentEditable = 'true';
  n.focus(); const r = document.createRange(); r.selectNodeContents(n); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r);
  V.avantEdition = etat(); $('.couche-sel', n.closest('.page')).innerHTML = htmlCadres(p, S());
  n.oninput = () => { const s = S(); const hh = n.scrollHeight / s; if (hh > a.h + 0.5) { a.h = hh; n.style.height = hh * s + 'px'; $('.couche-sel', n.closest('.page')).innerHTML = htmlCadres(p, s); } modifie(); };
  n.onblur = () => setTimeout(() => { if (V.edition === a.id && document.activeElement !== n) quitterEdition(); }, 0);
}
function quitterEdition() {
  const id = V.edition; if (!id) return; V.edition = null;
  const p = pageDe(V.pageSel); const a = p?.annots.find(x => x.id === id); const n = p && $(`.page[data-id="${p.id}"] .annot[data-a="${id}"]`);
  if (a && n) {
    const t = n.innerText.replace(/\n$/, '');
    if (t !== (a.texte || '')) { if (V.avantEdition) { pile.push(V.avantEdition); futur.length = 0; } a.texte = t; modifie(); }
    if (!a.texte?.trim()) { p.annots = p.annots.filter(x => x !== a); V.sel = []; }
    n.removeAttribute('contenteditable');
  }
  V.avantEdition = null; const e = p && $(`.page[data-id="${p.id}"]`); if (e) e.dataset.annots = ''; rendre();
}

zonePages.addEventListener('pointerdown', ev => {
  if (ev.button !== 0) return;
  const e = ev.target.closest('.page'); if (!e) return;
  const p = pageDe(e.dataset.id); if (!p) return;
  if (ev.target.closest('.champ-pdf')) return;
  V.courante = idx(p.id); majEtat();
  const [x, y] = versInterieur(e, p, ev);
  if (V.outil === 'main') { ev.preventDefault(); vis.classList.add('saisie'); const x0 = ev.clientX, y0 = ev.clientY, sl = vis.scrollLeft, st = vis.scrollTop; const mv = m => { vis.scrollLeft = sl - (m.clientX - x0); vis.scrollTop = st - (m.clientY - y0); }; const up = () => { vis.classList.remove('saisie'); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); return; }
  const editionEnCours = V.edition && ev.target.closest(`.annot[data-a="${V.edition}"]`);
  if (editionEnCours) return;
  if (V.edition) quitterEdition();
  if (V.outil === 'texte') {
    ev.preventDefault();
    const a = nouvelleAnnot(p, { type: 'texte', x, y: y - 4, l: 220, h: V.style.taille * 1.2 + 8, texte: '', taille: V.style.taille, couleur: V.style.texte, police: V.style.police });
    V.outil = 'selection'; entrerEdition(a, p); return;
  }
  if (OUTILS_DESSIN.includes(V.outil)) { ev.preventDefault(); tracer(ev, e, p, x, y); return; }
  // sélection
  const poignee = ev.target.closest('.cadre-sel .p');
  if (poignee) { ev.preventDefault(); redimensionner(ev, e, p, poignee.dataset.p); return; }
  const n = ev.target.closest('.annot');
  if (!n) { if (V.sel.length) { V.sel = []; rendre(); } return; } // laisser la sélection de texte native
  ev.preventDefault(); vis.focus({ preventScroll: true });
  const id = n.dataset.a;
  if (V.pageSel !== p.id) V.sel = [];
  V.pageSel = p.id;
  if (ev.shiftKey || ev.ctrlKey) V.sel = V.sel.includes(id) ? V.sel.filter(k => k !== id) : [...V.sel, id];
  else if (!V.sel.includes(id)) V.sel = [id];
  rendre();
  const orig = annotsSel().map(a => ({ a, x: a.x, y: a.y })); let bouge = false;
  const mv = m => {
    const [x2, y2] = versInterieur(e, p, m); const dx = x2 - x, dy = y2 - y;
    if (!bouge && Math.hypot(dx, dy) * S() < 3) return; if (!bouge) { bouge = true; avant(); }
    orig.forEach(o => { o.a.x = Math.max(-o.a.l + 5, Math.min(p.l - 5, o.x + dx)); o.a.y = Math.max(-o.a.h + 5, Math.min(p.h - 5, o.y + dy)); });
    rendrePageSeule(p);
  };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (bouge) apres(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});
zonePages.addEventListener('dblclick', ev => {
  const n = ev.target.closest('.annot'); const e = ev.target.closest('.page'); if (!n || !e) return;
  const p = pageDe(e.dataset.id); const a = p?.annots.find(x => x.id === n.dataset.a);
  if (a && (a.type === 'texte' || a.type === 'tampon')) { ev.preventDefault(); if (a.type === 'tampon') { demander('Texte du tampon', '', a.texte).then(v => { if (v != null && v.trim()) { avant(); a.texte = v; apres(); } }); return; } entrerEdition(a, p); }
});
zonePages.addEventListener('contextmenu', ev => {
  const e = ev.target.closest('.page'); if (!e) return;
  const n = ev.target.closest('.annot'); const p = pageDe(e.dataset.id);
  if (n) { ev.preventDefault(); if (!V.sel.includes(n.dataset.a)) { V.sel = [n.dataset.a]; V.pageSel = p.id; rendre(); } menu([{ label: 'Couper', ico: 'scissors', faire: () => copierAnnots(true) }, { label: 'Copier', ico: 'copy', faire: () => copierAnnots(false) }, { label: 'Supprimer', ico: 'trash-2', faire: supprimerAnnots }, '-', { label: 'Premier plan', ico: 'bring-to-front', faire: () => ordreAnnot(1) }, { label: 'Arrière-plan', ico: 'send-to-back', faire: () => ordreAnnot(-1) }], ev.clientX, ev.clientY); return; }
  const t = getSelection().toString();
  if (t) { ev.preventDefault(); menu([{ label: 'Copier', ico: 'copy', faire: () => navigator.clipboard?.writeText(t) }, { label: 'Surligner', ico: 'highlighter', faire: surlignerSelection }], ev.clientX, ev.clientY); return; }
  ev.preventDefault(); V.courante = idx(p.id); menu([{ label: 'Coller', ico: 'clipboard-paste', faire: collerAnnots, desactive: !presse }, '-', { label: 'Faire pivoter la page', ico: 'rotate-cw', faire: () => { V.pagesSel = new Set([p.id]); pivoter(1); } }, { label: 'Supprimer la page', ico: 'trash-2', faire: () => { V.pagesSel = new Set([p.id]); supprimerPages(); } }], ev.clientX, ev.clientY);
});
function ordreAnnot(sens) { const p = pageDe(V.pageSel); if (!p) return; avant(); const sel = p.annots.filter(a => V.sel.includes(a.id)), autres = p.annots.filter(a => !V.sel.includes(a.id)); p.annots = sens > 0 ? [...autres, ...sel] : [...sel, ...autres]; apres(); }
function rendrePageSeule(p) {
  const e = $(`.page[data-id="${p.id}"]`); if (!e) return; const s = S();
  for (const a of annotsSel()) { const n = $(`.annot[data-a="${a.id}"]`, e); if (n) n.outerHTML = htmlAnnot(a, s); }
  $('.couche-sel', e).innerHTML = htmlCadres(p, s);
}
function tracer(ev, e, p, x0, y0) {
  const s = S(); const outil = V.outil; const ci = $('.contenu-page', e);
  const apercu = el('<div class="rectangle-trace"></div>'); ci.appendChild(apercu);
  let svg = null, pts = [x0, y0];
  if (outil === 'crayon' || outil === 'ligne' || outil === 'fleche') { apercu.remove(); svg = el(`<svg style="position:absolute;inset:0;width:100%;height:100%;z-index:6;pointer-events:none;overflow:visible" viewBox="0 0 ${p.l} ${p.h}"><path fill="none" stroke="${V.style.couleur}" stroke-width="${V.style.epaisseur}" stroke-linecap="round" stroke-linejoin="round"/></svg>`); ci.appendChild(svg); }
  let x1 = x0, y1 = y0;
  const mv = m => {
    [x1, y1] = versInterieur(e, p, m); x1 = Math.max(0, Math.min(p.l, x1)); y1 = Math.max(0, Math.min(p.h, y1));
    if (outil === 'crayon') { pts.push(Math.round(x1 * 10) / 10, Math.round(y1 * 10) / 10); $('path', svg).setAttribute('d', 'M' + pts.join(' ').replace(/^(\S+ \S+)/, '$1 L')); return; }
    if (svg) { if (m.shiftKey) { const ang = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(x1 - x0, y1 - y0); x1 = x0 + d * Math.cos(ang); y1 = y0 + d * Math.sin(ang); } $('path', svg).setAttribute('d', `M${x0} ${y0} L${x1} ${y1}`); return; }
    if (m.shiftKey && (outil === 'rect' || outil === 'ellipse')) { const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * d; y1 = y0 + Math.sign(y1 - y0 || 1) * d; }
    Object.assign(apercu.style, { left: Math.min(x0, x1) * s + 'px', top: Math.min(y0, y1) * s + 'px', width: Math.abs(x1 - x0) * s + 'px', height: Math.abs(y1 - y0) * s + 'px' });
  };
  const up = () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up); apercu.remove(); svg?.remove();
    const bx = Math.min(x0, x1), by = Math.min(y0, y1), bl = Math.abs(x1 - x0), bh = Math.abs(y1 - y0);
    if (outil === 'crayon') {
      if (pts.length < 4) return;
      const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1); const mx = Math.min(...xs), my = Math.min(...ys);
      const rel = pts.map((v, i) => Math.round((v - (i % 2 === 0 ? mx : my)) * 10) / 10);
      nouvelleAnnot(p, { type: 'trait', x: mx, y: my, l: Math.max(...xs) - mx, h: Math.max(...ys) - my, traits: [rel], couleur: V.style.couleur, epaisseur: V.style.epaisseur });
    } else if (outil === 'ligne' || outil === 'fleche') {
      if (Math.hypot(x1 - x0, y1 - y0) < 3) return;
      nouvelleAnnot(p, { type: outil, x: bx, y: by, l: bl, h: bh, pts: [x0 - bx, y0 - by, x1 - bx, y1 - by], couleur: V.style.couleur, epaisseur: V.style.epaisseur });
    } else {
      if (bl < 3 || bh < 3) return;
      const base = { x: bx, y: by, l: bl, h: bh };
      if (outil === 'surligneur') nouvelleAnnot(p, { ...base, type: 'surlignage', couleur: V.style.surligneur, opacite: 0.4 });
      else if (outil === 'caviardage') nouvelleAnnot(p, { ...base, type: 'caviardage' });
      else nouvelleAnnot(p, { ...base, type: outil, couleur: V.style.couleur, epaisseur: V.style.epaisseur, remplissage: V.style.remplissage });
    }
    if (!STICKY.includes(outil)) { V.outil = 'selection'; rendre(); }
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function redimensionner(ev, e, p, q) {
  const a = annotsSel()[0]; if (!a) return; avant();
  const o = JSON.parse(JSON.stringify(a)); const ratio = o.l / Math.max(0.1, o.h);
  const mv = m => {
    let [x, y] = versInterieur(e, p, m);
    if (q === 'p1' || q === 'p2') {
      const pa = [o.x + o.pts[0], o.y + o.pts[1], o.x + o.pts[2], o.y + o.pts[3]];
      if (q === 'p1') { pa[0] = x; pa[1] = y; } else { pa[2] = x; pa[3] = y; }
      a.x = Math.min(pa[0], pa[2]); a.y = Math.min(pa[1], pa[3]); a.l = Math.abs(pa[2] - pa[0]); a.h = Math.abs(pa[3] - pa[1]); a.pts = [pa[0] - a.x, pa[1] - a.y, pa[2] - a.x, pa[3] - a.y];
    } else {
      let { x: nx, y: ny, l, h } = o;
      if (q.includes('e')) l = x - o.x; if (q.includes('s')) h = y - o.y;
      if (q.includes('w')) { l = o.x + o.l - x; nx = x; } if (q.includes('n')) { h = o.y + o.h - y; ny = y; }
      if ((m.shiftKey || a.type === 'image' || a.type === 'tampon') && q.length === 2) { const nh = l / ratio; if (q.includes('n')) ny = o.y + o.h - nh; h = nh; }
      a.l = Math.max(4, l); a.h = Math.max(4, h); a.x = q.includes('w') ? o.x + o.l - a.l : nx; a.y = q.includes('n') ? o.y + o.h - a.h : ny;
      if (a.type === 'trait') { const kx = a.l / Math.max(0.1, o.l), ky = a.h / Math.max(0.1, o.h); a.traits = o.traits.map(t => t.map((v, i) => Math.round(v * (i % 2 === 0 ? kx : ky) * 10) / 10)); }
      if (a.type === 'tampon') a.taille = o.taille * a.h / o.h;
    }
    rendrePageSeule(p);
  };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); apres(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function surlignerSelection() {
  const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return false;
  const rects = [...sel.getRangeAt(0).getClientRects()].filter(r => r.width > 1 && r.height > 1);
  const parPage = new Map();
  for (const r of rects) {
    const e = $$('.page', zonePages).find(pe => { const b = pe.getBoundingClientRect(); return r.left + r.width / 2 >= b.left && r.left + r.width / 2 <= b.right && r.top + r.height / 2 >= b.top && r.top + r.height / 2 <= b.bottom; });
    if (!e) continue; const p = pageDe(e.dataset.id);
    const c1 = versInterieur(e, p, { clientX: r.left, clientY: r.top }), c2 = versInterieur(e, p, { clientX: r.right, clientY: r.bottom });
    const box = { x: Math.min(c1[0], c2[0]), y: Math.min(c1[1], c2[1]), l: Math.abs(c2[0] - c1[0]), h: Math.abs(c2[1] - c1[1]) };
    if (!parPage.has(p.id)) parPage.set(p.id, []);
    const l = parPage.get(p.id); const meme = l.find(b => Math.abs(b.y - box.y) < box.h * 0.5 && Math.abs(b.h - box.h) < box.h * 0.5 && box.x <= b.x + b.l + 4 && box.x + box.l >= b.x - 4);
    if (meme) { const x2 = Math.max(meme.x + meme.l, box.x + box.l); meme.x = Math.min(meme.x, box.x); meme.l = x2 - meme.x; } else l.push(box);
  }
  if (!parPage.size) return false;
  avant(); let dernier;
  for (const [pid, boxes] of parPage) { const p = pageDe(pid); for (const b of boxes) { dernier = { id: uid('a'), type: 'surlignage', ...b, couleur: V.style.surligneur, opacite: 0.4 }; p.annots.push(dernier); } V.pageSel = pid; }
  sel.removeAllRanges(); V.sel = dernier ? [dernier.id] : []; apres(); return true;
}
document.addEventListener('pointerup', () => { if (V.outil === 'surligneur') setTimeout(() => { const s = getSelection(); if (s && !s.isCollapsed && s.anchorNode && zonePages.contains(s.anchorNode)) surlignerSelection(); }, 0); });

// Clavier dans la visionneuse
vis.addEventListener('keydown', ev => {
  if (V.edition) { if (ev.key === 'Escape') { ev.preventDefault(); quitterEdition(); vis.focus(); } return; }
  if (ev.target.closest?.('.champ-pdf')) return;
  const k = ev.key, ctrl = ev.ctrlKey || ev.metaKey;
  if ((k === 'Delete' || k === 'Backspace') && V.sel.length) { ev.preventDefault(); supprimerAnnots(); return; }
  const fl = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
  if (fl && V.sel.length) { ev.preventDefault(); avant(); const pas = ev.shiftKey ? 10 : 1; annotsSel().forEach(a => { a.x += fl[0] * pas; a.y += fl[1] * pas; }); apres(); return; }
  if (ctrl && k.toLowerCase() === 'c' && V.sel.length) { copierAnnots(false); return; }
  if (ctrl && k.toLowerCase() === 'x' && V.sel.length) { copierAnnots(true); return; }
  if (ctrl && k.toLowerCase() === 'v' && presse) { ev.preventDefault(); collerAnnots(); return; }
  if (k === 'Enter' && V.sel.length === 1) { const a = annotsSel()[0]; if (a.type === 'texte') { ev.preventDefault(); entrerEdition(a, pageDe(V.pageSel)); } return; }
  if (!V.sel.length && (k === 'PageDown' || k === 'PageUp') && V.mode === 'page') { ev.preventDefault(); allerPage(V.courante + (k === 'PageDown' ? 1 : -1)); }
  if (!V.sel.length && k === 'Home' && ctrl) { allerPage(0); } if (!V.sel.length && k === 'End' && ctrl) { allerPage(P.pages.length - 1); }
});
vis.addEventListener('wheel', ev => { if (!ev.ctrlKey) return; ev.preventDefault(); definirZoom(V.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });

// ---------- Insertion d'éléments ----------
function centreVisible(p) {
  const e = $(`.page[data-id="${p.id}"]`); const r = e?.getBoundingClientRect(), rv = vis.getBoundingClientRect();
  if (!r) return [p.l / 2, p.h / 2];
  const cx = (Math.max(r.left, rv.left) + Math.min(r.right, rv.right)) / 2, cy = (Math.max(r.top, rv.top) + Math.min(r.bottom, rv.bottom)) / 2;
  return versInterieur(e, p, { clientX: cx, clientY: cy });
}
async function insererImage(url, l0, h0, largeurMax = 0.5) {
  const p = pageCourante(); if (!p) return;
  const id = uid('m'); M[id] = url;
  const k = Math.min(1, (p.l * largeurMax) / l0, (p.h * 0.6) / h0); const l = l0 * k, h = h0 * k; const [cx, cy] = centreVisible(p);
  nouvelleAnnot(p, { type: 'image', x: Math.max(0, Math.min(p.l - l, cx - l / 2)), y: Math.max(0, Math.min(p.h - h, cy - h / 2)), l, h, src: 'media:' + id });
}
async function choisirEtInsererImage() {
  const f = await Fi.ouvrirFichier({ titre: 'Insérer une image', filtres: [{ nom: 'Images', ext: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] }] }); if (!f) return;
  try { const im = await preparerImage(f.octets, f.nom); await insererImage(im.url, im.l * 0.75, im.h * 0.75); } catch (e) { toast(e.message, 'erreur'); }
}
const TAMPONS = [['APPROUVÉ', '#1E7444'], ['REFUSÉ', '#B42318'], ['CONFIDENTIEL', '#B42318'], ['COPIE CONFORME', '#2456B0'], ['VU', '#2456B0'], ['BROUILLON', '#5A6274'], ['À SIGNER', '#B25000'], ['REÇU LE ' + new Date().toLocaleDateString('fr-FR'), '#2456B0']];
function insererTampon(texte, couleur) {
  const p = pageCourante(); if (!p) return; const taille = 18;
  const l = Math.max(60, texte.length * taille * 0.68 + 26), h = taille * 1.2 + 16; const [cx, cy] = centreVisible(p);
  nouvelleAnnot(p, { type: 'tampon', texte, couleur, taille, x: Math.max(0, cx - l / 2), y: Math.max(0, cy - h / 2), l, h, opacite: 0.9 });
}
function menuTampons(ancre) {
  const g = el(`<div><div class="apercu-tampons">${TAMPONS.map(([t, c], i) => `<button data-i="${i}" style="color:${c}"><span>${esc(t)}</span></button>`).join('')}</div><div style="padding:0 8px 8px"><button class="btn" data-perso style="width:100%">Tampon personnalisé…</button></div></div>`);
  $$('[data-i]', g).forEach(b => b.onclick = () => { fermerMenu(); const [t, c] = TAMPONS[+b.dataset.i]; insererTampon(t, c); });
  $('[data-perso]', g).onclick = async () => { fermerMenu(); const t = await demander('Tampon personnalisé', 'Texte du tampon', 'TRAITÉ'); if (t && t.trim()) insererTampon(t.trim().toUpperCase(), '#2456B0'); };
  menu([{ element: g }], 0, 0, ancre);
}
async function dialogueSignature() {
  const memo = (doc.prefs?.signatures || []);
  let mode = 'dessin', traits = [], encre = '#14254A';
  const r = await dialogue({ titre: 'Signer', taille: 'large', contenu: `
    <div class="onglets-sig"><button type="button" data-m="dessin" class="actif">Dessiner</button><button type="button" data-m="saisie">Saisir</button><button type="button" data-m="image">Importer une image</button></div>
    <div data-z="dessin"><canvas class="zone-sig" width="560" height="190"></canvas><div style="display:flex;gap:8px;margin-top:8px;align-items:center"><button type="button" class="btn" data-effacer>Effacer</button><span style="flex:1"></span>Encre : ${['#14254A', '#000000', '#1F4FBF'].map(c => `<button type="button" class="btn icone" data-encre="${c}" title="${c}" style="width:26px;height:26px;padding:0;background:${c};border-radius:50%"></button>`).join('')}</div></div>
    <div data-z="saisie" class="masque"><label class="champ">Votre nom<input type="text" name="nom" value=""></label><canvas class="zone-sig" data-c="saisie" width="560" height="120" style="margin-top:8px"></canvas></div>
    <div data-z="image" class="masque"><p>Choisissez une image de votre signature (fond blanc ou transparent).</p><button type="button" class="btn" data-choisir>Choisir une image…</button><div data-apercu style="margin-top:10px"></div></div>
    <label class="case" style="margin-top:12px"><input type="checkbox" name="memo" checked> Mémoriser cette signature sur ce poste</label>
    ${memo.length ? `<p style="margin:12px 0 4px;font-weight:600">Signatures mémorisées</p><div class="sig-memo">${memo.map((s, i) => `<button type="button" data-memo="${i}" title="Utiliser cette signature"><img src="${s}" alt="Signature ${i + 1}"></button>`).join('')}</div>` : ''}`,
    boutons: [{ label: 'Annuler', valeur: null }, { label: 'Insérer la signature', valeur: true, primaire: true }],
    init: c => {
      const cv = $('canvas.zone-sig', c), g = cv.getContext('2d'); g.lineCap = 'round'; g.lineJoin = 'round';
      const redessiner = () => { g.clearRect(0, 0, cv.width, cv.height); g.strokeStyle = encre; g.lineWidth = 2.6; traits.forEach(t => { g.beginPath(); t.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); if (t.length === 1) g.lineTo(t[0][0] + 0.1, t[0][1]); g.stroke(); }); };
      cv.onpointerdown = ev => { cv.setPointerCapture(ev.pointerId); const r = cv.getBoundingClientRect(); const t = [[(ev.clientX - r.left) * cv.width / r.width, (ev.clientY - r.top) * cv.height / r.height]]; traits.push(t); redessiner(); cv.onpointermove = m => { t.push([(m.clientX - r.left) * cv.width / r.width, (m.clientY - r.top) * cv.height / r.height]); redessiner(); }; cv.onpointerup = () => { cv.onpointermove = null; }; };
      $('[data-effacer]', c).onclick = () => { traits = []; redessiner(); };
      $$('[data-encre]', c).forEach(b => b.onclick = () => { encre = b.dataset.encre; redessiner(); dessinerSaisie(); });
      const cs = $('[data-c="saisie"]', c), gs = cs.getContext('2d');
      const dessinerSaisie = () => { gs.clearRect(0, 0, cs.width, cs.height); gs.fillStyle = encre; gs.font = 'italic 52px "Segoe Script","Brush Script MT","Lucida Handwriting",cursive'; gs.textBaseline = 'middle'; gs.fillText($('[name="nom"]', c).value, 16, cs.height / 2); };
      $('[name="nom"]', c).oninput = dessinerSaisie;
      $$('.onglets-sig button', c).forEach(b => b.onclick = () => { mode = b.dataset.m; $$('.onglets-sig button', c).forEach(x => x.classList.toggle('actif', x === b)); $$('[data-z]', c).forEach(z => z.classList.toggle('masque', z.dataset.z !== mode)); });
      $('[data-choisir]', c).onclick = async () => { const f = await Fi.ouvrirFichier({ titre: 'Image de signature', filtres: [{ nom: 'Images', ext: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }] }); if (!f) return; const im = await preparerImage(f.octets, f.nom); c.__image = im; $('[data-apercu]', c).innerHTML = `<img src="${im.url}" style="max-height:120px;border:1px solid var(--ligne)">`; };
      $$('[data-memo]', c).forEach(b => b.onclick = () => { c.__memo = memo[+b.dataset.memo]; $('.dialogue footer .btn.primaire').click(); });
      c.__exporter = () => {
        if (c.__memo) return c.__memo;
        if (mode === 'image') return c.__image?.url || null;
        const src = mode === 'dessin' ? cv : cs; if (mode === 'dessin' && !traits.length) return null; if (mode === 'saisie' && !$('[name="nom"]', c).value.trim()) return null;
        // recadrage sur l'encre
        const d = src.getContext('2d').getImageData(0, 0, src.width, src.height).data; let x0 = src.width, y0 = src.height, x1 = 0, y1 = 0;
        for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) if (d[(y * src.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 <= x0) return null;
        const m = 6, o = document.createElement('canvas'); o.width = x1 - x0 + 2 * m; o.height = y1 - y0 + 2 * m; o.getContext('2d').drawImage(src, x0 - m, y0 - m, o.width, o.height, 0, 0, o.width, o.height);
        return o.toDataURL('image/png');
      };
    },
    valider: (d, c) => (c.__exporter() ? null : 'Signature vide : dessinez, saisissez ou importez votre signature.'),
  });
  if (!r) return;
  const url = r.corps.__exporter();
  if (r.memo && !memo.includes(url)) { doc.prefs.signatures = [url, ...memo].slice(0, 5); Fi.ecrirePrefs('pdf', doc.prefs); }
  const im = await new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = url; });
  await insererImage(url, im.naturalWidth * 0.5, im.naturalHeight * 0.5, 0.35);
}

// ---------- Recherche ----------
const R = { q: '', res: [], i: -1 };
const norm = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function ouvrirRecherche() { $('#barre-recherche').classList.remove('masque'); const q = $('#q'); const t = getSelection().toString().trim(); if (t && t.length < 80) q.value = t; q.focus(); q.select(); if (q.value) lancerRecherche(); }
function fermerRecherche() { $('#barre-recherche').classList.add('masque'); R.q = ''; R.res = []; $$('.couche-texte mark').forEach(m => m.replaceWith(...m.childNodes)); $$('.couche-texte span').forEach(s => s.normalize()); vis.focus(); }
async function lancerRecherche() {
  const q = norm($('#q').value.trim()); R.q = q; R.res = []; R.i = -1;
  if (!q) { majResultats(); surlignerToutes(); return; }
  for (let i = 0; i < P.pages.length; i++) {
    const tc = await contenuTexte(P.pages[i]); if (!tc) continue;
    const items = tc.items.filter(it => it.str !== undefined);
    items.forEach((it, k) => { const t = norm(it.str); let pos = t.indexOf(q); while (pos >= 0) { R.res.push({ page: i, item: k, pos }); pos = t.indexOf(q, pos + q.length); } });
  }
  if (q !== R.q) return;
  R.i = R.res.length ? R.res.findIndex(r => r.page >= V.courante) : -1; if (R.i < 0 && R.res.length) R.i = 0;
  majResultats(); surlignerToutes(); allerResultat();
}
function majResultats() { $('#q-res').textContent = !R.q ? '' : R.res.length ? `${R.i + 1} sur ${R.res.length}` : 'Aucun résultat'; }
function surlignerToutes() { $$('.page', zonePages).forEach(e => surlignerPage(e.dataset.id)); }
function surlignerPage(id) {
  const e = $(`.page[data-id="${id}"]`); const ct = e && $('.couche-texte', e); if (!ct || !ct.__divs) return;
  ct.querySelectorAll('mark').forEach(m => m.replaceWith(...m.childNodes)); ct.__divs.forEach(d => d.normalize());
  if (!R.q) return; const i = idx(id);
  R.res.forEach((r, n) => {
    if (r.page !== i) return; const d = ct.__divs[r.item]; if (!d || !d.firstChild) return;
    const txt = d.textContent; const avantT = txt.slice(0, r.pos), m = txt.slice(r.pos, r.pos + R.q.length), apresT = txt.slice(r.pos + R.q.length);
    if (d.querySelector('mark')) { // plusieurs résultats dans le même élément
      const tous = R.res.map((x, j) => ({ ...x, j })).filter(x => x.page === i && x.item === r.item);
      let h = '', curseur = 0; tous.forEach(x => { h += esc(txt.slice(curseur, x.pos)) + `<mark class="${x.j === R.i ? 'actif' : ''}">${esc(txt.slice(x.pos, x.pos + R.q.length))}</mark>`; curseur = x.pos + R.q.length; }); h += esc(txt.slice(curseur)); d.innerHTML = h; return;
    }
    d.innerHTML = `${esc(avantT)}<mark class="${n === R.i ? 'actif' : ''}">${esc(m)}</mark>${esc(apresT)}`;
  });
}
async function allerResultat() {
  const r = R.res[R.i]; if (!r) return;
  const p = P.pages[r.page]; allerPage(r.page, { haut: false });
  const e = $(`.page[data-id="${p.id}"]`); vis.scrollTop = e.offsetTop - 12;
  await rendreCanevas(p.id); surlignerToutes();
  const m = $('.couche-texte mark.actif', e); if (m) { const rm = m.getBoundingClientRect(), rv = vis.getBoundingClientRect(); vis.scrollTop += rm.top - rv.top - rv.height / 3; vis.scrollLeft += Math.max(0, rm.right - rv.right + 40); }
}
function resultatSuivant(sens) { if (!R.res.length) return; R.i = (R.i + sens + R.res.length) % R.res.length; majResultats(); surlignerToutes(); allerResultat(); }
$('#q').addEventListener('input', debounce(lancerRecherche, 250));
$('#q').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); if (R.q !== norm($('#q').value.trim())) lancerRecherche(); else resultatSuivant(ev.shiftKey ? -1 : 1); } if (ev.key === 'Escape') { ev.preventDefault(); fermerRecherche(); } });
$('#q-prec').innerHTML = ico('chevron-up', 'p'); $('#q-suiv').innerHTML = ico('chevron-down', 'p'); $('#q-fermer').innerHTML = ico('x', 'p');
$('#q-prec').onclick = () => resultatSuivant(-1); $('#q-suiv').onclick = () => resultatSuivant(1); $('#q-fermer').onclick = fermerRecherche;

// ---------- Outils de document ----------
async function dialogueFiligrane() {
  const f = P.filigrane || { texte: 'CONFIDENTIEL', couleur: '#B0261E', opacite: 0.2, taille: 60, angle: 45 };
  const r = await dialogue({ titre: 'Filigrane', contenu: `<div class="grille-champs">
    <label class="champ" style="grid-column:1/-1">Texte<input type="text" name="texte" value="${esc(f.texte)}"></label>
    <label class="champ">Couleur<input type="color" name="couleur" value="${f.couleur}" style="height:34px;padding:2px"></label>
    <label class="champ">Opacité (%)<input type="number" name="opacite" min="5" max="100" value="${Math.round((f.opacite ?? 0.2) * 100)}"></label>
    <label class="champ">Taille (pt)<input type="number" name="taille" min="10" max="200" value="${f.taille}"></label>
    <label class="champ">Angle (°)<input type="number" name="angle" min="-90" max="90" value="${f.angle}"></label></div>`,
    boutons: [...(P.filigrane ? [{ label: 'Supprimer le filigrane', valeur: 'suppr', gauche: true }] : []), { label: 'Annuler', valeur: null }, { label: 'Appliquer', valeur: true, primaire: true }] });
  if (!r) return; avant();
  P.filigrane = r.valeur === 'suppr' || !r.texte.trim() ? null : { texte: r.texte.trim(), couleur: r.couleur, opacite: Math.max(0.05, Math.min(1, +r.opacite / 100)), taille: +r.taille || 60, angle: +r.angle || 0 };
  apres();
}
async function dialogueNumerotation() {
  const N = P.numerotation || { position: 'bas-centre', format: 'Page {n} sur {total}', debut: 1, taille: 10, ignorerPremiere: false };
  const positions = [['haut-gauche', 'En haut à gauche'], ['haut-centre', 'En haut au centre'], ['haut-droite', 'En haut à droite'], ['bas-gauche', 'En bas à gauche'], ['bas-centre', 'En bas au centre'], ['bas-droite', 'En bas à droite']];
  const formats = ['Page {n} sur {total}', 'Page {n}', '{n}', '{n} / {total}', '- {n} -'];
  const r = await dialogue({ titre: 'Numéroter les pages', contenu: `<div class="grille-champs">
    <label class="champ">Position<select name="position">${positions.map(([v, l]) => `<option value="${v}" ${v === N.position ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="champ">Format<select name="format">${formats.map(v => `<option value="${esc(v)}" ${v === N.format ? 'selected' : ''}>${esc(v.replace('{n}', '3').replace('{total}', '12'))}</option>`).join('')}</select></label>
    <label class="champ">Commencer à<input type="number" name="debut" min="0" value="${N.debut}"></label>
    <label class="champ">Taille (pt)<input type="number" name="taille" min="6" max="40" value="${N.taille}"></label>
    <label class="case" style="grid-column:1/-1"><input type="checkbox" name="ignorerPremiere" ${N.ignorerPremiere ? 'checked' : ''}> Ne pas numéroter la première page (page de garde)</label></div>`,
    boutons: [...(P.numerotation ? [{ label: 'Retirer la numérotation', valeur: 'suppr', gauche: true }] : []), { label: 'Annuler', valeur: null }, { label: 'Appliquer', valeur: true, primaire: true }] });
  if (!r) return; avant();
  P.numerotation = r.valeur === 'suppr' ? null : { position: r.position, format: r.format, debut: +r.debut || 0, taille: +r.taille || 10, ignorerPremiere: !!r.ignorerPremiere, marge: 28 };
  apres();
}
async function dialogueProtection() {
  const pr = P.protection || { permissions: { impression: true, copie: true, modification: false } };
  const r = await dialogue({ titre: 'Protéger par mot de passe', contenu: `
    <p>Le mot de passe sera demandé à l'ouverture du document. Il ne peut pas être récupéré en cas d'oubli.</p>
    <div class="grille-champs"><label class="champ">Mot de passe<input type="password" name="m1" value="${esc(pr.motDePasse || '')}" autocomplete="new-password"></label><label class="champ">Confirmation<input type="password" name="m2" value="${esc(pr.motDePasse || '')}" autocomplete="new-password"></label></div>
    <p style="margin:14px 0 6px;font-weight:600">Autoriser</p>
    <label class="case"><input type="checkbox" name="impression" ${pr.permissions?.impression !== false ? 'checked' : ''}> L'impression</label>
    <label class="case"><input type="checkbox" name="copie" ${pr.permissions?.copie !== false ? 'checked' : ''}> La copie du texte</label>
    <label class="case"><input type="checkbox" name="modification" ${pr.permissions?.modification ? 'checked' : ''}> La modification</label>`,
    boutons: [...(P.protection ? [{ label: 'Retirer la protection', valeur: 'suppr', gauche: true }] : []), { label: 'Annuler', valeur: null }, { label: 'Protéger', valeur: true, primaire: true }],
    valider: d => { if (d.m1.length < 4) return 'Le mot de passe doit comporter au moins 4 caractères.'; if (d.m1 !== d.m2) return 'Les deux mots de passe sont différents.'; } });
  if (!r) return; avant();
  if (r.valeur === 'suppr') { P.protection = null; apres(); toast('La protection sera retirée à l\'enregistrement.'); return; }
  const proprietaire = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  P.protection = { motDePasse: r.m1, proprietaire, permissions: { impression: !!r.impression, copie: !!r.copie, modification: !!r.modification } };
  apres(); toast('Le document sera protégé à l\'enregistrement.', 'succes');
}
async function dialogueProprietes() {
  const m = P.meta || {};
  const r = await dialogue({ titre: 'Propriétés du document', contenu: `<div style="display:flex;flex-direction:column;gap:10px;min-width:440px">
    <label class="champ">Titre<input type="text" name="titre" value="${esc(m.titre || '')}"></label>
    <label class="champ">Auteur<input type="text" name="auteur" value="${esc(m.auteur || '')}"></label>
    <label class="champ">Sujet<input type="text" name="sujet" value="${esc(m.sujet || '')}"></label>
    <label class="champ">Mots-clés<input type="text" name="motsCles" value="${esc(m.motsCles || '')}" placeholder="séparés par des virgules"></label>
    <label class="case"><input type="checkbox" name="aplatir" ${P.aplatir ? 'checked' : ''}> Figer les champs de formulaire à l'enregistrement (non modifiables ensuite)</label></div>`,
    boutons: [{ label: 'Annuler', valeur: null }, { label: 'OK', valeur: true, primaire: true }] });
  if (!r) return; avant(); P.meta = { titre: r.titre, auteur: r.auteur, sujet: r.sujet, motsCles: r.motsCles }; P.aplatir = !!r.aplatir; apres();
}

// ---------- Impression et exports ----------
async function documentFinal() { return construire(P, { medias: M, aplatirFormulaires: P.aplatir }); }
async function imprimer() {
  if (!P.pages.length) return toast('Aucune page à imprimer.');
  toast('Préparation de l\'impression…');
  const pdf = await ouvrirPourLecture(await construire({ ...P, protection: null }, { medias: M, aplatirFormulaires: true }));
  const z = $('#zone-impression'); z.innerHTML = '';
  for (let i = 1; i <= pdf.numPages; i++) { const r = await pageEnImage(pdf, i, 150); z.insertAdjacentHTML('beforeend', `<div class="feuille ${r.l > r.h ? 'paysage' : ''}"><img src="${URL.createObjectURL(r.blob)}" alt="Page ${i}"></div>`); }
  await Promise.all($$('img', z).map(i => i.decode().catch(() => { })));
  pdf.destroy(); window.print();
}
async function exporterImages() {
  const pdf = await ouvrirPourLecture(await construire({ ...P, protection: null }, { medias: M, aplatirFormulaires: true }));
  const base = nomSansExtension(doc.nom);
  let dossier = null; if (Fi.NATIF) { dossier = await Fi.choisirDossier('Dossier de destination des images'); if (!dossier) return; }
  const sep = dossier && dossier.includes('\\') ? '\\' : '/';
  for (let i = 1; i <= pdf.numPages; i++) {
    const r = await pageEnImage(pdf, i, 150); const nom = `${base} - page ${String(i).padStart(String(pdf.numPages).length, '0')}.png`;
    await Fi.enregistrerFichier({ octets: r.blob, chemin: dossier ? dossier.replace(/[\\/]$/, '') + sep + nom : null, nomSuggere: nom, filtres: [{ nom: 'Image PNG', ext: ['png'] }] });
  }
  pdf.destroy(); toast(`${pdf.numPages} image${pdf.numPages > 1 ? 's' : ''} exportée${pdf.numPages > 1 ? 's' : ''}.`, 'succes');
}
async function exporterTexte() { const pdf = await ouvrirPourLecture(await construire({ ...P, protection: null }, { medias: M })); const t = await texteDuDocument(pdf); pdf.destroy(); return '﻿' + t.replace(/\n/g, '\r\n'); }

// ---------- Barre d'état ----------
$('#barre-etat').innerHTML = `<span>Page <input type="text" id="num-page" inputmode="numeric" style="width:38px;text-align:center;padding:1px 3px;border:1px solid var(--ligne);border-radius:3px;background:var(--papier);color:inherit"> sur <span id="nb-pages">0</span></span><span id="etat-outil"></span><span class="espace"></span>
  <span class="zoom"><button id="z-moins" title="Zoom arrière">${ico('minus', 'p')}</button><input type="range" id="z-curseur" min="25" max="400" step="5" aria-label="Zoom"><button id="z-plus" title="Zoom avant">${ico('plus', 'p')}</button><span id="z-val" style="min-width:42px;text-align:right"></span></span>
  <button id="z-largeur" title="Ajuster à la largeur">${ico('move-horizontal', 'p')}</button><button id="z-page" title="Page entière">${ico('scan', 'p')}</button>`;
$('#num-page').addEventListener('keydown', ev => { if (ev.key === 'Enter') { const n = parseInt(ev.target.value, 10); if (n >= 1 && n <= P.pages.length) allerPage(n - 1); else ev.target.value = V.courante + 1; vis.focus(); } });
$('#z-curseur').oninput = e => definirZoom(+e.target.value / 100); $('#z-moins').onclick = () => definirZoom(V.zoom / 1.2); $('#z-plus').onclick = () => definirZoom(V.zoom * 1.2);
$('#z-largeur').onclick = () => definirZoom(0, 'largeur'); $('#z-page').onclick = () => definirZoom(0, 'page');
const NOMS_OUTILS = { selection: '', main: 'Main', texte: 'Texte : cliquez pour écrire', surligneur: 'Surligneur : sélectionnez du texte ou tracez une zone', crayon: 'Crayon', rect: 'Rectangle', ellipse: 'Ellipse', ligne: 'Ligne', fleche: 'Flèche', caviardage: 'Caviardage : tracez les zones à masquer' };
function majEtat() {
  if (document.activeElement !== $('#num-page')) $('#num-page').value = P.pages.length ? V.courante + 1 : 0;
  $('#nb-pages').textContent = P.pages.length; $('#z-val').textContent = Math.round(V.zoom * 100) + ' %'; $('#z-curseur').value = Math.round(V.zoom * 100);
  $('#etat-outil').textContent = NOMS_OUTILS[V.outil] || '';
}

// ---------- Ruban ----------
const ruban = creerRuban($('#zone-ruban'), [
  { id: 'accueil', titre: 'Accueil', groupes: [
    { titre: 'Outils', items: [{ type: 'bascule', id: 'o-selection', ico: 'mouse-pointer-2', label: 'Sélection', grand: true }, { type: 'bascule', id: 'o-main', ico: 'hand', label: 'Main', grand: true }] },
    { titre: 'Affichage', items: [{ type: 'bouton', id: 'largeur', ico: 'move-horizontal', label: 'Largeur', grand: true }, { type: 'bouton', id: 'page-entiere', ico: 'scan', label: 'Page entière', grand: true }, { type: 'pile', items: [{ type: 'bouton', id: 'zoom-plus', ico: 'zoom-in', label: 'Zoom avant', avecLabel: true }, { type: 'bouton', id: 'zoom-moins', ico: 'zoom-out', label: 'Zoom arrière', avecLabel: true }, { type: 'bouton', id: 'zoom-100', ico: 'percent', label: 'Taille réelle', avecLabel: true }] }] },
    { titre: 'Navigation', items: [{ type: 'pile', items: [{ type: 'bouton', id: 'premiere', ico: 'chevrons-up', label: 'Première page', avecLabel: true }, { type: 'bouton', id: 'precedente', ico: 'chevron-up', label: 'Page précédente', avecLabel: true }, { type: 'bouton', id: 'suivante', ico: 'chevron-down', label: 'Page suivante', avecLabel: true }] }] },
    { titre: 'Rechercher', items: [{ type: 'bouton', id: 'rechercher', ico: 'search', label: 'Rechercher', grand: true, raccourci: 'Ctrl+F' }] },
    { titre: 'Annoter', items: [{ type: 'bascule', id: 'o-surligneur2', ico: 'highlighter', label: 'Surligner', grand: true }, { type: 'bascule', id: 'o-texte2', ico: 'type', label: 'Texte', grand: true }, { type: 'bouton', id: 'signer2', ico: 'signature', label: 'Signer', grand: true }] },
    { titre: 'Pages', items: [{ type: 'pile', items: [{ type: 'bouton', id: 'pivoter-g', ico: 'rotate-ccw', label: 'Pivoter à gauche', avecLabel: true }, { type: 'bouton', id: 'pivoter-d', ico: 'rotate-cw', label: 'Pivoter à droite', avecLabel: true }, { type: 'bouton', id: 'suppr-page', ico: 'trash-2', label: 'Supprimer la page', avecLabel: true }] }] },
  ] },
  { id: 'annoter', titre: 'Annoter', groupes: [
    { titre: 'Outils', items: [{ type: 'bascule', id: 'o-selection2', ico: 'mouse-pointer-2', label: 'Sélection', grand: true }, { type: 'bascule', id: 'o-texte', ico: 'type', label: 'Texte', grand: true }, { type: 'bascule', id: 'o-surligneur', ico: 'highlighter', label: 'Surligner', grand: true }, { type: 'bascule', id: 'o-crayon', ico: 'pencil', label: 'Crayon', grand: true }] },
    { titre: 'Formes', items: [{ type: 'pile', items: [{ type: 'ligne', items: [{ type: 'bascule', id: 'o-rect', ico: 'square', title: 'Rectangle' }, { type: 'bascule', id: 'o-ellipse', ico: 'circle', title: 'Ellipse' }] }, { type: 'ligne', items: [{ type: 'bascule', id: 'o-ligne', ico: 'minus', title: 'Ligne' }, { type: 'bascule', id: 'o-fleche', ico: 'move-up-right', title: 'Flèche' }] }] }] },
    { titre: 'Insérer', items: [{ type: 'bouton', id: 'signer', ico: 'signature', label: 'Signature', grand: true }, { type: 'menu', id: 'tampons', ico: 'stamp', label: 'Tampon', grand: true, items: [] }, { type: 'bouton', id: 'image', ico: 'image', label: 'Image', grand: true }] },
    { titre: 'Mise en forme', items: [{ type: 'pile', items: [
      { type: 'ligne', items: [{ type: 'couleur', id: 'c-trait', ico: 'pen-line', title: 'Couleur du trait et des formes', defaut: '#C00000' }, { type: 'couleur', id: 'c-remplissage', ico: 'paint-bucket', title: 'Remplissage des formes', defaut: '#FFFFFF', aucune: true, labelAucune: 'Aucun remplissage' }, { type: 'couleur', id: 'c-surligneur', ico: 'highlighter', title: 'Couleur du surligneur', defaut: '#FFE500' }, { type: 'couleur', id: 'c-texte', ico: 'baseline', title: 'Couleur du texte', defaut: '#1B2A4A' }] },
      { type: 'ligne', items: [{ type: 'select', id: 'epaisseur', title: 'Épaisseur du trait', options: [['1', '1 pt'], ['2', '2 pt'], ['3', '3 pt'], ['4', '4 pt'], ['6', '6 pt'], ['8', '8 pt']], largeur: 70 }, { type: 'select', id: 'taille', title: 'Taille du texte', options: ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '40'].map(v => [v, v + ' pt']), largeur: 72 }, { type: 'select', id: 'police', title: 'Police', options: [['helvetica', 'Arial'], ['times', 'Times'], ['courier', 'Courier']], largeur: 84 }] },
      { type: 'ligne', items: [{ type: 'bascule', id: 'gras', ico: 'bold', title: 'Gras' }, { type: 'bascule', id: 'italique', ico: 'italic', title: 'Italique' }, { type: 'bascule', id: 'souligne', ico: 'underline', title: 'Souligné' }, { type: 'sep' }, { type: 'bascule', id: 'al-left', ico: 'align-left', title: 'Aligner à gauche' }, { type: 'bascule', id: 'al-center', ico: 'align-center', title: 'Centrer' }, { type: 'bascule', id: 'al-right', ico: 'align-right', title: 'Aligner à droite' }] },
    ] }] },
    { titre: 'Modifier', items: [{ type: 'bouton', id: 'suppr-annot', ico: 'trash-2', label: 'Supprimer', grand: true }] },
  ] },
  { id: 'pages', titre: 'Pages', groupes: [
    { titre: 'Organiser', items: [{ type: 'bascule', id: 'organiser', ico: 'layout-grid', label: 'Organiser les pages', grand: true }, { type: 'bouton', id: 'p-gauche', ico: 'rotate-ccw', label: 'Pivoter à gauche', grand: true }, { type: 'bouton', id: 'p-droite', ico: 'rotate-cw', label: 'Pivoter à droite', grand: true }, { type: 'bouton', id: 'p-dupliquer', ico: 'copy', label: 'Dupliquer', grand: true }, { type: 'bouton', id: 'p-supprimer', ico: 'trash-2', label: 'Supprimer', grand: true }] },
    { titre: 'Insérer', items: [{ type: 'bouton', id: 'p-vierge', ico: 'file-plus', label: 'Page vierge', grand: true }, { type: 'bouton', id: 'p-fichier', ico: 'file-input', label: 'Depuis un fichier', grand: true }] },
    { titre: 'Diviser', items: [{ type: 'bouton', id: 'p-extraire', ico: 'file-output', label: 'Extraire', grand: true }, { type: 'bouton', id: 'p-fractionner', ico: 'split', label: 'Fractionner', grand: true }] },
  ] },
  { id: 'outils', titre: 'Outils', groupes: [
    { titre: 'Mise en page', items: [{ type: 'bouton', id: 'filigrane', ico: 'droplet', label: 'Filigrane', grand: true }, { type: 'bouton', id: 'numerotation', ico: 'list-ordered', label: 'Numéroter les pages', grand: true }] },
    { titre: 'Confidentialité', items: [{ type: 'bascule', id: 'o-caviardage', ico: 'square-dashed-mouse-pointer', label: 'Caviarder', grand: true }, { type: 'bouton', id: 'proteger', ico: 'lock', label: 'Protéger par mot de passe', grand: true }] },
    { titre: 'Document', items: [{ type: 'bouton', id: 'proprietes', ico: 'file-cog', label: 'Propriétés', grand: true }, { type: 'bouton', id: 'combiner', ico: 'files', label: 'Combiner des fichiers', grand: true }] },
  ] },
  { id: 'affichage', titre: 'Affichage', groupes: [
    { titre: 'Panneaux', items: [{ type: 'bascule', id: 'v-miniatures', ico: 'panel-left', label: 'Miniatures', grand: true }] },
    { titre: 'Zoom', items: [{ type: 'bouton', id: 'largeur2', ico: 'move-horizontal', label: 'Largeur de page', grand: true }, { type: 'bouton', id: 'page-entiere2', ico: 'scan', label: 'Page entière', grand: true }, { type: 'bouton', id: 'zoom-1002', ico: 'percent', label: 'Taille réelle', grand: true }] },
    { titre: 'Lecture', items: [{ type: 'bouton', id: 'plein-ecran', ico: 'maximize', label: 'Plein écran', grand: true }] },
  ] },
], {
  onFichier: () => doc.ouvrirCoulisses('accueil'),
  actions: {
    'o-selection': () => choisirOutil('selection'), 'o-selection2': () => choisirOutil('selection'), 'o-main': () => choisirOutil('main'),
    'o-texte': () => choisirOutil('texte'), 'o-texte2': () => choisirOutil('texte'), 'o-crayon': () => choisirOutil('crayon'), 'o-rect': () => choisirOutil('rect'), 'o-ellipse': () => choisirOutil('ellipse'), 'o-ligne': () => choisirOutil('ligne'), 'o-fleche': () => choisirOutil('fleche'), 'o-caviardage': () => choisirOutil('caviardage'),
    'o-surligneur': () => { if (!surlignerSelection()) choisirOutil('surligneur'); }, 'o-surligneur2': () => { if (!surlignerSelection()) choisirOutil('surligneur'); },
    largeur: () => definirZoom(0, 'largeur'), largeur2: () => definirZoom(0, 'largeur'), 'page-entiere': () => definirZoom(0, 'page'), 'page-entiere2': () => definirZoom(0, 'page'), 'zoom-plus': () => definirZoom(V.zoom * 1.2), 'zoom-moins': () => definirZoom(V.zoom / 1.2), 'zoom-100': () => definirZoom(1), 'zoom-1002': () => definirZoom(1),
    premiere: () => allerPage(0), precedente: () => allerPage(V.courante - 1), suivante: () => allerPage(V.courante + 1), rechercher: ouvrirRecherche,
    signer: dialogueSignature, signer2: dialogueSignature, tampons: b => menuTampons(b), image: choisirEtInsererImage,
    'c-trait': c => { V.style.couleur = c; appliquerStyle({ couleur: c }, ['rect', 'ellipse', 'ligne', 'fleche', 'trait']); }, 'c-remplissage': c => { V.style.remplissage = c; appliquerStyle({ remplissage: c }, ['rect', 'ellipse', 'texte']); }, 'c-surligneur': c => { V.style.surligneur = c; appliquerStyle({ couleur: c }, ['surlignage']); }, 'c-texte': c => { V.style.texte = c; appliquerStyle({ couleur: c }, ['texte']); },
    epaisseur: v => { setTimeout(() => vis.focus(), 0); V.style.epaisseur = +v; appliquerStyle({ epaisseur: +v }, ['rect', 'ellipse', 'ligne', 'fleche', 'trait']); }, taille: v => { setTimeout(() => vis.focus(), 0); V.style.taille = +v; appliquerStyle({ taille: +v }, ['texte']); }, police: v => { setTimeout(() => vis.focus(), 0); V.style.police = v; appliquerStyle({ police: v }, ['texte']); },
    gras: () => basculerStyle('gras'), italique: () => basculerStyle('italique'), souligne: () => basculerStyle('souligne'), 'al-left': () => appliquerStyle({ align: 'left' }, ['texte']), 'al-center': () => appliquerStyle({ align: 'center' }, ['texte']), 'al-right': () => appliquerStyle({ align: 'right' }, ['texte']),
    'suppr-annot': supprimerAnnots,
    'pivoter-g': () => pivoter(-1), 'pivoter-d': () => pivoter(1), 'suppr-page': supprimerPages, 'p-gauche': () => pivoter(-1), 'p-droite': () => pivoter(1), 'p-dupliquer': dupliquerPages, 'p-supprimer': supprimerPages,
    organiser: () => $('#organiseur').classList.contains('masque') ? ouvrirOrganiseur() : fermerOrganiseur(), 'p-vierge': insererVierge, 'p-fichier': insererDepuisFichier, 'p-extraire': extrairePages, 'p-fractionner': fractionner,
    filigrane: dialogueFiligrane, numerotation: dialogueNumerotation, proteger: dialogueProtection, proprietes: dialogueProprietes, combiner: insererDepuisFichier,
    'v-miniatures': () => { V.miniatures = !V.miniatures; $('#miniatures').classList.toggle('masque', !V.miniatures); majRuban(); majMiniatures(); },
    'plein-ecran': () => { document.documentElement.requestFullscreen?.().catch(() => { }); },
  }
});
function appliquerStyle(o, types) { const l = annotsSel().filter(a => types.includes(a.type)); if (!l.length) return; avant(); l.forEach(a => Object.assign(a, o)); apres(); }
function basculerStyle(k) { const l = annotsSel().filter(a => a.type === 'texte'); if (!l.length) return; avant(); const v = !l[0][k]; l.forEach(a => a[k] = v); apres(); }
function majRuban() {
  ['selection', 'main', 'texte', 'surligneur', 'crayon', 'rect', 'ellipse', 'ligne', 'fleche', 'caviardage'].forEach(o => { ruban.actif('o-' + o, V.outil === o); ruban.actif('o-' + o + '2', V.outil === o); });
  ruban.actif('v-miniatures', V.miniatures);
  const t = annotsSel().find(a => a.type === 'texte');
  ruban.actif('gras', !!t?.gras); ruban.actif('italique', !!t?.italique); ruban.actif('souligne', !!t?.souligne);
  ['left', 'center', 'right'].forEach(a => ruban.actif('al-' + a, !!t && (t.align || 'left') === a));
  ruban.valeur('taille', String(Math.round(t?.taille || V.style.taille))); ruban.valeur('police', t?.police || V.style.police);
  const tr = annotsSel().find(a => a.epaisseur); ruban.valeur('epaisseur', String(tr?.epaisseur || V.style.epaisseur));
}

// ---------- Glisser-déposer de fichiers ----------
let compteurDepot = 0;
addEventListener('dragenter', ev => { if (![...ev.dataTransfer.types].includes('Files')) return; compteurDepot++; $('#zone-depot').classList.remove('masque'); });
addEventListener('dragleave', ev => { if (![...ev.dataTransfer.types].includes('Files')) return; if (--compteurDepot <= 0) { compteurDepot = 0; $('#zone-depot').classList.add('masque'); } });
addEventListener('dragover', ev => { if ([...ev.dataTransfer.types].includes('Files')) ev.preventDefault(); });
addEventListener('drop', async ev => {
  if (![...ev.dataTransfer.types].includes('Files')) return; ev.preventDefault(); compteurDepot = 0; $('#zone-depot').classList.add('masque');
  const fichiers = []; for (const f of ev.dataTransfer.files) if (/\.pdf$/i.test(f.name) || estImage(f.name)) fichiers.push({ nom: f.name, chemin: null, octets: new Uint8Array(await f.arrayBuffer()) });
  if (!fichiers.length) return toast('Seuls les fichiers PDF et les images peuvent être ajoutés.', 'erreur');
  try { if (!P.pages.length && fichiers.length === 1 && /\.pdf$/i.test(fichiers[0].nom)) await doc.chargerFichier(fichiers[0]); else await insererFichiers(fichiers, P.pages.length ? V.courante + 1 : 0); } catch (e) { toast('Ouverture impossible : ' + e.message, 'erreur'); }
});
$$('#vide [data-a]').forEach(b => b.onclick = () => ({ ouvrir: () => doc.ouvrir(), combiner: () => doc.nouveau(MODELES[1]), images: () => doc.nouveau(MODELES[2]) })[b.dataset.a]());

// ---------- Document ----------
const apercu = (traits) => `<svg viewBox="0 0 120 150" width="84" height="105" aria-hidden="true"><rect x="10" y="5" width="100" height="140" rx="3" fill="#fff" stroke="#c9ced8"/>${traits}</svg>`;
const MODELES = [
  { id: 'vierge', nom: 'Document vierge', apercu: apercu(''), creer: async () => [{ id: uid('p'), src: null, n: 0, l: A4.l, h: A4.h, rot: 0, annots: [] }] },
  { id: 'combiner', nom: 'Combiner des PDF', nomDoc: 'Documents combinés', apercu: apercu('<rect x="24" y="22" width="44" height="56" fill="#FAE6E4" stroke="#B0261E"/><rect x="52" y="44" width="44" height="56" fill="#fff" stroke="#B0261E"/><path d="M40 118h40" stroke="#B0261E" stroke-width="4"/>'), creer: async () => { const f = await Fi.ouvrirFichiers({ titre: 'Choisir les PDF à combiner', filtres: [{ nom: 'Documents PDF', ext: ['pdf'] }], multiple: true }); return f ? pagesDepuisFichiers(f) : null; } },
  { id: 'images', nom: 'Images en PDF', nomDoc: 'Images', apercu: apercu('<rect x="26" y="30" width="68" height="52" fill="#E3ECFA" stroke="#2456B0"/><circle cx="44" cy="46" r="6" fill="#2456B0"/><path d="M28 80l22-18 14 10 12-8 18 16z" fill="#2456B0"/>'), creer: async () => { const f = await Fi.ouvrirFichiers({ titre: 'Choisir les images', filtres: [{ nom: 'Images', ext: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }], multiple: true }); return f ? pagesDepuisImages(f) : null; } },
];
const doc = creerDocument({
  intervalleRecuperation: 180000,
  focus: () => $('#visionneuse').focus({ preventScroll: true }),
  app: 'pdf', nomApp: 'PDF', lettre: 'PDF', barreTitre: $('#barre-titre'),
  formatsOuverture: [{ nom: 'Documents PDF', ext: ['pdf'] }, { nom: 'Images', ext: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }],
  formatsEnregistrement: [{ nom: 'Document PDF', ext: 'pdf', ecrire: documentFinal }],
  exports: [
    { id: 'pdf', label: 'PDF', ico: 'file-text', ext: 'pdf', desc: 'Copie du document avec les annotations intégrées.', ecrire: documentFinal },
    { id: 'png', label: 'Images PNG (une par page)', ico: 'image', desc: 'Chaque page en image, à 150 points par pouce.', faire: exporterImages },
    { id: 'txt', label: 'Texte brut (.txt)', ico: 'file-type', ext: 'txt', desc: 'Le texte du document, sans mise en forme.', ecrire: exporterTexte },
  ],
  modeles: MODELES,
  async nouveau(m) {
    reinitialiser();
    let pages = [];
    try { pages = (m ? await m.creer() : []) || []; } catch (e) { toast('Ouverture impossible : ' + e.message, 'erreur'); }
    P.pages = pages; V.mode = 'largeur'; rendre(true); vis.scrollTop = 0;
  },
  async charger({ octets, nom }) {
    reinitialiser();
    try { P.pages = estImage(nom) ? await pagesDepuisImages([{ octets, nom }]) : await pagesDepuisFichiers([{ octets, nom }]); }
    catch (e) { rendre(true); throw e; }
    const s = [...SOURCES.values()][0]; if (s) P.meta = { ...s.meta };
    V.mode = 'largeur'; rendre(true); vis.scrollTop = 0;
  },
  informations: async () => { const s = [...SOURCES.values()]; return [['Pages', String(P.pages.length)], ['Format', P.pages[0] ? `${Math.round(P.pages[0].l / 72 * 25.4)} × ${Math.round(P.pages[0].h / 72 * 25.4)} mm` : '—'], ['Titre', P.meta?.titre || '—'], ['Auteur', P.meta?.auteur || '—'], ['Protection', P.protection ? 'Mot de passe à l\'ouverture' : (s.some(x => x.chiffre) ? 'Document d\'origine protégé' : 'Aucune')]]; },
  annuler, retablir, imprimer,
  commandes: () => ruban.commandes(),
});
const horsSaisie = f => e => { const a = document.activeElement; if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.isContentEditable)) return false; return f(e); };
raccourcis({
  'Ctrl+Z': horsSaisie(annuler), 'Ctrl+Y': horsSaisie(retablir), 'Ctrl+F': () => ouvrirRecherche(), 'F3': () => resultatSuivant(1), 'Maj+F3': () => resultatSuivant(-1),
  'Ctrl++': () => definirZoom(V.zoom * 1.2), 'Ctrl+=': () => definirZoom(V.zoom * 1.2), 'Ctrl+-': () => definirZoom(V.zoom / 1.2), 'Ctrl+0': () => definirZoom(0, 'page'), 'Ctrl+1': () => definirZoom(1), 'Ctrl+2': () => definirZoom(0, 'largeur'),
  'Ctrl+Maj+R': horsSaisie(() => pivoter(1)), 'Ctrl+Maj+L': horsSaisie(() => pivoter(-1)),
  'Escape': () => { if (V.edition || $('.dialogue') || $('.menu-flottant')) return false; if (!$('#organiseur').classList.contains('masque')) { fermerOrganiseur(); return; } if (V.outil !== 'selection') choisirOutil('selection'); else if (V.sel.length) { V.sel = []; rendre(); } else return false; },
  'V': horsSaisie(() => choisirOutil('selection')), 'H': horsSaisie(() => choisirOutil('main')), 'T': horsSaisie(() => choisirOutil('texte')),
});
window.__pdf = { P: () => P, M: () => M, V, rendre, allerPage, doc, construire: () => documentFinal(), SOURCES, choisirOutil, insererFichiers, R, surlignerSelection, entrerEdition: (pid, aid) => entrerEdition(pageDe(pid).annots.find(a => a.id === aid), pageDe(pid)), quitterEdition, definirZoom };
(async () => { await doc.demarrer(); rendre(true); ruban.actif('v-miniatures', true); vis.focus(); })();
