// Publipostage — moteur de fusion : données (Excel, CSV, ODS) × modèle (Word .docx/.dotx/.docm ou texte)
// Syntaxe des champs : {Colonne}, {Colonne|valeur si vide}, «Colonne», ou champs de fusion Word (MERGEFIELD).
import { unzipSync, zipSync, strFromU8, strToU8 } from './commun/vendor/fflate.js';
import * as XLSX from './commun/vendor/xlsx.mjs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const MARQUES = { val: '', fin: '', manque: '', finManque: '' };

// ---------- Données ----------
export const normaliser = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Lit un classeur (xlsx, xlsm, xls, ods, csv) : renvoie { feuilles: [noms], lire(feuille, entetes) }. */
export function lireDonnees(octets, nom) {
  const ext = (/\.([^.]+)$/.exec(nom || '') || [, ''])[1].toLowerCase();
  let wb;
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
    let t = new TextDecoder('utf-8', { fatal: false }).decode(octets).replace(/^﻿/, '');
    if (/�/.test(t)) t = new TextDecoder('windows-1252').decode(octets); // fichiers CSV d'Excel en ANSI
    const premiere = t.split(/\r?\n/)[0] || '';
    const sep = ext === 'tsv' ? '\t' : [';', ',', '\t'].sort((a, b) => premiere.split(b).length - premiere.split(a).length)[0];
    wb = XLSX.read(t, { type: 'string', FS: sep, raw: true });
  } else wb = XLSX.read(octets, { type: 'array', cellDates: false, cellNF: true, cellText: true });
  return {
    feuilles: wb.SheetNames,
    lire(feuille, entetes = true) {
      const ws = wb.Sheets[feuille || wb.SheetNames[0]];
      if (!ws) throw new Error('feuille introuvable');
      const brut = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
      const cellule = (r, c) => { const x = ws[XLSX.utils.encode_cell({ r, c })]; return texteCellule(x); };
      const plage = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };
      const nC = plage.e.c - plage.s.c + 1;
      const lignesTexte = [];
      for (let r = plage.s.r; r <= plage.e.r; r++) { const l = []; for (let c = plage.s.c; c < plage.s.c + nC; c++) l.push(cellule(r, c)); lignesTexte.push(l); }
      let tetes = entetes && lignesTexte.length ? lignesTexte.shift().map((h, i) => String(h || '').trim() || `Colonne ${i + 1}`) : Array.from({ length: nC }, (_, i) => `Colonne ${i + 1}`);
      // en-têtes en double : suffixe
      const vus = new Map(); tetes = tetes.map(h => { const k = h.toLowerCase(); const n = (vus.get(k) || 0) + 1; vus.set(k, n); return n > 1 ? `${h} (${n})` : h; });
      const lignes = lignesTexte.map((l, i) => ({ num: i + (entetes ? 2 : 1) + plage.s.r, valeurs: l, vide: l.every(v => v === '') }));
      // retirer les colonnes entièrement vides à droite
      while (tetes.length && /^Colonne \d+$/.test(tetes[tetes.length - 1]) && lignes.every(l => l.valeurs[tetes.length - 1] === '')) { tetes.pop(); lignes.forEach(l => l.valeurs.pop()); }
      return { entetes: tetes, lignes, brut };
    },
  };
}
/** Texte d'une cellule tel qu'affiché, en conventions françaises (dates jj/mm/aaaa, virgule décimale). */
export function texteCellule(c) {
  if (!c || c.v === null || c.v === undefined) return '';
  if (c.t === 's' || c.t === 'str') return String(c.v);
  if (c.t === 'b') return c.v ? 'VRAI' : 'FAUX';
  if (c.t === 'e') return c.w || '#ERREUR';
  if (c.t === 'd') return c.v instanceof Date ? c.v.toLocaleDateString('fr-FR') : String(c.v);
  if (c.t === 'n') {
    const z = c.z == null ? 'General' : String(c.z);
    let estDate = false; try { estDate = XLSX.SSF.is_date(z); } catch { }
    if (estDate) {
      if (/^(m\/d\/yy|mm-dd-yy|d\/m\/yy|m\/d\/yyyy|14)$/i.test(z)) return XLSX.SSF.format('dd/mm/yyyy', c.v);
      if (/^m\/d\/yy h:mm$/i.test(z)) return XLSX.SSF.format('dd/mm/yyyy hh:mm', c.v);
      return c.w || XLSX.SSF.format('dd/mm/yyyy', c.v);
    }
    if (z === 'General' || z === '@') { let w = String(c.v); if (/e/i.test(w)) w = XLSX.SSF.format('General', c.v); return w.replace('.', ','); }
    const w = c.w != null ? c.w : XLSX.SSF.format(z, c.v);
    return String(w).replace(/[,.]/g, m => m === ',' ? ' ' : ',').replace(/^(-?)\$\s?([\d ,]+)$/, '$1$2 $');
  }
  return String(c.w ?? c.v);
}

