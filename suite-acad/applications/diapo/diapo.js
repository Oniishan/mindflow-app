// Diapo — présentations
import { $, $$, el, esc, ico, toast, dialogue, demander, menu, fermerMenu, creerRuban, raccourcis, debounce, choisirCouleur, nomSansExtension } from './commun/ui.js';
import { creerDocument } from './commun/document.js';
import * as Fi from './commun/fichiers.js';
import { THEMES, theme as themeDe, DISPOSITIONS, INVITES, FORMES, cheminForme } from './themes.js';
import { exporterPptx, importerPptx } from './pptx.js';
import { MODELES } from './modeles.js';

let P = MODELES[0].creer(); let M = {}; // présentation et médias (images)
const V = { courante: 0, sel: [], edition: null, echelle: 1, magnetisme: true, presse: null, notes: true };
const LW = () => P.format === '4:3' ? 960 : 1280, LH = 720;
const D = () => P.diapos[V.courante];
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const scene = $('#scene'), cadre = $('#cadre'), diapoEl = $('#diapo'), calqueSel = $('#calque-sel');
const TAILLES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 96];
const POLICES = ['Segoe UI', 'Segoe UI Semibold', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Marianne', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Consolas'];

// ---------- Styles résolus ----------
function styleZone(e) {
  const th = themeDe(P.theme);
  const s = e.style || {};
  const parRole = e.role === 'titre' ? { police: th.policeTitre, couleur: th.titre, taille: 40 } : e.role === 'sous-titre' ? { police: th.policeTexte, couleur: th.texte, taille: 24 } : { police: th.policeTexte, couleur: th.texte, taille: 24 };
  if (e.type === 'forme') parRole.couleur = '#FFFFFF';
  return { ...parRole, align: 'left', valign: 'top', ...Object.fromEntries(Object.entries(s).filter(([, v]) => v != null)) };
}
const src = s => s && s.startsWith('media:') ? M[s.slice(6)] : s;

