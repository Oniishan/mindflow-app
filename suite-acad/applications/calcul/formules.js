// Calcul — moteur de formules (syntaxe française d'Excel : fonctions en français, « ; » entre les arguments, virgule décimale)

// ---------- Erreurs ----------
export class Erreur { constructor(code) { this.code = code; } toString() { return this.code; } }
export const ERR = {
  DIV0: new Erreur('#DIV/0!'), NA: new Erreur('#N/A'), NOM: new Erreur('#NOM?'), VAL: new Erreur('#VALEUR!'),
  REF: new Erreur('#REF!'), NUM: new Erreur('#NOMBRE!'), NUL: new Erreur('#NUL!'), CIRC: new Erreur('#CIRC!'),
};
const ERR_EN = { '#DIV/0!': '#DIV/0!', '#N/A': '#N/A', '#NOM?': '#NAME?', '#VALEUR!': '#VALUE!', '#REF!': '#REF!', '#NOMBRE!': '#NUM!', '#NUL!': '#NULL!', '#CIRC!': '#REF!' };
const ERR_FR = Object.fromEntries(Object.entries(ERR_EN).filter(([k]) => k !== '#CIRC!').map(([a, b]) => [b, a]));
export const estErreur = v => v instanceof Erreur;
const erreurDe = code => Object.values(ERR).find(e => e.code === code) || new Erreur(code);

