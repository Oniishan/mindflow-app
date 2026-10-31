// FonctionGrist — modèle de données : tables, colonnes typées, lignes, calculs simples
export const TYPES = {
  texte: { nom: 'Texte', ico: 'type' },
  texteLong: { nom: 'Texte long', ico: 'align-left' },
  nombre: { nom: 'Nombre', ico: 'hash' },
  monetaire: { nom: 'Montant (€)', ico: 'euro' },
  date: { nom: 'Date', ico: 'calendar' },
  choix: { nom: 'Choix dans une liste', ico: 'list' },
  choixMultiple: { nom: 'Choix multiples', ico: 'list-checks' },
  case: { nom: 'Case à cocher', ico: 'square-check' },
  email: { nom: 'Adresse e-mail', ico: 'at-sign' },
  telephone: { nom: 'Téléphone', ico: 'phone' },
  lien: { nom: 'Lien internet', ico: 'link' },
  reference: { nom: 'Lien vers une autre table', ico: 'link-2' },
  note: { nom: 'Note (étoiles)', ico: 'star' },
  calcul: { nom: 'Calcul', ico: 'sigma' },
};
export const COULEURS_CHOIX = ['#DCE8FB', '#DFF2E6', '#FDECC8', '#FBE0DE', '#EAE2F8', '#DDF1F3', '#F6E2EF', '#E8E8E8', '#FFE7CC', '#E1EFD0'];
export const EMOJIS = ['📋', '🗂️', '👥', '🖥️', '📦', '📅', '🏫', '🛠️', '📝', '📊', '🎓', '📞', '🧾', '🚚', '🔑', '⭐'];

let compteur = 0;
export const uid = p => p + Date.now().toString(36) + (compteur++).toString(36) + Math.random().toString(36).slice(2, 5);

export function nouvelleBase(nom = 'Nouvelle base') { return { format: 'atelier-formulaires', type: 'base', version: 1, id: uid('b'), nom, tables: [], formulaires: [], reponsesImportees: [] }; }
export function nouvelleTable(nom = 'Table', emoji = '📋', colonnes) {
  return { id: uid('t'), nom, emoji, colonnes: colonnes || [colonne('Nom', 'texte'), colonne('Notes', 'texteLong')], lignes: [] };
}
export function colonne(nom, type = 'texte', options = {}) { return { id: uid('c'), nom, type, ...options }; }
export const table = (B, id) => B.tables.find(t => t.id === id);
export const colonneDe = (t, id) => t.colonnes.find(c => c.id === id);