// ---------- Rendu d'une diapositive ----------
function htmlDiapo(d, { edition = false, pres = false } = {}) {
  const th = themeDe(P.theme);
  const fond = d.fond || th.fond;
  const fondCss = fond.startsWith('media:') ? `background:#fff url(${src(fond)}) center/cover no-repeat` : `background:${fond}`;
  let h = `<div class="fond-diapo" style="position:absolute;inset:0;${fondCss}"></div>`;
  if (th.decor === 'bande') h += `<div style="position:absolute;left:0;right:0;bottom:0;height:10px;background:${th.accents[0]}"></div>`;
  if (th.decor === 'bande-gauche') h += `<div style="position:absolute;left:0;top:0;bottom:0;width:14px;background:${th.accents[0]}"></div>`;
  if (th.decor === 'filet') h += `<div style="position:absolute;left:70px;bottom:36px;width:60px;height:4px;background:${th.accents[1]}"></div>`;
  if (th.decor === 'coin') h += `<svg style="position:absolute;right:0;bottom:0" width="90" height="90"><path d="M90,0V90H0Z" fill="${th.accents[0]}"/></svg>`;
  for (const e of d.elements) h += htmlElement(e, { edition, pres, th });
  return h;
}
function htmlElement(e, { edition, pres, th }) {
  const s = styleZone(e);
  const rot = e.rotation ? `transform:rotate(${e.rotation}deg);` : '';
  const vide = !e.html || !e.html.replace(/<[^>]+>/g, '').replace(/ /g, '').trim();
  const texteCss = `font-family:'${s.police}',Arial,sans-serif;font-size:${s.taille}px;color:${s.couleur};text-align:${s.align};${s.gras ? 'font-weight:700;' : ''}${s.italique ? 'font-style:italic;' : ''}${s.interligne ? `line-height:${s.interligne};` : ''}`;
  const anim = pres && e.animation && e.animation !== 'aucune' ? ` data-anim="${e.animation}"` : '';
  let inner = '';
  const contenuTexte = (avecInvite) => `<div class="contenu-texte v-${s.valign}" style="${texteCss}" data-texte="1">${vide && avecInvite && edition && e.role ? `<p class="invite">${INVITES[e.role] || ''}</p>` : (e.html || '')}</div>`;
  if (e.type === 'texte') inner = contenuTexte(true);
  else if (e.type === 'forme') {
    const sw = e.contour && e.contour !== 'transparent' ? (e.epaisseur ?? 2) : 0;
    const ligne = e.forme === 'ligne' || e.forme === 'fleche';
    inner = `<svg class="forme" viewBox="0 0 ${e.l} ${e.h}" preserveAspectRatio="none" width="${e.l}" height="${e.h}">${e.forme === 'fleche' ? `<defs><marker id="m${e.id}" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0L10,5L0,10Z" fill="${e.contour || '#000'}"/></marker></defs>` : ''}<path d="${cheminForme(e.forme, e.l, e.h)}" fill="${ligne ? 'none' : (e.remplissage || 'transparent')}" stroke="${ligne ? (e.contour || '#000') : (sw ? e.contour : 'none')}" stroke-width="${ligne ? (e.epaisseur || 3) : sw}" ${e.forme === 'fleche' ? `marker-end="url(#m${e.id})"` : ''} vector-effect="non-scaling-stroke"/></svg>` + (ligne ? '' : contenuTexte(false));
  }
  else if (e.type === 'image') inner = e.src ? `<img src="${src(e.src)}" alt="${esc(e.alt || '')}" draggable="false">` : (edition ? `<div class="zone-image-vide" data-ajout-image="${e.id}">${ico('image-plus', 'g')}<span style="font-size:16px;margin-top:6px">Ajouter une image</span></div>` : '');
  else if (e.type === 'tableau') {
    const t = e.taille || 18;
    inner = `<table style="font-family:'${s.police}',Arial,sans-serif;font-size:${t}px;color:${th.texte}">${e.cellules.map((l, i) => `<tr>${l.map((c, j) => `<td data-l="${i}" data-c="${j}" style="${i === 0 && e.entete !== false ? `background:${th.accents[0]};color:#fff;font-weight:700;` : (i % 2 === 0 ? 'background:rgba(127,127,127,.08);' : '')}">${c || ''}</td>`).join('')}</tr>`).join('')}</table>`;
  }
  const fondTexte = e.type === 'texte' && e.remplissage && e.remplissage !== 'transparent' ? `background:${e.remplissage};` : '';
  const bordTexte = e.type === 'texte' && e.contour && e.contour !== 'transparent' ? `border:${e.epaisseur || 2}px solid ${e.contour};` : '';
  return `<div class="el" data-id="${e.id}" style="left:${e.x}px;top:${e.y}px;width:${e.l}px;height:${e.h}px;${rot}${fondTexte}${bordTexte}"${anim}>${inner}</div>`;
}

// ---------- Rendu de l'éditeur ----------
function ajusterEchelle() {
  const w = scene.clientWidth - 60, h = scene.clientHeight - 60;
  V.echelle = Math.max(0.1, Math.min(w / LW(), h / LH) * (V.zoomManuel || 1));
  cadre.style.width = LW() * V.echelle + 'px'; cadre.style.height = LH * V.echelle + 'px';
  diapoEl.style.width = LW() + 'px'; diapoEl.style.height = LH + 'px'; diapoEl.style.transform = `scale(${V.echelle})`;
  calqueSel.style.width = LW() * V.echelle + 'px'; calqueSel.style.height = LH * V.echelle + 'px';
  majSelection();
}
new ResizeObserver(() => ajusterEchelle()).observe(scene);
function rendre() {
  if (!D()) V.courante = 0;
  const th = themeDe(P.theme);
  diapoEl.style.setProperty('--accent-diapo', th.accents[0]);
  if (V.edition) return; // ne pas écraser le texte en cours de saisie
  diapoEl.innerHTML = htmlDiapo(D(), { edition: true });
  $('#notes').value = D().notes || '';
  majSelection(); majVignettes(); majEtat(); majRuban();
}
function majSelection() {
  const z = V.echelle;
  let h = '';
  for (const id of V.sel) {
    const e = D()?.elements.find(x => x.id === id); if (!e) continue;
    const rot = e.rotation ? `transform:rotate(${e.rotation}deg);transform-origin:center;` : '';
    h += `<div class="cadre-sel ${V.edition === id ? 'edition' : ''}" data-id="${id}" style="left:${e.x * z}px;top:${e.y * z}px;width:${e.l * z}px;height:${e.h * z}px;${rot}">${V.sel.length === 1 && V.edition !== id ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(p => `<span class="p" data-p="${p}"></span>`).join('') + '<span class="rot" data-p="rot" title="Faire pivoter"></span>' : ''}</div>`;
  }
  calqueSel.innerHTML = h;
  ruban.contextuel('forme', V.sel.length > 0 && !selTableau());
  ruban.contextuel('tableau-ctx', !!selTableau());
}
const selElements = () => V.sel.map(id => D().elements.find(e => e.id === id)).filter(Boolean);
const selTableau = () => { const s = selElements(); return s.length === 1 && s[0].type === 'tableau' ? s[0] : null; };

// ---------- Vignettes ----------
const majVignettes = debounce(() => {
  const p = $('#panneau-diapos'); const w = 172, ech = w / LW();
  p.innerHTML = P.diapos.map((d, i) => `<div class="vignette ${i === V.courante ? 'active' : ''} ${d.masquee ? 'masquee' : ''}" data-i="${i}" draggable="true" tabindex="0" aria-label="Diapositive ${i + 1}"><span class="num">${i + 1}</span><div class="cadre-v" style="height:${LH * ech + 4}px"><div class="mini" style="width:${LW()}px;height:${LH}px;transform:scale(${ech})">${htmlDiapo(d)}</div></div></div>`).join('');
  $$('.vignette', p).forEach(v => {
    const i = +v.dataset.i;
    v.onclick = () => allerA(i);
    v.oncontextmenu = e => { e.preventDefault(); allerA(i); menuDiapo(e.clientX, e.clientY); };
    v.ondragstart = e => { e.dataTransfer.setData('text/plain', String(i)); };
    v.ondragover = e => { e.preventDefault(); $$('.vignette', p).forEach(x => x.classList.remove('glisse-avant')); v.classList.add('glisse-avant'); };
    v.ondragleave = () => v.classList.remove('glisse-avant');
    v.ondrop = e => { e.preventDefault(); v.classList.remove('glisse-avant'); deplacerDiapo(+e.dataTransfer.getData('text/plain'), i); };
    v.onkeydown = e => { if (e.key === 'Delete') supprimerDiapo(); if (e.key === 'ArrowDown' && i < P.diapos.length - 1) { allerA(i + 1); setTimeout(() => $(`.vignette[data-i="${i + 1}"]`)?.focus(), 80); } if (e.key === 'ArrowUp' && i > 0) { allerA(i - 1); setTimeout(() => $(`.vignette[data-i="${i - 1}"]`)?.focus(), 80); } if (e.key === 'Enter') nouvelleDiapo(); };
  });
  const a = $(`.vignette[data-i="${V.courante}"]`, p); a?.scrollIntoView({ block: 'nearest' });
  if (!$('#trieuse').classList.contains('masque')) rendreTrieuse();
}, 80);

// ---------- Historique ----------
const pile = [], futur = [];
function etat() { return JSON.stringify({ P, c: V.courante }); }
function avant() { const e = etat(); if (pile[pile.length - 1] !== e) pile.push(e); if (pile.length > 100) pile.shift(); futur.length = 0; }
function appliquerEtat(s) { const o = JSON.parse(s); P = o.P; V.courante = Math.min(o.c, P.diapos.length - 1); V.sel = V.sel.filter(id => D().elements.some(e => e.id === id)); V.edition = null; ajusterEchelle(); rendre(); }
function annuler() { if (V.edition) { quitterEdition(); } if (!pile.length) return; futur.push(etat()); appliquerEtat(pile.pop()); doc.marquerModifie(); }
function retablir() { if (!futur.length) return; pile.push(etat()); appliquerEtat(futur.pop()); doc.marquerModifie(); }
function modifie() { doc.marquerModifie(); }
function apres() { modifie(); rendre(); }

// ---------- Diapositives ----------
function allerA(i) { if (V.edition) quitterEdition(); V.courante = Math.max(0, Math.min(P.diapos.length - 1, i)); V.sel = []; rendre(); }
function creerDiapo(disposition) {
  const d = DISPOSITIONS.find(x => x.id === disposition) || DISPOSITIONS[1];
  const kx = LW() / 1280;
  return { id: uid('d'), disposition: d.id, elements: d.zones.map(zn => zn.role === 'image' ? { id: uid('e'), type: 'image', role: 'image', x: zn.x * kx, y: zn.y, l: zn.l * kx, h: zn.h, src: '' } : { id: uid('e'), type: 'texte', role: zn.role, x: zn.x * kx, y: zn.y, l: zn.l * kx, h: zn.h, html: '', style: { taille: zn.taille, align: zn.align === 'left' ? null : zn.align, valign: zn.valign === 'top' ? null : zn.valign, gras: zn.gras || null } }), notes: '', transition: D()?.transition || 'aucune' };
}
function nouvelleDiapo(disposition) {
  avant();
  const disp = disposition || (D()?.disposition === 'titre' ? 'titre-contenu' : (D()?.disposition && D().disposition !== 'vide' ? D().disposition : 'titre-contenu'));
  P.diapos.splice(V.courante + 1, 0, creerDiapo(disp)); V.courante++; V.sel = []; apres();
}
function changerDisposition(disposition) {
  avant();
  const ancien = D(); const n = creerDiapo(disposition);
  // conserver les contenus des zones de même rôle
  const parRole = {}; ancien.elements.filter(e => e.role).forEach(e => (parRole[e.role] = parRole[e.role] || []).push(e));
  n.elements = n.elements.map(e => { const a = (parRole[e.role] || []).shift(); return a ? { ...a, x: e.x, y: e.y, l: e.l, h: e.h, style: { ...(a.style || {}), taille: e.style?.taille, align: e.style?.align, valign: e.style?.valign } } : e; });
  n.elements.push(...ancien.elements.filter(e => !e.role), ...Object.values(parRole).flat().filter(e => e.html || e.src));
  Object.assign(ancien, { disposition, elements: n.elements }); V.sel = []; apres();
}
function dupliquerDiapo() { avant(); const c = JSON.parse(JSON.stringify(D())); c.id = uid('d'); c.elements.forEach(e => e.id = uid('e')); P.diapos.splice(V.courante + 1, 0, c); V.courante++; V.sel = []; apres(); }
function supprimerDiapo() { if (P.diapos.length < 2) { avant(); P.diapos[0] = creerDiapo('vide'); V.sel = []; apres(); return; } avant(); P.diapos.splice(V.courante, 1); V.courante = Math.min(V.courante, P.diapos.length - 1); V.sel = []; apres(); }
function deplacerDiapo(de, vers) { if (de === vers || isNaN(de)) return; avant(); const [d] = P.diapos.splice(de, 1); P.diapos.splice(vers, 0, d); V.courante = vers; apres(); }
function masquerDiapo() { avant(); D().masquee = !D().masquee; apres(); }
function menuDiapo(x, y) {
  menu([{ label: 'Nouvelle diapositive', ico: 'plus', raccourci: 'Ctrl+M', faire: () => nouvelleDiapo() }, { label: 'Dupliquer la diapositive', ico: 'copy', faire: dupliquerDiapo }, { label: 'Supprimer la diapositive', ico: 'trash-2', faire: supprimerDiapo }, '-', { label: 'Disposition', ico: 'layout-template', faire: () => menuDispositions(null, x, y, changerDisposition) }, { label: D().masquee ? 'Afficher la diapositive' : 'Masquer la diapositive', ico: 'eye-off', faire: masquerDiapo }, '-', { label: 'Monter', faire: () => deplacerDiapo(V.courante, V.courante - 1), desactive: V.courante === 0 }, { label: 'Descendre', faire: () => deplacerDiapo(V.courante, V.courante + 1), desactive: V.courante === P.diapos.length - 1 }], x, y);
}
function apercuDisposition(d) {
  return `<svg viewBox="0 0 1280 720">${d.zones.map(z => `<rect x="${z.x}" y="${z.y}" width="${z.l}" height="${z.h}" fill="${z.role === 'titre' ? '#c8d0dd' : z.role === 'image' ? '#e3eaf5' : '#eef1f5'}" stroke="#9aa3b4" stroke-width="6" stroke-dasharray="${z.role === 'image' ? '20 12' : '0'}"/>`).join('')}</svg>`;
}
function menuDispositions(ancre, x, y, faire) {
  const g = el(`<div class="choix-dispo">${DISPOSITIONS.map(d => `<button data-d="${d.id}">${apercuDisposition(d)}<span>${d.nom}</span></button>`).join('')}</div>`);
  $$('button', g).forEach(b => b.onclick = () => { fermerMenu(); faire(b.dataset.d); });
  menu([{ element: g }], x || 0, y || 0, ancre);
}

// ---------- Éléments ----------
function ajouterElement(e) { avant(); D().elements.push(e); V.sel = [e.id]; apres(); return e; }
function zoneTexte() { const e = ajouterElement({ id: uid('e'), type: 'texte', x: LW() / 2 - 200, y: LH / 2 - 40, l: 400, h: 80, html: '', style: { taille: 24 } }); entrerEdition(e.id); }
function insererForme(forme) { const ligne = forme === 'ligne' || forme === 'fleche'; const th = themeDe(P.theme); ajouterElement({ id: uid('e'), type: 'forme', forme, x: LW() / 2 - 120, y: LH / 2 - (ligne ? 2 : 80), l: 240, h: ligne ? 4 : 160, remplissage: ligne ? 'transparent' : th.accents[0], contour: ligne ? th.texte : 'transparent', epaisseur: ligne ? 3 : 2, html: '', style: { align: 'center', valign: 'middle' } }); }
async function choisirImage() {
  const f = await Fi.ouvrirFichier({ titre: 'Insérer une image', filtres: [{ nom: 'Images', ext: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] }] });
  if (!f) return null;
  const ext = f.nom.split('.').pop().toLowerCase();
  const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'image/png';
  const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(new Blob([f.octets], { type })); });
  const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
  const id = uid('m'); M[id] = url;
  return { src: 'media:' + id, l: img.naturalWidth, h: img.naturalHeight, nom: f.nom };
}
async function insererImage(cible) {
  const i = await choisirImage(); if (!i) return;
  if (cible) { avant(); Object.assign(cible, { src: i.src, alt: nomSansExtension(i.nom) }); const r = Math.min(cible.l / i.l, cible.h / i.h); const l = i.l * r, h = i.h * r; cible.x += (cible.l - l) / 2; cible.y += (cible.h - h) / 2; cible.l = l; cible.h = h; apres(); return; }
  const r = Math.min(1, (LW() * 0.6) / i.l, (LH * 0.6) / i.h);
  ajouterElement({ id: uid('e'), type: 'image', x: (LW() - i.l * r) / 2, y: (LH - i.h * r) / 2, l: i.l * r, h: i.h * r, src: i.src, alt: nomSansExtension(i.nom) });
}
function insererTableau(l, c) { ajouterElement({ id: uid('e'), type: 'tableau', x: 70, y: 180, l: LW() - 140, h: Math.min(460, 50 * l), cellules: Array.from({ length: l }, (_, i) => Array.from({ length: c }, () => '')), taille: 20, entete: true, style: {} }); }
function menuTableau(ancre) {
  const g = el('<div><div class="grille-tableau" style="display:grid;grid-template-columns:repeat(8,18px);gap:2px;padding:8px"></div><div class="info-grille" style="padding:0 8px 6px;font-size:12px">Insérer un tableau</div></div>');
  const gr = $('.grille-tableau', g);
  for (let i = 0; i < 48; i++) gr.appendChild(el(`<span data-l="${Math.floor(i / 8) + 1}" data-c="${i % 8 + 1}" style="width:18px;height:18px;border:1px solid #c3cad6;background:#fff;cursor:pointer;display:block"></span>`));
  gr.onmouseover = e => { const s = e.target.closest('span'); if (!s) return; $$('span', gr).forEach(k => k.style.background = +k.dataset.l <= +s.dataset.l && +k.dataset.c <= +s.dataset.c ? 'var(--accent-doux)' : '#fff'); $('.info-grille', g).textContent = `Tableau de ${s.dataset.c} × ${s.dataset.l}`; };
  gr.onclick = e => { const s = e.target.closest('span'); if (!s) return; fermerMenu(); insererTableau(+s.dataset.l, +s.dataset.c); };
  menu([{ element: g }], 0, 0, ancre);
}
function menuFormes(ancre) {
  const g = el(`<div class="grille-formes">${FORMES.map(([f, n]) => `<button data-f="${f}" title="${n}" aria-label="${n}"><svg width="24" height="20" viewBox="0 0 24 20"><path d="${cheminForme(f, 22, 18)}" transform="translate(1,1)" fill="${f === 'ligne' || f === 'fleche' ? 'none' : '#cfd9ee'}" stroke="#2456B0" stroke-width="1.4"/></svg></button>`).join('')}</div>`);
  $$('button', g).forEach(b => b.onclick = () => { fermerMenu(); insererForme(b.dataset.f); });
  menu([{ element: g }], 0, 0, ancre);
}
function supprimerSelection() { if (!V.sel.length) return; avant(); D().elements = D().elements.filter(e => !V.sel.includes(e.id)); V.sel = []; apres(); }
let pressePapiers = null;
function copierSel(couper) { if (!V.sel.length) return; pressePapiers = JSON.parse(JSON.stringify(selElements())); if (couper) supprimerSelection(); }
function collerSel() { if (!pressePapiers) return; avant(); const n = pressePapiers.map(e => ({ ...JSON.parse(JSON.stringify(e)), id: uid('e'), x: e.x + 20, y: e.y + 20 })); D().elements.push(...n); V.sel = n.map(e => e.id); pressePapiers = n.map(e => JSON.parse(JSON.stringify(e))); apres(); }
function dupliquerSel() { copierSel(false); collerSel(); }
function ordre(sens) {
  avant(); const els = D().elements; const sel = els.filter(e => V.sel.includes(e.id)), autres = els.filter(e => !V.sel.includes(e.id));
  if (sens === 'premier') D().elements = [...autres, ...sel];
  else if (sens === 'arriere') D().elements = [...sel, ...autres];
  else for (const e of (sens === 'avancer' ? [...sel].reverse() : sel)) { const i = D().elements.indexOf(e), j = i + (sens === 'avancer' ? 1 : -1); if (j >= 0 && j < D().elements.length) [D().elements[i], D().elements[j]] = [D().elements[j], D().elements[i]]; }
  apres();
}
function aligner(mode) {
  const s = selElements(); if (!s.length) return; avant();
  const ref = s.length === 1 ? { x: 0, y: 0, l: LW(), h: LH } : { x: Math.min(...s.map(e => e.x)), y: Math.min(...s.map(e => e.y)), l: Math.max(...s.map(e => e.x + e.l)) - Math.min(...s.map(e => e.x)), h: Math.max(...s.map(e => e.y + e.h)) - Math.min(...s.map(e => e.y)) };
  for (const e of s) {
    if (mode === 'gauche') e.x = ref.x; if (mode === 'centre') e.x = ref.x + (ref.l - e.l) / 2; if (mode === 'droite') e.x = ref.x + ref.l - e.l;
    if (mode === 'haut') e.y = ref.y; if (mode === 'milieu') e.y = ref.y + (ref.h - e.h) / 2; if (mode === 'bas') e.y = ref.y + ref.h - e.h;
  }
  if ((mode === 'repartir-h' || mode === 'repartir-v') && s.length > 2) {
    const h = mode === 'repartir-h'; const t = [...s].sort((a, b) => h ? a.x - b.x : a.y - b.y);
    const total = t.reduce((a, e) => a + (h ? e.l : e.h), 0); const debut = h ? t[0].x : t[0].y, fin = h ? t[t.length - 1].x + t[t.length - 1].l : t[t.length - 1].y + t[t.length - 1].h;
    const ecart = (fin - debut - total) / (t.length - 1); let p = debut; t.forEach(e => { if (h) e.x = p; else e.y = p; p += (h ? e.l : e.h) + ecart; });
  }
  apres();
}

