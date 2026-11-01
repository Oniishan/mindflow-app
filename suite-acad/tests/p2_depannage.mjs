// Priorité 2 — Dépannage de Calcul et des classeurs (vrai moteur + vraie interface)
import fs from 'node:fs';
import path from 'node:path';
import { suite, verifier, bilan, lancer, arreter, attendre, sha256Fichier, versWin, ICI } from './outils.mjs';

suite('P2 depannage');
const DIR = '/tmp/essai-depannage';
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
for (const f of fs.readdirSync(path.join(ICI, 'fichiers'))) fs.copyFileSync(path.join(ICI, 'fichiers', f), path.join(DIR, f));
fs.writeFileSync(path.join(DIR, '~$simple.xlsx'), 'utilisateur ');
const W = n => versWin(path.join(DIR, n));
const sha = n => sha256Fichier(path.join(DIR, n));
const avant = Object.fromEntries(fs.readdirSync(DIR).map(n => [n, sha(n)]));

const ctx = await lancer('depannage');
const { page } = ctx;
const appels = [];
page.on('request', r => { if (r.url().includes('/api/depannage/')) appels.push({ url: r.url().replace(/^.*\/api\/depannage\//, ''), corps: r.postData() }); });
const rapport = () => page.textContent('#resultat-auto');
try {
  await page.waitForFunction(() => window.__depannage);
  verifier('Titre « Dépannage de Calcul et des classeurs »', (await page.textContent('#titre-auto')).includes('Dépannage de Calcul et des classeurs'));
  verifier('Interventions Excel/Windows séparées et repliées par défaut', !(await page.$eval('#bloc-poste', d => d.open)) && (await page.textContent('#bloc-poste summary')).includes('Interventions facultatives sur Excel et Windows'));

  // 1. Diagnostic non destructif
  await page.evaluate(ch => window.__depannage.ajouter(ch), ['simple.xlsx', 'styles.xlsx', 'protege.xlsx', 'endommage.xlsx', 'macros.xlsm'].map(W));
  await page.waitForFunction(() => window.__depannage.S.fichiers.length === 5 && window.__depannage.S.fichiers.every(f => !f.attente && f.calcul), null, { timeout: 30000 });
  const inchanges = Object.entries(avant).every(([n, s]) => fs.existsSync(path.join(DIR, n)) && sha(n) === s);
  verifier('Diagnostic sans aucune modification des fichiers (empreintes identiques, verrou conservé)', inchanges);
  verifier('Le diagnostic n\'a déclenché aucune correction', !appels.some(a => a.url.startsWith('corriger') || a.url.startsWith('poste/corriger')));
  const S = await page.evaluate(() => window.__depannage.S.fichiers.map(f => ({ nom: f.nom, lisible: f.calcul.lisible, points: f.calcul.points.map(p => p.code), pb: f.problemes.map(p => p.code) })));
  const parNom = Object.fromEntries(S.map(f => [f.nom, f]));
  verifier('Contrôle Calcul : classeur endommagé détecté comme illisible', parNom['endommage.xlsx'].lisible === false && parNom['endommage.xlsx'].points.includes('archive'), JSON.stringify(parNom['endommage.xlsx']));
  verifier('Contrôle Calcul : macros VBA détectées dans le .xlsm', parNom['macros.xlsm'].points.includes('macros') && parNom['macros.xlsm'].lisible);
  verifier('Analyse du moteur : verrou, formats, protection détectés', parNom['simple.xlsx'].pb.includes('verrou') && parNom['styles.xlsx'].pb.includes('formats') && parNom['protege.xlsx'].pb.includes('protection-feuille'));

  // 2. Réparation automatique : plan explicite, uniquement les corrections sûres, jamais Excel ni le poste
  await page.click('#tout-corriger');
  await page.waitForSelector('.dialogue [data-id="confirmer-reparation"]');
  const plan = await page.textContent('.dialogue');
  verifier('Plan de réparation affiché (détecté / sera tenté / copie de sécurité)', /Détecté/.test(plan) && /Sera tenté/.test(plan) && /historique des versions/.test(plan));
  verifier('Le plan n\'inclut pas la réparation avec Excel', !/Réparer avec Excel/.test(plan) && !plan.includes('endommage.xlsx'));
  await page.click('.dialogue [data-id="confirmer-reparation"]');
  await page.waitForFunction(() => !document.querySelector('#resultat-auto').classList.contains('masque'), null, { timeout: 60000 });
  const r1 = await rapport();
  verifier('Aucune intervention sur le poste pendant la réparation automatique', !appels.some(a => a.url.startsWith('poste/corriger')));
  verifier('Aucune action Excel lancée automatiquement', !appels.some(a => a.url.startsWith('corriger') && a.corps.includes('structure')));
  verifier('Verrou : corrigé et vérifié (n\'est plus détecté)', /Verrou d'une ancienne ouverture — corrigé et vérifié/.test(r1) && !fs.existsSync(path.join(DIR, '~$simple.xlsx')));
  verifier('Formats : correction annoncée non appliquée car toujours détectée (pas de faux succès)', /formats de cellule — non corrigé : le problème est toujours détecté/.test(r1), r1.match(/6001[^.]*\./)?.[0]);
  verifier('Fichiers relus par Calcul après réparation', (r1.match(/Fichier relu par Calcul après réparation/g) || []).length >= 2);
  const hist = await page.evaluate(() => fetch('/api/prefs?app=historique-classeurs-a', { headers: { 'X-Suite-Jeton': window.ATELIER.jeton } }).then(r => r.json()).catch(() => null).then(async a => { const b = await fetch('/api/prefs?app=historique-classeurs-b', { headers: { 'X-Suite-Jeton': window.ATELIER.jeton } }).then(r => r.json()).catch(() => null); return [...(a?.entrees || []), ...(b?.entrees || [])]; }));
  verifier('Copies « Avant réparation » dans l\'historique des versions de Calcul', ['simple.xlsx', 'styles.xlsx'].every(n => hist.some(e => e.nom === n && e.raison === 'Avant réparation (Dépannage)' && e.etat === 'verifiee')));

  // 3. Correction avec avertissement (protection) : confirmation, puis contrôle
  await page.evaluate(() => { const S = window.__depannage.S; S.ouverts.clear(); S.ouverts.add(S.fichiers.find(f => f.nom === 'protege.xlsx').chemin); });
  await page.evaluate(() => window.__depannage.ajouter([]));
  await page.click('.ligne-fichier >> text=protege.xlsx'); await page.click('.ligne-fichier >> text=protege.xlsx');
  await page.click('[data-corriger="protection-feuille"]');
  await page.waitForSelector('.dialogue [data-id="confirmer-reparation"]');
  const planP = await page.textContent('.dialogue');
  await page.click('.dialogue [data-id="confirmer-reparation"]');
  await page.waitForFunction(() => /protege\.xlsx/.test(document.querySelector('#resultat-auto').textContent), null, { timeout: 60000 });
  const r2 = await rapport();
  verifier('Protection : avertissement présenté avant de lever', /accord de son auteur/.test(planP));
  verifier('Protection : levée et vérifiée, fichier modifié et lisible', /feuille\(s\) protégée\(s\) — corrigé et vérifié/.test(r2) && sha('protege.xlsx') !== avant['protege.xlsx'] && /après : lisible par Calcul/.test(r2), r2.slice(0, 300));

  // 4. Intervention Excel facultative : confirmation, échec honnête sans Excel, fichier intact
  await page.click('.ligne-fichier >> text=endommage.xlsx');
  await page.click('[data-excel="structure"]');
  await page.waitForSelector('.dialogue [data-id="confirmer-excel"]');
  verifier('Intervention Excel : explication et confirmation demandées', /démarre Microsoft Excel/.test(await page.textContent('.dialogue')));
  await page.click('.dialogue [data-id="confirmer-excel"]');
  await page.waitForFunction(() => /endommage\.xlsx/.test(document.querySelector('#resultat-auto').textContent), null, { timeout: 60000 });
  const r3 = await rapport();
  verifier('Sans Excel : échec signalé clairement, pas de faux succès', /Classeur endommagé — échec : Excel n'est pas installé/.test(r3) && !/endommagé — corrigé/.test(r3));
  verifier('Sans Excel : fichier endommagé non modifié', sha('endommage.xlsx') === avant['endommage.xlsx']);

  // 5. Résultat de réparation illisible : la version d'origine est remise en place automatiquement
  const shaStyles = sha('styles.xlsx');
  await page.route('**/api/depannage/corriger', async route => {
    fs.writeFileSync(path.join(DIR, 'styles.xlsx'), fs.readFileSync(path.join(DIR, 'styles.xlsx')).subarray(0, 4000)); // le « réparateur » abîme le fichier
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ analyse: { chemin: W('styles.xlsx'), nom: 'styles.xlsx', problemes: [] }, resultats: [{ code: 'formats', ok: true, texte: 'Formats nettoyés.' }] }) });
  });
  const rep = await page.evaluate(async () => { const D = window.__depannage; const f = D.S.fichiers.find(x => x.nom === 'styles.xlsx'); return D.reparerFichier(f, ['formats']); });
  await page.unroute('**/api/depannage/corriger');
  verifier('Résultat illisible détecté et version d\'origine remise en place (vérifiée)', sha('styles.xlsx') === shaStyles && rep.lignes.some(l => l.etat === 'annule' && /remise en place et vérifiée/.test(l.texte)) && !rep.lignes.some(l => l.etat === 'verifie' && /corrigé/.test(l.texte)), JSON.stringify(rep.lignes.map(l => l.etat)));

  // 6. Interventions sur le poste : confirmation obligatoire, rien sans accord
  await page.click('#bloc-poste summary');
  await page.waitForSelector('#liste-poste [data-action]');
  const n0 = appels.filter(a => a.url.startsWith('poste/corriger')).length;
  await page.click('#liste-poste [data-action]');
  await page.waitForSelector('.dialogue [data-id="confirmer-poste"]');
  const txtPoste = await page.textContent('.dialogue');
  await page.click('.dialogue button:has-text("Annuler")');
  await attendre(500);
  verifier('Poste : action expliquée, rien n\'est fait si l\'on annule', /agit sur Excel ou Windows, pas sur vos classeurs/.test(txtPoste) && appels.filter(a => a.url.startsWith('poste/corriger')).length === n0);
  await page.click('#liste-poste [data-action]');
  await page.click('.dialogue [data-id="confirmer-poste"]');
  await attendre(2500);
  verifier('Poste : action exécutée après confirmation', appels.filter(a => a.url.startsWith('poste/corriger')).length === n0 + 1);
  verifier('Aucune erreur JavaScript', ctx.erreurs.length === 0, ctx.erreurs.slice(0, 3).join(' | '));
  await page.evaluate(() => document.querySelector('#resultat-auto').scrollIntoView());
  await page.screenshot({ path: path.join(ICI, 'resultats', 'p2-depannage.png'), fullPage: true });
} catch (e) { verifier('Exécution du scénario', false, e.stack); }
await arreter(ctx);
process.exit(bilan() ? 0 : 1);
