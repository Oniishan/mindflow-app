// PDF — moteur : chargement (pdf.js), construction du PDF final (pdf-lib), conversions
import * as pdfjs from './commun/vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./commun/vendor/pdf.worker.min.mjs', import.meta.url).href;
export { pdfjs };

const L = () => window.PDFLib;
export const A4 = { l: 595.28, h: 841.89 };
export const SOURCES = new Map(); // id -> { id, nom, octets, pdf, motDePasse, pages:[{l,h,vt,rotate}] }
let nSource = 0;

// ---------- Matrices affines [a b c d e f] (convention PDF) ----------
export const compose = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
export const inverse = M => { const [a, b, c, d, e, f] = M; const det = a * d - b * c; return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]; };
export const appliquer = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
const FLIP = [1, 0, 0, -1, 0, 0];
/** base → affichage pour une rotation supplémentaire r (base de dimensions l × h) */
export function matRotation(r, l, h) {
  if (r === 90) return [0, 1, -1, 0, h, 0];
  if (r === 180) return [-1, 0, 0, -1, l, h];
  if (r === 270) return [0, -1, 1, 0, 0, l];
  return [1, 0, 0, 1, 0, 0];
}
export const dimsAffichage = p => (p.rot === 90 || p.rot === 270) ? { l: p.h, h: p.l } : { l: p.l, h: p.h };

// ---------- Chargement ----------
export async function chargerSource(octets, nom, demanderMotDePasse) {
  let motDePasse;
  const tache = pdfjs.getDocument({ data: octets.slice(), isEvalSupported: false, useSystemFonts: true });
  tache.onPassword = async (maj, raison) => {
    const m = demanderMotDePasse ? await demanderMotDePasse(raison === pdfjs.PasswordResponses.INCORRECT_PASSWORD) : null;
    if (m == null) { tache.destroy(); return; }
    motDePasse = m; maj(m);
  };
  let pdf;
  try { pdf = await tache.promise; } catch (e) { if (e?.name === 'PasswordException' || /destroy/i.test(e?.message || '')) throw new Error('mot de passe requis'); throw new Error(e?.name === 'InvalidPDFException' ? 'ce fichier n\'est pas un PDF valide' : (e?.message || String(e))); }
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i); const vp = pg.getViewport({ scale: 1 });
    pages.push({ l: vp.width, h: vp.height, vt: vp.transform, rotate: pg.rotate });
  }
  let meta = {};
  try { const m = await pdf.getMetadata(); meta = { titre: m.info?.Title || '', auteur: m.info?.Author || '', sujet: m.info?.Subject || '', motsCles: m.info?.Keywords || '' }; } catch { }
  const id = 's' + (++nSource) + '-' + Date.now().toString(36);
  const s = { id, nom, octets, pdf, motDePasse, pages, meta, chiffre: !!motDePasse };
  SOURCES.set(id, s);
  return s;
}

/** Crée un PDF minimal d'une page vierge (pour les sources internes) */
export const VT_VIERGE = h => [1, 0, 0, -1, 0, h];
export function infosPage(p) {
  if (!p.src) return { vt: VT_VIERGE(p.h), rotate: 0 };
  const s = SOURCES.get(p.src); return s.pages[p.n];
}

// ---------- Rendu d'une page source sur un canevas ----------
export async function rendrePage(p, canvas, echelle, { formulaires = true } = {}) {
  const ctx = canvas.getContext('2d');
  const W = Math.max(1, Math.round(p.l * echelle)), H = Math.max(1, Math.round(p.h * echelle));
  if (canvas.width !== W) canvas.width = W; if (canvas.height !== H) canvas.height = H;
  if (!p.src) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); return null; }
  const pg = await SOURCES.get(p.src).pdf.getPage(p.n + 1);
  const vp = pg.getViewport({ scale: echelle });
  const t = pg.render({ canvasContext: ctx, viewport: vp, annotationMode: formulaires ? pdfjs.AnnotationMode.ENABLE_FORMS : pdfjs.AnnotationMode.ENABLE, background: '#ffffff' });
  await t.promise;
  return pg;
}

