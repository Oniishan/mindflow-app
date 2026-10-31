// Calcul — modèle de données du classeur
export const COLS_MAX = 16384, LIGNES_MAX = 1048576;
export const cle = (r, c) => r * COLS_MAX + c;
export const deCle = k => [Math.floor(k / COLS_MAX), k % COLS_MAX];
export const LARGEUR_DEF = 88, HAUTEUR_DEF = 22;

export function nouvelleFeuille(nom) {
  return { nom, cellules: new Map(), largeurs: {}, hauteurs: {}, colMasquees: [], ligMasquees: [], fusions: [], figer: { l: 0, c: 0 }, filtre: null, validations: [], mfc: [], graphiques: [], couleurOnglet: null, quadrillage: true, entetes: true, zoom: 1, protegee: false };
}
export function nouveauClasseur() { return { feuilles: [nouvelleFeuille('Feuil1')], active: 0, cree: new Date().toISOString(), noms: {} }; }

export function etendue(f) {
  let r2 = -1, c2 = -1;
  for (const k of f.cellules.keys()) { const r = Math.floor(k / COLS_MAX), c = k % COLS_MAX; if (r > r2) r2 = r; if (c > c2) c2 = c; }
  for (const m of f.fusions) { r2 = Math.max(r2, m.r2); c2 = Math.max(c2, m.c2); }
  return { r2, c2 };
}

// ---------- Sérialisation (format interne JSON) ----------
export function serialiser(classeur) {
  const styles = [], idx = new Map();
  const sid = s => { if (!s) return undefined; const k = JSON.stringify(s); if (!idx.has(k)) { idx.set(k, styles.length); styles.push(s); } return idx.get(k); };
  return {
    version: 1, active: classeur.active, cree: classeur.cree, noms: classeur.noms || {},
    feuilles: classeur.feuilles.map(f => ({
      ...f, cellules: [...f.cellules.entries()].map(([k, c]) => { const o = { k }; if (c.v !== undefined && c.v !== null) o.v = c.v; if (c.f) o.f = c.f; if (c.s) o.s = sid(c.s); if (c.n) o.n = c.n; return o; }),
    })),
    styles,
  };
}
export function deserialiser(o) {
  const c = nouveauClasseur();
  c.active = o.active || 0; c.cree = o.cree || c.cree; c.noms = o.noms || {};
  c.feuilles = o.feuilles.map(f => {
    const n = { ...nouvelleFeuille(f.nom), ...f, cellules: new Map() };
    for (const x of f.cellules || []) { const cel = {}; if (x.v !== undefined) cel.v = x.v; if (x.f) cel.f = x.f; if (x.s !== undefined) cel.s = o.styles[x.s]; if (x.n) cel.n = x.n; n.cellules.set(x.k, cel); }
    return n;
  });
  if (!c.feuilles.length) c.feuilles = [nouvelleFeuille('Feuil1')];
  return c;
}
