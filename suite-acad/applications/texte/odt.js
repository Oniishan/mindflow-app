// Texte — lecture et écriture OpenDocument texte (.odt)
import { zipSync, unzipSync, strToU8, strFromU8 } from '../commun/vendor/fflate.js';

const x = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:fo2="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3"';
const PX_CM = 2.54 / 96;

// ---------- Écriture ----------
export function ecrireOdt({ feuille, reglages, titre = 'Document' }) {
  const stylesAuto = new Map(); // clé -> nom
  const images = [];
  let nImg = 1;
  const styleTexte = (st) => {
    const props = [];
    if (st.gras) props.push('fo:font-weight="bold" style:font-weight-asian="bold"');
    if (st.italique) props.push('fo:font-style="italic"');
    if (st.souligne) props.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
    if (st.barre) props.push('style:text-line-through-style="solid"');
    if (st.couleur) props.push(`fo:color="${st.couleur}"`);
    if (st.fond) props.push(`fo:background-color="${st.fond}"`);
    if (st.police) props.push(`style:font-name="${x(st.police)}" fo:font-family="${x(st.police)}"`);
    if (st.taille) props.push(`fo:font-size="${st.taille}pt"`);
    if (st.indice) props.push('style:text-position="sub 58%"');
    if (st.exposant) props.push('style:text-position="super 58%"');
    if (!props.length) return null;
    const cle = 'T|' + props.join(' ');
    if (!stylesAuto.has(cle)) stylesAuto.set(cle, { nom: 'T' + (stylesAuto.size + 1), xml: `<style:style style:name="T${stylesAuto.size + 1}" style:family="text"><style:text-properties ${props.join(' ')}/></style:style>` });
    return stylesAuto.get(cle).nom;
  };
  const styleParagraphe = (n, parent) => {
    const s = n.style || {}, props = [];
    if (s.textAlign) props.push(`fo:text-align="${{ left: 'start', right: 'end', center: 'center', justify: 'justify' }[s.textAlign] || 'start'}"`);
    if (s.marginLeft) props.push(`fo:margin-left="${(parseFloat(s.marginLeft) * PX_CM).toFixed(2)}cm"`);
    if (s.lineHeight && !/px|pt/.test(s.lineHeight)) props.push(`fo:line-height="${Math.round(parseFloat(s.lineHeight) * 100)}%"`);
    if (s.backgroundColor) props.push(`fo:background-color="${s.backgroundColor}"`);
    if (n.classList?.contains('saut-avant')) props.push('fo:break-before="page"');
    if (!props.length) return parent;
    const cle = 'P|' + parent + '|' + props.join(' ');
    if (!stylesAuto.has(cle)) stylesAuto.set(cle, { nom: 'P' + (stylesAuto.size + 1), xml: `<style:style style:name="P${stylesAuto.size + 1}" style:family="paragraph" style:parent-style-name="${parent}"><style:paragraph-properties ${props.join(' ')}/></style:style>` });
    return stylesAuto.get(cle).nom;
  };
  const coul = c => { if (!c) return null; const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c); if (m) { if (m[4] !== undefined && +m[4] === 0) return null; return '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join(''); } return /^#/.test(c) ? c : null; };
  const derive = (n, st) => {
    st = { ...st }; const t = n.tagName, s = n.style || {};
    if (t === 'B' || t === 'STRONG' || s.fontWeight === 'bold' || +s.fontWeight >= 600) st.gras = true;
    if (t === 'I' || t === 'EM' || s.fontStyle === 'italic') st.italique = true;
    if (t === 'U' || (s.textDecorationLine || '').includes('underline')) st.souligne = true;
    if (t === 'S' || t === 'STRIKE' || (s.textDecorationLine || '').includes('line-through')) st.barre = true;
    if (t === 'SUB') st.indice = true; if (t === 'SUP') st.exposant = true;
    if (s.color) st.couleur = coul(s.color) || st.couleur;
    if (s.backgroundColor) st.fond = coul(s.backgroundColor) || st.fond;
    if (s.fontFamily) st.police = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    if (s.fontSize) { const m = /([\d.]+)(pt|px)/.exec(s.fontSize); if (m) st.taille = m[2] === 'pt' ? +m[1] : +(m[1] * .75).toFixed(1); }
    return st;
  };
  const enLigne = (n, st) => {
    let o = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        const t = x(c.nodeValue).replace(/ {2,}/g, m => ' <text:s text:c="' + (m.length - 1) + '"/>');
        const sn = styleTexte(st);
        o += sn ? `<text:span text:style-name="${sn}">${t}</text:span>` : t;
      } else if (c.nodeType === 1) {
        if (c.tagName === 'BR') { o += '<text:line-break/>'; continue; }
        if (c.tagName === 'IMG') { o += image(c); continue; }
        if (c.tagName === 'A' && c.getAttribute('href')) { o += `<text:a xlink:type="simple" xlink:href="${x(c.getAttribute('href'))}">${enLigne(c, derive(c, st))}</text:a>`; continue; }
        o += enLigne(c, derive(c, st));
      }
    }
    return o;
  };
  const image = (img) => {
    const m = /^data:image\/(png|jpe?g|gif|svg\+xml);base64,(.+)$/.exec(img.getAttribute('src') || '');
    if (!m) return '';
    const ext = m[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const bin = atob(m[2]); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
    const nom = `Pictures/image${nImg}.${ext}`; images.push({ nom, o, type: 'image/' + (ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext) });
    const w = ((img.width || 200) * PX_CM).toFixed(2), h = ((img.height || 150) * PX_CM).toFixed(2);
    return `<draw:frame draw:name="Image${nImg++}" text:anchor-type="as-char" svg:width="${w}cm" svg:height="${h}cm"><draw:image xlink:href="${nom}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
  };
  const blocs = (cont) => {
    let o = '';
    for (const n of cont.children) {
      const t = n.tagName;
      if (/^H[1-6]$/.test(t)) { o += `<text:h text:style-name="${styleParagraphe(n, 'Heading_20_' + t[1])}" text:outline-level="${t[1]}">${enLigne(n, {})}</text:h>`; continue; }
      if (t === 'HR') { o += n.classList.contains('saut-page') ? `<text:p text:style-name="SautPage"/>` : '<text:p text:style-name="Horizontal_20_Line"/>'; continue; }
      if (t === 'UL' || t === 'OL') { o += liste(n); continue; }
      if (t === 'TABLE') { o += tableau(n); continue; }
      if (t === 'BLOCKQUOTE') { o += `<text:p text:style-name="${styleParagraphe(n, 'Quotations')}">${enLigne(n, {})}</text:p>`; continue; }
      if (t === 'PRE') { o += `<text:p text:style-name="Preformatted_20_Text">${enLigne(n, {})}</text:p>`; continue; }
      if (n.classList.contains('sommaire')) { n.querySelectorAll('.entree-sommaire').forEach(e => o += `<text:p text:style-name="Contents_20_${e.dataset.niveau || 1}">${x(e.querySelector('.lib')?.textContent || '')}<text:tab/>${x(e.querySelector('.num')?.textContent || '')}</text:p>`); continue; }
      if (t === 'DIV' && [...n.children].some(c => /^(P|DIV|TABLE|UL|OL|H[1-6])$/.test(c.tagName))) { o += blocs(n); continue; }
      const parent = n.classList.contains('st-titre') ? 'Title' : n.classList.contains('st-sous-titre') ? 'Subtitle' : 'Standard';
      o += `<text:p text:style-name="${styleParagraphe(n, parent)}">${enLigne(n, {})}</text:p>`;
    }
    return o;
  };
  const liste = (n) => {
    let o = `<text:list text:style-name="${n.tagName === 'OL' ? 'Numbering_20_123' : 'List_20_1'}">`;
    for (const li of n.children) {
      if (li.tagName !== 'LI') continue;
      const c = li.cloneNode(true); c.querySelectorAll(':scope > ul, :scope > ol').forEach(s => s.remove());
      o += `<text:list-item><text:p text:style-name="List_20_Contents">${enLigne(c, {})}</text:p>`;
      for (const s of li.children) if (s.tagName === 'UL' || s.tagName === 'OL') o += liste(s);
      o += '</text:list-item>';
    }
    return o + '</text:list>';
  };
  let nTab = 1;
  const tableau = (t) => {
    let nc = 0; [...t.rows].forEach(r => { let c = 0; [...r.cells].forEach(d => c += d.colSpan || 1); nc = Math.max(nc, c); });
    let o = `<table:table table:name="Tableau${nTab++}" table:style-name="Tableau"><table:table-column table:number-columns-repeated="${nc}"/>`;
    for (const r of t.rows) {
      o += '<table:table-row>';
      for (const d of r.cells) {
        const sp = d.colSpan > 1 ? ` table:number-columns-spanned="${d.colSpan}"` : '';
        const rs = d.rowSpan > 1 ? ` table:number-rows-spanned="${d.rowSpan}"` : '';
        const contenu = [...d.children].some(c => /^(P|DIV|UL|OL|H[1-6])$/.test(c.tagName)) ? blocs(d) : `<text:p text:style-name="Table_20_Contents">${enLigne(d, d.tagName === 'TH' ? { gras: true } : {})}</text:p>`;
        o += `<table:table-cell table:style-name="Cellule" office:value-type="string"${sp}${rs}>${contenu}</table:table-cell>`;
        for (let k = 1; k < (d.colSpan || 1); k++) o += '<table:covered-table-cell/>';
      }
      o += '</table:table-row>';
    }
    return o + '</table:table>';
  };
  const corps = blocs(feuille);
  const pg = reglages.page;
  const hf = (z) => z && (z.gauche || z.centre || z.droite) ? `<text:p text:style-name="Header">${[z.gauche, z.centre, z.droite].map(v => x(v || '').replace(/\{page\}/g, '<text:page-number text:select-page="current">1</text:page-number>').replace(/\{pages\}/g, '<text:page-count>1</text:page-count>').replace(/\{date\}/g, new Date().toLocaleDateString('fr-FR')).replace(/\{titre\}/g, x(titre))).join('<text:tab/>')}</text:p>` : '';
  const police = (reglages.police || 'Calibri').split(',')[0].replace(/["']/g, '');
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:font-face-decls/><office:automatic-styles><style:style style:name="SautPage" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page"/></style:style><style:style style:name="Tableau" style:family="table"><style:table-properties style:width="${((reglages.largeurContenu || 600) * PX_CM).toFixed(2)}cm" table:align="margins"/></style:style><style:style style:name="Cellule" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #808080"/></style:style>${[...stylesAuto.values()].map(v => v.xml).join('')}</office:automatic-styles><office:body><office:text>${corps}</office:text></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS}><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.28cm"/><style:text-properties style:font-name="${x(police)}" fo:font-family="${x(police)}" fo:font-size="${reglages.taille || 11}pt" fo:language="fr" fo:country="FR"/></style:default-style><style:style style:name="Standard" style:family="paragraph" style:class="text"/>
${[1, 2, 3, 4, 5, 6].map(i => `<style:style style:name="Heading_20_${i}" style:display-name="Heading ${i}" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:default-outline-level="${i}" style:class="text"><style:paragraph-properties fo:margin-top="0.42cm" fo:margin-bottom="0.14cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="${[16, 13, 12, 11, 11, 11][i - 1]}pt" fo:font-weight="bold" fo:color="#1F3864"/></style:style>`).join('')}
<style:style style:name="Title" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-size="28pt" fo:color="#1F3864"/></style:style><style:style style:name="Subtitle" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-size="15pt" fo:color="#595959"/></style:style><style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="1cm" fo:margin-right="1cm"/><style:text-properties fo:font-style="italic"/></style:style><style:style style:name="Preformatted_20_Text" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties style:font-name="Consolas" fo:font-family="Consolas" fo:font-size="10pt"/></style:style><style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties><style:tab-stops><style:tab-stop style:position="${((reglages.largeurContenu || 600) * PX_CM / 2).toFixed(2)}cm" style:type="center"/><style:tab-stop style:position="${((reglages.largeurContenu || 600) * PX_CM).toFixed(2)}cm" style:type="right"/></style:tab-stops></style:paragraph-properties><style:text-properties fo:font-size="9pt" fo:color="#595959"/></style:style>
<text:list-style style:name="List_20_1">${[1, 2, 3, 4, 5].map(i => `<text:list-level-style-bullet text:level="${i}" text:bullet-char="${['•', '◦', '▪', '•', '◦'][i - 1]}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.635cm" fo:margin-left="${(0.635 * i + 0.635).toFixed(3)}cm"/></style:list-level-properties></text:list-level-style-bullet>`).join('')}</text:list-style>
<text:list-style style:name="Numbering_20_123">${[1, 2, 3, 4, 5].map(i => `<text:list-level-style-number text:level="${i}" style:num-suffix="." style:num-format="${['1', 'a', 'i', '1', 'a'][i - 1]}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.635cm" fo:margin-left="${(0.635 * i + 0.635).toFixed(3)}cm"/></style:list-level-properties></text:list-level-style-number>`).join('')}</text:list-style>
</office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${(pg.largeur * PX_CM).toFixed(2)}cm" fo:page-height="${(pg.hauteur * PX_CM).toFixed(2)}cm" style:print-orientation="${pg.paysage ? 'landscape' : 'portrait'}" fo:margin-top="${(pg.marges.haut * PX_CM).toFixed(2)}cm" fo:margin-bottom="${(pg.marges.bas * PX_CM).toFixed(2)}cm" fo:margin-left="${(pg.marges.gauche * PX_CM).toFixed(2)}cm" fo:margin-right="${(pg.marges.droite * PX_CM).toFixed(2)}cm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1">${hf(reglages.entete) ? `<style:header>${hf(reglages.entete)}</style:header>` : ''}${hf(reglages.pied) ? `<style:footer>${hf(reglages.pied)}</style:footer>` : ''}</style:master-page></office:master-styles></office:document-styles>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${NS}><office:meta><dc:title>${x(titre)}</dc:title><meta:generator>Suite Acad’ Texte</meta:generator><dc:language>fr-FR</dc:language></office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${images.map(i => `<manifest:file-entry manifest:full-path="${i.nom}" manifest:media-type="${i.type}"/>`).join('')}</manifest:manifest>`;
  const f = { mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }], 'content.xml': strToU8(content), 'styles.xml': strToU8(styles), 'meta.xml': strToU8(meta), 'META-INF/manifest.xml': strToU8(manifest) };
  images.forEach(i => f[i.nom] = i.o);
  return zipSync(f, { level: 6 });
}

