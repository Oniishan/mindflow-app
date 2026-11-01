// Priorité 4 — Publipostage (vrai moteur + vraie interface)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { suite, verifier, bilan, lancer, arreter, attendre, versWin, ICI } from './outils.mjs';

suite('P4 publipostage');
const DIR = '/tmp/essai-publipostage', SORTIE = path.join(DIR, 'sortie');
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(SORTIE, { recursive: true });
for (const f of ['destinataires.xlsx', 'destinataires.csv', 'modele-inscription.docx']) fs.copyFileSync(path.join(ICI, 'fichiers', f), path.join(DIR, f));
const shaModele = execFileSync('sha256sum', [path.join(DIR, 'modele-inscription.docx')], { encoding: 'utf8' }).split(' ')[0];
fs.writeFileSync(path.join(SORTIE, 'Inscription_Martin_Léa.docx'), 'fichier existant à ne pas écraser');
const py = c => execFileSync('python3', ['-c', c], { encoding: 'utf8' }).trim();
const texteDocx = f => py(`import docx;d=docx.Document(${JSON.stringify(f)});print('\\n'.join([p.text for p in d.paragraphs]+[c.text for t in d.tables for r in t.rows for c in r.cells]+[p.text for s in d.sections for p in s.header.paragraphs]))`);

