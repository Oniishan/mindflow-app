// Texte — traitement de texte
import { $, $$, el, esc, ico, toast, dialogue, confirmer, demander, menu, creerRuban, raccourcis, debounce, choisirCouleur, nomSansExtension, telechargerBlob } from './commun/ui.js';
import { creerDocument } from './commun/document.js';
import * as F from './commun/fichiers.js';
import { unzipSync, strFromU8 } from './commun/vendor/fflate.js';
import { nettoyer, sauverSelection, restaurerSelection, plageCourante, blocDe, blocsSelection, HistoriqueDoc, paginer, chercher, statistiques } from './editeur.js';
import { docxOctets, hash } from './docx.js';
import { ecrireOdt, lireOdt } from './odt.js';
import { MODELES } from './modeles.js';

const feuille = $('#feuille'), espace = $('#espace'), echelleEl = $('#echelle'), pagesEl = $('#pages');
const fondsEl = $('#fonds-pages'), calqueHF = $('#calque-hf'), stylePag = $('#pagination'), styleDoc = $('#style-doc'), styleImp = $('#style-impression');
const MM = 96 / 25.4, CM = 96 / 2.54;
const FORMATS_PAGE = { A4: [210, 297], A5: [148, 210], A3: [297, 420], Lettre: [215.9, 279.4], Légal: [215.9, 355.6] };
const MARGES = { normales: [2.5, 2.5, 2.5, 2.5], etroites: [1.27, 1.27, 1.27, 1.27], moyennes: [2.54, 2.54, 1.91, 1.91], larges: [2.54, 2.54, 5.08, 5.08] };

// ---------- État du document ----------
const reglagesDefaut = () => ({
  page: { format: 'A4', paysage: false, largeur: 210 * MM, hauteur: 297 * MM, marges: { haut: 2.5 * CM, bas: 2.5 * CM, gauche: 2.5 * CM, droite: 2.5 * CM } },
  entete: { gauche: '', centre: '', droite: '' }, pied: { gauche: '', centre: '', droite: '' }, premierePageDifferente: false,
  filigrane: '', police: 'Calibri', taille: 11, couleurTitres: '1F3864', commentaires: [], cree: new Date().toISOString(),
});
let D = reglagesDefaut();
const V = { zoom: 1, mode: 'page', regle: true, nav: false, pages: 1, pageDe: () => 0, auto: true, peintre: null, imageSel: null };
const hist = new HistoriqueDoc(feuille);
const utilisateur = () => (doc.prefs.nom || F.SESSION?.utilisateur || 'Utilisateur');

