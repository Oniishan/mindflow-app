// Calcul — lecture et écriture des classeurs Excel (.xlsx), OpenDocument (.ods) et CSV
import { zipSync, unzipSync, strToU8, strFromU8 } from '../commun/vendor/fflate.js';
import * as XLSX from '../commun/vendor/xlsx.mjs';
import { colLettre, versAnglais, depuisAnglais, Erreur, lettreCol } from './formules.js';
import { nouveauClasseur, nouvelleFeuille, cle, COLS_MAX, etendue, serialiser, deserialiser, LARGEUR_DEF, HAUTEUR_DEF } from './modele.js';
import { analyserSaisie, formaterValeur } from './format.js';

const x = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const ERR_EN = { '#DIV/0!': '#DIV/0!', '#N/A': '#N/A', '#NOM?': '#NAME?', '#VALEUR!': '#VALUE!', '#REF!': '#REF!', '#NOMBRE!': '#NUM!', '#NUL!': '#NULL!', '#CIRC!': '#REF!' };
const ERR_FR = { '#NAME?': '#NOM?', '#VALUE!': '#VALEUR!', '#NUM!': '#NOMBRE!', '#NULL!': '#NUL!' };
const hex = c => { if (!c) return null; const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); if (m) return 'FF' + m[1].toUpperCase(); const r = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return r ? 'FF' + [r[1], r[2], r[3]].map(v => (+v).toString(16).padStart(2, '0')).join('').toUpperCase() : null; };
const largeurExcel = px => Math.max(0.5, Math.round(((px - 5) / 7) * 100) / 100);
const pxDepuisLargeur = w => Math.round(w * 7 + 5);

