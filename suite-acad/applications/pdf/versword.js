// PDF — conversion en document Word modifiable (.docx), entièrement sur le poste
//
// 1. analyse : texte de chaque page (pdf.js), pages numérisées (images sans texte) ;
// 2. reconstruction : lignes, paragraphes, titres (taille), gras/italique (police), alignement centré,
//    listes, sauts de page entre les pages du PDF ;
// 3. pages numérisées : OCR local si le navigateur en fournit un (TextDetector), sinon la page est
//    insérée en image (texte non modifiable) — jamais un document vide présenté comme réussi ;
// 4. contrôle : le .docx produit est relu et son texte comparé à celui du PDF.
import { zipSync, unzipSync, strToU8, strFromU8 } from './commun/vendor/fflate.js';
import { pdfjs, pageEnImage } from './moteur.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const x = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
const SEUIL_TEXTE = 20; // caractères en dessous desquels une page avec image est considérée comme numérisée

/** OCR local disponible ? (Shape Detection API de Chromium, adossée à l'OCR de Windows quand elle est activée) */
export const ocrDisponible = () => typeof window !== 'undefined' && 'TextDetector' in window;

/** Analyse le PDF : nombre de pages, texte par page, pages numérisées. */
export async function analyserPdf(pdf) {
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const ops = await pg.getOperatorList();
    const nImages = ops.fnArray.filter(f => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject || f === pdfjs.OPS.paintImageMaskXObject || f === pdfjs.OPS.paintJpegXObject).length;
    const tc = await pg.getTextContent();
    const nCar = tc.items.reduce((n, it) => n + (it.str || '').replace(/\s/g, '').length, 0);
    pages.push({ n: i, nCar, nImages, numerisee: nCar < SEUIL_TEXTE && nImages > 0, vide: nCar === 0 && nImages === 0 });
  }
  return { pages, nPages: pdf.numPages, numerisees: pages.filter(p => p.numerisee).length, avecTexte: pages.filter(p => p.nCar >= SEUIL_TEXTE).length, totalCar: pages.reduce((n, p) => n + p.nCar, 0) };
}

/** Lignes de texte d'une page, avec style dominant. */
async function lignesPage(pg) {
  await pg.getOperatorList(); // charge les polices côté affichage (noms, gras, italique)
  const tc = await pg.getTextContent();
  const vp = pg.getViewport({ scale: 1 });
  const polices = {};
  const infoPolice = nom => {
    if (polices[nom]) return polices[nom];
    let f = null; try { f = pg.commonObjs.get(nom); } catch { }
    const n = (f?.name || tc.styles[nom]?.fontFamily || '').toString();
    return (polices[nom] = { gras: !!f?.bold || /bold|black|heavy|semibold|demi|gras/i.test(n), italique: !!f?.italic || /italic|oblique/i.test(n), mono: /courier|mono|consol/i.test(n) });
  };
  const items = tc.items.filter(it => it.str !== undefined && (it.str.trim() || it.hasEOL)).map(it => {
    const [a, b, , d, e, f] = it.transform;
    const taille = Math.hypot(a, b) || Math.abs(d) || it.height || 10;
    const [px, py] = vp.convertToViewportPoint(e, f);
    return { t: it.str, x: px, y: py, l: it.width * (vp.scale || 1), taille, ...infoPolice(it.fontName), eol: it.hasEOL };
  }).filter(it => it.t);
  items.sort((p, q) => Math.abs(p.y - q.y) < Math.min(p.taille, q.taille) * 0.45 ? p.x - q.x : p.y - q.y);
  const lignes = [];
  for (const it of items) {
    const l = lignes[lignes.length - 1];
    if (l && Math.abs(l.y - it.y) < Math.min(l.taille, it.taille) * 0.45) {
      const ecart = it.x - (l.xFin);
      if (ecart > it.taille * 0.18 && !/\s$/.test(l.morceaux[l.morceaux.length - 1].t) && !/^\s/.test(it.t)) l.morceaux.push({ ...it, t: ' ' + it.t }); else l.morceaux.push(it);
      l.xFin = Math.max(l.xFin, it.x + it.l); l.taille = Math.max(l.taille, it.taille);
    } else lignes.push({ y: it.y, x: it.x, xFin: it.x + it.l, taille: it.taille, morceaux: [it] });
  }
  for (const l of lignes) l.texte = l.morceaux.map(m => m.t).join('').replace(/\s+/g, ' ').trim();
  return { lignes: lignes.filter(l => l.texte), largeur: vp.width, hauteur: vp.height };
}

