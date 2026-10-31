// Calcul — formats de nombres (codes Excel, affichage à la française) et analyse de la saisie
import { Erreur, dateDepuisSerie, serieDate, texteNombre } from './formules.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_C = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const JOURS_C = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const ESP = '\u00a0';
const COULEURS = { red: '#C00000', rouge: '#C00000', blue: '#0000FF', bleu: '#0000FF', green: '#008000', vert: '#008000', black: '#000000', noir: '#000000', magenta: '#FF00FF', cyan: '#00B0F0', yellow: '#B8A000', jaune: '#B8A000', white: '#FFFFFF', blanc: '#FFFFFF' };

export const FORMATS = [
  { id: 'General', nom: 'Standard', ex: '1234,5' },
  { id: '0', nom: 'Nombre entier', ex: '1235' },
  { id: '#,##0.00', nom: 'Nombre', ex: '1 234,50' },
  { id: '#,##0.00 "€"', nom: 'Monétaire', ex: '1 234,50 €' },
  { id: '_-* #,##0.00 "€"_-;-* #,##0.00 "€"_-;_-* "-"?? "€"_-;_-@_-', nom: 'Comptabilité', ex: ' 1 234,50 € ' },
  { id: 'dd/mm/yyyy', nom: 'Date courte', ex: '27/10/2026' },
  { id: 'dddd d mmmm yyyy', nom: 'Date longue', ex: 'mardi 27 octobre 2026' },
  { id: 'hh:mm', nom: 'Heure', ex: '14:30' },
  { id: '0%', nom: 'Pourcentage', ex: '12 %' },
  { id: '0.00%', nom: 'Pourcentage (2 décimales)', ex: '12,35 %' },
  { id: '# ?/?', nom: 'Fraction', ex: '1 1/4' },
  { id: '0.00E+00', nom: 'Scientifique', ex: '1,23E+03' },
  { id: '@', nom: 'Texte', ex: 'texte' },
];

const cache = new Map();
function sections(code) {
  if (cache.has(code)) return cache.get(code);
  const s = []; let cur = '', q = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"') q = !q;
    if (c === '\\' && !q) { cur += c + (code[i + 1] || ''); i++; continue; }
    if (c === ';' && !q) { s.push(cur); cur = ''; continue; }
    cur += c;
  }
  s.push(cur);
  cache.set(code, s); return s;
}
const estDate = s => /(^|[^"\\])([dmyhsDMYHS]|AM\/PM)/.test(s.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, ''));

export function formaterValeur(v, code = 'General', largeurCar = 11) {
  if (v instanceof Erreur) return { texte: v.code, erreur: true };
  if (v == null) return { texte: '' };
  if (typeof v === 'boolean') return { texte: v ? 'VRAI' : 'FAUX', centre: true };
  if (typeof v === 'string') {
    const ss = sections(code || 'General');
    if (ss.length >= 4 && ss[3].includes('@')) return { texte: litteraux(ss[3]).replace('@', v) };
    return { texte: v };
  }
  if (!code || code === 'General' || code === 'Standard') return { texte: general(v, largeurCar), nombre: true };
  if (code === '@') return { texte: texteNombre(v), nombre: true };
  const ss = sections(code);
  let s = ss[0], val = v;
  if (ss.length > 1) {
    if (v < 0) { s = ss[1]; val = -v; if (!s.trim()) s = ss[0]; }
    else if (v === 0 && ss.length > 2) s = ss[2];
  }
  let couleur = null;
  s = s.replace(/\[([^\]]+)\]/g, (m, c) => { const k = c.toLowerCase(); if (COULEURS[k]) { couleur = COULEURS[k]; return ''; } if (/^\$/.test(c)) { const m2 = /^\$([^-\]]*)/.exec(c); return m2 && m2[1] ? `"${m2[1]}"` : ''; } if (/^h+$|^m+$|^s+$/i.test(c)) return m; return ''; });
  let texte;
  if (estDate(s)) texte = formaterDate(val, s);
  else texte = formaterNombre(val, s, v < 0 && ss.length === 1);
  return { texte, couleur, nombre: true };
}