// ---------- Champs ----------
const RE_CHAMP = /\{([^{}]+)\}/g;
export function analyserBalise(t) {
  const i = t.indexOf('|');
  return i >= 0 ? { nom: t.slice(0, i).trim(), defaut: t.slice(i + 1) } : { nom: t.trim(), defaut: null };
}
/** Associe chaque champ du modèle à une colonne (nom exact, puis sans accents ni espaces). */
export function colonneDe(entetes, nom) {
  let i = entetes.indexOf(nom); if (i >= 0) return i;
  const n = normaliser(nom); i = entetes.findIndex(h => normaliser(h) === n);
  if (i < 0 && /^M_\d/i.test(nom)) { const n2 = normaliser(nom.slice(2)); i = entetes.findIndex(h => normaliser(h) === n2); }
  return i;
}
/** Valeur d'un champ pour une ligne : { texte, manque } */
export function valeurChamp(entetes, ligne, balise) {
  const { nom, defaut } = analyserBalise(balise);
  if (nom === '#') return { texte: String(ligne.rang ?? ''), manque: false };
  const i = colonneDe(entetes, nom);
  const v = i >= 0 ? String(ligne.valeurs[i] ?? '') : '';
  if (v.trim() === '') return defaut !== null ? { texte: defaut, manque: false, defaut: true } : { texte: '', manque: true, sansColonne: i < 0 };
  return { texte: v, manque: false };
}

