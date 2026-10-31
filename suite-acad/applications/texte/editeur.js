// Texte — moteur d'édition : sélection, historique, pagination, nettoyage, recherche
export const BLOCS = 'P,H1,H2,H3,H4,H5,H6,LI,BLOCKQUOTE,PRE,DIV,TD,TH,FIGCAPTION,ADDRESS';
const ESTBLOC = new Set(BLOCS.split(','));

// ---------- Nettoyage du HTML (collage, import) ----------
const BALISES = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'INS', 'SUB', 'SUP', 'BR', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'COLGROUP', 'COL', 'A', 'IMG', 'SPAN', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'DIV', 'FIGURE', 'FIGCAPTION', 'MARK', 'FONT', 'ADDRESS', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN']);
const RENOMMER = { SECTION: 'DIV', ARTICLE: 'DIV', HEADER: 'DIV', FOOTER: 'DIV', MAIN: 'DIV', MARK: 'SPAN', FONT: 'SPAN', STRIKE: 'S', DEL: 'S', INS: 'U' };
const STYLES_OK = ['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'color', 'background-color', 'text-align', 'font-size', 'font-family', 'margin-left', 'text-indent', 'line-height', 'vertical-align', 'width', 'height', 'float', 'margin-top', 'margin-bottom', 'list-style-type', 'border', 'text-transform', 'break-before'];
const CLASSES_OK = new Set(['saut-page', 'st-titre', 'st-sous-titre', 'sommaire', 'titre-sommaire', 'entree-sommaire', 'lib', 'num', 'commentaire', 'champ', 'tab', 'sans-bordure', 'legende', 'img-gauche', 'img-droite', 'img-centre', 'saut-avant', 'points']);
const ATTRS_OK = { A: ['href', 'title'], IMG: ['src', 'alt', 'width', 'height'], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'], OL: ['start', 'type'], COL: ['span'] };
const DATA_OK = ['data-com', 'data-champ', 'data-niveau', 'data-cible'];

export function nettoyer(html, { garderStyles = true, depuisWord = false } = {}) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const sortie = document.createElement('div');
  const copier = (src, dst) => {
    for (const n of src.childNodes) {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      let t = n.tagName;
      if (t === 'SCRIPT' || t === 'STYLE' || t === 'META' || t === 'LINK' || t === 'TITLE' || t === 'OBJECT' || t === 'IFRAME' || t === 'svg' || t === 'SVG' || t === 'NOSCRIPT' || t === 'TEMPLATE') continue;
      if (/^O:P$/i.test(t)) continue;
      if (!BALISES.has(t)) { copier(n, dst); continue; }
      const nt = RENOMMER[t] || t;
      const e = document.createElement(nt);
      if (t === 'FONT') { const st = []; if (n.getAttribute('color')) st.push('color:' + n.getAttribute('color')); if (n.getAttribute('face')) st.push('font-family:' + n.getAttribute('face')); if (st.length) e.setAttribute('style', st.join(';')); }
      if (t === 'MARK') e.setAttribute('style', 'background-color:#FFFF00');
      for (const a of ATTRS_OK[nt] || []) {
        const v = n.getAttribute(a); if (v == null) continue;
        if (a === 'href' && !/^(https?:|mailto:|#)/i.test(v.trim())) continue;
        if (a === 'src' && !/^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,/i.test(v.trim())) continue;
        e.setAttribute(a, v);
      }
      for (const a of DATA_OK) if (n.hasAttribute(a)) e.setAttribute(a, n.getAttribute(a));
      if (n.id && /^[\w-]+$/.test(n.id) && /^H[1-6]$/.test(nt)) e.id = n.id;
      const cls = [...n.classList].filter(c => CLASSES_OK.has(c)); if (cls.length) e.className = cls.join(' ');
      if (garderStyles && n.getAttribute('style')) {
        const st = [];
        for (const p of STYLES_OK) {
          const v = n.style.getPropertyValue(p);
          if (!v || /expression|url\(|javascript/i.test(v)) continue;
          if (depuisWord && (p === 'font-family' || p === 'line-height' || p === 'margin-top' || p === 'margin-bottom') && nt !== 'SPAN') continue;
          st.push(`${p}:${v}`);
        }
        if (st.length) e.setAttribute('style', st.join(';'));
      }
      if (nt === 'IMG' && !e.getAttribute('src')) continue;
      if (e.classList.contains('champ') || e.classList.contains('sommaire') || nt === 'HR') e.setAttribute('contenteditable', 'false');
      copier(n, e);
      dst.appendChild(e);
    }
  };
  copier(doc.body, sortie);
  // les éléments en ligne isolés au premier niveau sont regroupés en paragraphes
  const final = document.createElement('div');
  let p = null;
  for (const n of [...sortie.childNodes]) {
    const bloc = n.nodeType === 1 && /^(P|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|HR|DIV|FIGURE|ADDRESS)$/.test(n.tagName);
    if (bloc) { p = null; final.appendChild(n); }
    else if (n.nodeType === 3 && !n.nodeValue.trim() && !p) continue;
    else { if (!p) { p = document.createElement('p'); final.appendChild(p); } p.appendChild(n); }
  }
  return final.innerHTML;
}

// ---------- Sélection ----------
export function cheminNoeud(racine, n) {
  const ch = [];
  while (n && n !== racine) { const p = n.parentNode; if (!p) return null; ch.unshift([...p.childNodes].indexOf(n)); n = p; }
  return n === racine ? ch : null;
}
export function noeudChemin(racine, ch) {
  let n = racine;
  for (const i of ch || []) { if (!n.childNodes[i]) return null; n = n.childNodes[i]; }
  return n;
}
export function sauverSelection(racine) {
  const s = getSelection(); if (!s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if (!racine.contains(r.startContainer)) return null;
  return { a: cheminNoeud(racine, r.startContainer), ao: r.startOffset, f: cheminNoeud(racine, r.endContainer), fo: r.endOffset };
}
export function restaurerSelection(racine, sel) {
  if (!sel) return false;
  const a = noeudChemin(racine, sel.a), f = noeudChemin(racine, sel.f);
  if (!a || !f) return false;
  try {
    const r = document.createRange();
    r.setStart(a, Math.min(sel.ao, a.nodeType === 3 ? a.length : a.childNodes.length));
    r.setEnd(f, Math.min(sel.fo, f.nodeType === 3 ? f.length : f.childNodes.length));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true;
  } catch { return false; }
}
export function plageCourante(racine) {
  const s = getSelection(); if (!s.rangeCount) return null;
  const r = s.getRangeAt(0); return racine.contains(r.commonAncestorContainer) ? r : null;
}
export function blocDe(n, racine) {
  while (n && n !== racine) { if (n.nodeType === 1 && ESTBLOC.has(n.tagName) && !(n.tagName === 'DIV' && n.parentNode !== racine && n.closest('td,th'))) return n; n = n.parentNode; }
  return null;
}
/** Blocs de texte touchés par la sélection (paragraphes, titres, éléments de liste, cellules). */
export function blocsSelection(racine) {
  const r = plageCourante(racine); if (!r) return [];
  const debut = blocDe(r.startContainer, racine), fin = blocDe(r.endContainer, racine);
  if (debut && debut === fin) return [debut];
  const res = [];
  const w = document.createTreeWalker(racine, NodeFilter.SHOW_ELEMENT, { acceptNode: n => ESTBLOC.has(n.tagName) && n.tagName !== 'DIV' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP });
  let n; while ((n = w.nextNode())) {
    if (!r.intersectsNode(n)) continue;
    // ne garder que les blocs « feuilles » (sans bloc enfant)
    if ([...n.children].some(c => ESTBLOC.has(c.tagName) && c.tagName !== 'DIV')) continue;
    res.push(n);
  }
  if (!res.length && debut) res.push(debut);
  return res;
}

// ---------- Historique par instantanés ----------
export class HistoriqueDoc {
  constructor(racine, limite = 120) { this.racine = racine; this.pile = []; this.futur = []; this.limite = limite; this.images = new Map(); this.inverses = new Map(); this.n = 0; }
  compresser(html) {
    return html.replace(/src="(data:[^"]{200,})"/g, (m, d) => {
      let k = this.images.get(d); if (!k) { k = 'atelier-img:' + (++this.n); this.images.set(d, k); this.inverses.set(k, d); }
      return `src="${k}"`;
    });
  }
  decompresser(html) { return html.replace(/src="(atelier-img:\d+)"/g, (m, k) => `src="${this.inverses.get(k) || ''}"`); }
  instantane(extra) { return { html: this.compresser(this.racine.innerHTML), sel: sauverSelection(this.racine), extra: extra ? JSON.stringify(extra) : null }; }
  pousser(extra) {
    const s = this.instantane(extra);
    const d = this.pile[this.pile.length - 1];
    if (d && d.html === s.html && d.extra === s.extra) return;
    this.pile.push(s); if (this.pile.length > this.limite) this.pile.shift();
    this.futur = [];
  }
  annuler(extra) {
    if (!this.pile.length) return null;
    const cour = this.instantane(extra);
    let p = this.pile.pop();
    while (p && p.html === cour.html && p.extra === cour.extra && this.pile.length) p = this.pile.pop();
    if (!p || (p.html === cour.html && p.extra === cour.extra)) return null;
    this.futur.push(cour); return this.appliquer(p);
  }
  retablir(extra) {
    if (!this.futur.length) return null;
    this.pile.push(this.instantane(extra));
    return this.appliquer(this.futur.pop());
  }
  appliquer(s) { this.racine.innerHTML = this.decompresser(s.html); restaurerSelection(this.racine, s.sel); return s.extra ? JSON.parse(s.extra) : {}; }
  vider() { this.pile = []; this.futur = []; }
}

// ---------- Pagination ----------
// Repousse au début de la page suivante tout bloc qui déborderait de la zone de texte d'une page,
// sans modifier le document : les décalages sont écrits dans une feuille de style dédiée.
export function paginer(feuille, styleEl, geo) {
  const { H, G, mt, mb } = geo;
  const pas = H + G;
  styleEl.textContent = '';
  const regles = [];
  const pagesBlocs = new Map();
  const util = H - mt - mb;
  const candidats = [];
  const parcourir = (parent, sel) => {
    [...parent.children].forEach((c, i) => {
      const s = `${sel}>:nth-child(${i + 1})`;
      candidats.push({ el: c, s });
    });
  };
  parcourir(feuille, '#feuille');
  // Mesure initiale
  let decalage = 0, maxPage = 0, forcer = false;
  const fr = feuille.getBoundingClientRect();
  const mesurer = (el) => { const r = el.getBoundingClientRect(); return { top: r.top - fr.top, h: r.height }; };
  const echelle = fr.height / feuille.offsetHeight || 1;
  const liste = [];
  for (const c of candidats) {
    const el = c.el;
    // descendre dans les listes et citations hautes pour paginer élément par élément
    if ((el.tagName === 'UL' || el.tagName === 'OL' || el.tagName === 'BLOCKQUOTE' || (el.tagName === 'DIV' && !el.classList.contains('sommaire'))) && el.offsetHeight > util * 0.5 && el.children.length > 1) {
      [...el.children].forEach((k, j) => liste.push({ el: k, s: `${c.s}>:nth-child(${j + 1})`, parent: el }));
    } else liste.push(c);
  }
  const mesures = liste.map(c => { const m = mesurer(c.el); return { ...c, top: m.top / echelle, h: m.h / echelle, mt: parseFloat(getComputedStyle(c.el).marginTop) || 0 }; });
  for (const m of mesures) {
    const el = m.el;
    if (el.tagName === 'HR' && el.classList.contains('saut-page')) { forcer = true; const k = Math.floor((m.top + decalage) / pas); pagesBlocs.set(el, k); maxPage = Math.max(maxPage, k); continue; }
    const top = m.top + decalage;
    let k = Math.floor(top / pas);
    const basContenu = k * pas + H - mb;
    const hautContenu = k * pas + mt;
    const enGap = top > basContenu - 0.5;
    const deborde = top + m.h > basContenu + 0.5;
    if (forcer || enGap || (deborde && m.h <= util && top > hautContenu + 2)) {
      const cible = (k + 1) * pas + mt;
      // appliquer puis mesurer : la fusion des marges rend le décalage réel différent du décalage demandé
      let marge = m.mt + (cible - top);
      regles.push(null);
      for (let essai = 0; essai < 3; essai++) {
        regles[regles.length - 1] = `${m.s}{margin-top:${marge.toFixed(2)}px!important}`;
        styleEl.textContent = regles.join('\n');
        const reel = mesurer(el).top / echelle;
        const ecart = cible - reel;
        if (Math.abs(ecart) < 0.5) break;
        marge += ecart;
      }
      decalage = mesurer(el).top / echelle - m.top;
      k += 1;
    }
    forcer = false;
    pagesBlocs.set(el, k);
    maxPage = Math.max(maxPage, k, Math.floor(Math.max(0, m.top + decalage + m.h - 1) / pas));
  }
  styleEl.textContent = regles.join('\n');
  const hauteurTotale = feuille.scrollHeight;
  const pages = Math.max(maxPage + 1, Math.ceil((hauteurTotale - 1) / pas), 1);
  return { pages, pageDe: el => { let n = el; while (n && n !== feuille) { if (pagesBlocs.has(n)) return pagesBlocs.get(n); n = n.parentNode; } return 0; } };
}

// ---------- Recherche dans le texte ----------
export function chercher(racine, motif, { casse = false, motEntier = false } = {}) {
  if (!motif) return [];
  const textes = []; let tout = '';
  const w = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) { textes.push({ n, debut: tout.length }); tout += n.nodeValue; }
  const esc = motif.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(motEntier ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])` : esc, 'gu' + (casse ? '' : 'i'));
  const res = []; let m;
  const pos = i => { let lo = 0, hi = textes.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (textes[mid].debut <= i) lo = mid; else hi = mid - 1; } return textes[lo]; };
  while ((m = re.exec(tout))) {
    if (!m[0].length) { re.lastIndex++; continue; }
    const a = pos(m.index), b = pos(m.index + m[0].length - 1);
    const r = document.createRange();
    r.setStart(a.n, m.index - a.debut); r.setEnd(b.n, m.index + m[0].length - b.debut);
    res.push(r);
  }
  return res;
}

// ---------- Statistiques ----------
export function statistiques(racine) {
  const t = racine.innerText || '';
  const mots = (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;
  return { mots, caracteres: t.replace(/\n/g, '').length, caracteresSansEspaces: t.replace(/\s/g, '').length, paragraphes: [...racine.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre')].filter(p => p.textContent.trim()).length };
}
