// Suite Acad’ — accès aux fichiers et au poste (pont vers le moteur local)
import { telechargerBlob } from './ui.js';

export const SESSION = window.ATELIER || null;
if (SESSION && SESSION.diagnostic && !window.__erreursAtelier) { window.__erreursAtelier = []; addEventListener('error', e => window.__erreursAtelier.push(String(e.message || e.error || e))); addEventListener('unhandledrejection', e => window.__erreursAtelier.push(String(e.reason?.message || e.reason))); }
export const NATIF = !!(SESSION && SESSION.jeton);
if (NATIF && !window.__journalErreurs) {
  window.__journalErreurs = 0;
  const signaler = (message, source) => { if (window.__journalErreurs++ > 20) return; try { fetch('/api/erreur', { method: 'POST', headers: { 'X-Suite-Jeton': SESSION.jeton, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: String(message || ''), source: String(source || '') }) }).catch(() => { }); } catch { } };
  addEventListener('error', e => { const t = e.target; if (t && t !== window && (t.src || t.href)) signaler('ressource introuvable', t.src || t.href); else signaler(e.message || e.error, (e.filename || '') + ':' + (e.lineno || '')); }, true);
  addEventListener('unhandledrejection', e => signaler(e.reason && (e.reason.stack || e.reason.message) || e.reason, 'promesse'));
}
// signaler au poste que l'interface est construite (contrôle de l'affichage)
if (NATIF && !window.__renduSignale) {
  window.__renduSignale = true;
  const pret = () => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => { fetch('/api/rendu/pret', { method: 'POST', headers: { 'X-Suite-Jeton': SESSION.jeton, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => { }); })), 700);
  if (document.readyState === 'complete') pret(); else addEventListener('load', pret, { once: true });
}