// ---------- Texte compatible avec les polices standard du PDF ----------
const jeuxCaracteres = new WeakMap();
function compatible(font, texte) {
  let j = jeuxCaracteres.get(font); if (!j) { j = new Set(font.getCharacterSet()); jeuxCaracteres.set(font, j); }
  return [...String(texte).replace(/[   ]/g, ' ').replace(/‑/g, '-')].map(c => c === '\n' || j.has(c.codePointAt(0)) ? c : '?').join('');
}
function couper(font, taille, texte, largeur) {
  const lignes = [];
  for (const para of texte.split('\n')) {
    if (!para) { lignes.push(''); continue; }
    const mots = para.split(/( +)/); let ligne = '';
    for (const m of mots) {
      const essai = ligne + m;
      if (font.widthOfTextAtSize(essai.trimEnd(), taille) <= largeur || !ligne.trim()) {
        if (!ligne && font.widthOfTextAtSize(m, taille) > largeur) { // mot trop long : coupe par caractères
          let morceau = ''; for (const c of m) { if (font.widthOfTextAtSize(morceau + c, taille) > largeur && morceau) { lignes.push(morceau); morceau = ''; } morceau += c; } ligne = morceau; continue;
        }
        ligne = essai;
      } else { lignes.push(ligne.trimEnd()); ligne = m.trimStart(); }
    }
    lignes.push(ligne.trimEnd());
  }
  return lignes;
}
export const hexRgb = c => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c || '#000000') || [0, '00', '00', '00']; return L().rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255); };
export const POLICES = { helvetica: 'Helvetica', times: 'TimesRoman', courier: 'Courier' };
const NOMS_POLICES = { helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'], times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'], courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] };

