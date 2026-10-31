// Diapo — export PowerPoint (PptxGenJS) et import .pptx
import { unzipSync, zipSync, strFromU8, strToU8 } from '../commun/vendor/fflate.js';
import { theme as themeDe, cheminForme } from './themes.js';

const PX_IN = 96;
const hex6 = c => { if (!c) return null; const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); if (m) return m[1].toUpperCase(); const r = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return r ? [r[1], r[2], r[3]].map(v => (+v).toString(16).padStart(2, '0')).join('').toUpperCase() : null; };
const FORMES_PPTX = { rect: 'rect', 'rect-arrondi': 'roundRect', ellipse: 'ellipse', triangle: 'triangle', losange: 'diamond', 'fleche-droite': 'rightArrow', 'fleche-gauche': 'leftArrow', chevron: 'chevron', etoile: 'star5', bulle: 'wedgeRectCallout', ligne: 'line', fleche: 'line' };

// Conversion du HTML d'une zone de texte en suites de « runs » PptxGenJS
function runs(html, base) {
  const d = document.createElement('div'); d.innerHTML = html || '';
  const out = [];
  const paragraphes = [];
  const blocs = n => {
    for (const c of n.childNodes) {
      if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) { [...c.children].forEach(li => paragraphes.push({ n: li, puce: c.tagName === 'UL' ? true : { type: 'number' }, niveau: (c.closest('li') ? 1 : 0) })); continue; }
      if (c.nodeType === 1 && /^(P|DIV|H[1-6]|BLOCKQUOTE)$/.test(c.tagName)) { paragraphes.push({ n: c }); continue; }
      if (c.nodeType === 3 && !c.nodeValue.trim()) continue;
      paragraphes.push({ n: c, enLigne: true });
    }
  };
  blocs(d);
  if (!paragraphes.length) paragraphes.push({ n: document.createTextNode('') });
  paragraphes.forEach((p, i) => {
    const debut = out.length;
    const parcourir = (n, st) => {
      if (n.nodeType === 3) { if (n.nodeValue) out.push({ text: n.nodeValue.replace(/ /g, ' '), options: { ...st } }); return; }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'BR') { out.push({ text: '', options: { ...st, breakLine: true } }); return; }
      if (n.tagName === 'UL' || n.tagName === 'OL') return;
      const s = { ...st }; const t = n.tagName, cs = n.style;
      if (t === 'B' || t === 'STRONG' || cs?.fontWeight === 'bold' || +cs?.fontWeight >= 600) s.bold = true;
      if (t === 'I' || t === 'EM' || cs?.fontStyle === 'italic') s.italic = true;
      if (t === 'U' || (cs?.textDecorationLine || cs?.textDecoration || '').includes('underline')) s.underline = { style: 'sng' };
      if (t === 'S' || t === 'STRIKE' || (cs?.textDecorationLine || '').includes('line-through')) s.strike = 'sngStrike';
      if (cs?.color) s.color = hex6(cs.color) || s.color;
      if (t === 'FONT' && n.getAttribute('color')) s.color = hex6(n.getAttribute('color')) || s.color;
      if (cs?.fontSize && /px/.test(cs.fontSize)) s.fontSize = parseFloat(cs.fontSize) * 0.75;
      if (cs?.fontFamily) s.fontFace = cs.fontFamily.split(',')[0].replace(/["']/g, '');
      if (t === 'A' && n.getAttribute('href')) s.hyperlink = { url: n.getAttribute('href') };
      for (const c of n.childNodes) parcourir(c, s);
    };
    const st = { ...base };
    if (p.puce) { st.bullet = p.puce === true ? true : p.puce; if (p.niveau) st.indentLevel = p.niveau; }
    const al = p.n.style?.textAlign; if (al) st.align = al === 'justify' ? 'justify' : al;
    parcourir(p.n, st);
    if (out.length === debut) out.push({ text: '', options: { ...st } });
    if (i < paragraphes.length - 1) out[out.length - 1].options.breakLine = true;
    if (p.puce) out.slice(debut).forEach(r => { r.options.bullet = st.bullet; if (st.indentLevel) r.options.indentLevel = st.indentLevel; });
  });
  return out;
}

