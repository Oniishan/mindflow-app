// Priorité 5 — PDF → Word (application PDF) et Texte → PDF (vrai moteur + vraie interface)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { suite, verifier, bilan, lancer, arreter, attendre, versWin, sha256Fichier, ICI } from './outils.mjs';

suite('P5 conversions');
const DIR = '/tmp/essai-conversions';
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
for (const f of ['rapport.pdf', 'mixte.pdf', 'vierge.pdf']) fs.copyFileSync(path.join(ICI, 'fichiers', f), path.join(DIR, f));
const py = c => execFileSync('python3', ['-c', c], { encoding: 'utf8' }).trim();
const shaAvant = Object.fromEntries(['rapport.pdf', 'mixte.pdf', 'vierge.pdf'].map(f => [f, sha256Fichier(path.join(DIR, f))]));

// ---------- PDF → Word ----------
let ctx = await lancer('pdf'); let { page } = ctx;
const routeEnregistrer = cible => page.route('**/api/fichier/choisir-enregistrement', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chemin: versWin(cible) }) }));
async function convertir(fichier, cible) {
  await page.evaluate(c => window.__pdf.doc.ouvrirChemin(c, true), versWin(path.join(DIR, fichier)));
  await attendre(800);
  await routeEnregistrer(cible);
  const p = page.evaluate(() => window.__pdf.convertirEnWord());
  const dlg = await page.waitForSelector('.dialogue [data-id="convertir-word"]', { timeout: 30000 }).catch(() => null);
  const texte = dlg ? await page.textContent('.dialogue') : null;
  if (dlg) await dlg.click();
  await p;
  await page.unroute('**/api/fichier/choisir-enregistrement');
  const fin = await page.$('.dialogue') ? await page.textContent('.dialogue') : '';
  if (fin) await page.click('.dialogue .btn.primaire').catch(() => { });
  return { texte, fin, rapport: await page.evaluate(() => window.__pdf.dernierWord) };
}
try {
  await page.waitForFunction(() => window.__pdf?.convertirEnWord);
  await page.keyboard.press('Escape');
  // 1. PDF de texte
  const c1 = await convertir('rapport.pdf', path.join(DIR, 'rapport.docx'));
  verifier('Analyse affichée avant conversion (pages, texte, limites, aucun envoi)', /2 page\(s\) — texte détecté sur 2 page\(s\)/.test(c1.texte) && /reconstruite/.test(c1.texte) && /aucun fichier n'est envoyé/.test(c1.texte), (c1.texte || '').slice(0, 160));
  const docx1 = path.join(DIR, 'rapport.docx');
  const info = fs.existsSync(docx1) ? JSON.parse(py(`import docx,json
d=docx.Document(${JSON.stringify(docx1)})
print(json.dumps({'paras':[(p.style.name,p.text) for p in d.paragraphs if p.text.strip()],'gras':[r.text for p in d.paragraphs for r in p.runs if r.bold],'ital':[r.text for p in d.paragraphs for r in p.runs if r.italic],'sauts':sum(1 for p in d.paragraphs for r in p.runs if 'w:br' in r._r.xml and 'page' in r._r.xml)}))`)) : null;
  verifier('Document Word créé et relu par python-docx', !!info, c1.fin.slice(0, 120));
  const txt = info ? info.paras.map(p => p[1]).join('\n') : '';
  verifier('Titres reconnus (styles de titre)', info && info.paras.some(([s, t]) => /heading 1/i.test(s) && /Rapport annuel 2026/.test(t)) && info.paras.some(([s, t]) => /heading 2/i.test(s) && /Points importants/.test(t)), JSON.stringify(info?.paras.slice(0, 3)));
  verifier('Paragraphe sur plusieurs lignes réuni en un seul paragraphe', info && info.paras.some(([, t]) => /^Le conseil d'administration.*hausse des coûts\.$/.test(t)), info?.paras[1]?.[1]);
  verifier('Liste à puces : un paragraphe par élément', info && info.paras.filter(([, t]) => /^• /.test(t)).length === 3);
  verifier('Gras et italique repris', info && info.ital.some(t => /italique/.test(t)) && info.gras.some(t => /gras/.test(t)), JSON.stringify({ g: info?.gras, i: info?.ital }));
  verifier('Saut de page entre les pages du PDF, texte de la page 2 présent', info && info.sauts >= 1 && /Deuxième page : conclusion/.test(txt));
  verifier('Contrôle : taux de caractères retrouvés affiché et ≥ 95 %', c1.rapport && c1.rapport.taux >= 95 && /% des caractères du PDF retrouvés/.test(c1.fin), `taux ${c1.rapport?.taux}`);
  try { execFileSync('soffice', ['--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', '/tmp/lo-p5', docx1], { timeout: 120000, stdio: 'pipe' }); verifier('Document ouvert par LibreOffice (contrôle indépendant)', /Rapport annuel 2026/.test(fs.readFileSync('/tmp/lo-p5/rapport.txt', 'utf8'))); } catch (e) { verifier('Document ouvert par LibreOffice', false, e.message); }

  // 2. PDF mixte avec page numérisée, sans OCR local
  const ocr = await page.evaluate(() => 'TextDetector' in window);
  const c2 = await convertir('mixte.pdf', path.join(DIR, 'mixte.docx'));
  verifier('Page numérisée détectée et absence d\'OCR expliquée avant conversion', /1 page\(s\) numérisée\(s\)/.test(c2.texte) && (ocr || /Aucun moteur de reconnaissance de texte \(OCR\)/.test(c2.texte)), `OCR disponible : ${ocr}`);
  const z = py(`import zipfile;z=zipfile.ZipFile(${JSON.stringify(path.join(DIR, 'mixte.docx'))});print([n for n in z.namelist() if n.startswith('word/media')], 'numérisée' in z.read('word/document.xml').decode())`);
  verifier('Page numérisée insérée en image et signalée dans le document', /word\/media\/page3\.png/.test(z) && /True$/.test(z), z);
  verifier('Résumé honnête : page en image, texte non modifiable', /1 page\(s\) numérisée\(s\) insérée\(s\) en image/.test(c2.fin));

  // 3. PDF vierge : aucun document vide produit
  await page.evaluate(c => window.__pdf.doc.ouvrirChemin(c, true), versWin(path.join(DIR, 'vierge.pdf')));
  await attendre(600);
  await page.evaluate(() => window.__pdf.convertirEnWord());
  const t3 = await page.$$eval('.toast', l => l.map(x => x.textContent).join(' | '));
  verifier('PDF sans texte ni image : refus clair, aucun fichier créé', /aucun document Word n'a été créé/.test(t3) && !fs.existsSync(path.join(DIR, 'vierge.docx')), t3.slice(0, 160));
  verifier('PDF d\'origine jamais modifiés', Object.entries(shaAvant).every(([f, s]) => sha256Fichier(path.join(DIR, f)) === s));
  const envois = []; // aucun appel réseau hors du moteur local
  verifier('Aucune erreur JavaScript (PDF)', ctx.erreurs.length === 0, ctx.erreurs.slice(0, 3).join(' | '));
} catch (e) { verifier('Scénario PDF → Word', false, e.stack); }
await arreter(ctx);

// ---------- Texte → PDF ----------
ctx = await lancer('texte'); page = ctx.page;
const requetesExternes = [];
page.on('request', r => { if (!/^http:\/\/127\.0\.0\.1/.test(r.url()) && !/^data:|^blob:/.test(r.url())) requetesExternes.push(r.url()); });
try {
  await page.waitForFunction(() => window.__texte?.texteVersPdf);
  await page.keyboard.press('Escape');
  const png = py("import base64,io\nfrom PIL import Image\nb=io.BytesIO();Image.new('RGB',(120,60),(30,100,200)).save(b,'PNG');print(base64.b64encode(b.getvalue()).decode())");
  await page.evaluate(img => {
    const html = `<p class="st-titre">Compte rendu</p><p class="st-sous-titre">Réunion du 12 mars 2026</p><h1>1. Présents</h1><p>Mme Léa Martin, M. Hugo Durand — équipe « Éducation ». Œuvres, garçon, 25 € → validé ✓.</p>
      <ul><li>Point <b>important</b></li><li>Point <i>secondaire</i></li></ul><ol><li>Premier</li><li>Deuxième</li></ol>
      <table><tr><th>Poste</th><th>Montant</th></tr><tr><td>Matériel</td><td>1 200 €</td></tr></table>
      <p style="text-align:center">Texte centré</p><p><img src="data:image/png;base64,${img}" style="width:120px"></p>
      <hr class="saut-page"><h2>2. Décisions</h2>${'<p>Paragraphe de remplissage pour vérifier la pagination automatique sur plusieurs pages du document produit. </p>'.repeat(40)}<p>Émoji non pris en charge : 😀</p>`;
    window.__texte.chargerHTML(html, { entete: { gauche: '', centre: 'Compte rendu', droite: '' }, pied: { gauche: '', centre: '', droite: 'Page {page} sur {pages}' } });
  }, png);
  const r = await page.evaluate(async () => { const r = await window.__texte.texteVersPdf(); return { pages: r.pages, av: r.avertissements, b64: btoa(String.fromCharCode(...r.octets)) }; });
  const fpdf = path.join(DIR, 'rendu-direct.pdf'); fs.writeFileSync(fpdf, Buffer.from(r.b64, 'base64'));
  const txt = execFileSync('pdftotext', ['-layout', fpdf, '-'], { encoding: 'utf8' });
  const nPages = +py(`import pypdf;print(len(pypdf.PdfReader(${JSON.stringify(fpdf)}).pages))`);
  verifier('PDF produit : plusieurs pages (saut de page + pagination)', nPages >= 3 && nPages === r.pages, `${nPages} pages`);
  verifier('Contenu fidèle : titres, accents, €, Œ, listes, tableau', /Compte rendu/.test(txt) && /Réunion du 12 mars 2026/.test(txt) && /Léa Martin/.test(txt) && /Œuvres, garçon, 25 €/.test(txt) && /Matériel\s+1 200 €/.test(txt) && /1\.\s+Premier/.test(txt) && /-\s+Point important/.test(txt), txt.split('\n').slice(0, 8).join(' / '));
  verifier('Saut de page respecté : « 2. Décisions » en haut de la page 2', /2\. Décisions/.test(execFileSync('pdftotext', ['-f', '2', '-l', '2', fpdf, '-'], { encoding: 'utf8' }).split('\n').slice(0, 3).join(' ')));
  verifier('En-tête et pied de page avec numéros « Page n sur N »', new RegExp(`Page 1 sur ${nPages}`).test(txt) && new RegExp(`Page ${nPages} sur ${nPages}`).test(txt) && (txt.match(/Compte rendu/g) || []).length >= nPages);
  const img = py(`import pypdf;r=pypdf.PdfReader(${JSON.stringify(fpdf)});print(sum(len(p.images) for p in r.pages))`);
  verifier('Image intégrée reproduite', +img === 1, `${img} image(s)`);
  verifier('Caractère non disponible signalé (pas remplacé en silence)', r.av.some(a => /caractère\(s\) non disponible/.test(a)), r.av.join(' | '));
  verifier('Rendu prévisible : deux exports identiques (hors date de création)', await page.evaluate(async () => { const a = await window.__texte.texteVersPdf(), b = await window.__texte.texteVersPdf(); return Math.abs(a.octets.length - b.octets.length) < 64 && a.pages === b.pages; }));
  // export par l'interface : Fichier > Exporter > PDF, enregistrement, document d'origine intact
  const avantHtml = await page.evaluate(() => window.__texte.feuille.innerHTML.length);
  await page.route('**/api/fichier/choisir-enregistrement', rr => rr.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chemin: versWin(path.join(DIR, 'compte-rendu')) }) }));
  await page.evaluate(() => window.__texte.doc.ouvrirCoulisses('exporter'));
  await page.click('[data-export="pdf"]');
  await page.waitForSelector('.dialogue [data-id="enregistrer-pdf"]');
  const avDlg = await page.textContent('.dialogue');
  await page.click('.dialogue [data-id="enregistrer-pdf"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /PDF enregistré/.test(t.textContent)), null, { timeout: 30000 });
  await page.unroute('**/api/fichier/choisir-enregistrement');
  const fichier = path.join(DIR, 'compte-rendu.pdf');
  verifier('Export depuis le menu : différences listées avant enregistrement', /différences avec l'écran/.test(avDlg) && /non disponible/.test(avDlg));
  verifier('PDF enregistré avec l\'extension .pdf, relu et valide', fs.existsSync(fichier) && /%PDF-/.test(fs.readFileSync(fichier).subarray(0, 8).toString()) && +py(`import pypdf;print(len(pypdf.PdfReader(${JSON.stringify(fichier)}).pages))`) === nPages);
  verifier('Document Texte inchangé après export', (await page.evaluate(() => window.__texte.feuille.innerHTML.length)) === avantHtml);
  // document vide : pas de PDF vide présenté comme réussi
  await page.evaluate(() => window.__texte.chargerHTML('<p><br></p>', {}));
  await page.evaluate(() => window.__texte.exporterPdf());
  const tv = await page.$$eval('.toast', l => l.map(x => x.textContent).join(' | '));
  verifier('Document vide : aucun PDF créé, message clair', /aucun texte : aucun PDF n'a été créé/.test(tv));
  verifier('Aucune requête vers Internet', requetesExternes.length === 0, requetesExternes.slice(0, 3).join(', '));
  verifier('Aucune erreur JavaScript (Texte)', ctx.erreurs.length === 0, ctx.erreurs.slice(0, 3).join(' | '));
} catch (e) { verifier('Scénario Texte → PDF', false, e.stack); }
await arreter(ctx);
process.exit(bilan() ? 0 : 1);