/** Regroupe les lignes en paragraphes. */
function paragraphes(lignes, largeurPage, tailleCorps) {
  const res = [];
  let p = null;
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i], prec = lignes[i - 1];
    const centre = Math.abs((l.x + l.xFin) / 2 - largeurPage / 2) < largeurPage * 0.04 && (l.xFin - l.x) < largeurPage * 0.7 && l.x > largeurPage * 0.15;
    const puce = /^([•▪◦\-–·]|\d{1,3}[.)]|[a-z][.)])\s/.test(l.texte);
    const titre = l.taille >= tailleCorps * 1.25;
    const nouveau = !p || !prec
      || (l.y - prec.y) > Math.max(prec.taille, l.taille) * 1.75
      || Math.abs(l.taille - prec.taille) > tailleCorps * 0.15
      || puce || centre !== p.centre || titre !== p.titre
      || (Math.abs(l.x - p.x) > tailleCorps * 2.5 && !(i > 0 && l.x < prec.x)); // retrait différent (sauf retour à la marge après un alinéa)
    if (nouveau) { p = { lignes: [], x: l.x, centre, puce, titre, taille: l.taille }; res.push(p); }
    p.lignes.push(l);
  }
  return res;
}

function runsXml(morceaux, tailleCorps, titre) {
  // fusionne les morceaux de même style
  const runs = [];
  for (const m of morceaux) {
    const st = `${m.gras ? 1 : 0}${m.italique ? 1 : 0}${m.mono ? 1 : 0}${Math.round(m.taille * 2)}`;
    const r = runs[runs.length - 1];
    if (r && r.st === st) r.t += m.t; else runs.push({ st, t: m.t, m });
  }
  return runs.map(r => {
    const pr = `${r.m.gras || titre ? '<w:b/>' : ''}${r.m.italique ? '<w:i/>' : ''}${r.m.mono ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : ''}${!titre && Math.abs(r.m.taille - tailleCorps) > 0.6 ? `<w:sz w:val="${Math.max(8, Math.round(r.m.taille * 2))}"/>` : ''}`;
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${x(r.t)}</w:t></w:r>`;
  }).join('');
}

/** Image PNG intégrée dans un paragraphe Word (largeur en points) */
function imageXml(rid, idImg, lPt, hPt) {
  const emu = v => Math.round(v * 12700);
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu(lPt)}" cy="${emu(hPt)}"/><wp:docPr id="${idImg}" name="Page ${idImg}" descr="Page numérisée (image)"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${idImg}" name="page${idImg}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(lPt)}" cy="${emu(hPt)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

/**
 * Convertit un PDF (pdf.js chargé) en .docx.
 * options : { ocr: true (si disponible), titre }
 * Renvoie { octets, rapport: { pages, pagesTexte, pagesOcr, pagesImage, caracteresPdf, caracteresDocx, avertissements } }
 */
export async function pdfVersDocx(pdf, analyse, { ocr = true, titre = 'Document', progression } = {}) {
  const corps = [], medias = {}, rels = [];
  const rap = { pages: pdf.numPages, pagesTexte: 0, pagesOcr: 0, pagesImage: 0, caracteresPdf: analyse.totalCar, caracteresDocx: 0, avertissements: new Set() };
  // taille du corps de texte : la plus fréquente
  let premiere = null;
  for (let i = 1; i <= pdf.numPages; i++) {
    progression?.(i, pdf.numPages);
    const pg = await pdf.getPage(i);
    const info = analyse.pages[i - 1];
    if (i > 1) corps.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    if (info.numerisee) {
      const img = await pageEnImage(pdf, i, 150);
      let texteOcr = null;
      if (ocr && ocrDisponible()) {
        try {
          const det = new window.TextDetector();
          const blocs = await det.detect(img.canvas);
          texteOcr = blocs.sort((a, b) => a.boundingBox.y - b.boundingBox.y || a.boundingBox.x - b.boundingBox.x).map(b => b.rawValue).filter(Boolean);
        } catch { texteOcr = null; }
      }
      if (texteOcr && texteOcr.join('').replace(/\s/g, '').length >= SEUIL_TEXTE) {
        rap.pagesOcr++; rap.avertissements.add('Texte des pages numérisées reconnu automatiquement (OCR) : relisez-le, des erreurs de reconnaissance sont possibles.');
        for (const t of texteOcr) corps.push(`<w:p><w:r><w:t xml:space="preserve">${x(t)}</w:t></w:r></w:p>`);
      } else {
        rap.pagesImage++;
        const nom = `media/page${i}.png`; const rid = `rIdImg${i}`;
        medias['word/' + nom] = new Uint8Array(await img.blob.arrayBuffer()); rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${nom}"/>`);
        const k = Math.min(1, 481.9 / img.l, 680 / img.h);
        corps.push(`<w:p><w:r><w:rPr><w:i/><w:color w:val="7F7F7F"/></w:rPr><w:t xml:space="preserve">[Page ${i} numérisée : insérée en image, texte non modifiable]</w:t></w:r></w:p>`);
        corps.push(imageXml(rid, i, img.l * k, img.h * k));
      }
      continue;
    }
    const { lignes, largeur, hauteur } = await lignesPage(pg);
    if (!premiere) premiere = { largeur, hauteur };
    if (!lignes.length) { if (info.nImages) rap.avertissements.add('Les images des pages contenant du texte ne sont pas reprises.'); continue; }
    rap.pagesTexte++;
    if (info.nImages) rap.avertissements.add('Les images des pages contenant du texte ne sont pas reprises.');
    const tailles = {}; for (const l of lignes) for (const m of l.morceaux) tailles[Math.round(m.taille)] = (tailles[Math.round(m.taille)] || 0) + m.t.length;
    const tailleCorps = +Object.entries(tailles).sort((a, b) => b[1] - a[1])[0][0] || 11;
    const xs = lignes.map(l => l.x).sort((a, b) => a - b); const margeG = xs[Math.floor(xs.length * 0.1)] || 0;
    if (lignes.some(l => l.x > largeur * 0.48 && lignes.some(k => Math.abs(k.y - l.y) < 2 && k.x < largeur * 0.3 && k !== l))) rap.avertissements.add('Mise en page en colonnes ou tableaux détectée : le texte est repris ligne par ligne, sans les colonnes ni les tableaux.');
    for (const p of paragraphes(lignes, largeur, tailleCorps)) {
      const morceaux = [];
      p.lignes.forEach((l, k) => {
        l.morceaux.forEach((m, j) => morceaux.push(j === 0 && k > 0 ? { ...m, t: (/-$/.test(p.lignes[k - 1].texte) ? '' : ' ') + m.t.replace(/^\s+/, '') } : m));
      });
      const niveau = p.titre ? (p.taille >= tailleCorps * 1.6 ? 1 : 2) : 0;
      const retrait = !p.centre && p.x - margeG > tailleCorps * 1.5 ? Math.round((p.x - margeG) * 20) : 0;
      const ppr = `${niveau ? `<w:pStyle w:val="Titre${niveau}"/>` : ''}${p.centre ? '<w:jc w:val="center"/>' : ''}${retrait ? `<w:ind w:left="${retrait}"/>` : ''}`;
      corps.push(`<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runsXml(morceaux, tailleCorps, !!niveau)}</w:p>`);
    }
  }
  if (rap.pagesImage) rap.avertissements.add(ocrDisponible() ? 'Certaines pages numérisées n\'ont pas pu être reconnues : elles sont insérées en image.' : 'Aucun moteur de reconnaissance de texte (OCR) n\'est disponible sur ce poste : les pages numérisées sont insérées en image, leur texte n\'est pas modifiable.');
  rap.avertissements.add('La mise en page est reconstruite : polices exactes, positions, colonnes, tableaux et images peuvent différer du PDF.');
  const pw = Math.round((premiere?.largeur || 595.28) * 20), ph = Math.round((premiere?.hauteur || 841.89) * 20);
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${corps.join('')}<w:sectPr><w:pgSz w:w="${pw}" w:h="${ph}"${pw > ph ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="26"/></w:rPr></w:style></w:styles>`;
  const octets = zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join('')}</Relationships>`),
    'word/document.xml': strToU8(doc), 'word/styles.xml': strToU8(styles),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(titre)}</dc:title><dc:language>fr-FR</dc:language></cp:coreProperties>`),
    ...medias,
  }, { level: 6 });
  // contrôle : relecture et comparaison du texte
  const z = unzipSync(octets);
  const d = new DOMParser().parseFromString(strFromU8(z['word/document.xml']), 'application/xml');
  if (d.getElementsByTagName('parsererror').length) throw new Error('le document Word produit est invalide');
  const texte = [...d.getElementsByTagNameNS(W, 't')].map(t => t.textContent).join('').replace(/\[Page \d+ numérisée[^\]]*\]/g, '');
  rap.caracteresDocx = texte.replace(/\s/g, '').length;
  rap.avertissements = [...rap.avertissements];
  return { octets, rapport: rap };
}