// ---------- Édition de texte ----------
function entrerEdition(id, { selectAll = false, texte = null } = {}) {
  const e = D().elements.find(x => x.id === id); if (!e || e.type === 'image' || (e.type === 'forme' && (e.forme === 'ligne' || e.forme === 'fleche'))) return;
  V.sel = [id]; V.edition = null; rendre(); V.edition = id;
  const n = diapoEl.querySelector(`.el[data-id="${id}"]`);
  const cible = e.type === 'tableau' ? n.querySelector('td') : n.querySelector('[data-texte]');
  if (e.type === 'tableau') n.querySelectorAll('td').forEach(td => td.contentEditable = 'true');
  else { cible.contentEditable = 'true'; if (!e.html) cible.innerHTML = '<p><br></p>'; }
  n.classList.add('edition');
  cible.focus();
  const r = document.createRange(); r.selectNodeContents(cible); if (!selectAll) r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  if (texte != null) document.execCommand('insertText', false, texte);
  majSelection(); majRuban();
  V.avantEdition = etat();
}
function quitterEdition() {
  const id = V.edition; if (!id) return;
  const e = D().elements.find(x => x.id === id); const n = diapoEl.querySelector(`.el[data-id="${id}"]`);
  V.edition = null;
  if (e && n) {
    let modif = false;
    if (e.type === 'tableau') { const c = e.cellules.map((l, i) => l.map((_, j) => nettoyerHtml(n.querySelector(`td[data-l="${i}"][data-c="${j}"]`)?.innerHTML || ''))); if (JSON.stringify(c) !== JSON.stringify(e.cellules)) { modif = true; e.cellules = c; } }
    else { const h = nettoyerHtml(n.querySelector('[data-texte]').innerHTML); const vide = !h.replace(/<[^>]+>/g, '').replace(/ |&nbsp;/g, '').trim(); const nv = vide ? '' : h; if (nv !== (e.html || '')) { modif = true; e.html = nv; } }
    if (modif) { if (V.avantEdition) { pile.push(V.avantEdition); futur.length = 0; } modifie(); }
  }
  V.avantEdition = null; rendre();
}
function nettoyerHtml(h) {
  const d = document.createElement('div'); d.innerHTML = h;
  d.querySelectorAll('script,style,iframe,object').forEach(x => x.remove());
  d.querySelectorAll('*').forEach(x => { [...x.attributes].forEach(a => { if (/^on/i.test(a.name) || (a.name !== 'style' && a.name !== 'href' && a.name !== 'class')) x.removeAttribute(a.name); }); if (x.className === 'invite') x.remove(); });
  return d.innerHTML.replace(/<p><br><\/p>$/, '').trim();
}
function enEditionTexte() { return V.edition && document.activeElement && document.activeElement.isContentEditable; }

// ---------- Souris sur la diapositive ----------
const pt = ev => { const r = diapoEl.getBoundingClientRect(); return { x: (ev.clientX - r.left) / V.echelle, y: (ev.clientY - r.top) / V.echelle }; };
function guides(liste) { $('#guides').innerHTML = liste.map(g => g.v != null ? `<div class="guide v" style="left:${g.v * V.echelle}px"></div>` : `<div class="guide h" style="top:${g.h * V.echelle}px"></div>`).join(''); }
function magnetiser(boite, ignorer) {
  if (!V.magnetisme) return { dx: 0, dy: 0, g: [] };
  const seuil = 6 / V.echelle;
  const xs = [0, LW() / 2, LW()], ys = [0, LH / 2, LH];
  D().elements.filter(e => !ignorer.includes(e.id)).forEach(e => { xs.push(e.x, e.x + e.l / 2, e.x + e.l); ys.push(e.y, e.y + e.h / 2, e.y + e.h); });
  let dx = 0, dy = 0, g = [], bx = seuil, by = seuil;
  for (const c of [boite.x, boite.x + boite.l / 2, boite.x + boite.l]) for (const x of xs) if (Math.abs(x - c) < bx) { bx = Math.abs(x - c); dx = x - c; g = g.filter(k => k.v == null); g.push({ v: x }); }
  for (const c of [boite.y, boite.y + boite.h / 2, boite.y + boite.h]) for (const y of ys) if (Math.abs(y - c) < by) { by = Math.abs(y - c); dy = y - c; g = g.filter(k => k.h == null); g.push({ h: y }); }
  return { dx, dy, g };
}
cadre.addEventListener('mousedown', ev => {
  if (ev.button !== 0) return;
  const t = ev.target;
  const ajoutImg = t.closest('[data-ajout-image]');
  if (ajoutImg) { ev.preventDefault(); const e = D().elements.find(x => x.id === ajoutImg.dataset.ajoutImage); insererImage(e); return; }
  const poignee = t.closest('.p, .rot');
  if (poignee) { ev.preventDefault(); redimensionner(ev, poignee.dataset.p); return; }
  const n = t.closest('.el');
  if (V.edition && n && n.dataset.id === V.edition) return; // clic dans le texte en cours d'édition
  if (V.edition) quitterEdition();
  scene.focus({ preventScroll: true });
  if (!n) {
    if (!ev.shiftKey) V.sel = [];
    const p0 = pt(ev); const rect = el('<div class="rectangle-sel"></div>'); calqueSel.appendChild(rect);
    const mv = m => { const p = pt(m); const x = Math.min(p0.x, p.x), y = Math.min(p0.y, p.y), l = Math.abs(p.x - p0.x), h = Math.abs(p.y - p0.y); Object.assign(rect.style, { left: x * V.echelle + 'px', top: y * V.echelle + 'px', width: l * V.echelle + 'px', height: h * V.echelle + 'px' }); V.sel = D().elements.filter(e => e.x < x + l && e.x + e.l > x && e.y < y + h && e.y + e.h > y).map(e => e.id); };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); rect.remove(); majSelection(); majRuban(); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
    majSelection(); majRuban(); return;
  }
  ev.preventDefault();
  const id = n.dataset.id;
  if (ev.shiftKey || ev.ctrlKey) V.sel = V.sel.includes(id) ? V.sel.filter(x => x !== id) : [...V.sel, id];
  else if (!V.sel.includes(id)) V.sel = [id];
  majSelection(); majRuban();
  // déplacement
  const p0 = pt(ev); const orig = selElements().map(e => ({ e, x: e.x, y: e.y })); let bouge = false;
  const boite0 = { x: Math.min(...orig.map(o => o.x)), y: Math.min(...orig.map(o => o.y)), l: Math.max(...orig.map(o => o.x + o.e.l)) - Math.min(...orig.map(o => o.x)), h: Math.max(...orig.map(o => o.y + o.e.h)) - Math.min(...orig.map(o => o.y)) };
  const mv = m => {
    const p = pt(m); let dx = p.x - p0.x, dy = p.y - p0.y;
    if (!bouge && Math.abs(dx) + Math.abs(dy) < 3 / V.echelle) return;
    if (!bouge) { bouge = true; avant(); }
    if (m.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const mg = magnetiser({ ...boite0, x: boite0.x + dx, y: boite0.y + dy }, V.sel); dx += mg.dx; dy += mg.dy; guides(mg.g);
    orig.forEach(o => { o.e.x = Math.round(o.x + dx); o.e.y = Math.round(o.y + dy); const d = diapoEl.querySelector(`.el[data-id="${o.e.id}"]`); if (d) { d.style.left = o.e.x + 'px'; d.style.top = o.e.y + 'px'; } });
    majSelection();
  };
  const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); guides([]); if (bouge) apres(); };
  addEventListener('mousemove', mv); addEventListener('mouseup', up);
});
cadre.addEventListener('dblclick', ev => {
  const n = ev.target.closest('.el'); if (!n) return;
  const e = D().elements.find(x => x.id === n.dataset.id);
  if (e?.type === 'image') { insererImage(e); return; }
  if (V.edition !== n.dataset.id) entrerEdition(n.dataset.id);
});
cadre.addEventListener('contextmenu', ev => {
  ev.preventDefault();
  const n = ev.target.closest('.el');
  if (n && !V.sel.includes(n.dataset.id)) { V.sel = [n.dataset.id]; majSelection(); }
  if (V.edition) return;
  menu(V.sel.length ? [
    { label: 'Couper', ico: 'scissors', raccourci: 'Ctrl+X', faire: () => copierSel(true) }, { label: 'Copier', ico: 'copy', raccourci: 'Ctrl+C', faire: () => copierSel(false) }, { label: 'Dupliquer', ico: 'copy-plus', raccourci: 'Ctrl+D', faire: dupliquerSel }, { label: 'Supprimer', ico: 'trash-2', faire: supprimerSelection }, '-',
    { label: 'Mettre au premier plan', ico: 'bring-to-front', faire: () => ordre('premier') }, { label: 'Mettre à l\'arrière-plan', ico: 'send-to-back', faire: () => ordre('arriere') }, '-',
    { label: 'Modifier le texte', ico: 'pencil', faire: () => entrerEdition(V.sel[0]) },
  ] : [{ label: 'Coller', ico: 'clipboard-paste', faire: collerSel, desactive: !pressePapiers }, { label: 'Nouvelle diapositive', ico: 'plus', faire: () => nouvelleDiapo() }, { label: 'Arrière-plan…', ico: 'image', faire: () => arrierePlan() }], ev.clientX, ev.clientY);
});
function redimensionner(ev, poignee) {
  const e = selElements()[0]; if (!e) return; avant();
  const o = { x: e.x, y: e.y, l: e.l, h: e.h, r: e.rotation || 0 }; const p0 = pt(ev);
  const ratio = o.l / Math.max(1, o.h);
  const mv = m => {
    const p = pt(m);
    if (poignee === 'rot') { const cx = o.x + o.l / 2, cy = o.y + o.h / 2; let a = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90; if (m.shiftKey) a = Math.round(a / 15) * 15; e.rotation = Math.round(((a % 360) + 360) % 360); if (e.rotation === 0) delete e.rotation; }
    else {
      let dx = p.x - p0.x, dy = p.y - p0.y; let { x, y, l, h } = o;
      if (poignee.includes('e')) l = o.l + dx; if (poignee.includes('s')) h = o.h + dy;
      if (poignee.includes('w')) { l = o.l - dx; x = o.x + dx; } if (poignee.includes('n')) { h = o.h - dy; y = o.y + dy; }
      if ((m.shiftKey || e.type === 'image') && poignee.length === 2) { const nh = l / ratio; if (poignee.includes('n')) y = o.y + o.h - nh; h = nh; }
      e.l = Math.max(10, Math.round(l)); e.h = Math.max(e.type === 'forme' && (e.forme === 'ligne' || e.forme === 'fleche') ? 2 : 10, Math.round(h)); e.x = Math.round(x); e.y = Math.round(y);
    }
    const d = diapoEl.querySelector(`.el[data-id="${e.id}"]`); if (d) d.outerHTML = htmlElement(e, { edition: true, th: themeDe(P.theme) });
    majSelection();
  };
  const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); apres(); };
  addEventListener('mousemove', mv); addEventListener('mouseup', up);
}