// ---------- Lecture ----------
export function lireOdt(octets) {
  const z = unzipSync(octets);
  if (!z['content.xml']) throw new Error('fichier OpenDocument invalide');
  const doc = new DOMParser().parseFromString(strFromU8(z['content.xml']), 'application/xml');
  const stylesDoc = z['styles.xml'] ? new DOMParser().parseFromString(strFromU8(z['styles.xml']), 'application/xml') : null;
  const STYLE = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0', FO = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0', TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0', TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0', DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', XLINK = 'http://www.w3.org/1999/xlink';
  const styles = {};
  const lireStyles = d => d && d.getElementsByTagNameNS(STYLE, 'style') && [...d.getElementsByTagNameNS(STYLE, 'style')].forEach(s => {
    const nom = s.getAttributeNS(STYLE, 'name'); const css = []; let parent = s.getAttributeNS(STYLE, 'parent-style-name');
    const tp = s.getElementsByTagNameNS(STYLE, 'text-properties')[0], pp = s.getElementsByTagNameNS(STYLE, 'paragraph-properties')[0];
    if (tp) {
      if (tp.getAttributeNS(FO, 'font-weight') === 'bold') css.push('font-weight:bold');
      if (tp.getAttributeNS(FO, 'font-style') === 'italic') css.push('font-style:italic');
      const u = tp.getAttributeNS(STYLE, 'text-underline-style'), lt = tp.getAttributeNS(STYLE, 'text-line-through-style');
      const deco = []; if (u && u !== 'none') deco.push('underline'); if (lt && lt !== 'none') deco.push('line-through'); if (deco.length) css.push('text-decoration:' + deco.join(' '));
      const c = tp.getAttributeNS(FO, 'color'); if (c) css.push('color:' + c);
      const b = tp.getAttributeNS(FO, 'background-color'); if (b && b !== 'transparent') css.push('background-color:' + b);
      const fs = tp.getAttributeNS(FO, 'font-size'); if (fs && /pt$/.test(fs)) css.push('font-size:' + fs);
      const ff = tp.getAttributeNS(STYLE, 'font-name') || tp.getAttributeNS(FO, 'font-family'); if (ff) css.push('font-family:' + ff.replace(/'/g, ''));
      const pos = tp.getAttributeNS(STYLE, 'text-position'); if (pos) css.push('vertical-align:' + (pos.startsWith('sub') || pos.startsWith('-') ? 'sub' : 'super'));
    }
    if (pp) {
      const al = pp.getAttributeNS(FO, 'text-align'); if (al) css.push('text-align:' + ({ start: 'left', end: 'right' }[al] || al));
      const ml = pp.getAttributeNS(FO, 'margin-left'); if (ml && parseFloat(ml) > 0) css.push('margin-left:' + ml);
    }
    styles[nom] = { css: css.join(';'), parent, titre: /Heading/i.test(nom) || /Heading/i.test(parent || '') };
  });
  lireStyles(stylesDoc); lireStyles(doc);
  const cssDe = n => { const s = styles[n]; return s ? s.css : ''; };
  const esc = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const image = (href) => {
    const o = z[href]; if (!o) return '';
    const ext = href.split('.').pop().toLowerCase();
    let b = ''; for (let i = 0; i < o.length; i += 0x8000) b += String.fromCharCode.apply(null, o.subarray(i, i + 0x8000));
    return `<img src="data:image/${ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext};base64,${btoa(b)}">`;
  };
  const enLigne = n => {
    let o = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { o += esc(c.nodeValue); continue; }
      if (c.nodeType !== 1) continue;
      const l = c.localName;
      if (l === 's') o += ' '.repeat(+(c.getAttributeNS(TEXT, 'c') || 1)).replace(/ /g, ' ');
      else if (l === 'tab') o += '    ';
      else if (l === 'line-break') o += '<br>';
      else if (l === 'span') { const css = cssDe(c.getAttributeNS(TEXT, 'style-name')); o += css ? `<span style="${css}">${enLigne(c)}</span>` : enLigne(c); }
      else if (l === 'a') o += `<a href="${esc(c.getAttributeNS(XLINK, 'href') || '')}">${enLigne(c)}</a>`;
      else if (l === 'frame') { const im = c.getElementsByTagNameNS(DRAW, 'image')[0]; if (im) o += image(im.getAttributeNS(XLINK, 'href')); }
      else if (l === 'page-number') o += '<span class="champ" data-champ="page" contenteditable="false">#</span>';
      else if (l === 'note' || l === 'annotation') { }
      else o += enLigne(c);
    }
    return o;
  };
  const blocs = n => {
    let o = '';
    for (const c of n.children) {
      const l = c.localName;
      if (l === 'h') { const niv = Math.min(6, +(c.getAttributeNS(TEXT, 'outline-level') || 1)); o += `<h${niv}>${enLigne(c) || '<br>'}</h${niv}>`; }
      else if (l === 'p') {
        const sn = c.getAttributeNS(TEXT, 'style-name'); const s = styles[sn] || {};
        if (s.titre) { o += `<h2>${enLigne(c)}</h2>`; continue; }
        const css = cssDe(sn);
        o += `<p${css ? ` style="${css}"` : ''}>${enLigne(c) || '<br>'}</p>`;
      }
      else if (l === 'list') {
        const sn = c.getAttributeNS(TEXT, 'style-name') || '';
        const tag = /Numbering|Num|123/i.test(sn) ? 'ol' : 'ul';
        o += `<${tag}>${[...c.children].filter(i => i.localName === 'list-item' || i.localName === 'list-header').map(i => `<li>${[...i.children].map(k => k.localName === 'list' ? blocs({ children: [k] }) : enLigne(k)).join('')}</li>`).join('')}</${tag}>`;
      }
      else if (l === 'table') {
        o += '<table class="tab"><tbody>';
        c.querySelectorAll ? null : null;
        const lignes = [...c.getElementsByTagNameNS(TABLE, 'table-row')];
        lignes.forEach(r => {
          o += '<tr>';
          [...r.children].forEach(td => {
            if (td.localName !== 'table-cell') return;
            const cs = +(td.getAttributeNS(TABLE, 'number-columns-spanned') || 1), rs = +(td.getAttributeNS(TABLE, 'number-rows-spanned') || 1);
            o += `<td${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}>${[...td.children].map(k => k.localName === 'p' ? enLigne(k) : '').join('<br>') || '<br>'}</td>`;
          });
          o += '</tr>';
        });
        o += '</tbody></table>';
      }
      else if (l === 'section' || l === 'table-of-content' || l === 'index-body') o += blocs(c);
    }
    return o;
  };
  const corps = doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0', 'text')[0];
  return corps ? blocs(corps) : '';
}
