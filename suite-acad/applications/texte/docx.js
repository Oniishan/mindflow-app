// Texte — écriture d'un document Word (.docx) à partir du contenu de l'éditeur
import { zipSync, strToU8 } from '../commun/vendor/fflate.js';

const NS = 'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" mc:Ignorable="w14"';
const x = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const PX_TWIP = 15; // 1 px = 15 twips (96 dpi)
const PX_EMU = 9525;

function couleurHex(c) {
  if (!c) return null;
  c = c.trim();
  if (c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return null;
  let m = /^#([0-9a-f]{6})$/i.exec(c); if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f]{3})$/i.exec(c); if (m) return m[1].split('').map(h => h + h).join('').toUpperCase();
  m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
  if (m) { if (m[4] !== undefined && +m[4] === 0) return null; return [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase(); }
  return null;
}
function taillePt(fs) {
  if (!fs) return null;
  let m = /([\d.]+)pt/.exec(fs); if (m) return +m[1];
  m = /([\d.]+)px/.exec(fs); if (m) return +m[1] * 0.75;
  return null;
}
const SURLIGNAGES = { FFFF00: 'yellow', '00FF00': 'green', '00FFFF': 'cyan', FF00FF: 'magenta', '0000FF': 'blue', FF0000: 'red', '000080': 'darkBlue', '008080': 'darkCyan', '008000': 'darkGreen', '800080': 'darkMagenta', '800000': 'darkRed', '808000': 'darkYellow', '808080': 'darkGray', C0C0C0: 'lightGray', '000000': 'black' };

export async function ecrireDocx({ feuille, reglages, titre = 'Document', commentaires = [] }) {
  const medias = []; // {nom, octets, rId}
  const liens = []; // {url, rId}
  let idRel = 10, idImg = 1, idSignet = 1;
  const rel = () => 'rId' + (idRel++);
  const numerotations = []; // listes numérotées : chaque <ol> redémarre
  const comsUtilises = new Set();

  function proprietesRun(st) {
    let r = '';
    if (st.police) r += `<w:rFonts w:ascii="${x(st.police)}" w:hAnsi="${x(st.police)}" w:cs="${x(st.police)}"/>`;
    if (st.gras) r += '<w:b/><w:bCs/>';
    if (st.italique) r += '<w:i/><w:iCs/>';
    if (st.majuscules) r += '<w:caps/>';
    if (st.barre) r += '<w:strike/>';
    if (st.couleur) r += `<w:color w:val="${st.couleur}"/>`;
    if (st.taille) r += `<w:sz w:val="${Math.round(st.taille * 2)}"/><w:szCs w:val="${Math.round(st.taille * 2)}"/>`;
    if (st.surlignage) { const n = SURLIGNAGES[st.surlignage]; r += n ? `<w:highlight w:val="${n}"/>` : `<w:shd w:val="clear" w:color="auto" w:fill="${st.surlignage}"/>`; }
    if (st.souligne) r += '<w:u w:val="single"/>';
    if (st.indice) r += '<w:vertAlign w:val="subscript"/>';
    if (st.exposant) r += '<w:vertAlign w:val="superscript"/>';
    if (st.lien) r += '<w:rStyle w:val="Hyperlink"/>';
    return r ? `<w:rPr>${r}</w:rPr>` : '';
  }
  function styleDe(n, st) {
    st = { ...st };
    const t = n.tagName;
    if (t === 'B' || t === 'STRONG') st.gras = true;
    if (t === 'I' || t === 'EM') st.italique = true;
    if (t === 'U' || t === 'INS') st.souligne = true;
    if (t === 'S' || t === 'STRIKE' || t === 'DEL') st.barre = true;
    if (t === 'SUB') st.indice = true;
    if (t === 'SUP') st.exposant = true;
    if (t === 'CODE') st.police = 'Consolas';
    if (t === 'FONT') { if (n.getAttribute('face')) st.police = n.getAttribute('face'); if (n.getAttribute('color')) st.couleur = couleurHex(n.getAttribute('color')); }
    const s = n.style;
    if (s) {
      if (s.fontWeight === 'bold' || +s.fontWeight >= 600) st.gras = true;
      if (s.fontWeight === 'normal' || s.fontWeight === '400') st.gras = false;
      if (s.fontStyle === 'italic') st.italique = true;
      const td = s.textDecorationLine || s.textDecoration || '';
      if (td.includes('underline')) st.souligne = true;
      if (td.includes('line-through')) st.barre = true;
      if (s.color) st.couleur = couleurHex(s.color) || st.couleur;
      if (s.backgroundColor) { const b = couleurHex(s.backgroundColor); if (b) st.surlignage = b; }
      if (s.fontFamily) st.police = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (s.fontSize) st.taille = taillePt(s.fontSize) || st.taille;
      if (s.verticalAlign === 'sub') st.indice = true;
      if (s.verticalAlign === 'super') st.exposant = true;
      if (s.textTransform === 'uppercase') st.majuscules = true;
    }
    return st;
  }

  function image(img) {
    const src = img.getAttribute('src') || '';
    const m = /^data:image\/(png|jpe?g|gif|bmp|webp|svg\+xml);base64,(.+)$/.exec(src);
    if (!m) return '';
    let ext = m[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    if (ext === 'webp' || ext === 'svg') return ''; // non pris en charge par Word sans conversion
    const bin = atob(m[2]); const oct = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) oct[i] = bin.charCodeAt(i);
    const id = rel(); const nom = `image${idImg}.${ext}`;
    medias.push({ nom, octets: oct, rId: id, ext });
    const l = Math.round((img.width || img.naturalWidth || 200) * PX_EMU), h = Math.round((img.height || img.naturalHeight || 150) * PX_EMU);
    const n = idImg++;
    const alt = x(img.alt || '');
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${l}" cy="${h}"/><wp:docPr id="${n}" name="Image ${n}" descr="${alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${nom}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${l}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  function runs(n, st) {
    let out = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        const t = c.nodeValue.replace(/\n/g, ' ');
        if (t) out += `<w:r>${proprietesRun(st)}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
      } else if (c.nodeType === 1) {
        const tg = c.tagName;
        if (tg === 'BR') { out += '<w:r><w:br/></w:r>'; continue; }
        if (tg === 'IMG') { out += image(c); continue; }
        if (c.classList.contains('champ')) { // champs : numéro de page, date
          const f = c.dataset.champ === 'page' ? 'PAGE' : c.dataset.champ === 'pages' ? 'NUMPAGES' : null;
          if (f) { out += `<w:r>${proprietesRun(st)}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${proprietesRun(st)}<w:instrText xml:space="preserve"> ${f} </w:instrText></w:r><w:r>${proprietesRun(st)}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${proprietesRun(st)}<w:t>1</w:t></w:r><w:r>${proprietesRun(st)}<w:fldChar w:fldCharType="end"/></w:r>`; continue; }
        }
        if (tg === 'A' && c.getAttribute('href')) {
          const href = c.getAttribute('href');
          if (href.startsWith('#')) { out += `<w:hyperlink w:anchor="${x(href.slice(1))}">${runs(c, { ...styleDe(c, st), lien: true })}</w:hyperlink>`; continue; }
          const id = rel(); liens.push({ url: href, rId: id });
          out += `<w:hyperlink r:id="${id}">${runs(c, { ...styleDe(c, st), lien: true })}</w:hyperlink>`; continue;
        }
        if (c.classList && c.classList.contains('commentaire') && c.dataset.com) {
          const cid = commentaires.findIndex(k => k.id === c.dataset.com);
          if (cid >= 0 && !comsUtilises.has(cid)) {
            comsUtilises.add(cid);
            out += `<w:commentRangeStart w:id="${cid}"/>${runs(c, styleDe(c, st))}<w:commentRangeEnd w:id="${cid}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${cid}"/></w:r>`;
            continue;
          }
        }
        out += runs(c, styleDe(c, st));
      }
    }
    return out;
  }

  function proprietesParagraphe(n, { style, num, niveau } = {}) {
    let p = '';
    if (style) p += `<w:pStyle w:val="${style}"/>`;
    if (n.style && (n.style.breakBefore === 'page' || n.classList?.contains('saut-avant'))) p += '<w:pageBreakBefore/>';
    if (num) p += `<w:numPr><w:ilvl w:val="${niveau || 0}"/><w:numId w:val="${num}"/></w:numPr>`;
    const s = n.style || {};
    const esp = [];
    if (s.marginTop) esp.push(`w:before="${Math.round(parseFloat(s.marginTop) * (s.marginTop.includes('pt') ? 20 : PX_TWIP))}"`);
    if (s.marginBottom) esp.push(`w:after="${Math.round(parseFloat(s.marginBottom) * (s.marginBottom.includes('pt') ? 20 : PX_TWIP))}"`);
    if (s.lineHeight && !isNaN(parseFloat(s.lineHeight)) && !/px|pt/.test(s.lineHeight)) esp.push(`w:line="${Math.round(parseFloat(s.lineHeight) * 240)}" w:lineRule="auto"`);
    if (esp.length) p += `<w:spacing ${esp.join(' ')}/>`;
    const ml = parseFloat(s.marginLeft || s.paddingLeft || 0), ti = parseFloat(s.textIndent || 0);
    if (ml || ti) p += `<w:ind w:left="${Math.round(ml * PX_TWIP)}"${ti ? ` w:firstLine="${Math.round(ti * PX_TWIP)}"` : ''}/>`;
    if (s.backgroundColor && couleurHex(s.backgroundColor)) p += `<w:shd w:val="clear" w:color="auto" w:fill="${couleurHex(s.backgroundColor)}"/>`;
    const al = s.textAlign || n.getAttribute?.('align');
    if (al) p += `<w:jc w:val="${{ center: 'center', right: 'right', justify: 'both', left: 'left', start: 'left', end: 'right' }[al] || 'left'}"/>`;
    return p ? `<w:pPr>${p}</w:pPr>` : '';
  }

  function paragraphe(n, opts = {}, st = {}) {
    const sig = n.id ? `<w:bookmarkStart w:id="${idSignet}" w:name="${x(n.id)}"/><w:bookmarkEnd w:id="${idSignet++}"/>` : '';
    return `<w:p>${proprietesParagraphe(n, opts)}${sig}${runs(n, styleDe(n, st))}</w:p>`;
  }

  function liste(n, niveau = 0) {
    let out = '';
    const ordonnee = n.tagName === 'OL';
    let num = 1;
    if (ordonnee) { numerotations.push(n.style.listStyleType || n.getAttribute('type') || 'decimal'); num = 1 + numerotations.length; }
    for (const li of n.children) {
      if (li.tagName !== 'LI') continue;
      // contenu propre de l'élément (sans sous-listes)
      const clone = li.cloneNode(true);
      clone.querySelectorAll(':scope > ul, :scope > ol').forEach(s => s.remove());
      const blocs = [...clone.children].filter(c => /^(P|DIV|H[1-6])$/.test(c.tagName));
      if (blocs.length) blocs.forEach((b, i) => out += paragraphe(b, { style: 'ListParagraph', num: i === 0 ? num : null, niveau }));
      else out += paragraphe(clone, { style: 'ListParagraph', num, niveau });
      for (const s of li.children) if (s.tagName === 'UL' || s.tagName === 'OL') out += liste(s, niveau + 1);
    }
    return out;
  }

  function tableau(t) {
    const lignes = [...t.rows];
    if (!lignes.length) return '';
    let nbCol = 0; lignes.forEach(r => { let c = 0; [...r.cells].forEach(td => c += td.colSpan || 1); nbCol = Math.max(nbCol, c); });
    const largeurTotale = Math.round((reglages.largeurContenu || 600) * PX_TWIP);
    const lc = Math.floor(largeurTotale / nbCol);
    const sansBordure = t.classList.contains('sans-bordure');
    let out = `<w:tbl><w:tblPr><w:tblStyle w:val="${sansBordure ? 'TableNormal' : 'TableGrid'}"/><w:tblW w:w="${largeurTotale}" w:type="dxa"/>${sansBordure ? '' : '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:left w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="808080"/></w:tblBorders>'}<w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${('<w:gridCol w:w="' + lc + '"/>').repeat(nbCol)}</w:tblGrid>`;
    // gestion des fusions verticales
    const occupe = {}; // "ligne,col" -> {debut:bool}
    lignes.forEach((r, ri) => {
      out += '<w:tr>';
      if (r.parentElement.tagName === 'THEAD' || [...r.cells].every(c => c.tagName === 'TH')) out = out.replace(/<w:tr>$/, '<w:tr><w:trPr><w:tblHeader/></w:trPr>');
      let col = 0;
      const cellules = [...r.cells];
      let ci = 0;
      while (col < nbCol) {
        if (occupe[ri + ',' + col]) {
          const o = occupe[ri + ',' + col];
          out += `<w:tc><w:tcPr><w:tcW w:w="${lc * o.span}" w:type="dxa"/>${o.span > 1 ? `<w:gridSpan w:val="${o.span}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`;
          col += o.span; continue;
        }
        const td = cellules[ci++];
        if (!td) { out += `<w:tc><w:tcPr><w:tcW w:w="${lc}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`; col++; continue; }
        const span = td.colSpan || 1, rs = td.rowSpan || 1;
        if (rs > 1) for (let k = 1; k < rs; k++) occupe[(ri + k) + ',' + col] = { span };
        const fond = couleurHex(td.style.backgroundColor);
        const va = td.style.verticalAlign;
        let tcPr = `<w:tcW w:w="${lc * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${rs > 1 ? '<w:vMerge w:val="restart"/>' : ''}${fond ? `<w:shd w:val="clear" w:color="auto" w:fill="${fond}"/>` : ''}${va === 'middle' ? '<w:vAlign w:val="center"/>' : va === 'bottom' ? '<w:vAlign w:val="bottom"/>' : ''}`;
        let contenu = blocs(td, { gras: td.tagName === 'TH' });
        if (!contenu.includes('<w:p')) contenu = '<w:p/>';
        out += `<w:tc><w:tcPr>${tcPr}</w:tcPr>${contenu}</w:tc>`;
        col += span;
      }
      out += '</w:tr>';
    });
    return out + '</w:tbl><w:p/>';
  }

  const STYLES = { H1: 'Heading1', H2: 'Heading2', H3: 'Heading3', H4: 'Heading4', H5: 'Heading5', H6: 'Heading6', BLOCKQUOTE: 'Quote', PRE: 'Code' };
  function blocs(conteneur, st = {}) {
    let out = '';
    let enLigne = null; // nœuds en ligne orphelins regroupés en paragraphe
    const viderLigne = () => { if (enLigne) { const p = document.createElement('p'); enLigne.forEach(k => p.appendChild(k.cloneNode(true))); out += paragraphe(p, {}, st); enLigne = null; } };
    for (const n of conteneur.childNodes) {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) (enLigne = enLigne || []).push(n); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName;
      if (/^(B|I|U|S|EM|STRONG|SPAN|A|FONT|SUB|SUP|CODE|BR|IMG|MARK)$/.test(t)) { (enLigne = enLigne || []).push(n); continue; }
      viderLigne();
      if (n.classList.contains('sommaire')) { // table des matières : paragraphes avec liens internes
        out += `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>${x(n.querySelector('.titre-sommaire')?.textContent || 'Sommaire')}</w:t></w:r></w:p>`;
        n.querySelectorAll('.entree-sommaire').forEach(e => {
          const niv = +(e.dataset.niveau || 1);
          out += `<w:p><w:pPr><w:pStyle w:val="TOC${niv}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${Math.round((reglages.largeurContenu || 600) * PX_TWIP)}"/></w:tabs></w:pPr><w:hyperlink w:anchor="${x(e.dataset.cible || '')}"><w:r><w:t xml:space="preserve">${x(e.querySelector('.lib')?.textContent || e.textContent)}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>${x(e.querySelector('.num')?.textContent || '')}</w:t></w:r></w:hyperlink></w:p>`;
        });
        continue;
      }
      if (t === 'HR') { out += n.classList.contains('saut-page') ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>'; continue; }
      if (t === 'TABLE') { out += tableau(n); continue; }
      if (t === 'UL' || t === 'OL') { out += liste(n); continue; }
      if (t === 'FIGURE') { out += blocs(n, st); continue; }
      if (t === 'FIGCAPTION') { out += paragraphe(n, { style: 'Caption' }, st); continue; }
      if (STYLES[t]) { out += paragraphe(n, { style: STYLES[t] }, st); continue; }
      if (t === 'P' || t === 'DIV' || t === 'LI' || t === 'ADDRESS') {
        if (t === 'DIV' && [...n.children].some(c => /^(P|DIV|TABLE|UL|OL|H[1-6]|BLOCKQUOTE|HR)$/.test(c.tagName))) { out += blocs(n, st); continue; }
        const style = n.classList.contains('st-titre') ? 'Title' : n.classList.contains('st-sous-titre') ? 'Subtitle' : n.classList.contains('legende') ? 'Caption' : null;
        out += paragraphe(n, { style }, st); continue;
      }
      out += blocs(n, st);
    }
    viderLigne();
    return out;
  }

  const corps = blocs(feuille);

  // En-têtes et pieds de page
  const zones = {};
  const hf = (type, z) => {
    if (!z || !(z.gauche || z.centre || z.droite)) return null;
    const champ = (t) => {
      const parts = String(t || '').split(/(\{page\}|\{pages\}|\{date\}|\{titre\})/);
      return parts.map(p => {
        if (p === '{page}' || p === '{pages}') { const f = p === '{page}' ? 'PAGE' : 'NUMPAGES'; return `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${f} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`; }
        if (p === '{date}') return `<w:r><w:t>${x(new Date().toLocaleDateString('fr-FR'))}</w:t></w:r>`;
        if (p === '{titre}') return `<w:r><w:t xml:space="preserve">${x(titre)}</w:t></w:r>`;
        return p ? `<w:r><w:t xml:space="preserve">${x(p)}</w:t></w:r>` : '';
      }).join('');
    };
    const l = Math.round((reglages.largeurContenu || 600) * PX_TWIP);
    const tag = type === 'header' ? 'w:hdr' : 'w:ftr';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${tag} ${NS}><w:p><w:pPr><w:pStyle w:val="${type === 'header' ? 'Header' : 'Footer'}"/><w:tabs><w:tab w:val="center" w:pos="${Math.round(l / 2)}"/><w:tab w:val="right" w:pos="${l}"/></w:tabs></w:pPr>${champ(z.gauche)}<w:r><w:tab/></w:r>${champ(z.centre)}<w:r><w:tab/></w:r>${champ(z.droite)}</w:p></${tag}>`;
  };
  const enTete = hf('header', reglages.entete), pied = hf('footer', reglages.pied);
  let refsHF = '';
  if (enTete) { zones.header = enTete; refsHF += '<w:headerReference w:type="default" r:id="rIdEntete"/>'; }
  if (pied) { zones.footer = pied; refsHF += '<w:footerReference w:type="default" r:id="rIdPied"/>'; }

  const pg = reglages.page;
  const sect = `<w:sectPr>${refsHF}<w:pgSz w:w="${Math.round(pg.largeur * PX_TWIP)}" w:h="${Math.round(pg.hauteur * PX_TWIP)}"${pg.paysage ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${Math.round(pg.marges.haut * PX_TWIP)}" w:right="${Math.round(pg.marges.droite * PX_TWIP)}" w:bottom="${Math.round(pg.marges.bas * PX_TWIP)}" w:left="${Math.round(pg.marges.gauche * PX_TWIP)}" w:header="567" w:footer="567" w:gutter="0"/>${reglages.premierePageDifferente ? '<w:titlePg/>' : ''}<w:cols w:space="708"/></w:sectPr>`;
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${corps || '<w:p/>'}${sect}</w:body></w:document>`;

  const police = (reglages.police || 'Calibri').split(',')[0].replace(/["']/g, '');
  const taille = Math.round((reglages.taille || 11) * 2);
  const titreStyle = (id, nom, sz, extra = '', base = 'Normal') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${nom}"/><w:basedOn w:val="${base}"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/>${extra}</w:pPr><w:rPr><w:b/><w:color w:val="${reglages.couleurTitres || '1F3864'}"/><w:sz w:val="${sz}"/></w:rPr></w:style>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${x(police)}" w:hAnsi="${x(police)}" w:cs="${x(police)}" w:eastAsia="${x(police)}"/><w:sz w:val="${taille}"/><w:szCs w:val="${taille}"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${titreStyle('Heading1', 'heading 1', 32, '<w:outlineLvl w:val="0"/>')}${titreStyle('Heading2', 'heading 2', 26, '<w:outlineLvl w:val="1"/>')}${titreStyle('Heading3', 'heading 3', 24, '<w:outlineLvl w:val="2"/>')}${titreStyle('Heading4', 'heading 4', 22, '<w:outlineLvl w:val="3"/>')}${titreStyle('Heading5', 'heading 5', 22, '<w:outlineLvl w:val="4"/>')}${titreStyle('Heading6', 'heading 6', 22, '<w:outlineLvl w:val="5"/>')}
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:sz w:val="56"/><w:color w:val="${reglages.couleurTitres || '1F3864'}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="595959"/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="567" w:right="567"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:color w:val="44546A"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/><w:color w:val="595959"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/><w:color w:val="595959"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:next w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="220"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC3"><w:name w:val="toc 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="440"/></w:pPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

  // Numérotation : 1 = puces, 2+ = listes numérotées (une par liste pour redémarrer à 1)
  const puces = ['•', '◦', '▪', '•', '◦', '▪', '•', '◦', '▪'];
  const absPuces = `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${puces.map((p, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${p}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + 360 * i}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:lvl>`).join('')}</w:abstractNum>`;
  const fmt = t => ({ 'lower-alpha': 'lowerLetter', 'upper-alpha': 'upperLetter', 'lower-roman': 'lowerRoman', 'upper-roman': 'upperRoman', a: 'lowerLetter', A: 'upperLetter', i: 'lowerRoman', I: 'upperRoman' }[t] || 'decimal');
  const niveauxNum = ['decimal', 'lowerLetter', 'lowerRoman', 'decimal', 'lowerLetter', 'lowerRoman', 'decimal', 'lowerLetter', 'lowerRoman'];
  const absNums = numerotations.map((t, k) => `<w:abstractNum w:abstractNumId="${k + 1}"><w:multiLevelType w:val="hybridMultilevel"/>${niveauxNum.map((f, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${i === 0 ? fmt(t) : f}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + 360 * i}" w:hanging="360"/></w:pPr></w:lvl>`).join('')}</w:abstractNum>`).join('');
  const nums = `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` + numerotations.map((_, k) => `<w:num w:numId="${k + 2}"><w:abstractNumId w:val="${k + 1}"/></w:num>`).join('');
  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>${absPuces}${absNums}${nums}</w:numbering>`;

  // Commentaires
  const comsXml = commentaires.length ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${NS}>${commentaires.map((c, i) => `<w:comment w:id="${i}" w:author="${x(c.auteur || 'Auteur')}" w:date="${x(c.date || new Date().toISOString())}" w:initials="${x((c.auteur || 'A').split(/\s+/).map(m => m[0]).join('').slice(0, 3))}"><w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr><w:r><w:t xml:space="preserve">${x(c.texte)}</w:t></w:r></w:p></w:comment>`).join('')}</w:comments>` : null;

  const types = new Set(medias.map(m => m.ext));
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="json" ContentType="application/json"/>${[...types].map(e => `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${zones.header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}${zones.footer ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}${comsXml ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : ''}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const relsRacine = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const relsDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${zones.header ? '<Relationship Id="rIdEntete" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : ''}${zones.footer ? '<Relationship Id="rIdPied" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : ''}${comsXml ? '<Relationship Id="rIdComs" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>' : ''}${medias.map(m => `<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.nom}"/>`).join('')}${liens.map(l => `<Relationship Id="${l.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${x(l.url)}" TargetMode="External"/>`).join('')}</Relationships>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${NS}><w:zoom w:percent="100"/><w:defaultTabStop w:val="708"/><w:characterSpacingControl w:val="doNotCompress"/><w:themeFontLang w:val="fr-FR"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  const maintenant = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(titre)}</dc:title><dc:creator>${x(reglages.auteur || '')}</dc:creator><cp:lastModifiedBy>${x(reglages.auteur || '')}</cp:lastModifiedBy><dc:language>fr-FR</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${reglages.cree || maintenant}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${maintenant}</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Suite Acad’</Application></Properties>`;

  const f = {
    '[Content_Types].xml': strToU8(ct), '_rels/.rels': strToU8(relsRacine),
    'word/document.xml': strToU8(docXml), 'word/styles.xml': strToU8(stylesXml), 'word/numbering.xml': strToU8(numberingXml), 'word/settings.xml': strToU8(settings),
    'word/_rels/document.xml.rels': strToU8(relsDoc), 'docProps/core.xml': strToU8(core), 'docProps/app.xml': strToU8(app),
  };
  if (zones.header) f['word/header1.xml'] = strToU8(zones.header);
  if (zones.footer) f['word/footer1.xml'] = strToU8(zones.footer);
  if (comsXml) f['word/comments.xml'] = strToU8(comsXml);
  medias.forEach(m => f['word/media/' + m.nom] = m.octets);
  return { fichiers: f, documentXml: docXml };
}

// Empaquette en ajoutant une copie fidèle du document Atelier (relecture parfaite par Texte)
export async function docxOctets(params, etatAtelier) {
  const { fichiers, documentXml } = await ecrireDocx(params);
  const empreinte = await hash(documentXml);
  fichiers['atelier/document.json'] = strToU8(JSON.stringify({ ...etatAtelier, empreinte }));
  return zipSync(fichiers, { level: 6 });
}

export async function hash(texte) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte));
  return [...new Uint8Array(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}