// ---------- Modèle Word ----------
const enfants = (n, nom) => [...n.childNodes].filter(c => c.localName === nom && c.namespaceURI === W);
function mergeName(instr) { const m = /^\s*MERGEFIELD\s+(?:"([^"]+)"|(\S+))/i.exec(instr || ''); return m ? (m[1] || m[2]).trim() : null; }
function rPrClone(r) { const p = r && r.getElementsByTagNameNS(W, 'rPr')[0]; return p ? p.cloneNode(true) : null; }
function makeRun(doc, text, rPr) { const r = doc.createElementNS(W, 'w:r'); if (rPr) r.appendChild(rPr); const t = doc.createElementNS(W, 'w:t'); t.setAttribute('xml:space', 'preserve'); t.textContent = text; r.appendChild(t); return r; }
/** Remplace les champs de fusion Word (simples ou complexes) par {Nom}. */
function convertirMergefields(doc) {
  let n = 0;
  for (const fs of [...doc.getElementsByTagNameNS(W, 'fldSimple')]) {
    const name = mergeName(fs.getAttributeNS(W, 'instr') || fs.getAttribute('w:instr')); if (!name) continue;
    fs.parentNode.replaceChild(makeRun(doc, '{' + name + '}', rPrClone(fs.getElementsByTagNameNS(W, 'r')[0])), fs); n++;
  }
  for (const p of [...doc.getElementsByTagNameNS(W, 'p')]) {
    const runs = [...p.getElementsByTagNameNS(W, 'r')]; let i = 0;
    while (i < runs.length) {
      const fc = runs[i].getElementsByTagNameNS(W, 'fldChar')[0];
      if (fc && fc.getAttributeNS(W, 'fldCharType') === 'begin') {
        let depth = 0, j = i, instr = '', phase = 'instr', resRPr = null; const membres = [];
        for (; j < runs.length; j++) {
          const r = runs[j]; membres.push(r);
          const f = r.getElementsByTagNameNS(W, 'fldChar')[0];
          if (f) { const t = f.getAttributeNS(W, 'fldCharType'); if (t === 'begin') depth++; else if (t === 'end') { depth--; if (depth === 0) break; } else if (t === 'separate' && depth === 1) phase = 'result'; continue; }
          if (depth === 1 && phase === 'instr') for (const it of r.getElementsByTagNameNS(W, 'instrText')) instr += it.textContent;
          if (depth === 1 && phase === 'result' && !resRPr) resRPr = rPrClone(r);
        }
        const name = j < runs.length ? mergeName(instr) : null;
        if (name) { membres[0].parentNode.insertBefore(makeRun(doc, '{' + name + '}', resRPr || rPrClone(runs[i])), membres[0]); membres.forEach(m => m.parentNode && m.parentNode.removeChild(m)); n++; i = j + 1; continue; }
        if (j < runs.length && depth === 0) { i = j + 1; continue; }
      }
      i++;
    }
  }
  return n;
}
/** Regroupe dans un seul w:t chaque balise {…} éclatée sur plusieurs morceaux de texte ; convertit «Champ». */
function normaliserBalises(doc, erreurs) {
  for (const p of [...doc.getElementsByTagNameNS(W, 'p')]) {
    const ts = [...p.getElementsByTagNameNS(W, 't')].filter(t => { let a = t.parentNode; while (a && !(a.localName === 'p' && a.namespaceURI === W)) a = a.parentNode; return a === p; });
    if (!ts.length) continue;
    let texte = ts.map(t => t.textContent).join('');
    if (!/[{}«»]/.test(texte)) continue;
    // «Champ» (aspect des champs de fusion dans Word) → {Champ}
    if (/«[^«»{}]+»/.test(texte)) { let k = 0; for (const t of ts) { t.textContent = t.textContent.replace(/«\s*([^«»{}]+?)\s*»/g, '{$1}'); k++; } texte = ts.map(t => t.textContent).join(''); }
    const bornes = []; let pos = 0; for (const t of ts) { bornes.push([pos, pos + t.textContent.length]); pos += t.textContent.length; }
    let profondeur = 0, debut = -1;
    for (let i = 0; i < texte.length; i++) {
      if (texte[i] === '{') { if (profondeur) erreurs.push(`Accolade ouverte deux fois près de « ${texte.slice(Math.max(0, i - 20), i + 20)} »`); profondeur = 1; debut = i; }
      else if (texte[i] === '}') {
        if (!profondeur) { erreurs.push(`Accolade fermante sans ouverture près de « ${texte.slice(Math.max(0, i - 20), i + 20)} »`); continue; }
        profondeur = 0;
        const fin = i + 1;
        const k1 = bornes.findIndex(([a, b]) => debut >= a && debut < b), k2 = bornes.findIndex(([a, b]) => fin - 1 >= a && fin - 1 < b);
        if (k1 >= 0 && k2 > k1) {
          // tout regrouper dans le premier morceau
          const balise = texte.slice(debut, fin);
          const t1 = ts[k1]; t1.textContent = t1.textContent.slice(0, debut - bornes[k1][0]) + balise;
          for (let k = k1 + 1; k < k2; k++) ts[k].textContent = '';
          const t2 = ts[k2]; t2.textContent = t2.textContent.slice(fin - bornes[k2][0]);
          // conserver la suite du premier morceau ? (déjà retirée car la balise s'y termine)
          ts.forEach(t => t.setAttribute('xml:space', 'preserve'));
          // recalcul des bornes
          texte = ts.map(t => t.textContent).join(''); pos = 0; bornes.length = 0; for (const t of ts) { bornes.push([pos, pos + t.textContent.length]); pos += t.textContent.length; }
          i = bornes[k1][1] - 1;
        }
      }
    }
    if (profondeur) erreurs.push(`Accolade ouvrante sans fermeture près de « ${texte.slice(Math.max(0, debut - 10), debut + 30)} »`);
  }
}