// ---------- Valeurs ----------
export const estVide = v => v == null || v === '' || (Array.isArray(v) && !v.length);
const nf = (d = 2) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
export function dateFr(v) { if (!v) return ''; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v); }
export function libelleLigne(B, t, ligne) {
  if (!ligne) return '';
  const c = t.colonnes.find(c => c.type !== 'calcul' && c.type !== 'reference') || t.colonnes[0];
  if (!c) return '';
  return texteValeur(B, t, c, ligne.v[c.id], ligne) || '(sans nom)';
}
/** Texte affiché pour une valeur */
export function texteValeur(B, t, c, v, ligne) {
  if (c.type === 'calcul') v = calculer(B, t, c, ligne);
  if (estVide(v)) return '';
  switch (c.type) {
    case 'nombre': return typeof v === 'number' ? nf(c.decimales ?? 2).format(v) : String(v);
    case 'monetaire': return typeof v === 'number' ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v) : String(v);
    case 'date': return dateFr(v);
    case 'case': return v ? 'Oui' : 'Non';
    case 'choixMultiple': return (Array.isArray(v) ? v : [v]).join(', ');
    case 'note': return '★'.repeat(+v || 0);
    case 'reference': { const rt = table(B, c.refTable); const l = rt?.lignes.find(x => x.id === v); return l ? libelleLigne(B, rt, l) : ''; }
    case 'calcul': return typeof v === 'number' ? nf(c.decimales ?? 2).format(v) : v instanceof Error ? '#' + v.message : typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : String(v);
    default: return String(v);
  }
}
export function analyserNombre(s) {
  if (typeof s === 'number') return s;
  const t = String(s).replace(/[\s  €]/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t); return isNaN(n) ? NaN : n;
}
export function analyserDate(s) {
  if (!s) return '';
  s = String(s).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s); if (m) { const a = m[3].length === 2 ? '20' + m[3] : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
/** Convertit une saisie texte en valeur typée. Renvoie {v} ou {erreur} */
export function convertir(B, c, saisie) {
  const s = typeof saisie === 'string' ? saisie.trim() : saisie;
  if (estVide(s)) return { v: c.type === 'case' ? false : c.type === 'choixMultiple' ? [] : null };
  switch (c.type) {
    case 'nombre': case 'monetaire': case 'note': { const n = analyserNombre(s); if (n == null || isNaN(n)) return { erreur: 'Nombre attendu' }; if (c.type === 'note') return { v: Math.max(0, Math.min(5, Math.round(n))) }; return { v: n }; }
    case 'date': { const d = typeof s === 'string' ? analyserDate(s) : null; return d ? { v: d } : { erreur: 'Date attendue (jj/mm/aaaa)' }; }
    case 'case': return { v: typeof s === 'boolean' ? s : /^(oui|vrai|x|1|true|yes|o)$/i.test(String(s)) };
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { v: s } : { erreur: 'Adresse e-mail invalide' };
    case 'lien': return { v: /^[a-z]+:\/\//i.test(s) ? s : 'https://' + s };
    case 'choix': { const o = (c.choix || []).find(x => x.v.toLowerCase() === String(s).toLowerCase()); return o ? { v: o.v } : { v: s, nouveauChoix: true }; }
    case 'choixMultiple': { const l = (Array.isArray(s) ? s : String(s).split(/\s*[;,]\s*/)).filter(Boolean); return { v: l.map(x => (c.choix || []).find(o => o.v.toLowerCase() === x.toLowerCase())?.v || x), nouveauChoix: l.some(x => !(c.choix || []).some(o => o.v.toLowerCase() === x.toLowerCase())) }; }
    case 'reference': { const rt = table(B, c.refTable); if (!rt) return { erreur: 'Table liée introuvable' }; const l = rt.lignes.find(x => x.id === s) || rt.lignes.find(x => libelleLigne(B, rt, x).toLowerCase() === String(s).toLowerCase()); return l ? { v: l.id } : { erreur: `« ${s} » est introuvable dans ${rt.nom}` }; }
    default: return { v: String(s) };
  }
}
export function valeurBrute(B, t, c, ligne) { return c.type === 'calcul' ? calculer(B, t, c, ligne) : ligne.v[c.id]; }
/** Valeur pour l'export (tableur) */
export function valeurExport(B, t, c, ligne) {
  const v = valeurBrute(B, t, c, ligne);
  if (estVide(v)) return '';
  if (c.type === 'date') { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : v; }
  if (c.type === 'case') return !!v;
  if (c.type === 'nombre' || c.type === 'monetaire' || c.type === 'note') return typeof v === 'number' ? v : v;
  if (c.type === 'calcul') return v instanceof Error ? '#' + v.message : v;
  return texteValeur(B, t, c, v, ligne);
}

// ---------- Calculs simples ----------
// Syntaxe : [Nom de colonne], [Lien].[Colonne], opérateurs + - * / & = <> < > <= >=, fonctions françaises, séparateur « ; »
const FONCTIONS = {
  SI: (c, a, b = '') => c ? a : b, ET: (...l) => l.every(Boolean), OU: (...l) => l.some(Boolean), NON: a => !a,
  ARRONDI: (x, n = 0) => { const k = 10 ** n; return Math.round(num(x) * k) / k; }, ABS: x => Math.abs(num(x)),
  SOMME: (...l) => l.flat().reduce((a, b) => a + num(b), 0), MOYENNE: (...l) => { const f = l.flat().filter(x => !estVide(x)); return f.length ? f.reduce((a, b) => a + num(b), 0) / f.length : 0; },
  MIN: (...l) => Math.min(...l.flat().map(num)), MAX: (...l) => Math.max(...l.flat().map(num)),
  MAJUSCULE: s => String(s ?? '').toUpperCase(), MINUSCULE: s => String(s ?? '').toLowerCase(), NBCAR: s => String(s ?? '').length,
  CONCAT: (...l) => l.map(x => x ?? '').join(''), GAUCHE: (s, n = 1) => String(s ?? '').slice(0, n), DROITE: (s, n = 1) => String(s ?? '').slice(-n),
  ESTVIDE: x => estVide(x), AUJOURDHUI: () => new Date().toISOString().slice(0, 10),
  JOURS: (fin, debut) => { const a = Date.parse(fin), b = Date.parse(debut); if (isNaN(a) || isNaN(b)) throw new Error('VALEUR'); return Math.round((a - b) / 86400000); },
  ANNEE: d => +String(d).slice(0, 4), MOIS: d => +String(d).slice(5, 7), JOUR: d => +String(d).slice(8, 10),
  AJOUTERJOURS: (d, n) => { const x = new Date(Date.parse(d) + num(n) * 86400000); return x.toISOString().slice(0, 10); },
  TEXTE: x => typeof x === 'number' ? nf().format(x) : /^\d{4}-\d{2}-\d{2}$/.test(x) ? dateFr(x) : String(x ?? ''),
  NB: (...l) => l.flat().filter(x => !estVide(x)).length,
};
export const NOMS_FONCTIONS = Object.keys(FONCTIONS);
function num(x) { if (typeof x === 'number') return x; if (typeof x === 'boolean') return x ? 1 : 0; if (estVide(x)) return 0; const n = analyserNombre(x); if (n == null || isNaN(n)) throw new Error('VALEUR'); return n; }
function decouper(src) {
  const t = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '[') { const j = src.indexOf(']', i); if (j < 0) throw new Error('crochet non fermé'); t.push({ k: 'col', v: src.slice(i + 1, j).trim() }); i = j + 1; continue; }
    if (c === '"') { let j = i + 1, s = ''; while (j < src.length && !(src[j] === '"' && src[j + 1] !== '"')) { if (src[j] === '"') j++; s += src[j++]; } if (j >= src.length) throw new Error('guillemet non fermé'); t.push({ k: 'txt', v: s }); i = j + 1; continue; }
    const n = /^\d+(?:[.,]\d+)?/.exec(src.slice(i)); if (n) { t.push({ k: 'num', v: parseFloat(n[0].replace(',', '.')) }); i += n[0].length; continue; }
    const op = /^(<>|<=|>=|[-+*/&=<>();.^%])/.exec(src.slice(i)); if (op) { t.push({ k: 'op', v: op[0] }); i += op[0].length; continue; }
    const f = /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*/.exec(src.slice(i)); if (f) { t.push({ k: 'id', v: f[0].toUpperCase() }); i += f[0].length; continue; }
    throw new Error(`caractère inattendu « ${c} »`);
  }
  return t;
}
/** Compile une formule en fonction (ctx) => valeur. ctx.col(nom, chemin) */
export function compiler(src) {
  const t = decouper(String(src).replace(/^=/, '')); let p = 0;
  const voir = (v) => t[p] && t[p].k === 'op' && t[p].v === v;
  const prendre = (v) => { if (!voir(v)) throw new Error(`« ${v} » attendu`); p++; };
  const expr = () => comparaison();
  const comparaison = () => { let a = concat(); while (t[p] && t[p].k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t[p].v)) { const o = t[p++].v, b = concat(), g = a; a = ctx => { const x = g(ctx), y = b(ctx); const [u, w] = typeof x === 'number' || typeof y === 'number' ? [num(x), num(y)] : [String(x ?? '').toLowerCase(), String(y ?? '').toLowerCase()]; return { '=': u === w, '<>': u !== w, '<': u < w, '>': u > w, '<=': u <= w, '>=': u >= w }[o]; }; } return a; };
  const concat = () => { let a = somme(); while (voir('&')) { p++; const b = somme(), g = a; a = ctx => String(g(ctx) ?? '') + String(b(ctx) ?? ''); } return a; };
  const somme = () => { let a = produit(); while (voir('+') || voir('-')) { const o = t[p++].v, b = produit(), g = a; a = o === '+' ? ctx => num(g(ctx)) + num(b(ctx)) : ctx => num(g(ctx)) - num(b(ctx)); } return a; };
  const produit = () => { let a = puissance(); while (voir('*') || voir('/')) { const o = t[p++].v, b = puissance(), g = a; a = o === '*' ? ctx => num(g(ctx)) * num(b(ctx)) : ctx => { const d = num(b(ctx)); if (d === 0) throw new Error('DIV/0'); return num(g(ctx)) / d; }; } return a; };
  const puissance = () => { let a = unaire(); while (voir('^')) { p++; const b = unaire(), g = a; a = ctx => num(g(ctx)) ** num(b(ctx)); } return a; };
  const unaire = () => { if (voir('-')) { p++; const a = unaire(); return ctx => -num(a(ctx)); } if (voir('+')) { p++; return unaire(); } const a = primaire(); if (voir('%')) { p++; return ctx => num(a(ctx)) / 100; } return a; };
  const primaire = () => {
    const k = t[p]; if (!k) throw new Error('formule incomplète');
    if (k.k === 'num' || k.k === 'txt') { p++; return () => k.v; }
    if (k.k === 'col') { p++; const chemin = [k.v]; while (voir('.') && t[p + 1]?.k === 'col') { p++; chemin.push(t[p++].v); } return ctx => ctx.col(chemin); }
    if (k.k === 'id') {
      p++;
      if (k.v === 'VRAI') return () => true; if (k.v === 'FAUX') return () => false;
      const f = FONCTIONS[k.v.normalize('NFD').replace(/[̀-ͯ]/g, '')]; if (!f) throw new Error(`fonction inconnue : ${k.v}`);
      prendre('('); const args = []; if (!voir(')')) { args.push(expr()); while (voir(';')) { p++; args.push(expr()); } } prendre(')');
      if (k.v === 'SI') return ctx => args[0](ctx) ? args[1](ctx) : (args[2] ? args[2](ctx) : '');
      return ctx => f(...args.map(a => a(ctx)));
    }
    if (voir('(')) { p++; const a = expr(); prendre(')'); return a; }
    throw new Error(`« ${k.v} » inattendu`);
  };
  const r = expr(); if (p < t.length) throw new Error(`« ${t[p].v} » inattendu`);
  return r;
}
const cacheFormules = new Map();
export function calculer(B, t, c, ligne, profondeur = 0) {
  if (!c.formule) return '';
  if (profondeur > 8) return new Error('CIRC');
  let f = cacheFormules.get(c.formule);
  if (!f) { try { f = compiler(c.formule); } catch (e) { f = () => { throw new Error('FORMULE'); }; } cacheFormules.set(c.formule, f); }
  const ctx = {
    col(chemin) {
      let tb = t, l = ligne, v;
      for (let i = 0; i < chemin.length; i++) {
        const cc = tb.colonnes.find(x => x.nom.toLowerCase() === chemin[i].toLowerCase()); if (!cc) throw new Error('NOM');
        v = cc.type === 'calcul' ? calculer(B, tb, cc, l, profondeur + 1) : l?.v[cc.id];
        if (v instanceof Error) throw v;
        if (i < chemin.length - 1) { if (cc.type !== 'reference') throw new Error('NOM'); tb = table(B, cc.refTable); l = tb?.lignes.find(x => x.id === v); if (!l) return ''; }
        else if (cc.type === 'reference' && chemin.length === 1) { const rt = table(B, cc.refTable); v = libelleLigne(B, rt, rt?.lignes.find(x => x.id === v)); }
        else if (cc.type === 'case') v = !!v;
      }
      return v ?? '';
    }
  };
  try { const r = f(ctx); return typeof r === 'number' && !isFinite(r) ? new Error('NOMBRE') : r; } catch (e) { return new Error(/^[A-Z/0-9]+$/.test(e.message) ? e.message : 'VALEUR'); }
}
export function verifierFormule(src, t) {
  try { compiler(src); } catch (e) { return e.message; }
  const noms = [...String(src).matchAll(/\[([^\]]+)\]/g)].map(m => m[1].trim());
  const inconnus = noms.filter((n, i) => i === 0 || !String(src).includes(']' + '.[' + n) ? !t.colonnes.some(c => c.nom.toLowerCase() === n.toLowerCase()) : false);
  return inconnus.length ? `colonne inconnue : ${inconnus[0]}` : null;
}

