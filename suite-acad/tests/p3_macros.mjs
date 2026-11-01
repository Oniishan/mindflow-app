// Priorité 3 — Classeurs Excel avec macros dans Calcul (vrai moteur + vraie interface)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { suite, verifier, bilan, lancer, arreter, attendre, sha256Fichier, versWin, ICI } from './outils.mjs';

suite('P3 macros Calcul');
const DIR = '/tmp/essai-macros';
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
for (const f of ['macros.xlsm', 'simple.xlsx']) fs.copyFileSync(path.join(ICI, 'fichiers', f), path.join(DIR, f));
const F = n => path.join(DIR, n);
const py = code => execFileSync('python3', ['-c', code], { encoding: 'utf8' }).trim();
const shaVba = f => py(`import zipfile,hashlib;z=zipfile.ZipFile('${f}');print(hashlib.sha256(z.read('xl/vbaProject.bin')).hexdigest() if 'xl/vbaProject.bin' in z.namelist() else 'absent')`);
const shaVbaOrigine = shaVba(F('macros.xlsm'));

let ctx = await lancer('calcul'); let { page } = ctx;
const cliquerSi = async sel => { const b = await page.waitForSelector(sel, { timeout: 8000 }).catch(() => null); if (b) { await b.click(); return true; } return false; };
try {
  await page.waitForFunction(() => window.__calcul?.doc?.historique);
  await page.keyboard.press('Escape');

  // 1. Ouverture : macros identifiées, non exécutées, fonctions non prises en charge signalées
  const ok = await page.evaluate(c => window.__calcul.doc.ouvrirChemin(c, true), versWin(F('macros.xlsm')));
  await page.waitForSelector('#barre-macros');
  const barre = await page.textContent('#barre-macros');
  verifier('Ouverture du .xlsm dans Calcul', ok);
  verifier('Barre d\'information : macros présentes, non exécutées, modules listés', /Macros VBA présentes, non exécutées/.test(barre) && /Module1, Outils, Facture/.test(barre), barre.trim().slice(0, 200));
  verifier('Fonction non prise en charge signalée (CUBEVALUE), cellule en #NOM?', /CUBEVALUE/.test(barre) && await page.evaluate(() => String(window.__calcul.valeur(0, 2, 0)?.code || window.__calcul.valeur(0, 2, 0))) === '#NOM?', await page.evaluate(() => String(window.__calcul.valeur(0, 2, 0)?.code || window.__calcul.valeur(0, 2, 0))));
  const doc = await page.evaluate(() => ({ format: window.__calcul.doc.format, chemin: window.__calcul.doc.chemin }));
  verifier('Le document reste un .xlsm rattaché à son fichier', doc.format === 'xlsm' && /macros\.xlsm$/.test(doc.chemin));
  const infos = await page.evaluate(async () => { await window.__calcul.doc.ouvrirCoulisses('infos'); const t = document.querySelector('.tab-infos').textContent; window.__calcul.doc.fermerCoulisses(); return t; });
  verifier('Moteur identifié dans Informations (pas Microsoft Excel)', /Moteur de calcul.*moteur JavaScript intégré.*pas Microsoft Excel/.test(infos));
  verifier('Informations : macros conservées, jamais exécutées', /5 module\(s\), conservées en \.xlsm, jamais exécutées/.test(infos));
  verifier('Informations : éléments non conservés (bouton de formulaire)', /Boutons et contrôles de formulaire/.test(infos));
  await page.click('#barre-macros [data-a="details"]');
  const det = await page.textContent('.dialogue');
  verifier('Détails : exécution impossible et marche à suivre avec Excel expliquées', /n'active jamais de macros/.test(det) && /ouvrez le classeur dans Microsoft Excel/.test(det) && /équivalence complète n'est pas garantie/.test(det));
  await page.click('.dialogue .btn.primaire');

  // 2. Modification puis Ctrl+S : avertissement des pertes, enregistrement .xlsm, projet VBA intact
  await page.evaluate(() => { const K = window.__calcul; K.avant(); K.ecrire(1, 0, '250'); K.apresModif(); });
  const pEnr = page.evaluate(() => window.__calcul.doc.enregistrer());
  verifier('Avertissement avant écrasement : bouton de formulaire non conservé', await cliquerSi('.dialogue [data-id="accepter-pertes"]'));
  verifier('Enregistrement .xlsm réussi', await pEnr);
  verifier('Projet VBA conservé à l\'octet près après enregistrement', shaVba(F('macros.xlsm')) === shaVbaOrigine);
  const lo = py(`import openpyxl;wb=openpyxl.load_workbook('${F('macros.xlsm')}',keep_vba=True);ws=wb.active;print(wb.vba_archive is not None, ws['A2'].value, ws['B2'].value, ws['A3'].value, ws.sheet_properties.codeName, wb.code_name)`);
  verifier('Fichier relu par openpyxl : VBA, valeur modifiée, formules et noms de code', /^True 250 =A2\*0\.2 =CUBEVALUE\("Ventes"\) Feuil1 ThisWorkbook$/.test(lo), lo);
  fs.rmSync('/tmp/lo-out', { recursive: true, force: true });
  try {
    execFileSync('soffice', ['--headless', '--convert-to', 'csv', '--outdir', '/tmp/lo-out', F('macros.xlsm')], { timeout: 120000, stdio: 'pipe' });
    const csv = fs.readFileSync('/tmp/lo-out/macros.csv', 'utf8');
    verifier('Fichier ouvert par LibreOffice (contrôle indépendant) : valeurs recalculées', /250,50/.test(csv), csv.split('\n').slice(0, 2).join(' | '));
  } catch (e) { verifier('Fichier ouvert par LibreOffice', false, e.message); }
  const h = await page.evaluate(() => window.__calcul.doc.historique.lister());
  verifier('Original .xlsm copié dans l\'historique avant écrasement', h.some(e => e.nom === 'macros.xlsm' && e.raison === 'Avant enregistrement' && e.etat === 'verifiee'));

  // 3. Enregistrer en .xlsx : avertissement bloquant ; annuler n'écrit rien
  const routeChoix = cible => page.route('**/api/fichier/choisir-enregistrement', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chemin: versWin(cible) }) }));
  await routeChoix(F('copie.xlsx'));
  let p = page.evaluate(() => window.__calcul.doc.enregistrerSous());
  verifier('Enregistrer en .xlsx : avertissement « les macros seraient supprimées »', await cliquerSi('.dialogue [data-id="en-xlsm"]'));
  await cliquerSi('.dialogue [data-id="accepter-pertes"]');
  await p; await page.waitForFunction(() => window.__calcul.doc.format === 'xlsm' && /copie\.xlsx\.xlsm$/.test(window.__calcul.doc.chemin || ''), null, { timeout: 15000 }).catch(() => { });
  await page.unroute('**/api/fichier/choisir-enregistrement');
  verifier('Choix « Enregistrer en .xlsm » : nouveau .xlsm avec les macros identiques', fs.existsSync(F('copie.xlsx.xlsm')) && shaVba(F('copie.xlsx.xlsm')) === shaVbaOrigine && !fs.existsSync(F('copie.xlsx')), fs.readdirSync(DIR).join(', '));
  // annulation
  await routeChoix(F('annule.xlsx'));
  p = page.evaluate(() => window.__calcul.doc.enregistrerSous());
  await page.waitForSelector('.dialogue [data-id="sans-macros"]');
  await page.click('.dialogue button:has-text("Annuler")');
  const rAnn = await p;
  verifier('Annuler : rien n\'est écrit', !rAnn && !fs.existsSync(F('annule.xlsx')));
  // enregistrer sans les macros, en connaissance de cause
  p = page.evaluate(() => window.__calcul.doc.enregistrerSous());
  await cliquerSi('.dialogue [data-id="sans-macros"]');
  await cliquerSi('.dialogue [data-id="accepter-pertes"]');
  const rSans = await p;
  await page.unroute('**/api/fichier/choisir-enregistrement');
  verifier('« Enregistrer sans les macros » : .xlsx écrit sans projet VBA, .xlsm d\'origine intact', rSans && shaVba(F('annule.xlsx')) === 'absent' && shaVba(F('macros.xlsm')) === shaVbaOrigine);

  // 4. Contrôle de sécurité : un .xlsm dont le projet VBA ne correspond pas est refusé
  const ctl = await page.evaluate(async () => {
    const M = await import('./macros.js'); const fl = await import('./commun/vendor/fflate.js');
    const o = window.__calcul.origine();
    const sain = M.injecterVba(fl.zipSync({ '[Content_Types].xml': fl.strToU8('<Types><Override PartName="/xl/workbook.xml" ContentType="x"/></Types>'), 'xl/_rels/workbook.xml.rels': fl.strToU8('<Relationships></Relationships>'), 'xl/workbook.xml': fl.strToU8('<workbook></workbook>') }), o, []);
    const z = fl.unzipSync(sain); z['xl/vbaProject.bin'] = z['xl/vbaProject.bin'].slice(0, 100);
    return [M.verifierVba(sain, o).ok, M.verifierVba(fl.zipSync(z), o)];
  });
  verifier('Vérification VBA : projet intact accepté, projet tronqué refusé', ctl[0] === true && ctl[1].ok === false, JSON.stringify(ctl[1]));

  // 5. Fonctions disponibles : non-régression sur un classeur simple
  await page.evaluate(c => window.__calcul.doc.ouvrirChemin(c, true), versWin(F('simple.xlsx')));
  const vals = await page.evaluate(() => { const K = window.__calcul; K.avant(); K.ecrire(0, 5, '=SOMME(D2:D11)'); K.ecrire(1, 5, '=RECHERCHEV("Article 3";A2:D11;4;FAUX)'); K.ecrire(2, 5, '=SI(F1>100;"élevé";"bas")'); K.ecrire(3, 5, '=NB.SI(C2:C11;">5")'); K.ecrire(4, 5, '=ARRONDI(MOYENNE(B2:B11);2)'); K.apresModif(); return [0, 1, 2, 3, 4].map(r => K.valeur(0, r, 5)); });
  verifier('Fonctions : SOMME, RECHERCHEV, SI, NB.SI, ARRONDI/MOYENNE', JSON.stringify(vals) === JSON.stringify([577.5, 13.5, 'élevé', 5, 8.25]), JSON.stringify(vals));
  const pasDeBarre = await page.$('#barre-macros');
  verifier('Classeur sans macros : pas de barre d\'avertissement', !pasDeBarre);
  verifier('Aucune erreur JavaScript', ctx.erreurs.length === 0, ctx.erreurs.slice(0, 3).join(' | '));
} catch (e) { verifier('Exécution du scénario', false, e.stack); }
await arreter(ctx);

// 6. Après redémarrage : réouverture du .xlsm enregistré par Calcul et nouvel enregistrement
ctx = await lancer('calcul'); page = ctx.page;
try {
  await page.waitForFunction(() => window.__calcul?.doc?.historique);
  await page.evaluate(c => window.__calcul.doc.ouvrirChemin(c, true), versWin(F('macros.xlsm')));
  await page.waitForSelector('#barre-macros');
  const val = await page.evaluate(() => window.__calcul.valeur(0, 1, 0));
  await page.evaluate(() => { const K = window.__calcul; K.avant(); K.ecrire(1, 0, '300'); K.apresModif(); });
  const pE = page.evaluate(() => window.__calcul.doc.enregistrer());
  await cliquerSi('.dialogue [data-id="accepter-pertes"]');
  verifier('Second cycle ouverture/enregistrement : valeur relue et macros toujours identiques', (await pE) && val === 250 && shaVba(F('macros.xlsm')) === shaVbaOrigine, `A2=${val}`);
} catch (e) { verifier('Second cycle', false, e.stack); }
await arreter(ctx);
process.exit(bilan() ? 0 : 1);
