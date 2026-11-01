// Calcul — macros VBA des classeurs .xlsm : identification, conservation à l'identique, contrôles
//
// Calcul n'exécute PAS les macros (aucun interpréteur VBA). Il conserve le projet VBA
// (xl/vbaProject.bin et ses signatures) octet pour octet lorsqu'il enregistre au format .xlsm,
// et vérifie après écriture que le projet est intact.
import { unzipSync, zipSync, strFromU8, strToU8 } from './commun/vendor/fflate.js';

export const PARTIES_VBA = ['xl/vbaProject.bin', 'xl/vbaProjectSignature.bin', 'xl/vbaProjectSignatureAgile.bin', 'xl/vbaProjectSignatureV3.bin', 'xl/_rels/vbaProject.bin.rels'];
const CT_VBA = 'application/vnd.ms-office.vbaProject';
const CT_MAIN_XLSM = 'application/vnd.ms-excel.sheet.macroEnabled.main+xml';
const CT_SIG = { 'xl/vbaProjectSignature.bin': 'application/vnd.ms-office.vbaProjectSignature', 'xl/vbaProjectSignatureAgile.bin': 'application/vnd.ms-office.vbaProjectSignatureAgile', 'xl/vbaProjectSignatureV3.bin': 'application/vnd.ms-office.vbaProjectSignatureV3' };
const REL_VBA = 'http://schemas.microsoft.com/office/2006/relationships/vbaProject';