function general(v, w) {
  let t = texteNombre(v);
  if (t.length > w && Math.abs(v) >= 1e-4 && Math.abs(v) < 1e11) {
    const ent = String(Math.trunc(Math.abs(v))).length + (v < 0 ? 1 : 0);
    const d = Math.max(0, w - ent - 1);
    t = texteNombre(parseFloat(v.toFixed(d)));
  }
  return t;
}

function litteraux(s) {
  return s.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1').replace(/_./g, ' ').replace(/\*./g, '');
}

function formaterNombre(v, s, negatifSansSection) {
  let pct = 0;
  // pourcentages
  const nu = s.replace(/"[^"]*"/g, '').replace(/\\./g, '');
  pct = (nu.match(/%/g) || []).length;
  for (let i = 0; i < pct; i++) v *= 100;
  // scientifique
  const sci = /([0#?.,]+)E([+-])([0#]+)/i.exec(s);
  if (sci) {
    const dec = (sci[1].split('.')[1] || '').length;
    let [m, e] = v.toExponential(dec).split('e');
    const en = parseInt(e, 10);
    const t = m.replace('.', ',') + 'E' + (en < 0 ? '-' : (sci[2] === '+' ? '+' : '')) + String(Math.abs(en)).padStart(sci[3].length, '0');
    return (negatifSansSection && !t.startsWith('-') ? '' : '') + s.slice(0, sci.index).replace(/"([^"]*)"/g, '$1') + t + litteraux(s.slice(sci.index + sci[0].length));
  }
  // fractions
  const fr = /(#*\s*)\?+\/(\?+|\d+)/.exec(s);
  if (fr) {
    const ent = Math.trunc(v), f = Math.abs(v - ent);
    let best = [0, 1], err = 1; const maxD = /^\d+$/.test(fr[2]) ? +fr[2] : Math.pow(10, fr[2].length) - 1;
    if (/^\d+$/.test(fr[2])) best = [Math.round(f * maxD), maxD];
    else for (let d = 1; d <= maxD; d++) { const n = Math.round(f * d); const e = Math.abs(f - n / d); if (e < err - 1e-12) { err = e; best = [n, d]; } }
    const t = best[0] === 0 ? String(ent) : (ent ? ent + ' ' : (v < 0 ? '-' : '')) + best[0] + '/' + best[1];
    return t;
  }
  // partie numérique : premier bloc de 0 # ? , .
  const m = /[0#?][0#?,. ]*[0#?],*|[0#?],*/.exec(s.replace(/"[^"]*"/g, x => '\u0001'.repeat(x.length)).replace(/\\./g, '\u0001\u0001'));
  if (!m) return litteraux(s);
  const motif = s.substr(m.index, m[0].length);
  const [pe, pd = ''] = motif.split('.');
  const milliers = pe.includes(',') || / /.test(pe.trim());
  const nbDec = (pd.match(/[0#?]/g) || []).length, decObl = (pd.match(/0/g) || []).length;
  // virgules finales : division par 1000
  let echelle = 0; const fin = /,+$/.exec(pe); if (fin) echelle = fin[0].length;
  v = v / Math.pow(1000, echelle);
  let [ie, de = ''] = Math.abs(v).toFixed(nbDec).split('.');
  if (nbDec > decObl) de = de.replace(new RegExp(`0{0,${nbDec - decObl}}$`), '');
  const entObl = (pe.replace(/,/g, '').match(/0/g) || []).length;
  if (ie === '0' && entObl === 0) ie = '';
  ie = ie.padStart(entObl, '0');
  if (milliers) ie = ie.replace(/\B(?=(\d{3})+(?!\d))/g, ESP);
  let t = ie + (de || (pd && decObl) ? ',' + de : (pd && pd.includes('?') ? ',' : ''));
  if (v < 0 && negatifSansSection && parseFloat(Math.abs(v).toFixed(nbDec)) !== 0) t = '-' + t;
  return litteraux(s.slice(0, m.index)) + t + litteraux(s.slice(m.index + m[0].length));
}

function formaterDate(v, s) {
  if (v < 0) return '#'.repeat(8);
  const d = dateDepuisSerie(v);
  const ampm = /AM\/PM|A\/P/i.test(s);
  let out = '', i = 0;
  const lit = s.replace(/\\(.)/g, '"$1"');
  const toks = [];
  while (i < lit.length) {
    const c = lit[i];
    if (c === '"') { const j = lit.indexOf('"', i + 1); toks.push({ l: lit.slice(i + 1, j < 0 ? undefined : j) }); i = j < 0 ? lit.length : j + 1; continue; }
    if (/AM\/PM/i.test(lit.slice(i, i + 5))) { toks.push({ k: 'ampm' }); i += 5; continue; }
    const m = /^(\[h+\]|\[m+\]|\[s+\]|d+|j+|m+|y+|a+|h+|s+|0+)/i.exec(lit.slice(i));
    if (m) { toks.push({ k: m[0].toLowerCase() }); i += m[0].length; continue; }
    if (c === '_' || c === '*') { i += 2; continue; }
    toks.push({ l: c }); i++;
  }
  // « m » après h ou avant s = minutes
  toks.forEach((t, k) => {
    if (t.k && /^m{1,2}$/.test(t.k)) {
      const prev = toks.slice(0, k).reverse().find(x => x.k); const next = toks.slice(k + 1).find(x => x.k);
      if ((prev && /h/.test(prev.k)) || (next && /^s/.test(next.k))) t.k = 'min' + t.k.length;
    }
  });
  const sec = Math.round((v % 1) * 86400);
  for (const t of toks) {
    if (t.l !== undefined) { out += t.l; continue; }
    switch (t.k) {
      case 'd': case 'j': out += d.j; break;
      case 'dd': case 'jj': out += String(d.j).padStart(2, '0'); break;
      case 'ddd': case 'jjj': out += JOURS_C[d.js]; break;
      case 'dddd': case 'jjjj': out += JOURS[d.js]; break;
      case 'm': out += d.m; break;
      case 'mm': out += String(d.m).padStart(2, '0'); break;
      case 'mmm': out += MOIS_C[d.m - 1]; break;
      case 'mmmm': out += MOIS[d.m - 1]; break;
      case 'mmmmm': out += MOIS[d.m - 1][0].toUpperCase(); break;
      case 'yy': case 'aa': out += String(d.a).slice(-2); break;
      case 'yyyy': case 'aaaa': case 'y': case 'yyy': out += d.a; break;
      case 'h': out += ampm ? ((d.h % 12) || 12) : d.h; break;
      case 'hh': out += String(ampm ? ((d.h % 12) || 12) : d.h).padStart(2, '0'); break;
      case 'min1': out += d.mi; break;
      case 'min2': out += String(d.mi).padStart(2, '0'); break;
      case 's': out += d.s; break;
      case 'ss': out += String(d.s).padStart(2, '0'); break;
      case '[h]': case '[hh]': out += Math.floor(v * 24); break;
      case '[m]': case '[mm]': out += Math.floor(v * 1440); break;
      case '[s]': case '[ss]': out += Math.floor(v * 86400); break;
      case 'ampm': out += d.h < 12 ? 'AM' : 'PM'; break;
      default: if (/^0+$/.test(t.k)) out += String(Math.round((v * 86400 % 1) * Math.pow(10, t.k.length))).padStart(t.k.length, '0'); else out += t.k;
    }
  }
  void sec;
  return out;
}

/** Interprète une saisie au clavier (à la française). Renvoie {formule} ou {valeur, format}. */
export function analyserSaisie(t) {
  if (t == null) return { valeur: null };
  const s = String(t);
  if (s === '') return { valeur: null };
  if (s.startsWith('=') && s.length > 1) return { formule: s };
  if (s.startsWith("'")) return { valeur: s.slice(1), texteForce: true };
  const brut = s.trim();
  if (/^(VRAI|FAUX)$/i.test(brut)) return { valeur: /^VRAI$/i.test(brut) };
  const sansEsp = brut.replace(/[\u00a0\u202f ]/g, '');
  let m;
  if ((m = /^([+-]?\d+(?:,\d+)?)%$/.exec(sansEsp))) { const n = parseFloat(m[1].replace(',', '.')) / 100; const dec = (m[1].split(',')[1] || '').length; return { valeur: n, format: dec ? '0.' + '0'.repeat(dec) + '%' : '0%' }; }
  if ((m = /^([+-]?\d+(?:,\d+)?)€$/.exec(sansEsp)) || (m = /^€([+-]?\d+(?:,\d+)?)$/.exec(sansEsp))) return { valeur: parseFloat(m[1].replace(',', '.')), format: '#,##0.00 "€"' };
  if (/^[+-]?\d{1,3}( \d{3})+(,\d+)?$/.test(brut.replace(/[\u00a0\u202f]/g, ' '))) { const n = parseFloat(sansEsp.replace(',', '.')); return { valeur: n, format: brut.includes(',') ? '#,##0.' + '0'.repeat(brut.split(',')[1].length) : '#,##0' }; }
  if (/^[+-]?(\d+(,\d*)?|,\d+)([eE][+-]?\d+)?$/.test(sansEsp)) return { valeur: parseFloat(sansEsp.replace(',', '.')) };
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(brut))) { let a = +m[3]; if (a < 100) a += a < 30 ? 2000 : 1900; if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return { valeur: serieDate(a, +m[2], +m[1]), format: 'dd/mm/yyyy' }; }
  if ((m = /^(\d{1,2})\/(\d{1,2})$/.exec(brut))) { if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return { valeur: serieDate(new Date().getFullYear(), +m[2], +m[1]), format: 'dd/mm/yyyy' }; }
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(brut))) return { valeur: serieDate(+m[3], +m[2], +m[1]) + (+m[4] * 60 + +m[5]) / 1440, format: 'dd/mm/yyyy hh:mm' };
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(brut))) return { valeur: serieDate(+m[1], +m[2], +m[3]), format: 'dd/mm/yyyy' };
  if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(brut)) && +m[2] < 60) return { valeur: (+m[1] * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400, format: m[3] ? 'hh:mm:ss' : 'hh:mm' };
  if ((m = /^(\d{1,2})\s+(janv\.?|janvier|févr\.?|février|mars|avr\.?|avril|mai|juin|juil\.?|juillet|août|sept\.?|septembre|oct\.?|octobre|nov\.?|novembre|déc\.?|décembre)\s+(\d{4})$/i.exec(brut))) { const k = MOIS.findIndex(x => x.startsWith(m[2].toLowerCase().replace('.', '').slice(0, 3))); if (k >= 0) return { valeur: serieDate(+m[3], k + 1, +m[1]), format: 'd mmmm yyyy' }; }
  return { valeur: s };
}