// ---------- Clavier ----------
scene.addEventListener('keydown', ev => {
  if (enEditionTexte()) { if (ev.key === 'Escape') { ev.preventDefault(); quitterEdition(); scene.focus(); } return; }
  const k = ev.key, ctrl = ev.ctrlKey || ev.metaKey;
  if ((k === 'Delete' || k === 'Backspace') && V.sel.length) { ev.preventDefault(); supprimerSelection(); return; }
  const fl = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
  if (fl && V.sel.length) { ev.preventDefault(); avant(); const pas = ev.shiftKey ? 10 : 1; selElements().forEach(e => { e.x += fl[0] * pas; e.y += fl[1] * pas; }); apres(); return; }
  if (fl && !V.sel.length) { if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'PageDown') allerA(V.courante + 1); else allerA(V.courante - 1); return; }
  if (k === 'PageDown') { allerA(V.courante + 1); return; } if (k === 'PageUp') { allerA(V.courante - 1); return; }
  if (k === 'Escape') { V.sel = []; majSelection(); return; }
  if ((k === 'Enter' || k === 'F2') && V.sel.length === 1) { ev.preventDefault(); entrerEdition(V.sel[0]); return; }
  if (ctrl && k.toLowerCase() === 'c') { copierSel(false); return; } if (ctrl && k.toLowerCase() === 'x') { copierSel(true); return; } if (ctrl && k.toLowerCase() === 'v') { collerSel(); return; }
  if (ctrl && k.toLowerCase() === 'd') { ev.preventDefault(); if (V.sel.length) dupliquerSel(); else dupliquerDiapo(); return; }
  if (ctrl && k.toLowerCase() === 'a') { ev.preventDefault(); V.sel = D().elements.map(e => e.id); majSelection(); return; }
  if (!ctrl && !ev.altKey && k.length === 1 && V.sel.length === 1) { const e = selElements()[0]; if (e.type === 'texte' || (e.type === 'forme' && e.forme !== 'ligne' && e.forme !== 'fleche')) { ev.preventDefault(); entrerEdition(e.id, { selectAll: true, texte: k }); } }
});
diapoEl.addEventListener('input', () => { if (V.edition) { modifie(); majVignettesEdition(); } });
const majVignettesEdition = debounce(() => { const e = D().elements.find(x => x.id === V.edition); const n = diapoEl.querySelector(`.el[data-id="${V.edition}"] [data-texte]`); if (e && n && e.type !== 'tableau') { const old = e.html; e.html = nettoyerHtml(n.innerHTML); majVignettes(); e.html = old; } }, 400);
diapoEl.addEventListener('paste', ev => { if (!V.edition) return; ev.preventDefault(); const t = ev.clipboardData.getData('text/plain'); document.execCommand('insertText', false, t); });
document.addEventListener('paste', async ev => {
  if (V.edition || document.activeElement !== scene) return;
  const img = [...(ev.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (img) { ev.preventDefault(); const f = img.getAsFile(); const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }); const im = await new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = url; }); const id = uid('m'); M[id] = url; const r = Math.min(1, LW() * 0.6 / im.naturalWidth, LH * 0.6 / im.naturalHeight); ajouterElement({ id: uid('e'), type: 'image', x: (LW() - im.naturalWidth * r) / 2, y: (LH - im.naturalHeight * r) / 2, l: im.naturalWidth * r, h: im.naturalHeight * r, src: 'media:' + id, alt: 'Image collée' }); return; }
  const t = ev.clipboardData?.getData('text/plain');
  if (t && !pressePapiers) { ev.preventDefault(); ajouterElement({ id: uid('e'), type: 'texte', x: 100, y: 200, l: LW() - 200, h: 120, html: t.split(/\r?\n/).map(l => `<p>${esc(l) || '<br>'}</p>`).join(''), style: { taille: 24 } }); }
});
$('#notes').addEventListener('input', debounce(e => { avant(); D().notes = e.target.value; modifie(); }, 300));
// redimensionner la zone de notes
$('#sep-notes').addEventListener('mousedown', ev => { ev.preventDefault(); const h0 = $('#zone-notes').offsetHeight, y0 = ev.clientY; const mv = m => { $('#zone-notes').style.height = Math.max(30, Math.min(400, h0 - (m.clientY - y0))) + 'px'; ajusterEchelle(); }; const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); }; addEventListener('mousemove', mv); addEventListener('mouseup', up); });