// ---------- Écriture XLSX ----------
export async function ecrireXlsx(classeur, { valeur, images = [] } = {}) {
  const fichiers = {};
  const partages = [], idxPartage = new Map();
  const partage = s => { if (!idxPartage.has(s)) { idxPartage.set(s, partages.length); partages.push(s); } return idxPartage.get(s); };
  // styles
  const polices = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'], remplis = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'], bordures = ['<border><left/><right/><top/><bottom/><diagonal/></border>'], formats = [], xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'], dxfs = [];
  const iP = new Map(), iR = new Map(), iB = new Map(), iF = new Map(), iX = new Map();
  const ajout = (liste, map, xml) => { if (!map.has(xml)) { map.set(xml, liste.length); liste.push(xml); } return map.get(xml); };
  const FORMATS_STD = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '0.00E+00': 11, '# ?/?': 12, 'hh:mm': 20, 'h:mm': 20, 'hh:mm:ss': 21, '@': 49 };
  const idFormat = code => { if (!code || code === 'General') return 0; if (FORMATS_STD[code] !== undefined) return FORMATS_STD[code]; if (!iF.has(code)) { iF.set(code, 164 + formats.length); formats.push(`<numFmt numFmtId="${164 + formats.length}" formatCode="${x(code)}"/>`); } return iF.get(code); };
  const bord = b => b ? `<${b.cote} style="${b.style || 'thin'}"><color rgb="${hex(b.couleur || '#000000')}"/></${b.cote}>` : '';
  const idStyle = s => {
    if (!s) return 0;
    const fp = `<font>${s.gras ? '<b/>' : ''}${s.italique ? '<i/>' : ''}${s.barre ? '<strike/>' : ''}${s.souligne ? '<u/>' : ''}<sz val="${s.taille || 11}"/>${s.couleur ? `<color rgb="${hex(s.couleur)}"/>` : ''}<name val="${x(s.police || 'Calibri')}"/><family val="2"/></font>`;
    const f = ajout(polices, iP, fp);
    const r = s.fond ? ajout(remplis, iR, `<fill><patternFill patternType="solid"><fgColor rgb="${hex(s.fond)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const b = s.bordures ? ajout(bordures, iB, `<border>${['left', 'right', 'top', 'bottom'].map(c => s.bordures[{ left: 'g', right: 'd', top: 'h', bottom: 'b' }[c]] ? bord({ cote: c, ...s.bordures[{ left: 'g', right: 'd', top: 'h', bottom: 'b' }[c]] }) : `<${c}/>`).join('')}<diagonal/></border>`) : 0;
    const nf = idFormat(s.format);
    const al = (s.alignH || s.alignV || s.retour || s.retrait || s.rotation) ? `<alignment${s.alignH ? ` horizontal="${{ gauche: 'left', centre: 'center', droite: 'right', justifie: 'justify' }[s.alignH] || s.alignH}"` : ''}${s.alignV ? ` vertical="${{ haut: 'top', milieu: 'center', bas: 'bottom' }[s.alignV] || s.alignV}"` : ''}${s.retour ? ' wrapText="1"' : ''}${s.retrait ? ` indent="${s.retrait}"` : ''}${s.rotation ? ` textRotation="${s.rotation}"` : ''}/>` : '';
    const xml = `<xf numFmtId="${nf}" fontId="${f}" fillId="${r}" borderId="${b}" xfId="0"${nf ? ' applyNumberFormat="1"' : ''}${f ? ' applyFont="1"' : ''}${r ? ' applyFill="1"' : ''}${b ? ' applyBorder="1"' : ''}${al ? ' applyAlignment="1">' + al + '</xf>' : '/>'}`;
    return ajout(xfs, iX, xml);
  };
  const feuillesXml = [];
  const relsFeuilles = [];
  let nCom = 0, nDessin = 0;
  const contentTypesExtra = [];
  classeur.feuilles.forEach((f, fi) => {
    const lignes = new Map();
    for (const [k, c] of f.cellules) { const r = Math.floor(k / COLS_MAX); if (!lignes.has(r)) lignes.set(r, []); lignes.get(r).push([k % COLS_MAX, c]); }
    const rs = [...lignes.keys()].sort((a, b) => a - b);
    const toutesLignes = new Set([...rs, ...Object.keys(f.hauteurs).map(Number), ...f.ligMasquees]);
    let sd = '';
    for (const r of [...toutesLignes].sort((a, b) => a - b)) {
      const cells = (lignes.get(r) || []).sort((a, b) => a[0] - b[0]);
      const h = f.hauteurs[r], cache = f.ligMasquees.includes(r);
      sd += `<row r="${r + 1}"${h ? ` ht="${(h * 0.75).toFixed(2)}" customHeight="1"` : ''}${cache ? ' hidden="1"' : ''}>`;
      for (const [c, cel] of cells) {
        const ref = colLettre(c) + (r + 1); const s = idStyle(cel.s);
        const sa = s ? ` s="${s}"` : '';
        if (cel.f) {
          const v = valeur(fi, r, c);
          let t = '', vv = '';
          if (v instanceof Erreur) { t = ' t="e"'; vv = ERR_EN[v.code] || '#VALUE!'; }
          else if (typeof v === 'string') { t = ' t="str"'; vv = x(v); }
          else if (typeof v === 'boolean') { t = ' t="b"'; vv = v ? 1 : 0; }
          else if (typeof v === 'number' && isFinite(v)) vv = String(v);
          sd += `<c r="${ref}"${sa}${t}><f>${x(versAnglais(cel.f))}</f>${vv !== '' ? `<v>${vv}</v>` : ''}</c>`;
        } else if (cel.v == null || cel.v === '') sd += `<c r="${ref}"${sa}/>`;
        else if (typeof cel.v === 'number') sd += `<c r="${ref}"${sa}><v>${cel.v}</v></c>`;
        else if (typeof cel.v === 'boolean') sd += `<c r="${ref}"${sa} t="b"><v>${cel.v ? 1 : 0}</v></c>`;
        else sd += `<c r="${ref}"${sa} t="s"><v>${partage(String(cel.v))}</v></c>`;
      }
      sd += '</row>';
    }
    const u = etendue(f);
    const dim = u.r2 >= 0 ? `A1:${colLettre(Math.max(0, u.c2))}${u.r2 + 1}` : 'A1';
    const colsIdx = new Set([...Object.keys(f.largeurs).map(Number), ...f.colMasquees]);
    const cols = [...colsIdx].sort((a, b) => a - b).map(c => `<col min="${c + 1}" max="${c + 1}" width="${largeurExcel(f.largeurs[c] || LARGEUR_DEF)}" customWidth="1"${f.colMasquees.includes(c) ? ' hidden="1"' : ''}/>`).join('');
    const fg = f.figer || {};
    const pane = fg.l || fg.c ? `<pane${fg.c ? ` xSplit="${fg.c}"` : ''}${fg.l ? ` ySplit="${fg.l}"` : ''} topLeftCell="${colLettre(fg.c || 0)}${(fg.l || 0) + 1}" activePane="${fg.l && fg.c ? 'bottomRight' : fg.l ? 'bottomLeft' : 'topRight'}" state="frozen"/>` : '';
    let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`;
    xml += `<sheetPr>${f.couleurOnglet ? `<tabColor rgb="${hex(f.couleurOnglet)}"/>` : ''}${f.filtre ? '' : ''}</sheetPr><dimension ref="${dim}"/><sheetViews><sheetView${fi === classeur.active ? ' tabSelected="1"' : ''}${f.quadrillage === false ? ' showGridLines="0"' : ''}${f.entetes === false ? ' showRowColHeaders="0"' : ''} workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="16.5"/>`;
    if (cols) xml += `<cols>${cols}</cols>`;
    xml += `<sheetData>${sd}</sheetData>`;
    if (f.protegee) xml += '<sheetProtection sheet="1" objects="1" scenarios="1"/>';
    if (f.filtre) xml += `<autoFilter ref="${colLettre(f.filtre.c1)}${f.filtre.r1 + 1}:${colLettre(f.filtre.c2)}${f.filtre.r2 + 1}"/>`;
    if (f.fusions.length) xml += `<mergeCells count="${f.fusions.length}">${f.fusions.map(m => `<mergeCell ref="${colLettre(m.c1)}${m.r1 + 1}:${colLettre(m.c2)}${m.r2 + 1}"/>`).join('')}</mergeCells>`;
    // mise en forme conditionnelle
    let prio = 1;
    for (const m of f.mfc || []) {
      const ref = `${colLettre(m.c1)}${m.r1 + 1}:${colLettre(m.c2)}${m.r2 + 1}`;
      if (m.type === 'echelle') { xml += `<conditionalFormatting sqref="${ref}"><cfRule type="colorScale" priority="${prio++}"><colorScale><cfvo type="min"/><cfvo type="max"/><color rgb="${hex(m.couleur1 || '#F8696B')}"/><color rgb="${hex(m.couleur2 || '#63BE7B')}"/></colorScale></cfRule></conditionalFormatting>`; continue; }
      if (m.type === 'barres') { xml += `<conditionalFormatting sqref="${ref}"><cfRule type="dataBar" priority="${prio++}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="${hex(m.couleur || '#638EC6')}"/></dataBar></cfRule></conditionalFormatting>`; continue; }
      const dxf = `<dxf>${m.style?.couleur || m.style?.gras ? `<font>${m.style.gras ? '<b/>' : ''}${m.style.couleur ? `<color rgb="${hex(m.style.couleur)}"/>` : ''}</font>` : ''}${m.style?.fond ? `<fill><patternFill><bgColor rgb="${hex(m.style.fond)}"/></patternFill></fill>` : ''}</dxf>`;
      dxfs.push(dxf); const di = dxfs.length - 1;
      const op = { sup: 'greaterThan', inf: 'lessThan', egal: 'equal', diff: 'notEqual', supeg: 'greaterThanOrEqual', infeg: 'lessThanOrEqual', entre: 'between' }[m.op];
      const val = v => typeof v === 'number' || /^-?\d+([.,]\d+)?$/.test(String(v)) ? String(v).replace(',', '.') : `"${x(String(v).replace(/"/g, '""'))}"`;
      if (m.op === 'contient') xml += `<conditionalFormatting sqref="${ref}"><cfRule type="containsText" dxfId="${di}" priority="${prio++}" operator="containsText" text="${x(m.v1)}"><formula>NOT(ISERROR(SEARCH("${x(m.v1)}",${colLettre(m.c1)}${m.r1 + 1})))</formula></cfRule></conditionalFormatting>`;
      else if (m.op === 'doublons') xml += `<conditionalFormatting sqref="${ref}"><cfRule type="duplicateValues" dxfId="${di}" priority="${prio++}"/></conditionalFormatting>`;
      else if (op) xml += `<conditionalFormatting sqref="${ref}"><cfRule type="cellIs" dxfId="${di}" priority="${prio++}" operator="${op}"><formula>${val(m.v1)}</formula>${m.op === 'entre' ? `<formula>${val(m.v2)}</formula>` : ''}</cfRule></conditionalFormatting>`;
    }
    if ((f.validations || []).length) xml += `<dataValidations count="${f.validations.length}">${f.validations.map(v => `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${colLettre(v.c1)}${v.r1 + 1}:${colLettre(v.c2)}${v.r2 + 1}"><formula1>"${x(v.liste.join(','))}"</formula1></dataValidation>`).join('')}</dataValidations>`;
    xml += `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`;
    if (f.impression) xml += `<pageSetup paperSize="9" orientation="${f.impression.paysage ? 'landscape' : 'portrait'}"${f.impression.ajuster ? ' fitToWidth="1" fitToHeight="0"' : ''}/>`;
    const rels = [];
    // images des graphiques
    const imgs = images.filter(i => i.feuille === fi);
    if (imgs.length) {
      nDessin++;
      rels.push(`<Relationship Id="rIdDessin" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${nDessin}.xml"/>`);
      xml += '<drawing r:id="rIdDessin"/>';
      let dx = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`;
      const drels = [];
      imgs.forEach((im, k) => {
        const nom = `image${nDessin}_${k + 1}.png`; fichiers['xl/media/' + nom] = im.png;
        drels.push(`<Relationship Id="rIdImg${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${nom}"/>`);
        dx += `<xdr:oneCellAnchor><xdr:from><xdr:col>${im.c}</xdr:col><xdr:colOff>${Math.round(im.dx * 9525)}</xdr:colOff><xdr:row>${im.r}</xdr:row><xdr:rowOff>${Math.round(im.dy * 9525)}</xdr:rowOff></xdr:from><xdr:ext cx="${Math.round(im.l * 9525)}" cy="${Math.round(im.h * 9525)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${k + 2}" name="${x(im.titre || 'Graphique')}" descr="${x(im.titre || 'Graphique')}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImg${k + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(im.l * 9525)}" cy="${Math.round(im.h * 9525)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
      });
      dx += '</xdr:wsDr>';
      fichiers[`xl/drawings/drawing${nDessin}.xml`] = strToU8(dx);
      fichiers[`xl/drawings/_rels/drawing${nDessin}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drels.join('')}</Relationships>`);
      contentTypesExtra.push(`<Override PartName="/xl/drawings/drawing${nDessin}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    }
    // notes (commentaires)
    const notes = [...f.cellules.entries()].filter(([, c]) => c.n);
    if (notes.length) {
      nCom++;
      rels.push(`<Relationship Id="rIdCom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments${nCom}.xml"/>`, `<Relationship Id="rIdVml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing${nCom}.vml"/>`);
      xml += '<legacyDrawing r:id="rIdVml"/>';
      fichiers[`xl/comments${nCom}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Suite Acad’</author></authors><commentList>${notes.map(([k, c]) => `<comment ref="${colLettre(k % COLS_MAX)}${Math.floor(k / COLS_MAX) + 1}" authorId="0"><text><r><t xml:space="preserve">${x(c.n)}</t></r></text></comment>`).join('')}</commentList></comments>`);
      fichiers[`xl/drawings/vmlDrawing${nCom}.vml`] = strToU8(`<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${nCom}"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>${notes.map(([k], i) => `<v:shape id="_x0000_s${nCom * 1024 + i + 1}" type="#_x0000_t202" style="position:absolute;margin-left:80pt;margin-top:2pt;width:120pt;height:60pt;z-index:${i + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill><x:Row>${Math.floor(k / COLS_MAX)}</x:Row><x:Column>${k % COLS_MAX}</x:Column></x:ClientData></v:shape>`).join('')}</xml>`);
      contentTypesExtra.push(`<Override PartName="/xl/comments${nCom}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`);
    }
    xml += '</worksheet>';
    feuillesXml.push(xml);
    relsFeuilles.push(rels);
  });
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${partages.length}" uniqueCount="${partages.length}">${partages.map(s => `<si><t xml:space="preserve">${x(s)}</t></si>`).join('')}</sst>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${formats.length ? `<numFmts count="${formats.length}">${formats.join('')}</numFmts>` : ''}<fonts count="${polices.length}">${polices.join('')}</fonts><fills count="${remplis.length}">${remplis.join('')}</fills><borders count="${bordures.length}">${bordures.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${dxfs.length}">${dxfs.join('')}</dxfs></styleSheet>`;
  const nomsFeuilles = classeur.feuilles.map(f => f.nom);
  const filtres = classeur.feuilles.map((f, i) => f.filtre ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${x(f.nom.replace(/'/g, "''"))}'!$${colLettre(f.filtre.c1)}$${f.filtre.r1 + 1}:$${colLettre(f.filtre.c2)}$${f.filtre.r2 + 1}</definedName>` : '').join('');
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${classeur.active}"/></bookViews><sheets>${nomsFeuilles.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${filtres ? `<definedNames>${filtres}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  const n = nomsFeuilles.length;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${nomsFeuilles.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="json" ContentType="application/json"/><Default Extension="png" ContentType="image/png"/><Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${nomsFeuilles.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${contentTypesExtra.join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  Object.assign(fichiers, {
    '[Content_Types].xml': strToU8(ct),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(wb), 'xl/_rels/workbook.xml.rels': strToU8(wbRels), 'xl/styles.xml': strToU8(stylesXml), 'xl/sharedStrings.xml': strToU8(sst),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:language>fr-FR</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${(classeur.cree || new Date().toISOString()).replace(/\.\d+Z$/, 'Z')}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:modified></cp:coreProperties>`),
    'docProps/app.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Calcul</Application></Properties>`),
  });
  feuillesXml.forEach((s, i) => {
    fichiers[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(s);
    if (relsFeuilles[i].length) fichiers[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsFeuilles[i].join('')}</Relationships>`);
  });
  // copie fidèle pour Calcul (graphiques, réglages d'affichage…)
  const empreinte = await hacher(feuillesXml.join(''));
  fichiers['atelier/classeur.json'] = strToU8(JSON.stringify({ empreinte, classeur: serialiser(classeur) }));
  return zipSync(fichiers, { level: 6 });
}
async function hacher(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(v => v.toString(16).padStart(2, '0')).join(''); }

// ---------- Lecture XLSX / ODS ----------
export async function lireClasseur(octets, ext) {
  if (ext === 'xlsx' || ext === 'xlsm') {
    const z = unzipSync(octets);
    if (z['atelier/classeur.json']) {
      try {
        const o = JSON.parse(strFromU8(z['atelier/classeur.json']));
        const xmls = Object.keys(z).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0])).map(k => strFromU8(z[k])).join('');
        if (o.empreinte === await hacher(xmls)) return deserialiser(o.classeur);
      } catch { }
    }
    return depuisSheetJS(XLSX.read(octets, { type: 'array', cellFormula: true, cellStyles: true, cellNF: true, cellDates: false, sheetStubs: true }), z);
  }
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return lireCSV(octets);
  return depuisSheetJS(XLSX.read(octets, { type: 'array', cellFormula: true, cellNF: true, cellDates: false }), null);
}

function stylesDepuisXlsx(z) {
  // Analyse de xl/styles.xml : polices, remplissages, bordures, formats, alignements
  if (!z || !z['xl/styles.xml']) return [];
  const d = new DOMParser().parseFromString(strFromU8(z['xl/styles.xml']), 'application/xml');
  const q = (n, s) => [...n.getElementsByTagName(s)];
  const couleur = n => { if (!n) return null; const rgb = n.getAttribute('rgb'); if (rgb) return '#' + rgb.slice(-6); const ix = n.getAttribute('indexed'); if (ix) return { 8: '#000000', 9: '#FFFFFF', 10: '#FF0000', 12: '#0000FF', 13: '#FFFF00' }[ix] || null; const th = n.getAttribute('theme'); if (th) return { 0: '#FFFFFF', 1: '#000000', 2: '#E7E6E6', 3: '#44546A', 4: '#4472C4', 5: '#ED7D31', 6: '#A5A5A5', 7: '#FFC000', 8: '#5B9BD5', 9: '#70AD47' }[th] || null; return null; };
  const numFmts = {}; q(d, 'numFmt').forEach(n => numFmts[n.getAttribute('numFmtId')] = n.getAttribute('formatCode'));
  const STD = { 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 14: 'dd/mm/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'hh:mm', 21: 'hh:mm:ss', 22: 'dd/mm/yyyy hh:mm', 44: '_-* #,##0.00 "€"_-;-* #,##0.00 "€"_-;_-* "-"?? "€"_-;_-@_-', 49: '@' };
  const fontsEl = q(d, 'fonts')[0], fillsEl = q(d, 'fills')[0], bordersEl = q(d, 'borders')[0];
  const fonts = fontsEl ? [...fontsEl.children] : [], fills = fillsEl ? [...fillsEl.children] : [], borders = bordersEl ? [...bordersEl.children] : [];
  const xfsEl = q(d, 'cellXfs')[0]; if (!xfsEl) return [];
  return [...xfsEl.children].map(xf => {
    const s = {};
    const f = fonts[+xf.getAttribute('fontId') || 0];
    if (f) {
      if (f.getElementsByTagName('b')[0] && f.getElementsByTagName('b')[0].getAttribute('val') !== '0') s.gras = true;
      if (f.getElementsByTagName('i')[0] && f.getElementsByTagName('i')[0].getAttribute('val') !== '0') s.italique = true;
      if (f.getElementsByTagName('u')[0]) s.souligne = true;
      if (f.getElementsByTagName('strike')[0]) s.barre = true;
      const sz = f.getElementsByTagName('sz')[0]; if (sz && +sz.getAttribute('val') !== 11) s.taille = +sz.getAttribute('val');
      const c = couleur(f.getElementsByTagName('color')[0]); if (c && c !== '#000000') s.couleur = c;
      const nm = f.getElementsByTagName('name')[0]; if (nm && nm.getAttribute('val') !== 'Calibri') s.police = nm.getAttribute('val');
    }
    const fi = fills[+xf.getAttribute('fillId') || 0];
    if (fi) { const p = fi.getElementsByTagName('patternFill')[0]; if (p && p.getAttribute('patternType') === 'solid') { const c = couleur(p.getElementsByTagName('fgColor')[0]); if (c) s.fond = c; } }
    const bo = borders[+xf.getAttribute('borderId') || 0];
    if (bo) { const b = {}; for (const [tag, k] of [['left', 'g'], ['right', 'd'], ['top', 'h'], ['bottom', 'b']]) { const e = bo.getElementsByTagName(tag)[0]; if (e && e.getAttribute('style')) b[k] = { style: e.getAttribute('style'), couleur: couleur(e.getElementsByTagName('color')[0]) || '#000000' }; } if (Object.keys(b).length) s.bordures = b; }
    const nf = xf.getAttribute('numFmtId'); if (nf && nf !== '0') s.format = numFmts[nf] || STD[nf];
    const al = xf.getElementsByTagName('alignment')[0];
    if (al) { const h = al.getAttribute('horizontal'), v = al.getAttribute('vertical'); if (h) s.alignH = { left: 'gauche', center: 'centre', right: 'droite', justify: 'justifie', centerContinuous: 'centre' }[h]; if (v) s.alignV = { top: 'haut', center: 'milieu', bottom: 'bas' }[v]; if (al.getAttribute('wrapText') === '1') s.retour = true; if (al.getAttribute('indent')) s.retrait = +al.getAttribute('indent'); }
    return Object.keys(s).length ? s : null;
  });
}

function depuisSheetJS(wb, z) {
  const c = nouveauClasseur(); c.feuilles = [];
  const styles = stylesDepuisXlsx(z);
  const relsWb = z && z['xl/_rels/workbook.xml.rels'] ? strFromU8(z['xl/_rels/workbook.xml.rels']) : '';
  const wbXml = z && z['xl/workbook.xml'] ? strFromU8(z['xl/workbook.xml']) : '';
  wb.SheetNames.forEach((nom, i) => {
    const ws = wb.Sheets[nom]; const f = nouvelleFeuille(nom);
    // style par cellule et réglages d'affichage depuis le XML de la feuille
    let sx = null;
    if (z) {
      const rid = new RegExp(`<sheet[^>]*name="${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"[^>]*r:id="([^"]+)"`).exec(wbXml)?.[1];
      const cible = rid && new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(relsWb)?.[1];
      const chemin = cible ? 'xl/' + cible.replace(/^\/?xl\//, '').replace(/^\//, '') : `xl/worksheets/sheet${i + 1}.xml`;
      if (z[chemin]) sx = strFromU8(z[chemin]);
    }
    const styleCell = {};
    if (sx) {
      for (const m of sx.matchAll(/<c r="([A-Z]+)(\d+)"[^>]*?\ss="(\d+)"/g)) styleCell[m[1] + m[2]] = +m[3];
      const pane = /<pane([^>]*)state="frozen"/.exec(sx); if (pane) { const xs = /xSplit="(\d+)"/.exec(pane[1]), ys = /ySplit="(\d+)"/.exec(pane[1]); f.figer = { l: ys ? +ys[1] : 0, c: xs ? +xs[1] : 0 }; }
      if (/showGridLines="0"/.test(sx)) f.quadrillage = false;
      const tab = /<tabColor rgb="..([0-9A-F]{6})"/i.exec(sx); if (tab) f.couleurOnglet = '#' + tab[1];
      for (const m of sx.matchAll(/<dataValidation [^>]*type="list"[^>]*sqref="([^"]+)"[^>]*>\s*<formula1>"([^<]*)"<\/formula1>/g)) { const [a, b] = m[1].split(' ')[0].split(':'); const p1 = /([A-Z]+)(\d+)/.exec(a), p2 = /([A-Z]+)(\d+)/.exec(b || a); f.validations.push({ r1: +p1[2] - 1, c1: lettreCol(p1[1]), r2: +p2[2] - 1, c2: lettreCol(p2[1]), liste: m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&').split(',') }); }
    }
    for (const k of Object.keys(ws)) {
      if (k[0] === '!') continue;
      const m = /^([A-Z]+)(\d+)$/.exec(k); if (!m) continue;
      const r = +m[2] - 1, col = lettreCol(m[1]);
      const cel = ws[k]; const o = {};
      if (cel.f) o.f = depuisAnglais(cel.f);
      else if (cel.t === 'n') o.v = cel.v;
      else if (cel.t === 's' || cel.t === 'str') o.v = cel.v;
      else if (cel.t === 'b') o.v = !!cel.v;
      else if (cel.t === 'e') o.v = ERR_FR[cel.w] || cel.w || '#N/A';
      else if (cel.t === 'd') o.v = cel.v;
      const si = styleCell[k];
      let s = si != null && styles[si] ? { ...styles[si] } : null;
      if (!s && cel.z && cel.z !== 'General') s = { format: cel.z };
      if (s && cel.z && !s.format && cel.z !== 'General') s.format = cel.z;
      if (s) o.s = s;
      if (cel.c && cel.c.length) o.n = cel.c.map(x => x.t).join('\n').trim();
      if (o.v === undefined && !o.f && !o.s && !o.n) continue;
      f.cellules.set(cle(r, col), o);
    }
    (ws['!merges'] || []).forEach(m => f.fusions.push({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c }));
    (ws['!cols'] || []).forEach((cc, j) => { if (!cc) return; if (cc.hidden) f.colMasquees.push(j); const px = cc.width ? pxDepuisLargeur(cc.width) : cc.wch ? pxDepuisLargeur(cc.wch) : cc.wpx || null; if (px && Math.abs(px - LARGEUR_DEF) > 2) f.largeurs[j] = Math.round(px); });
    (ws['!rows'] || []).forEach((rr, j) => { if (!rr) return; if (rr.hidden) f.ligMasquees.push(j); const px = rr.hpx || (rr.hpt ? rr.hpt / 0.75 : null); if (px && Math.abs(px - HAUTEUR_DEF) > 2) f.hauteurs[j] = Math.round(px); });
    if (ws['!autofilter']) { const p = XLSX.utils.decode_range(ws['!autofilter'].ref); f.filtre = { r1: p.s.r, c1: p.s.c, r2: p.e.r, c2: p.e.c, criteres: {} }; }
    c.feuilles.push(f);
  });
  if (!c.feuilles.length) c.feuilles = [nouvelleFeuille('Feuil1')];
  return c;
}