const PARTIES_TEXTE = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
/** Prépare un modèle Word. Renvoie { type:'docx', fichiers, parties, champs:[{balise, nom, enTete}], erreurs, avertissements } */
export function preparerModeleWord(octets, nom) {
  let fichiers;
  try { fichiers = unzipSync(octets); } catch (e) { throw new Error('le modèle Word est illisible (archive endommagée ou format non .docx)'); }
  if (!fichiers['word/document.xml']) throw new Error('le fichier ne contient pas de document Word (word/document.xml absent)');
  const erreurs = [], avert = [];
  const parties = {};
  let nMerge = 0;
  for (const k of Object.keys(fichiers).filter(k => PARTIES_TEXTE.test(k))) {
    const xml = strFromU8(fichiers[k]);
    const decl = (xml.match(/^<\?xml[^>]*\?>/) || [''])[0];
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) { erreurs.push(`Partie ${k} illisible`); continue; }
    nMerge += convertirMergefields(doc);
    normaliserBalises(doc, erreurs);
    parties[k] = { decl, xml: new XMLSerializer().serializeToString(doc) };
  }
  // types de modèle : .dotx (modèle) et .docm (macros) → document .docx
  let ct = strFromU8(fichiers['[Content_Types].xml']);
  if (/template\.main\+xml|macroEnabled/.test(ct)) {
    if (/macroEnabled/.test(ct) || fichiers['word/vbaProject.bin']) avert.push('Le modèle contient des macros : elles ne sont pas exécutées et ne sont pas reprises dans les documents produits (.docx).');
    ct = ct.replace(/application\/vnd\.ms-word\.document\.macroEnabled\.main\+xml|application\/vnd\.ms-word\.template\.macroEnabledTemplate\.main\+xml|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.template\.main\+xml/g, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml');
    ct = ct.replace(/<Override PartName="\/word\/vbaData\.xml"[^>]*\/>|<Override PartName="\/word\/vbaProject\.bin"[^>]*\/>/g, '');
    fichiers['[Content_Types].xml'] = strToU8(ct);
    for (const k of ['word/vbaProject.bin', 'word/vbaData.xml', 'word/_rels/vbaProject.bin.rels']) delete fichiers[k];
    if (fichiers['word/_rels/document.xml.rels']) fichiers['word/_rels/document.xml.rels'] = strToU8(strFromU8(fichiers['word/_rels/document.xml.rels']).replace(/<Relationship[^>]*vbaProject[^>]*\/>/g, ''));
  }
  if (fichiers['word/settings.xml']) { const s = strFromU8(fichiers['word/settings.xml']); if (/<w:mailMerge>/.test(s)) { fichiers['word/settings.xml'] = strToU8(s.replace(/<w:mailMerge>[\s\S]*?<\/w:mailMerge>/, '')); avert.push('La source de données de publipostage Word enregistrée dans le modèle est ignorée : les données viennent du tableau choisi ici.'); } }
  const champs = []; const vus = new Set();
  for (const [k, p] of Object.entries(parties)) {
    const texte = p.xml.replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, '').replace(/<[^>]+>/g, '');
    for (const m of texte.matchAll(RE_CHAMP)) { const b = m[1]; if (!b.trim() || vus.has(b + '|' + (k !== 'word/document.xml'))) continue; vus.add(b + '|' + (k !== 'word/document.xml')); champs.push({ balise: b, ...analyserBalise(b), enTete: k !== 'word/document.xml' }); }
  }
  if (nMerge) avert.push(`${nMerge} champ(s) de fusion Word converti(s).`);
  return { type: 'docx', nom, fichiers, parties, champs: dedoublonner(champs), erreurs, avertissements: avert };
}
function dedoublonner(champs) { const m = new Map(); for (const c of champs) { const p = m.get(c.balise); if (p) p.enTete = p.enTete || c.enTete; else m.set(c.balise, { ...c }); } return [...m.values()]; }