// ---------- Mise en forme ----------
function formatTexte(cmd, valeur, propriete, valeurProp) {
  if (enEditionTexte()) { document.execCommand('styleWithCSS', false, true); document.execCommand(cmd, false, valeur); modifie(); majVignettesEdition(); return; }
  const s = selElements().filter(e => e.type !== 'image'); if (!s.length) return;
  avant();
  for (const e of s) {
    e.style = { ...(e.style || {}) };
    const v = typeof valeurProp === 'function' ? valeurProp(styleZone(e)) : valeurProp;
    if (v == null) delete e.style[propriete]; else e.style[propriete] = v;
    // retirer les mises en forme en ligne contradictoires
    if (e.html && ['couleur', 'police', 'taille'].includes(propriete)) { const d = document.createElement('div'); d.innerHTML = e.html; d.querySelectorAll('[style]').forEach(x => { x.style[{ couleur: 'color', police: 'fontFamily', taille: 'fontSize' }[propriete]] = ''; }); e.html = d.innerHTML; }
    if (e.html && propriete === 'gras' && !v) e.html = e.html.replace(/<\/?(b|strong)>/g, '');
    if (e.html && propriete === 'italique' && !v) e.html = e.html.replace(/<\/?(i|em)>/g, '');
  }
  apres();
}
function basculeTexte(cmd, prop) { formatTexte(cmd, null, prop, s => s[prop] ? null : true); }
function enveloppeHtml(e, tag) { if (!e.html) return; if (new RegExp(`^<${tag}>`).test(e.html)) e.html = e.html.replace(new RegExp(`</?${tag}>`, 'g'), ''); else e.html = `<${tag}>${e.html}</${tag}>`; }
function puces(type) {
  if (enEditionTexte()) { document.execCommand(type === 'ul' ? 'insertUnorderedList' : 'insertOrderedList'); modifie(); return; }
  const s = selElements().filter(e => e.type === 'texte' || e.type === 'forme'); if (!s.length) return; avant();
  for (const e of s) {
    const d = document.createElement('div'); d.innerHTML = e.html || '';
    const liste = d.querySelector('ul,ol');
    if (liste && liste.tagName.toLowerCase() === type) e.html = [...d.querySelectorAll('li')].map(li => `<p>${li.innerHTML}</p>`).join('');
    else { const lignes = [...d.querySelectorAll('p,li,div')].map(p => p.innerHTML).filter(Boolean); e.html = `<${type}>${(lignes.length ? lignes : [d.innerHTML || '']).map(l => `<li>${l}</li>`).join('')}</${type}>`; }
  }
  apres();
}
function remplissage(c) { const s = selElements(); if (!s.length) return; avant(); s.forEach(e => { if (e.type !== 'image') e.remplissage = c; }); apres(); }
function contour(c) { const s = selElements(); if (!s.length) return; avant(); s.forEach(e => { e.contour = c; if (!e.epaisseur) e.epaisseur = 2; }); apres(); }
function epaisseur(v) { const s = selElements(); if (!s.length) return; avant(); s.forEach(e => { e.epaisseur = v; if (!e.contour || e.contour === 'transparent') e.contour = '#1B2A4A'; }); apres(); }
async function dimensions() {
  const e = selElements()[0]; if (!e) return;
  const r = await dialogue({ titre: 'Taille et position', contenu: `<div class="grille-champs"><label class="champ">Largeur (px)<input type="number" name="l" value="${Math.round(e.l)}"></label><label class="champ">Hauteur (px)<input type="number" name="h" value="${Math.round(e.h)}"></label><label class="champ">Horizontal (px)<input type="number" name="x" value="${Math.round(e.x)}"></label><label class="champ">Vertical (px)<input type="number" name="y" value="${Math.round(e.y)}"></label><label class="champ">Rotation (°)<input type="number" name="rot" value="${e.rotation || 0}"></label></div>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'OK', valeur: true, primaire: true }] });
  if (!r) return; avant(); Object.assign(e, { l: Math.max(2, +r.l), h: Math.max(2, +r.h), x: +r.x, y: +r.y }); e.rotation = +r.rot || undefined; apres();
}
async function arrierePlan() {
  const r = await dialogue({ titre: 'Mise en forme de l\'arrière-plan', contenu: `<label class="champ">Couleur<input type="color" name="c" value="${(D().fond && !D().fond.startsWith('media:') ? D().fond : themeDe(P.theme).fond)}" style="height:34px;padding:2px"></label><label class="case"><input type="checkbox" name="toutes"> Appliquer à toutes les diapositives</label>`, boutons: [{ label: 'Image…', valeur: 'image', gauche: true }, { label: 'Réinitialiser', valeur: 'reinit' }, { label: 'Annuler', valeur: null }, { label: 'Appliquer', valeur: 'ok', primaire: true }] });
  if (!r) return;
  let fond = r.c;
  if (r.valeur === 'image') { const i = await choisirImage(); if (!i) return; fond = i.src; }
  if (r.valeur === 'reinit') fond = undefined;
  avant(); (r.toutes ? P.diapos : [D()]).forEach(d => { if (fond) d.fond = fond; else delete d.fond; }); apres();
}
function appliquerTheme(id) { avant(); P.theme = id; P.diapos.forEach(d => { if (d.fond && !d.fond.startsWith('media:')) delete d.fond; }); apres(); majGalerieThemes(); }
function definirFormat(f) {
  if (P.format === f) return; avant();
  const k = (f === '4:3' ? 960 : 1280) / LW();
  P.diapos.forEach(d => d.elements.forEach(e => { e.x *= k; e.l *= k; }));
  P.format = f; ajusterEchelle(); apres();
}
function transition(t, toutes = false) { avant(); (toutes ? P.diapos : [D()]).forEach(d => d.transition = t); apres(); toast(toutes ? 'Transition appliquée à toutes les diapositives.' : `Transition : ${t}`); }
function animation(a) { const s = selElements(); if (!s.length) return toast('Sélectionnez un élément à animer.'); avant(); s.forEach(e => { if (a === 'aucune') delete e.animation; else e.animation = a; }); apres(); }

// ---------- Tableau ----------
const opTab = {
  ligne(apres_) { const t = selTableau(); if (!t) return; avant(); const i = V.celluleTab?.l ?? t.cellules.length - 1; t.cellules.splice(apres_ ? i + 1 : i, 0, t.cellules[0].map(() => '')); t.h += 40; apres(); },
  colonne(apres_) { const t = selTableau(); if (!t) return; avant(); const j = V.celluleTab?.c ?? t.cellules[0].length - 1; t.cellules.forEach(l => l.splice(apres_ ? j + 1 : j, 0, '')); apres(); },
  supprLigne() { const t = selTableau(); if (!t || t.cellules.length < 2) return; avant(); t.cellules.splice(V.celluleTab?.l ?? t.cellules.length - 1, 1); t.h = Math.max(40, t.h - 40); apres(); },
  supprCol() { const t = selTableau(); if (!t || t.cellules[0].length < 2) return; avant(); const j = V.celluleTab?.c ?? t.cellules[0].length - 1; t.cellules.forEach(l => l.splice(j, 1)); apres(); },
  entete() { const t = selTableau(); if (!t) return; avant(); t.entete = t.entete === false; apres(); },
};
diapoEl.addEventListener('focusin', ev => { const td = ev.target.closest?.('td'); if (td) V.celluleTab = { l: +td.dataset.l, c: +td.dataset.c }; });
diapoEl.addEventListener('keydown', ev => { if (ev.key !== 'Tab') return; const td = ev.target.closest?.('td'); if (!td) return; ev.preventDefault(); const tds = [...td.closest('table').querySelectorAll('td')]; const i = tds.indexOf(td) + (ev.shiftKey ? -1 : 1); if (tds[i]) { tds[i].focus(); const r = document.createRange(); r.selectNodeContents(tds[i]); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); } });

// ---------- Diaporama ----------
const PR = { i: 0, etape: 0, ecran: null, debut: 0, chrono: null, noir: false };
const canal = 'BroadcastChannel' in window ? new BroadcastChannel('atelier-diapo') : null;
function diaposVisibles() { return P.diapos.map((d, i) => ({ d, i })).filter(x => !x.d.masquee); }
function lancerDiaporama(depuis = 0, presentateur = false) {
  if (V.edition) quitterEdition();
  const vis = diaposVisibles(); if (!vis.length) return toast('Toutes les diapositives sont masquées.');
  PR.liste = vis; PR.i = Math.max(0, vis.findIndex(x => x.i >= depuis)); PR.etape = 0; PR.noir = false; PR.presentateur = presentateur;
  const d = $('#diaporama'); d.classList.remove('masque'); d.focus();
  $('#presentateur').classList.toggle('masque', !presentateur);
  PR.debut = Date.now(); clearInterval(PR.chrono); PR.chrono = setInterval(majPresentateur, 1000);
  if (!presentateur) document.documentElement.requestFullscreen?.().catch(() => { });
  afficherDiapoPres(true);
}
function quitterDiaporama() { $('#diaporama').classList.add('masque'); clearInterval(PR.chrono); if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); canal?.postMessage({ fin: true }); allerA(PR.liste?.[PR.i]?.i ?? V.courante); }
function rendrePres(d, conteneur, l, h, { etape = 99, transition = null } = {}) {
  const k = Math.min(l / LW(), h / LH);
  conteneur.innerHTML = `<div class="diapo-pres" style="width:${LW()}px;height:${LH}px;transform:scale(${k})">${htmlDiapo(d, { pres: true })}</div>`;
  const div = conteneur.firstElementChild; div.style.margin = `${(h - LH * k) / 2 - (LH - LH * k) / 2}px ${(l - LW() * k) / 2 - (LW() - LW() * k) / 2}px`;
  div.style.position = 'absolute'; div.style.left = ((l - LW()) / 2) + 'px'; div.style.top = ((h - LH) / 2) + 'px'; div.style.margin = '0';
  const anims = [...div.querySelectorAll('[data-anim]')];
  anims.forEach((a, n) => { if (n >= etape) a.classList.add('anim-cache'); else if (n === etape - 1 && transition === 'anim') a.classList.add('anim-' + a.dataset.anim); });
  if (transition && transition !== 'anim' && transition !== 'aucune') div.classList.add('trans-' + transition);
  return anims.length;
}
function afficherDiapoPres(nouvelle) {
  const x = PR.liste[PR.i]; const ecran = $('#ecran');
  if (PR.presentateur && nouvelle) majPresentateur(true);
  const zone = PR.presentateur ? $('#presentateur .actuelle') : ecran;
  PR.nbAnims = rendrePres(x.d, zone, zone.clientWidth || innerWidth, zone.clientHeight || innerHeight, { etape: PR.etape, transition: nouvelle ? x.d.transition : 'anim' });
  ecran.querySelectorAll('.noir,.blanc').forEach(n => n.remove()); if (PR.noir) ecran.insertAdjacentHTML('beforeend', `<div class="${PR.noir}"></div>`);
  $('#aide-diaporama').textContent = `${PR.i + 1} / ${PR.liste.length}`;
  canal?.postMessage({ pres: P, medias: M, index: x.i, etape: PR.etape, noir: PR.noir, transition: nouvelle ? x.d.transition : 'anim' });
}
function avancer() { if (PR.etape < (PR.nbAnims || 0)) { PR.etape++; afficherDiapoPres(false); return; } if (PR.i < PR.liste.length - 1) { PR.i++; PR.etape = 0; afficherDiapoPres(true); } else finDiaporama(); }
function reculer() { if (PR.etape > 0) { PR.etape--; afficherDiapoPres(false); return; } if (PR.i > 0) { PR.i--; PR.etape = 99; afficherDiapoPres(true); PR.etape = PR.nbAnims; } }
function finDiaporama() { const e = $('#ecran'); if (e.querySelector('.fin')) { quitterDiaporama(); return; } e.innerHTML = '<div class="fin" style="color:#ddd;font:20px var(--police)">Fin du diaporama. Cliquez pour quitter.</div>'; }
let tampon = '';
$('#diaporama').addEventListener('keydown', ev => {
  const k = ev.key;
  if (/^\d$/.test(k)) { tampon += k; return; }
  if (k === 'Enter' && tampon) { const n = +tampon - 1; tampon = ''; if (n >= 0 && n < PR.liste.length) { PR.i = n; PR.etape = 0; afficherDiapoPres(true); } return; }
  tampon = '';
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) { ev.preventDefault(); avancer(); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) { ev.preventDefault(); reculer(); }
  else if (k === 'Home') { PR.i = 0; PR.etape = 0; afficherDiapoPres(true); }
  else if (k === 'End') { PR.i = PR.liste.length - 1; PR.etape = 0; afficherDiapoPres(true); }
  else if (k === 'Escape') { ev.preventDefault(); quitterDiaporama(); }
  else if (k === 'b' || k === 'B' || k === '.') { PR.noir = PR.noir === 'noir' ? false : 'noir'; afficherDiapoPres(false); }
  else if (k === 'w' || k === 'W' || k === ',') { PR.noir = PR.noir === 'blanc' ? false : 'blanc'; afficherDiapoPres(false); }
});
$('#diaporama').addEventListener('click', ev => { if (ev.target.closest('.presentateur .bas-p')) return; if (PR.presentateur && !ev.target.closest('.actuelle')) return; if ($('#ecran .fin')) { quitterDiaporama(); return; } avancer(); });
$('#diaporama').addEventListener('contextmenu', ev => { ev.preventDefault(); menu([{ label: 'Suivante', faire: avancer }, { label: 'Précédente', faire: reculer }, { label: 'Écran noir', faire: () => { PR.noir = 'noir'; afficherDiapoPres(false); } }, '-', { label: 'Arrêter le diaporama', faire: quitterDiaporama }], ev.clientX, ev.clientY); });
let minuterieCurseur; $('#diaporama').addEventListener('mousemove', () => { $('#diaporama').classList.add('curseur'); clearTimeout(minuterieCurseur); minuterieCurseur = setTimeout(() => $('#diaporama').classList.remove('curseur'), 1800); });
function majPresentateur(complet) {
  const p = $('#presentateur'); if (p.classList.contains('masque') || !PR.liste) return;
  const s = Math.floor((Date.now() - PR.debut) / 1000);
  if (complet || !p.firstChild) {
    p.innerHTML = `<div class="actuelle"></div><div><h4>Diapositive suivante</h4><div class="suivante"></div></div><div class="notes-p"></div><div class="bas-p"><span class="chrono"></span><span class="pos"></span><span style="flex:1"></span><button data-p="prec">◀ Précédente</button><button data-p="suiv">Suivante ▶</button><button data-p="public">Ouvrir l'écran public</button><button data-p="fin">Arrêter</button></div>`;
    $$('.bas-p button', p).forEach(b => b.onclick = ev => { ev.stopPropagation(); ({ prec: reculer, suiv: avancer, fin: quitterDiaporama, public: ouvrirEcranPublic })[b.dataset.p](); });
    const suiv = PR.liste[PR.i + 1]; const zs = $('.suivante', p);
    requestAnimationFrame(() => { if (suiv) rendrePres(suiv.d, zs, zs.clientWidth, zs.clientHeight); else zs.innerHTML = '<span style="color:#888">Fin du diaporama</span>'; });
    $('.notes-p', p).textContent = PR.liste[PR.i].d.notes || 'Aucune note pour cette diapositive.';
  }
  $('.chrono', p).textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  $('.pos', p).textContent = `Diapositive ${PR.i + 1} sur ${PR.liste.length} · ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}
function ouvrirEcranPublic() { const w = window.open(location.pathname + '#public', 'atelier-diapo-public', 'popup,width=1280,height=720'); if (!w) { toast('Ouverture de l\'écran public impossible.', 'erreur'); return; } setTimeout(() => afficherDiapoPres(false), 1200); toast('Déplacez la fenêtre publique sur le vidéoprojecteur puis appuyez sur F11.'); }
// Fenêtre publique (deuxième écran)
if (location.hash === '#public') {
  document.body.innerHTML = '<div class="diaporama" id="diaporama" style="cursor:none"><div class="ecran" id="ecran"></div></div>';
  canal?.addEventListener('message', ev => { const m = ev.data; if (m.fin) { window.close(); return; } P = m.pres; M = m.medias; const d = P.diapos[m.index]; rendrePres(d, $('#ecran'), innerWidth, innerHeight, { etape: m.etape, transition: m.transition }); if (m.noir) $('#ecran').insertAdjacentHTML('beforeend', `<div class="${m.noir}"></div>`); });
  throw new Error('fenêtre publique');
}

// ---------- Trieuse ----------
function rendreTrieuse() {
  const t = $('#trieuse'); const w = 240, ech = w / LW();
  t.innerHTML = P.diapos.map((d, i) => `<div class="vignette ${i === V.courante ? 'active' : ''} ${d.masquee ? 'masquee' : ''}" data-i="${i}" draggable="true"><div class="cadre-v" style="height:${LH * ech + 4}px"><div class="mini" style="width:${LW()}px;height:${LH}px;transform:scale(${ech})">${htmlDiapo(d)}</div></div><span class="num">${i + 1}${d.transition && d.transition !== 'aucune' ? ' · ' + d.transition : ''}</span></div>`).join('');
  $$('.vignette', t).forEach(v => { const i = +v.dataset.i; v.onclick = () => { V.courante = i; rendreTrieuse(); majEtat(); }; v.ondblclick = () => vue('normal'); v.ondragstart = e => e.dataTransfer.setData('text/plain', String(i)); v.ondragover = e => e.preventDefault(); v.ondrop = e => { e.preventDefault(); deplacerDiapo(+e.dataTransfer.getData('text/plain'), i); rendreTrieuse(); }; });
}
function vue(v) { $('#trieuse').classList.toggle('masque', v !== 'trieuse'); ruban.actif('vue-normal', v === 'normal'); ruban.actif('vue-trieuse', v === 'trieuse'); if (v === 'trieuse') rendreTrieuse(); else rendre(); }

// ---------- Impression ----------
async function imprimer(mode = 'diapos') {
  const z = $('#zone-impression'); const pays = true;
  const largeurMM = 277, hauteurMM = largeurMM * LH / LW();
  const k = (largeurMM * 3.7795) / LW();
  if (mode === 'documents') {
    z.innerHTML = '';
    for (let i = 0; i < P.diapos.length; i += 6) {
      z.insertAdjacentHTML('beforeend', `<div class="page-notes" style="display:grid;grid-template-columns:1fr 1fr;gap:10mm">${P.diapos.slice(i, i + 6).map(d => `<div style="position:relative;width:${LW() * 0.25}px;height:${LH * 0.25}px;overflow:hidden;border:1px solid #999"><div style="position:absolute;left:0;top:0;width:${LW()}px;height:${LH}px;transform:scale(.25);transform-origin:top left">${htmlDiapo(d)}</div></div>`).join('')}</div>`);
    }
    $('#style-impression').textContent = '@page{size:A4 portrait;margin:12mm}';
  } else if (mode === 'notes') {
    z.innerHTML = P.diapos.map((d, i) => `<div class="page-notes"><div style="position:relative;width:${LW() * 0.5}px;height:${LH * 0.5}px;overflow:hidden;border:1px solid #999;margin:0 auto 10mm"><div style="position:absolute;left:0;top:0;width:${LW()}px;height:${LH}px;transform:scale(.5);transform-origin:top left">${htmlDiapo(d)}</div></div><p><b>Diapositive ${i + 1}</b></p><p style="white-space:pre-wrap">${esc(d.notes || '')}</p></div>`).join('');
    $('#style-impression').textContent = '@page{size:A4 portrait;margin:15mm}';
  } else {
    z.innerHTML = P.diapos.filter(d => !d.masquee).map(d => `<div class="page-diapo" style="width:${LW() * k}px;height:${LH * k}px"><div style="position:absolute;left:0;top:0;width:${LW()}px;height:${LH}px;transform:scale(${k});transform-origin:top left">${htmlDiapo(d)}</div></div>`).join('');
    $('#style-impression').textContent = `@page{size:${largeurMM + 10}mm ${(hauteurMM + 10).toFixed(1)}mm;margin:5mm}`;
  }
  void pays;
  await new Promise(r => setTimeout(r, 80));
  window.print();
}
async function dialogueImpression() {
  const r = await dialogue({ titre: 'Imprimer', contenu: `<div style="display:flex;flex-direction:column;gap:8px">${[['diapos', 'Diapositives en pleine page'], ['notes', 'Pages de commentaires (diapositive et notes)'], ['documents', 'Documents (6 diapositives par page)']].map(([v, l], i) => `<label class="case"><input type="radio" name="m" value="${v}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}</div><p>Pour obtenir un PDF, choisissez l'imprimante « Microsoft Print to PDF » ou « Enregistrer au format PDF ».</p>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Imprimer', valeur: true, primaire: true }] });
  if (r) imprimer(r.m);
}
async function exporterImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LW()}" height="${LH}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${LW()}px;height:${LH}px;overflow:hidden">${await styleInline()}${htmlDiapo(D()).replace(/<br>/g, '<br/>').replace(/<img([^>]*?)>/g, '<img$1/>')}</div></foreignObject></svg>`;
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; });
  const c = document.createElement('canvas'); c.width = LW(); c.height = LH; c.getContext('2d').drawImage(img, 0, 0);
  const b = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await b.arrayBuffer());
}
async function styleInline() { return `<style>.el{position:absolute;box-sizing:border-box}.contenu-texte{position:absolute;inset:0;padding:8px 10px;display:flex;flex-direction:column;overflow:hidden;line-height:1.18}.v-middle{justify-content:center}.v-bottom{justify-content:flex-end}p{margin:0 0 .25em}ul,ol{margin:0;padding-left:1.15em}svg.forme{position:absolute;inset:0}img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}table{width:100%;height:100%;border-collapse:collapse}td{border:1px solid #8c8c8c;padding:6px 10px;vertical-align:top}</style>`; }