// ---------- Dessin des annotations (dans l'espace de base de la page, unités : points, origine en haut à gauche) ----------
async function dessinerAnnotations(page, annots, ctx) {
  const { degrees, BlendMode, LineCapStyle } = L();
  for (const a of annots) {
    const y = v => -v; // espace local : y vers le haut
    if (a.type === 'rect' || a.type === 'caviardage' || a.type === 'surlignage') {
      const o = { x: a.x, y: y(a.y + a.h), width: a.l, height: a.h };
      if (a.type === 'surlignage') page.drawRectangle({ ...o, color: hexRgb(a.couleur || '#FFE500'), opacity: a.opacite ?? 0.4, blendMode: BlendMode.Multiply });
      else if (a.type === 'caviardage') page.drawRectangle({ ...o, color: hexRgb('#000000') });
      else page.drawRectangle({ ...o, color: a.remplissage && a.remplissage !== 'transparent' ? hexRgb(a.remplissage) : undefined, opacity: a.opacite ?? 1, borderColor: a.couleur && a.couleur !== 'transparent' ? hexRgb(a.couleur) : undefined, borderWidth: a.couleur && a.couleur !== 'transparent' ? a.epaisseur || 2 : 0, borderOpacity: a.opacite ?? 1 });
    } else if (a.type === 'ellipse') {
      page.drawEllipse({ x: a.x + a.l / 2, y: y(a.y + a.h / 2), xScale: a.l / 2, yScale: a.h / 2, color: a.remplissage && a.remplissage !== 'transparent' ? hexRgb(a.remplissage) : undefined, opacity: a.opacite ?? 1, borderColor: a.couleur && a.couleur !== 'transparent' ? hexRgb(a.couleur) : undefined, borderWidth: a.couleur && a.couleur !== 'transparent' ? a.epaisseur || 2 : 0, borderOpacity: a.opacite ?? 1 });
    } else if (a.type === 'ligne' || a.type === 'fleche') {
      const [x1, y1, x2, y2] = a.pts; const ep = a.epaisseur || 2; const c = hexRgb(a.couleur || '#C00000');
      page.drawLine({ start: { x: a.x + x1, y: y(a.y + y1) }, end: { x: a.x + x2, y: y(a.y + y2) }, thickness: ep, color: c, opacity: a.opacite ?? 1, lineCap: LineCapStyle.Round });
      if (a.type === 'fleche') {
        const ang = Math.atan2(y2 - y1, x2 - x1), t = Math.max(8, ep * 4);
        const px = a.x + x2, py = a.y + y2;
        const p1 = [px - t * Math.cos(ang - 0.45), py - t * Math.sin(ang - 0.45)], p2 = [px - t * Math.cos(ang + 0.45), py - t * Math.sin(ang + 0.45)];
        page.drawSvgPath(`M ${px} ${py} L ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} Z`, { x: 0, y: 0, color: c, opacity: a.opacite ?? 1 });
      }
    } else if (a.type === 'trait') {
      if (!a.traits?.length) continue;
      const d = a.traits.map(t => t.length ? `M ${a.x + t[0]} ${a.y + t[1]} ` + t.slice(2).reduce((s, v, i) => s + (i % 2 === 0 ? `L ${a.x + v} ` : `${a.y + v} `), '') : '').join(' ');
      page.drawSvgPath(d, { x: 0, y: 0, borderColor: hexRgb(a.couleur || '#1B2A4A'), borderWidth: a.epaisseur || 2, borderOpacity: a.opacite ?? 1, borderLineCap: LineCapStyle.Round });
    } else if (a.type === 'image') {
      const url = a.src?.startsWith('media:') ? ctx.medias[a.src.slice(6)] : a.src; if (!url) continue;
      let img = ctx.images.get(url);
      if (!img) { const octets = Uint8Array.from(atob(url.split(',')[1]), c => c.charCodeAt(0)); img = /^data:image\/jpe?g/.test(url) ? await ctx.doc.embedJpg(octets) : await ctx.doc.embedPng(octets); ctx.images.set(url, img); }
      page.drawImage(img, { x: a.x, y: y(a.y + a.h), width: a.l, height: a.h, opacity: a.opacite ?? 1 });
    } else if (a.type === 'texte' || a.type === 'tampon') {
      const famille = NOMS_POLICES[a.police || 'helvetica'] || NOMS_POLICES.helvetica;
      const nomF = famille[(a.gras || a.type === 'tampon' ? 1 : 0) + (a.italique ? 2 : 0)];
      let font = ctx.polices.get(nomF); if (!font) { font = await ctx.doc.embedFont(L().StandardFonts[nomF]); ctx.polices.set(nomF, font); }
      const taille = a.taille || 14; const pad = a.type === 'tampon' ? 6 : 4;
      const c = hexRgb(a.couleur || '#1B2A4A');
      if (a.remplissage && a.remplissage !== 'transparent') page.drawRectangle({ x: a.x, y: y(a.y + a.h), width: a.l, height: a.h, color: hexRgb(a.remplissage), opacity: a.opaciteFond ?? 1 });
      if (a.type === 'tampon') page.drawRectangle({ x: a.x, y: y(a.y + a.h), width: a.l, height: a.h, borderColor: c, borderWidth: 2.5, opacity: 0, borderOpacity: a.opacite ?? 0.9 });
      const texte = compatible(font, a.texte || '');
      const lignes = a.type === 'tampon' ? texte.split('\n') : couper(font, taille, texte, Math.max(4, a.l - 2 * pad));
      const hl = taille * 1.2;
      const hauteurTexte = lignes.length * hl;
      let base = a.y + pad + taille * 0.9465;
      if (a.type === 'tampon') base = a.y + (a.h - hauteurTexte) / 2 + taille * 0.9465;
      lignes.forEach((l, i) => {
        const w = font.widthOfTextAtSize(l, taille);
        let x = a.x + pad; if (a.align === 'center' || a.type === 'tampon') x = a.x + (a.l - w) / 2; else if (a.align === 'right') x = a.x + a.l - pad - w;
        if (l) page.drawText(l, { x, y: y(base + i * hl), size: taille, font, color: c, opacity: a.opacite ?? 1 });
        if (a.souligne && l) page.drawLine({ start: { x, y: y(base + i * hl + taille * 0.12) }, end: { x: x + w, y: y(base + i * hl + taille * 0.12) }, thickness: Math.max(0.6, taille / 16), color: c });
      });
      void degrees;
    }
  }
}

