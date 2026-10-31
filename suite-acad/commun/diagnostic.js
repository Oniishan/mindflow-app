// Suite Acad’ — diagnostic automatique d'une application (lancé par « SuiteAcad.exe --diagnostic »)
import * as F from './fichiers.js';

const attendre = ms => new Promise(r => setTimeout(r, ms));
const AVEC_DIALOGUE = new Set(['combiner', 'images']); // modèles qui demandent des fichiers

export async function lancer(doc, cfg) {
  const resultats = [];
  const note = (test, ok, detail = '') => resultats.push({ test, ok: !!ok, detail: String(detail || '') });
  const erreursToast = [];
  const obs = new MutationObserver(l => l.forEach(m => m.addedNodes.forEach(n => { if (n.classList?.contains('toast') && n.classList.contains('erreur')) erreursToast.push(n.textContent); })));
  obs.observe(document.body, { childList: true, subtree: true });
  const sep = (F.SESSION.plateforme || '').startsWith('Windows') ? '\\' : '/';
  try {
    note('Démarrage de l\'interface', !!document.querySelector('.barre-titre .nom-doc'), document.title);
    note('Ruban affiché', document.querySelectorAll('#zone-ruban .onglet-r').length > 2, document.querySelectorAll('#zone-ruban .onglet-r').length + ' onglets');
    for (const m of (cfg.modeles || [])) {
      if (AVEC_DIALOGUE.has(m.id)) continue;
      const n0 = erreursToast.length;
      try { doc.modifie = false; await doc.nouveau(m); await attendre(300); note(`Modèle « ${m.nom} »`, erreursToast.length === n0, erreursToast.slice(n0).join(' | ')); }
      catch (e) { note(`Modèle « ${m.nom} »`, false, e.message); }
    }
    const modele = (cfg.modeles || []).filter(m => !AVEC_DIALOGUE.has(m.id)).slice(-1)[0];
    for (const fmt of (cfg.formatsEnregistrement || [])) {
      try {
        doc.modifie = false; if (modele) await doc.nouveau(modele); await attendre(200);
        const octets = await fmt.ecrire(); const o = typeof octets === 'string' ? new TextEncoder().encode(octets) : octets instanceof Blob ? new Uint8Array(await octets.arrayBuffer()) : octets;
        const nom = `diagnostic-${cfg.app}.${fmt.ext}`;
        const chemin = await cheminTravail(nom, sep);
        await F.enregistrerFichier({ octets: o, chemin });
        const relu = await F.lireChemin(chemin);
        note(`Enregistrement au format .${fmt.ext}`, relu.length === o.length && o.length > 0, `${o.length} octets`);
        const n0 = erreursToast.length; doc.modifie = false;
        const ok = await doc.chargerFichier({ nom, chemin, octets: relu }, { ignorerAbandon: true });
        note(`Réouverture du fichier .${fmt.ext}`, ok && erreursToast.length === n0, erreursToast.slice(n0).join(' | '));
      } catch (e) { note(`Enregistrement au format .${fmt.ext}`, false, e.message); }
    }
    for (const x of (cfg.exports || [])) {
      if (!x.ecrire) continue;
      try { doc.modifie = false; if (modele) await doc.nouveau(modele); await attendre(200); const r = await x.ecrire(); const n = typeof r === 'string' ? r.length : r?.byteLength ?? r?.size ?? 0; note(`Export « ${x.label} »`, n > 0, `${n} octets`); }
      catch (e) { note(`Export « ${x.label} »`, false, e.message); }
    }
    try { const p = await F.lirePrefs(cfg.app); await F.ecrirePrefs(cfg.app, p); note('Lecture et écriture des préférences', true); } catch (e) { note('Lecture et écriture des préférences', false, e.message); }
    note('Impression disponible', typeof window.print === 'function');
  } catch (e) { note('Diagnostic', false, e.message); }
  doc.modifie = false;
  const corps = JSON.stringify({ app: cfg.app, resultats, erreurs: (window.__erreursAtelier || []).slice(0, 20), agent: navigator.userAgent });
  await fetch('/api/diagnostic/resultat', { method: 'POST', headers: { 'X-Suite-Jeton': F.SESSION.jeton, 'Content-Type': 'application/json' }, body: corps });
}

async function cheminTravail(nom, sep) {
  const base = F.SESSION.dossierDiagnostic;
  return base.replace(/[\\/]+$/, '') + sep + nom;
}