// ---------- État, ruban ----------
function majEtat() {
  $('#etat-diapo').textContent = `Diapositive ${V.courante + 1} sur ${P.diapos.length}`;
  $('#etat-theme').textContent = `Thème : ${themeDe(P.theme).nom}`;
}
function majRuban() {
  const e = selElements()[0]; const s = e ? styleZone(e) : {};
  ruban.valeur('police', s.police || ''); ruban.valeur('taille', s.taille ? String(Math.round(s.taille)) : '');
  ruban.actif('gras', !!s.gras); ruban.actif('italique', !!s.italique);
  ['left', 'center', 'right', 'justify'].forEach(a => ruban.actif('al-' + a, s.align === a));
  ['top', 'middle', 'bottom'].forEach(a => ruban.actif('v-' + a, s.valign === a));
  ruban.actif('masquer-diapo', !!D()?.masquee); ruban.actif('magnetisme', V.magnetisme);
  ['aucune', 'fondu', 'glisser', 'pousser', 'zoom'].forEach(t => ruban.actif('t-' + t, (D()?.transition || 'aucune') === t));
  ['aucune', 'apparition', 'fondu', 'glisser', 'zoom'].forEach(t => ruban.actif('a-' + t, e ? (e.animation || 'aucune') === t : false));
  ruban.actif('f-169', P.format !== '4:3'); ruban.actif('f-43', P.format === '4:3');
}
function majGalerieThemes() { $$('button', ruban.el('galerie')).forEach(b => b.classList.toggle('actif', b.dataset.theme === P.theme)); }
const ruban = creerRuban($('#zone-ruban'), [
  { id: 'accueil', titre: 'Accueil', groupes: [
    { titre: 'Presse-papiers', items: [{ type: 'bouton', id: 'coller', ico: 'clipboard-paste', label: 'Coller', grand: true }, { type: 'pile', items: [{ type: 'bouton', id: 'couper', ico: 'scissors', label: 'Couper', avecLabel: true }, { type: 'bouton', id: 'copier', ico: 'copy', label: 'Copier', avecLabel: true }, { type: 'bouton', id: 'dupliquer', ico: 'copy-plus', label: 'Dupliquer', avecLabel: true }] }] },
    { titre: 'Diapositives', items: [{ type: 'menu', id: 'nouvelle', ico: 'file-plus-2', label: 'Nouvelle diapositive', grand: true, items: [] }, { type: 'pile', items: [{ type: 'menu', id: 'disposition', ico: 'layout-template', label: 'Disposition', avecLabel: true, items: [] }, { type: 'bouton', id: 'dupliquer-diapo', ico: 'copy', label: 'Dupliquer', avecLabel: true }, { type: 'bouton', id: 'supprimer-diapo', ico: 'trash-2', label: 'Supprimer', avecLabel: true }] }] },
    { titre: 'Police', items: [{ type: 'pile', items: [
      { type: 'ligne', items: [{ type: 'select', id: 'police', title: 'Police', options: POLICES, largeur: 140 }, { type: 'select', id: 'taille', title: 'Taille', options: TAILLES.map(String), largeur: 56 }, { type: 'bouton', id: 'agrandir', ico: 'a-arrow-up', title: 'Augmenter la taille de police' }, { type: 'bouton', id: 'reduire', ico: 'a-arrow-down', title: 'Diminuer la taille de police' }] },
      { type: 'ligne', items: [{ type: 'bascule', id: 'gras', ico: 'bold', title: 'Gras (Ctrl+G)' }, { type: 'bascule', id: 'italique', ico: 'italic', title: 'Italique (Ctrl+I)' }, { type: 'bascule', id: 'souligne', ico: 'underline', title: 'Souligné (Ctrl+U)' }, { type: 'bascule', id: 'barre', ico: 'strikethrough', title: 'Barré' }, { type: 'couleur', id: 'couleur-texte', ico: 'baseline', title: 'Couleur de police', defaut: '#C00000', aucune: true, labelAucune: 'Automatique', applicationDirecte: true }, { type: 'bouton', id: 'effacer-format', ico: 'remove-formatting', title: 'Effacer la mise en forme' }] },
    ] }] },
    { titre: 'Paragraphe', items: [{ type: 'pile', items: [
      { type: 'ligne', items: [{ type: 'bouton', id: 'puces', ico: 'list', title: 'Puces' }, { type: 'bouton', id: 'numeros', ico: 'list-ordered', title: 'Numérotation' }, { type: 'menu', id: 'interligne', ico: 'arrow-down-up', title: 'Interligne', items: () => ['1', '1.15', '1.5', '2'].map(v => ({ label: v.replace('.', ','), faire: () => formatTexte(null, null, 'interligne', +v) })) }] },
      { type: 'ligne', items: [{ type: 'bascule', id: 'al-left', ico: 'align-left', title: 'Aligner à gauche' }, { type: 'bascule', id: 'al-center', ico: 'align-center', title: 'Centrer' }, { type: 'bascule', id: 'al-right', ico: 'align-right', title: 'Aligner à droite' }, { type: 'bascule', id: 'al-justify', ico: 'align-justify', title: 'Justifier' }, { type: 'sep' }, { type: 'bascule', id: 'v-top', ico: 'align-vertical-justify-start', title: 'Aligner en haut' }, { type: 'bascule', id: 'v-middle', ico: 'align-vertical-justify-center', title: 'Centrer verticalement' }, { type: 'bascule', id: 'v-bottom', ico: 'align-vertical-justify-end', title: 'Aligner en bas' }] },
    ] }] },
    { titre: 'Dessin', items: [{ type: 'menu', id: 'formes', ico: 'shapes', label: 'Formes', grand: true, items: [] }, { type: 'pile', items: [{ type: 'couleur', id: 'remplissage', ico: 'paint-bucket', label: 'Remplissage', avecLabel: true, defaut: '#2456B0', aucune: true, labelAucune: 'Aucun remplissage', applicationDirecte: true }, { type: 'couleur', id: 'contour', ico: 'square', label: 'Contour', avecLabel: true, defaut: '#1B2A4A', aucune: true, labelAucune: 'Aucun contour', applicationDirecte: true }, { type: 'menu', id: 'epaisseur', ico: 'minus', label: 'Épaisseur', avecLabel: true, items: () => [1, 2, 3, 4, 6, 8, 12].map(v => ({ label: v + ' px', faire: () => epaisseur(v) })) }] }, { type: 'menu', id: 'organiser', ico: 'layers', label: 'Organiser', grand: true, items: () => [{ label: 'Mettre au premier plan', ico: 'bring-to-front', faire: () => ordre('premier') }, { label: 'Mettre à l\'arrière-plan', ico: 'send-to-back', faire: () => ordre('arriere') }, { label: 'Avancer', faire: () => ordre('avancer') }, { label: 'Reculer', faire: () => ordre('reculer') }, '-', { titre: 'Aligner' }, { label: 'Aligner à gauche', faire: () => aligner('gauche') }, { label: 'Centrer', faire: () => aligner('centre') }, { label: 'Aligner à droite', faire: () => aligner('droite') }, { label: 'Aligner en haut', faire: () => aligner('haut') }, { label: 'Aligner au milieu', faire: () => aligner('milieu') }, { label: 'Aligner en bas', faire: () => aligner('bas') }, { label: 'Distribuer horizontalement', faire: () => aligner('repartir-h') }, { label: 'Distribuer verticalement', faire: () => aligner('repartir-v') }] }] },
    { titre: 'Modification', items: [{ type: 'pile', items: [{ type: 'bouton', id: 'tout-sel', ico: 'text-select', label: 'Sélectionner tout', avecLabel: true }, { type: 'bouton', id: 'remplacer', ico: 'replace', label: 'Remplacer', avecLabel: true }] }] },
  ] },
  { id: 'insertion', titre: 'Insertion', groupes: [
    { titre: 'Diapositives', items: [{ type: 'menu', id: 'nouvelle2', ico: 'file-plus-2', label: 'Nouvelle diapositive', grand: true, items: [] }] },
    { titre: 'Tableaux', items: [{ type: 'menu', id: 'tableau', ico: 'table', label: 'Tableau', grand: true, items: [] }] },
    { titre: 'Illustrations', items: [{ type: 'bouton', id: 'image', ico: 'image', label: 'Image', grand: true }, { type: 'menu', id: 'formes2', ico: 'shapes', label: 'Formes', grand: true, items: [] }] },
    { titre: 'Texte', items: [{ type: 'bouton', id: 'zone-texte', ico: 'text-cursor-input', label: 'Zone de texte', grand: true }, { type: 'bouton', id: 'date', ico: 'calendar', label: 'Date', grand: true }, { type: 'bouton', id: 'numero', ico: 'hash', label: 'Numéro de diapositive', grand: true }] },
  ] },
  { id: 'creation', titre: 'Création', groupes: [
    { titre: 'Thèmes', items: [{ type: 'html', id: 'galerie', html: `<div class="galerie-themes">${THEMES.map(t => `<button data-theme="${t.id}" title="${t.nom}" style="background:${t.fond}"><span style="color:${t.titre};font-family:'${t.policeTitre}'">${t.nom}</span><i style="background:${t.accents[0]}"></i></button>`).join('')}</div>` }] },
    { titre: 'Personnaliser', items: [{ type: 'bascule', id: 'f-169', ico: 'rectangle-horizontal', label: '16:9', grand: true }, { type: 'bascule', id: 'f-43', ico: 'square', label: '4:3', grand: true }, { type: 'bouton', id: 'arriere-plan', ico: 'paint-roller', label: 'Arrière-plan', grand: true }] },
  ] },
  { id: 'transitions', titre: 'Transitions', groupes: [
    { titre: 'Transition vers cette diapositive', items: [['aucune', 'Aucune', 'ban'], ['fondu', 'Fondu', 'blend'], ['glisser', 'Balayer', 'arrow-left-to-line'], ['pousser', 'Pousser', 'arrow-up-to-line'], ['zoom', 'Zoom', 'zoom-in']].map(([t, l, i]) => ({ type: 'bascule', id: 't-' + t, ico: i, label: l, grand: true })) },
    { titre: 'Minutage', items: [{ type: 'bouton', id: 't-toutes', ico: 'copy-check', label: 'Appliquer à toutes', grand: true }] },
  ] },
  { id: 'animations', titre: 'Animations', groupes: [
    { titre: 'Animation de l\'élément sélectionné', items: [['aucune', 'Aucune', 'ban'], ['apparition', 'Apparition', 'sparkle'], ['fondu', 'Fondu', 'blend'], ['glisser', 'Entrée par le bas', 'arrow-up'], ['zoom', 'Zoom', 'zoom-in']].map(([t, l, i]) => ({ type: 'bascule', id: 'a-' + t, ico: i, label: l, grand: true })) },
  ] },
  { id: 'diaporama', titre: 'Diaporama', groupes: [
    { titre: 'Démarrer', items: [{ type: 'bouton', id: 'debut', ico: 'play', label: 'À partir du début', grand: true, raccourci: 'F5' }, { type: 'bouton', id: 'actuelle', ico: 'circle-play', label: 'À partir de la diapositive actuelle', grand: true, raccourci: 'Maj+F5' }, { type: 'bouton', id: 'presentateur', ico: 'presentation', label: 'Mode présentateur', grand: true }] },
    { titre: 'Configuration', items: [{ type: 'bascule', id: 'masquer-diapo', ico: 'eye-off', label: 'Masquer la diapositive', grand: true }] },
  ] },
  { id: 'affichage', titre: 'Affichage', groupes: [
    { titre: 'Modes', items: [{ type: 'bascule', id: 'vue-normal', ico: 'panels-top-left', label: 'Normal', grand: true }, { type: 'bascule', id: 'vue-trieuse', ico: 'layout-grid', label: 'Trieuse', grand: true }] },
    { titre: 'Afficher', items: [{ type: 'bascule', id: 'voir-notes', ico: 'notebook-pen', label: 'Notes', grand: true }, { type: 'bascule', id: 'magnetisme', ico: 'magnet', label: 'Repères magnétiques', grand: true }] },
    { titre: 'Zoom', items: [{ type: 'bouton', id: 'ajuster', ico: 'scan', label: 'Ajuster à la fenêtre', grand: true }, { type: 'bouton', id: 'zoom-plus', ico: 'zoom-in', label: 'Zoom +', grand: true }, { type: 'bouton', id: 'zoom-moins', ico: 'zoom-out', label: 'Zoom −', grand: true }] },
  ] },
  { id: 'forme', titre: 'Format de forme', contextuel: true, groupes: [
    { titre: 'Styles', items: [{ type: 'couleur', id: 'remplissage2', ico: 'paint-bucket', label: 'Remplissage', grand: true, defaut: '#2456B0', aucune: true, labelAucune: 'Aucun remplissage' }, { type: 'couleur', id: 'contour2', ico: 'square', label: 'Contour', grand: true, defaut: '#1B2A4A', aucune: true, labelAucune: 'Aucun contour' }] },
    { titre: 'Organiser', items: [{ type: 'bouton', id: 'premier-plan', ico: 'bring-to-front', label: 'Premier plan', grand: true }, { type: 'bouton', id: 'arriere-plan-el', ico: 'send-to-back', label: 'Arrière-plan', grand: true }, { type: 'bouton', id: 'centrer-diapo', ico: 'align-center-horizontal', label: 'Centrer', grand: true }] },
    { titre: 'Taille', items: [{ type: 'bouton', id: 'dimensions', ico: 'ruler', label: 'Taille et position', grand: true }, { type: 'bouton', id: 'alt', ico: 'captions', label: 'Texte de remplacement', grand: true }] },
    { titre: 'Supprimer', items: [{ type: 'bouton', id: 'suppr-el', ico: 'trash-2', label: 'Supprimer', grand: true }] },
  ] },
  { id: 'tableau-ctx', titre: 'Tableau', contextuel: true, groupes: [
    { titre: 'Lignes et colonnes', items: [{ type: 'bouton', id: 'tl-dessus', ico: 'between-horizontal-start', label: 'Insérer au-dessus', grand: true }, { type: 'bouton', id: 'tl-dessous', ico: 'between-horizontal-end', label: 'Insérer en dessous', grand: true }, { type: 'bouton', id: 'tc-gauche', ico: 'between-vertical-start', label: 'Insérer à gauche', grand: true }, { type: 'bouton', id: 'tc-droite', ico: 'between-vertical-end', label: 'Insérer à droite', grand: true }, { type: 'bouton', id: 'tl-suppr', ico: 'trash', label: 'Supprimer la ligne', grand: true }, { type: 'bouton', id: 'tc-suppr', ico: 'trash', label: 'Supprimer la colonne', grand: true }] },
    { titre: 'Style', items: [{ type: 'bouton', id: 't-entete', ico: 'heading', label: 'Ligne d\'en-tête', grand: true }] },
  ] },
], {
  onFichier: () => doc.ouvrirCoulisses('accueil'),
  actions: {
    coller: collerSel, couper: () => copierSel(true), copier: () => copierSel(false), dupliquer: dupliquerSel,
    nouvelle: b => menuDispositions(b, 0, 0, d => nouvelleDiapo(d)), nouvelle2: b => menuDispositions(b, 0, 0, d => nouvelleDiapo(d)), disposition: b => menuDispositions(b, 0, 0, changerDisposition),
    'dupliquer-diapo': dupliquerDiapo, 'supprimer-diapo': supprimerDiapo,
    police: v => formatTexte('fontName', v, 'police', v), taille: v => formatTexte(null, null, 'taille', +v),
    agrandir: () => formatTexte(null, null, 'taille', s => TAILLES.find(t => t > s.taille) || s.taille + 4), reduire: () => formatTexte(null, null, 'taille', s => [...TAILLES].reverse().find(t => t < s.taille) || Math.max(8, s.taille - 2)),
    gras: () => basculeTexte('bold', 'gras'), italique: () => basculeTexte('italic', 'italique'),
    souligne: () => { if (enEditionTexte()) { document.execCommand('underline'); modifie(); return; } avant(); selElements().forEach(e => enveloppeHtml(e, 'u')); apres(); },
    barre: () => { if (enEditionTexte()) { document.execCommand('strikeThrough'); modifie(); return; } avant(); selElements().forEach(e => enveloppeHtml(e, 's')); apres(); },
    'couleur-texte': c => formatTexte('foreColor', c === 'transparent' ? '#000000' : c, 'couleur', c === 'transparent' ? null : c),
    'effacer-format': () => { if (enEditionTexte()) { document.execCommand('removeFormat'); return; } avant(); selElements().forEach(e => { e.style = { taille: e.style?.taille }; if (e.html) { const d = document.createElement('div'); d.innerHTML = e.html; d.querySelectorAll('[style]').forEach(x => x.removeAttribute('style')); d.querySelectorAll('b,i,u,s,strong,em,font').forEach(x => x.replaceWith(...x.childNodes)); e.html = d.innerHTML; } }); apres(); },
    puces: () => puces('ul'), numeros: () => puces('ol'),
    'al-left': () => formatTexte('justifyLeft', null, 'align', null), 'al-center': () => formatTexte('justifyCenter', null, 'align', 'center'), 'al-right': () => formatTexte('justifyRight', null, 'align', 'right'), 'al-justify': () => formatTexte('justifyFull', null, 'align', 'justify'),
    'v-top': () => { const s = selElements(); if (!s.length) return; avant(); s.forEach(e => e.style = { ...(e.style || {}), valign: null }); apres(); }, 'v-middle': () => { avant(); selElements().forEach(e => e.style = { ...(e.style || {}), valign: 'middle' }); apres(); }, 'v-bottom': () => { avant(); selElements().forEach(e => e.style = { ...(e.style || {}), valign: 'bottom' }); apres(); },
    formes: b => menuFormes(b), formes2: b => menuFormes(b), remplissage: c => remplissage(c), contour: c => contour(c), remplissage2: c => remplissage(c), contour2: c => contour(c),
    'tout-sel': () => { V.sel = D().elements.map(e => e.id); majSelection(); }, remplacer: rechercherRemplacer,
    tableau: b => menuTableau(b), image: () => insererImage(), 'zone-texte': zoneTexte,
    date: () => ajouterElement({ id: uid('e'), type: 'texte', x: LW() - 330, y: LH - 60, l: 280, h: 40, html: `<p>${new Date().toLocaleDateString('fr-FR')}</p>`, style: { taille: 16, align: 'right' } }),
    numero: () => ajouterElement({ id: uid('e'), type: 'texte', x: LW() - 120, y: LH - 60, l: 80, h: 40, html: `<p>${V.courante + 1}</p>`, style: { taille: 16, align: 'right' } }),
    'f-169': () => definirFormat('16:9'), 'f-43': () => definirFormat('4:3'), 'arriere-plan': arrierePlan,
    't-aucune': () => transition('aucune'), 't-fondu': () => transition('fondu'), 't-glisser': () => transition('glisser'), 't-pousser': () => transition('pousser'), 't-zoom': () => transition('zoom'), 't-toutes': () => transition(D().transition || 'aucune', true),
    'a-aucune': () => animation('aucune'), 'a-apparition': () => animation('apparition'), 'a-fondu': () => animation('fondu'), 'a-glisser': () => animation('glisser'), 'a-zoom': () => animation('zoom'),
    debut: () => lancerDiaporama(0), actuelle: () => lancerDiaporama(V.courante), presentateur: () => lancerDiaporama(V.courante, true), 'masquer-diapo': masquerDiapo,
    'vue-normal': () => vue('normal'), 'vue-trieuse': () => vue('trieuse'), 'voir-notes': () => { V.notes = !V.notes; $('#zone-notes').classList.toggle('masque', !V.notes); $('#sep-notes').classList.toggle('masque', !V.notes); ruban.actif('voir-notes', V.notes); ajusterEchelle(); },
    magnetisme: () => { V.magnetisme = !V.magnetisme; majRuban(); }, ajuster: () => { V.zoomManuel = 1; ajusterEchelle(); }, 'zoom-plus': () => { V.zoomManuel = (V.zoomManuel || 1) * 1.2; ajusterEchelle(); }, 'zoom-moins': () => { V.zoomManuel = (V.zoomManuel || 1) / 1.2; ajusterEchelle(); },
    'premier-plan': () => ordre('premier'), 'arriere-plan-el': () => ordre('arriere'), 'centrer-diapo': () => { aligner('centre'); aligner('milieu'); }, dimensions,
    alt: async () => { const e = selElements()[0]; if (!e) return; const v = await demander('Texte de remplacement', 'Description pour les personnes qui ne voient pas l\'élément', e.alt || ''); if (v != null) { avant(); e.alt = v; apres(); } },
    'suppr-el': supprimerSelection,
    'tl-dessus': () => opTab.ligne(false), 'tl-dessous': () => opTab.ligne(true), 'tc-gauche': () => opTab.colonne(false), 'tc-droite': () => opTab.colonne(true), 'tl-suppr': opTab.supprLigne, 'tc-suppr': opTab.supprCol, 't-entete': opTab.entete,
  }
});
$$('button', ruban.el('galerie')).forEach(b => { b.onmousedown = e => e.preventDefault(); b.onclick = () => appliquerTheme(b.dataset.theme); });
// les listes déroulantes du ruban ne doivent pas faire perdre l'édition
$$('#zone-ruban select').forEach(s => s.addEventListener('mousedown', () => { V.selTexte = enEditionTexte() ? getSelection().getRangeAt(0).cloneRange() : null; }));
$$('#zone-ruban select').forEach(s => s.addEventListener('change', () => { if (V.selTexte && V.edition) { const n = diapoEl.querySelector(`.el[data-id="${V.edition}"] [data-texte]`); n?.focus(); getSelection().removeAllRanges(); getSelection().addRange(V.selTexte); } }, true));

