// Suite Acad’ — historique des versions des documents (points de restauration)
//
// Stockage : chaque copie est conservée dans le dossier de données de l'utilisateur
// (%LOCALAPPDATA%\SuiteAcad\Recuperation\historique-<espace>-<id>.bin) via l'API de
// récupération du moteur local ; l'index est enregistré dans deux emplacements de
// préférences (A et B) écrits en alternance avec un numéro de séquence : si l'application
// s'arrête pendant l'écriture de l'un, l'autre reste lisible.
//
// Garanties :
//  - une copie n'est déclarée « vérifiée » qu'après relecture et comparaison SHA-256 ;
//  - une copie en cours d'écriture est notée dans l'index AVANT d'être écrite : après un arrêt
//    inattendu elle est contrôlée au démarrage suivant puis validée ou écartée ;
//  - la purge (durée de conservation) n'efface jamais la dernière copie saine d'un document.
import * as F from './fichiers.js';

export const RETENTION_DEFAUT = 30;            // jours
export const MAX_PAR_DOCUMENT = 100;           // au-delà, les plus anciennes sont purgées (sauf la dernière saine)
const VERSION_INDEX = 1;
const DELAI_ECRITURE_ORPHELINE = 10 * 60 * 1000; // une copie « en écriture » depuis plus de 10 min est contrôlée
const JOUR = 86400000;