async function api(chemin, corps, { brut = false, methode = 'POST', binaire } = {}) {
  const opts = { method: methode, headers: { 'X-Suite-Jeton': SESSION.jeton } };
  if (binaire !== undefined) { opts.body = binaire; opts.headers['Content-Type'] = 'application/octet-stream'; }
  else if (corps !== undefined) { opts.body = JSON.stringify(corps); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(chemin, opts);
  if (!r.ok) {
    let m = r.statusText; try { const j = await r.json(); m = j.erreur || m; } catch { }
    throw new Error(m);
  }
  if (brut) return new Uint8Array(await r.arrayBuffer());
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
export { api as appelApi };

function accepte(filtres) {
  return (filtres || []).flatMap(f => f.ext).filter(e => e !== '*').map(e => '.' + e).join(',');
}

/** Ouvre un ou plusieurs fichiers. Renvoie [{nom, chemin, octets}] ou null. */
export async function ouvrirFichiers({ titre = 'Ouvrir', filtres = [], multiple = false } = {}) {
  if (NATIF) {
    const r = await api('/api/fichier/ouvrir', { titre, filtres, multiple });
    if (!r || r.annule || !r.fichiers?.length) return null;
    const res = [];
    for (const f of r.fichiers) res.push({ nom: f.nom, chemin: f.chemin, octets: await lireChemin(f.chemin) });
    return res;
  }
  return new Promise(resolve => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accepte(filtres); i.multiple = multiple;
    i.style.display = 'none'; document.body.appendChild(i);
    i.onchange = async () => {
      const res = [];
      for (const f of i.files) res.push({ nom: f.name, chemin: null, octets: new Uint8Array(await f.arrayBuffer()) });
      i.remove(); resolve(res.length ? res : null);
    };
    i.addEventListener('cancel', () => { i.remove(); resolve(null); });
    i.click();
  });
}
export async function ouvrirFichier(o = {}) { const r = await ouvrirFichiers({ ...o, multiple: false }); return r ? r[0] : null; }

export async function lireChemin(chemin) {
  if (!NATIF) throw new Error('Lecture directe indisponible');
  return api('/api/fichier/lire', { chemin }, { brut: true });
}

/** Enregistre des octets. Si chemin est fourni, écrit directement ; sinon demande l'emplacement. Renvoie {chemin, nom} ou null. */
export async function enregistrerFichier({ octets, nomSuggere = 'Sans titre', chemin = null, filtres = [], titre = 'Enregistrer sous' }) {
  if (octets instanceof Blob) octets = new Uint8Array(await octets.arrayBuffer());
  if (typeof octets === 'string') octets = new TextEncoder().encode(octets);
  if (NATIF) {
    if (!chemin) {
      const r = await api('/api/fichier/choisir-enregistrement', { nomSuggere, filtres, titre });
      if (!r || r.annule) return null;
      chemin = r.chemin;
    }
    await api('/api/fichier/ecrire?chemin=' + encodeURIComponent(chemin), undefined, { binaire: octets });
    return { chemin, nom: chemin.split(/[\\/]/).pop() };
  }
  const ext = filtres[0]?.ext?.[0];
  let nom = nomSuggere; if (ext && !nom.toLowerCase().endsWith('.' + ext)) nom += '.' + ext;
  telechargerBlob(new Blob([octets]), nom);
  return { chemin: null, nom };
}

export async function choisirDossier(titre = 'Choisir un dossier') {
  if (!NATIF) return null;
  const r = await api('/api/dossier/choisir', { titre });
  return r && !r.annule ? r.chemin : null;
}
export async function listerDossier(dossier, ext) {
  if (!NATIF) return [];
  return api('/api/dossier/lister', { dossier, ext });
}
export async function fichierExiste(chemin) {
  if (!NATIF || !chemin) return false;
  const r = await api('/api/fichier/existe', { chemin }); return !!r.existe;
}

// ---------- Récents et préférences ----------
const cleLocale = (t, app) => `atelier.${t}.${app}`;
export async function recents(app) {
  if (NATIF) { try { return await api('/api/recents?app=' + app, undefined, { methode: 'GET' }); } catch { return []; } }
  try { return JSON.parse(localStorage.getItem(cleLocale('recents', app)) || '[]'); } catch { return []; }
}
export async function ajouterRecent(app, chemin, nom) {
  if (!chemin || (SESSION && SESSION.diagnostic)) return;
  if (NATIF) { try { await api('/api/recents', { app, chemin, nom }); } catch { } return; }
  try {
    let l = JSON.parse(localStorage.getItem(cleLocale('recents', app)) || '[]').filter(r => r.chemin !== chemin);
    l.unshift({ chemin, nom, date: new Date().toISOString() }); localStorage.setItem(cleLocale('recents', app), JSON.stringify(l.slice(0, 20)));
  } catch { }
}
export async function retirerRecent(app, chemin) {
  if (NATIF) { try { await api('/api/recents/retirer', { app, chemin }); } catch { } }
}
export async function lirePrefs(app) {
  if (NATIF) { try { return (await api('/api/prefs?app=' + app, undefined, { methode: 'GET' })) || {}; } catch { return {}; } }
  try { return JSON.parse(localStorage.getItem(cleLocale('prefs', app)) || '{}'); } catch { return {}; }
}
export async function ecrirePrefs(app, prefs) {
  if (NATIF) { try { await api('/api/prefs?app=' + app, prefs); } catch { } return; }
  try { localStorage.setItem(cleLocale('prefs', app), JSON.stringify(prefs)); } catch { }
}

// ---------- Fenêtre et poste ----------
export function definirTitre(t) {
  document.title = t;
  if (NATIF) api('/api/fenetre/titre', { titre: t }).catch(() => { });
}
export function ouvrirLien(url) {
  if (NATIF) return api('/api/ouvrir-lien', { url });
  window.open(url, '_blank', 'noopener');
}
export function afficherDansExplorateur(chemin) {
  if (NATIF) return api('/api/explorer', { chemin });
}
export function fermerFenetre() {
  if (NATIF) return api('/api/fenetre/fermer', {});
  window.close();
}