export async function exporterPptx(pres, { medias, styleZone }) {
  const P = window.PptxGenJS; if (!P) throw new Error('module PowerPoint indisponible');
  const p = new P();
  const W = pres.format === '4:3' ? 960 : 1280, H = 720;
  p.defineLayout({ name: 'ATELIER', width: W / PX_IN, height: H / PX_IN }); p.layout = 'ATELIER';
  p.title = pres.titre || 'Présentation'; p.company = ''; p.author = pres.auteur || '';
  const th = themeDe(pres.theme);
  for (const d of pres.diapos) {
    const s = p.addSlide();
    if (d.masquee) s.hidden = true;
    const fond = d.fond || th.fond;
    if (fond && fond.startsWith('media:')) s.background = { data: medias[fond.slice(6)] };
    else s.background = { color: hex6(fond) || 'FFFFFF' };
    // décor du thème
    if (th.decor === 'bande') s.addShape(p.ShapeType.rect, { x: 0, y: (H - 10) / PX_IN, w: W / PX_IN, h: 10 / PX_IN, fill: { color: hex6(th.accents[0]) }, line: { color: hex6(th.accents[0]), width: 0 } });
    if (th.decor === 'bande-gauche') s.addShape(p.ShapeType.rect, { x: 0, y: 0, w: 14 / PX_IN, h: H / PX_IN, fill: { color: hex6(th.accents[0]) }, line: { color: hex6(th.accents[0]), width: 0 } });
    if (th.decor === 'filet') s.addShape(p.ShapeType.rect, { x: 70 / PX_IN, y: (H - 40) / PX_IN, w: 60 / PX_IN, h: 4 / PX_IN, fill: { color: hex6(th.accents[1]) }, line: { color: hex6(th.accents[1]), width: 0 } });
    if (th.decor === 'coin') s.addShape(p.ShapeType.rtTriangle, { x: (W - 90) / PX_IN, y: (H - 90) / PX_IN, w: 90 / PX_IN, h: 90 / PX_IN, fill: { color: hex6(th.accents[0]) }, line: { color: hex6(th.accents[0]), width: 0 }, flipH: true });
    for (const e of d.elements) {
      const pos = { x: e.x / PX_IN, y: e.y / PX_IN, w: Math.max(1, e.l) / PX_IN, h: Math.max(1, e.h) / PX_IN, rotate: e.rotation || 0 };
      const st = styleZone(e);
      const base = { fontFace: st.police, fontSize: Math.round(st.taille * 0.75 * 10) / 10, color: hex6(st.couleur) || '000000', bold: !!st.gras, italic: !!st.italique };
      const optsTexte = { ...pos, align: st.align || 'left', valign: st.valign === 'middle' ? 'middle' : st.valign === 'bottom' ? 'bottom' : 'top', margin: 6, fit: 'none' };
      if (e.type === 'image') { const src = e.src?.startsWith('media:') ? medias[e.src.slice(6)] : e.src; if (src) s.addImage({ data: src, ...pos, altText: e.alt || '' }); continue; }
      if (e.type === 'tableau') {
        const rows = e.cellules.map((l, i) => l.map(c => ({ text: runs(c, { ...base, fontSize: Math.round((e.taille || 18) * 0.75), bold: i === 0 && e.entete !== false }), options: { fill: { color: i === 0 && e.entete !== false ? hex6(th.accents[0]) : 'FFFFFF' }, color: i === 0 && e.entete !== false ? 'FFFFFF' : '1E1E1E' } })));
        s.addTable(rows, { ...pos, border: { type: 'solid', pt: 0.75, color: '8C8C8C' }, colW: Array(e.cellules[0].length).fill(pos.w / e.cellules[0].length), fontFace: st.police });
        continue;
      }
      if (e.type === 'forme') {
        const forme = FORMES_PPTX[e.forme] || 'rect';
        const o = { ...pos, fill: e.remplissage && e.remplissage !== 'transparent' ? { color: hex6(e.remplissage) } : { type: 'none' }, line: e.contour && e.contour !== 'transparent' ? { color: hex6(e.contour), width: (e.epaisseur || 2) * 0.75 } : { type: 'none' } };
        if (e.forme === 'fleche') o.line = { ...(o.line.type ? { color: '000000', width: 2 } : o.line), endArrowType: 'triangle' };
        if (e.html && e.html.replace(/<[^>]+>/g, '').trim()) s.addText(runs(e.html, base), { ...optsTexte, shape: p.ShapeType[forme] || forme, fill: o.fill, line: o.line });
        else s.addShape(p.ShapeType[forme] || forme, o);
        continue;
      }
      // zone de texte
      if (e.html && e.html.replace(/<[^>]+>/g, '').trim()) s.addText(runs(e.html, base), { ...optsTexte, fill: e.remplissage && e.remplissage !== 'transparent' ? { color: hex6(e.remplissage) } : undefined });
    }
    if (d.notes) s.addNotes(d.notes);
  }
  const octets = await p.write({ outputType: 'uint8array' });
  // copie fidèle pour Diapo
  const z = unzipSync(new Uint8Array(octets));
  const { titre: _t, auteur: _a, ...propre } = pres; z['atelier/presentation.json'] = strToU8(JSON.stringify({ pres: propre, medias, empreinte: await empreinte(z) }));
  z['[Content_Types].xml'] = strToU8(strFromU8(z['[Content_Types].xml']).replace('<Default Extension="xml"', '<Default Extension="json" ContentType="application/json"/><Default Extension="xml"'));
  return zipSync(z, { level: 6 });
}