// ---------- SHA-256 ----------
const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
function sha256Js(o) {
  const l = o.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n); m.set(o); m[l] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(n - 4, (l * 8) >>> 0); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
  const r = (x, k) => (x >>> k) | (x << (32 - k));
  for (let i = 0; i < n; i += 64) {
    for (let t = 0; t < 16; t++) W[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) { const a = W[t - 15], b = W[t - 2]; W[t] = (W[t - 16] + (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) + W[t - 7] + (r(b, 17) ^ r(b, 19) ^ (b >>> 10))) >>> 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map(x => x.toString(16).padStart(8, '0')).join('');
}
export async function sha256(octets) {
  octets = versOctets(octets);
  try { if (crypto?.subtle) return [...new Uint8Array(await crypto.subtle.digest('SHA-256', octets))].map(b => b.toString(16).padStart(2, '0')).join(''); } catch { }
  return sha256Js(octets);
}
export function versOctets(o) {
  if (o instanceof Uint8Array) return o;
  if (o instanceof ArrayBuffer) return new Uint8Array(o);
  if (ArrayBuffer.isView(o)) return new Uint8Array(o.buffer, o.byteOffset, o.byteLength);
  if (typeof o === 'string') return new TextEncoder().encode(o);
  throw new Error('contenu de fichier invalide');
}
export async function octetsDe(o) { return o instanceof Blob ? new Uint8Array(await o.arrayBuffer()) : versOctets(o); }

// ---------- Utilitaires ----------
const memeChemin = (a, b) => !!a && !!b && String(a).replace(/\//g, '\\').toLowerCase() === String(b).replace(/\//g, '\\').toLowerCase();
export const extensionDe = n => { const m = /\.([^.\\/]+)$/.exec(n || ''); return m ? m[1].toLowerCase() : ''; };
const nomDe = c => String(c || '').split(/[\\/]/).pop();
const nouvelId = () => new Date().toISOString().replace(/\D/g, '').slice(0, 17) + '-' + Math.random().toString(36).slice(2, 8);

/** États possibles d'une copie (affichés tels quels) */
export const ETATS = {
  verifiee: { label: 'Vérifiée', detail: 'Copie relue et identique à l\'original (SHA-256), contenu contrôlé.', sain: true },
  'verifiee-non-lisible': { label: 'Copie exacte d\'un fichier illisible', detail: 'La copie est fidèle, mais le fichier d\'origine ne s\'ouvrait déjà pas correctement.', sain: false },
  ecriture: { label: 'Écriture en cours', detail: 'Copie en cours d\'enregistrement.', sain: false },
  interrompue: { label: 'Écriture interrompue', detail: 'L\'application s\'est arrêtée pendant la copie ; elle est inutilisable.', sain: false },
  alteree: { label: 'Copie altérée', detail: 'La copie ne correspond plus à l\'empreinte enregistrée.', sain: false },
  manquante: { label: 'Copie introuvable', detail: 'Le fichier de la copie a disparu du dossier de données.', sain: false },
};

/**
 * Ouvre l'historique d'un espace (ex. « classeurs », partagé par Calcul et Dépannage).
 * verifierContenu(octets, ext) => {ok, detail} contrôle qu'un fichier est lisible (facultatif).
 */
export function ouvrirHistorique(espace, { verifierContenu } = {}) {
  const disponible = F.NATIF;
  const cleIndex = s => `historique-${espace}-${s}`;
  const cleCopie = id => `historique-${espace}-${id}`;
  let cache = null;

  async function lireEmplacement(s) {
    try { const j = await F.appelApi('/api/prefs?app=' + cleIndex(s), undefined, { methode: 'GET' }); return j && j.version === VERSION_INDEX && Array.isArray(j.entrees) ? j : null; } catch { return null; }
  }
  // marques de suppression : { id: date de suppression } (évite qu'un emplacement d'index plus ancien ne fasse réapparaître une copie supprimée)
  const marques = x => Array.isArray(x) ? Object.fromEntries(x.map(id => [id, new Date().toISOString()])) : (x && typeof x === 'object' ? x : {});
  function fusionner(a, b) {
    if (!a && !b) return null;
    if (!a || !b) { const x = a || b; return { ...x, supprimes: marques(x.supprimes) }; }
    const [rec, anc] = (a.seq || 0) >= (b.seq || 0) ? [a, b] : [b, a];
    const supprimes = { ...marques(anc.supprimes), ...marques(rec.supprimes) };
    const parId = new Map();
    for (const e of [...anc.entrees, ...rec.entrees]) {
      if (supprimes[e.id]) continue;
      const p = parId.get(e.id);
      if (!p || (e.maj || '') >= (p.maj || '')) parId.set(e.id, e);
    }
    return { ...rec, entrees: [...parId.values()], supprimes };
  }
  async function lireIndex() {
    const [a, b] = await Promise.all([lireEmplacement('a'), lireEmplacement('b')]);
    const idx = fusionner(a, b) || { version: VERSION_INDEX, seq: 0, retentionJours: RETENTION_DEFAUT, entrees: [], supprimes: {} };
    if (!idx.retentionJours) idx.retentionJours = RETENTION_DEFAUT;
    cache = idx; return idx;
  }
  /** Applique une modification à l'index en relisant l'état le plus récent (plusieurs fenêtres possibles). */
  async function modifierIndex(fn) {
    const idx = await lireIndex();
    await fn(idx);
    idx.seq = (idx.seq || 0) + 1; idx.version = VERSION_INDEX;
    // ne garder les marques de suppression que 90 jours après la suppression
    const limite = new Date(Date.now() - 90 * JOUR).toISOString();
    idx.supprimes = Object.fromEntries(Object.entries(marques(idx.supprimes)).filter(([, d]) => d >= limite).slice(-5000));
    const s = idx.seq % 2 ? 'a' : 'b';
    await F.appelApi('/api/prefs?app=' + cleIndex(s), idx);
    const relu = await lireEmplacement(s);
    if (!relu || relu.seq !== idx.seq) throw new Error('l\'index de l\'historique n\'a pas pu être enregistré');
    cache = idx; return idx;
  }
  const entreeParId = (idx, id) => idx.entrees.find(e => e.id === id);

  async function ecrireCopie(id, nom, octets) {
    const r = await fetch(`/api/recuperation/ecrire?app=${encodeURIComponent(cleCopie(id))}&nom=${encodeURIComponent(nom)}`, { method: 'POST', headers: { 'X-Suite-Jeton': F.SESSION.jeton, 'Content-Type': 'application/octet-stream' }, body: octets });
    if (!r.ok) { let m = r.statusText; try { m = (await r.json()).erreur || m; } catch { } throw new Error(m || 'écriture impossible'); }
  }
  async function lireCopieBrute(id) {
    const r = await fetch(`/api/recuperation/lire?app=${encodeURIComponent(cleCopie(id))}`, { method: 'POST', headers: { 'X-Suite-Jeton': F.SESSION.jeton, 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  }
  async function effacerCopie(id) { try { await F.appelApi(`/api/recuperation/effacer?app=${encodeURIComponent(cleCopie(id))}`, {}); } catch { } }

  async function controler(octets, ext) {
    if (!verifierContenu) return { ok: true, detail: 'contenu non contrôlé' };
    try { const v = await verifierContenu(octets, ext); return v && typeof v === 'object' ? v : { ok: !!v }; }
    catch (e) { return { ok: false, detail: e.message || String(e) }; }
  }

  /**
   * Crée un point de restauration. Renvoie l'entrée (avec .deja = true si une copie identique existait).
   * Lève une erreur si la copie n'a pas pu être écrite ET vérifiée.
   */
  async function capturer({ octets, chemin, nom, raison, origine = 'calcul', controle }) {
    if (!disponible) throw new Error('historique indisponible hors de l\'application installée');
    octets = await octetsDe(octets);
    nom = nom || nomDe(chemin) || 'Sans titre';
    const format = extensionDe(nom) || extensionDe(chemin);
    const empreinte = await sha256(octets);
    const idx = await lireIndex();
    // une copie identique et saine du même document existe déjà : inutile de la dupliquer
    const deja = idx.entrees.filter(e => memeChemin(e.chemin, chemin) && e.sha256 === empreinte && ETATS[e.etat]?.sain).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (deja && chemin) return { ...deja, deja: true };
    const ctl = controle || await controler(octets, format);
    const id = nouvelId(), date = new Date().toISOString();
    const entree = { id, chemin: chemin || null, nom, format, taille: octets.length, sha256: empreinte, date, maj: date, raison: raison || 'Point de restauration', origine, etat: 'ecriture', lisible: !!ctl.ok, controle: ctl.detail || '' };
    await modifierIndex(i => { i.entrees.push(entree); });
    let erreur = null;
    for (let essai = 0; essai < 2; essai++) {
      try {
        await ecrireCopie(id, nom, octets);
        const relu = await lireCopieBrute(id);
        if (relu && relu.length === octets.length && await sha256(relu) === empreinte) { erreur = null; break; }
        erreur = new Error('la copie relue ne correspond pas à l\'original');
      } catch (e) { erreur = e; }
    }
    if (erreur) {
      await effacerCopie(id);
      await modifierIndex(i => { i.entrees = i.entrees.filter(e => e.id !== id); i.supprimes[id] = new Date().toISOString(); }).catch(() => { });
      throw new Error('point de restauration impossible : ' + (erreur.message || erreur));
    }
    const fin = { ...entree, etat: ctl.ok ? 'verifiee' : 'verifiee-non-lisible', maj: new Date().toISOString() };
    await modifierIndex(i => { const e = entreeParId(i, id); if (e) Object.assign(e, fin); else i.entrees.push(fin); });
    purger().catch(() => { });
    return fin;
  }

  /** Lit une copie et vérifie son empreinte. */
  async function lireCopie(entree) {
    const o = await lireCopieBrute(entree.id);
    if (!o) { await marquer(entree.id, 'manquante'); throw new Error('la copie est introuvable dans le dossier de données'); }
    if (o.length !== entree.taille || await sha256(o) !== entree.sha256) { await marquer(entree.id, 'alteree'); throw new Error('la copie est altérée (empreinte différente) : elle n\'est pas utilisée'); }
    return o;
  }
  async function marquer(id, etat) { try { await modifierIndex(i => { const e = entreeParId(i, id); if (e) { e.etat = etat; e.maj = new Date().toISOString(); } }); } catch { } }

  /** Contrôle les copies restées « en écriture » (arrêt inattendu) et vérifie, si demandé, toutes les copies. */
  async function reparer({ tout = false } = {}) {
    const idx = await lireIndex();
    const maintenant = Date.now();
    const aControler = idx.entrees.filter(e => tout || (e.etat === 'ecriture' && maintenant - Date.parse(e.date) > DELAI_ECRITURE_ORPHELINE));
    const res = { controlees: 0, corrigees: 0 };
    for (const e of aControler) {
      res.controlees++;
      const o = await lireCopieBrute(e.id);
      let etat;
      if (!o) etat = e.etat === 'ecriture' ? 'interrompue' : 'manquante';
      else if (o.length === e.taille && await sha256(o) === e.sha256) etat = e.etat === 'ecriture' ? (e.lisible ? 'verifiee' : 'verifiee-non-lisible') : e.etat;
      else etat = e.etat === 'ecriture' ? 'interrompue' : 'alteree';
      if (etat !== e.etat) { res.corrigees++; await marquer(e.id, etat); }
    }
    return res;
  }

  /** Copies triées de la plus récente à la plus ancienne, avec indicateurs calculés. */
  async function lister({ chemin } = {}) {
    const idx = await lireIndex();
    const retention = idx.retentionJours || RETENTION_DEFAUT;
    const derniereSaine = new Map();
    for (const e of [...idx.entrees].sort((a, b) => b.date.localeCompare(a.date))) {
      const k = (e.chemin || e.nom).toLowerCase();
      if (ETATS[e.etat]?.sain && !derniereSaine.has(k)) derniereSaine.set(k, e.id);
    }
    return idx.entrees
      .filter(e => !chemin || memeChemin(e.chemin, chemin))
      .map(e => ({ ...e, derniereSaine: derniereSaine.get((e.chemin || e.nom).toLowerCase()) === e.id, expiree: Date.now() - Date.parse(e.date) > retention * JOUR }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Supprime les copies plus anciennes que la durée de conservation et l'excédent par document.
   * Ne supprime JAMAIS la dernière copie saine d'un document. Renvoie {supprimees, conservees}.
   */
  async function purger() {
    await reparer(); // les copies restées « en écriture » après un arrêt sont d'abord contrôlées
    const l = await lister();
    const idx = cache;
    const retention = idx.retentionJours || RETENTION_DEFAUT;
    const parDoc = new Map();
    for (const e of l) { const k = (e.chemin || e.nom).toLowerCase(); if (!parDoc.has(k)) parDoc.set(k, []); parDoc.get(k).push(e); }
    const aSupprimer = [];
    let conservees = 0;
    for (const liste of parDoc.values()) {
      liste.forEach((e, rang) => {
        if (e.etat === 'ecriture') return;
        const tropVieille = Date.now() - Date.parse(e.date) > retention * JOUR;
        const enTrop = rang >= MAX_PAR_DOCUMENT;
        if (!(tropVieille || enTrop || e.etat === 'interrompue' || e.etat === 'manquante')) return;
        if (e.derniereSaine) { conservees++; return; } // jamais la dernière copie saine
        aSupprimer.push(e);
      });
    }
    if (!aSupprimer.length) return { supprimees: 0, conservees };
    // retirer de l'index d'abord (une copie orpheline n'est qu'un fichier inutile), puis effacer les fichiers
    const ids = new Set(aSupprimer.map(e => e.id));
    await modifierIndex(i => { i.entrees = i.entrees.filter(e => !ids.has(e.id)); const d = new Date().toISOString(); for (const id of ids) i.supprimes[id] = d; });
    for (const id of ids) await effacerCopie(id);
    return { supprimees: ids.size, conservees };
  }

  async function definirRetention(jours) {
    jours = Math.max(1, Math.min(3650, Math.round(+jours || RETENTION_DEFAUT)));
    await modifierIndex(i => { i.retentionJours = jours; });
    return purger();
  }
  async function retention() { return (await lireIndex()).retentionJours || RETENTION_DEFAUT; }

  /** Suppression manuelle d'une copie (refusée pour la dernière copie saine sauf si forcer). */
  async function supprimer(entree, { forcer = false } = {}) {
    const l = await lister();
    const e = l.find(x => x.id === entree.id); if (!e) return false;
    if (e.derniereSaine && !forcer) throw new Error('c\'est la dernière copie saine de ce document : elle n\'est pas supprimée');
    await modifierIndex(i => { i.entrees = i.entrees.filter(x => x.id !== e.id); i.supprimes[e.id] = new Date().toISOString(); });
    await effacerCopie(e.id);
    return true;
  }

  return { disponible, espace, capturer, lireCopie, lister, purger, reparer, definirRetention, retention, supprimer, lireIndex, controler };
}