// ---------- Inférence de types (import) ----------
export function deviner(valeurs) {
  const v = valeurs.filter(x => !estVide(x) && String(x).trim() !== '');
  if (!v.length) return { type: 'texte' };
  if (v.every(x => typeof x === 'boolean' || /^(oui|non|vrai|faux)$/i.test(String(x)))) return { type: 'case' };
  if (v.every(x => x instanceof Date || (typeof x === 'string' && analyserDate(x)))) return { type: 'date' };
  if (v.every(x => typeof x === 'number' || (/^-?[\d\s  ]+([.,]\d+)?\s*€?$/.test(String(x)) && !isNaN(analyserNombre(x))))) return { type: v.some(x => /€/.test(String(x))) ? 'monetaire' : 'nombre' };
  if (v.every(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x)))) return { type: 'email' };
  const distincts = [...new Set(v.map(String))];
  if (distincts.length <= Math.max(3, Math.min(12, v.length / 2)) && distincts.length < v.length && v.length >= 4 && distincts.every(d => d.length < 40)) return { type: 'choix', choix: distincts.map((x, i) => ({ v: x, c: COULEURS_CHOIX[i % COULEURS_CHOIX.length] })) };
  if (v.some(x => String(x).length > 80 || /\n/.test(String(x)))) return { type: 'texteLong' };
  return { type: 'texte' };
}
export function valeurImportee(c, x) {
  if (estVide(x)) return c.type === 'case' ? false : null;
  if (c.type === 'date') return x instanceof Date ? `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` : analyserDate(x);
  if (c.type === 'case') return typeof x === 'boolean' ? x : /^(oui|vrai)$/i.test(String(x));
  if (c.type === 'nombre' || c.type === 'monetaire') return typeof x === 'number' ? x : analyserNombre(x);
  return String(x);
}