function substituer(texte, entetes, ligne, marquer, stats) {
  return texte.replace(RE_CHAMP, (m, b) => {
    const v = valeurChamp(entetes, ligne, b);
    if (v.manque) { stats.manquants.add(analyserBalise(b).nom); return marquer ? MARQUES.manque + analyserBalise(b).nom + MARQUES.finManque : ''; }
    return marquer ? MARQUES.val + v.texte + MARQUES.fin : v.texte;
  });
}
/** Remplace les balises dans les w:t d'un document XML ; gère les retours à la ligne. */
function remplirXml(xml, decl, entetes, ligne, marquer, stats) {
  if (!xml.includes('{')) return decl + xml;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const t of [...doc.getElementsByTagNameNS(W, 't')]) {
    if (!t.textContent.includes('{')) continue;
    const res = substituer(t.textContent, entetes, ligne, marquer, stats);
    const morceaux = res.split(/\r\n|\r|\n/);
    t.textContent = morceaux[0]; t.setAttribute('xml:space', 'preserve');
    let apres = t;
    for (const m of morceaux.slice(1)) {
      const br = doc.createElementNS(W, 'w:br'); const t2 = doc.createElementNS(W, 'w:t'); t2.setAttribute('xml:space', 'preserve'); t2.textContent = m;
      apres.parentNode.insertBefore(br, apres.nextSibling); br.parentNode.insertBefore(t2, br.nextSibling); apres = t2;
    }
  }
  let out = new XMLSerializer().serializeToString(doc);
  if (decl && !/^<\?xml/.test(out)) out = decl + out;
  return out;
}
/** Un document Word rempli pour une ligne. Renvoie { octets, manquants:[noms] } */
export function remplirWord(modele, entetes, ligne, { marquer = false } = {}) {
  const stats = { manquants: new Set() };
  const f = { ...modele.fichiers };
  for (const [k, p] of Object.entries(modele.parties)) f[k] = strToU8(remplirXml(p.xml, p.decl, entetes, ligne, marquer, stats));
  return { octets: zipSync(f, { level: 6 }), manquants: [...stats.manquants] };
}
/** Un seul document Word contenant toutes les lignes, chacune sur une nouvelle page. */
export function remplirWordUnique(modele, entetes, lignes) {
  const stats = { manquants: new Set() };
  const f = { ...modele.fichiers };
  const p = modele.parties['word/document.xml'];
  const doc = new DOMParser().parseFromString(p.xml, 'application/xml');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const els = [...body.childNodes].filter(n => n.nodeType === 1);
  const sect = els.length && els[els.length - 1].localName === 'sectPr' ? els[els.length - 1] : null;
  const contenu = els.filter(e => e !== sect);
  contenu.forEach(e => body.removeChild(e));
  const xmlContenu = contenu.map(e => new XMLSerializer().serializeToString(e));
  let idDessin = 1, idSignet = 1;
  lignes.forEach((ligne, k) => {
    if (k > 0) { const pb = doc.createElementNS(W, 'w:p'); const r = doc.createElementNS(W, 'w:r'); const br = doc.createElementNS(W, 'w:br'); br.setAttributeNS(W, 'w:type', 'page'); r.appendChild(br); pb.appendChild(r); body.insertBefore(pb, sect); }
    for (const x of xmlContenu) {
      const enveloppe = `<w:body xmlns:w="${W}">${x}</w:body>`;
      const rempli = remplirXml(enveloppe, '', entetes, ligne, false, stats);
      const frag = new DOMParser().parseFromString(rempli, 'application/xml').documentElement;
      for (const n of [...frag.childNodes]) body.insertBefore(doc.importNode(n, true), sect);
    }
  });
  // identifiants uniques (images, signets) : Word refuse les doublons
  for (const d of doc.getElementsByTagName('wp:docPr')) d.setAttribute('id', String(idDessin++));
  for (const b of doc.getElementsByTagNameNS(W, 'bookmarkStart')) { const v = String(idSignet++); const id = b.getAttributeNS(W, 'id'); b.setAttributeNS(W, 'w:id', v); const fin = [...doc.getElementsByTagNameNS(W, 'bookmarkEnd')].find(e => e.getAttributeNS(W, 'id') === id && !e.__ok); if (fin) { fin.setAttributeNS(W, 'w:id', v); fin.__ok = true; } }
  let out = new XMLSerializer().serializeToString(doc); if (p.decl && !/^<\?xml/.test(out)) out = p.decl + out;
  f['word/document.xml'] = strToU8(out);
  for (const [k, q] of Object.entries(modele.parties)) if (k !== 'word/document.xml') f[k] = strToU8(remplirXml(q.xml, q.decl, entetes, lignes[0], false, stats));
  return { octets: zipSync(f, { level: 6 }), manquants: [...stats.manquants] };
}

/** Vérifie qu'un .docx produit se relit (archive, XML du document). */
export function verifierDocx(octets) {
  try {
    const z = unzipSync(octets);
    const x = z['word/document.xml']; if (!x) return { ok: false, detail: 'document.xml absent' };
    const d = new DOMParser().parseFromString(strFromU8(x), 'application/xml');
    if (d.getElementsByTagName('parsererror').length) return { ok: false, detail: 'XML du document invalide' };
    return { ok: true, texte: d.documentElement.textContent };
  } catch (e) { return { ok: false, detail: e.message }; }
}