// Filigrane et numérotation : dessinés dans l'espace d'affichage (après rotation)
async function dessinerSurcouches(page, P, i, total, dims, ctx) {
  const { degrees } = L();
  if (P.filigrane && P.filigrane.texte) {
    const f = P.filigrane; let font = ctx.polices.get('HelveticaBold'); if (!font) { font = await ctx.doc.embedFont(L().StandardFonts.HelveticaBold); ctx.polices.set('HelveticaBold', font); }
    const t = compatible(font, f.texte); const taille = f.taille || 60; const w = font.widthOfTextAtSize(t, taille); const hc = taille * 0.72;
    const ang = (f.angle ?? 45) * Math.PI / 180; const cx = dims.l / 2, cy = -dims.h / 2;
    const ox = cx - (Math.cos(ang) * w / 2 - Math.sin(ang) * hc / 2), oy = cy - (Math.sin(ang) * w / 2 + Math.cos(ang) * hc / 2);
    page.drawText(t, { x: ox, y: oy, size: taille, font, color: hexRgb(f.couleur || '#B0261E'), opacity: f.opacite ?? 0.2, rotate: degrees(f.angle ?? 45) });
  }
  const N = P.numerotation;
  if (N && !(N.ignorerPremiere && i === 0)) {
    let font = ctx.polices.get('Helvetica'); if (!font) { font = await ctx.doc.embedFont(L().StandardFonts.Helvetica); ctx.polices.set('Helvetica', font); }
    const n = i + (N.debut ?? 1) - (N.ignorerPremiere ? 1 : 0); const tot = total + (N.debut ?? 1) - 1 - (N.ignorerPremiere ? 1 : 0);
    const t = compatible(font, (N.format || 'Page {n} sur {total}').replace('{n}', n).replace('{total}', tot));
    const taille = N.taille || 10, m = N.marge ?? 28; const w = font.widthOfTextAtSize(t, taille);
    const [v, h] = (N.position || 'bas-centre').split('-');
    const x = h === 'gauche' ? m : h === 'droite' ? dims.l - m - w : (dims.l - w) / 2;
    const yb = v === 'haut' ? m + taille * 0.75 : dims.h - m;
    page.drawText(t, { x, y: -yb, size: taille, font, color: hexRgb(N.couleur || '#333333') });
  }
}

/** Rendu d'une page source en image JPEG (pour le caviardage définitif) */
async function rasteriser(p, annots, dpi = 200) {
  const c = document.createElement('canvas');
  await rendrePage(p, c, dpi / 72, { formulaires: false });
  const g = c.getContext('2d'); g.fillStyle = '#000';
  const k = dpi / 72; annots.filter(a => a.type === 'caviardage').forEach(a => g.fillRect(a.x * k, a.y * k, a.l * k, a.h * k));
  const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  return new Uint8Array(await b.arrayBuffer());
}

async function chargerPdfLib(s) {
  const { PDFDocument } = L();
  try { return await PDFDocument.load(s.octets, { password: s.motDePasse ?? '', updateMetadata: false }); }
  catch (e) { if (s.motDePasse) throw e; return PDFDocument.load(s.octets, { ignoreEncryption: true, updateMetadata: false }); }
}

