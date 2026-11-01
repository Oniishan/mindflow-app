// Suite Acad’ — rendu PDF prévisible d'un contenu HTML (Texte, Publipostage)
//
// Mise en page déterministe avec pdf-lib (window.PDFLib, chargé par <script>) et les polices
// standard PDF (Helvetica, Times, Courier) : le même document donne toujours le même PDF,
// indépendamment de l'imprimante ou du pilote installé.
// Pris en charge : titres, paragraphes (alignements, retrait), listes à puces et numérotées
// (imbriquées), tableaux simples, citations, texte préformaté, gras/italique/souligné/barré,
// couleurs, tailles, liens, sauts de ligne et de page, images PNG/JPEG intégrées, filets.
// Limites (signalées dans `avertissements`) : polices du document remplacées par les polices
// standard, caractères hors Windows-1252 remplacés, images externes ou d'autres formats ignorées,
// fusion de cellules et flottants non reproduits.

const MM = 72 / 25.4;
export const FORMATS_PAGE = { A4: [210, 297], A5: [148, 210], A3: [297, 420], Letter: [215.9, 279.4] };
const TAILLES_TITRES = { H1: 20, H2: 16, H3: 13.5, H4: 12, H5: 11, H6: 10.5 };

function couleurCss(c) {
  if (!c) return null;
  let m = /^#([0-9a-f]{3})$/i.exec(c); if (m) c = '#' + [...m[1]].map(x => x + x).join('');
  m = /^#([0-9a-f]{6})$/i.exec(c); if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255);
  m = /rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?/.exec(c); if (m) { if (m[4] !== undefined && +m[4] === 0) return null; return [m[1], m[2], m[3]].map(v => +v / 255); }
  const noms = { black: [0, 0, 0], red: [0.8, 0, 0], blue: [0, 0, 0.8], green: [0, 0.5, 0], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5], white: [1, 1, 1] };
  return noms[String(c).toLowerCase()] || null;
}
function tailleCss(v, base) {
  if (!v) return null; const m = /^([\d.]+)(pt|px|em|rem|%)?$/.exec(String(v).trim()); if (!m) return null;
  const n = +m[1]; return { pt: n, px: n * 0.75, em: n * base, rem: n * 11, '%': n * base / 100 }[m[2] || 'px'];
}

/**
 * Rend un élément (ou du HTML) en PDF.
 * options : { format: 'A4', paysage, marges: {haut, bas, gauche, droite} (mm), police: 'sans'|'serif',
 *             taille: 11 (pt), titre, auteur, numeros: true }
 * Renvoie { octets: Uint8Array, pages, avertissements: [] }.
 */