// ---------- Modèle texte ----------
export function preparerModeleTexte(texte, nom = 'Modèle texte') {
  const erreurs = [];
  const champs = dedoublonner([...String(texte).matchAll(RE_CHAMP)].map(m => ({ balise: m[1], ...analyserBalise(m[1]), enTete: false })));
  const ouv = (texte.match(/\{/g) || []).length, fer = (texte.match(/\}/g) || []).length;
  if (ouv !== fer) erreurs.push(`Accolades déséquilibrées : ${ouv} « { » pour ${fer} « } ».`);
  return { type: 'texte', nom, texte: String(texte).replace(/«\s*([^«»{}]+?)\s*»/g, '{$1}'), champs, erreurs, avertissements: [] };
}
export function remplirTexte(modele, entetes, ligne, { marquer = false } = {}) {
  const stats = { manquants: new Set() };
  return { texte: substituer(modele.texte, entetes, ligne, marquer, stats), manquants: [...stats.manquants] };
}
const echapperXml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
/** Document Word minimal à partir de texte (un paragraphe par ligne). */
export function texteVersDocx(texte, titre = 'Document') {
  const corps = String(texte).split(/\r?\n/).map(l => `<w:p>${l ? `<w:r><w:t xml:space="preserve">${echapperXml(l)}</w:t></w:r>` : ''}</w:p>`).join('');
  return docxMinimal(corps, titre);
}
function docxMinimal(corps, titre) {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'word/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/></w:tblBorders></w:tblPr></w:style></w:styles>`),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${echapperXml(titre)}</dc:title><dc:language>fr-FR</dc:language></cp:coreProperties>`),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${corps}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`),
  }, { level: 6 });
}
/** Modèle Word « express » : un tableau Champ / {Champ} à compléter dans Word. */
export function modeleExpress(entetes, titre) {
  const run = (t, b) => `<w:r>${b ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${echapperXml(t)}</w:t></w:r>`;
  let corps = `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run(titre || 'Modèle de publipostage')}</w:p>`;
  corps += `<w:p>${run('Remplacez ce texte par votre courrier. Chaque nom de colonne placé entre accolades, par exemple {' + (entetes[0] || 'Nom') + '}, sera remplacé par la valeur de la ligne. Pour une valeur par défaut : {' + (entetes[0] || 'Nom') + '|Madame, Monsieur}.')}</w:p><w:p/>`;
  corps += `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6000"/></w:tblGrid>`;
  for (const h of entetes) corps += `<w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="EEEAF5"/></w:tcPr><w:p>${run(h, true)}</w:p></w:tc><w:tc><w:p>${run('{' + h + '}')}</w:p></w:tc></w:tr>`;
  corps += '</w:tbl><w:p/>';
  return docxMinimal(corps, titre || 'Modèle');
}

// ---------- Noms de fichiers ----------
const RESERVES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** Nom de fichier sûr pour Windows (caractères interdits, noms réservés, longueur). */
export function nomSur(s, defaut = 'Document') {
  let n = String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '').slice(0, 150).replace(/[ .]+$/, '');
  if (RESERVES.test(n)) n = '_' + n;
  return n || defaut;
}
/** Noms prévus pour chaque ligne, uniques (insensible à la casse) et distincts des fichiers déjà présents. */
export function nomsPrevus(motif, entetes, lignes, ext, existants = []) {
  const pris = new Set(existants.map(n => n.toLowerCase()));
  const doublons = [];
  const res = lignes.map((l, k) => {
    let base = nomSur(motif.replace(/\{([^{}]+)\}/g, (m, b) => b.trim() === '#' ? String(k + 1).padStart(3, '0') : valeurChamp(entetes, { ...l, rang: k + 1 }, b).texte).replace(/\.(pdf|docx?|txt)$/i, '').replace(/([_\- ])[_\- ]+/g, '$1').replace(/^[_\- ]+|[_\- ]+$/g, ''), 'Document_' + String(k + 1).padStart(3, '0'));
    let nom = base, c = 2;
    if (pris.has((nom + '.' + ext).toLowerCase())) doublons.push(l.num);
    while (pris.has((nom + '.' + ext).toLowerCase())) nom = `${base} (${c++})`;
    pris.add((nom + '.' + ext).toLowerCase());
    return nom + '.' + ext;
  });
  return { noms: res, doublons };
}

// ---------- Contrôles ----------
const RE_EMAIL = /^[^\s@;,<>]+@[^\s@;,<>]+\.[^\s@;,<>]{2,}$/;
export function colonneEmail(entetes, lignes) {
  let best = -1, score = 0;
  entetes.forEach((h, k) => { const n = lignes.filter(l => RE_EMAIL.test(String(l.valeurs[k]).trim())).length; const sc = n + (/mail|courriel/i.test(h) ? 0.5 : 0); if (n && sc > score) { score = sc; best = k; } });
  return best;
}
/**
 * Contrôle avant génération. Renvoie [{gravite:'erreur'|'alerte'|'info', titre, detail, lignes?}]
 */