async function rechercherRemplacer() {
  const r = await dialogue({ titre: 'Remplacer', contenu: `<label class="champ">Rechercher<input type="text" name="q"></label><label class="champ">Remplacer par<input type="text" name="r"></label><label class="case"><input type="checkbox" name="casse"> Respecter la casse</label>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Tout remplacer', valeur: true, primaire: true }] });
  if (!r || !r.q) return;
  avant(); let n = 0; const re = new RegExp(r.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), r.casse ? 'g' : 'gi');
  const remp = h => { const d = document.createElement('div'); d.innerHTML = h; const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) { const m = t.nodeValue.match(re); if (m) { n += m.length; t.nodeValue = t.nodeValue.replace(re, r.r); } } return d.innerHTML; };
  P.diapos.forEach(d => { d.elements.forEach(e => { if (e.html) e.html = remp(e.html); if (e.cellules) e.cellules = e.cellules.map(l => l.map(remp)); }); if (d.notes && re.test(d.notes)) { d.notes = d.notes.replace(re, r.r); } });
  apres(); toast(`${n} remplacement(s) effectué(s).`, 'succes');
}

// ---------- Barre d'état ----------
$('#barre-etat').innerHTML = `<span id="etat-diapo"></span><span id="etat-theme"></span><span class="espace"></span><button id="b-notes" title="Notes">${ico('notebook-pen', 'p')} Notes</button><button id="b-trieuse" title="Trieuse de diapositives">${ico('layout-grid', 'p')}</button><button id="b-diaporama" title="Diaporama (F5)">${ico('play', 'p')}</button>`;
$('#b-notes').onclick = () => ruban.el('voir-notes').click(); $('#b-trieuse').onclick = () => vue($('#trieuse').classList.contains('masque') ? 'trieuse' : 'normal'); $('#b-diaporama').onclick = () => lancerDiaporama(V.courante);

// ---------- Fichiers ----------
const pptxOctets = () => exporterPptx({ ...P, titre: nomSansExtension(doc.nom) }, { medias: M, styleZone });
function charger(o) { P = o.pres || o; M = o.medias || {}; P.diapos = P.diapos?.length ? P.diapos : MODELES[0].creer().diapos; V.courante = 0; V.sel = []; V.edition = null; pile.length = 0; futur.length = 0; ajusterEchelle(); rendre(); majGalerieThemes(); }
const doc = creerDocument({
  focus: () => $('#scene').focus({ preventScroll: true }),
  app: 'diapo', nomApp: 'Diapo', lettre: 'Di', barreTitre: $('#barre-titre'),
  formatsOuverture: [{ nom: 'Présentations PowerPoint', ext: ['pptx'] }, { nom: 'Présentations Suite Acad’', ext: ['diapo'] }],
  formatsEnregistrement: [{ nom: 'Présentation PowerPoint', ext: 'pptx', ecrire: pptxOctets }, { nom: 'Présentation Suite Acad’', ext: 'diapo', ecrire: async () => JSON.stringify({ format: 'atelier-diapo', version: 1, pres: P, medias: M }) }],
  exports: [
    { id: 'pdf', label: 'PDF', ico: 'file-type', desc: 'Ouvre l\'impression : choisissez « Microsoft Print to PDF » ou « Enregistrer au format PDF ».', faire: () => imprimer('diapos') },
    { id: 'pptx', label: 'PowerPoint (.pptx)', ico: 'presentation', ext: 'pptx', desc: 'Compatible Microsoft PowerPoint et LibreOffice Impress.', ecrire: pptxOctets },
    { id: 'png', label: 'Image de la diapositive (.png)', ico: 'image', ext: 'png', desc: 'Diapositive actuelle en image haute définition.', ecrire: exporterImage },
    { id: 'notes', label: 'Pages de commentaires (PDF)', ico: 'notebook-pen', desc: 'Chaque diapositive avec ses notes, pour l\'orateur.', faire: () => imprimer('notes') },
    { id: 'documents', label: 'Documents à distribuer (PDF)', ico: 'layout-grid', desc: 'Six diapositives par page.', faire: () => imprimer('documents') },
  ],
  modeles: MODELES,
  async nouveau(m) { charger({ pres: (m || MODELES[0]).creer(), medias: {} }); },
  async charger({ octets, ext }) {
    if (ext === 'diapo') { const o = JSON.parse(new TextDecoder().decode(octets)); charger(o); return; }
    charger(await importerPptx(octets));
  },
  informations: async () => [['Diapositives', String(P.diapos.length)], ['Format', P.format], ['Thème', themeDe(P.theme).nom], ['Images', String(Object.keys(M).length)]],
  annuler, retablir, imprimer: dialogueImpression,
  commandes: () => ruban.commandes(),
});
const horsSaisie = f => e => { const a = document.activeElement; if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.tagName === 'SELECT') ) return false; return f(e); };
raccourcis({
  'Ctrl+M': horsSaisie(() => nouvelleDiapo()), 'F5': () => lancerDiaporama(0), 'Maj+F5': () => lancerDiaporama(V.courante),
  'Ctrl+Z': horsSaisie(() => { if (enEditionTexte()) return false; annuler(); }), 'Ctrl+Y': horsSaisie(() => { if (enEditionTexte()) return false; retablir(); }),
  'Ctrl+G': horsSaisie(() => basculeTexte('bold', 'gras')), 'Ctrl+B': horsSaisie(() => basculeTexte('bold', 'gras')), 'Ctrl+I': horsSaisie(() => basculeTexte('italic', 'italique')),
  'Ctrl+U': horsSaisie(() => ruban.el('souligne').click()), 'Ctrl+E': horsSaisie(() => ruban.el('al-center').click()), 'Ctrl+L': horsSaisie(() => ruban.el('al-left').click()), 'Ctrl+R': horsSaisie(() => ruban.el('al-right').click()),
  'Ctrl+H': () => rechercherRemplacer(),
});
window.__diapo = { P: () => P, M: () => M, V, D, rendre, entrerEdition, quitterEdition, allerA, doc, charger, PR, styleZone, ajusterEchelle };
(async () => { ajusterEchelle(); await doc.demarrer(); majGalerieThemes(); ruban.actif('vue-normal', true); ruban.actif('voir-notes', true); scene.focus(); })();