export async function htmlVersPdf(source, options = {}) {
  const L = window.PDFLib; if (!L) throw new Error('module PDF indisponible');
  const o = { format: 'A4', paysage: false, marges: { haut: 20, bas: 20, gauche: 20, droite: 20 }, police: 'sans', taille: 11, numeros: true, ...options };
  o.marges = { haut: 20, bas: 20, gauche: 20, droite: 20, ...(options.marges || {}) };
  let racine = source;
  if (typeof source === 'string') { racine = document.createElement('div'); racine.innerHTML = source; }
  const avert = new Set(); const remplaces = new Set();
  const pdf = await L.PDFDocument.create();
  if (o.titre) pdf.setTitle(String(o.titre)); if (o.auteur) pdf.setAuthor(String(o.auteur));
  pdf.setCreator('Suite Acad’'); pdf.setProducer('Suite Acad’ — rendu PDF');
  const F = L.StandardFonts;
  const familles = {
    sans: [F.Helvetica, F.HelveticaBold, F.HelveticaOblique, F.HelveticaBoldOblique],
    serif: [F.TimesRoman, F.TimesRomanBold, F.TimesRomanItalic, F.TimesRomanBoldItalic],
    mono: [F.Courier, F.CourierBold, F.CourierOblique, F.CourierBoldOblique],
  };
  const cachePolices = {};
  const police = async (fam, g, i) => { const k = fam + g + i; if (!cachePolices[k]) cachePolices[k] = await pdf.embedFont(familles[fam][(g ? 1 : 0) + (i ? 2 : 0)]); return cachePolices[k]; };
  const encodable = new Map();
  const nettoyerTexte = (fnt, t) => {
    let r = '';
    for (const ch of t) {
      let ok = encodable.get(ch);
      if (ok === undefined) { try { fnt.encodeText(ch); ok = true; } catch { ok = false; } encodable.set(ch, ok); }
      if (ok) r += ch;
      else { const rep = { '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ', ' ': ' ', ' ': ' ', '→': '->', '•': '-', '☐': '[ ]', '☑': '[x]', '✓': 'v' }[ch]; if (rep !== undefined && [...rep].every(c => { try { fnt.encodeText(c); return true; } catch { return false; } })) r += rep; else { r += '?'; remplaces.add(ch); } }
    }
    return r;
  };

  // ---------- 1. Analyse du HTML en blocs de lignes ----------
  const [lp, hp] = FORMATS_PAGE[o.format] || FORMATS_PAGE.A4;
  const largeurPage = (o.paysage ? hp : lp) * MM, hauteurPage = (o.paysage ? lp : hp) * MM;
  const x0 = o.marges.gauche * MM, largeurUtile = largeurPage - (o.marges.gauche + o.marges.droite) * MM;
  const yHaut = hauteurPage - o.marges.haut * MM, yBas = o.marges.bas * MM + (o.numeros ? 14 : 0);

  const blocs = []; // {type:'texte', segments, align, retrait, avant, apres, taille, puce} | {type:'tableau'} | {type:'image'} | {type:'saut'} | {type:'filet'}
  const styleBase = { fam: o.police === 'serif' ? 'serif' : 'sans', gras: false, italique: false, souligne: false, barre: false, couleur: [0, 0, 0], taille: o.taille, lien: null };
  function styleDe(el, herite) {
    const s = { ...herite }; const tag = el.tagName;
    if (tag === 'B' || tag === 'STRONG' || /^H[1-6]$/.test(tag) || tag === 'TH') s.gras = true;
    if (tag === 'I' || tag === 'EM' || tag === 'CITE') s.italique = true;
    if (tag === 'U' || tag === 'INS') s.souligne = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.barre = true;
    if (tag === 'CODE' || tag === 'PRE' || tag === 'KBD' || tag === 'TT') s.fam = 'mono';
    if (tag === 'A' && el.getAttribute('href')) { s.lien = el.getAttribute('href'); s.couleur = [0.05, 0.27, 0.73]; s.souligne = true; }
    if (TAILLES_TITRES[tag]) s.taille = TAILLES_TITRES[tag] * o.taille / 11;
    if (tag === 'SMALL' || tag === 'SUB' || tag === 'SUP') s.taille = s.taille * 0.8;
    const st = el.style || {};
    if (st.fontWeight && (st.fontWeight === 'bold' || +st.fontWeight >= 600)) s.gras = true; else if (st.fontWeight === 'normal' || (+st.fontWeight && +st.fontWeight < 600)) s.gras = false;
    if (st.fontStyle === 'italic' || st.fontStyle === 'oblique') s.italique = true; else if (st.fontStyle === 'normal') s.italique = false;
    const td = (st.textDecoration || st.textDecorationLine || '');
    if (/underline/.test(td)) s.souligne = true; if (/line-through/.test(td)) s.barre = true;
    const c = couleurCss(st.color || el.getAttribute?.('color')); if (c) s.couleur = c;
    const t = tailleCss(st.fontSize, s.taille); if (t) s.taille = Math.max(5, Math.min(72, t));
    const ff = (st.fontFamily || '').toLowerCase();
    if (/mono|courier|consolas/.test(ff)) s.fam = 'mono'; else if (/times|georgia|serif(?!-)|garamond|cambria|palatino/.test(ff) && !/sans/.test(ff)) s.fam = 'serif'; else if (ff) s.fam = 'sans';
    if (ff && !/mono|courier|consolas|times|georgia|serif|garamond|cambria|palatino|arial|helvetica|calibri|sans|segoe|marianne|atkinson|verdana|tahoma|inherit/.test(ff)) avert.add('Certaines polices du document sont remplacées par Helvetica, Times ou Courier.');
    return s;
  }
  const alignDe = el => { const a = (el.style?.textAlign || el.getAttribute?.('align') || '').toLowerCase(); return { center: 'centre', right: 'droite', justify: 'justifie', end: 'droite' }[a] || 'gauche'; };
  const estBloc = el => /^(P|DIV|H[1-6]|UL|OL|LI|TABLE|BLOCKQUOTE|PRE|HR|SECTION|ARTICLE|HEADER|FOOTER|FIGURE|FIGCAPTION|ADDRESS|DL|DT|DD|NAV|ASIDE|MAIN)$/.test(el.tagName);
  const sautAvant = el => /page-break-before:\s*always|break-before:\s*page/.test(el.getAttribute?.('style') || '') || el.classList?.contains('saut-page');
  const sautApres = el => /page-break-after:\s*always|break-after:\s*page/.test(el.getAttribute?.('style') || '');

  function segmentsDe(el, style, pre = false) {
    const segs = [];
    const parcourir = (n, s) => {
      if (n.nodeType === 3) { let t = n.nodeValue; if (!pre) t = t.replace(/[\t\n\r ]+/g, ' '); if (t) segs.push({ t, s }); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (tag === 'BR') { segs.push({ br: true, s }); return; }
      if (tag === 'IMG') { if (n.getAttribute('src')) avert.add('Les images placées dans le texte d\'un paragraphe sont ignorées ; seules les images seules sur leur ligne sont reproduites.'); return; }
      if (tag === 'SCRIPT' || tag === 'STYLE' || n.hidden || n.style?.display === 'none') return;
      if (tag === 'INPUT' && n.type === 'checkbox') { segs.push({ t: n.checked ? '[x] ' : '[ ] ', s }); return; }
      const s2 = styleDe(n, s);
      for (const c of n.childNodes) parcourir(c, s2);
    };
    for (const c of el.childNodes) parcourir(c, style);
    return segs;
  }
  function ajouterTexte(el, style, { retrait = 0, puce = null, avant = 0, apres = 6, pre = false, filetGauche = false } = {}) {
    // le contenu en ligne d'un bloc, en séparant les sous-blocs éventuels
    let courant = [];
    const vider = () => { if (courant.length && courant.some(x => x.br || x.t.trim())) { blocs.push({ type: 'texte', segments: courant, align: alignDe(el), retrait, puce, avant, apres, pre, filetGauche }); puce = null; avant = 0; } courant = []; };
    for (const n of el.childNodes) {
      if (n.nodeType === 1 && (estBloc(n) || n.tagName === 'IMG' && el.childNodes.length === 1)) { vider(); bloc(n, style, retrait); continue; }
      if (n.nodeType === 1 && n.tagName === 'IMG') { vider(); bloc(n, style, retrait); continue; }
      const tmp = document.createElement('span'); tmp.appendChild(n.cloneNode(true));
      courant.push(...segmentsDe(tmp, style, pre));
    }
    vider();
  }
  function bloc(el, herite, retrait = 0) {
    if (el.nodeType === 3) { if (el.nodeValue.trim()) blocs.push({ type: 'texte', segments: [{ t: el.nodeValue.replace(/\s+/g, ' '), s: herite }], align: 'gauche', retrait, apres: 6 }); return; }
    if (el.nodeType !== 1) return;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || el.hidden || el.style?.display === 'none') return;
    if (sautAvant(el)) blocs.push({ type: 'saut' });
    const s = styleDe(el, herite);
    if (/^H[1-6]$/.test(tag)) ajouterTexte(el, s, { retrait, avant: s.taille * 0.6, apres: s.taille * 0.35 });
    else if (tag === 'P' || tag === 'ADDRESS' || tag === 'FIGCAPTION' || tag === 'DT' || tag === 'DD') {
      const ti = tailleCss(el.style?.marginLeft || el.style?.paddingLeft, s.taille) || 0;
      ajouterTexte(el, s, { retrait: retrait + ti + (tag === 'DD' ? 18 : 0), apres: tailleCss(el.style?.marginBottom, s.taille) ?? 6 });
    }
    else if (tag === 'PRE') ajouterTexte(el, { ...s, fam: 'mono', taille: s.taille * 0.9 }, { retrait, pre: true });
    else if (tag === 'BLOCKQUOTE') ajouterTexte(el, { ...s, italique: true }, { retrait: retrait + 18, filetGauche: true });
    else if (tag === 'UL' || tag === 'OL') {
      let n = +(el.getAttribute('start') || 1);
      const type = el.getAttribute('type') || el.style?.listStyleType || '';
      for (const li of el.children) {
        if (li.tagName !== 'LI') { bloc(li, s, retrait + 18); continue; }
        const coche = li.querySelector(':scope > input[type=checkbox]') || (li.dataset?.coche !== undefined ? li : null);
        const puce = tag === 'OL' ? (/alpha|^a$/i.test(type) ? String.fromCharCode(96 + n) + '.' : /roman|^i$/i.test(type) ? ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][n - 1] + '.' : n + '.') : (coche ? '' : '-');
        n++;
        ajouterTexte(li, styleDe(li, s), { retrait: retrait + 18, puce, apres: 2 });
      }
      if (blocs.length) blocs[blocs.length - 1].apres = Math.max(blocs[blocs.length - 1].apres || 0, 6);
    }
    else if (tag === 'TABLE') {
      const lignes = [...el.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr')].map(tr => [...tr.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH').map(c => ({ segs: segmentsDe(c, styleDe(c, s)), align: alignDe(c), fond: couleurCss(c.style?.backgroundColor || c.getAttribute('bgcolor')), entete: c.tagName === 'TH', fusion: (+c.colSpan || 1) })));
      if (lignes.some(l => l.some(c => c.fusion > 1))) avert.add('Les cellules fusionnées des tableaux sont reproduites sans fusion.');
      if (lignes.length) blocs.push({ type: 'tableau', lignes, bordure: el.getAttribute('border') !== '0' && !/border:\s*(none|0)/.test(el.getAttribute('style') || ''), retrait });
    }
    else if (tag === 'HR') blocs.push({ type: 'filet', retrait });
    else if (tag === 'IMG') blocs.push({ type: 'image', src: el.getAttribute('src'), largeur: +el.getAttribute('width') || el.naturalWidth || 0, hauteur: +el.getAttribute('height') || el.naturalHeight || 0, align: alignDe(el.parentElement || el) });
    else if (tag === 'BR') blocs.push({ type: 'texte', segments: [{ t: ' ', s }], align: 'gauche', retrait, apres: 0 });
    else if (estBloc(el) || el.childNodes.length) ajouterTexte(el, s, { retrait });
    if (sautApres(el)) blocs.push({ type: 'saut' });
  }
  for (const n of racine.childNodes) bloc(n, styleBase, 0);

  // ---------- 2. Mise en page ----------
  let page = null, y = 0, numPage = 0;
  const nouvellePage = () => { page = pdf.addPage([largeurPage, hauteurPage]); y = yHaut; numPage++; };
  nouvellePage();
  const interligne = taille => taille * 1.25;

  /** Découpe des segments en lignes de largeur maximale `largeur`. */
  async function couperLignes(segments, largeur, pre) {
    const mots = []; // {t, s, fnt, l, espace}
    for (const sg of segments) {
      if (sg.br) { mots.push({ br: true, s: sg.s }); continue; }
      const fnt = await police(sg.s.fam, sg.s.gras, sg.s.italique);
      const t = nettoyerTexte(fnt, sg.t);
      const parts = pre ? t.split(/(\n)/) : t.split(/( +)/);
      for (const p of parts) {
        if (p === '') continue;
        if (p === '\n') { mots.push({ br: true, s: sg.s }); continue; }
        const espace = /^ +$/.test(p);
        mots.push({ t: p, s: sg.s, fnt, l: fnt.widthOfTextAtSize(p, sg.s.taille), espace });
      }
    }
    const lignes = []; let l = { mots: [], largeur: 0, haut: 0 };
    const pousser = (forceFin) => { while (l.mots.length && l.mots[l.mots.length - 1].espace) { l.largeur -= l.mots.pop().l; } l.fin = forceFin; lignes.push(l); l = { mots: [], largeur: 0, haut: 0 }; };
    for (const m of mots) {
      if (m.br) { l.haut = Math.max(l.haut, m.s.taille); pousser(true); continue; }
      if (m.espace && !l.mots.length) continue;
      if (l.largeur + m.l > largeur && l.mots.length && !m.espace) pousser(false);
      // mot plus long que la ligne : coupé par caractères
      if (m.l > largeur) {
        let bout = '';
        for (const ch of m.t) { const w = m.fnt.widthOfTextAtSize(bout + ch, m.s.taille); if (w > largeur && bout) { l.mots.push({ ...m, t: bout, l: m.fnt.widthOfTextAtSize(bout, m.s.taille) }); l.haut = Math.max(l.haut, m.s.taille); pousser(false); bout = ch; } else bout += ch; }
        if (bout) { const w = m.fnt.widthOfTextAtSize(bout, m.s.taille); l.mots.push({ ...m, t: bout, l: w }); l.largeur += w; l.haut = Math.max(l.haut, m.s.taille); }
        continue;
      }
      l.mots.push(m); l.largeur += m.l; l.haut = Math.max(l.haut, m.s.taille);
    }
    if (l.mots.length || !lignes.length) pousser(true);
    lignes.forEach(li => { if (!li.haut) li.haut = segments[0]?.s?.taille || o.taille; });
    return lignes;
  }
  function dessinerLigne(pg, li, x, yBase, largeur, align) {
    let dx = 0, extra = 0;
    const nbEspaces = li.mots.filter(m => m.espace).length;
    if (align === 'centre') dx = (largeur - li.largeur) / 2;
    else if (align === 'droite') dx = largeur - li.largeur;
    else if (align === 'justifie' && !li.fin && nbEspaces) extra = (largeur - li.largeur) / nbEspaces;
    let cx = x + dx;
    for (const m of li.mots) {
      if (m.espace) { cx += m.l + extra; continue; }
      const coul = L.rgb(...m.s.couleur);
      pg.drawText(m.t, { x: cx, y: yBase, size: m.s.taille, font: m.fnt, color: coul });
      if (m.s.souligne) pg.drawLine({ start: { x: cx, y: yBase - m.s.taille * 0.12 }, end: { x: cx + m.l, y: yBase - m.s.taille * 0.12 }, thickness: Math.max(0.4, m.s.taille / 18), color: coul });
      if (m.s.barre) pg.drawLine({ start: { x: cx, y: yBase + m.s.taille * 0.3 }, end: { x: cx + m.l, y: yBase + m.s.taille * 0.3 }, thickness: Math.max(0.4, m.s.taille / 18), color: coul });
      if (m.s.lien && /^(https?:|mailto:)/i.test(m.s.lien)) liens.push({ page: pg, x: cx, y: yBase - 2, l: m.l, h: m.s.taille, url: m.s.lien });
      cx += m.l;
    }
  }
  const liens = [];

  for (const b of blocs) {
    if (b.type === 'saut') { if (y < yHaut - 1) nouvellePage(); continue; }
    if (b.type === 'filet') { if (y - 12 < yBas) nouvellePage(); y -= 6; page.drawLine({ start: { x: x0 + b.retrait, y }, end: { x: x0 + largeurUtile, y }, thickness: 0.7, color: L.rgb(0.6, 0.6, 0.6) }); y -= 8; continue; }
    if (b.type === 'image') {
      const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(b.src || '');
      if (!m) { avert.add('Les images qui ne sont pas intégrées au document (liens externes, formats autres que PNG ou JPEG) sont ignorées.'); continue; }
      try {
        const oct = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
        const img = /png/i.test(m[1]) ? await pdf.embedPng(oct) : await pdf.embedJpg(oct);
        let w = (b.largeur || img.width) * 0.75, h = (b.hauteur || img.height) * 0.75;
        if (b.largeur && !b.hauteur) h = w * img.height / img.width;
        const k = Math.min(1, largeurUtile / w, (yHaut - yBas) / h); w *= k; h *= k;
        if (y - h < yBas) nouvellePage();
        const x = b.align === 'centre' ? x0 + (largeurUtile - w) / 2 : b.align === 'droite' ? x0 + largeurUtile - w : x0;
        page.drawImage(img, { x, y: y - h, width: w, height: h }); y -= h + 6;
      } catch { avert.add('Une image n\'a pas pu être lue et a été ignorée.'); }
      continue;
    }
    if (b.type === 'tableau') {
      const nCol = Math.max(...b.lignes.map(l => l.reduce((n, c) => n + c.fusion, 0)));
      const largeurT = largeurUtile - b.retrait;
      // largeurs proportionnelles au contenu (bornées)
      const besoin = new Array(nCol).fill(20);
      for (const l of b.lignes) { let k = 0; for (const c of l) { const txt = c.segs.map(s => s.t || '').join(''); const w = Math.min(largeurT * 0.6, (txt.length || 1) * o.taille * 0.5 + 8); if (c.fusion === 1) besoin[k] = Math.max(besoin[k], w); k += c.fusion; } }
      const tot = besoin.reduce((a, b) => a + b, 0); const larg = besoin.map(w => w / tot * largeurT);
      for (const l of b.lignes) {
        const cellules = []; let k = 0;
        for (const c of l) { const w = larg.slice(k, k + c.fusion).reduce((a, b) => a + b, 0); const lig = await couperLignes(c.segs.length ? c.segs : [{ t: ' ', s: styleBase }], w - 8, false); cellules.push({ c, x: k, w, lig, h: lig.reduce((a, li) => a + interligne(li.haut), 0) + 6 }); k += c.fusion; }
        const h = Math.max(...cellules.map(c => c.h), 14);
        if (y - h < yBas) nouvellePage();
        let cx = x0 + b.retrait;
        for (const ce of cellules) {
          if (ce.c.fond) page.drawRectangle({ x: cx, y: y - h, width: ce.w, height: h, color: L.rgb(...ce.c.fond) });
          else if (ce.c.entete) page.drawRectangle({ x: cx, y: y - h, width: ce.w, height: h, color: L.rgb(0.94, 0.94, 0.94) });
          if (b.bordure) page.drawRectangle({ x: cx, y: y - h, width: ce.w, height: h, borderColor: L.rgb(0.55, 0.55, 0.55), borderWidth: 0.5 });
          let cy = y - 3;
          for (const li of ce.lig) { cy -= interligne(li.haut); dessinerLigne(page, li, cx + 4, cy + li.haut * 0.25, ce.w - 8, ce.c.align); }
          cx += ce.w;
        }
        y -= h;
      }
      y -= 8; continue;
    }
    // texte
    const ret = b.retrait + (b.puce !== null && b.puce !== undefined ? 0 : 0);
    const lignes = await couperLignes(b.segments, largeurUtile - ret, b.pre);
    y -= b.avant || 0;
    let premiere = true;
    for (const li of lignes) {
      const h = interligne(li.haut);
      if (y - h < yBas) nouvellePage();
      y -= h;
      if (premiere && b.puce) { const s0 = b.segments.find(s => s.s)?.s || styleBase; const fnt = await police(s0.fam, false, false); page.drawText(nettoyerTexte(fnt, b.puce), { x: x0 + ret - 14, y: y + li.haut * 0.25, size: s0.taille, font: fnt, color: L.rgb(...s0.couleur) }); }
      if (b.filetGauche) page.drawLine({ start: { x: x0 + ret - 9, y: y - 2 }, end: { x: x0 + ret - 9, y: y + h - 2 }, thickness: 2, color: L.rgb(0.75, 0.75, 0.75) });
      dessinerLigne(page, li, x0 + ret, y + li.haut * 0.25, largeurUtile - ret, b.align);
      premiere = false;
    }
    y -= b.apres ?? 6;
  }
  // liens cliquables
  for (const l of liens) {
    try {
      const annot = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [l.x, l.y, l.x + l.l, l.y + l.h], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: L.PDFString.of(l.url) } });
      const ref = pdf.context.register(annot);
      const ann = l.page.node.lookup(L.PDFName.of('Annots'));
      if (ann) ann.push(ref); else l.page.node.set(L.PDFName.of('Annots'), pdf.context.obj([ref]));
    } catch { }
  }
  // numéros de page
  if (o.numeros) {
    const fnt = await police('sans', false, false); const n = pdf.getPageCount();
    pdf.getPages().forEach((p, i) => { const t = `${i + 1} / ${n}`; p.drawText(t, { x: (largeurPage - fnt.widthOfTextAtSize(t, 8.5)) / 2, y: o.marges.bas * MM - 4, size: 8.5, font: fnt, color: L.rgb(0.45, 0.45, 0.45) }); });
  }
  if (remplaces.size) avert.add(`${remplaces.size} caractère(s) non disponible(s) dans les polices PDF standard ont été remplacés par « ? » : ${[...remplaces].slice(0, 12).join(' ')}`);
  const octets = await pdf.save({ useObjectStreams: true });
  // contrôle : le PDF produit se relit et contient le bon nombre de pages
  const relu = await L.PDFDocument.load(octets);
  if (relu.getPageCount() !== pdf.getPageCount() || octets.length < 200) throw new Error('le PDF produit ne se relit pas correctement');
  const texteVide = !blocs.some(b => (b.type === 'texte' && b.segments.some(s => s.t && s.t.trim())) || b.type === 'tableau' || b.type === 'image');
  if (texteVide) avert.add('Le document ne contient aucun texte : le PDF produit est une page blanche.');
  return { octets, pages: relu.getPageCount(), avertissements: [...avert], vide: texteVide };
}