// ---------- Adresses ----------
export function colLettre(c) { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
export function lettreCol(s) { let c = 0; for (const ch of s.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; }
export function adresse(r, c, absR = false, absC = false) { return (absC ? '$' : '') + colLettre(c) + (absR ? '$' : '') + (r + 1); }
export function lireAdresse(a) { const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a.trim()); return m ? { r: +m[2] - 1, c: lettreCol(m[1]) } : null; }
export function lirePlage(t) {
  const p = t.trim().split(':');
  const a = lireAdresse(p[0]); if (!a) return null;
  const b = p[1] ? lireAdresse(p[1]) : a; if (!b) return null;
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}
export const MAX_LIGNES = 1048576, MAX_COLS = 16384;

// ---------- Analyse lexicale ----------
const RE_REF = /^(?:(?:'((?:[^']|'')+)'|([A-Za-zÀ-ÿ_][\wÀ-ÿ.]*))!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)(?![\w(])/;
export function decouper(f, { anglais = false } = {}) {
  const t = []; let i = 0, accolades = 0;
  const sepArg = anglais ? ',' : ';', dec = anglais ? '.' : ',';
  while (i < f.length) {
    const ch = f[i];
    if (/\s/.test(ch)) { let j = i; while (j < f.length && /\s/.test(f[j])) j++; t.push({ type: 'esp', v: f.slice(i, j), p: i }); i = j; continue; }
    if (ch === '"') { let j = i + 1, s = ''; while (j < f.length) { if (f[j] === '"') { if (f[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += f[j++]; } t.push({ type: 'str', v: s, brut: f.slice(i, j + 1), p: i }); i = j + 1; continue; }
    if (ch === '#') { const m = /^#(DIV\/0!|N\/A|NOM\?|VALEUR!|REF!|NOMBRE!|NUL!|NAME\?|VALUE!|NUM!|NULL!|CIRC!)/i.exec(f.slice(i)); if (m) { t.push({ type: 'err', v: m[0].toUpperCase(), p: i }); i += m[0].length; continue; } }
    const reste = f.slice(i);
    // nombre
    const nre = anglais ? /^(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/ : /^(\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?/;
    const prec = t.filter(x => x.type !== 'esp').pop();
    const mr = RE_REF.exec(reste);
    if (mr && !(prec && prec.type === 'num')) {
      // éviter de confondre un nom de fonction (ex. LOG10() avec une référence
      t.push({ type: 'ref', v: mr[0], feuille: mr[1] ? mr[1].replace(/''/g, "'") : mr[2] || null, cible: mr[3], p: i }); i += mr[0].length; continue;
    }
    const mn = nre.exec(reste);
    if (mn && !/^[A-Za-z]/.test(reste)) { t.push({ type: 'num', v: parseFloat(mn[0].replace(',', '.')), brut: mn[0], p: i }); i += mn[0].length; continue; }
    const mf = /^([A-Za-zÀ-ÿ_][\wÀ-ÿ.]*)\s*\(/.exec(reste);
    if (mf) { t.push({ type: 'fn', v: mf[1], p: i }); i += mf[1].length; continue; }
    const mb = /^(VRAI|FAUX|TRUE|FALSE)(?![\wÀ-ÿ.(])/i.exec(reste);
    if (mb) { t.push({ type: 'bool', v: /^(VRAI|TRUE)$/i.test(mb[1]), brut: mb[1], p: i }); i += mb[1].length; continue; }
    const mnom = /^[A-Za-zÀ-ÿ_][\wÀ-ÿ.]*/.exec(reste);
    if (mnom) { t.push({ type: 'nom', v: mnom[0], p: i }); i += mnom[0].length; continue; }
    const op2 = reste.slice(0, 2);
    if (op2 === '<=' || op2 === '>=' || op2 === '<>') { t.push({ type: 'op', v: op2, p: i }); i += 2; continue; }
    if ('+-*/^&=<>%'.includes(ch)) { t.push({ type: 'op', v: ch, p: i }); i++; continue; }
    if (ch === '(' || ch === ')') { t.push({ type: ch, v: ch, p: i }); i++; continue; }
    if (ch === '{' || ch === '}') { accolades += ch === '{' ? 1 : -1; t.push({ type: ch, v: ch, p: i }); i++; continue; }
    // constantes matricielles : colonnes « . » et lignes « ; » en français, « , » et « ; » en anglais
    if (accolades > 0) {
      if (ch === (anglais ? ',' : '.')) { t.push({ type: 'colm', v: ch, p: i }); i++; continue; }
      if (ch === ';') { t.push({ type: 'lignem', v: ch, p: i }); i++; continue; }
    }
    if (ch === sepArg) { t.push({ type: 'sep', v: ch, p: i }); i++; continue; }
    throw new Erreur('#NOM?');
  }
  return t;
}

// ---------- Analyse syntaxique ----------
function analyser(tokens) {
  const t = tokens.filter(x => x.type !== 'esp'); let i = 0;
  const voir = () => t[i], prendre = () => t[i++];
  const attendre = type => { const x = prendre(); if (!x || x.type !== type) throw new Erreur('#NOM?'); return x; };
  const PREC = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };
  function primaire() {
    const x = prendre(); if (!x) throw new Erreur('#NOM?');
    if (x.type === 'num') return { t: 'num', v: x.v };
    if (x.type === 'str') return { t: 'str', v: x.v };
    if (x.type === 'bool') return { t: 'bool', v: x.v };
    if (x.type === 'err') return { t: 'err', v: erreurDe(ERR_FR[x.v] || x.v) };
    if (x.type === 'ref') return refNoeud(x);
    if (x.type === 'nom') return { t: 'nom', v: x.v };
    if (x.type === '(') { const e = expr(0); attendre(')'); return e; }
    if (x.type === '{') { // constante matricielle
      const lignes = [[]];
      while (voir() && voir().type !== '}') {
        const y = prendre();
        if (y.type === 'colm') continue; if (y.type === 'lignem') { lignes.push([]); continue; }
        if (y.type === 'op' && y.v === '-') { const z = prendre(); lignes[lignes.length - 1].push(-z.v); continue; }
        lignes[lignes.length - 1].push(y.type === 'num' ? y.v : y.type === 'str' ? y.v : y.type === 'bool' ? y.v : null);
      }
      attendre('}'); return { t: 'mat', v: lignes };
    }
    if (x.type === 'fn') {
      attendre('('); const args = [];
      if (voir() && voir().type === ')') { prendre(); return { t: 'fn', nom: x.v.toUpperCase(), args }; }
      while (true) {
        if (voir() && (voir().type === 'sep' || voir().type === ')')) args.push({ t: 'vide' });
        else args.push(expr(0));
        const s = prendre(); if (!s) throw new Erreur('#NOM?');
        if (s.type === ')') break; if (s.type !== 'sep') throw new Erreur('#NOM?');
      }
      return { t: 'fn', nom: x.v.toUpperCase(), args };
    }
    if (x.type === 'op' && (x.v === '-' || x.v === '+')) { const a = unaire(); return x.v === '-' ? { t: 'neg', a } : a; }
    throw new Erreur('#NOM?');
  }
  function unaire() { let e = primaire(); while (voir() && voir().type === 'op' && voir().v === '%') { prendre(); e = { t: 'pct', a: e }; } return e; }
  function expr(min) {
    let g = unaire();
    while (true) {
      const tk = voir();
      if (!tk || tk.type !== 'op' || !PREC[tk.v] || PREC[tk.v] < min) break;
      prendre();
      const d = expr(PREC[tk.v] + 1);
      g = { t: 'bin', op: tk.v, a: g, b: d };
    }
    return g;
  }
  const e = expr(0);
  if (i < t.length) throw new Erreur('#NOM?');
  return e;
}
function refNoeud(x) {
  const c = x.cible;
  let m;
  if ((m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(c))) return { t: 'ref', feuille: x.feuille, r: +m[4] - 1, c: lettreCol(m[2]), absR: !!m[3], absC: !!m[1] };
  if ((m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+):(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(c))) return { t: 'plage', feuille: x.feuille, r1: +m[4] - 1, c1: lettreCol(m[2]), r2: +m[8] - 1, c2: lettreCol(m[6]) };
  if ((m = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(c))) return { t: 'plage', feuille: x.feuille, r1: 0, c1: lettreCol(m[1]), r2: MAX_LIGNES - 1, c2: lettreCol(m[2]), colonnes: true };
  if ((m = /^\$?(\d+):\$?(\d+)$/.exec(c))) return { t: 'plage', feuille: x.feuille, r1: +m[1] - 1, c1: 0, r2: +m[2] - 1, c2: MAX_COLS - 1, lignes: true };
  throw new Erreur('#REF!');
}
const cacheAST = new Map();
export function compiler(formule) {
  let a = cacheAST.get(formule);
  if (a) return a;
  try { a = analyser(decouper(formule.replace(/^=/, ''))); } catch (e) { a = { t: 'err', v: e instanceof Erreur ? e : ERR.NOM }; }
  if (cacheAST.size > 20000) cacheAST.clear();
  cacheAST.set(formule, a); return a;
}

// ---------- Plages ----------
export class Plage {
  constructor(ctx, feuille, r1, c1, r2, c2) { this.ctx = ctx; this.feuille = feuille; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2; }
  get lignes() { return this.r2 - this.r1 + 1; } get colonnes() { return this.c2 - this.c1 + 1; }
  borner() { const u = this.ctx.etendue(this.feuille); return new Plage(this.ctx, this.feuille, this.r1, this.c1, Math.min(this.r2, Math.max(this.r1, u.r2)), Math.min(this.c2, Math.max(this.c1, u.c2))); }
  valeur(i, j) { return this.ctx.valeur(this.feuille, this.r1 + i, this.c1 + j); }
  valeurs() { const p = this.borner(); const m = []; for (let i = 0; i <= p.r2 - p.r1; i++) { const l = []; for (let j = 0; j <= p.c2 - p.c1; j++) l.push(p.valeur(i, j)); m.push(l); } return m; }
  *cellules() { const p = this.borner(); for (let i = 0; i <= p.r2 - p.r1; i++) for (let j = 0; j <= p.c2 - p.c1; j++) yield this.valeur(i, j); }
}
const estPlage = v => v instanceof Plage;
const estMatrice = v => Array.isArray(v);

// ---------- Conversions ----------
export function nombreDepuisTexte(s) {
  if (typeof s !== 'string') return null;
  let t = s.trim().replace(/[\u00a0\u202f ]/g, '');
  if (!t) return null;
  let pct = false; if (t.endsWith('%')) { pct = true; t = t.slice(0, -1); }
  t = t.replace(/€$/, '');
  if (/^[+-]?(\d+(,\d*)?|,\d+)([eE][+-]?\d+)?$/.test(t)) { const n = parseFloat(t.replace(',', '.')); return pct ? n / 100 : n; }
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) { const n = parseFloat(t); return pct ? n / 100 : n; }
  const d = dateDepuisTexte(s); if (d != null) return d;
  return null;
}
export function dateDepuisTexte(s) {
  let m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/.exec(s);
  if (m) { let a = +m[3]; if (a < 100) a += a < 30 ? 2000 : 1900; const j = +m[1], mo = +m[2]; if (mo < 1 || mo > 12 || j < 1 || j > 31) return null; let v = serieDate(a, mo, j); if (m[4]) v += (+m[4] * 3600 + +m[5] * 60 + +(m[6] || 0)) / 86400; return v; }
  m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?\s*$/.exec(s);
  if (m) { let v = serieDate(+m[1], +m[2], +m[3]); if (m[4]) v += (+m[4] * 3600 + +m[5] * 60 + +(m[6] || 0)) / 86400; return v; }
  m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(s);
  if (m && +m[2] < 60) return (+m[1] * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400;
  return null;
}
// Numéros de série Excel (système 1900, avec le 29/02/1900 fictif)
export function serieDate(a, m, j) {
  const ms = Date.UTC(a, m - 1, j); let s = ms / 86400000 + 25569;
  if (s < 61) s -= 1; // 1900 n'est pas bissextile
  return s;
}
export function dateDepuisSerie(s) {
  let n = Math.floor(s); if (n < 61) n += 1;
  const d = new Date((n - 25569) * 86400000);
  const f = s - Math.floor(s); const sec = Math.round(f * 86400);
  return { a: d.getUTCFullYear(), m: d.getUTCMonth() + 1, j: d.getUTCDate(), js: d.getUTCDay(), h: Math.floor(sec / 3600) % 24, mi: Math.floor(sec / 60) % 60, s: sec % 60 };
}
export function texteNombre(n) {
  if (!isFinite(n)) return '#NOMBRE!';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  let s = Math.abs(n) >= 1e11 || (Math.abs(n) < 1e-9 && n !== 0) ? n.toExponential(5).replace(/\.?0+e/, 'E').replace('e', 'E') : String(parseFloat(n.toPrecision(15)));
  return s.replace('.', ',');
}
function num(v) {
  if (estErreur(v)) throw v;
  if (estPlage(v)) { if (v.lignes === 1 && v.colonnes === 1) return num(v.valeur(0, 0)); throw ERR.VAL; }
  if (estMatrice(v)) return num(v[0][0]);
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = nombreDepuisTexte(v); if (n == null) throw ERR.VAL; return n;
}
function txt(v) {
  if (estErreur(v)) throw v;
  if (estPlage(v)) { if (v.lignes === 1 && v.colonnes === 1) return txt(v.valeur(0, 0)); throw ERR.VAL; }
  if (estMatrice(v)) return txt(v[0][0]);
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'VRAI' : 'FAUX';
  if (typeof v === 'number') return texteNombre(v);
  return String(v);
}
function bool(v) {
  if (estErreur(v)) throw v;
  if (estPlage(v)) { if (v.lignes === 1 && v.colonnes === 1) return bool(v.valeur(0, 0)); throw ERR.VAL; }
  if (estMatrice(v)) return bool(v[0][0]);
  if (v == null || v === '') return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toUpperCase(); if (s === 'VRAI' || s === 'TRUE') return true; if (s === 'FAUX' || s === 'FALSE') return false;
  throw ERR.VAL;
}
function scal(v) { if (estPlage(v)) return v.lignes === 1 && v.colonnes === 1 ? v.valeur(0, 0) : ERR.VAL; if (estMatrice(v)) return v[0][0]; return v; }
function matrice(v) { if (estPlage(v)) return v.valeurs(); if (estMatrice(v)) return v; return [[v]]; }
// Valeurs numériques pour SOMME, MOYENNE… (texte et logiques ignorés dans les plages)
function nombres(args, { vides = false, logiquesPlage = false } = {}) {
  const r = [];
  for (const a of args) {
    if (estPlage(a) || estMatrice(a)) {
      const it = estPlage(a) ? a.cellules() : a.flat();
      for (const v of it) { if (estErreur(v)) throw v; if (typeof v === 'number') r.push(v); else if (logiquesPlage && typeof v === 'boolean') r.push(v ? 1 : 0); else if (vides && v == null) r.push(0); }
    } else if (a !== undefined) {
      if (a == null) { if (vides) r.push(0); continue; }
      r.push(num(a));
    }
  }
  return r;
}
function toutes(args) { const r = []; for (const a of args) { if (estPlage(a)) for (const v of a.cellules()) r.push(v); else if (estMatrice(a)) r.push(...a.flat()); else r.push(a); } return r; }

// Critères (NB.SI, SOMME.SI…)
function critere(c) {
  if (typeof c === 'number' || typeof c === 'boolean') return v => v === c || (typeof v === 'string' && nombreDepuisTexte(v) === c);
  const s = c == null ? '' : String(c);
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(s); const op = m[1] || '=', val = m[2];
  const n = nombreDepuisTexte(val);
  if (n != null && val !== '') {
    return v => { const x = typeof v === 'number' ? v : (typeof v === 'string' ? nombreDepuisTexte(v) : null); if (x == null) return op === '<>'; return { '=': x === n, '<>': x !== n, '<': x < n, '>': x > n, '<=': x <= n, '>=': x >= n }[op]; };
  }
  if (/^(VRAI|FAUX)$/i.test(val)) { const b = /^VRAI$/i.test(val); return v => op === '<>' ? v !== b : v === b; }
  const re = new RegExp('^' + val.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?') + '$', 'is');
  if (op === '=' || op === '<>') {
    return v => { const t = v == null ? '' : typeof v === 'string' ? v : txt(v); const ok = val === '' ? (v == null || v === '') : re.test(t); return op === '=' ? ok : !ok; };
  }
  return v => { if (typeof v !== 'string') return false; const cmp = v.localeCompare(val, 'fr', { sensitivity: 'base' }); return { '<': cmp < 0, '>': cmp > 0, '<=': cmp <= 0, '>=': cmp >= 0 }[op]; };
}
function comparer(a, b) {
  // ordre Excel : nombres < texte < logiques
  const rang = v => typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 0;
  if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  if (rang(a) !== rang(b)) return rang(a) - rang(b);
  if (typeof a === 'string') return a.localeCompare(b, 'fr', { sensitivity: 'base' });
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------- Fonctions ----------
// [nom français, nom anglais, catégorie, syntaxe, description, implémentation, paresseuse]
const F = [];
const def = (fr, en, cat, syn, desc, f, opts = {}) => F.push({ fr, en, cat, syn, desc, f, ...opts });
const somme = l => l.reduce((a, b) => a + b, 0);
const arr = (n, d = 0) => { const p = Math.pow(10, d); return Math.round((n + (n >= 0 ? 1e-12 : -1e-12) * Math.abs(n)) * p) / p; };

// Mathématiques
def('SOMME', 'SUM', 'Maths', 'SOMME(nombre1; [nombre2]; …)', 'Additionne les nombres d\'une ou plusieurs plages.', a => somme(nombres(a)));
def('MOYENNE', 'AVERAGE', 'Statistiques', 'MOYENNE(nombre1; [nombre2]; …)', 'Renvoie la moyenne arithmétique.', a => { const l = nombres(a); if (!l.length) throw ERR.DIV0; return somme(l) / l.length; });
def('MIN', 'MIN', 'Statistiques', 'MIN(nombre1; [nombre2]; …)', 'Renvoie la plus petite valeur.', a => { const l = nombres(a); return l.length ? Math.min(...l) : 0; });
def('MAX', 'MAX', 'Statistiques', 'MAX(nombre1; [nombre2]; …)', 'Renvoie la plus grande valeur.', a => { const l = nombres(a); return l.length ? Math.max(...l) : 0; });
def('NB', 'COUNT', 'Statistiques', 'NB(valeur1; [valeur2]; …)', 'Compte les cellules contenant des nombres.', a => { let n = 0; for (const x of a) { if (estPlage(x) || estMatrice(x)) { for (const v of (estPlage(x) ? x.cellules() : x.flat())) if (typeof v === 'number') n++; } else if (typeof x === 'number' || (typeof x === 'string' && nombreDepuisTexte(x) != null) || typeof x === 'boolean') n++; } return n; });
def('NBVAL', 'COUNTA', 'Statistiques', 'NBVAL(valeur1; [valeur2]; …)', 'Compte les cellules non vides.', a => toutes(a).filter(v => v != null && v !== '').length);
def('NB.VIDE', 'COUNTBLANK', 'Statistiques', 'NB.VIDE(plage)', 'Compte les cellules vides.', a => toutes(a).filter(v => v == null || v === '').length);
def('NB.SI', 'COUNTIF', 'Statistiques', 'NB.SI(plage; critère)', 'Compte les cellules qui répondent à un critère (ex. ">10", "oui", "A*").', ([p, c]) => { const f = critere(scal(c)); let n = 0; for (const v of matrice(p).flat()) if (f(v)) n++; return n; });
def('NB.SI.ENS', 'COUNTIFS', 'Statistiques', 'NB.SI.ENS(plage1; critère1; [plage2; critère2]; …)', 'Compte les cellules qui répondent à plusieurs critères.', a => { const ps = []; for (let i = 0; i < a.length; i += 2) ps.push([matrice(a[i]).flat(), critere(scal(a[i + 1]))]); let n = 0; for (let k = 0; k < ps[0][0].length; k++) if (ps.every(([l, f]) => f(l[k]))) n++; return n; });
def('SOMME.SI', 'SUMIF', 'Maths', 'SOMME.SI(plage; critère; [somme_plage])', 'Additionne les cellules qui répondent à un critère.', ([p, c, s]) => { const f = critere(scal(c)); const l = matrice(p).flat(), t = s ? matrice(s).flat() : l; let r = 0; l.forEach((v, i) => { if (f(v) && typeof t[i] === 'number') r += t[i]; }); return r; });
def('SOMME.SI.ENS', 'SUMIFS', 'Maths', 'SOMME.SI.ENS(somme_plage; plage1; critère1; [plage2; critère2]; …)', 'Additionne les cellules qui répondent à plusieurs critères.', ([s, ...a]) => { const t = matrice(s).flat(); const ps = []; for (let i = 0; i < a.length; i += 2) ps.push([matrice(a[i]).flat(), critere(scal(a[i + 1]))]); let r = 0; t.forEach((v, k) => { if (typeof v === 'number' && ps.every(([l, f]) => f(l[k]))) r += v; }); return r; });
def('MOYENNE.SI', 'AVERAGEIF', 'Statistiques', 'MOYENNE.SI(plage; critère; [moyenne_plage])', 'Moyenne des cellules qui répondent à un critère.', ([p, c, s]) => { const f = critere(scal(c)); const l = matrice(p).flat(), t = s ? matrice(s).flat() : l; let r = 0, n = 0; l.forEach((v, i) => { if (f(v) && typeof t[i] === 'number') { r += t[i]; n++; } }); if (!n) throw ERR.DIV0; return r / n; });
def('MOYENNE.SI.ENS', 'AVERAGEIFS', 'Statistiques', 'MOYENNE.SI.ENS(moyenne_plage; plage1; critère1; …)', 'Moyenne des cellules qui répondent à plusieurs critères.', ([s, ...a]) => { const t = matrice(s).flat(); const ps = []; for (let i = 0; i < a.length; i += 2) ps.push([matrice(a[i]).flat(), critere(scal(a[i + 1]))]); let r = 0, n = 0; t.forEach((v, k) => { if (typeof v === 'number' && ps.every(([l, f]) => f(l[k]))) { r += v; n++; } }); if (!n) throw ERR.DIV0; return r / n; });
def('MAX.SI.ENS', 'MAXIFS', 'Statistiques', 'MAX.SI.ENS(max_plage; plage1; critère1; …)', 'Plus grande valeur parmi les cellules répondant aux critères.', ([s, ...a]) => { const t = matrice(s).flat(); const ps = []; for (let i = 0; i < a.length; i += 2) ps.push([matrice(a[i]).flat(), critere(scal(a[i + 1]))]); const l = t.filter((v, k) => typeof v === 'number' && ps.every(([x, f]) => f(x[k]))); return l.length ? Math.max(...l) : 0; });
def('MIN.SI.ENS', 'MINIFS', 'Statistiques', 'MIN.SI.ENS(min_plage; plage1; critère1; …)', 'Plus petite valeur parmi les cellules répondant aux critères.', ([s, ...a]) => { const t = matrice(s).flat(); const ps = []; for (let i = 0; i < a.length; i += 2) ps.push([matrice(a[i]).flat(), critere(scal(a[i + 1]))]); const l = t.filter((v, k) => typeof v === 'number' && ps.every(([x, f]) => f(x[k]))); return l.length ? Math.min(...l) : 0; });
def('ARRONDI', 'ROUND', 'Maths', 'ARRONDI(nombre; no_chiffres)', 'Arrondit un nombre au nombre de chiffres indiqué.', ([n, d]) => arr(num(n), num(d ?? 0)));
def('ARRONDI.SUP', 'ROUNDUP', 'Maths', 'ARRONDI.SUP(nombre; no_chiffres)', 'Arrondit en s\'éloignant de zéro.', ([n, d]) => { const p = Math.pow(10, num(d ?? 0)), x = num(n); return Math.sign(x) * Math.ceil(Math.abs(x) * p - 1e-9) / p; });
def('ARRONDI.INF', 'ROUNDDOWN', 'Maths', 'ARRONDI.INF(nombre; no_chiffres)', 'Arrondit en se rapprochant de zéro.', ([n, d]) => { const p = Math.pow(10, num(d ?? 0)), x = num(n); return Math.sign(x) * Math.floor(Math.abs(x) * p + 1e-9) / p; });
def('ARRONDI.AU.MULTIPLE', 'MROUND', 'Maths', 'ARRONDI.AU.MULTIPLE(nombre; multiple)', 'Arrondit au multiple le plus proche.', ([n, m]) => { const x = num(n), y = num(m); if (!y) return 0; if (x * y < 0) throw ERR.NUM; return Math.round(x / y) * y; });
def('ENT', 'INT', 'Maths', 'ENT(nombre)', 'Arrondit à l\'entier inférieur.', ([n]) => Math.floor(num(n)));
def('TRONQUE', 'TRUNC', 'Maths', 'TRONQUE(nombre; [no_chiffres])', 'Supprime la partie décimale.', ([n, d]) => { const p = Math.pow(10, num(d ?? 0)); return Math.trunc(num(n) * p) / p; });
def('ABS', 'ABS', 'Maths', 'ABS(nombre)', 'Valeur absolue.', ([n]) => Math.abs(num(n)));
def('MOD', 'MOD', 'Maths', 'MOD(nombre; diviseur)', 'Reste de la division.', ([n, d]) => { const x = num(n), y = num(d); if (!y) throw ERR.DIV0; return x - y * Math.floor(x / y); });
def('QUOTIENT', 'QUOTIENT', 'Maths', 'QUOTIENT(numérateur; dénominateur)', 'Partie entière d\'une division.', ([n, d]) => { const y = num(d); if (!y) throw ERR.DIV0; return Math.trunc(num(n) / y); });
def('PUISSANCE', 'POWER', 'Maths', 'PUISSANCE(nombre; puissance)', 'Élève un nombre à une puissance.', ([n, p]) => { const r = Math.pow(num(n), num(p)); if (!isFinite(r) || isNaN(r)) throw ERR.NUM; return r; });
def('RACINE', 'SQRT', 'Maths', 'RACINE(nombre)', 'Racine carrée.', ([n]) => { const x = num(n); if (x < 0) throw ERR.NUM; return Math.sqrt(x); });
def('PRODUIT', 'PRODUCT', 'Maths', 'PRODUIT(nombre1; [nombre2]; …)', 'Multiplie les nombres.', a => nombres(a).reduce((x, y) => x * y, 1));
def('SOMMEPROD', 'SUMPRODUCT', 'Maths', 'SOMMEPROD(matrice1; [matrice2]; …)', 'Somme des produits des éléments correspondants.', a => { const ms = a.map(x => matrice(x).flat()); const n = ms[0].length; if (ms.some(m => m.length !== n)) throw ERR.VAL; let s = 0; for (let i = 0; i < n; i++) s += ms.reduce((p, m) => p * (typeof m[i] === 'number' ? m[i] : typeof m[i] === 'boolean' ? +m[i] : 0), 1); return s; });
def('SOMME.CARRES', 'SUMSQ', 'Maths', 'SOMME.CARRES(nombre1; …)', 'Somme des carrés.', a => somme(nombres(a).map(x => x * x)));
def('ALEA', 'RAND', 'Maths', 'ALEA()', 'Nombre aléatoire entre 0 et 1.', () => Math.random(), { volatile: true });
def('ALEA.ENTRE.BORNES', 'RANDBETWEEN', 'Maths', 'ALEA.ENTRE.BORNES(min; max)', 'Entier aléatoire entre deux bornes.', ([a, b]) => { const x = Math.ceil(num(a)), y = Math.floor(num(b)); return x + Math.floor(Math.random() * (y - x + 1)); }, { volatile: true });
def('PI', 'PI', 'Maths', 'PI()', 'Valeur de pi.', () => Math.PI);
def('EXP', 'EXP', 'Maths', 'EXP(nombre)', 'e élevé à une puissance.', ([n]) => Math.exp(num(n)));
def('LN', 'LN', 'Maths', 'LN(nombre)', 'Logarithme népérien.', ([n]) => { const x = num(n); if (x <= 0) throw ERR.NUM; return Math.log(x); });
def('LOG', 'LOG', 'Maths', 'LOG(nombre; [base])', 'Logarithme dans la base indiquée (10 par défaut).', ([n, b]) => { const x = num(n), y = b === undefined ? 10 : num(b); if (x <= 0 || y <= 0) throw ERR.NUM; return Math.log(x) / Math.log(y); });
def('LOG10', 'LOG10', 'Maths', 'LOG10(nombre)', 'Logarithme décimal.', ([n]) => { const x = num(n); if (x <= 0) throw ERR.NUM; return Math.log10(x); });
def('PLAFOND', 'CEILING', 'Maths', 'PLAFOND(nombre; précision)', 'Arrondit au multiple supérieur.', ([n, p]) => { const x = num(n), y = p === undefined ? 1 : num(p); if (!y) return 0; return Math.ceil(x / y - 1e-12) * y; });
def('PLANCHER', 'FLOOR', 'Maths', 'PLANCHER(nombre; précision)', 'Arrondit au multiple inférieur.', ([n, p]) => { const x = num(n), y = p === undefined ? 1 : num(p); if (!y) throw ERR.DIV0; return Math.floor(x / y + 1e-12) * y; });
def('SIGNE', 'SIGN', 'Maths', 'SIGNE(nombre)', 'Signe d\'un nombre (1, 0 ou -1).', ([n]) => Math.sign(num(n)));
def('PAIR', 'EVEN', 'Maths', 'PAIR(nombre)', 'Arrondit au nombre pair supérieur.', ([n]) => { const x = num(n); const r = Math.ceil(Math.abs(x) / 2) * 2; return x < 0 ? -r : r; });
def('IMPAIR', 'ODD', 'Maths', 'IMPAIR(nombre)', 'Arrondit au nombre impair supérieur.', ([n]) => { const x = num(n); let r = Math.ceil(Math.abs(x)); if (r % 2 === 0) r++; return x < 0 ? -r : r; });
def('FACT', 'FACT', 'Maths', 'FACT(nombre)', 'Factorielle.', ([n]) => { const x = Math.floor(num(n)); if (x < 0) throw ERR.NUM; let r = 1; for (let i = 2; i <= x; i++) r *= i; return r; });
def('COMBIN', 'COMBIN', 'Maths', 'COMBIN(n; k)', 'Nombre de combinaisons.', ([n, k]) => { const a = Math.floor(num(n)), b = Math.floor(num(k)); if (b > a || b < 0) throw ERR.NUM; let r = 1; for (let i = 1; i <= b; i++) r = r * (a - b + i) / i; return Math.round(r); });
def('PGCD', 'GCD', 'Maths', 'PGCD(nombre1; [nombre2]; …)', 'Plus grand commun diviseur.', a => nombres(a).map(Math.floor).reduce((x, y) => { while (y) [x, y] = [y, x % y]; return x; }));
def('PPCM', 'LCM', 'Maths', 'PPCM(nombre1; [nombre2]; …)', 'Plus petit commun multiple.', a => nombres(a).map(Math.floor).reduce((x, y) => { let g = x, h = y; while (h) [g, h] = [h, g % h]; return x * y / g; }));
def('SOUS.TOTAL', 'SUBTOTAL', 'Maths', 'SOUS.TOTAL(no_fonction; plage1; …)', 'Sous-total (1 moyenne, 2 nb, 3 nbval, 4 max, 5 min, 6 produit, 9 somme…).', ([n, ...a]) => { const k = num(n) % 100; const f = { 1: 'MOYENNE', 2: 'NB', 3: 'NBVAL', 4: 'MAX', 5: 'MIN', 6: 'PRODUIT', 7: 'ECARTYPE', 8: 'ECARTYPEP', 9: 'SOMME', 10: 'VAR', 11: 'VAR.P' }[k]; if (!f) throw ERR.VAL; return FONCTIONS[f].f(a); });
def('MEDIANE', 'MEDIAN', 'Statistiques', 'MEDIANE(nombre1; …)', 'Valeur médiane.', a => { const l = nombres(a).sort((x, y) => x - y); if (!l.length) throw ERR.NUM; const m = l.length >> 1; return l.length % 2 ? l[m] : (l[m - 1] + l[m]) / 2; });
def('MODE', 'MODE', 'Statistiques', 'MODE(nombre1; …)', 'Valeur la plus fréquente.', a => { const l = nombres(a); const c = new Map(); let best = null, n = 1; for (const v of l) { const k = (c.get(v) || 0) + 1; c.set(v, k); if (k > n) { n = k; best = v; } } if (best == null) throw ERR.NA; return best; });
const variance = (l, p) => { const n = l.length; if (n < (p ? 1 : 2)) throw ERR.DIV0; const m = somme(l) / n; return somme(l.map(x => (x - m) ** 2)) / (n - (p ? 0 : 1)); };
def('ECARTYPE', 'STDEV', 'Statistiques', 'ECARTYPE(nombre1; …)', 'Écart type d\'un échantillon.', a => Math.sqrt(variance(nombres(a), false)));
def('ECARTYPE.STANDARD', 'STDEV.S', 'Statistiques', 'ECARTYPE.STANDARD(nombre1; …)', 'Écart type d\'un échantillon.', a => Math.sqrt(variance(nombres(a), false)));
def('ECARTYPEP', 'STDEVP', 'Statistiques', 'ECARTYPEP(nombre1; …)', 'Écart type d\'une population.', a => Math.sqrt(variance(nombres(a), true)));
def('ECARTYPE.PEARSON', 'STDEV.P', 'Statistiques', 'ECARTYPE.PEARSON(nombre1; …)', 'Écart type d\'une population.', a => Math.sqrt(variance(nombres(a), true)));
def('VAR', 'VAR', 'Statistiques', 'VAR(nombre1; …)', 'Variance d\'un échantillon.', a => variance(nombres(a), false));
def('VAR.P', 'VAR.P', 'Statistiques', 'VAR.P(nombre1; …)', 'Variance d\'une population.', a => variance(nombres(a), true));
def('GRANDE.VALEUR', 'LARGE', 'Statistiques', 'GRANDE.VALEUR(matrice; k)', 'k-ième plus grande valeur.', ([m, k]) => { const l = nombres([m]).sort((x, y) => y - x); const i = Math.ceil(num(k)) - 1; if (i < 0 || i >= l.length) throw ERR.NUM; return l[i]; });
def('PETITE.VALEUR', 'SMALL', 'Statistiques', 'PETITE.VALEUR(matrice; k)', 'k-ième plus petite valeur.', ([m, k]) => { const l = nombres([m]).sort((x, y) => x - y); const i = Math.ceil(num(k)) - 1; if (i < 0 || i >= l.length) throw ERR.NUM; return l[i]; });
def('RANG', 'RANK', 'Statistiques', 'RANG(nombre; référence; [ordre])', 'Rang d\'un nombre dans une liste (0 décroissant, 1 croissant).', ([n, r, o]) => { const x = num(n), l = nombres([r]); if (!l.includes(x)) throw ERR.NA; return 1 + l.filter(v => (o && num(o) ? v < x : v > x)).length; });
def('CENTILE', 'PERCENTILE', 'Statistiques', 'CENTILE(matrice; k)', 'k-ième centile (k entre 0 et 1).', ([m, k]) => { const l = nombres([m]).sort((x, y) => x - y), p = num(k); if (p < 0 || p > 1 || !l.length) throw ERR.NUM; const h = (l.length - 1) * p, i = Math.floor(h); return l[i] + (h - i) * ((l[i + 1] ?? l[i]) - l[i]); });
def('QUARTILE', 'QUARTILE', 'Statistiques', 'QUARTILE(matrice; quart)', 'Quartile (0 à 4).', ([m, q]) => FONCTIONS.CENTILE.f([m, num(q) / 4]));
def('MOYENNE.GEOMETRIQUE', 'GEOMEAN', 'Statistiques', 'MOYENNE.GEOMETRIQUE(nombre1; …)', 'Moyenne géométrique.', a => { const l = nombres(a); if (!l.length || l.some(x => x <= 0)) throw ERR.NUM; return Math.exp(somme(l.map(Math.log)) / l.length); });
def('COEFFICIENT.CORRELATION', 'CORREL', 'Statistiques', 'COEFFICIENT.CORRELATION(matrice1; matrice2)', 'Coefficient de corrélation.', ([a, b]) => { const x = matrice(a).flat(), y = matrice(b).flat(); const p = x.map((v, i) => [v, y[i]]).filter(([u, v]) => typeof u === 'number' && typeof v === 'number'); const n = p.length; if (n < 2) throw ERR.DIV0; const mx = somme(p.map(q => q[0])) / n, my = somme(p.map(q => q[1])) / n; const c = somme(p.map(([u, v]) => (u - mx) * (v - my))); return c / Math.sqrt(somme(p.map(([u]) => (u - mx) ** 2)) * somme(p.map(([, v]) => (v - my) ** 2))); });
def('PREVISION', 'FORECAST', 'Statistiques', 'PREVISION(x; y_connus; x_connus)', 'Prévision par régression linéaire.', ([x, ys, xs]) => { const y = nombres([ys]), xx = nombres([xs]); const n = y.length; const mx = somme(xx) / n, my = somme(y) / n; const b = somme(xx.map((v, i) => (v - mx) * (y[i] - my))) / somme(xx.map(v => (v - mx) ** 2)); return my + b * (num(x) - mx); });

// Logique
def('SI', 'IF', 'Logique', 'SI(test; valeur_si_vrai; [valeur_si_faux])', 'Renvoie une valeur si la condition est vraie, une autre sinon.', ([t, a, b], ev) => bool(scal(ev(t))) ? (a ? ev(a) : true) : (b ? ev(b) : false), { paresseuse: true });
def('ET', 'AND', 'Logique', 'ET(logique1; [logique2]; …)', 'VRAI si tous les arguments sont vrais.', a => { const l = toutes(a).filter(v => v != null && typeof v !== 'string'); if (!l.length) throw ERR.VAL; return l.every(bool); });
def('OU', 'OR', 'Logique', 'OU(logique1; [logique2]; …)', 'VRAI si au moins un argument est vrai.', a => { const l = toutes(a).filter(v => v != null && typeof v !== 'string'); if (!l.length) throw ERR.VAL; return l.some(bool); });
def('OUX', 'XOR', 'Logique', 'OUX(logique1; …)', 'OU exclusif.', a => toutes(a).filter(v => v != null && typeof v !== 'string').filter(bool).length % 2 === 1);
def('NON', 'NOT', 'Logique', 'NON(logique)', 'Inverse la valeur logique.', ([x]) => !bool(scal(x)));
def('VRAI', 'TRUE', 'Logique', 'VRAI()', 'Valeur logique VRAI.', () => true);
def('FAUX', 'FALSE', 'Logique', 'FAUX()', 'Valeur logique FAUX.', () => false);
def('SIERREUR', 'IFERROR', 'Logique', 'SIERREUR(valeur; valeur_si_erreur)', 'Renvoie une valeur de remplacement en cas d\'erreur.', ([v, e], ev) => { let x; try { x = scal(ev(v)); } catch (er) { x = er instanceof Erreur ? er : ERR.VAL; } return estErreur(x) ? ev(e) : x; }, { paresseuse: true });
def('SI.NON.DISP', 'IFNA', 'Logique', 'SI.NON.DISP(valeur; valeur_si_na)', 'Valeur de remplacement si #N/A.', ([v, e], ev) => { let x; try { x = scal(ev(v)); } catch (er) { x = er; } return x === ERR.NA || (estErreur(x) && x.code === '#N/A') ? ev(e) : x; }, { paresseuse: true });
def('SI.CONDITIONS', 'IFS', 'Logique', 'SI.CONDITIONS(test1; valeur1; [test2; valeur2]; …)', 'Renvoie la valeur de la première condition vraie.', (a, ev) => { for (let i = 0; i < a.length; i += 2) if (bool(scal(ev(a[i])))) return ev(a[i + 1]); throw ERR.NA; }, { paresseuse: true });
def('SI.MULTIPLE', 'SWITCH', 'Logique', 'SI.MULTIPLE(expression; valeur1; résultat1; …; [défaut])', 'Compare une expression à une liste de valeurs.', ([x, ...a], ev) => { const v = scal(ev(x)); for (let i = 0; i + 1 < a.length; i += 2) if (comparer(v, scal(ev(a[i]))) === 0) return ev(a[i + 1]); if (a.length % 2) return ev(a[a.length - 1]); throw ERR.NA; }, { paresseuse: true });

// Texte
def('CONCATENER', 'CONCATENATE', 'Texte', 'CONCATENER(texte1; [texte2]; …)', 'Assemble plusieurs textes.', a => a.map(x => txt(scal(x))).join(''));
def('CONCAT', 'CONCAT', 'Texte', 'CONCAT(texte1; [texte2]; …)', 'Assemble des textes et des plages.', a => toutes(a).map(txt).join(''));
def('JOINDRE.TEXTE', 'TEXTJOIN', 'Texte', 'JOINDRE.TEXTE(séparateur; ignorer_vides; texte1; …)', 'Assemble des textes avec un séparateur.', ([s, ig, ...a]) => { let l = toutes(a).map(txt); if (bool(scal(ig))) l = l.filter(x => x !== ''); return l.join(txt(scal(s))); });
def('GAUCHE', 'LEFT', 'Texte', 'GAUCHE(texte; [nb_car])', 'Premiers caractères d\'un texte.', ([t, n]) => txt(scal(t)).slice(0, n === undefined ? 1 : num(n)));
def('DROITE', 'RIGHT', 'Texte', 'DROITE(texte; [nb_car])', 'Derniers caractères d\'un texte.', ([t, n]) => { const s = txt(scal(t)), k = n === undefined ? 1 : num(n); return k <= 0 ? '' : s.slice(-k); });
def('STXT', 'MID', 'Texte', 'STXT(texte; no_départ; nb_car)', 'Caractères au milieu d\'un texte.', ([t, d, n]) => { const i = num(d); if (i < 1) throw ERR.VAL; return txt(scal(t)).substr(i - 1, num(n)); });
def('NBCAR', 'LEN', 'Texte', 'NBCAR(texte)', 'Nombre de caractères.', ([t]) => txt(scal(t)).length);
def('MAJUSCULE', 'UPPER', 'Texte', 'MAJUSCULE(texte)', 'Convertit en majuscules.', ([t]) => txt(scal(t)).toLocaleUpperCase('fr'));
def('MINUSCULE', 'LOWER', 'Texte', 'MINUSCULE(texte)', 'Convertit en minuscules.', ([t]) => txt(scal(t)).toLocaleLowerCase('fr'));
def('NOMPROPRE', 'PROPER', 'Texte', 'NOMPROPRE(texte)', 'Première lettre de chaque mot en majuscule.', ([t]) => txt(scal(t)).toLocaleLowerCase('fr').replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('fr')));
def('SUPPRESPACE', 'TRIM', 'Texte', 'SUPPRESPACE(texte)', 'Supprime les espaces superflus.', ([t]) => txt(scal(t)).replace(/ +/g, ' ').trim());
def('EPURAGE', 'CLEAN', 'Texte', 'EPURAGE(texte)', 'Supprime les caractères non imprimables.', ([t]) => txt(scal(t)).replace(/[\x00-\x1f]/g, ''));
def('SUBSTITUE', 'SUBSTITUTE', 'Texte', 'SUBSTITUE(texte; ancien; nouveau; [no_position])', 'Remplace un texte par un autre.', ([t, a, n, p]) => { const s = txt(scal(t)), x = txt(scal(a)), y = txt(scal(n)); if (!x) return s; if (p === undefined) return s.split(x).join(y); let k = num(p), i = -1; while (k-- > 0) { i = s.indexOf(x, i + 1); if (i < 0) return s; } return s.slice(0, i) + y + s.slice(i + x.length); });
def('REMPLACER', 'REPLACE', 'Texte', 'REMPLACER(ancien_texte; no_départ; nb_car; nouveau_texte)', 'Remplace une partie d\'un texte.', ([t, d, n, x]) => { const s = txt(scal(t)), i = num(d) - 1; return s.slice(0, i) + txt(scal(x)) + s.slice(i + num(n)); });
def('TROUVE', 'FIND', 'Texte', 'TROUVE(texte_cherché; texte; [no_départ])', 'Position d\'un texte (respecte la casse).', ([a, t, d]) => { const i = txt(scal(t)).indexOf(txt(scal(a)), (d === undefined ? 1 : num(d)) - 1); if (i < 0) throw ERR.VAL; return i + 1; });
def('CHERCHE', 'SEARCH', 'Texte', 'CHERCHE(texte_cherché; texte; [no_départ])', 'Position d\'un texte (sans tenir compte de la casse, jokers * et ?).', ([a, t, d]) => { const s = txt(scal(t)); const re = new RegExp(txt(scal(a)).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'), 'i'); const m = re.exec(s.slice((d === undefined ? 1 : num(d)) - 1)); if (!m) throw ERR.VAL; return m.index + (d === undefined ? 1 : num(d)); });
def('TEXTE', 'TEXT', 'Texte', 'TEXTE(valeur; format)', 'Convertit un nombre en texte selon un format (ex. "0,00", "jj/mm/aaaa").', ([v, f], ev, ctx) => ctx.formater ? ctx.formater(num(scal(v)), formatDepuisFrancais(txt(scal(f)))) : txt(scal(v)));
def('CNUM', 'VALUE', 'Texte', 'CNUM(texte)', 'Convertit un texte en nombre.', ([t]) => { const x = scal(t); if (typeof x === 'number') return x; const n = nombreDepuisTexte(txt(x)); if (n == null) throw ERR.VAL; return n; });
def('REPT', 'REPT', 'Texte', 'REPT(texte; nb_fois)', 'Répète un texte.', ([t, n]) => txt(scal(t)).repeat(Math.max(0, num(n))));
def('EXACT', 'EXACT', 'Texte', 'EXACT(texte1; texte2)', 'VRAI si deux textes sont identiques.', ([a, b]) => txt(scal(a)) === txt(scal(b)));
def('CAR', 'CHAR', 'Texte', 'CAR(nombre)', 'Caractère correspondant à un code.', ([n]) => String.fromCharCode(num(n)));
def('CODE', 'CODE', 'Texte', 'CODE(texte)', 'Code du premier caractère.', ([t]) => { const s = txt(scal(t)); if (!s) throw ERR.VAL; return s.charCodeAt(0); });
def('T', 'T', 'Texte', 'T(valeur)', 'Renvoie le texte, sinon une chaîne vide.', ([v]) => { const x = scal(v); return typeof x === 'string' ? x : ''; });
def('CTXT', 'FIXED', 'Texte', 'CTXT(nombre; [décimales]; [pas_de_séparateur])', 'Arrondit et convertit en texte.', ([n, d, s]) => { const k = d === undefined ? 2 : num(d); const x = arr(num(n), k); const o = { minimumFractionDigits: Math.max(0, k), maximumFractionDigits: Math.max(0, k), useGrouping: !(s && bool(scal(s))) }; return x.toLocaleString('fr-FR', o).replace(/\u202f/g, ' '); });
def('FRANC', 'DOLLAR', 'Texte', 'FRANC(nombre; [décimales])', 'Convertit en texte au format monétaire.', ([n, d]) => { const k = d === undefined ? 2 : num(d); return arr(num(n), k).toLocaleString('fr-FR', { minimumFractionDigits: Math.max(0, k), maximumFractionDigits: Math.max(0, k) }).replace(/\u202f/g, ' ') + ' €'; });

// Dates
const dj = v => dateDepuisSerie(num(scal(v)));
def('AUJOURDHUI', 'TODAY', 'Date et heure', 'AUJOURDHUI()', 'Date du jour.', () => { const d = new Date(); return serieDate(d.getFullYear(), d.getMonth() + 1, d.getDate()); }, { volatile: true });
def('MAINTENANT', 'NOW', 'Date et heure', 'MAINTENANT()', 'Date et heure actuelles.', () => { const d = new Date(); return serieDate(d.getFullYear(), d.getMonth() + 1, d.getDate()) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; }, { volatile: true });
def('DATE', 'DATE', 'Date et heure', 'DATE(année; mois; jour)', 'Construit une date.', ([a, m, j]) => { let y = num(a); if (y < 1900) y += 1900; const d = new Date(Date.UTC(y, num(m) - 1, num(j))); return serieDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); });
def('ANNEE', 'YEAR', 'Date et heure', 'ANNEE(date)', 'Année d\'une date.', ([d]) => dj(d).a);
def('MOIS', 'MONTH', 'Date et heure', 'MOIS(date)', 'Mois d\'une date (1 à 12).', ([d]) => dj(d).m);
def('JOUR', 'DAY', 'Date et heure', 'JOUR(date)', 'Jour du mois.', ([d]) => dj(d).j);
def('HEURE', 'HOUR', 'Date et heure', 'HEURE(heure)', 'Heure (0 à 23).', ([d]) => dj(d).h);
def('MINUTE', 'MINUTE', 'Date et heure', 'MINUTE(heure)', 'Minutes (0 à 59).', ([d]) => dj(d).mi);
def('SECONDE', 'SECOND', 'Date et heure', 'SECONDE(heure)', 'Secondes (0 à 59).', ([d]) => dj(d).s);
def('TEMPS', 'TIME', 'Date et heure', 'TEMPS(heure; minute; seconde)', 'Construit une heure.', ([h, m, s]) => ((num(h) * 3600 + num(m) * 60 + num(s)) / 86400) % 1);
def('JOURSEM', 'WEEKDAY', 'Date et heure', 'JOURSEM(date; [type])', 'Jour de la semaine (type 2 : lundi = 1).', ([d, t]) => { const js = dj(d).js; const k = t === undefined ? 1 : num(t); if (k === 2) return js === 0 ? 7 : js; if (k === 3) return js === 0 ? 6 : js - 1; return js + 1; });
def('NO.SEMAINE.ISO', 'ISOWEEKNUM', 'Date et heure', 'NO.SEMAINE.ISO(date)', 'Numéro de semaine ISO.', ([d]) => { const x = dj(d); const dt = new Date(Date.UTC(x.a, x.m - 1, x.j)); const j = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - j + 3); const p = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4)); return 1 + Math.round(((dt - p) / 86400000 - 3 + ((p.getUTCDay() + 6) % 7)) / 7); });
def('NO.SEMAINE', 'WEEKNUM', 'Date et heure', 'NO.SEMAINE(date; [type])', 'Numéro de semaine dans l\'année.', ([d, t]) => { const x = dj(d); if (t !== undefined && num(t) === 21) return FONCTIONS['NO.SEMAINE.ISO'].f([d]); const debut = new Date(Date.UTC(x.a, 0, 1)); const lundi = t !== undefined && num(t) === 2; const off = lundi ? (debut.getUTCDay() + 6) % 7 : debut.getUTCDay(); const jour = (Date.UTC(x.a, x.m - 1, x.j) - debut) / 86400000; return Math.floor((jour + off) / 7) + 1; });
def('DATEDIF', 'DATEDIF', 'Date et heure', 'DATEDIF(date_début; date_fin; unité)', 'Écart entre deux dates ("A" années, "M" mois, "J" jours).', ([a, b, u]) => { const x = dj(a), y = dj(b), un = txt(scal(u)).toUpperCase(); if (num(scal(a)) > num(scal(b))) throw ERR.NUM; let mois = (y.a - x.a) * 12 + (y.m - x.m); if (y.j < x.j) mois--; if (un === 'A' || un === 'Y') return Math.floor(mois / 12); if (un === 'M') return mois; if (un === 'J' || un === 'D') return Math.floor(num(scal(b))) - Math.floor(num(scal(a))); if (un === 'MD') return y.j >= x.j ? y.j - x.j : y.j + new Date(Date.UTC(y.a, y.m - 1, 0)).getUTCDate() - x.j; if (un === 'YM' || un === 'AM') return mois % 12; throw ERR.NUM; });
def('FIN.MOIS', 'EOMONTH', 'Date et heure', 'FIN.MOIS(date_départ; mois)', 'Dernier jour du mois, décalé de n mois.', ([d, m]) => { const x = dj(d); const t = new Date(Date.UTC(x.a, x.m + num(m), 0)); return serieDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); });
def('MOIS.DECALER', 'EDATE', 'Date et heure', 'MOIS.DECALER(date_départ; mois)', 'Date décalée de n mois.', ([d, m]) => { const x = dj(d); const fin = new Date(Date.UTC(x.a, x.m - 1 + num(m) + 1, 0)).getUTCDate(); const t = new Date(Date.UTC(x.a, x.m - 1 + num(m), Math.min(x.j, fin))); return serieDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); });
def('JOURS', 'DAYS', 'Date et heure', 'JOURS(date_fin; date_début)', 'Nombre de jours entre deux dates.', ([b, a]) => Math.floor(num(scal(b))) - Math.floor(num(scal(a))));
def('JOURS360', 'DAYS360', 'Date et heure', 'JOURS360(date_début; date_fin)', 'Jours entre deux dates sur une année de 360 jours.', ([a, b]) => { const x = dj(a), y = dj(b); const j1 = Math.min(30, x.j), j2 = y.j === 31 && j1 >= 30 ? 30 : y.j; return (y.a - x.a) * 360 + (y.m - x.m) * 30 + (j2 - j1); });
const feries = v => v ? new Set(nombres([v]).map(Math.floor)) : new Set();
const ouvre = (s, f) => { const js = dateDepuisSerie(s).js; return js !== 0 && js !== 6 && !f.has(s); };
def('NB.JOURS.OUVRES', 'NETWORKDAYS', 'Date et heure', 'NB.JOURS.OUVRES(date_début; date_fin; [jours_fériés])', 'Nombre de jours ouvrés (lundi à vendredi).', ([a, b, h]) => { let x = Math.floor(num(scal(a))), y = Math.floor(num(scal(b))), s = 1; if (x > y) { [x, y] = [y, x]; s = -1; } const f = feries(h); let n = 0; for (let k = x; k <= y; k++) if (ouvre(k, f)) n++; return n * s; });
def('SERIE.JOUR.OUVRE', 'WORKDAY', 'Date et heure', 'SERIE.JOUR.OUVRE(date_début; nb_jours; [jours_fériés])', 'Date après un nombre de jours ouvrés.', ([a, n, h]) => { let x = Math.floor(num(scal(a))), k = num(n); const f = feries(h); const p = k >= 0 ? 1 : -1; while (k !== 0) { x += p; if (ouvre(x, f)) k -= p; } return x; });
def('DATEVAL', 'DATEVALUE', 'Date et heure', 'DATEVAL(texte_date)', 'Convertit un texte en date.', ([t]) => { const v = dateDepuisTexte(txt(scal(t))); if (v == null) throw ERR.VAL; return Math.floor(v); });
def('TEMPSVAL', 'TIMEVALUE', 'Date et heure', 'TEMPSVAL(texte_heure)', 'Convertit un texte en heure.', ([t]) => { const v = dateDepuisTexte(txt(scal(t))); if (v == null) throw ERR.VAL; return v % 1; });
def('FRACTION.ANNEE', 'YEARFRAC', 'Date et heure', 'FRACTION.ANNEE(date_début; date_fin; [base])', 'Fraction d\'année entre deux dates.', ([a, b]) => Math.abs(num(scal(b)) - num(scal(a))) / 365.25);

// Recherche et référence
def('RECHERCHEV', 'VLOOKUP', 'Recherche', 'RECHERCHEV(valeur_cherchée; table; no_colonne; [valeur_proche])', 'Cherche une valeur dans la première colonne et renvoie la valeur d\'une autre colonne. Mettez FAUX pour une correspondance exacte.', ([v, t, c, p]) => { const x = scal(v); const m = matrice(t); const k = num(c) - 1; if (k < 0 || k >= (m[0] || []).length) throw ERR.REF; const approx = p === undefined || p === null ? true : bool(scal(p)); if (!approx) { const f = typeof x === 'string' ? critere(x) : (y => comparer(y, x) === 0); for (const l of m) if (typeof x === 'string' ? f(l[0]) : comparer(l[0], x) === 0) return l[k] ?? 0; throw ERR.NA; } let r = null; for (const l of m) { if (l[0] == null) continue; if (comparer(l[0], x) <= 0) r = l; else break; } if (!r) throw ERR.NA; return r[k] ?? 0; });
def('RECHERCHEH', 'HLOOKUP', 'Recherche', 'RECHERCHEH(valeur_cherchée; table; no_ligne; [valeur_proche])', 'Cherche une valeur dans la première ligne et renvoie la valeur d\'une autre ligne.', ([v, t, l, p]) => { const m = matrice(t); const tr = m[0].map((_, j) => m.map(r => r[j])); return FONCTIONS.RECHERCHEV.f([v, tr, l, p]); });
def('RECHERCHEX', 'XLOOKUP', 'Recherche', 'RECHERCHEX(valeur_cherchée; tableau_recherche; tableau_renvoyé; [si_non_trouvé]; [mode_correspondance])', 'Recherche moderne : cherche une valeur et renvoie l\'élément correspondant.', ([v, a, b, nf, mode]) => { const x = scal(v); const l = matrice(a).flat(); const m = matrice(b); const ligne = m.length === 1; const md = mode === undefined ? 0 : num(mode); let i = -1; if (md === 0) i = l.findIndex(y => typeof x === 'string' ? critere(x)(y) : comparer(y, x) === 0); else if (md === -1) { let best = null; l.forEach((y, k) => { if (comparer(y, x) <= 0 && (best === null || comparer(y, l[best]) > 0)) best = k; }); i = best ?? -1; } else if (md === 1) { let best = null; l.forEach((y, k) => { if (comparer(y, x) >= 0 && (best === null || comparer(y, l[best]) < 0)) best = k; }); i = best ?? -1; } if (i < 0) { if (nf !== undefined && nf !== null) return nf; throw ERR.NA; } return ligne ? m[0][i] : (m[i].length === 1 ? m[i][0] : [m[i]]); });
def('INDEX', 'INDEX', 'Recherche', 'INDEX(matrice; no_ligne; [no_colonne])', 'Valeur à l\'intersection d\'une ligne et d\'une colonne.', ([t, l, c]) => { const m = matrice(t); let i = num(l ?? 0), j = c === undefined ? (m.length === 1 ? i : 1) : num(c); if (m.length === 1 && c === undefined) { j = i; i = 1; } if (i === 0) return m.map(r => [r[j - 1]]); if (j === 0) return [m[i - 1]]; if (i < 1 || i > m.length || j < 1 || j > m[0].length) throw ERR.REF; return m[i - 1][j - 1] ?? 0; });
def('EQUIV', 'MATCH', 'Recherche', 'EQUIV(valeur_cherchée; tableau; [type])', 'Position d\'une valeur dans une liste (0 pour une correspondance exacte).', ([v, t, ty]) => { const x = scal(v), l = matrice(t).flat(); const k = ty === undefined ? 1 : num(ty); if (k === 0) { const f = typeof x === 'string' ? critere(x) : (y => comparer(y, x) === 0); const i = l.findIndex(f); if (i < 0) throw ERR.NA; return i + 1; } let r = -1; for (let i = 0; i < l.length; i++) { if (l[i] == null) continue; const c = comparer(l[i], x); if (k > 0 ? c <= 0 : c >= 0) r = i; else break; } if (r < 0) throw ERR.NA; return r + 1; });
def('CHOISIR', 'CHOOSE', 'Recherche', 'CHOISIR(no_index; valeur1; [valeur2]; …)', 'Choisit une valeur dans une liste.', ([i, ...a], ev) => { const k = Math.floor(num(scal(ev(i)))); if (k < 1 || k > a.length) throw ERR.VAL; return ev(a[k - 1]); }, { paresseuse: true });
def('LIGNE', 'ROW', 'Recherche', 'LIGNE([référence])', 'Numéro de ligne.', (a, ev, ctx) => a[0] && a[0].t !== 'vide' ? (a[0].t === 'ref' ? a[0].r : a[0].r1) + 1 : ctx.ligne + 1, { paresseuse: true });
def('COLONNE', 'COLUMN', 'Recherche', 'COLONNE([référence])', 'Numéro de colonne.', (a, ev, ctx) => a[0] && a[0].t !== 'vide' ? (a[0].t === 'ref' ? a[0].c : a[0].c1) + 1 : ctx.colonne + 1, { paresseuse: true });
def('LIGNES', 'ROWS', 'Recherche', 'LIGNES(tableau)', 'Nombre de lignes.', ([t]) => estPlage(t) ? t.lignes : matrice(t).length);
def('COLONNES', 'COLUMNS', 'Recherche', 'COLONNES(tableau)', 'Nombre de colonnes.', ([t]) => estPlage(t) ? t.colonnes : matrice(t)[0].length);
def('DECALER', 'OFFSET', 'Recherche', 'DECALER(réf; lignes; colonnes; [hauteur]; [largeur])', 'Référence décalée.', ([r, l, c, h, w], ev, ctx) => { if (!estPlage(r)) throw ERR.VAL; const r1 = r.r1 + num(l), c1 = r.c1 + num(c); if (r1 < 0 || c1 < 0) throw ERR.REF; return new Plage(ctx, r.feuille, r1, c1, r1 + (h === undefined ? r.lignes : num(h)) - 1, c1 + (w === undefined ? r.colonnes : num(w)) - 1); });
def('INDIRECT', 'INDIRECT', 'Recherche', 'INDIRECT(texte_réf)', 'Référence indiquée par un texte (ex. "B2" ou "Feuil2!A1:B3").', ([t], ev, ctx) => { const s = txt(scal(t)); const m = /^(?:'?(.+?)'?!)?(.+)$/.exec(s); const p = lirePlage(m[2]); if (!p) throw ERR.REF; const f = m[1] ? ctx.feuilleNommee(m[1]) : ctx.feuille; if (f == null) throw ERR.REF; return new Plage(ctx, f, p.r1, p.c1, p.r2, p.c2); });
def('ADRESSE', 'ADDRESS', 'Recherche', 'ADRESSE(no_ligne; no_colonne; [type_abs])', 'Adresse d\'une cellule sous forme de texte.', ([l, c, t]) => { const k = t === undefined ? 1 : num(t); return adresse(num(l) - 1, num(c) - 1, k === 1 || k === 2, k === 1 || k === 3); });
def('TRANSPOSE', 'TRANSPOSE', 'Recherche', 'TRANSPOSE(tableau)', 'Transpose les lignes et les colonnes.', ([t]) => { const m = matrice(t); return m[0].map((_, j) => m.map(r => r[j])); });
def('UNIQUE', 'UNIQUE', 'Recherche', 'UNIQUE(tableau)', 'Valeurs distinctes.', ([t]) => { const vu = new Set(); const r = []; for (const l of matrice(t)) { const k = JSON.stringify(l); if (!vu.has(k)) { vu.add(k); r.push(l); } } return r; });
def('FILTRE', 'FILTER', 'Recherche', 'FILTRE(tableau; inclure; [si_vide])', 'Filtre un tableau selon une condition.', ([t, c, v]) => { const m = matrice(t), k = matrice(c).flat(); const r = m.filter((_, i) => bool(k[i])); if (!r.length) { if (v !== undefined) return v; throw ERR.NA; } return r; });
def('TRIER', 'SORT', 'Recherche', 'TRIER(tableau; [index_tri]; [ordre])', 'Trie un tableau.', ([t, i, o]) => { const k = i === undefined ? 0 : num(i) - 1, d = o === undefined ? 1 : num(o); return [...matrice(t)].sort((a, b) => d * comparer(a[k], b[k])); });
def('SEQUENCE', 'SEQUENCE', 'Recherche', 'SEQUENCE(lignes; [colonnes]; [début]; [pas])', 'Suite de nombres.', ([l, c, d, p]) => { const nl = num(l), nc = c === undefined ? 1 : num(c), s = d === undefined ? 1 : num(d), q = p === undefined ? 1 : num(p); const r = []; for (let i = 0; i < nl; i++) { const x = []; for (let j = 0; j < nc; j++) x.push(s + (i * nc + j) * q); r.push(x); } return r; });

// Informations
def('ESTVIDE', 'ISBLANK', 'Information', 'ESTVIDE(valeur)', 'VRAI si la cellule est vide.', ([v]) => { const x = scal(v); return x == null; });
def('ESTNUM', 'ISNUMBER', 'Information', 'ESTNUM(valeur)', 'VRAI si la valeur est un nombre.', ([v]) => typeof scal(v) === 'number');
def('ESTTEXTE', 'ISTEXT', 'Information', 'ESTTEXTE(valeur)', 'VRAI si la valeur est un texte.', ([v]) => typeof scal(v) === 'string');
def('ESTNONTEXTE', 'ISNONTEXT', 'Information', 'ESTNONTEXTE(valeur)', 'VRAI si la valeur n\'est pas un texte.', ([v]) => typeof scal(v) !== 'string');
def('ESTLOGIQUE', 'ISLOGICAL', 'Information', 'ESTLOGIQUE(valeur)', 'VRAI si la valeur est logique.', ([v]) => typeof scal(v) === 'boolean');
def('ESTERREUR', 'ISERROR', 'Information', 'ESTERREUR(valeur)', 'VRAI si la valeur est une erreur.', ([v], ev) => { try { return estErreur(scal(ev(v))); } catch { return true; } }, { paresseuse: true });
def('ESTERR', 'ISERR', 'Information', 'ESTERR(valeur)', 'VRAI si erreur autre que #N/A.', ([v], ev) => { let x; try { x = scal(ev(v)); } catch (e) { x = e; } return estErreur(x) && x.code !== '#N/A'; }, { paresseuse: true });
def('ESTNA', 'ISNA', 'Information', 'ESTNA(valeur)', 'VRAI si la valeur est #N/A.', ([v], ev) => { let x; try { x = scal(ev(v)); } catch (e) { x = e; } return estErreur(x) && x.code === '#N/A'; }, { paresseuse: true });
def('EST.PAIR', 'ISEVEN', 'Information', 'EST.PAIR(nombre)', 'VRAI si le nombre est pair.', ([n]) => Math.floor(Math.abs(num(n))) % 2 === 0);
def('EST.IMPAIR', 'ISODD', 'Information', 'EST.IMPAIR(nombre)', 'VRAI si le nombre est impair.', ([n]) => Math.floor(Math.abs(num(n))) % 2 === 1);
def('NA', 'NA', 'Information', 'NA()', 'Renvoie la valeur d\'erreur #N/A.', () => ERR.NA);
def('N', 'N', 'Information', 'N(valeur)', 'Convertit une valeur en nombre.', ([v]) => { const x = scal(v); return typeof x === 'number' ? x : typeof x === 'boolean' ? +x : 0; });
def('TYPE', 'TYPE', 'Information', 'TYPE(valeur)', 'Type de la valeur (1 nombre, 2 texte, 4 logique, 16 erreur, 64 matrice).', ([v], ev) => { let x; try { x = ev(v); } catch (e) { x = e; } if (estMatrice(x) || (estPlage(x) && (x.lignes > 1 || x.colonnes > 1))) return 64; x = scal(x); return estErreur(x) ? 16 : typeof x === 'string' ? 2 : typeof x === 'boolean' ? 4 : 1; }, { paresseuse: true });

// Finances
def('VPM', 'PMT', 'Finances', 'VPM(taux; npm; va; [vc]; [type])', 'Montant d\'un remboursement périodique.', ([t, n, va, vc, ty]) => { const r = num(t), np = num(n), p = num(va), f = vc === undefined ? 0 : num(vc), k = ty === undefined ? 0 : num(ty); if (!r) return -(p + f) / np; const x = Math.pow(1 + r, np); return -(r * (p * x + f)) / ((1 + r * k) * (x - 1)); });
def('VA', 'PV', 'Finances', 'VA(taux; npm; vpm; [vc]; [type])', 'Valeur actuelle d\'un investissement.', ([t, n, pm, vc, ty]) => { const r = num(t), np = num(n), p = num(pm), f = vc === undefined ? 0 : num(vc), k = ty === undefined ? 0 : num(ty); if (!r) return -(p * np + f); const x = Math.pow(1 + r, np); return -(p * (1 + r * k) * (x - 1) / r + f) / x; });
def('VC', 'FV', 'Finances', 'VC(taux; npm; vpm; [va]; [type])', 'Valeur future d\'un investissement.', ([t, n, pm, va, ty]) => { const r = num(t), np = num(n), p = num(pm), v = va === undefined ? 0 : num(va), k = ty === undefined ? 0 : num(ty); if (!r) return -(v + p * np); const x = Math.pow(1 + r, np); return -(v * x + p * (1 + r * k) * (x - 1) / r); });
def('NPM', 'NPER', 'Finances', 'NPM(taux; vpm; va; [vc]; [type])', 'Nombre de périodes de remboursement.', ([t, pm, va, vc, ty]) => { const r = num(t), p = num(pm), v = num(va), f = vc === undefined ? 0 : num(vc), k = ty === undefined ? 0 : num(ty); if (!r) return -(v + f) / p; const a = p * (1 + r * k); return Math.log((a - f * r) / (a + v * r)) / Math.log(1 + r); });
def('VAN', 'NPV', 'Finances', 'VAN(taux; valeur1; [valeur2]; …)', 'Valeur actuelle nette.', ([t, ...a]) => { const r = num(t); return nombres(a).reduce((s, v, i) => s + v / Math.pow(1 + r, i + 1), 0); });
def('TRI', 'IRR', 'Finances', 'TRI(valeurs; [estimation])', 'Taux de rendement interne.', ([v, e]) => { const l = nombres([v]); let r = e === undefined ? 0.1 : num(e); for (let i = 0; i < 100; i++) { let f = 0, d = 0; l.forEach((x, k) => { f += x / Math.pow(1 + r, k); d -= k * x / Math.pow(1 + r, k + 1); }); const n = r - f / d; if (Math.abs(n - r) < 1e-10) return n; r = n; } throw ERR.NUM; });
def('TAUX', 'RATE', 'Finances', 'TAUX(npm; vpm; va; [vc]; [type])', 'Taux d\'intérêt par période.', ([n, pm, va, vc, ty]) => { const np = num(n), p = num(pm), v = num(va), f = vc === undefined ? 0 : num(vc), k = ty === undefined ? 0 : num(ty); let r = 0.1; for (let i = 0; i < 100; i++) { const x = Math.pow(1 + r, np); const g = v * x + p * (1 + r * k) * (x - 1) / r + f; const h = (v * x + p * (1 + r * k) * (x - 1) / r + f); const r2 = r + 1e-7; const x2 = Math.pow(1 + r2, np); const g2 = v * x2 + p * (1 + r2 * k) * (x2 - 1) / r2 + f; const d = (g2 - g) / 1e-7; void h; const nr = r - g / d; if (Math.abs(nr - r) < 1e-10) return nr; r = nr; } throw ERR.NUM; });

export const FONCTIONS = {};
const EN_VERS_FR = {};
for (const d of F) { FONCTIONS[d.fr] = d; EN_VERS_FR[d.en] = d.fr; }
// alias anglais acceptés à la saisie
for (const d of F) if (!FONCTIONS[d.en]) FONCTIONS[d.en] = d;
FONCTIONS['ECARTYPE.S'] = FONCTIONS.ECARTYPE; FONCTIONS['NB.SI.ENS'] = FONCTIONS['NB.SI.ENS'];
export const LISTE_FONCTIONS = F;

// ---------- Évaluation ----------
// ctx : { feuille, ligne, colonne, valeur(f, r, c), etendue(f), feuilleNommee(nom), formater }
export function evaluer(formule, ctx) {
  const ast = compiler(formule);
  const ev = (n) => {
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'err': throw n.v;
      case 'vide': return null;
      case 'mat': return n.v;
      case 'nom': throw ERR.NOM;
      case 'ref': { const f = n.feuille ? ctx.feuilleNommee(n.feuille) : ctx.feuille; if (f == null) throw ERR.REF; return new Plage(ctx, f, n.r, n.c, n.r, n.c); }
      case 'plage': { const f = n.feuille ? ctx.feuilleNommee(n.feuille) : ctx.feuille; if (f == null) throw ERR.REF; return new Plage(ctx, f, Math.min(n.r1, n.r2), Math.min(n.c1, n.c2), Math.max(n.r1, n.r2), Math.max(n.c1, n.c2)); }
      case 'neg': return opUnaire(ev(n.a), x => -x);
      case 'pct': return opUnaire(ev(n.a), x => x / 100);
      case 'bin': return opBinaire(n.op, ev(n.a), ev(n.b));
      case 'fn': {
        const d = FONCTIONS[n.nom]; if (!d) throw ERR.NOM;
        if (d.paresseuse) return d.f(n.args, ev, ctx);
        const args = n.args.map(a => a.t === 'vide' ? null : ev(a));
        return d.f(args, ev, ctx);
      }
    }
    throw ERR.VAL;
  };
  try {
    let r = ev(ast);
    if (estPlage(r)) r = r.lignes === 1 && r.colonnes === 1 ? r.valeur(0, 0) : (ctx.ligne >= r.r1 && ctx.ligne <= r.r2 && r.colonnes === 1 ? r.valeur(ctx.ligne - r.r1, 0) : (ctx.colonne >= r.c1 && ctx.colonne <= r.c2 && r.lignes === 1 ? r.valeur(0, ctx.colonne - r.c1) : ERR.VAL));
    if (estMatrice(r)) r = r[0]?.[0] ?? null;
    if (r == null) return 0;
    if (typeof r === 'number' && !isFinite(r)) return ERR.NUM;
    return r;
  } catch (e) { if (e instanceof Erreur) return e; console.error(e); return ERR.VAL; }
}
function elementParElement(a, b, f) {
  const ma = estPlage(a) || estMatrice(a), mb = estPlage(b) || estMatrice(b);
  if (!ma && !mb) return f(a, b);
  const A = ma ? matrice(a) : null, B = mb ? matrice(b) : null;
  const L = Math.max(A ? A.length : 1, B ? B.length : 1), C = Math.max(A ? A[0].length : 1, B ? B[0].length : 1);
  const r = [];
  for (let i = 0; i < L; i++) { const l = []; for (let j = 0; j < C; j++) { const x = A ? (A[i] || A[0])[j] ?? (A[i] || A[0])[0] : a, y = B ? (B[i] || B[0])[j] ?? (B[i] || B[0])[0] : b; try { l.push(f(x, y)); } catch (e) { l.push(e); } } r.push(l); }
  return r;
}
function opUnaire(v, f) {
  if (estPlage(v) || estMatrice(v)) { if (estPlage(v) && v.lignes === 1 && v.colonnes === 1) return f(num(v.valeur(0, 0))); return matrice(v).map(l => l.map(x => { try { return f(num(x)); } catch (e) { return e; } })); }
  return f(num(v));
}
function opBinaire(op, a, b) {
  if (estPlage(a) && a.lignes === 1 && a.colonnes === 1) a = a.valeur(0, 0);
  if (estPlage(b) && b.lignes === 1 && b.colonnes === 1) b = b.valeur(0, 0);
  return elementParElement(a, b, (x, y) => {
    if (estErreur(x)) throw x; if (estErreur(y)) throw y;
    switch (op) {
      case '+': return num(x) + num(y);
      case '-': return num(x) - num(y);
      case '*': return num(x) * num(y);
      case '/': { const d = num(y); if (d === 0) throw ERR.DIV0; return num(x) / d; }
      case '^': { const r = Math.pow(num(x), num(y)); if (isNaN(r)) throw ERR.NUM; return r; }
      case '&': return txt(x) + txt(y);
      case '=': return comparer(x, y) === 0;
      case '<>': return comparer(x, y) !== 0;
      case '<': return comparer(x, y) < 0;
      case '>': return comparer(x, y) > 0;
      case '<=': return comparer(x, y) <= 0;
      case '>=': return comparer(x, y) >= 0;
    }
    throw ERR.VAL;
  });
}
export function estVolatile(formule) { return /ALEA|AUJOURDHUI|MAINTENANT|RAND|TODAY|NOW|INDIRECT|DECALER|OFFSET/i.test(formule); }

// ---------- Transformation des formules ----------
function reecrireRefs(formule, f) {
  let toks; try { toks = decouper(formule.replace(/^=/, '')); } catch { return formule; }
  return '=' + toks.map(t => t.type === 'ref' ? f(t) : (t.brut ?? (t.type === 'str' ? t.brut : t.v))).join('');
}
function prefixe(t) { return t.feuille ? (/^[A-Za-zÀ-ÿ_][\wÀ-ÿ.]*$/.test(t.feuille) ? t.feuille : `'${t.feuille.replace(/'/g, "''")}'`) + '!' : ''; }
/** Décale les références relatives (copier-coller, poignée de recopie). */
export function decalerFormule(formule, dl, dc) {
  return reecrireRefs(formule, t => {
    const dec = (ref) => {
      let m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(ref);
      if (m) { const c = m[1] ? lettreCol(m[2]) : lettreCol(m[2]) + dc, r = m[3] ? +m[4] - 1 : +m[4] - 1 + dl; if (c < 0 || r < 0) return null; return `${m[1]}${colLettre(c)}${m[3]}${r + 1}`; }
      m = /^(\$?)([A-Za-z]{1,3})$/.exec(ref); if (m) { const c = m[1] ? lettreCol(m[2]) : lettreCol(m[2]) + dc; return c < 0 ? null : m[1] + colLettre(c); }
      m = /^(\$?)(\d+)$/.exec(ref); if (m) { const r = m[1] ? +m[2] : +m[2] + dl; return r < 1 ? null : m[1] + r; }
      return ref;
    };
    const parts = t.cible.split(':').map(dec);
    if (parts.some(p => p == null)) return '#REF!';
    return prefixe(t) + parts.join(':');
  });
}
/** Ajuste les références après insertion (nb > 0) ou suppression (nb < 0) de lignes/colonnes. */
export function ajusterFormule(formule, { feuilleNom, estFeuilleCourante, axe, index, nb }) {
  return reecrireRefs(formule, t => {
    const cible = t.feuille ? t.feuille === feuilleNom : estFeuilleCourante;
    if (!cible) return t.v;
    const aj = (v) => { // v index 0-based
      if (nb > 0) return v >= index ? v + nb : v;
      const fin = index - nb - 1; // supprimées : index..fin
      if (v < index) return v; if (v > fin) return v + nb; return null;
    };
    const parts = t.cible.split(':');
    const res = parts.map((ref, k) => {
      let m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(ref);
      if (m) { let c = lettreCol(m[2]), r = +m[4] - 1; if (axe === 'c') { const n = aj(c); if (n == null) { if (parts.length === 2) c = k === 0 ? index : index - 1; else return null; } else c = n; } else { const n = aj(r); if (n == null) { if (parts.length === 2) r = k === 0 ? index : index - 1; else return null; } else r = n; } return `${m[1]}${colLettre(Math.max(0, c))}${m[3]}${Math.max(0, r) + 1}`; }
      m = /^(\$?)([A-Za-z]{1,3})$/.exec(ref); if (m) { if (axe !== 'c') return ref; const n = aj(lettreCol(m[2])); return n == null ? null : m[1] + colLettre(n); }
      m = /^(\$?)(\d+)$/.exec(ref); if (m) { if (axe !== 'r') return ref; const n = aj(+m[2] - 1); return n == null ? null : m[1] + (n + 1); }
      return ref;
    });
    if (res.some(p => p == null)) return '#REF!';
    return prefixe(t) + res.join(':');
  });
}
export function renommerFeuilleDansFormule(formule, ancien, nouveau) {
  return reecrireRefs(formule, t => t.feuille === ancien ? prefixe({ feuille: nouveau }) + t.cible : t.v);
}

// ---------- Conversion français ⇄ anglais (fichiers Excel) ----------
export function versAnglais(formule) {
  let toks; try { toks = decouper(formule.replace(/^=/, '')); } catch { return formule.replace(/^=/, ''); }
  return toks.map(t => {
    switch (t.type) {
      case 'fn': { const d = FONCTIONS[t.v.toUpperCase()]; return d ? (['STDEV.S', 'STDEV.P', 'VAR.P', 'CONCAT', 'TEXTJOIN', 'IFS', 'SWITCH', 'XOR', 'XLOOKUP', 'MAXIFS', 'MINIFS', 'IFNA', 'DAYS', 'ISOWEEKNUM', 'UNIQUE', 'FILTER', 'SORT', 'SEQUENCE'].includes(d.en) ? '_xlfn.' + d.en : d.en) : t.v; }
      case 'num': return String(t.v);
      case 'sep': return ',';
      case 'colm': return ',';
      case 'lignem': return ';';
      case 'bool': return t.v ? 'TRUE' : 'FALSE';
      case 'err': return ERR_EN[t.v] || t.v;
      case 'str': return t.brut;
      default: return t.v;
    }
  }).join('');
}
export function depuisAnglais(formule) {
  let toks; try { toks = decouper(formule.replace(/^=/, '').replace(/_xlfn\.|_xlws\./g, ''), { anglais: true }); } catch { return '=' + formule; }
  return '=' + toks.map(t => {
    switch (t.type) {
      case 'fn': return EN_VERS_FR[t.v.toUpperCase()] || t.v;
      case 'num': return t.brut.replace('.', ',');
      case 'sep': return ';';
      case 'colm': return '.';
      case 'lignem': return ';';
      case 'bool': return t.v ? 'VRAI' : 'FAUX';
      case 'err': return ERR_FR[t.v] || t.v;
      case 'str': return t.brut;
      default: return t.v;
    }
  }).join('');
}
// Formats de nombres saisis en français (TEXTE) -> codes Excel
export function formatDepuisFrancais(f) {
  return f.replace(/a/g, 'y').replace(/j/g, 'd').replace(/,/g, '\u0000').replace(/\./g, ',').replace(/\u0000/g, '.');
}