const ctx = await lancer('publipostage');
const { page } = ctx;
const charger = (fn, f) => page.evaluate(([fn, c]) => fetch('/api/fichier/lire', { method: 'POST', headers: { 'X-Suite-Jeton': window.ATELIER.jeton, 'Content-Type': 'application/json' }, body: JSON.stringify({ chemin: c }) }).then(r => r.arrayBuffer()).then(b => window.__publipostage[fn]({ nom: c.split('\\').pop(), chemin: c, octets: new Uint8Array(b) })), [fn, versWin(path.join(DIR, f))]);
try {
  await page.waitForFunction(() => window.__publipostage);
  verifier('Application installée et ouverte (étape 1 « Données »)', /1\. Les données/.test(await page.textContent('#e1')));

  // 1. Données Excel : en-têtes, lignes, ligne vide ignorée, dates et montants en français
  await charger('chargerDonnees', 'destinataires.xlsx');
  const d = await page.evaluate(() => { const S = window.__publipostage.S; return { e: S.entetes, n: S.lignes.filter(l => !l.vide).length, vides: S.lignes.filter(l => l.vide).length, l1: S.lignes[0].valeurs }; });
  verifier('Import XLSX : 6 colonnes, 6 lignes, ligne vide ignorée', d.e.length === 6 && d.n === 6 && d.vides === 1, JSON.stringify(d.e));
  verifier('Valeurs au format français (date jj/mm/aaaa, montant avec virgule)', d.l1[4] === '14/03/2010' && /125,50/.test(d.l1[3]), JSON.stringify(d.l1));
  const dc = await page.evaluate(async () => { const b = await fetch('/api/fichier/lire', { method: 'POST', headers: { 'X-Suite-Jeton': window.ATELIER.jeton, 'Content-Type': 'application/json' }, body: JSON.stringify({ chemin: 'Z:\\tmp\\essai-publipostage\\destinataires.csv' }) }).then(r => r.arrayBuffer()); const M = await import('./fusion.js'); const r = M.lireDonnees(new Uint8Array(b), 'destinataires.csv').lire(null, true); return { e: r.entetes, l: r.lignes.map(l => l.valeurs) }; });
  verifier('Import CSV (point-virgule, encodage Windows) : accents corrects', dc.e.join('|') === 'Nom|Prénom|Courriel' && dc.l[1][0] === 'Élodie' && dc.l[1][1] === 'Garçon', JSON.stringify(dc));
  await page.click('#suivant');

  // 2. Modèle Word : MERGEFIELD, «Champ», balise éclatée, valeur par défaut, en-tête
  await charger('chargerModele', 'modele-inscription.docx');
  const m = await page.evaluate(() => { const M = window.__publipostage.S.modele; return { champs: M.champs.map(c => c.balise), erreurs: M.erreurs, avert: M.avertissements }; });
  verifier('Champs détectés (balise éclatée, MERGEFIELD, «Champ», défaut, en-tête, n°)', ['Prénom|Madame, Monsieur', 'Nom', 'Montant', 'Date de naissance', 'Ville', '#', 'Courriel', 'Observation|Aucune', 'Champ inconnu'].every(c => m.champs.includes(c)) && !m.erreurs.length, JSON.stringify(m.champs));
  const puces = await page.$$eval('#e2 .puce-pp.ko', l => l.map(x => x.textContent));
  verifier('Champ sans colonne signalé en rouge', puces.some(t => /Champ inconnu/.test(t)), puces.join(','));
  await page.click('#suivant');

  // 3. Contrôle et aperçu
  await page.waitForSelector('#e3 .controles-pp .pt');
  const ctl = await page.$$eval('#e3 .controles-pp .pt', l => l.map(x => x.className.split(' ').pop() + ' : ' + x.textContent.trim()));
  const a = t => ctl.some(x => t.test(x));
  verifier('Contrôle : champ sans colonne', a(/alerte : Champ \{Champ inconnu\} sans colonne/));
  verifier('Contrôle : valeur manquante avec valeur par défaut non signalée comme manque', !a(/\{Prénom\} vide/));
  verifier('Contrôle : adresse en double et adresse invalide', a(/Adresse en double/) && a(/Adresse absente ou invalide.*6/), ctl.filter(x => /Adresse/.test(x)).join(' / '));
  await page.waitForFunction(() => /mark/.test(document.querySelector('#page-apercu').innerHTML));
  let ap = await page.innerHTML('#page-apercu');
  verifier('Aperçu destinataire 1 : valeurs surlignées, balise éclatée remplie', /<mark class="val">Léa<\/mark>/.test(ap) && /Martin/.test(ap) && /<mark class="manque"[^>]*>\[Champ inconnu\]<\/mark>/.test(ap), ap.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));
  await page.click('#ap-suiv'); await page.click('#ap-suiv'); await attendre(700);
  ap = await page.innerHTML('#page-apercu');
  verifier('Aperçu destinataire 3 : prénom vide remplacé par la valeur par défaut', /Madame, Monsieur/.test(ap) && /Bernard/.test(ap));
  await page.click('#suivant');

  // 4. Génération : un Word par ligne, dossier choisi, noms sûrs, pas d'écrasement, liste d'envoi
  await page.evaluate(d => { const S = window.__publipostage.S; S.sortie.dossier = d; S.sortie.sousDossier = false; S.sortie.motif = 'Inscription_{Nom}_{Prénom}'; S.sortie.motifAuto = false; window.__publipostage.aller(4); }, versWin(SORTIE));
  const exemples = await page.textContent('.exemples-pp');
  await page.click('#generer');
  await page.click('.dialogue [data-id="generer-quand-meme"]');
  await page.waitForFunction(() => window.__publipostage.dernier, null, { timeout: 120000 });
  const r = await page.evaluate(() => { const r = window.__publipostage.dernier; return { ok: r.ok, erreurs: r.erreurs, noms: r.fichiers.map(f => f.nom), liste: r.liste }; });
  const fichiers = fs.readdirSync(SORTIE).sort();
  verifier('6 documents Word produits et vérifiés, aucune erreur', r.ok === 6 && !r.erreurs.length, JSON.stringify(r.erreurs));
  verifier('Fichier existant non écrasé (numéro ajouté)', fs.readFileSync(path.join(SORTIE, 'Inscription_Martin_Léa.docx'), 'utf8') === 'fichier existant à ne pas écraser' && fichiers.includes('Inscription_Martin_Léa (2).docx'), fichiers.join(' | '));
  verifier('Noms sûrs : « / » remplacé, nom réservé Windows « CON » protégé', fichiers.includes('Inscription_Durand_Dupont_Hugo.docx') && fichiers.includes('Inscription_CON_Inès.docx'), exemples.slice(0, 120));
  verifier('Champ vide : « Bernard » sans prénom donne un nom propre', fichiers.includes('Inscription_Bernard.docx'));
  const t1 = texteDocx(path.join(SORTIE, 'Inscription_Martin_Léa (2).docx'));
  verifier('Document Word relu par python-docx : valeurs fusionnées', /Bonjour Léa Martin,/.test(t1) && /Montant dû : 125,50/.test(t1) && /Né\(e\) le 14\/03\/2010 à Grenoble\. Document n° 1\./.test(t1) && /lea\.martin@exemple\.fr/.test(t1) && /Aucune/.test(t1) && /Dossier de Martin/.test(t1) && !/[{}«»]/.test(t1), t1.replace(/\n/g, ' | ').slice(0, 300));
  const t3 = texteDocx(path.join(SORTIE, 'Inscription_Bernard.docx'));
  verifier('Valeur par défaut appliquée dans le document', /Bonjour Madame, Monsieur Bernard,/.test(t3));
  const csv = fs.readFileSync(path.join(SORTIE, 'liste-envoi.csv'), 'utf8');
  verifier('Liste d\'envoi pour Fusion PJ (courriel ; fichier)', /^\uFEFFCourriel;Fichier;Nom;Prénom/.test(csv) && /lea\.martin@exemple\.fr;Inscription_Martin_Léa \(2\)\.docx;Martin;Léa/.test(csv), csv.split('\n')[1]);
  verifier('Modèle d\'origine inchangé', execFileSync('sha256sum', [path.join(DIR, 'modele-inscription.docx')], { encoding: 'utf8' }).split(' ')[0] === shaModele);
  try { execFileSync('soffice', ['--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', '/tmp/lo-pp', path.join(SORTIE, 'Inscription_Robert_Noé.docx')], { timeout: 120000, stdio: 'pipe' }); verifier('Document ouvert par LibreOffice (contrôle indépendant)', /Bonjour Noé Robert/.test(fs.readFileSync('/tmp/lo-pp/Inscription_Robert_Noé.txt', 'utf8'))); } catch (e) { verifier('Document ouvert par LibreOffice', false, e.message); }

  // 5. Un seul PDF pour toutes les lignes ; un PDF par ligne
  const SORTIE2 = path.join(DIR, 'pdf'); fs.mkdirSync(SORTIE2);
  await page.evaluate(d => { const P = window.__publipostage; P.S.sortie.dossier = d; P.S.sortie.format = 'pdf-unique'; P.S.dernier = null; P.dernier = null; P.aller(4); }, versWin(SORTIE2));
  await page.click('#generer'); await page.click('.dialogue [data-id="generer-quand-meme"]');
  await page.waitForFunction(() => window.__publipostage.dernier, null, { timeout: 120000 });
  const pdfs = fs.readdirSync(SORTIE2).filter(f => f.endsWith('.pdf'));
  const txt = pdfs.length ? execFileSync('pdftotext', ['-layout', path.join(SORTIE2, pdfs[0]), '-'], { encoding: 'utf8' }) : '';
  const pages = pdfs.length ? +py(`import pypdf;print(len(pypdf.PdfReader(${JSON.stringify(path.join(SORTIE2, pdfs[0]))}).pages))`) : 0;
  verifier('Un seul PDF : 6 pages, une par destinataire, texte fusionné lisible', pdfs.length === 1 && pages === 6 && /Bonjour Léa Martin/.test(txt) && /Bonjour Inès CON/.test(txt), `${pdfs.join(',')} — ${pages} page(s)`);
  await page.evaluate(() => { const P = window.__publipostage; P.S.sortie.format = 'pdf-un'; P.S.sortie.motif = '{#}_{Nom}'; P.S.dernier = null; P.dernier = null; P.aller(4); });
  await page.click('#generer'); await page.click('.dialogue [data-id="generer-quand-meme"]');
  await page.waitForFunction(() => window.__publipostage.dernier, null, { timeout: 120000 });
  const pdfs2 = fs.readdirSync(SORTIE2).filter(f => /^\d{3}_/.test(f));
  verifier('Un PDF par ligne, numérotés, chacun non vide et lisible', pdfs2.length === 6 && pdfs2.every(f => /Bonjour/.test(execFileSync('pdftotext', [path.join(SORTIE2, f), '-'], { encoding: 'utf8' }))), pdfs2.join(', '));
  const res = await page.textContent('#resume');
  verifier('Résumé : documents produits, avertissement de mise en page PDF', /6 document\(s\) produit\(s\) et vérifié\(s\)/.test(res) && /relu après écriture/.test(res));

  // 6. Modèle texte rédigé dans l'application, insertion de champ, sortie texte
  const SORTIE3 = path.join(DIR, 'texte'); fs.mkdirSync(SORTIE3);
  await page.evaluate(() => window.__publipostage.aller(2));
  await page.click('[name="src"][value="texte"]');
  await page.fill('#editeur', 'Bonjour ');
  await page.click('#editeur'); await page.keyboard.press('End');
  await page.click('[data-champ="Prénom"]');
  await page.waitForFunction(() => /\{Prénom\}/.test(window.__publipostage.S.texte));
  await page.evaluate(d => { const P = window.__publipostage; P.S.sortie.dossier = d; P.S.sortie.format = 'txt-un'; P.S.sortie.motif = '{Nom}'; P.S.dernier = null; P.dernier = null; P.aller(4); }, versWin(SORTIE3));
  await page.click('#generer'); await page.click('.dialogue [data-id="generer-quand-meme"]').catch(() => { });
  await page.waitForFunction(() => window.__publipostage.dernier, null, { timeout: 60000 });
  const tx = fs.readdirSync(SORTIE3).filter(f => f.endsWith('.txt'));
  verifier('Modèle texte : champ inséré au curseur, fichiers texte produits', tx.length === 6 && fs.readFileSync(path.join(SORTIE3, 'Martin.txt'), 'utf8').includes('Bonjour Léa'), tx.join(', '));
  // 7. Échec d'écriture : signalé ligne par ligne, sans bloquer les autres
  await page.route('**/api/fichier/ecrire*', route => /Petit/.test(decodeURIComponent(route.request().url())) ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"erreur":"accès refusé (simulé)"}' }) : route.continue());
  await page.evaluate(d => { const P = window.__publipostage; P.S.sortie.dossier = d; P.S.dernier = null; P.dernier = null; P.aller(4); }, versWin(path.join(DIR, 'texte2')));
  await page.click('#generer'); await page.click('.dialogue [data-id="generer-quand-meme"]').catch(() => { });
  await page.waitForFunction(() => window.__publipostage.dernier, null, { timeout: 60000 });
  await page.unroute('**/api/fichier/ecrire*');
  const r7 = await page.evaluate(() => window.__publipostage.dernier);
  verifier('Échec d\'écriture d\'un fichier : erreur signalée pour sa ligne, les autres produits', r7.ok === 5 && r7.erreurs.length === 1 && /Petit/.test(r7.erreurs[0].nom) && /accès refusé/.test(r7.erreurs[0].message), JSON.stringify(r7.erreurs));
  verifier('Aucune erreur JavaScript', ctx.erreurs.length === 0, ctx.erreurs.slice(0, 3).join(' | '));
  await page.evaluate(() => window.__publipostage.aller(3)); await attendre(800);
  await page.screenshot({ path: path.join(ICI, 'resultats', 'p4-publipostage.png') });
} catch (e) { verifier('Exécution du scénario', false, e.stack); }
await arreter(ctx);
process.exit(bilan() ? 0 : 1);