async function remplirChamps(doc, champs, srcId, aplatir) {
  const liste = Object.entries(champs || {}).filter(([k]) => k.startsWith(srcId + '|'));
  if (!liste.length) { if (aplatir) try { const f = doc.getForm(); if (f.getFields().length) { f.updateFieldAppearances(await doc.embedFont(L().StandardFonts.Helvetica)); f.flatten(); } } catch { } return false; }
  const form = doc.getForm(); const font = await doc.embedFont(L().StandardFonts.Helvetica);
  for (const [k, v] of liste) {
    const nom = k.slice(srcId.length + 1);
    let champ; try { champ = form.getField(nom); } catch { continue; }
    const t = champ.constructor.name;
    try {
      if (champ.setText) champ.setText(v == null ? '' : compatible(font, String(v)));
      else if (champ.check && champ.uncheck && !champ.select) v ? champ.check() : champ.uncheck();
      else if (champ.select) { if (v) champ.select(String(v)); else if (champ.clear) champ.clear(); }
    } catch (e) { console.warn('champ', nom, t, e.message); }
  }
  try { form.updateFieldAppearances(font); } catch { }
  if (aplatir) try { form.flatten(); } catch { }
  return true;
}

/**
 * Construit le PDF final.
 * P = { pages:[{id, src, n, l, h, rot, annots}], filigrane, numerotation, meta, protection, champs }
 */
export async function construire(P, { medias = {}, aplatirFormulaires = false } = {}) {
  const { PDFDocument, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = L();
  if (!P.pages.length) throw new Error('le document ne contient aucune page');
  const caviarde = p => p.annots?.some(a => a.type === 'caviardage');
  const s0 = P.pages[0].src;
  const enPlace = s0 && P.pages.every((p, i) => p.src === s0 && (i === 0 || p.n > P.pages[i - 1].n));
  let out; const slots = []; // page pdf-lib + VT de base pour chaque page
  if (enPlace) {
    const s = SOURCES.get(s0); out = await chargerPdfLib(s);
    await remplirChamps(out, P.champs, s0, aplatirFormulaires);
    const garder = new Set(P.pages.map(p => p.n));
    for (let i = out.getPageCount() - 1; i >= 0; i--) if (!garder.has(i)) out.removePage(i);
    if (out.catalog && out.getPageCount() !== P.pages.length) throw new Error('incohérence des pages');
  } else {
    out = await PDFDocument.create();
    const parSource = new Map();
    P.pages.forEach(p => { if (p.src && !caviarde(p)) { if (!parSource.has(p.src)) parSource.set(p.src, []); parSource.get(p.src).push(p.n); } });
    const copies = new Map();
    for (const [sid, indices] of parSource) {
      const doc = await chargerPdfLib(SOURCES.get(sid));
      await remplirChamps(doc, P.champs, sid, true);
      const uniques = [...new Set(indices)];
      const pages = await out.copyPages(doc, uniques);
      uniques.forEach((n, k) => copies.set(sid + '#' + n, { page: pages[k], utilisee: false }));
    }
    for (const p of P.pages) {
      if (p.src && !caviarde(p)) {
        const c = copies.get(p.src + '#' + p.n);
        if (c.utilisee) { const doc = await chargerPdfLib(SOURCES.get(p.src)); await remplirChamps(doc, P.champs, p.src, true); const [cp] = await out.copyPages(doc, [p.n]); out.addPage(cp); }
        else { c.utilisee = true; out.addPage(c.page); }
      } else out.addPage([p.l, p.h]);
    }
  }
  const ctx = { doc: out, medias, images: new Map(), polices: new Map() };
  for (let i = 0; i < P.pages.length; i++) {
    const p = P.pages[i]; let page = out.getPage(i); let vt = infosPage(p).vt, intrinseque = infosPage(p).rotate || 0;
    if (p.src && caviarde(p)) {
      const jpg = await out.embedJpg(await rasteriser(p, p.annots));
      if (enPlace) { out.removePage(i); page = out.insertPage(i, [p.l, p.h]); }
      page.drawImage(jpg, { x: 0, y: 0, width: p.l, height: p.h });
      vt = VT_VIERGE(p.h); intrinseque = 0;
    }
    page.setRotation(degrees((intrinseque + (p.rot || 0)) % 360));
    const annots = (p.annots || []).filter(a => a.type !== 'caviardage' || !p.src);
    const avecSurcouche = P.filigrane?.texte || P.numerotation;
    if (annots.length || (p.src && caviarde(p))) {
      const M = compose(inverse(vt), FLIP);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...M));
      await dessinerAnnotations(page, annots.concat((p.annots || []).filter(a => a.type === 'caviardage')), ctx);
      page.pushOperators(popGraphicsState());
    }
    if (avecSurcouche) {
      const dims = dimsAffichage(p);
      const M = compose(inverse(vt), compose(inverse(matRotation(p.rot || 0, p.l, p.h)), FLIP));
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...M));
      await dessinerSurcouches(page, P, i, P.pages.length, dims, ctx);
      page.pushOperators(popGraphicsState());
    }
  }
  const m = P.meta || {};
  out.setTitle(m.titre || '', { showInWindowTitleBar: !!m.titre }); out.setAuthor(m.auteur || ''); out.setSubject(m.sujet || ''); out.setKeywords(m.motsCles ? m.motsCles.split(/[;,]\s*/) : []);
  out.setProducer('Suite Acad’ PDF'); out.setCreator('Suite Acad’ PDF'); out.setModificationDate(new Date());
  if (P.protection && (P.protection.motDePasse || P.protection.proprietaire)) {
    const pr = P.protection.permissions || {};
    out.encrypt({ userPassword: P.protection.motDePasse || '', ownerPassword: P.protection.proprietaire || P.protection.motDePasse, permissions: { printing: pr.impression === false ? undefined : 'highResolution', modifying: !!pr.modification, copying: pr.copie !== false, annotating: !!pr.modification, fillingForms: pr.formulaires !== false, contentAccessibility: true, documentAssembly: !!pr.modification } });
  }
  return out.save({ useObjectStreams: !P.protection, updateFieldAppearances: false });
}