/** Texte affiché dans la barre de formule pour une valeur (dates lisibles, nombres à la française). */
export function texteEdition(v, code) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'VRAI' : 'FAUX';
  if (typeof v === 'number') {
    if (code && estDate(sections(code)[0]) && v >= 0) {
      const d = dateDepuisSerie(v);
      const date = `${String(d.j).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.a}`;
      const h = `${String(d.h).padStart(2, '0')}:${String(d.mi).padStart(2, '0')}${d.s ? ':' + String(d.s).padStart(2, '0') : ''}`;
      if (v < 1) return h; return v % 1 ? date + ' ' + h : date;
    }
    if (code && /%/.test(code)) return texteNombre(+(v * 100).toPrecision(15)) + '%';
    return texteNombre(v);
  }
  return String(v);
}
export { estDate as estFormatDate };
export function changerDecimales(code, delta) {
  if (!code || code === 'General') return delta > 0 ? '0.0' : '0';
  const ss = sections(code).map(s => {
    if (estDate(s)) return s;
    return s.replace(/([#0,]*0)(\.([0#]*))?/, (m, ent, p, dec = '') => {
      const n = Math.max(0, dec.length + delta);
      return ent + (n ? '.' + '0'.repeat(n) : '');
    });
  });
  return ss.join(';');
}