export function ecrireOds(classeur, valeur) {
  const wb = XLSX.utils.book_new();
  classeur.feuilles.forEach((f, fi) => {
    const ws = {}; const u = etendue(f);
    for (const [k, c] of f.cellules) {
      const r = Math.floor(k / COLS_MAX), col = k % COLS_MAX; const a = colLettre(col) + (r + 1);
      const v = c.f ? valeur(fi, r, col) : c.v;
      const o = {};
      if (v instanceof Erreur) { o.t = 'e'; o.v = 0x07; o.w = v.code; }
      else if (typeof v === 'number') { o.t = 'n'; o.v = v; if (c.s?.format) o.z = c.s.format; }
      else if (typeof v === 'boolean') { o.t = 'b'; o.v = v; }
      else if (v == null) { if (!c.f) continue; o.t = 's'; o.v = ''; }
      else { o.t = 's'; o.v = String(v); }
      if (c.f) o.f = versAnglais(c.f);
      ws[a] = o;
    }
    ws['!ref'] = u.r2 >= 0 ? `A1:${colLettre(Math.max(0, u.c2))}${u.r2 + 1}` : 'A1';
    if (f.fusions.length) ws['!merges'] = f.fusions.map(m => ({ s: { r: m.r1, c: m.c1 }, e: { r: m.r2, c: m.c2 } }));
    const cols = []; Object.entries(f.largeurs).forEach(([c, w]) => cols[+c] = { wpx: w }); if (cols.length) ws['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, ws, f.nom);
  });
  return new Uint8Array(XLSX.write(wb, { bookType: 'ods', type: 'array' }));
}

// ---------- CSV ----------
export function lireCSV(octets) {
  let t;
  try { t = new TextDecoder('utf-8', { fatal: true }).decode(octets); } catch { t = new TextDecoder('windows-1252').decode(octets); }
  t = t.replace(/^\uFEFF/, '');
  const premiere = t.split(/\r?\n/)[0] || '';
  const sep = [';', '\t', ','].map(s => [s, (premiere.match(new RegExp(s === '\t' ? '\\t' : s, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const lignes = []; let ligne = [], champ = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { champ += '"'; i++; } else q = false; } else champ += ch; continue; }
    if (ch === '"') { q = true; continue; }
    if (ch === sep) { ligne.push(champ); champ = ''; continue; }
    if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; continue; }
    champ += ch;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  const c = nouveauClasseur(); const f = c.feuilles[0];
  lignes.forEach((l, r) => l.forEach((v, col) => {
    if (v === '') return;
    const a = analyserSaisie(v);
    const o = a.formule ? { v } : { v: a.valeur }; if (a.format) o.s = { format: a.format };
    f.cellules.set(cle(r, col), o);
  }));
  return c;
}
export function ecrireCSV(feuille, fi, valeur, sep = ';') {
  const u = etendue(feuille); const lignes = [];
  for (let r = 0; r <= u.r2; r++) {
    const l = [];
    for (let c = 0; c <= u.c2; c++) {
      const cel = feuille.cellules.get(cle(r, c));
      let v = cel ? (cel.f ? valeur(fi, r, c) : cel.v) : null;
      let t = v == null ? '' : formaterValeur(v, cel?.s?.format || 'General', 30).texte;
      t = t.replace(/\u00a0/g, ' ');
      if (/[";\n\r]/.test(t) || t.includes(sep)) t = '"' + t.replace(/"/g, '""') + '"';
      l.push(t);
    }
    lignes.push(l.join(sep));
  }
  return '\uFEFF' + lignes.join('\r\n') + '\r\n';
}