// Empreinte des diapositives : si le fichier est modifié par un autre logiciel, la copie interne est ignorée
async function empreinte(z) {
  const noms = Object.keys(z).filter(n => /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(n)).sort();
  const parts = noms.map(n => z[n]); const total = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; parts.forEach(p => { total.set(p, o); o += p.length; });
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', total));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Import ----------
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main', NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main', NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const enfants = (n, ns, nom) => n ? [...n.children].filter(c => c.localName === nom && (!ns || c.namespaceURI === ns)) : [];
const enfant = (n, ns, nom) => enfants(n, ns, nom)[0];
const desc = (n, nom) => n ? [...n.getElementsByTagNameNS('*', nom)] : [];
const desc1 = (n, nom) => desc(n, nom)[0];

export async function importerPptx(octets) {
  const z = unzipSync(octets);
  if (z['atelier/presentation.json']) { try { const o = JSON.parse(strFromU8(z['atelier/presentation.json'])); if (o.empreinte && o.empreinte === await empreinte(z)) return o; } catch { } }
  const xml = p => z[p] ? new DOMParser().parseFromString(strFromU8(z[p]), 'application/xml') : null;
  const rels = p => { const r = xml(p.replace(/([^/]+)$/, '_rels/$1.rels')); const m = {}; if (r) desc(r, 'Relationship').forEach(x => m[x.getAttribute('Id')] = { cible: x.getAttribute('Target'), type: x.getAttribute('Type') }); return m; };
  const resoudre = (base, cible) => { if (cible.startsWith('/')) return cible.slice(1); const parts = base.split('/').slice(0, -1); for (const s of cible.split('/')) { if (s === '..') parts.pop(); else if (s !== '.') parts.push(s); } return parts.join('/'); };
  const presXml = xml('ppt/presentation.xml'); if (!presXml) throw new Error('présentation PowerPoint invalide');
  const sz = desc1(presXml, 'sldSz'); const cx = +(sz?.getAttribute('cx') || 12192000), cy = +(sz?.getAttribute('cy') || 6858000);
  const format = Math.abs(cx / cy - 4 / 3) < 0.05 ? '4:3' : '16:9';
  const W = format === '4:3' ? 960 : 1280, H = 720;
  const kx = W / cx, ky = H / cy;
  const prels = rels('ppt/presentation.xml');
  // couleurs du thème
  const couleursTheme = {};
  const themeRel = Object.values(prels).find(r => /theme$/.test(r.type));
  const thx = themeRel ? xml(resoudre('ppt/presentation.xml', themeRel.cible)) : null;
  if (thx) { const cs = desc1(thx, 'clrScheme'); if (cs) [...cs.children].forEach(c => { const v = desc1(c, 'srgbClr')?.getAttribute('val') || desc1(c, 'sysClr')?.getAttribute('lastClr'); if (v) couleursTheme[c.localName] = '#' + v; }); }
  couleursTheme.tx1 = couleursTheme.dk1; couleursTheme.bg1 = couleursTheme.lt1; couleursTheme.tx2 = couleursTheme.dk2; couleursTheme.bg2 = couleursTheme.lt2;
  const couleur = n => { if (!n) return null; const s = desc1(n, 'srgbClr'); if (s) return '#' + s.getAttribute('val'); const sc = desc1(n, 'schemeClr'); if (sc) return couleursTheme[sc.getAttribute('val')] || null; return null; };
  const medias = {}; let nMedia = 0;
  const media = chemin => { const o = z[chemin]; if (!o) return null; const ext = chemin.split('.').pop().toLowerCase(); const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' }[ext]; if (!type) return null; let b = ''; for (let i = 0; i < o.length; i += 0x8000) b += String.fromCharCode.apply(null, o.subarray(i, i + 0x8000)); const id = 'm' + (++nMedia); medias[id] = `data:${type};base64,${btoa(b)}`; return 'media:' + id; };
  const xfrm = sp => { const x = desc1(enfant(sp, NS_P, 'spPr') || enfant(sp, NS_P, 'grpSpPr') || sp, 'xfrm') || enfant(sp, NS_P, 'xfrm'); if (!x) return null; const o = desc1(x, 'off'), e = desc1(x, 'ext'); if (!o || !e) return null; return { x: +o.getAttribute('x') * kx, y: +o.getAttribute('y') * ky, l: +e.getAttribute('cx') * kx, h: +e.getAttribute('cy') * ky, rotation: +(x.getAttribute('rot') || 0) / 60000 }; };
  const phDe = sp => { const nv = desc1(sp, 'nvPr'); const ph = nv && enfant(nv, NS_P, 'ph'); return ph ? { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') } : null; };
  const trouverPh = (doc, ph) => { if (!doc) return null; const l = desc(doc, 'sp'); return l.find(s => { const p = phDe(s); return p && ((ph.idx && p.idx === ph.idx) || (!ph.idx && p.type === ph.type)); }) || l.find(s => { const p = phDe(s); return p && p.type === ph.type; }) || (ph.type === 'ctrTitle' ? l.find(s => phDe(s)?.type === 'title') : null) || (ph.type === 'subTitle' ? l.find(s => phDe(s)?.type === 'body') : null); };
  const tailleDefaut = (doc, ph) => { const s = trouverPh(doc, ph); const r = s && desc1(s, 'defRPr'); return r?.getAttribute('sz') ? +r.getAttribute('sz') / 100 : null; };
  const textes = (tx, tailleBase, puceDefaut = null) => {
    let html = ''; let liste = null; let premAlign = null, premTaille = null;
    for (const p of enfants(tx, NS_A, 'p')) {
      const ppr = enfant(p, NS_A, 'pPr'); const algn = ppr?.getAttribute('algn');
      const puce = ppr && enfant(ppr, NS_A, 'buNone') ? null : ppr && enfant(ppr, NS_A, 'buChar') ? 'ul' : ppr && enfant(ppr, NS_A, 'buAutoNum') ? 'ol' : puceDefaut;
      const align = { ctr: 'center', r: 'right', just: 'justify', l: 'left' }[algn] || '';
      if (premAlign == null) premAlign = align;
      let contenu = '';
      for (const r of p.children) {
        if (r.localName === 'br') { contenu += '<br>'; continue; }
        if (r.localName !== 'r' && r.localName !== 'fld') continue;
        const t = desc1(r, 't')?.textContent || ''; const rp = enfant(r, NS_A, 'rPr');
        const st = [];
        if (rp?.getAttribute('b') === '1') st.push('font-weight:bold'); if (rp?.getAttribute('i') === '1') st.push('font-style:italic');
        if (rp?.getAttribute('u') && rp.getAttribute('u') !== 'none') st.push('text-decoration:underline');
        if (rp?.getAttribute('sz')) { const px = +rp.getAttribute('sz') / 100 / 0.75; st.push(`font-size:${px.toFixed(1)}px`); if (premTaille == null) premTaille = px; }
        const c = couleur(rp && enfant(rp, NS_A, 'solidFill')); if (c) st.push('color:' + c);
        const f = rp && enfant(rp, NS_A, 'latin')?.getAttribute('typeface'); if (f && !f.startsWith('+')) st.push(`font-family:${f}`);
        const e = t.replace(/[&<>]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]));
        contenu += st.length ? `<span style="${st.join(';')}">${e}</span>` : e;
      }
      if (puce) { if (liste !== puce) { if (liste) html += `</${liste}>`; html += `<${puce}>`; liste = puce; } html += `<li>${contenu || '<br>'}</li>`; }
      else { if (liste) { html += `</${liste}>`; liste = null; } html += `<p${align && align !== premAlign ? ` style="text-align:${align}"` : ''}>${contenu || '<br>'}</p>`; }
    }
    if (liste) html += `</${liste}>`;
    return { html, align: premAlign || null, taille: premTaille || tailleBase };
  };
  const ids = desc(presXml, 'sldId').map(s => s.getAttributeNS(NS_R, 'id') || s.getAttribute('r:id'));
  const diapos = [];
  let uid = 0;
  for (const id of ids) {
    const chemin = resoudre('ppt/presentation.xml', prels[id].cible);
    const sx = xml(chemin); if (!sx) continue;
    const srels = rels(chemin);
    const layRel = Object.values(srels).find(r => /slideLayout$/.test(r.type));
    const layChemin = layRel ? resoudre(chemin, layRel.cible) : null; const lay = layChemin ? xml(layChemin) : null;
    const masRel = layChemin ? Object.values(rels(layChemin)).find(r => /slideMaster$/.test(r.type)) : null;
    const mas = masRel ? xml(resoudre(layChemin, masRel.cible)) : null;
    const d = { id: 'd' + (++uid), disposition: 'vide', elements: [], notes: '', transition: 'aucune' };
    const bg = desc1(sx, 'bg') || desc1(lay, 'bg') || desc1(mas, 'bg');
    const cbg = bg && couleur(desc1(bg, 'solidFill')); if (cbg) d.fond = cbg;
    const blipBg = bg && desc1(bg, 'blip'); if (blipBg) { const r = srels[blipBg.getAttributeNS(NS_R, 'embed')]; if (r) d.fond = media(resoudre(chemin, r.cible)) || d.fond; }
    const arbre = desc1(sx, 'spTree');
    const traiter = (n) => {
      for (const sp of n.children) {
        if (sp.localName === 'grpSp') { traiter(sp); continue; }
        if (sp.localName === 'sp') {
          const ph = phDe(sp);
          let pos = xfrm(sp);
          if (!pos && ph) pos = xfrm(trouverPh(lay, ph) || {}) || xfrm(trouverPh(mas, ph) || {});
          if (!pos) continue;
          const tx = desc1(sp, 'txBody');
          const tailleBase = ph ? (tailleDefaut(lay, ph) || tailleDefaut(mas, ph) || (ph.type === 'title' || ph.type === 'ctrTitle' ? 44 : 24)) / 0.75 : 18 / 0.75;
          // les zones de contenu héritent des puces du masque (comportement PowerPoint)
          const puceMasque = ph && !['title', 'ctrTitle', 'subTitle', 'dt', 'ftr', 'sldNum'].includes(ph.type) ? (() => { const bs = mas && desc1(mas, 'bodyStyle'); const l1 = bs && enfant(bs, NS_A, 'lvl1pPr'); const lsp = trouverPh(lay, ph); const lp = lsp && desc1(lsp, 'lvl1pPr'); if (lp && enfant(lp, NS_A, 'buNone')) return null; if (!l1) return 'ul'; return enfant(l1, NS_A, 'buNone') ? null : enfant(l1, NS_A, 'buAutoNum') ? 'ol' : 'ul'; })() : null;
          const t = tx ? textes(tx, tailleBase, puceMasque) : { html: '' };
          const geom = desc1(sp, 'prstGeom')?.getAttribute('prst');
          const spPr = enfant(sp, NS_P, 'spPr');
          const fill = spPr && couleur(enfant(spPr, NS_A, 'solidFill')); const ln = spPr && enfant(spPr, NS_A, 'ln'); const cl = ln && couleur(enfant(ln, NS_A, 'solidFill'));
          const bodyPr = tx && enfant(tx, NS_A, 'bodyPr'); const anchor = bodyPr?.getAttribute('anchor');
          const role = ph ? ({ title: 'titre', ctrTitle: 'titre', subTitle: 'sous-titre' }[ph.type] || 'corps') : null;
          const inverse = { roundRect: 'rect-arrondi', ellipse: 'ellipse', triangle: 'triangle', diamond: 'losange', rightArrow: 'fleche-droite', leftArrow: 'fleche-gauche', chevron: 'chevron', star5: 'etoile', wedgeRectCallout: 'bulle', line: 'ligne', rect: 'rect' };
          const estForme = !ph && geom && (fill || cl || geom !== 'rect');
          const e = { id: 'e' + (++uid), type: estForme ? 'forme' : 'texte', ...pos, html: t.html, style: { taille: Math.round(t.taille || tailleBase), align: t.align || (role === 'titre' && ph?.type === 'ctrTitle' ? 'center' : null), valign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : null } };
          if (role) e.role = role;
          if (estForme) { e.forme = inverse[geom] || 'rect'; e.remplissage = fill || 'transparent'; e.contour = cl || 'transparent'; e.epaisseur = ln?.getAttribute('w') ? Math.max(1, +ln.getAttribute('w') / 9525) : 2; e.style.align = e.style.align || 'center'; e.style.valign = e.style.valign || 'middle'; }
          else if (fill) e.remplissage = fill;
          if (!e.html.replace(/<[^>]+>/g, '').trim() && !estForme) continue;
          d.elements.push(e); continue;
        }
        if (sp.localName === 'pic') {
          const pos = xfrm(sp); const b = desc1(sp, 'blip'); if (!pos || !b) continue;
          const r = srels[b.getAttributeNS(NS_R, 'embed')]; const src = r ? media(resoudre(chemin, r.cible)) : null; if (!src) continue;
          d.elements.push({ id: 'e' + (++uid), type: 'image', ...pos, src, alt: desc1(sp, 'cNvPr')?.getAttribute('descr') || '' }); continue;
        }
        if (sp.localName === 'graphicFrame') {
          const tbl = desc1(sp, 'tbl'); const x = enfant(sp, NS_P, 'xfrm'); if (!tbl || !x) continue;
          const o = desc1(x, 'off'), ex = desc1(x, 'ext');
          const cellules = desc(tbl, 'tr').map(tr => enfants(tr, NS_A, 'tc').map(tc => { const tb = desc1(tc, 'txBody'); return tb ? textes(tb, 18 / 0.75).html.replace(/^<p>|<\/p>$/g, '') : ''; }));
          if (cellules.length) d.elements.push({ id: 'e' + (++uid), type: 'tableau', x: +o.getAttribute('x') * kx, y: +o.getAttribute('y') * ky, l: +ex.getAttribute('cx') * kx, h: +ex.getAttribute('cy') * ky, cellules, taille: 18, entete: true, style: {} });
        }
      }
    };
    if (arbre) traiter(arbre);
    // notes
    const nRel = Object.values(srels).find(r => /notesSlide$/.test(r.type));
    if (nRel) { const nx = xml(resoudre(chemin, nRel.cible)); if (nx) { const corps = desc(nx, 'sp').find(s => phDe(s)?.type === 'body'); if (corps) d.notes = desc(corps, 'p').map(p => desc(p, 't').map(t => t.textContent).join('')).join('\n').trim(); } }
    if (/show="0"/.test(strFromU8(z[chemin]).slice(0, 400))) d.masquee = true;
    diapos.push(d);
  }
  return { pres: { format, theme: 'atelier', diapos: diapos.length ? diapos : [{ id: 'd1', disposition: 'vide', elements: [], notes: '' }], importe: true }, medias };
}

// Rendu SVG autonome d'une forme (utilisé par l'éditeur)
export { cheminForme };