/** Ouvre des octets PDF avec pdf.js (pour l'impression, les images, le texte) */
export async function ouvrirPourLecture(octets, motDePasse) { return pdfjs.getDocument({ data: octets.slice(), password: motDePasse, isEvalSupported: false, useSystemFonts: true }).promise; }

export async function texteDuDocument(pdf) {
  const parties = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent(); let ligne = '', out = [];
    for (const it of tc.items) { ligne += it.str; if (it.hasEOL) { out.push(ligne); ligne = ''; } }
    if (ligne) out.push(ligne); parties.push(out.join('\n').replace(/[ \t]+\n/g, '\n'));
  }
  return parties.join('\n\f\n');
}

export async function pageEnImage(pdf, i, dpi = 150, type = 'image/png') {
  const pg = await pdf.getPage(i); const vp = pg.getViewport({ scale: dpi / 72 });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await pg.render({ canvasContext: g, viewport: vp }).promise;
  return { canvas: c, l: vp.width * 72 / dpi, h: vp.height * 72 / dpi, blob: await new Promise(r => c.toBlob(r, type, 0.92)) };
}

/** Image (octets) → données d'image utilisables (PNG ou JPEG) */
export async function preparerImage(octets, nom) {
  const ext = (nom.split('.').pop() || '').toLowerCase();
  const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff' }[ext] || 'image/png';
  const url0 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(new Blob([octets], { type })); });
  const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('image illisible : ' + nom)); i.src = url0; });
  let url = url0;
  if (type !== 'image/jpeg' && type !== 'image/png') { const c = document.createElement('canvas'); c.width = img.naturalWidth || 800; c.height = img.naturalHeight || 600; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); url = c.toDataURL('image/png'); }
  return { url, l: img.naturalWidth || 800, h: img.naturalHeight || 600 };
}