export function controler(modele, entetes, lignes, motif, ext) {
  const pts = [];
  const pt = (gravite, titre, detail, l) => pts.push({ gravite, titre, detail, lignes: l });
  if (!lignes.length) pt('erreur', 'Aucune ligne sélectionnée', 'Cochez au moins une ligne de données.');
  for (const e of modele.erreurs || []) pt('erreur', 'Modèle à corriger', e);
  if (!modele.champs.length) pt('alerte', 'Aucun champ dans le modèle', 'Le modèle ne contient aucun {Champ} : tous les documents seront identiques.');
  const sansCol = modele.champs.filter(c => c.nom !== '#' && colonneDe(entetes, c.nom) < 0);
  for (const c of sansCol) pt(c.defaut !== null ? 'info' : 'alerte', `Champ {${c.nom}} sans colonne correspondante`, c.defaut !== null ? `La valeur par défaut « ${c.defaut} » sera utilisée.` : 'Il restera vide dans tous les documents. Vérifiez l\'orthographe ou ajoutez la colonne.');
  for (const c of modele.champs.filter(c => c.nom !== '#' && colonneDe(entetes, c.nom) >= 0 && c.defaut === null)) {
    const i = colonneDe(entetes, c.nom);
    const vides = lignes.filter(l => String(l.valeurs[i] ?? '').trim() === '');
    if (vides.length) pt('alerte', `{${c.nom}} vide pour ${vides.length} ligne(s)`, `Lignes ${vides.slice(0, 12).map(l => l.num).join(', ')}${vides.length > 12 ? '…' : ''}. Astuce : {${c.nom}|texte de remplacement} fixe une valeur par défaut.`, vides.map(l => l.num));
  }
  if (modele.champs.some(c => c.enTete) && modele.type === 'docx') pt('info', 'Champs dans l\'en-tête ou le pied de page', 'Ils sont remplis pour chaque document séparé ; dans un document unique, la première ligne est utilisée.');
  // doublons
  const cle = l => l.valeurs.map(v => String(v).trim().toLowerCase()).join('\u0001');
  const vus = new Map(); const dbl = [];
  for (const l of lignes) { const k = cle(l); if (vus.has(k)) dbl.push(l.num); else vus.set(k, l.num); }
  if (dbl.length) pt('alerte', `${dbl.length} ligne(s) en double`, `Lignes identiques à une ligne précédente : ${dbl.slice(0, 12).join(', ')}. Décochez-les si elles ne doivent pas être produites deux fois.`, dbl);
  const ce = colonneEmail(entetes, lignes);
  if (ce >= 0) {
    const vusM = new Map(), dblM = [], inval = [];
    for (const l of lignes) { const m = String(l.valeurs[ce] ?? '').trim().toLowerCase(); if (!m) { inval.push(l.num); continue; } if (!RE_EMAIL.test(m)) inval.push(l.num); else if (vusM.has(m)) dblM.push(l.num); else vusM.set(m, l.num); }
    if (dblM.length) pt('alerte', `Adresse en double dans « ${entetes[ce]} »`, `Lignes ${dblM.slice(0, 12).join(', ')} : même destinataire qu'une ligne précédente.`, dblM);
    if (inval.length) pt('alerte', `Adresse absente ou invalide dans « ${entetes[ce]} »`, `Lignes ${inval.slice(0, 12).join(', ')}${inval.length > 12 ? '…' : ''}.`, inval);
  }
  if (motif) {
    const { doublons } = nomsPrevus(motif, entetes, lignes, ext);
    if (doublons.length) pt('info', `${doublons.length} nom(s) de fichier identique(s)`, `Un numéro « (2) », « (3) »… est ajouté pour ne rien écraser (lignes ${doublons.slice(0, 12).join(', ')}). Ajoutez une colonne au motif pour des noms distincts.`, doublons);
  }
  if (!pts.some(p => p.gravite !== 'info')) pts.unshift({ gravite: 'ok', titre: 'Prêt', detail: `${lignes.length} document(s) seront produits.` });
  return pts;
}
export const EMAIL = RE_EMAIL;
