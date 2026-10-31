// Priorité 1 — Historique et récupération des classeurs dans Calcul (vrai moteur + vraie interface)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { suite, verifier, bilan, lancer, arreter, attendre, sha256Fichier, versWin, DONNEES, ESSAI } from './outils.mjs';

suite('P1 historique Calcul');
// état initial propre
fs.rmSync(ESSAI, { recursive: true, force: true }); fs.mkdirSync(ESSAI, { recursive: true });
for (const d of ['Recuperation', 'preferences']) for (const f of fs.existsSync(path.join(DONNEES, d)) ? fs.readdirSync(path.join(DONNEES, d)) : []) if (f.startsWith('historique-classeurs')) fs.rmSync(path.join(DONNEES, d, f));
const FICHIER = path.join(ESSAI, 'Budget 2026.xlsx');
const copiesSurDisque = () => fs.readdirSync(path.join(DONNEES, 'Recuperation')).filter(f => f.startsWith('historique-classeurs-') && f.endsWith('.bin'));

async function saisirEtEnregistrer(page, texte, nombre) {
  return page.evaluate(async ([t, n, chemin]) => {
    const K = window.__calcul; K.avant(); K.ecrire(0, 0, t); K.ecrire(1, 0, String(n)); K.ecrire(2, 0, '=A2*2'); K.apresModif();
    const d = K.doc; if (!d.chemin) { d.chemin = chemin; d.nom = chemin.split('\\').pop(); d.format = 'xlsx'; }
    const ok = await d.enregistrer(); return { ok, modifie: d.modifie };
  }, [texte, nombre, versWin(FICHIER)]);
}
const lireA1 = page => page.evaluate(() => { const K = window.__calcul; return String(K.valeur(K.C().active, 0, 0) ?? ''); });
const historique = page => page.evaluate(() => window.__calcul.doc.historique.lister());
const toasts = page => page.$$eval('.toast', l => l.map(t => t.className + ' : ' + t.textContent));