// Éléments que Calcul lit sans pouvoir les réécrire : ils sont perdus dans le fichier qu'il enregistre
const NON_CONSERVES = [
  [/^xl\/ctrlProps\//, 'Boutons et contrôles de formulaire (souvent liés aux macros)'],
  [/^xl\/activeX\//, 'Contrôles ActiveX'],
  [/^customUI\d*\//, 'Ruban ou menus personnalisés'],
  [/^xl\/pivotTables\//, 'Tableaux croisés dynamiques'],
  [/^xl\/pivotCache\//, 'Caches de tableaux croisés dynamiques'],
  [/^xl\/connections\.xml$/, 'Connexions à des données externes'],
  [/^xl\/queryTables\//, 'Requêtes de données'],
  [/^xl\/tables\//, 'Tableaux structurés Excel (mis en forme comme tableau)'],
  [/^xl\/slicers\//, 'Segments (slicers)'],
  [/^xl\/externalLinks\//, 'Liaisons vers d\'autres classeurs (les valeurs sont gardées, pas les liaisons)'],
  [/^xl\/drawings\/drawing\d+\.xml$/, 'Formes et dessins Excel (les graphiques sont recréés par Calcul, pas les autres dessins)'],
];

// ---------- Lecture d'un conteneur OLE (Compound File Binary) ----------
export function lireCFB(o) {
  const dv = new DataView(o.buffer, o.byteOffset, o.byteLength);
  const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  if (o.length < 512 || sig.some((b, i) => o[i] !== b)) throw new Error('ce n\'est pas un conteneur OLE');
  const tS = 1 << dv.getUint16(0x1E, true), tMS = 1 << dv.getUint16(0x20, true);
  const nFat = dv.getUint32(0x2C, true), dir0 = dv.getUint32(0x30, true), coupure = dv.getUint32(0x38, true);
  const miniFat0 = dv.getUint32(0x3C, true), difat0 = dv.getUint32(0x44, true);
  const off = s => 512 + s * tS;
  const secteursFat = [];
  for (let i = 0; i < 109 && secteursFat.length < nFat; i++) secteursFat.push(dv.getUint32(0x4C + i * 4, true));
  for (let s = difat0, g = 0; s < 0xFFFFFFFA && secteursFat.length < nFat && g++ < 1e5;) {
    for (let i = 0; i < tS / 4 - 1 && secteursFat.length < nFat; i++) secteursFat.push(dv.getUint32(off(s) + i * 4, true));
    s = dv.getUint32(off(s) + tS - 4, true);
  }
  const fat = [];
  for (const s of secteursFat) for (let i = 0; i < tS / 4; i++) fat.push(dv.getUint32(off(s) + i * 4, true));
  const chaine = (s, table) => { const l = []; for (let g = 0; s < 0xFFFFFFFA && g < 1e6; g++) { l.push(s); s = table[s]; } return l; };
  const lire = (s, taille) => { const r = new Uint8Array(taille); let p = 0; for (const x of chaine(s, fat)) { const n = Math.min(tS, taille - p); if (n <= 0) break; r.set(o.subarray(off(x), off(x) + n), p); p += n; } return r; };
  const dirOctets = (() => { const c = chaine(dir0, fat); return lire(dir0, c.length * tS); })();
  const ent = [];
  for (let i = 0; i + 128 <= dirOctets.length; i += 128) {
    const d = new DataView(dirOctets.buffer, i, 128), ln = d.getUint16(0x40, true);
    const nom = String.fromCharCode(...new Uint16Array(dirOctets.buffer.slice(i, i + Math.max(0, ln - 2))));
    ent.push({ nom, type: d.getUint8(0x42), gauche: d.getUint32(0x44, true), droite: d.getUint32(0x48, true), enfant: d.getUint32(0x4C, true), debut: d.getUint32(0x74, true), taille: d.getUint32(0x78, true) });
  }
  const racine = ent[0];
  const miniFat = []; if (miniFat0 < 0xFFFFFFFA) { const b = lire(miniFat0, chaine(miniFat0, fat).length * tS); const v = new DataView(b.buffer); for (let i = 0; i < b.length / 4; i++) miniFat.push(v.getUint32(i * 4, true)); }
  const miniFlux = racine && racine.debut < 0xFFFFFFFA ? lire(racine.debut, racine.taille) : new Uint8Array(0);
  const lireFlux = e => {
    if (e.taille < coupure) { const r = new Uint8Array(e.taille); let p = 0; for (const x of chaine(e.debut, miniFat)) { const n = Math.min(tMS, e.taille - p); if (n <= 0) break; r.set(miniFlux.subarray(x * tMS, x * tMS + n), p); p += n; } return r; }
    return lire(e.debut, e.taille);
  };
  // chemins complets (arbre rouge-noir de chaque stockage)
  const chemins = new Map();
  const parcourir = (i, prefixe, g = 0) => { if (i >= ent.length || i === 0xFFFFFFFF || g > 1e4) return; const e = ent[i]; parcourir(e.gauche, prefixe, g + 1); const ch = prefixe + e.nom; if (e.type === 2) chemins.set(ch, e); if (e.type === 1) parcourir(e.enfant, ch + '/', g + 1); parcourir(e.droite, prefixe, g + 1); };
  if (racine) parcourir(racine.enfant, '');
  return { flux: [...chemins.keys()], lire: chemin => { const e = chemins.get(chemin); return e ? lireFlux(e) : null; } };
}

/** Décrit un projet VBA : modules (d'après le flux PROJECT), protection par mot de passe. */
export function decrireProjetVba(bin) {
  try {
    const cfb = lireCFB(bin);
    const p = cfb.lire('PROJECT');
    if (!p) return { lisible: false, modules: [], detail: 'flux PROJECT absent' };
    const texte = new TextDecoder('windows-1252').decode(p);
    const modules = [];
    for (const l of texte.split(/\r?\n/)) {
      const m = /^(Module|Document|Class|BaseClass)=([^/\r\n]+)/.exec(l);
      if (m) modules.push({ nom: m[2].trim(), type: { Module: 'Module', Document: 'Feuille ou classeur', Class: 'Module de classe', BaseClass: 'Formulaire (UserForm)' }[m[1]] });
    }
    const dpb = /^DPB="([0-9A-F]*)"/m.exec(texte);
    return { lisible: true, modules, protege: !!(dpb && dpb[1].length > 16), flux: cfb.flux.length };
  } catch (e) { return { lisible: false, modules: [], detail: e.message }; }
}

const xmlAttr = (xml, re) => { const m = re.exec(xml); return m ? m[1] : null; };

/** Analyse le classeur d'origine : projet VBA, noms de code, éléments que Calcul ne conservera pas. */
export function analyserOrigine(octets, ext) {
  if (ext !== 'xlsx' && ext !== 'xlsm') return null;
  let z; try { z = unzipSync(octets); } catch { return null; }
  const parties = {};
  for (const p of PARTIES_VBA) if (z[p]) parties[p] = z[p];
  const wb = z['xl/workbook.xml'] ? strFromU8(z['xl/workbook.xml']) : '';
  const rels = z['xl/_rels/workbook.xml.rels'] ? strFromU8(z['xl/_rels/workbook.xml.rels']) : '';
  const codeClasseur = xmlAttr(wb, /<workbookPr\b[^>]*\bcodeName="([^"]*)"/);
  const codesFeuilles = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]*)"/g)) {
    const cible = xmlAttr(rels, new RegExp(`<Relationship\\b[^>]*Id="${m[2]}"[^>]*Target="([^"]*)"`)) || xmlAttr(rels, new RegExp(`<Relationship\\b[^>]*Target="([^"]*)"[^>]*Id="${m[2]}"`));
    if (!cible) continue;
    const ch = cible.startsWith('/') ? cible.slice(1) : 'xl/' + cible.replace(/^\.\//, '');
    const sx = z[ch] ? strFromU8(z[ch].subarray(0, 4000)) : '';
    const cn = xmlAttr(sx, /<sheetPr\b[^>]*\bcodeName="([^"]*)"/);
    if (cn) codesFeuilles[m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")] = cn;
  }
  const pertes = new Map();
  for (const k of Object.keys(z)) for (const [re, lib] of NON_CONSERVES) if (re.test(k)) pertes.set(lib, (pertes.get(lib) || 0) + 1);
  // dessins VML : les notes sont reprises par Calcul, pas les boutons et contrôles de formulaire
  for (const k of Object.keys(z).filter(k => /^xl\/drawings\/vmlDrawing\d+\.vml$/.test(k))) {
    const n = [...strFromU8(z[k]).matchAll(/ObjectType="(\w+)"/g)].filter(m => m[1] !== 'Note').length;
    if (n) pertes.set('Boutons et contrôles de formulaire (souvent liés aux macros)', (pertes.get('Boutons et contrôles de formulaire (souvent liés aux macros)') || 0) + n);
  }
  const vba = parties['xl/vbaProject.bin'] ? { parties, projet: decrireProjetVba(parties['xl/vbaProject.bin']), signe: Object.keys(parties).some(p => /Signature/.test(p)) } : null;
  return { vba, codeClasseur, codesFeuilles, pertes: [...pertes].map(([libelle, n]) => ({ libelle, n })), extOrigine: ext };
}

/**
 * Ajoute à un classeur .xlsx produit par Calcul le projet VBA d'origine (copié à l'identique)
 * et en fait un classeur .xlsm valide. Sans projet VBA, produit un .xlsm sans macros.
 */
export function injecterVba(octetsXlsx, origine, nomsFeuilles) {
  const z = unzipSync(octetsXlsx);
  let ct = strFromU8(z['[Content_Types].xml']);
  ct = ct.replace(/(<Override PartName="\/xl\/workbook\.xml" ContentType=")[^"]*"/, `$1${CT_MAIN_XLSM}"`);
  const vba = origine?.vba;
  if (vba) {
    for (const [p, o] of Object.entries(vba.parties)) z[p] = o;
    if (!/Extension="bin"/.test(ct)) ct = ct.replace('<Default Extension="xml"', `<Default Extension="bin" ContentType="${CT_VBA}"/><Default Extension="xml"`);
    for (const [p, t] of Object.entries(CT_SIG)) if (vba.parties[p] && !ct.includes(`/${p}"`)) ct = ct.replace('</Types>', `<Override PartName="/${p}" ContentType="${t}"/></Types>`);
    if (vba.parties['xl/vbaProject.bin'] && !ct.includes('/xl/vbaProject.bin')) ct = ct.replace('</Types>', `<Override PartName="/xl/vbaProject.bin" ContentType="${CT_VBA}"/></Types>`);
    let rels = strFromU8(z['xl/_rels/workbook.xml.rels']);
    if (!rels.includes(REL_VBA)) rels = rels.replace('</Relationships>', `<Relationship Id="rIdVBA1" Type="${REL_VBA}" Target="vbaProject.bin"/></Relationships>`);
    z['xl/_rels/workbook.xml.rels'] = strToU8(rels);
    // noms de code : relient les modules « Document » du projet VBA au classeur et aux feuilles
    let wb = strFromU8(z['xl/workbook.xml']);
    const code = origine.codeClasseur || 'ThisWorkbook';
    if (!/<workbookPr\b/.test(wb)) wb = wb.replace(/(<workbook\b[^>]*>)/, `$1<workbookPr codeName="${code}"/>`);
    else if (!/<workbookPr\b[^>]*codeName=/.test(wb)) wb = wb.replace(/<workbookPr\b/, `<workbookPr codeName="${code}"`);
    z['xl/workbook.xml'] = strToU8(wb);
    (nomsFeuilles || []).forEach((nom, i) => {
      const cn = origine.codesFeuilles?.[nom]; const p = `xl/worksheets/sheet${i + 1}.xml`;
      if (!cn || !z[p]) return;
      let s = strFromU8(z[p]);
      s = /<sheetPr\b[^>]*\/>/.test(s) ? s.replace(/<sheetPr\b([^>]*)\/>/, `<sheetPr codeName="${cn}"$1/>`) : s.replace(/<sheetPr\b([^>]*)>/, `<sheetPr codeName="${cn}"$1>`);
      if (!/<sheetPr\b/.test(s)) s = s.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr codeName="${cn}"/>`);
      z[p] = strToU8(s);
    });
  }
  z['[Content_Types].xml'] = strToU8(ct);
  return zipSync(z, { level: 6 });
}

/** Vérifie qu'un .xlsm contient le projet VBA d'origine à l'identique. */
export function verifierVba(octetsXlsm, origine) {
  const z = unzipSync(octetsXlsm);
  const ct = strFromU8(z['[Content_Types].xml'] || new Uint8Array());
  if (!ct.includes(CT_MAIN_XLSM)) return { ok: false, detail: 'type de classeur .xlsm absent' };
  if (!origine?.vba) return { ok: true, detail: 'aucun projet VBA à conserver' };
  for (const [p, o] of Object.entries(origine.vba.parties)) {
    const n = z[p];
    if (!n || n.length !== o.length || n.some((b, i) => b !== o[i])) return { ok: false, detail: `partie ${p} absente ou modifiée` };
  }
  if (!strFromU8(z['xl/_rels/workbook.xml.rels']).includes(REL_VBA)) return { ok: false, detail: 'relation vers le projet VBA absente' };
  return { ok: true, detail: `projet VBA conservé à l'identique (${Object.keys(origine.vba.parties).length} partie(s))` };
}