// ---------- Modèles ----------
const ch = l => l.map((v, i) => ({ v, c: COULEURS_CHOIX[i % COULEURS_CHOIX.length] }));
const ligne = (t, valeurs) => { const l = { id: uid('l'), v: {}, cree: new Date().toISOString() }; t.colonnes.forEach((c, i) => { if (valeurs[i] !== undefined) l.v[c.id] = valeurs[i]; }); t.lignes.push(l); return l; };
export const MODELES = [
  { id: 'vierge', nom: 'Base vierge', emoji: '📄', desc: 'Une table vide à compléter.', creer() { const B = nouvelleBase('Nouvelle base'); B.tables.push(nouvelleTable('Table 1', '📋')); return B; } },
  {
    id: 'interventions', nom: 'Demandes d\'intervention', emoji: '🛠️', desc: 'Suivi des demandes par site, priorité et technicien.', creer() {
      const B = nouvelleBase('Demandes d\'intervention');
      const tech = nouvelleTable('Techniciens', '👥', [colonne('Nom', 'texte'), colonne('Courriel', 'email'), colonne('Téléphone', 'telephone')]);
      const d = nouvelleTable('Demandes', '🛠️', [colonne('Objet', 'texte', { obligatoire: true }), colonne('Date', 'date'), colonne('Site', 'choix', { choix: ch(['Rectorat', 'DSDEN 38', 'DSDEN 73', 'DSDEN 74']) }), colonne('Demandeur', 'texte'), colonne('Priorité', 'choix', { choix: [{ v: 'Basse', c: '#DFF2E6' }, { v: 'Normale', c: '#DCE8FB' }, { v: 'Haute', c: '#FDECC8' }, { v: 'Urgente', c: '#FBE0DE' }] }), colonne('Statut', 'choix', { choix: [{ v: 'Nouvelle', c: '#DCE8FB' }, { v: 'En cours', c: '#FDECC8' }, { v: 'Résolue', c: '#DFF2E6' }, { v: 'Abandonnée', c: '#E8E8E8' }] }), colonne('Technicien', 'reference', { refTable: tech.id }), colonne('Description', 'texteLong')]);
      d.colonnes.push(colonne('Délai (jours)', 'calcul', { formule: 'SI(ESTVIDE([Date]); ""; JOURS(AUJOURDHUI(); [Date]))', decimales: 0 }));
      const t1 = ligne(tech, ['Camille Martin', 'camille.martin@ac-exemple.fr', '04 76 00 00 01']), t2 = ligne(tech, ['Yanis Bernard', 'yanis.bernard@ac-exemple.fr', '04 76 00 00 02']);
      ligne(d, ['Vidéoprojecteur salle 12 sans image', '2026-10-20', 'Rectorat', 'Secrétariat général', 'Haute', 'En cours', t1.id, 'Le vidéoprojecteur s\'allume mais n\'affiche rien.']);
      ligne(d, ['Création de compte messagerie', '2026-10-22', 'DSDEN 38', 'Service RH', 'Normale', 'Résolue', t2.id, '']);
      ligne(d, ['Imprimante bloquée', '2026-10-26', 'DSDEN 73', 'Accueil', 'Basse', 'Nouvelle', null, 'Bourrage papier récurrent.']);
      B.tables.push(d, tech);
      B.formulaires.push({ id: uid('f'), titre: 'Nouvelle demande d\'intervention', description: 'Décrivez votre besoin : le service informatique vous recontactera.', table: d.id, champs: ['Objet', 'Site', 'Demandeur', 'Priorité', 'Description'].map(n => ({ col: d.colonnes.find(c => c.nom === n).id, obligatoire: n === 'Objet' || n === 'Site' })), message: 'Merci, votre demande a bien été enregistrée.', valeursParDefaut: { [d.colonnes.find(c => c.nom === 'Statut').id]: 'Nouvelle' }, dateAuto: d.colonnes.find(c => c.nom === 'Date').id });
      return B;
    }
  },
  {
    id: 'inventaire', nom: 'Inventaire du matériel', emoji: '🖥️', desc: 'Matériel, affectation, garantie et prêts.', creer() {
      const B = nouvelleBase('Inventaire du matériel');
      const m = nouvelleTable('Matériel', '🖥️', [colonne('Désignation', 'texte', { obligatoire: true }), colonne('Catégorie', 'choix', { choix: ch(['Poste fixe', 'Portable', 'Écran', 'Imprimante', 'Vidéoprojecteur', 'Réseau']) }), colonne('N° de série', 'texte'), colonne('Site', 'choix', { choix: ch(['Rectorat', 'DSDEN 38', 'DSDEN 73']) }), colonne('Date d\'achat', 'date'), colonne('Prix', 'monetaire'), colonne('Fin de garantie', 'calcul', { formule: 'SI(ESTVIDE([Date d\'achat]); ""; TEXTE(AJOUTERJOURS([Date d\'achat]; 1095)))' }), colonne('En service', 'case')]);
      ligne(m, ['Portable Latitude 5440', 'Portable', 'SN-48211', 'Rectorat', '2025-03-12', 1149, undefined, true]);
      ligne(m, ['Écran 27 pouces', 'Écran', 'SN-77120', 'DSDEN 38', '2024-09-02', 239.9, undefined, true]);
      ligne(m, ['Vidéoprojecteur EB-L260F', 'Vidéoprojecteur', 'SN-30017', 'Rectorat', '2023-01-18', 1890, undefined, false]);
      const p = nouvelleTable('Prêts', '🔑', [colonne('Matériel', 'reference', { refTable: m.id }), colonne('Emprunteur', 'texte'), colonne('Sortie', 'date'), colonne('Retour prévu', 'date'), colonne('Rendu', 'case'), colonne('Valeur', 'calcul', { formule: '[Matériel].[Prix]' })]);
      ligne(p, [m.lignes[0].id, 'Équipe de direction', '2026-10-01', '2026-11-01', false]);
      B.tables.push(m, p);
      B.formulaires.push({ id: uid('f'), titre: 'Demande de prêt de matériel', description: '', table: p.id, champs: ['Matériel', 'Emprunteur', 'Sortie', 'Retour prévu'].map(n => ({ col: p.colonnes.find(c => c.nom === n).id, obligatoire: true })), message: 'Votre demande de prêt est enregistrée.' });
      return B;
    }
  },
  {
    id: 'inscriptions', nom: 'Inscriptions à une formation', emoji: '🎓', desc: 'Collecte des inscriptions et suivi des présences.', creer() {
      const B = nouvelleBase('Inscriptions');
      const s = nouvelleTable('Sessions', '📅', [colonne('Intitulé', 'texte'), colonne('Date', 'date'), colonne('Lieu', 'texte'), colonne('Places', 'nombre', { decimales: 0 })]);
      ligne(s, ['Prise en main de l\'ENT', '2026-11-11', 'Salle 3', 12]); ligne(s, ['Sécurité numérique', '2026-11-18', 'Amphithéâtre', 40]);
      const i = nouvelleTable('Inscriptions', '🎓', [colonne('Nom', 'texte', { obligatoire: true }), colonne('Prénom', 'texte'), colonne('Courriel', 'email', { obligatoire: true }), colonne('Service', 'texte'), colonne('Session', 'reference', { refTable: s.id }), colonne('Besoins particuliers', 'texteLong'), colonne('Présent', 'case'), colonne('Satisfaction', 'note')]);
      B.tables.push(i, s);
      B.formulaires.push({ id: uid('f'), titre: 'Inscription à une formation', description: 'Merci de vous inscrire au plus tard une semaine avant la session.', table: i.id, champs: ['Nom', 'Prénom', 'Courriel', 'Service', 'Session', 'Besoins particuliers'].map(n => ({ col: i.colonnes.find(c => c.nom === n).id, obligatoire: ['Nom', 'Courriel', 'Session'].includes(n) })), message: 'Votre inscription est enregistrée. Vous recevrez une confirmation.' });
      return B;
    }
  },
];