let ctx = await lancer('calcul');
let { page } = ctx;
try {
  await page.waitForFunction(() => window.__calcul?.doc?.historique, null, { timeout: 15000 });
  verifier('Historique actif dans Calcul installé', true);
  await page.keyboard.press('Escape');

  // 1. Premier enregistrement
  let r = await saisirEtEnregistrer(page, 'Version 1', 100);
  const sha1 = sha256Fichier(FICHIER);
  let h = await historique(page);
  verifier('Enregistrement v1 écrit et relu', r.ok && !r.modifie && fs.existsSync(FICHIER), JSON.stringify(r));
  verifier('Copie « Enregistrement » vérifiée dans l\'historique', h.length === 1 && h[0].etat === 'verifiee' && h[0].sha256 === sha1, h.map(e => e.raison + '/' + e.etat).join(', '));

  // 2. Deuxième enregistrement : la version précédente est déjà dans l'historique (dédoublonnée)
  await attendre(1100);
  r = await saisirEtEnregistrer(page, 'Version 2', 200);
  const sha2 = sha256Fichier(FICHIER);
  h = await historique(page);
  verifier('Enregistrement v2 sur le même fichier', r.ok && sha2 !== sha1);
  verifier('Historique contient v1 et v2, vérifiées', h.length === 2 && h.every(e => e.etat === 'verifiee') && h.some(e => e.sha256 === sha1) && h.some(e => e.sha256 === sha2), h.map(e => e.raison).join(', '));
  verifier('Copies physiquement présentes dans le dossier de données', copiesSurDisque().length === 2, copiesSurDisque().join(', '));

  // 3. Échec d'écriture réel (fichier verrouillé au niveau du système de fichiers)
  execFileSync('chattr', ['+i', FICHIER]);
  try {
    r = await saisirEtEnregistrer(page, 'Version 3 (échec réel)', 300);
    const t = await toasts(page);
    verifier('Écriture refusée par le disque : échec signalé, document reste « modifié »', !r.ok && r.modifie, t.filter(x => x.includes('erreur')).slice(-1)[0] || 'aucune erreur affichée');
    verifier('Fichier sur le disque intact (toujours v2)', sha256Fichier(FICHIER) === sha2);
  } finally { execFileSync('chattr', ['-i', FICHIER]); }
  const tmp = fs.readdirSync(ESSAI).filter(f => f.includes('atelier-tmp'));
  verifier('Pas de fichier temporaire laissé à côté du classeur', tmp.length === 0, tmp.join(', '));

  // 4. Échec d'écriture simulé : le moteur répond « disque plein »
  await page.route('**/api/fichier/ecrire*', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ erreur: 'espace disque insuffisant (simulé)' }) }));
  r = await saisirEtEnregistrer(page, 'Version 3 (disque plein)', 300);
  await page.unroute('**/api/fichier/ecrire*');
  verifier('Échec simulé « disque plein » : signalé, fichier intact', !r.ok && r.modifie && sha256Fichier(FICHIER) === sha2);

  // 5. Écriture corrompue (fichier tronqué pendant l'écriture) : détectée par la relecture
  await page.route('**/api/fichier/ecrire*', async route => { const b = route.request().postDataBuffer(); await route.continue({ postData: b.subarray(0, Math.floor(b.length / 2)) }); });
  r = await saisirEtEnregistrer(page, 'Version 3 (corrompue)', 300);
  await page.unroute('**/api/fichier/ecrire*');
  const t5 = (await toasts(page)).filter(x => x.includes('erreur')).slice(-1)[0] || '';
  verifier('Écriture tronquée détectée par relecture SHA-256', !r.ok && /ne correspond pas/.test(t5), t5);
  h = await historique(page);
  const saineV2 = h.find(e => e.sha256 === sha2 && e.etat === 'verifiee');
  verifier('La dernière version saine (v2) reste dans l\'historique', !!saineV2 && saineV2.derniereSaine);

  // 6. Restauration par l'interface : ouvrir l'historique, « Restaurer… » sur v2, confirmer
  await page.click('.barre-titre [data-a="historique"]');
  await page.waitForSelector('.tab-hist tbody tr');
  const nLignes = await page.$$eval('.tab-hist tbody tr', l => l.length);
  const entetes = await page.$$eval('.tab-hist th', l => l.map(x => x.textContent));
  verifier('Historique affiché dans Calcul (date, document, format, taille, origine, état)', nLignes >= 2 && ['Date', 'Document', 'Format', 'Taille', 'Origine', 'État'].every(x => entetes.includes(x)), `${nLignes} lignes`);
  const corrompuAvant = sha256Fichier(FICHIER);
  await page.click(`.tab-hist tr[data-id="${saineV2.id}"] [data-r]`);            // action 1 : choisir la version
  await page.waitForSelector('.dialogue [data-id="remplacer"]');
  const texteDialogue = await page.textContent('.dialogue');
  await page.click('.dialogue [data-id="remplacer"]');                             // action 2 : confirmer
  await page.waitForFunction(() => !document.querySelector('.coulisses'), null, { timeout: 15000 });
  await attendre(500);
  verifier('Restauration en deux actions : fichier redevenu v2', sha256Fichier(FICHIER) === sha2, texteDialogue.slice(0, 160));
  verifier('Calcul affiche le contenu restauré', (await lireA1(page)) === 'Version 2', await lireA1(page));
  h = await historique(page);
  const sauveAvant = h.find(e => e.sha256 === corrompuAvant && e.raison === 'Avant restauration');
  const sauveModifs = h.find(e => e.raison.startsWith('Modifications non enregistrées'));
  verifier('Le fichier remplacé a été sauvegardé avant restauration', !!sauveAvant, sauveAvant ? `${sauveAvant.raison} — ${sauveAvant.etat}` : h.map(e => e.raison).join(', '));
  verifier('Les modifications non enregistrées ont été sauvegardées', !!sauveModifs && sauveModifs.etat === 'verifiee');
  verifier('Le fichier tronqué est marqué comme copie exacte d\'un fichier illisible', sauveAvant?.etat === 'verifiee-non-lisible');

  // 7. Restauration sous un nouveau nom (v1), via l'API du document (le dialogue Windows n'existe pas sous Wine)
  const v1 = h.find(e => e.sha256 === sha1);
  const NOUVEAU = path.join(ESSAI, 'Budget 2026 (restauré).xlsx');
  await page.evaluate(([chemin]) => { window.__testChemin = chemin; }, [versWin(NOUVEAU)]);
  await page.route('**/api/fichier/choisir-enregistrement', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chemin: versWin(NOUVEAU) }) }));
  const okNouveau = await page.evaluate(id => window.__calcul.doc.historique.lister().then(l => window.__calcul.doc.restaurerVersion(l.find(e => e.id === id), 'nouveau')), v1.id);
  await page.unroute('**/api/fichier/choisir-enregistrement');
  verifier('Restauration de v1 sous un nouveau nom', okNouveau && fs.existsSync(NOUVEAU) && sha256Fichier(NOUVEAU) === sha1 && sha256Fichier(FICHIER) === sha2);

  // 8. Fichier supprimé dans l'Explorateur : l'historique permet de le recréer
  fs.rmSync(FICHIER);
  const okRecree = await page.evaluate(sha => window.__calcul.doc.historique.lister().then(l => window.__calcul.doc.restaurerVersion(l.find(e => e.sha256 === sha && e.chemin.endsWith('Budget 2026.xlsx')), 'remplacer')), sha2);
  verifier('Fichier supprimé hors application : recréé depuis l\'historique', okRecree && fs.existsSync(FICHIER) && sha256Fichier(FICHIER) === sha2);
} catch (e) { verifier('Exécution du scénario', false, e.stack); }
const nAvantRedemarrage = (await historique(page).catch(() => [])).length;
await arreter(ctx);