// ---------- Polices disponibles ----------
const POLICES_CANDIDATES = ['Arial', 'Calibri', 'Cambria', 'Candara', 'Century Gothic', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Garamond', 'Georgia', 'Liberation Sans', 'Liberation Serif', 'Luciole', 'Marianne', 'Open Sans', 'Palatino Linotype', 'Segoe UI', 'Spectral', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'DejaVu Sans', 'Atkinson Hyperlegible Next'];
function policesDisponibles() {
  const c = document.createElement('canvas').getContext('2d');
  const test = 'mmmmmmmmmmlli1WWwQ@#', base = ['monospace', 'serif', 'sans-serif'];
  const larg = f => { c.font = `72px ${f}`; return c.measureText(test).width; };
  const ref = base.map(larg);
  return POLICES_CANDIDATES.filter(p => base.some((b, i) => larg(`"${p}",${b}`) !== ref[i]));
}
const POLICES = policesDisponibles();
const TAILLES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

// ---------- Application des réglages ----------
function appliquerReglages() {
  const p = D.page;
  const pol = D.police.includes(',') ? D.police : `"${D.police}", Carlito, Calibri, Arial, sans-serif`;
  styleDoc.textContent = `:root{--police-doc:${pol};--taille-doc:${D.taille}pt;--couleur-titres:#${D.couleurTitres}}
  .pages{width:${p.largeur}px}
  .feuille{padding:${p.marges.haut}px ${p.marges.droite}px ${p.marges.bas}px ${p.marges.gauche}px;width:${p.largeur}px}`;
  // impression : format, marges, en-tête et pied de page dans les marges de page
  const champ = t => {
    const parts = String(t || '').split(/(\{page\}|\{pages\}|\{date\}|\{titre\})/).filter(Boolean);
    if (!parts.length) return '""';
    return parts.map(s => s === '{page}' ? 'counter(page)' : s === '{pages}' ? 'counter(pages)' : s === '{date}' ? JSON.stringify(new Date().toLocaleDateString('fr-FR')) : s === '{titre}' ? JSON.stringify(nomSansExtension(doc?.nom || '')) : JSON.stringify(s)).join(' ');
  };
  const boites = (z, pos) => ['left', 'center', 'right'].map((c, i) => { const v = [z.gauche, z.centre, z.droite][i]; return v ? `@${pos}-${c}{content:${champ(v)};font:9pt ${pol};color:#555}` : ''; }).join('');
  styleImp.textContent = `@page{size:${(p.largeur / MM).toFixed(1)}mm ${(p.hauteur / MM).toFixed(1)}mm;margin:${(p.marges.haut / MM).toFixed(1)}mm ${(p.marges.droite / MM).toFixed(1)}mm ${(p.marges.bas / MM).toFixed(1)}mm ${(p.marges.gauche / MM).toFixed(1)}mm;${boites(D.entete, 'top')}${boites(D.pied, 'bottom')}}
  ${D.premierePageDifferente ? '@page:first{@top-left{content:none}@top-center{content:none}@top-right{content:none}@bottom-left{content:none}@bottom-center{content:none}@bottom-right{content:none}}' : ''}`;
  $('#filigrane-impression').textContent = D.filigrane || '';
  majRegle();
  planifierPagination(true);
}

// ---------- Pagination et pages ----------
let pagEnCours = false;
function paginerMaintenant() {
  pagEnCours = false;
  const p = D.page, G = 22;
  if (V.mode !== 'page') {
    stylePag.textContent = ''; fondsEl.innerHTML = ''; calqueHF.innerHTML = '';
    feuille.style.minHeight = ''; pagesEl.style.height = ''; V.pages = 1; majEtat(); ajusterEchelle(); return;
  }
  feuille.style.minHeight = '';
  const r = paginer(feuille, stylePag, { H: p.hauteur, G, mt: p.marges.haut, mb: p.marges.bas });
  V.pages = r.pages; V.pageDe = r.pageDe;
  const total = r.pages * (p.hauteur + G) - G;
  feuille.style.minHeight = total + 'px';
  pagesEl.style.height = total + 'px';
  // fonds de page, en-têtes et pieds
  let fonds = '', hf = '';
  const titre = nomSansExtension(doc?.nom || '');
  const remplir = (t, k) => esc(String(t || '')).replace(/\{page\}/g, k + 1).replace(/\{pages\}/g, r.pages).replace(/\{date\}/g, new Date().toLocaleDateString('fr-FR')).replace(/\{titre\}/g, esc(titre));
  const zone = (z, k, type, top) => {
    const vide = !(z.gauche || z.centre || z.droite) || (D.premierePageDifferente && k === 0);
    return `<div class="zone-hf ${vide ? 'vide' : ''}" data-hf="${type}" data-aide="Double-cliquez pour ajouter ${type === 'entete' ? 'un en-tête' : 'un pied de page'}" title="Double-cliquez pour modifier ${type === 'entete' ? "l'en-tête" : 'le pied de page'}" style="top:${top}px;left:${p.marges.gauche}px;right:${p.marges.droite}px"><span class="g">${vide ? '' : remplir(z.gauche, k)}</span><span class="c">${vide ? '' : remplir(z.centre, k)}</span><span class="d">${vide ? '' : remplir(z.droite, k)}</span></div>`;
  };
  for (let k = 0; k < r.pages; k++) {
    const y = k * (p.hauteur + G);
    fonds += `<div class="fond-page" style="top:${y}px;height:${p.hauteur}px">${D.filigrane ? `<div class="filigrane">${esc(D.filigrane)}</div>` : ''}</div>`;
    hf += zone(D.entete, k, 'entete', y + Math.max(8, p.marges.haut / 2 - 10));
    hf += zone(D.pied, k, 'pied', y + p.hauteur - Math.max(8, p.marges.bas / 2) - 10);
  }
  fondsEl.innerHTML = fonds; calqueHF.innerHTML = hf;
  majSommaire(false);
  majEtat(); ajusterEchelle();
}
function planifierPagination(immediat) {
  if (immediat) { requestAnimationFrame(paginerMaintenant); return; }
  if (pagEnCours) return; pagEnCours = true;
  setTimeout(() => requestAnimationFrame(paginerMaintenant), 120);
}
calqueHF.addEventListener('dblclick', e => { const z = e.target.closest('[data-hf]'); if (z) dialogueEnteteDifferent(z.dataset.hf); });

// ---------- Zoom ----------
function ajusterEchelle() {
  echelleEl.style.transform = `scale(${V.zoom})`;
  const largeur = D.page.largeur * V.zoom;
  echelleEl.style.width = (espace.clientWidth > largeur + 40 ? espace.clientWidth / V.zoom : (D.page.largeur + 80)) + 'px';
  echelleEl.style.height = ((pagesEl.offsetHeight + 64) * V.zoom) + 'px';
  echelleEl.style.marginBottom = '0';
  const z = $('#zoom-val'); if (z) z.textContent = Math.round(V.zoom * 100) + ' %';
  const s = $('#zoom-curseur'); if (s) s.value = Math.round(V.zoom * 100);
  majRegle();
}
function definirZoom(z) { V.zoom = Math.min(5, Math.max(0.25, z)); ajusterEchelle(); }
window.addEventListener('resize', debounce(ajusterEchelle, 80));

// ---------- Règle ----------
function majRegle() {
  const r = $('#regle'), ri = $('#regle-int');
  r.classList.toggle('masque', !V.regle || V.mode !== 'page');
  if (!V.regle) return;
  const p = D.page, z = V.zoom;
  const debut = pagesEl.getBoundingClientRect().left - r.getBoundingClientRect().left;
  ri.style.left = debut + 'px'; ri.style.width = p.largeur * z + 'px';
  let h = `<div class="marge" style="left:0;width:${p.marges.gauche * z}px"></div><div class="marge" style="right:0;width:${p.marges.droite * z}px"></div>`;
  const ncm = Math.floor(p.largeur / CM);
  for (let i = 0; i <= ncm; i++) {
    const x = i * CM * z;
    h += `<span class="tic" style="left:${x}px"></span>`;
    const lbl = i - Math.round(p.marges.gauche / CM);
    if (i > 0 && i < ncm && lbl !== 0) h += `<span class="grad" style="left:${x}px">${Math.abs(lbl)}</span>`;
  }
  ri.innerHTML = h;
}
espace.addEventListener('scroll', () => { if (V.regle) majRegle(); placerPoignees(); });

// ---------- Historique ----------
let dernierInstantane = 0, dernierType = '';
function avant() { hist.pousser(D); }
function apres() { doc.marquerModifie(); planifierPagination(); majInterface(); }
feuille.addEventListener('beforeinput', e => {
  if (e.inputType === 'historyUndo') { e.preventDefault(); annuler(); return; }
  if (e.inputType === 'historyRedo') { e.preventDefault(); retablir(); return; }
  const type = e.inputType.startsWith('delete') ? 'suppr' : 'saisie';
  if (Date.now() - dernierInstantane > 1200 || type !== dernierType || e.inputType === 'insertParagraph' || e.inputType.startsWith('insertFrom')) avant();
  dernierInstantane = Date.now(); dernierType = type;
  if (V.auto && e.inputType === 'insertText' && e.data) typographie(e);
});
feuille.addEventListener('input', () => { apres(); });
function annuler() { const x = hist.annuler(D); if (x) { if (x.page) D = x; appliquerReglages(); apres(); majPanneauCom(); } }
function retablir() { const x = hist.retablir(D); if (x) { if (x.page) D = x; appliquerReglages(); apres(); majPanneauCom(); } }

// Typographie française : guillemets « » et espace insécable avant ; : ! ?
function typographie(e) {
  const r = plageCourante(feuille); if (!r || !r.collapsed) return;
  const n = r.startContainer, o = r.startOffset;
  const avantCar = n.nodeType === 3 ? n.nodeValue.slice(Math.max(0, o - 1), o) : '';
  if (e.data === '"') {
    e.preventDefault();
    const ouvrant = !avantCar || /[\s(\[ ]/.test(avantCar);
    document.execCommand('insertText', false, ouvrant ? '« ' : ' »');
  } else if (/^[;:!?»]$/.test(e.data) && /[ \u00a0]/.test(avantCar) && avantCar) {
    e.preventDefault();
    // remplacer l'espace précédent par une espace insécable
    const rr = document.createRange(); rr.setStart(n, o - 1); rr.setEnd(n, o);
    const s = getSelection(); s.removeAllRanges(); s.addRange(rr);
    document.execCommand('insertText', false, (e.data === ':' ? ' ' : ' ') + e.data);
  } else if (e.data === "'" && V.apostrophe !== false) {
    e.preventDefault(); document.execCommand('insertText', false, '’');
  }
}

// ---------- Mise en forme ----------
let selMemo = null;
document.addEventListener('selectionchange', () => {
  const r = plageCourante(feuille);
  if (r) { selMemo = sauverSelection(feuille); majInterface(); }
});
function restaurer() { if (!plageCourante(feuille) && selMemo) { feuille.focus({ preventScroll: true }); restaurerSelection(feuille, selMemo); } else feuille.focus({ preventScroll: true }); }
function cmd(c, v = null) { restaurer(); avant(); document.execCommand('styleWithCSS', false, !['subscript', 'superscript', 'bold', 'italic', 'underline', 'strikeThrough'].includes(c)); document.execCommand(c, false, v); document.execCommand('styleWithCSS', false, true); apres(); }
function enveloppeStyle(prop, valeur) {
  // applique une propriété CSS en ligne à la sélection (taille en points, police…)
  restaurer(); avant();
  document.execCommand('styleWithCSS', false, false);
  document.execCommand('fontSize', false, '7');
  $$('font[size="7"]', feuille).forEach(f => {
    const s = document.createElement('span'); s.style.setProperty(prop, valeur);
    while (f.firstChild) s.appendChild(f.firstChild); f.replaceWith(s);
    // retirer la même propriété des descendants pour éviter les conflits
    $$('span', s).forEach(k => { k.style.removeProperty(prop); if (!k.getAttribute('style')) k.replaceWith(...k.childNodes); });
  });
  document.execCommand('styleWithCSS', false, true);
  apres();
}
function taillePolice(v) { const n = parseFloat(String(v).replace(',', '.')); if (n > 0 && n < 500) enveloppeStyle('font-size', n + 'pt'); }
function policeNom(v) { if (v) enveloppeStyle('font-family', `"${v}"`); }
function tailleCourante() {
  const r = plageCourante(feuille); if (!r) return D.taille;
  let n = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
  if (!n || !feuille.contains(n)) return D.taille;
  return Math.round(parseFloat(getComputedStyle(n).fontSize) * 0.75 * 2) / 2;
}
function changerTaille(sens) { const t = tailleCourante(); const i = TAILLES.findIndex(x => x >= t); const nv = sens > 0 ? (TAILLES[TAILLES.indexOf(t) + 1] || TAILLES[i] || t + 2) : (TAILLES[Math.max(0, (TAILLES.indexOf(t) >= 0 ? TAILLES.indexOf(t) : i) - 1)] || t - 1); taillePolice(nv); }

function appliquerAuxBlocs(f) {
  restaurer(); avant();
  const bs = blocsSelection(feuille);
  if (!bs.length) { document.execCommand('formatBlock', false, 'p'); bs.push(...blocsSelection(feuille)); }
  bs.forEach(f); apres();
}
function interligne(v) { appliquerAuxBlocs(b => { b.style.lineHeight = v; }); }
function espacement(type, v) { appliquerAuxBlocs(b => { b.style[type === 'avant' ? 'marginTop' : 'marginBottom'] = v; }); }
function retrait(sens) {
  const r = plageCourante(feuille); if (!r) return;
  const dansListe = blocDe(r.startContainer, feuille)?.closest('li');
  if (dansListe) return cmd(sens > 0 ? 'indent' : 'outdent');
  appliquerAuxBlocs(b => { const v = Math.max(0, (parseFloat(b.style.marginLeft) || 0) + sens * 0.635 * CM); b.style.marginLeft = v ? v.toFixed(1) + 'px' : ''; });
}
function trame(c) { appliquerAuxBlocs(b => { b.style.backgroundColor = c === 'transparent' ? '' : c; }); }

function appliquerStyle(st) {
  restaurer(); avant();
  const map = { normal: 'p', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', citation: 'blockquote', code: 'pre', titre: 'p', 'sous-titre': 'p' };
  document.execCommand('formatBlock', false, map[st] || 'p');
  blocsSelection(feuille).forEach(b => {
    b.classList.remove('st-titre', 'st-sous-titre');
    if (st === 'titre') b.classList.add('st-titre');
    if (st === 'sous-titre') b.classList.add('st-sous-titre');
    if (!b.className) b.removeAttribute('class');
  });
  apres();
}
function styleCourant() {
  const r = plageCourante(feuille); if (!r) return 'normal';
  const b = blocDe(r.startContainer, feuille); if (!b) return 'normal';
  if (b.classList.contains('st-titre')) return 'titre';
  if (b.classList.contains('st-sous-titre')) return 'sous-titre';
  return { H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', BLOCKQUOTE: 'citation', PRE: 'code' }[b.tagName] || 'normal';
}
function changerCasse(mode) {
  restaurer(); const r = plageCourante(feuille); if (!r || r.collapsed) return toast('Sélectionnez le texte à modifier.');
  avant();
  const w = document.createTreeWalker(r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  const noeuds = []; let n; while ((n = w.nextNode())) if (r.intersectsNode(n)) noeuds.push(n);
  let debutPhrase = true;
  noeuds.forEach(t => {
    const d = t === r.startContainer ? r.startOffset : 0, f = t === r.endContainer ? r.endOffset : t.length;
    let s = t.nodeValue.slice(d, f);
    if (mode === 'maj') s = s.toLocaleUpperCase('fr');
    else if (mode === 'min') s = s.toLocaleLowerCase('fr');
    else if (mode === 'mots') s = s.toLocaleLowerCase('fr').replace(/(^|[\s\-'’(])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('fr'));
    else if (mode === 'phrase') s = s.toLocaleLowerCase('fr').replace(/(\p{L})/gu, (c) => { if (debutPhrase) { debutPhrase = false; return c.toLocaleUpperCase('fr'); } return c; }).replace(/([.!?]\s+)(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('fr'));
    t.nodeValue = t.nodeValue.slice(0, d) + s + t.nodeValue.slice(f);
  });
  apres();
}
function effacerMiseEnForme() {
  restaurer(); avant(); document.execCommand('removeFormat'); document.execCommand('unlink');
  blocsSelection(feuille).forEach(b => { b.removeAttribute('style'); });
  apres();
}
// Reproduire la mise en forme
function capturerFormat() {
  const r = plageCourante(feuille); if (!r) return null;
  let n = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
  const cs = getComputedStyle(n);
  return { gras: document.queryCommandState('bold'), italique: document.queryCommandState('italic'), souligne: document.queryCommandState('underline'), barre: document.queryCommandState('strikeThrough'), couleur: cs.color, fond: (() => { let k = n; while (k && k !== feuille) { const b = getComputedStyle(k).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b; k = k.parentElement; } return null; })(), taille: parseFloat(cs.fontSize) * 0.75, police: cs.fontFamily };
}
function appliquerFormat(f) {
  const r = plageCourante(feuille); if (!r || r.collapsed) return;
  avant();
  document.execCommand('removeFormat');
  document.execCommand('styleWithCSS', false, true);
  if (f.gras) document.execCommand('bold'); if (f.italique) document.execCommand('italic');
  if (f.souligne) document.execCommand('underline'); if (f.barre) document.execCommand('strikeThrough');
  document.execCommand('foreColor', false, f.couleur);
  if (f.fond) document.execCommand('hiliteColor', false, f.fond);
  apres();
  const sel = sauverSelection(feuille);
  enveloppeStyle('font-size', Math.round(f.taille * 2) / 2 + 'pt'); restaurerSelection(feuille, sel);
  enveloppeStyle('font-family', f.police);
}
feuille.addEventListener('mouseup', () => {
  if (V.peintre) { const f = V.peintre; V.peintre = null; ruban.actif('reproduire', false); feuille.style.cursor = ''; setTimeout(() => appliquerFormat(f), 0); }
});

// ---------- Listes ----------
function liste(type, style) {
  restaurer();
  const r = plageCourante(feuille); const b = r && blocDe(r.startContainer, feuille);
  const existante = b?.closest('ul,ol');
  avant();
  if (existante && existante.tagName === (type === 'ul' ? 'UL' : 'OL') && !style) document.execCommand(type === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
  else if (existante && style) { /* changer seulement le style */ }
  else document.execCommand(type === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
  const r2 = plageCourante(feuille); const l = r2 && blocDe(r2.startContainer, feuille)?.closest('ul,ol');
  if (l && style) { l.style.listStyleType = style; }
  apres();
}

// ---------- Insertion ----------
function insererHTML(html) { restaurer(); avant(); document.execCommand('insertHTML', false, html); apres(); }
function insererTableau(lignes, colonnes) {
  const td = '<td><br></td>'.repeat(colonnes);
  const ent = `<tr>${'<th style="background-color:#E7ECF5"><br></th>'.repeat(colonnes)}</tr>`;
  insererHTML(`<table class="tab"><tbody>${ent}${`<tr>${td}</tr>`.repeat(Math.max(0, lignes - 1))}</tbody></table><p><br></p>`);
}
function menuTableau(ancre) {
  const g = el('<div><div class="grille-tableau"></div><div class="info-grille">Insérer un tableau</div></div>');
  const grille = $('.grille-tableau', g), info = $('.info-grille', g);
  for (let i = 0; i < 80; i++) grille.appendChild(el(`<span data-l="${Math.floor(i / 10) + 1}" data-c="${i % 10 + 1}"></span>`));
  grille.onmouseover = e => { const s = e.target.closest('span'); if (!s) return; const l = +s.dataset.l, c = +s.dataset.c; $$('span', grille).forEach(k => k.classList.toggle('on', +k.dataset.l <= l && +k.dataset.c <= c)); info.textContent = `Tableau de ${c} × ${l}`; };
  grille.onclick = e => { const s = e.target.closest('span'); if (!s) return; import('./commun/ui.js').then(u => u.fermerMenu()); insererTableau(+s.dataset.l, +s.dataset.c); };
  menu([{ element: g }, '-', { label: 'Insérer un tableau…', ico: 'table', faire: async () => {
    const r = await dialogue({ titre: 'Insérer un tableau', contenu: `<div class="grille-champs"><label class="champ">Nombre de colonnes<input type="number" name="c" value="3" min="1" max="30"></label><label class="champ">Nombre de lignes<input type="number" name="l" value="3" min="1" max="500"></label></div>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Insérer', valeur: true, primaire: true }] });
    if (r) insererTableau(Math.max(1, +r.l || 1), Math.max(1, Math.min(30, +r.c || 1)));
  } }], 0, 0, ancre);
}
async function insererImage() {
  const f = await F.ouvrirFichier({ titre: 'Insérer une image', filtres: [{ nom: 'Images', ext: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] }] });
  if (!f) return;
  const url = await versDataURL(f.octets, f.nom);
  const img = await chargerImage(url);
  const max = D.page.largeur - D.page.marges.gauche - D.page.marges.droite;
  const l = Math.min(img.naturalWidth, max);
  insererHTML(`<img src="${url}" alt="${esc(nomSansExtension(f.nom))}" style="width:${Math.round(l)}px">`);
}
function versDataURL(octets, nom) {
  const ext = (nom.split('.').pop() || 'png').toLowerCase();
  const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'image/png';
  return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(new Blob([octets], { type })); });
}
const chargerImage = url => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
async function lien() {
  restaurer();
  const r0 = plageCourante(feuille);
  const a0 = r0 && (r0.startContainer.nodeType === 3 ? r0.startContainer.parentElement : r0.startContainer).closest('a');
  const texte = a0 ? a0.textContent : (r0 ? r0.toString() : '');
  const sel = sauverSelection(feuille);
  const r = await dialogue({ titre: a0 ? 'Modifier le lien' : 'Insérer un lien', contenu: `<label class="champ">Texte à afficher<input type="text" name="texte" value="${esc(texte)}"></label><label class="champ">Adresse<input type="text" name="url" value="${esc(a0?.getAttribute('href') || 'https://')}"></label>`, boutons: [a0 ? { label: 'Supprimer le lien', valeur: 'suppr', gauche: true } : null, { label: 'Annuler', valeur: null }, { label: 'OK', valeur: 'ok', primaire: true }].filter(Boolean) });
  if (!r) return;
  feuille.focus(); restaurerSelection(feuille, sel); avant();
  if (r.valeur === 'suppr') { const rr = document.createRange(); rr.selectNodeContents(a0); getSelection().removeAllRanges(); getSelection().addRange(rr); document.execCommand('unlink'); apres(); return; }
  let url = r.url.trim(); if (!url || url === 'https://') return;
  if (!/^(https?:|mailto:|#)/i.test(url)) url = (url.includes('@') ? 'mailto:' : 'https://') + url;
  if (a0) { a0.setAttribute('href', url); a0.textContent = r.texte || url; }
  else if (!plageCourante(feuille)?.collapsed && plageCourante(feuille).toString() === (r.texte || url)) document.execCommand('createLink', false, url);
  else document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(r.texte || url)}</a>`);
  apres();
}
feuille.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); const h = a.getAttribute('href'); if (h.startsWith('#')) document.getElementById(h.slice(1))?.scrollIntoView({ block: 'center' }); else F.ouvrirLien(h); }
  const ent = e.target.closest('.entree-sommaire');
  if (ent) { const c = document.getElementById(ent.dataset.cible); if (c) { c.scrollIntoView({ block: 'start', behavior: 'smooth' }); placerCurseur(c); } }
  const img = e.target.closest('img');
  selectionnerImage(img && feuille.contains(img) ? img : null);
});
function placerCurseur(n, fin = false) { const r = document.createRange(); r.selectNodeContents(n); r.collapse(!fin); const s = getSelection(); s.removeAllRanges(); s.addRange(r); feuille.focus({ preventScroll: true }); }

const CARACTERES = '« » “ ” ‘ ’ — – … € £ $ ¥ © ® ™ § ¶ ° ± × ÷ ≤ ≥ ≠ ≈ ∞ √ ∑ π µ ½ ¼ ¾ ² ³ ¹ → ← ↑ ↓ ↔ ⇒ ✓ ✗ • · ◦ ▪ ★ ☐ ☑ œ Œ æ Æ ç Ç É È Ê Ë À Â Î Ï Ô Ù Û Ü Ÿ ß ñ Ñ α β γ δ Δ Ω'.split(' ');
function menuCaracteres(ancre) {
  const g = el('<div class="grille-car"></div>');
  CARACTERES.forEach(c => { const b = el(`<button title="${c}">${c}</button>`); b.onclick = () => { import('./commun/ui.js').then(u => u.fermerMenu()); insererTexte(c); }; g.appendChild(b); });
  menu([{ element: g }, '-', { label: 'Espace insécable (Ctrl+Maj+Espace)', faire: () => insererTexte(' ') }, { label: 'Tiret insécable', faire: () => insererTexte('‑') }], 0, 0, ancre);
}
function insererTexte(t) { restaurer(); avant(); document.execCommand('insertText', false, t); apres(); }
function insererDate(ancre) {
  const d = new Date();
  const formats = [d.toLocaleDateString('fr-FR'), d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }), d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })];
  menu(formats.map(f => ({ label: f, faire: () => insererTexte(f) })), 0, 0, ancre);
}
function sautDePage() { insererHTML('<hr class="saut-page" contenteditable="false"><p><br></p>'); }

// ---------- Table des matières ----------
function titres() { return $$('h1,h2,h3', feuille).filter(h => !h.closest('.sommaire') && h.textContent.trim()); }
function assurerIds() { titres().forEach((h, i) => { if (!h.id) h.id = 'titre-' + Math.random().toString(36).slice(2, 8); }); }
function contenuSommaire(s) {
  const t = titres();
  const titre = s.querySelector('.titre-sommaire')?.textContent || 'Sommaire';
  return `<p class="titre-sommaire">${esc(titre)}</p>` + (t.length ? t.map(h => `<div class="entree-sommaire" data-niveau="${h.tagName[1]}" data-cible="${h.id}"><span class="lib">${esc(h.textContent.trim())}</span><span class="points"></span><span class="num">${V.mode === 'page' ? V.pageDe(h) + 1 : ''}</span></div>`).join('') : '<p style="color:#888;font-style:italic">Ajoutez des titres (Titre 1, 2 ou 3) pour remplir le sommaire.</p>');
}
function majSommaire(marquer = true) {
  const s = $$('.sommaire', feuille); if (!s.length) return;
  assurerIds();
  s.forEach(x => { const h = contenuSommaire(x); if (x.innerHTML !== h) { x.innerHTML = h; if (marquer) doc.marquerModifie(); } });
}
function insererSommaire() {
  assurerIds();
  insererHTML(`<div class="sommaire" contenteditable="false"><p class="titre-sommaire">Sommaire</p></div><p><br></p>`);
  majSommaire(); planifierPagination();
}

// ---------- Volet de navigation ----------
function majNavigation() {
  if (!V.nav) return;
  const t = titres(); const z = $('#liste-nav');
  z.innerHTML = t.length ? '' : '<div class="vide">Les titres de votre document apparaîtront ici. Appliquez un style Titre 1, 2 ou 3.</div>';
  t.forEach(h => { const b = el(`<button data-n="${h.tagName[1]}" title="${esc(h.textContent)}">${esc(h.textContent)}</button>`); b.onclick = () => { h.scrollIntoView({ block: 'start', behavior: 'smooth' }); placerCurseur(h); }; z.appendChild(b); });
}
const majNavigationDiff = debounce(majNavigation, 400);

// ---------- Tableaux ----------
function celluleCourante() { const r = plageCourante(feuille); if (!r) return null; const n = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer; return n?.closest?.('td,th'); }
function grille(table) {
  // matrice des cellules en tenant compte des fusions
  const m = [];
  [...table.rows].forEach((r, ri) => {
    m[ri] = m[ri] || []; let c = 0;
    [...r.cells].forEach(td => {
      while (m[ri][c]) c++;
      for (let i = 0; i < (td.rowSpan || 1); i++) for (let j = 0; j < (td.colSpan || 1); j++) { m[ri + i] = m[ri + i] || []; m[ri + i][c + j] = td; }
      c += td.colSpan || 1;
    });
  });
  return m;
}
function posCellule(td) { const m = grille(td.closest('table')); for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) if (m[r][c] === td) return { r, c, m }; return null; }
const opTableau = {
  ligneDessus: () => ajouterLigne(false), ligneDessous: () => ajouterLigne(true),
  colGauche: () => ajouterColonne(false), colDroite: () => ajouterColonne(true),
  supprLigne() { const td = celluleCourante(); if (!td) return; avant(); const tr = td.parentElement; const t = tr.closest('table'); tr.remove(); if (!t.rows.length) t.remove(); apres(); },
  supprCol() { const td = celluleCourante(); if (!td) return; avant(); const p = posCellule(td); const t = td.closest('table'); const vus = new Set(); p.m.forEach(l => { const c = l[p.c]; if (c && !vus.has(c)) { vus.add(c); if ((c.colSpan || 1) > 1) c.colSpan--; else c.remove(); } }); if (!t.querySelector('td,th')) t.remove(); apres(); },
  supprTableau() { const td = celluleCourante(); if (!td) return; avant(); const t = td.closest('table'); const p = document.createElement('p'); p.innerHTML = '<br>'; t.replaceWith(p); placerCurseur(p); apres(); },
  fusionDroite() { const td = celluleCourante(); if (!td) return; const p = posCellule(td); const v = p.m[p.r][p.c + (td.colSpan || 1)]; if (!v || v.rowSpan !== td.rowSpan) return toast('Aucune cellule compatible à droite.'); avant(); if (v.textContent.trim()) td.innerHTML += ' ' + v.innerHTML; td.colSpan = (td.colSpan || 1) + (v.colSpan || 1); v.remove(); apres(); },
  fusionBas() { const td = celluleCourante(); if (!td) return; const p = posCellule(td); const l = p.m[p.r + (td.rowSpan || 1)]; const v = l && l[p.c]; if (!v || v.colSpan !== td.colSpan) return toast('Aucune cellule compatible en dessous.'); avant(); if (v.textContent.trim()) td.innerHTML += '<br>' + v.innerHTML; td.rowSpan = (td.rowSpan || 1) + (v.rowSpan || 1); v.remove(); apres(); },
  scinder() { const td = celluleCourante(); if (!td || ((td.colSpan || 1) === 1 && (td.rowSpan || 1) === 1)) return toast('Cette cellule n\'est pas fusionnée.'); avant(); const p = posCellule(td); const cs = td.colSpan || 1, rs = td.rowSpan || 1; td.colSpan = 1; td.rowSpan = 1;
    for (let i = 0; i < rs; i++) { const tr = td.closest('table').rows[p.r + i]; for (let j = (i === 0 ? 1 : 0); j < cs; j++) { const n = document.createElement(td.tagName); n.innerHTML = '<br>'; const ref = [...tr.cells].find(c => { const q = posCellule(c); return q && q.c > p.c + j - (i === 0 ? 0 : 1) && c !== td; }); if (i === 0) td.after(n); else if (ref) ref.before(n); else tr.appendChild(n); } } apres(); },
  fond(c) { const td = celluleCourante(); if (!td) return; avant(); td.style.backgroundColor = c === 'transparent' ? '' : c; apres(); },
  bordures() { const td = celluleCourante(); if (!td) return; avant(); td.closest('table').classList.toggle('sans-bordure'); apres(); },
  entete() { const td = celluleCourante(); if (!td) return; avant(); const tr = td.closest('table').rows[0]; [...tr.cells].forEach(c => { const n = document.createElement(c.tagName === 'TH' ? 'td' : 'th'); n.innerHTML = c.innerHTML; for (const a of c.attributes) n.setAttribute(a.name, a.value); if (n.tagName === 'TH' && !n.style.backgroundColor) n.style.backgroundColor = '#E7ECF5'; if (n.tagName === 'TD') n.style.backgroundColor = ''; c.replaceWith(n); }); apres(); },
  alignV(v) { const td = celluleCourante(); if (!td) return; avant(); td.style.verticalAlign = v; apres(); },
  largeurAuto() { const td = celluleCourante(); if (!td) return; avant(); const t = td.closest('table'); t.style.tableLayout = t.style.tableLayout === 'auto' ? '' : 'auto'; apres(); },
};
function ajouterLigne(dessous) {
  const td = celluleCourante(); if (!td) return; avant();
  const tr = td.parentElement; const p = posCellule(td); const n = document.createElement('tr');
  const nb = p.m[0].length;
  for (let c = 0; c < nb; c++) { const x = document.createElement('td'); x.innerHTML = '<br>'; n.appendChild(x); }
  if (dessous) tr.after(n); else tr.before(n);
  placerCurseur(n.cells[Math.min(p.c, n.cells.length - 1)]); apres();
}
function ajouterColonne(droite) {
  const td = celluleCourante(); if (!td) return; avant();
  const p = posCellule(td); const t = td.closest('table'); const vus = new Set();
  const col = p.c + (droite ? (td.colSpan || 1) - 1 : 0);
  [...t.rows].forEach((tr, ri) => {
    const c = p.m[ri][col]; if (!c || vus.has(c)) { return; } vus.add(c);
    const n = document.createElement(c.tagName); n.innerHTML = '<br>'; if (c.tagName === 'TH') n.style.backgroundColor = c.style.backgroundColor;
    if ((c.rowSpan || 1) > 1) n.rowSpan = c.rowSpan;
    if (droite) c.after(n); else c.before(n);
  });
  apres();
}
// Tabulation dans les tableaux
feuille.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const td = celluleCourante();
  if (td) {
    e.preventDefault();
    const cells = [...td.closest('table').querySelectorAll('td,th')];
    const i = cells.indexOf(td);
    if (e.shiftKey) { if (i > 0) placerCurseur(cells[i - 1], true); }
    else if (i < cells.length - 1) placerCurseur(cells[i + 1], true);
    else { ajouterLigne(true); const t = td.closest('table'); placerCurseur(t.rows[td.parentElement.rowIndex + 1].cells[0]); }
    return;
  }
  e.preventDefault();
  const r = plageCourante(feuille); const li = r && blocDe(r.startContainer, feuille)?.closest('li');
  if (li) { avant(); document.execCommand(e.shiftKey ? 'outdent' : 'indent'); apres(); }
  else insererTexte('    ');
});

// ---------- Images ----------
function selectionnerImage(img) {
  $$('img.img-sel', feuille).forEach(i => i.classList.remove('img-sel'));
  V.imageSel = img;
  if (img) img.classList.add('img-sel');
  ruban.contextuel('image', !!img);
  if (img) ruban.afficher('image');
  placerPoignees();
}
function placerPoignees() {
  const p = $('#poignees-image');
  if (!V.imageSel || !feuille.contains(V.imageSel)) { p.classList.add('masque'); return; }
  const r = V.imageSel.getBoundingClientRect();
  Object.assign(p.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  p.classList.remove('masque');
}
$('#poignees-image').addEventListener('mousedown', e => {
  const coin = e.target.dataset.p; if (!coin || !V.imageSel) return;
  e.preventDefault(); avant();
  const img = V.imageSel, x0 = e.clientX, l0 = img.getBoundingClientRect().width / V.zoom;
  const max = D.page.largeur - D.page.marges.gauche - D.page.marges.droite;
  const bouger = ev => { const dx = (ev.clientX - x0) / V.zoom * (coin.includes('w') ? -1 : 1); img.style.width = Math.round(Math.min(max, Math.max(16, l0 + dx))) + 'px'; img.style.height = 'auto'; img.removeAttribute('width'); img.removeAttribute('height'); placerPoignees(); };
  const fin = () => { removeEventListener('mousemove', bouger); removeEventListener('mouseup', fin); apres(); };
  addEventListener('mousemove', bouger); addEventListener('mouseup', fin);
});
const opImage = {
  habillage(mode) { const i = V.imageSel; if (!i) return; avant(); i.classList.remove('img-gauche', 'img-droite', 'img-centre'); if (mode) i.classList.add(mode); if (!i.className.replace('img-sel', '').trim()) i.classList.remove(); apres(); placerPoignees(); },
  async largeur() { const i = V.imageSel; if (!i) return; const v = await demander('Taille de l\'image', 'Largeur en pixels', Math.round(i.getBoundingClientRect().width / V.zoom), 'number'); if (v && +v > 0) { avant(); i.style.width = Math.round(+v) + 'px'; apres(); placerPoignees(); } },
  origine() { const i = V.imageSel; if (!i) return; avant(); const max = D.page.largeur - D.page.marges.gauche - D.page.marges.droite; i.style.width = Math.min(i.naturalWidth, max) + 'px'; apres(); placerPoignees(); },
  async alt() { const i = V.imageSel; if (!i) return; const v = await demander('Texte de remplacement', 'Décrivez l\'image pour les personnes qui ne la voient pas', i.alt || ''); if (v != null) { avant(); i.alt = v; apres(); } },
  supprimer() { const i = V.imageSel; if (!i) return; avant(); i.remove(); selectionnerImage(null); apres(); },
  legende() { const i = V.imageSel; if (!i) return; avant(); const n = $$('.legende', feuille).length + 1; const p = el(`<p class="legende" style="text-align:center;font-style:italic;font-size:9pt;color:#44546A">Figure ${n} : légende</p>`); (i.closest('p') || i).after(p); selectionnerImage(null); placerCurseur(p, true); apres(); },
};
feuille.addEventListener('keydown', e => { if (V.imageSel && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); opImage.supprimer(); } });

// ---------- Commentaires ----------
async function nouveauCommentaire() {
  restaurer(); const r = plageCourante(feuille);
  if (!r || r.collapsed) return toast('Sélectionnez le texte à commenter.');
  const sel = sauverSelection(feuille);
  const res = await dialogue({ titre: 'Nouveau commentaire', contenu: `<label class="champ">Commentaire<textarea name="texte" rows="4"></textarea></label>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Ajouter', valeur: true, primaire: true }] });
  if (!res || !res.texte.trim()) return;
  feuille.focus(); restaurerSelection(feuille, sel);
  const rr = plageCourante(feuille); if (!rr) return;
  avant();
  const id = 'c' + Date.now().toString(36);
  // limiter au bloc de départ
  const b = blocDe(rr.startContainer, feuille);
  if (b && !b.contains(rr.endContainer)) rr.setEnd(b, b.childNodes.length);
  const span = document.createElement('span'); span.className = 'commentaire'; span.dataset.com = id;
  span.appendChild(rr.extractContents()); rr.insertNode(span);
  D.commentaires.push({ id, auteur: utilisateur(), date: new Date().toISOString(), texte: res.texte.trim(), resolu: false });
  apres(); afficherPanneau('panneau-com', true); majPanneauCom();
}
function supprimerCommentaire(id) {
  avant();
  $$(`.commentaire[data-com="${id}"]`, feuille).forEach(s => s.replaceWith(...s.childNodes));
  D.commentaires = D.commentaires.filter(c => c.id !== id);
  apres(); majPanneauCom();
}
function majPanneauCom() {
  const p = $('#panneau-com');
  // nettoyer les commentaires dont l'ancre a disparu
  D.commentaires = D.commentaires.filter(c => feuille.querySelector(`.commentaire[data-com="${c.id}"]`));
  if (p.classList.contains('masque')) return;
  p.innerHTML = `<header><span>Commentaires</span><button class="btn discret icone" data-x aria-label="Fermer">${ico('x')}</button></header><div class="corps-p">${D.commentaires.length ? '' : '<p style="color:var(--encre-3)">Aucun commentaire. Sélectionnez du texte puis choisissez « Nouveau commentaire ».</p>'}</div>`;
  $('[data-x]', p).onclick = () => afficherPanneau('panneau-com', false);
  const z = $('.corps-p', p);
  D.commentaires.forEach(c => {
    const k = el(`<div class="carte-com ${c.resolu ? 'resolu' : ''}" data-id="${c.id}"><div><span class="auteur">${esc(c.auteur)}</span> <span class="date">${esc(new Date(c.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))}</span></div><div class="texte-com">${esc(c.texte)}</div><div class="actions"><button class="btn" data-a="resoudre">${c.resolu ? 'Rouvrir' : 'Résoudre'}</button><button class="btn" data-a="suppr">Supprimer</button></div></div>`);
    k.onclick = e => {
      const a = e.target.closest('[data-a]');
      if (a?.dataset.a === 'suppr') return supprimerCommentaire(c.id);
      if (a?.dataset.a === 'resoudre') { avant(); c.resolu = !c.resolu; apres(); majPanneauCom(); return; }
      const s = feuille.querySelector(`.commentaire[data-com="${c.id}"]`);
      if (s) { s.scrollIntoView({ block: 'center', behavior: 'smooth' }); $$('.commentaire.actif', feuille).forEach(x => x.classList.remove('actif')); s.classList.add('actif'); $$('.carte-com', z).forEach(x => x.classList.toggle('actif', x === k)); }
    };
    z.appendChild(k);
  });
}

// ---------- Rechercher et remplacer ----------
const R = { res: [], i: -1 };
function ouvrirRecherche(remplacer = false) {
  const p = $('#panneau-rech');
  afficherPanneau('panneau-rech', true);
  if (!p.dataset.pret) {
    p.dataset.pret = 1;
    p.innerHTML = `<header><span>Rechercher et remplacer</span><button class="btn discret icone" data-x aria-label="Fermer">${ico('x')}</button></header>
    <div class="corps-p"><label class="champ">Rechercher<input type="search" name="q" id="rech-q"></label>
    <label class="case"><input type="checkbox" id="rech-casse"> Respecter la casse</label><label class="case"><input type="checkbox" id="rech-mot"> Mot entier</label>
    <div class="ligne-r" style="gap:6px"><button class="btn" id="rech-prec" title="Précédent (Maj+Entrée)">${ico('chevron-up', 'p')}</button><button class="btn" id="rech-suiv" title="Suivant (Entrée)">${ico('chevron-down', 'p')}</button><span class="resultats-rech" id="rech-res"></span></div>
    <label class="champ">Remplacer par<input type="text" id="rech-r"></label>
    <div class="ligne-r" style="gap:6px"><button class="btn" id="rech-remp">Remplacer</button><button class="btn" id="rech-tout">Tout remplacer</button></div></div>`;
    $('[data-x]', p).onclick = () => { afficherPanneau('panneau-rech', false); CSS.highlights?.clear(); };
    const relancer = () => lancerRecherche();
    $('#rech-q').oninput = relancer; $('#rech-casse').onchange = relancer; $('#rech-mot').onchange = relancer;
    $('#rech-q').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); allerResultat(e.shiftKey ? -1 : 1); } };
    $('#rech-suiv').onclick = () => allerResultat(1); $('#rech-prec').onclick = () => allerResultat(-1);
    $('#rech-remp').onclick = remplacerCourant; $('#rech-tout').onclick = remplacerTout;
  }
  const r = plageCourante(feuille);
  if (r && !r.collapsed && r.toString().length < 80) $('#rech-q').value = r.toString();
  (remplacer ? $('#rech-r') : $('#rech-q')).focus(); $('#rech-q').select();
  lancerRecherche();
}
function lancerRecherche() {
  R.res = chercher(feuille, $('#rech-q').value, { casse: $('#rech-casse').checked, motEntier: $('#rech-mot').checked });
  R.i = R.res.length ? 0 : -1;
  surligner();
}
function surligner() {
  if (!window.CSS?.highlights) return;
  CSS.highlights.clear();
  if (R.res.length) CSS.highlights.set('recherche', new Highlight(...R.res));
  if (R.i >= 0) { CSS.highlights.set('recherche-courante', new Highlight(R.res[R.i])); const n = R.res[R.i].startContainer.parentElement; n?.scrollIntoView({ block: 'center' }); }
  $('#rech-res').textContent = $('#rech-q').value ? (R.res.length ? `${R.i + 1} sur ${R.res.length}` : 'Aucun résultat') : '';
}
function allerResultat(s) { if (!R.res.length) return; R.i = (R.i + s + R.res.length) % R.res.length; surligner(); }
function remplacerCourant() {
  if (R.i < 0) return; avant();
  const r = R.res[R.i]; r.deleteContents(); r.insertNode(document.createTextNode($('#rech-r').value));
  feuille.normalize(); apres(); lancerRecherche();
}
function remplacerTout() {
  if (!R.res.length) return; avant();
  const n = R.res.length;
  for (let i = R.res.length - 1; i >= 0; i--) { const r = R.res[i]; r.deleteContents(); r.insertNode(document.createTextNode($('#rech-r').value)); }
  feuille.normalize(); apres(); lancerRecherche(); toast(`${n} remplacement${n > 1 ? 's' : ''} effectué${n > 1 ? 's' : ''}.`, 'succes');
}
function afficherPanneau(id, v) { $('#' + id).classList.toggle('masque', !v); if (id === 'panneau-com' && v) majPanneauCom(); ajusterEchelle(); }

// ---------- Mise en page ----------
function definirFormat(f) { avant(); const [l, h] = FORMATS_PAGE[f]; D.page.format = f; D.page.largeur = (D.page.paysage ? h : l) * MM; D.page.hauteur = (D.page.paysage ? l : h) * MM; appliquerReglages(); doc.marquerModifie(); }
function orientation(paysage) { if (D.page.paysage === paysage) return; avant(); D.page.paysage = paysage; const { largeur, hauteur } = D.page; D.page.largeur = hauteur; D.page.hauteur = largeur; appliquerReglages(); doc.marquerModifie(); }
function definirMarges(m) { avant(); const [h, b, g, d] = m; D.page.marges = { haut: h * CM, bas: b * CM, gauche: g * CM, droite: d * CM }; appliquerReglages(); doc.marquerModifie(); }
async function margesPerso() {
  const m = D.page.marges, v = x => (x / CM).toFixed(2).replace('.', ',');
  const r = await dialogue({ titre: 'Marges personnalisées', contenu: `<div class="grille-champs"><label class="champ">Haut (cm)<input type="text" name="h" value="${v(m.haut)}"></label><label class="champ">Bas (cm)<input type="text" name="b" value="${v(m.bas)}"></label><label class="champ">Gauche (cm)<input type="text" name="g" value="${v(m.gauche)}"></label><label class="champ">Droite (cm)<input type="text" name="d" value="${v(m.droite)}"></label></div>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'OK', valeur: true, primaire: true }],
    valider: d => ['h', 'b', 'g', 'd'].some(k => !(parseFloat(d[k].replace(',', '.')) >= 0)) ? 'Indiquez des marges valides en centimètres.' : null });
  if (r) definirMarges(['h', 'b', 'g', 'd'].map(k => parseFloat(r[k].replace(',', '.'))));
}
async function filigrane(ancre) {
  const def = async v => { avant(); D.filigrane = v; appliquerReglages(); doc.marquerModifie(); };
  menu([{ label: 'Aucun', coche: !D.filigrane, faire: () => def('') }, ...['CONFIDENTIEL', 'BROUILLON', 'NE PAS DIFFUSER', 'COPIE', 'URGENT'].map(t => ({ label: t, coche: D.filigrane === t, faire: () => def(t) })), '-', { label: 'Filigrane personnalisé…', faire: async () => { const v = await demander('Filigrane', 'Texte du filigrane', D.filigrane); if (v != null) def(v.trim()); } }], 0, 0, ancre);
}
async function dialogueEnteteDifferent(type) {
  const z = D[type]; const nom = type === 'entete' ? 'En-tête' : 'Pied de page';
  const r = await dialogue({ titre: nom, taille: 'large', contenu: `<p>Utilisez <b>{page}</b> pour le numéro de page, <b>{pages}</b> pour le nombre de pages, <b>{date}</b> et <b>{titre}</b>.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px"><label class="champ">À gauche<input type="text" name="gauche" value="${esc(z.gauche)}"></label><label class="champ">Au centre<input type="text" name="centre" value="${esc(z.centre)}"></label><label class="champ">À droite<input type="text" name="droite" value="${esc(z.droite)}"></label></div>
    <label class="case"><input type="checkbox" name="premiere" ${D.premierePageDifferente ? 'checked' : ''}> Première page différente (sans en-tête ni pied de page)</label>`,
    boutons: [{ label: 'Supprimer', valeur: 'suppr', gauche: true }, { label: 'Annuler', valeur: null }, { label: 'OK', valeur: 'ok', primaire: true }] });
  if (!r) return;
  avant();
  D[type] = r.valeur === 'suppr' ? { gauche: '', centre: '', droite: '' } : { gauche: r.gauche, centre: r.centre, droite: r.droite };
  D.premierePageDifferente = r.premiere;
  appliquerReglages(); doc.marquerModifie();
}
function numeroPage(ancre) {
  const def = (type, pos, texte) => { avant(); D[type] = { gauche: '', centre: '', droite: '', ...D[type], [pos]: texte }; appliquerReglages(); doc.marquerModifie(); };
  menu([{ titre: 'Bas de page' }, { label: 'Centré : 1', faire: () => def('pied', 'centre', '{page}') }, { label: 'À droite : Page 1 sur 3', faire: () => def('pied', 'droite', 'Page {page} sur {pages}') }, { label: 'À droite : 1 / 3', faire: () => def('pied', 'droite', '{page} / {pages}') }, { titre: 'Haut de page' }, { label: 'À droite : 1', faire: () => def('entete', 'droite', '{page}') }, '-', { label: 'Supprimer les numéros de page', faire: () => { avant(); for (const t of ['entete', 'pied']) for (const k of ['gauche', 'centre', 'droite']) D[t][k] = D[t][k].replace(/Page \{page\} sur \{pages\}|\{page\} \/ \{pages\}|\{page\}/g, '').trim(); appliquerReglages(); doc.marquerModifie(); } }], 0, 0, ancre);
}
async function stylesDocument() {
  const r = await dialogue({ titre: 'Police et couleurs du document', contenu: `<div class="grille-champs"><label class="champ">Police par défaut<select name="police">${POLICES.map(p => `<option ${p === D.police ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label><label class="champ">Taille (pt)<input type="number" name="taille" value="${D.taille}" min="6" max="72" step="0.5"></label><label class="champ">Couleur des titres<input type="color" name="couleur" value="#${D.couleurTitres}" style="height:30px;padding:2px"></label></div>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'OK', valeur: true, primaire: true }] });
  if (!r) return; avant(); D.police = r.police; D.taille = +r.taille || 11; D.couleurTitres = r.couleur.replace('#', '').toUpperCase(); appliquerReglages(); doc.marquerModifie();
}

// ---------- Statistiques ----------
function majEtat() {
  const s = statistiques(feuille);
  const r = plageCourante(feuille);
  let page = 1;
  if (r && V.mode === 'page') { const b = blocDe(r.startContainer, feuille); if (b) page = V.pageDe(b) + 1; }
  $('#etat-page').textContent = V.mode === 'page' ? `Page ${page} sur ${V.pages}` : 'Vue continue';
  const sel = r && !r.collapsed ? (r.toString().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length : null;
  $('#etat-mots').textContent = sel != null ? `${sel} sur ${s.mots} mots` : `${s.mots} mot${s.mots > 1 ? 's' : ''}`;
}
async function dialogueStats() {
  const s = statistiques(feuille);
  dialogue({ titre: 'Statistiques', contenu: `<table style="border-collapse:collapse">${[['Pages', V.pages], ['Mots', s.mots], ['Caractères (espaces non compris)', s.caracteresSansEspaces], ['Caractères (espaces compris)', s.caracteres], ['Paragraphes', s.paragraphes]].map(([k, v]) => `<tr><td style="padding:5px 30px 5px 0">${k}</td><td style="text-align:right;font-weight:700" data-stat="${k}">${v.toLocaleString('fr-FR')}</td></tr>`).join('')}</table>`, boutons: [{ label: 'Fermer', valeur: true, primaire: true }] });
}

// ---------- État du ruban ----------
const majInterface = debounce(() => {
  if (!plageCourante(feuille)) return;
  ruban.actif('gras', document.queryCommandState('bold'));
  ruban.actif('italique', document.queryCommandState('italic'));
  ruban.actif('souligne', document.queryCommandState('underline'));
  ruban.actif('barre', document.queryCommandState('strikeThrough'));
  ruban.actif('indice', document.queryCommandState('subscript'));
  ruban.actif('exposant', document.queryCommandState('superscript'));
  ruban.actif('puces', document.queryCommandState('insertUnorderedList'));
  ruban.actif('numeros', document.queryCommandState('insertOrderedList'));
  const r = plageCourante(feuille); const b = r && blocDe(r.startContainer, feuille);
  const al = b ? getComputedStyle(b).textAlign : 'left';
  ['gauche', 'centre', 'droite', 'justifie'].forEach(k => ruban.actif('al-' + k, ({ gauche: ['left', 'start'], centre: ['center'], droite: ['right', 'end'], justifie: ['justify'] })[k].includes(al)));
  const n = r && (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer);
  if (n && feuille.contains(n)) {
    const cs = getComputedStyle(n);
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    ruban.valeur('police', POLICES.includes(fam) ? fam : fam);
    ruban.valeur('taille', String(Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2).replace('.', ','));
  }
  const st = styleCourant(); $$('.galerie-styles button').forEach(x => x.classList.toggle('actif', x.dataset.style === st));
  const dansTableau = !!celluleCourante();
  ruban.contextuel('tableau', dansTableau);
  majEtat();
  majNavigationDiff();
}, 60);

// ---------- Ruban ----------
const ruban = creerRuban($('#zone-ruban'), [
  { id: 'accueil', titre: 'Accueil', groupes: [
    { titre: 'Presse-papiers', items: [
      { type: 'bouton', id: 'coller', ico: 'clipboard-paste', label: 'Coller', grand: true, raccourci: 'Ctrl+V' },
      { type: 'pile', items: [
        { type: 'bouton', id: 'couper', ico: 'scissors', label: 'Couper', avecLabel: true, raccourci: 'Ctrl+X' },
        { type: 'bouton', id: 'copier', ico: 'copy', label: 'Copier', avecLabel: true, raccourci: 'Ctrl+C' },
        { type: 'bouton', id: 'reproduire', ico: 'paintbrush', label: 'Reproduire', title: 'Reproduire la mise en forme', avecLabel: true },
      ] },
    ] },
    { titre: 'Police', items: [{ type: 'pile', items: [
      { type: 'ligne', items: [
        { type: 'select', id: 'police', title: 'Police', options: POLICES, largeur: 150 },
        { type: 'select', id: 'taille', title: 'Taille de police', options: TAILLES.map(t => String(t).replace('.', ',')), largeur: 58 },
        { type: 'bouton', id: 'agrandir', ico: 'a-arrow-up', title: 'Augmenter la taille de police', raccourci: 'Ctrl+Maj+>' },
        { type: 'bouton', id: 'reduire', ico: 'a-arrow-down', title: 'Diminuer la taille de police', raccourci: 'Ctrl+Maj+<' },
        { type: 'menu', id: 'casse', ico: 'case-sensitive', title: 'Modifier la casse', items: () => [{ label: 'Phrase commençant par une majuscule', faire: () => changerCasse('phrase') }, { label: 'minuscules', faire: () => changerCasse('min') }, { label: 'MAJUSCULES', faire: () => changerCasse('maj') }, { label: 'Chaque Mot En Majuscule', faire: () => changerCasse('mots') }] },
        { type: 'bouton', id: 'effacer-format', ico: 'remove-formatting', title: 'Effacer toute la mise en forme' },
      ] },
      { type: 'ligne', items: [
        { type: 'bascule', id: 'gras', ico: 'bold', title: 'Gras', raccourci: 'Ctrl+G' },
        { type: 'bascule', id: 'italique', ico: 'italic', title: 'Italique', raccourci: 'Ctrl+I' },
        { type: 'bascule', id: 'souligne', ico: 'underline', title: 'Souligné', raccourci: 'Ctrl+U' },
        { type: 'bascule', id: 'barre', ico: 'strikethrough', title: 'Barré' },
        { type: 'bascule', id: 'indice', ico: 'subscript', title: 'Indice', raccourci: 'Ctrl+=' },
        { type: 'bascule', id: 'exposant', ico: 'superscript', title: 'Exposant', raccourci: 'Ctrl+Maj+=' },
        { type: 'sep' },
        { type: 'couleur', id: 'surlignage', ico: 'highlighter', title: 'Couleur de surbrillance du texte', defaut: '#FFFF00', aucune: true, labelAucune: 'Aucune couleur', applicationDirecte: true },
        { type: 'couleur', id: 'couleur-texte', ico: 'baseline', title: 'Couleur de police', defaut: '#C00000', aucune: true, labelAucune: 'Automatique', applicationDirecte: true },
      ] },
    ] }] },
    { titre: 'Paragraphe', items: [{ type: 'pile', items: [
      { type: 'ligne', items: [
        { type: 'bascule', id: 'puces', ico: 'list', title: 'Puces' },
        { type: 'menu', id: 'puces-style', ico: 'chevron-down', title: 'Bibliothèque de puces', items: () => [['disc', '● Disque'], ['circle', '○ Cercle'], ['square', '■ Carré']].map(([v, l]) => ({ label: l, faire: () => liste('ul', v) })) },
        { type: 'bascule', id: 'numeros', ico: 'list-ordered', title: 'Numérotation' },
        { type: 'menu', id: 'numeros-style', ico: 'chevron-down', title: 'Bibliothèque de numérotation', items: () => [['decimal', '1. 2. 3.'], ['lower-alpha', 'a. b. c.'], ['upper-alpha', 'A. B. C.'], ['lower-roman', 'i. ii. iii.'], ['upper-roman', 'I. II. III.']].map(([v, l]) => ({ label: l, faire: () => liste('ol', v) })) },
        { type: 'bouton', id: 'retrait-moins', ico: 'indent-decrease', title: 'Diminuer le retrait' },
        { type: 'bouton', id: 'retrait-plus', ico: 'indent-increase', title: 'Augmenter le retrait' },
      ] },
      { type: 'ligne', items: [
        { type: 'bascule', id: 'al-gauche', ico: 'align-left', title: 'Aligner à gauche', raccourci: 'Ctrl+L' },
        { type: 'bascule', id: 'al-centre', ico: 'align-center', title: 'Centrer', raccourci: 'Ctrl+E' },
        { type: 'bascule', id: 'al-droite', ico: 'align-right', title: 'Aligner à droite', raccourci: 'Ctrl+R' },
        { type: 'bascule', id: 'al-justifie', ico: 'align-justify', title: 'Justifier', raccourci: 'Ctrl+J' },
        { type: 'menu', id: 'interligne', ico: 'arrow-down-up', title: 'Interligne et espacement de paragraphe', items: () => [...['1', '1,15', '1,5', '2', '2,5', '3'].map(v => ({ label: v, faire: () => interligne(v.replace(',', '.')) })), '-', { label: 'Ajouter un espace avant le paragraphe', faire: () => espacement('avant', '12pt') }, { label: 'Supprimer l\'espace avant le paragraphe', faire: () => espacement('avant', '0') }, { label: 'Ajouter un espace après le paragraphe', faire: () => espacement('apres', '12pt') }, { label: 'Supprimer l\'espace après le paragraphe', faire: () => espacement('apres', '0') }] },
        { type: 'couleur', id: 'trame', ico: 'paint-bucket', title: 'Trame de fond du paragraphe', defaut: '#D9E2F3', aucune: true, applicationDirecte: true },
      ] },
    ] }] },
    { titre: 'Styles', items: [
      { type: 'html', id: 'galerie', html: `<div class="galerie-styles">${[['normal', 'Normal', ''], ['titre', 'Titre', 'font-size:15px;color:#1F3864'], ['sous-titre', 'Sous-titre', 'color:#595959'], ['h1', 'Titre 1', 'font-weight:700;color:#1F3864'], ['h2', 'Titre 2', 'font-weight:700;color:#1F3864;font-size:12.5px'], ['h3', 'Titre 3', 'font-weight:700;color:#1F3864;font-size:12px'], ['citation', 'Citation', 'font-style:italic;color:#404040'], ['code', 'Code', 'font-family:Consolas,monospace;font-size:12px']].map(([id, l, s]) => `<button data-style="${id}" title="${l}" style="${s}">${l}</button>`).join('')}</div>` },
      { type: 'bouton', id: 'styles-doc', ico: 'type', label: 'Police du document', grand: true },
    ] },
    { titre: 'Modification', items: [{ type: 'pile', items: [
      { type: 'bouton', id: 'rechercher', ico: 'search', label: 'Rechercher', avecLabel: true, raccourci: 'Ctrl+F' },
      { type: 'bouton', id: 'remplacer', ico: 'replace', label: 'Remplacer', avecLabel: true, raccourci: 'Ctrl+H' },
      { type: 'bouton', id: 'tout', ico: 'text-select', label: 'Sélectionner tout', avecLabel: true, raccourci: 'Ctrl+A' },
    ] }] },
  ] },
  { id: 'insertion', titre: 'Insertion', groupes: [
    { titre: 'Pages', items: [{ type: 'bouton', id: 'saut-page', ico: 'file-minus', label: 'Saut de page', grand: true, raccourci: 'Ctrl+Entrée' }] },
    { titre: 'Tableaux', items: [{ type: 'menu', id: 'tableau', ico: 'table', label: 'Tableau', grand: true, items: [] }] },
    { titre: 'Illustrations', items: [{ type: 'bouton', id: 'image', ico: 'image', label: 'Image', grand: true }, { type: 'bouton', id: 'ligne-h', ico: 'minus', label: 'Ligne', grand: true }] },
    { titre: 'Liens', items: [{ type: 'bouton', id: 'lien', ico: 'link', label: 'Lien', grand: true, raccourci: 'Ctrl+K' }] },
    { titre: 'Commentaires', items: [{ type: 'bouton', id: 'commentaire', ico: 'message-square-plus', label: 'Commentaire', grand: true }] },
    { titre: 'En-tête et pied de page', items: [
      { type: 'bouton', id: 'entete', ico: 'panel-top', label: 'En-tête', grand: true },
      { type: 'bouton', id: 'pied', ico: 'panel-bottom', label: 'Pied de page', grand: true },
      { type: 'menu', id: 'numero-page', ico: 'hash', label: 'Numéro de page', grand: true, items: [] },
    ] },
    { titre: 'Texte', items: [{ type: 'menu', id: 'date', ico: 'calendar', label: 'Date et heure', grand: true, items: [] }] },
    { titre: 'Symboles', items: [{ type: 'menu', id: 'caracteres', ico: 'omega', label: 'Caractères spéciaux', grand: true, items: [] }] },
  ] },
  { id: 'mise-en-page', titre: 'Mise en page', groupes: [
    { titre: 'Mise en page', items: [
      { type: 'menu', id: 'marges', ico: 'square-dashed', label: 'Marges', grand: true, items: () => [['normales', 'Normales (2,5 cm)'], ['etroites', 'Étroites (1,27 cm)'], ['moyennes', 'Moyennes'], ['larges', 'Larges']].map(([k, l]) => ({ label: l, faire: () => definirMarges(MARGES[k]) })).concat(['-', { label: 'Marges personnalisées…', faire: margesPerso }]) },
      { type: 'menu', id: 'orientation', ico: 'rotate-ccw-square', label: 'Orientation', grand: true, items: () => [{ label: 'Portrait', coche: !D.page.paysage, faire: () => orientation(false) }, { label: 'Paysage', coche: D.page.paysage, faire: () => orientation(true) }] },
      { type: 'menu', id: 'taille-page', ico: 'file', label: 'Taille', grand: true, items: () => Object.keys(FORMATS_PAGE).map(f => ({ label: `${f} (${FORMATS_PAGE[f].map(x => String(x / 10).replace('.', ',')).join(' × ')} cm)`, coche: D.page.format === f, faire: () => definirFormat(f) })) },
      { type: 'bouton', id: 'saut-page2', ico: 'file-minus', label: 'Saut de page', grand: true },
    ] },
    { titre: 'Arrière-plan', items: [{ type: 'menu', id: 'filigrane', ico: 'stamp', label: 'Filigrane', grand: true, items: [] }] },
    { titre: 'Paragraphe', items: [{ type: 'pile', items: [
      { type: 'bouton', id: 'retrait-plus2', ico: 'indent-increase', label: 'Augmenter le retrait', avecLabel: true },
      { type: 'bouton', id: 'retrait-moins2', ico: 'indent-decrease', label: 'Diminuer le retrait', avecLabel: true },
    ] }] },
  ] },
  { id: 'references', titre: 'Références', groupes: [
    { titre: 'Table des matières', items: [
      { type: 'bouton', id: 'sommaire', ico: 'list-tree', label: 'Table des matières', grand: true },
      { type: 'bouton', id: 'maj-sommaire', ico: 'refresh-cw', label: 'Mettre à jour la table', grand: true },
    ] },
    { titre: 'Légendes', items: [{ type: 'bouton', id: 'legende', ico: 'captions', label: 'Insérer une légende', grand: true }] },
  ] },
  { id: 'revision', titre: 'Révision', groupes: [
    { titre: 'Vérification', items: [
      { type: 'bascule', id: 'orthographe', ico: 'spell-check', label: 'Orthographe', grand: true, title: 'Vérifier l\'orthographe pendant la frappe' },
      { type: 'bouton', id: 'stats', ico: 'chart-no-axes-column', label: 'Statistiques', grand: true },
    ] },
    { titre: 'Commentaires', items: [
      { type: 'bouton', id: 'commentaire2', ico: 'message-square-plus', label: 'Nouveau commentaire', grand: true },
      { type: 'bouton', id: 'voir-coms', ico: 'messages-square', label: 'Afficher les commentaires', grand: true },
    ] },
    { titre: 'Typographie', items: [{ type: 'bascule', id: 'typo', ico: 'quote', label: 'Typographie française', grand: true, title: 'Guillemets « » et espaces insécables automatiques' }] },
  ] },
  { id: 'affichage', titre: 'Affichage', groupes: [
    { titre: 'Affichage', items: [
      { type: 'bascule', id: 'vue-page', ico: 'file-text', label: 'Page', grand: true },
      { type: 'bascule', id: 'vue-lecture', ico: 'book-open', label: 'Lecture', grand: true },
      { type: 'bascule', id: 'vue-web', ico: 'globe', label: 'Web', grand: true },
    ] },
    { titre: 'Afficher', items: [{ type: 'pile', items: [
      { type: 'bascule', id: 'voir-regle', ico: 'ruler', label: 'Règle', avecLabel: true },
      { type: 'bascule', id: 'voir-nav', ico: 'panel-left', label: 'Volet de navigation', avecLabel: true },
    ] }] },
    { titre: 'Zoom', items: [
      { type: 'bouton', id: 'zoom-100', ico: 'zoom-in', label: '100 %', grand: true },
      { type: 'bouton', id: 'zoom-largeur', ico: 'move-horizontal', label: 'Largeur de page', grand: true },
      { type: 'bouton', id: 'zoom-page', ico: 'scan', label: 'Une page', grand: true },
    ] },
    { titre: 'Fenêtre', items: [{ type: 'bouton', id: 'plein-ecran', ico: 'maximize', label: 'Plein écran', grand: true }, { type: 'bouton', id: 'nouvelle-fenetre', ico: 'app-window', label: 'Nouvelle fenêtre', grand: true }] },
  ] },
  { id: 'tableau', titre: 'Tableau', contextuel: true, groupes: [
    { titre: 'Lignes et colonnes', items: [
      { type: 'bouton', id: 't-ligne-dessus', ico: 'between-horizontal-start', label: 'Insérer au-dessus', grand: true },
      { type: 'bouton', id: 't-ligne-dessous', ico: 'between-horizontal-end', label: 'Insérer en dessous', grand: true },
      { type: 'bouton', id: 't-col-gauche', ico: 'between-vertical-start', label: 'Insérer à gauche', grand: true },
      { type: 'bouton', id: 't-col-droite', ico: 'between-vertical-end', label: 'Insérer à droite', grand: true },
      { type: 'menu', id: 't-supprimer', ico: 'trash-2', label: 'Supprimer', grand: true, items: () => [{ label: 'Supprimer la ligne', faire: opTableau.supprLigne }, { label: 'Supprimer la colonne', faire: opTableau.supprCol }, { label: 'Supprimer le tableau', faire: opTableau.supprTableau, danger: true }] },
    ] },
    { titre: 'Fusionner', items: [{ type: 'pile', items: [
      { type: 'bouton', id: 't-fusion-droite', ico: 'merge', label: 'Fusionner à droite', avecLabel: true },
      { type: 'bouton', id: 't-fusion-bas', ico: 'merge', label: 'Fusionner en dessous', avecLabel: true },
      { type: 'bouton', id: 't-scinder', ico: 'split', label: 'Fractionner la cellule', avecLabel: true },
    ] }] },
    { titre: 'Mise en forme', items: [{ type: 'pile', items: [
      { type: 'couleur', id: 't-fond', ico: 'paint-bucket', label: 'Trame', title: 'Couleur de la cellule', defaut: '#E7ECF5', aucune: true, applicationDirecte: true, avecLabel: true },
      { type: 'bouton', id: 't-bordures', ico: 'grid-3x3', label: 'Bordures', avecLabel: true, title: 'Afficher ou masquer les bordures' },
      { type: 'bouton', id: 't-entete', ico: 'heading', label: 'Ligne d\'en-tête', avecLabel: true },
    ] }] },
    { titre: 'Alignement', items: [{ type: 'pile', items: [
      { type: 'bouton', id: 't-haut', ico: 'align-vertical-justify-start', label: 'En haut', avecLabel: true },
      { type: 'bouton', id: 't-milieu', ico: 'align-vertical-justify-center', label: 'Au milieu', avecLabel: true },
      { type: 'bouton', id: 't-bas', ico: 'align-vertical-justify-end', label: 'En bas', avecLabel: true },
    ] }, { type: 'bouton', id: 't-auto', ico: 'columns-3', label: 'Ajuster au contenu', grand: true }] },
  ] },
  { id: 'image', titre: 'Image', contextuel: true, groupes: [
    { titre: 'Habillage', items: [
      { type: 'bouton', id: 'i-ligne', ico: 'text', label: 'Aligné sur le texte', grand: true },
      { type: 'bouton', id: 'i-gauche', ico: 'wrap-text', label: 'À gauche', grand: true },
      { type: 'bouton', id: 'i-droite', ico: 'wrap-text', label: 'À droite', grand: true },
      { type: 'bouton', id: 'i-centre', ico: 'align-center-horizontal', label: 'Centré', grand: true },
    ] },
    { titre: 'Taille', items: [{ type: 'bouton', id: 'i-largeur', ico: 'move-diagonal-2', label: 'Largeur…', grand: true }, { type: 'bouton', id: 'i-origine', ico: 'undo', label: 'Taille d\'origine', grand: true }] },
    { titre: 'Accessibilité', items: [{ type: 'bouton', id: 'i-alt', ico: 'captions', label: 'Texte de remplacement', grand: true }, { type: 'bouton', id: 'i-legende', ico: 'text-cursor-input', label: 'Légende', grand: true }] },
    { titre: 'Supprimer', items: [{ type: 'bouton', id: 'i-suppr', ico: 'trash-2', label: 'Supprimer l\'image', grand: true }] },
  ] },
], {
  onFichier: () => doc.ouvrirCoulisses('accueil'),
  actions: {
    coller: async () => { restaurer(); try { const t = await navigator.clipboard.readText(); avant(); document.execCommand('insertText', false, t); apres(); } catch { toast('Utilisez Ctrl+V pour coller.'); } },
    couper: () => { restaurer(); avant(); document.execCommand('cut'); apres(); }, copier: () => { restaurer(); document.execCommand('copy'); },
    reproduire: () => { restaurer(); V.peintre = capturerFormat(); ruban.actif('reproduire', !!V.peintre); feuille.style.cursor = 'copy'; toast('Sélectionnez le texte auquel appliquer la mise en forme.'); },
    police: v => policeNom(v), taille: v => taillePolice(v), agrandir: () => changerTaille(1), reduire: () => changerTaille(-1),
    'effacer-format': effacerMiseEnForme,
    gras: () => cmd('bold'), italique: () => cmd('italic'), souligne: () => cmd('underline'), barre: () => cmd('strikeThrough'), indice: () => cmd('subscript'), exposant: () => cmd('superscript'),
    surlignage: c => cmd('hiliteColor', c === 'transparent' ? 'transparent' : c), 'couleur-texte': c => cmd('foreColor', c === 'transparent' ? '#000000' : c),
    puces: () => liste('ul'), numeros: () => liste('ol'), 'retrait-moins': () => retrait(-1), 'retrait-plus': () => retrait(1), 'retrait-moins2': () => retrait(-1), 'retrait-plus2': () => retrait(1),
    'al-gauche': () => cmd('justifyLeft'), 'al-centre': () => cmd('justifyCenter'), 'al-droite': () => cmd('justifyRight'), 'al-justifie': () => cmd('justifyFull'),
    trame: c => trame(c), 'styles-doc': stylesDocument,
    rechercher: () => ouvrirRecherche(false), remplacer: () => ouvrirRecherche(true), tout: () => { feuille.focus(); document.execCommand('selectAll'); },
    'saut-page': sautDePage, 'saut-page2': sautDePage, tableau: b => menuTableau(b), image: insererImage, 'ligne-h': () => insererHTML('<hr><p><br></p>'), lien,
    commentaire: nouveauCommentaire, commentaire2: nouveauCommentaire, 'voir-coms': () => afficherPanneau('panneau-com', $('#panneau-com').classList.contains('masque')),
    entete: () => dialogueEnteteDifferent('entete'), pied: () => dialogueEnteteDifferent('pied'), 'numero-page': b => numeroPage(b), date: b => insererDate(b), caracteres: b => menuCaracteres(b),
    filigrane: b => filigrane(b), sommaire: insererSommaire, 'maj-sommaire': () => { majSommaire(); planifierPagination(); toast('Table des matières mise à jour.'); },
    legende: () => { restaurer(); const n = $$('.legende', feuille).length + 1; insererHTML(`<p class="legende" style="text-align:center;font-style:italic;font-size:9pt;color:#44546A">Figure ${n} : légende</p>`); },
    orthographe: () => { feuille.spellcheck = !feuille.spellcheck; ruban.actif('orthographe', feuille.spellcheck); doc.prefs.orthographe = feuille.spellcheck; F.ecrirePrefs('texte', doc.prefs); feuille.blur(); feuille.focus(); },
    stats: dialogueStats, typo: () => { V.auto = !V.auto; ruban.actif('typo', V.auto); doc.prefs.typo = V.auto; F.ecrirePrefs('texte', doc.prefs); },
    'vue-page': () => mode('page'), 'vue-lecture': () => mode('lecture'), 'vue-web': () => mode('web'),
    'voir-regle': () => { V.regle = !V.regle; ruban.actif('voir-regle', V.regle); majRegle(); },
    'voir-nav': () => { V.nav = !V.nav; ruban.actif('voir-nav', V.nav); $('#panneau-nav').classList.toggle('masque', !V.nav); majNavigation(); ajusterEchelle(); },
    'zoom-100': () => definirZoom(1), 'zoom-largeur': () => definirZoom((espace.clientWidth - 40) / D.page.largeur), 'zoom-page': () => definirZoom(Math.min((espace.clientHeight - 50) / D.page.hauteur, (espace.clientWidth - 40) / D.page.largeur)),
    'plein-ecran': () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); },
    'nouvelle-fenetre': () => F.NATIF ? F.appelApi('/api/lancer-app', { id: 'texte' }) : window.open(location.href, '_blank'),
    't-ligne-dessus': opTableau.ligneDessus, 't-ligne-dessous': opTableau.ligneDessous, 't-col-gauche': opTableau.colGauche, 't-col-droite': opTableau.colDroite,
    't-fusion-droite': opTableau.fusionDroite, 't-fusion-bas': opTableau.fusionBas, 't-scinder': opTableau.scinder, 't-fond': c => opTableau.fond(c), 't-bordures': opTableau.bordures, 't-entete': opTableau.entete,
    't-haut': () => opTableau.alignV('top'), 't-milieu': () => opTableau.alignV('middle'), 't-bas': () => opTableau.alignV('bottom'), 't-auto': opTableau.largeurAuto,
    'i-ligne': () => opImage.habillage(''), 'i-gauche': () => opImage.habillage('img-gauche'), 'i-droite': () => opImage.habillage('img-droite'), 'i-centre': () => opImage.habillage('img-centre'),
    'i-largeur': opImage.largeur, 'i-origine': opImage.origine, 'i-alt': opImage.alt, 'i-legende': opImage.legende, 'i-suppr': opImage.supprimer,
  }
});
$$('.galerie-styles button').forEach(b => { b.onmousedown = e => e.preventDefault(); b.onclick = () => appliquerStyle(b.dataset.style); });
// mémoriser la sélection avant d'utiliser les listes déroulantes du ruban
$$('#zone-ruban select, #zone-ruban input').forEach(s => s.addEventListener('mousedown', () => { selMemo = sauverSelection(feuille) || selMemo; }));

function mode(m) {
  V.mode = m;
  ['page', 'lecture', 'web'].forEach(k => ruban.actif('vue-' + k, k === m));
  feuille.classList.toggle('mode-web', m === 'web'); feuille.classList.toggle('mode-lecture', m === 'lecture');
  if (m === 'web') { pagesEl.style.width = '100%'; feuille.style.width = '100%'; } else { pagesEl.style.width = ''; feuille.style.width = ''; }
  if (m === 'lecture') { feuille.style.maxWidth = '760px'; pagesEl.style.width = '760px'; } else feuille.style.maxWidth = '';
  if (m !== 'page') { feuille.style.background = 'var(--surface,#fff)'; feuille.style.boxShadow = '0 1px 3px rgba(0,0,0,.15)'; } else { feuille.style.background = ''; feuille.style.boxShadow = ''; }
  paginerMaintenant();
}

// ---------- Collage ----------
feuille.addEventListener('paste', async e => {
  const dt = e.clipboardData; if (!dt) return;
  const imgs = [...dt.items].filter(i => i.type.startsWith('image/'));
  const html = dt.getData('text/html');
  if (imgs.length && !html) {
    e.preventDefault();
    const f = imgs[0].getAsFile();
    const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    insererHTML(`<img src="${url}" alt="Image collée" style="width:${Math.min(500, D.page.largeur - D.page.marges.gauche - D.page.marges.droite)}px">`);
    return;
  }
  if (html) {
    e.preventDefault();
    const word = /urn:schemas-microsoft-com:office|class="?Mso/i.test(html);
    avant(); document.execCommand('insertHTML', false, nettoyer(html, { depuisWord: word })); apres();
  }
});
async function collerSansMiseEnForme() { try { const t = await navigator.clipboard.readText(); restaurer(); avant(); document.execCommand('insertText', false, t); apres(); } catch { toast('Le presse-papiers n\'est pas accessible.', 'erreur'); } }

// Menu contextuel
feuille.addEventListener('contextmenu', e => {
  if (e.shiftKey) return; // menu natif (orthographe) avec Maj
  const sel = getSelection(); const motErrone = false;
  const td = e.target.closest('td,th'), img = e.target.closest('img'), a = e.target.closest('a');
  if (!td && !img && !a && !e.ctrlKey) return; // laisser le menu natif (suggestions d'orthographe)
  e.preventDefault();
  menu([
    { label: 'Couper', ico: 'scissors', raccourci: 'Ctrl+X', faire: () => document.execCommand('cut') },
    { label: 'Copier', ico: 'copy', raccourci: 'Ctrl+C', faire: () => document.execCommand('copy') },
    { label: 'Coller sans mise en forme', ico: 'clipboard-type', faire: collerSansMiseEnForme },
    a ? '-' : null, a ? { label: 'Ouvrir le lien', ico: 'external-link', faire: () => F.ouvrirLien(a.getAttribute('href')) } : null, a ? { label: 'Modifier le lien…', ico: 'link', faire: lien } : null,
    td ? '-' : null, td ? { label: 'Insérer une ligne au-dessus', faire: opTableau.ligneDessus } : null, td ? { label: 'Insérer une ligne en dessous', faire: opTableau.ligneDessous } : null, td ? { label: 'Insérer une colonne à gauche', faire: opTableau.colGauche } : null, td ? { label: 'Insérer une colonne à droite', faire: opTableau.colDroite } : null, td ? { label: 'Supprimer la ligne', faire: opTableau.supprLigne } : null, td ? { label: 'Supprimer la colonne', faire: opTableau.supprCol } : null, td ? { label: 'Supprimer le tableau', faire: opTableau.supprTableau, danger: true } : null,
    img ? '-' : null, img ? { label: 'Texte de remplacement…', faire: opImage.alt } : null, img ? { label: 'Supprimer l\'image', danger: true, faire: opImage.supprimer } : null,
  ], e.clientX, e.clientY);
});

// ---------- Raccourcis ----------
raccourcis({
  'Ctrl+G': () => cmd('bold'), 'Ctrl+B': () => cmd('bold'), 'Ctrl+I': () => cmd('italic'), 'Ctrl+U': () => cmd('underline'),
  'Ctrl+L': () => cmd('justifyLeft'), 'Ctrl+E': () => cmd('justifyCenter'), 'Ctrl+R': () => cmd('justifyRight'), 'Ctrl+J': () => cmd('justifyFull'),
  'Ctrl+K': () => lien(), 'Ctrl+F': () => ouvrirRecherche(false), 'Ctrl+H': () => ouvrirRecherche(true),
  'Ctrl+Z': () => annuler(), 'Ctrl+Y': () => retablir(), 'Ctrl+Maj+Z': () => retablir(),
  'Ctrl+Enter': () => sautDePage(), 'Ctrl+=': () => cmd('subscript'), 'Ctrl+Maj++': () => cmd('superscript'), 'Ctrl+Maj+=': () => cmd('superscript'),
  'Ctrl+Maj+>': () => changerTaille(1), 'Ctrl+Maj+<': () => changerTaille(-1), 'Ctrl+Maj+V': () => collerSansMiseEnForme(),
  'Ctrl+Maj+ ': () => insererTexte(' '),
  'Ctrl+Alt+1': () => appliquerStyle('h1'), 'Ctrl+Alt+2': () => appliquerStyle('h2'), 'Ctrl+Alt+3': () => appliquerStyle('h3'), 'Ctrl+Maj+N': () => appliquerStyle('normal'),
  'Escape': () => { if (V.peintre) { V.peintre = null; ruban.actif('reproduire', false); feuille.style.cursor = ''; return; } return false; },
});
espace.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); definirZoom(V.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
espace.addEventListener('mousedown', e => { if (e.target === espace || e.target === echelleEl || e.target === pagesEl) { e.preventDefault(); placerCurseur(feuille.lastElementChild || feuille, true); } });

// ---------- Barre d'état ----------
$('#barre-etat').innerHTML = `<span id="etat-page">Page 1 sur 1</span><span id="etat-mots">0 mot</span><button id="etat-langue" title="Langue de vérification">Français (France)</button><span class="espace"></span>
  <button data-vue="page" title="Page">${ico('file-text', 'p')}</button><button data-vue="lecture" title="Lecture">${ico('book-open', 'p')}</button><button data-vue="web" title="Web">${ico('globe', 'p')}</button>
  <span class="zoom"><button id="zoom-moins" aria-label="Zoom arrière">−</button><input type="range" id="zoom-curseur" min="25" max="300" value="100" aria-label="Zoom"><button id="zoom-plus" aria-label="Zoom avant">+</button><button id="zoom-val" title="Zoom">100 %</button></span>`;
$$('#barre-etat [data-vue]').forEach(b => b.onclick = () => mode(b.dataset.vue));
$('#zoom-curseur').oninput = e => definirZoom(e.target.value / 100);
$('#zoom-moins').onclick = () => definirZoom(Math.round(V.zoom * 10 - 1) / 10);
$('#zoom-plus').onclick = () => definirZoom(Math.round(V.zoom * 10 + 1) / 10);
$('#zoom-val').onclick = () => menu([50, 75, 100, 125, 150, 200].map(z => ({ label: z + ' %', faire: () => definirZoom(z / 100) })).concat(['-', { label: 'Largeur de page', faire: () => definirZoom((espace.clientWidth - 40) / D.page.largeur) }]), 0, 0, $('#zoom-val'));
$$('[data-fermer-panneau]').forEach(b => { b.innerHTML = ico('x'); b.onclick = () => { V.nav = false; ruban.actif('voir-nav', false); $('#panneau-nav').classList.add('masque'); ajusterEchelle(); }; });

// ---------- Chargement / enregistrement ----------
function etatAtelier() { return { version: 1, html: feuille.innerHTML.replace(/ class="img-sel"/g, '').replace(/ img-sel/g, ''), reglages: D }; }
function chargerHTML(html, reglages) {
  feuille.innerHTML = nettoyer(html) || '<p><br></p>';
  D = { ...reglagesDefaut(), ...(reglages || {}) };
  D.page = { ...reglagesDefaut().page, ...(D.page || {}) };
  D.commentaires = D.commentaires || [];
  hist.vider(); selectionnerImage(null);
  appliquerReglages(); majPanneauCom(); majNavigation();
  placerCurseur(feuille.firstElementChild || feuille);
  espace.scrollTop = 0;
}
function largeurContenu() { return D.page.largeur - D.page.marges.gauche - D.page.marges.droite; }
async function ecrireDocxActuel() {
  const clone = feuille.cloneNode(true);
  clone.querySelectorAll('.img-sel').forEach(i => i.classList.remove('img-sel'));
  return docxOctets({ feuille: clone, reglages: { ...D, largeurContenu: largeurContenu(), auteur: utilisateur() }, titre: nomSansExtension(doc.nom), commentaires: D.commentaires }, etatAtelier());
}
async function lireDocx(octets) {
  const z = unzipSync(octets);
  if (z['atelier/document.json'] && z['word/document.xml']) {
    try {
      const e = JSON.parse(strFromU8(z['atelier/document.json']));
      if (e.empreinte === await hash(strFromU8(z['word/document.xml']))) return chargerHTML(e.html, e.reglages);
    } catch { }
  }
  if (!window.mammoth) throw new Error('module de lecture Word indisponible');
  const res = await window.mammoth.convertToHtml({ arrayBuffer: octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) }, {
    styleMap: ["p[style-name='Title'] => p.st-titre:fresh", "p[style-name='Titre'] => p.st-titre:fresh", "p[style-name='Subtitle'] => p.st-sous-titre:fresh", "p[style-name='Sous-titre'] => p.st-sous-titre:fresh", "p[style-name='Quote'] => blockquote:fresh", "p[style-name='Citation'] => blockquote:fresh", "u => u", "strike => s", "p[style-name='Titre 1'] => h1:fresh", "p[style-name='Titre 2'] => h2:fresh", "p[style-name='Titre 3'] => h3:fresh"],
  });
  // mise en page d'origine (format, marges) et en-têtes/pieds simples
  const r = reglagesDefaut();
  try {
    const x = strFromU8(z['word/document.xml']);
    const sz = /<w:pgSz[^>]*w:w="(\d+)"[^>]*w:h="(\d+)"/.exec(x); if (sz) { r.page.largeur = +sz[1] / 15; r.page.hauteur = +sz[2] / 15; r.page.paysage = +sz[1] > +sz[2]; }
    const mg = /<w:pgMar[^>]*>/.exec(x); if (mg) { const g = k => { const m = new RegExp(`w:${k}="(\\d+)"`).exec(mg[0]); return m ? +m[1] / 15 : null; }; r.page.marges = { haut: g('top') ?? r.page.marges.haut, bas: g('bottom') ?? r.page.marges.bas, gauche: g('left') ?? r.page.marges.gauche, droite: g('right') ?? r.page.marges.droite }; }
    const texteXml = f => f ? strFromU8(f).replace(/<w:instrText[^>]*>\s*PAGE\s*<\/w:instrText>/g, '\u0001').replace(/<w:instrText[^>]*>\s*NUMPAGES\s*<\/w:instrText>/g, '\u0002').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '').replace(/1(?=[^\u0001\u0002]*$)/, '') : '';
    const hf = f => { if (!f) return null; let t = strFromU8(f); t = t.replace(/<w:fldSimple[^>]*w:instr="\s*PAGE\s*"[^>]*>.*?<\/w:fldSimple>/g, '{page}').replace(/<w:fldSimple[^>]*w:instr="\s*NUMPAGES\s*"[^>]*>.*?<\/w:fldSimple>/g, '{pages}'); t = t.replace(/<w:instrText[^>]*>\s*PAGE\s*<\/w:instrText>.*?<w:fldChar w:fldCharType="end"\/>/gs, '{page}').replace(/<w:instrText[^>]*>\s*NUMPAGES\s*<\/w:instrText>.*?<w:fldChar w:fldCharType="end"\/>/gs, '{pages}'); t = t.replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, ''); const parts = t.split('\t').map(s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()); if (!parts.join('')) return null; return parts.length >= 3 ? { gauche: parts[0], centre: parts[1], droite: parts.slice(2).join(' ') } : parts.length === 2 ? { gauche: parts[0], centre: '', droite: parts[1] } : { gauche: '', centre: parts[0], droite: '' }; };
    const h = Object.keys(z).find(k => /^word\/header\d*\.xml$/.test(k)), p = Object.keys(z).find(k => /^word\/footer\d*\.xml$/.test(k));
    const eh = hf(z[h]), ep = hf(z[p]); if (eh) r.entete = eh; if (ep) r.pied = ep;
    void texteXml;
  } catch { }
  chargerHTML(res.value || '<p><br></p>', r);
}
function exporterHTML() {
  const clone = feuille.cloneNode(true); clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable')); clone.querySelectorAll('.img-sel').forEach(i => i.classList.remove('img-sel'));
  const css = `body{font-family:${D.police},Arial,sans-serif;font-size:${D.taille}pt;line-height:1.4;max-width:800px;margin:40px auto;padding:0 20px;color:#1b1b1b}h1,h2,h3{color:#${D.couleurTitres}}table{border-collapse:collapse;width:100%}td,th{border:1px solid #808080;padding:4px 6px;vertical-align:top}img{max-width:100%}.st-titre{font-size:28pt;color:#${D.couleurTitres}}.st-sous-titre{font-size:15pt;color:#595959}blockquote{font-style:italic;border-left:3px solid #ccc;padding-left:12px}hr.saut-page{border:0;page-break-after:always}.entree-sommaire{display:flex;gap:4px}.entree-sommaire .points{flex:1;border-bottom:1px dotted #888}.commentaire{background:#FFF3B0}`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(nomSansExtension(doc.nom))}</title><style>${css}</style></head><body>${clone.innerHTML}</body></html>`;
}
function versTexte() { return feuille.innerText.replace(/ /g, ' '); }
function versMarkdown() {
  const md = n => {
    let o = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { o += c.nodeValue.replace(/ /g, ' ').replace(/([*_`\\])/g, '\\$1'); continue; }
      if (c.nodeType !== 1) continue;
      const t = c.tagName, s = md(c);
      if (/^H[1-6]$/.test(t)) o += '#'.repeat(+t[1]) + ' ' + s.trim() + '\n\n';
      else if (t === 'P' || t === 'DIV') o += c.classList.contains('st-titre') ? '# ' + s.trim() + '\n\n' : s.trim() + '\n\n';
      else if (t === 'B' || t === 'STRONG') o += `**${s}**`;
      else if (t === 'I' || t === 'EM') o += `*${s}*`;
      else if (t === 'S') o += `~~${s}~~`;
      else if (t === 'CODE') o += '`' + c.textContent + '`';
      else if (t === 'PRE') o += '```\n' + c.textContent + '\n```\n\n';
      else if (t === 'BR') o += '  \n';
      else if (t === 'A') o += `[${s}](${c.getAttribute('href')})`;
      else if (t === 'IMG') o += `![${c.alt || ''}](image)`;
      else if (t === 'BLOCKQUOTE') o += s.trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      else if (t === 'UL' || t === 'OL') { [...c.children].forEach((li, i) => { o += (t === 'OL' ? `${i + 1}. ` : '- ') + md(li).trim().replace(/\n+/g, '\n   ') + '\n'; }); o += '\n'; }
      else if (t === 'HR') o += '---\n\n';
      else if (t === 'TABLE') { const rows = [...c.rows].map(r => '| ' + [...r.cells].map(x => md(x).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ')).join(' | ') + ' |'); if (rows.length) { o += rows[0] + '\n|' + ' --- |'.repeat(c.rows[0].cells.length) + '\n' + rows.slice(1).join('\n') + '\n\n'; } }
      else o += s;
    }
    return o;
  };
  return md(feuille).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function depuisMarkdown(t) {
  const lignes = t.replace(/\r/g, '').split('\n'); let html = '', liste = null, tableau = null, pre = null;
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/~~(.+?)~~/g, '<s>$1</s>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
  const fermer = () => { if (liste) { html += `</${liste}>`; liste = null; } if (tableau) { html += '</tbody></table>'; tableau = null; } };
  for (const l of lignes) {
    if (pre !== null) { if (/^```/.test(l)) { html += `<pre>${esc(pre)}</pre>`; pre = null; } else pre += (pre ? '\n' : '') + l; continue; }
    if (/^```/.test(l)) { fermer(); pre = ''; continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { fermer(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; }
    else if ((m = /^\s*[-*+]\s+(.*)$/.exec(l))) { if (liste !== 'ul') { fermer(); html += '<ul>'; liste = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { if (liste !== 'ol') { fermer(); html += '<ol>'; liste = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (/^\|/.test(l)) { if (/^\|[\s\-:|]+\|?$/.test(l)) continue; if (!tableau) { fermer(); html += '<table class="tab"><tbody>'; tableau = 1; } html += '<tr>' + l.replace(/^\||\|$/g, '').split('|').map(c => `<td>${inline(c.trim())}</td>`).join('') + '</tr>'; }
    else if (/^>\s?/.test(l)) { fermer(); html += `<blockquote>${inline(l.replace(/^>\s?/, ''))}</blockquote>`; }
    else if (/^(---|\*\*\*)\s*$/.test(l)) { fermer(); html += '<hr>'; }
    else if (!l.trim()) fermer();
    else { fermer(); html += `<p>${inline(l)}</p>`; }
  }
  fermer(); return html;
}

const doc = creerDocument({
  focus: () => $('#feuille').focus({ preventScroll: true }),
  app: 'texte', nomApp: 'Texte', lettre: 'Tx', barreTitre: $('#barre-titre'),
  formatsOuverture: [{ nom: 'Documents Word', ext: ['docx'] }, { nom: 'Documents OpenDocument', ext: ['odt'] }, { nom: 'Pages web', ext: ['html', 'htm'] }, { nom: 'Texte', ext: ['txt'] }, { nom: 'Markdown', ext: ['md'] }],
  formatsEnregistrement: [{ nom: 'Document Word', ext: 'docx', ecrire: ecrireDocxActuel }, { nom: 'Document OpenDocument', ext: 'odt', ecrire: async () => ecrireOdt({ feuille: feuille.cloneNode(true), reglages: { ...D, largeurContenu: largeurContenu() }, titre: nomSansExtension(doc.nom) }) }],
  exports: [
    { id: 'pdf', label: 'PDF', ico: 'file-type', desc: 'Ouvre l\'impression : choisissez « Microsoft Print to PDF » ou « Enregistrer au format PDF ».', faire: () => doc.imprimer() },
    { id: 'docx', label: 'Document Word (.docx)', ico: 'file-text', ext: 'docx', ecrire: ecrireDocxActuel, desc: 'Compatible Microsoft Word et LibreOffice.' },
    { id: 'odt', label: 'Document OpenDocument (.odt)', ico: 'file-text', ext: 'odt', desc: 'Format ouvert, compatible LibreOffice Writer.', ecrire: async () => ecrireOdt({ feuille: feuille.cloneNode(true), reglages: { ...D, largeurContenu: largeurContenu() }, titre: nomSansExtension(doc.nom) }) },
    { id: 'html', label: 'Page web (.html)', ico: 'globe', ext: 'html', desc: 'Pour publier sur un intranet ou un wiki.', ecrire: async () => exporterHTML() },
    { id: 'md', label: 'Markdown (.md)', ico: 'file-code', ext: 'md', desc: 'Texte structuré pour wikis et outils de documentation.', ecrire: async () => versMarkdown() },
    { id: 'txt', label: 'Texte brut (.txt)', ico: 'file', ext: 'txt', desc: 'Texte sans mise en forme.', ecrire: async () => versTexte() },
  ],
  modeles: MODELES,
  async nouveau(modele) {
    const m = modele || MODELES[0];
    chargerHTML(m.html(), { ...reglagesDefaut(), ...(m.reglages || {}) });
    if ($('.sommaire', feuille)) majSommaire(false);
  },
  async charger({ octets, ext }) {
    if (ext === 'docx') return lireDocx(octets);
    if (ext === 'odt') return chargerHTML(lireOdt(octets), reglagesDefaut());
    const t = new TextDecoder('utf-8').decode(octets);
    if (ext === 'html' || ext === 'htm') return chargerHTML(t, reglagesDefaut());
    if (ext === 'md') return chargerHTML(depuisMarkdown(t), reglagesDefaut());
    chargerHTML(t.replace(/\r/g, '').split('\n').map(l => `<p>${esc(l) || '<br>'}</p>`).join(''), reglagesDefaut());
  },
  informations: async () => { const s = statistiques(feuille); return [['Pages', String(V.pages)], ['Mots', s.mots.toLocaleString('fr-FR')], ['Caractères', s.caracteres.toLocaleString('fr-FR')], ['Commentaires', String(D.commentaires.length)]]; },
  optionsApp: (z, prefs, sauver) => {
    z.innerHTML = `<label class="champ">Votre nom (affiché sur les commentaires)<input type="text" name="nom" value="${esc(prefs.nom || F.SESSION?.utilisateur || '')}"></label>
      <label class="case"><input type="checkbox" name="typo" ${V.auto ? 'checked' : ''}> Typographie française automatique (guillemets « », espaces insécables)</label>
      <label class="case"><input type="checkbox" name="ortho" ${feuille.spellcheck ? 'checked' : ''}> Vérifier l'orthographe pendant la frappe</label>`;
    $('[name="nom"]', z).onchange = e => { prefs.nom = e.target.value.trim(); sauver(); };
    $('[name="typo"]', z).onchange = e => { V.auto = prefs.typo = e.target.checked; ruban.actif('typo', V.auto); sauver(); };
    $('[name="ortho"]', z).onchange = e => { feuille.spellcheck = prefs.orthographe = e.target.checked; ruban.actif('orthographe', feuille.spellcheck); sauver(); };
  },
  annuler, retablir,
  commandes: () => ruban.commandes(),
  imprimer: () => { selectionnerImage(null); setTimeout(() => window.print(), 50); },
});
window.__texte = { feuille, D: () => D, V, doc, paginerMaintenant, exporterHTML, versMarkdown, versTexte, ecrireDocxActuel, chargerHTML };

// ---------- Démarrage ----------
(async () => {
  await doc.demarrer();
  V.auto = doc.prefs.typo !== false; ruban.actif('typo', V.auto);
  feuille.spellcheck = doc.prefs.orthographe !== false; ruban.actif('orthographe', feuille.spellcheck);
  ruban.actif('voir-regle', V.regle); ruban.actif('vue-page', true);
  ajusterEchelle();
  if (espace.clientWidth < D.page.largeur + 40) definirZoom((espace.clientWidth - 40) / D.page.largeur);
  new ResizeObserver(() => planifierPagination()).observe(feuille);
})();