// 9. Redémarrage : l'historique est relu, les copies sont intactes et restaurables
ctx = await lancer('calcul'); page = ctx.page;
try {
  await page.waitForFunction(() => window.__calcul?.doc?.historique, null, { timeout: 15000 });
  let h = await historique(page);
  verifier('Après redémarrage : historique relu intégralement', h.length === nAvantRedemarrage && nAvantRedemarrage > 0, `${h.length}/${nAvantRedemarrage}`);
  const ctl = await page.evaluate(() => window.__calcul.doc.historique.reparer({ tout: true }));
  verifier('Après redémarrage : toutes les copies relues et conformes', ctl.corrigees === 0, JSON.stringify(ctl));
  const v1 = h.find(e => e.etat === 'verifiee' && e.chemin?.endsWith('Budget 2026.xlsx') && e.raison === 'Enregistrement' && h.indexOf(e) === h.map(x => x.raison).lastIndexOf('Enregistrement'));
  const ouvert = await page.evaluate(async chemin => window.__calcul.doc.ouvrirChemin(chemin, true), versWin(FICHIER));
  const okR = await page.evaluate(id => window.__calcul.doc.historique.lister().then(l => window.__calcul.doc.restaurerVersion(l.find(e => e.id === id), 'remplacer')), v1.id);
  verifier('Après redémarrage : restauration réelle', ouvert && okR && sha256Fichier(FICHIER) === v1.sha256 && (await lireA1(page)) === 'Version 1', await lireA1(page));

  // 10. Arrêt inattendu pendant une copie : entrée « en écriture » sans fichier, et une autre dont la copie est complète
  const res = await page.evaluate(async () => {
    const api = (c, b, m = 'POST') => fetch(c, { method: m, headers: { 'X-Suite-Jeton': window.ATELIER.jeton, 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : JSON.stringify(b) }).then(r => r.json());
    const a = await api('/api/prefs?app=historique-classeurs-a', null, 'GET'), b = await api('/api/prefs?app=historique-classeurs-b', null, 'GET');
    const idx = (a?.seq || 0) >= (b?.seq || 0) ? a : b;
    const vieux = new Date(Date.now() - 20 * 60000).toISOString();
    const octets = new TextEncoder().encode('copie complète');
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', octets))].map(x => x.toString(16).padStart(2, '0')).join('');
    idx.entrees.push({ id: '20260101000000000-crash1', chemin: 'Z:\\tmp\\x\\crash.xlsx', nom: 'crash.xlsx', format: 'xlsx', taille: 99, sha256: 'x', date: vieux, maj: vieux, raison: 'Avant enregistrement', origine: 'calcul', etat: 'ecriture', lisible: true });
    idx.entrees.push({ id: '20260101000000000-crash2', chemin: 'Z:\\tmp\\x\\ok.xlsx', nom: 'ok.xlsx', format: 'xlsx', taille: octets.length, sha256: sha, date: vieux, maj: vieux, raison: 'Avant enregistrement', origine: 'calcul', etat: 'ecriture', lisible: true });
    await fetch('/api/recuperation/ecrire?app=historique-classeurs-20260101000000000-crash2&nom=ok.xlsx', { method: 'POST', headers: { 'X-Suite-Jeton': window.ATELIER.jeton }, body: octets });
    idx.seq++; await api('/api/prefs?app=historique-classeurs-' + (idx.seq % 2 ? 'a' : 'b'), idx);
    const H = window.__calcul.doc.historique; const r = await H.reparer(); const l = await H.lister();
    return { r, e1: l.find(e => e.id.endsWith('crash1'))?.etat, e2: l.find(e => e.id.endsWith('crash2'))?.etat };
  });
  verifier('Copie interrompue par un arrêt : détectée au démarrage', res.e1 === 'interrompue', JSON.stringify(res));
  verifier('Copie complète restée « en écriture » : validée par relecture', res.e2 === 'verifiee');

  // 11. Index à moitié écrit (arrêt pendant l'enregistrement de l'index) : l'autre emplacement prend le relais
  const ix = await page.evaluate(async () => {
    const H = window.__calcul.doc.historique; const avant = (await H.lister()).length;
    const idx = await H.lireIndex(); const s = idx.seq % 2 ? 'a' : 'b';
    await fetch('/api/prefs?app=historique-classeurs-' + s, { method: 'POST', headers: { 'X-Suite-Jeton': window.ATELIER.jeton, 'Content-Type': 'application/json' }, body: '{"version":1,"seq":' + (idx.seq + 5) + ',"entrees":"tronq' });
    return { avant, apres: (await H.lister()).length };
  });
  verifier('Index corrompu : l\'historique reste lisible grâce au second emplacement', ix.apres >= ix.avant - 3 && ix.apres > 0, JSON.stringify(ix));

  // 12. Conservation / purge : on vieillit artificiellement les copies de 40 jours
  const pu = await page.evaluate(async () => {
    const H = window.__calcul.doc.historique;
    const idx = await H.lireIndex();
    const vieux = new Date(Date.now() - 40 * 86400000).toISOString();
    idx.entrees.forEach(e => { e.date = vieux; e.maj = new Date().toISOString(); });
    idx.seq++; await fetch('/api/prefs?app=historique-classeurs-' + (idx.seq % 2 ? 'a' : 'b'), { method: 'POST', headers: { 'X-Suite-Jeton': window.ATELIER.jeton, 'Content-Type': 'application/json' }, body: JSON.stringify(idx) });
    const avant = await H.lister(); const docs = new Set(avant.filter(e => e.derniereSaine).map(e => e.chemin));
    const r = await H.definirRetention(30); const apres = await H.lister();
    return { r, avant: avant.length, apres: apres.length, docs: [...docs], restants: apres.map(e => ({ chemin: e.chemin, saine: e.derniereSaine, expiree: e.expiree, etat: e.etat })) };
  });
  verifier('Purge à 30 jours : copies expirées supprimées', pu.r.supprimees > 0 && pu.apres < pu.avant, `${pu.avant} → ${pu.apres}`);
  verifier('Purge : la dernière copie saine de chaque classeur est conservée', pu.docs.every(c => pu.restants.some(e => e.chemin === c && e.saine)) && pu.restants.every(e => e.saine), JSON.stringify(pu.restants));
  const bins = copiesSurDisque();
  verifier('Purge : fichiers de copie effectivement effacés du disque', bins.length === pu.apres, `${bins.length} fichiers pour ${pu.apres} entrées`);
  // la durée choisie est mémorisée
  verifier('Durée de conservation configurable et mémorisée', (await page.evaluate(() => window.__calcul.doc.historique.definirRetention(90).then(() => window.__calcul.doc.historique.retention()))) === 90);
  await page.evaluate(() => window.__calcul.doc.historique.definirRetention(30));
  verifier('Aucune erreur JavaScript dans Calcul', ctx.erreurs.length === 0, ctx.erreurs.slice(0, 3).join(' | '));
  await page.click('.barre-titre [data-a="historique"]');
  await page.waitForSelector('.tab-hist tbody tr'); await attendre(800);
  fs.mkdirSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'resultats'), { recursive: true });
  await page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), 'resultats', 'p1-historique.png') });
} catch (e) { verifier('Exécution du scénario après redémarrage', false, e.stack); }
await arreter(ctx);
process.exit(bilan() ? 0 : 1);
