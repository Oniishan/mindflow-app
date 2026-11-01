// Dépannage de Calcul et des classeurs
// 1. diagnostic non destructif  2. réparation après copie dans l'historique  3. contrôle du fichier obtenu
// Les interventions sur Excel et Windows sont séparées, facultatives et confirmées une par une.
import { $, $$, el, esc, ico, toast, confirmer, dialogue, appliquerTheme, formatOctets } from './commun/ui.js';
import * as F from './commun/fichiers.js';
import { ouvrirHistorique, sha256 } from './commun/versions.js';
import { controlerClasseur } from './controle.js';

const S = { fichiers: [], ouverts: new Set(), poste: [], journal: [], enCours: false };
const api = (chemin, corps) => F.appelApi('/api/depannage/' + chemin, corps || {});
const GRAVITE = { erreur: 0, alerte: 1, info: 2 };
const extension = n => (/\.([^.\\/]+)$/.exec(n || '') || [, ''])[1].toLowerCase();
// historique des versions partagé avec Calcul
const H = F.NATIF ? ouvrirHistorique('classeurs', { verifierContenu: async (o, ext) => { const c = await controlerClasseur(o, ext); return { ok: c.lisible, detail: c.detail }; } }) : null;
/** Corrections qui lancent Microsoft Excel (intervention sur le poste) */
const avecExcel = p => /excel/i.test(p.action || '') || ['structure', 'xls', 'conversion', 'convertir'].includes(p.code);
/** Corrections sûres : appliquées par « Réparer les classeurs » (jamais celles qui lancent Excel) */
const estSure = p => p.auto && p.corrigeable && !avecExcel(p);

// ----- Barre de titre -----
const barre = $('#barre-titre');
barre.innerHTML = `<div class="tuile" aria-hidden="true">Dp</div><span class="nom-doc" style="cursor:default">Dépannage de Calcul et des classeurs</span><span class="espace"></span>
  <button class="btn-t" id="theme" title="Thème de l'affichage">${ico('settings', 'p')}<span>Affichage</span></button>
  <button class="btn-t" id="aide" title="Aide">${ico('circle-help', 'p')}<span>Aide</span></button>`;
F.definirTitre('Dépannage de Calcul et des classeurs');

let prefs = {};
F.lirePrefs('depannage').then(p => { prefs = p || {}; appliquerTheme(prefs.theme || 'systeme'); });
$('#theme').onclick = async () => {
  const r = await dialogue({
    titre: 'Affichage', contenu: `<label class="champ">Thème<select name="theme">
      <option value="systeme">Comme Windows</option><option value="clair">Clair</option><option value="sombre">Sombre</option></select></label>`,
    boutons: [{ label: 'Annuler', valeur: null }, { label: 'Appliquer', valeur: true, primaire: true }],
    init: c => { $('[name="theme"]', c).value = prefs.theme || 'systeme'; },
  });
  if (r) { prefs.theme = r.theme; appliquerTheme(r.theme); F.ecrirePrefs('depannage', prefs); }
};
$('#aide').onclick = () => dialogue({
  titre: 'Comment ça marche', taille: 'large', boutons: [{ label: 'Compris', valeur: true, primaire: true }], contenu: `
  <p><b>1. Diagnostic.</b> Ajoutez les classeurs qui posent problème (ou tout un dossier). Chacun est lu et analysé sans être modifié : Calcul vérifie qu'il peut le lire (archive intacte, feuilles lisibles, macros présentes), puis le moteur de la suite recherche les causes connues de blocage (verrou, styles accumulés, protections, liaisons, noms en erreur…).</p>
  <p><b>2. Réparation.</b> « Réparer les classeurs » n'applique que les corrections sûres qui ne lancent pas Excel. Avant de les appliquer, la liste de ce qui a été détecté et de ce qui sera tenté vous est présentée. Le classeur est copié dans l'historique des versions de Calcul, puis une sauvegarde supplémentaire est faite par le moteur.</p>
  <p><b>3. Contrôle.</b> Après chaque réparation, le fichier obtenu est relu par Calcul et analysé de nouveau. Le résultat indique pour chaque point : <i>vérifié</i>, <i>non appliqué</i> ou <i>échec</i>. Si le fichier obtenu ne se relit plus alors qu'il se lisait avant, la version d'origine est remise en place automatiquement.</p>
  <p><b>Interventions sur Excel et Windows.</b> Réparer un classeur endommagé avec Excel, convertir un ancien .xls, fermer des Excel invisibles, libérer le presse-papiers ou désactiver un complément sont des actions sur le poste : elles sont regroupées à part, ne sont jamais lancées automatiquement et demandent chacune votre confirmation.</p>
  <p>L'historique en bas de la page permet d'<b>annuler</b> une correction ; l'historique des versions de Calcul permet aussi de revenir à n'importe quelle copie.</p>` });

// ----- Boutons -----
$('#tout-corriger').innerHTML = `${ico('wrench')}<span>Réparer les classeurs</span>`;
$('#ajouter-fichiers').innerHTML = `${ico('file-plus')}<span>Ajouter des classeurs</span>`;
$('#ajouter-dossier').innerHTML = `${ico('folder-open')}<span>Ajouter un dossier</span>`;
$('#vider').innerHTML = ico('trash-2');
$('#reanalyser-poste').innerHTML = `${ico('refresh-cw', 'p')}<span>Vérifier de nouveau</span>`;
$('#ouvrir-sauvegardes').innerHTML = `${ico('folder-open')}<span>Ouvrir les sauvegardes</span>`;

const FILTRES = [{ nom: 'Classeurs', ext: ['xlsx', 'xlsm', 'xls', 'xlsb', 'xltx', 'xltm', 'ods', 'csv'] }];
$('#ajouter-fichiers').onclick = async () => {
  const r = await F.appelApi('/api/fichier/ouvrir', { titre: 'Classeurs à vérifier', filtres: FILTRES, multiple: true });
  if (!r || r.annule || !r.fichiers?.length) return;
  ajouter(r.fichiers.map(f => f.chemin));
};
$('#ajouter-dossier').onclick = async () => {
  const d = await F.choisirDossier('Dossier contenant les classeurs');
  if (!d) return;
  const sous = await confirmer('Sous-dossiers', 'Inclure aussi les classeurs des sous-dossiers ?', 'Inclure', false);
  const r = await api('lister-dossier', { dossier: d, sousDossiers: !!sous });
  if (!r.chemins?.length) { toast('Aucun classeur dans ce dossier.', 'info'); return; }
  ajouter(r.chemins);
};
$('#vider').onclick = () => { S.fichiers = []; S.ouverts.clear(); rendreFichiers(); };
$('#reanalyser-poste').onclick = () => chargerPoste();
$('#ouvrir-sauvegardes').onclick = () => api('ouvrir-sauvegardes');
$('#tout-corriger').onclick = () => reparerTout();

// ----- Diagnostic (lecture seule) -----
async function controleCalcul(chemin) {
  try { return await controlerClasseur(await F.lireChemin(chemin), extension(chemin)); }
  catch (e) { return { lisible: false, feuilles: [], points: [{ code: 'acces', gravite: 'erreur', titre: 'Fichier inaccessible', detail: `Le fichier ne peut pas être lu (${e.message}). Il est peut-être ouvert dans Excel, déplacé ou sur un lecteur réseau indisponible.` }], detail: 'Fichier inaccessible' }; }
}
async function analyser(chemins) {
  const r = await api('analyser', { chemins });
  const res = [];
  for (const a of r.fichiers || []) res.push({ ...a, calcul: await controleCalcul(a.chemin) });
  return res;
}
async function ajouter(chemins) {
  const nouveaux = chemins.filter(c => !S.fichiers.some(f => f.chemin.toLowerCase() === c.toLowerCase()));
  if (!nouveaux.length) return;
  for (const c of nouveaux) S.fichiers.push({ chemin: c, nom: c.split(/[\\/]/).pop(), attente: true, problemes: [] });
  rendreFichiers();
  for (let i = 0; i < nouveaux.length; i += 20) {
    try { for (const a of await analyser(nouveaux.slice(i, i + 20))) majAnalyse(a); }
    catch (e) { toast('Analyse impossible : ' + e.message, 'erreur'); nouveaux.slice(i, i + 20).forEach(c => majAnalyse({ chemin: c, nom: c.split(/[\\/]/).pop(), erreur: e.message, problemes: [] })); }
    rendreFichiers();
  }
  if (nouveaux.length === 1) { S.ouverts.add(nouveaux[0]); rendreFichiers(); }
}
function majAnalyse(a) {
  const i = S.fichiers.findIndex(f => f.chemin.toLowerCase() === a.chemin.toLowerCase());
  if (i >= 0) S.fichiers[i] = { ...S.fichiers[i], ...a, attente: false }; else S.fichiers.push(a);
}

// ----- Rendu des classeurs -----
function etatFichier(f) {
  if (f.attente) return ['attente', 'Analyse…'];
  if (f.erreur) return ['erreur', 'Analyse impossible'];
  const p = [...(f.problemes || []).filter(x => x.gravite !== 'info' || x.corrigeable), ...(f.calcul?.points || []).filter(x => x.gravite !== 'info')];
  const g = p.reduce((m, x) => Math.min(m, GRAVITE[x.gravite] ?? 2), 9);
  if (!p.length) return ['ok', f.calcul?.lisible ? 'Aucun problème' : 'Analysé'];
  const n = p.length + (p.length > 1 ? ' points' : ' point');
  return [g === 0 ? 'erreur' : g === 1 ? 'alerte' : 'info', n + ' à voir'];
}
const pointHtml = (p, bouton = '') => `<div class="probleme"><span class="pastille-g ${p.gravite}"></span><div class="txt"><div class="titre-p">${esc(p.titre)}</div><div class="detail-p">${esc(p.detail)}</div></div>${bouton}</div>`;
function rendreFichiers() {
  const z = $('#liste-fichiers');
  $('#vider').classList.toggle('masque', !S.fichiers.length);
  const nSurs = S.fichiers.reduce((n, f) => n + (f.problemes || []).filter(estSure).length, 0);
  $('#tout-corriger').disabled = !nSurs || S.enCours;
  $('#tout-corriger').title = nSurs ? `${nSurs} correction(s) sûre(s) à appliquer` : 'Ajoutez des classeurs : seules les corrections sûres détectées seront proposées';
  if (!S.fichiers.length) {
    z.innerHTML = `<div class="vide-dep"><p>Ajoutez le classeur qui ne s'ouvre plus dans Calcul ou dans Excel, refuse le copier-coller, s'affiche en lecture seule ou se dit « déjà utilisé ». Il sera seulement lu : rien n'est modifié à cette étape.</p>
      <button class="btn primaire" data-a="fichiers">${ico('file-plus')}<span>Ajouter des classeurs</span></button></div>`;
    $('[data-a="fichiers"]', z).onclick = () => $('#ajouter-fichiers').click();
    return;
  }
  z.innerHTML = S.fichiers.map((f, i) => {
    const [cls, txt] = etatFichier(f);
    const ouvert = S.ouverts.has(f.chemin);
    const probs = [...(f.problemes || [])].sort((a, b) => (GRAVITE[a.gravite] ?? 2) - (GRAVITE[b.gravite] ?? 2));
    const surs = probs.filter(p => !avecExcel(p)), excel = probs.filter(avecExcel);
    const dossier = f.chemin.slice(0, f.chemin.length - f.nom.length).replace(/[\\/]$/, '');
    const c = f.calcul;
    return `<div class="fichier" data-i="${i}">
      <div class="ligne-fichier" role="button" tabindex="0" aria-expanded="${ouvert}">${ico('file-spreadsheet', 'ico-f')}
        <div class="infos-f"><div class="nom">${esc(f.nom)}</div><div class="chemin">${esc(dossier)}${f.taille ? ' · ' + formatOctets(f.taille) : ''}</div></div>
        ${c && !f.attente ? `<span class="etat ${c.lisible ? 'ok' : 'erreur'}" title="${esc(c.detail || '')}">${ico(c.lisible ? 'circle-check' : 'circle-x', 'p')}${c.lisible ? 'Lisible par Calcul' : 'Illisible par Calcul'}</span>` : ''}
        <span class="etat ${cls}">${f.attente ? ico('refresh-cw', 'p tourne') : ''}${esc(txt)}</span>${ico(ouvert ? 'chevron-up' : 'chevron-down', 'p')}</div>
      ${ouvert && !f.attente ? `<div class="detail-fichier">
        <h4>${ico('sheet', 'p')} Contrôles de Calcul <small>lecture seule</small></h4>
        ${f.erreur ? pointHtml({ gravite: 'erreur', titre: 'Analyse impossible', detail: f.erreur }) : ''}
        ${c ? (c.points.length ? c.points.map(p => pointHtml(p)).join('') : pointHtml({ gravite: 'ok', titre: c.detail, detail: 'Archive intacte, feuilles lisibles.' })) : ''}
        <h4>${ico('wrench', 'p')} Analyse du fichier <small>corrections faites par Suite Acad’, sans Excel</small></h4>
        ${surs.length ? surs.map(p => pointHtml(p, p.corrigeable ? `<button class="btn petit" data-corriger="${esc(p.code)}">${esc(p.action || 'Corriger')}</button>` : '')).join('')
          : pointHtml({ gravite: 'ok', titre: 'Rien d\'anormal détecté', detail: 'Si le problème ne se produit que dans Excel, voyez « Interventions facultatives sur Excel et Windows ».' })}
        ${excel.length ? `<h4 class="titre-excel">${ico('triangle-alert', 'p')} Nécessite Microsoft Excel <small>intervention facultative, lance Excel sur ce poste</small></h4>
          ${excel.map(p => pointHtml(p, p.corrigeable ? `<button class="btn petit" data-excel="${esc(p.code)}">${esc(p.action || 'Corriger avec Excel')}…</button>` : '')).join('')}` : ''}
        <div class="actions-f">${surs.some(estSure) ? `<button class="btn primaire petit" data-a="auto">${ico('wrench', 'p')}<span>Réparer ce classeur…</span></button>` : ''}
          ${c?.lisible ? `<button class="btn petit" data-a="calcul">${ico('sheet', 'p')}<span>Ouvrir dans Calcul</span></button>` : ''}
          <button class="btn petit" data-a="reanalyser">${ico('refresh-cw', 'p')}<span>Analyser de nouveau</span></button>
          <button class="btn petit" data-a="emplacement">${ico('folder-open', 'p')}<span>Ouvrir l'emplacement</span></button>
          <button class="btn petit discret" data-a="retirer">${ico('x', 'p')}<span>Retirer de la liste</span></button></div>
      </div>` : ''}
    </div>`;
  }).join('');
  $$('.fichier', z).forEach(n => {
    const f = S.fichiers[+n.dataset.i];
    const bascule = () => { S.ouverts.has(f.chemin) ? S.ouverts.delete(f.chemin) : S.ouverts.add(f.chemin); rendreFichiers(); };
    const ligne = $('.ligne-fichier', n);
    ligne.onclick = bascule;
    ligne.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bascule(); } };
    $$('[data-corriger]', n).forEach(b => b.onclick = () => corrigerUn(f, b.dataset.corriger, b));
    $$('[data-excel]', n).forEach(b => b.onclick = () => corrigerAvecExcel(f, b.dataset.excel, b));
    const act = (a, fn) => { const b = $(`[data-a="${a}"]`, n); if (b) b.onclick = fn; };
    act('auto', e => reparerAvecPlan([{ f, codes: f.problemes.filter(estSure).map(p => p.code) }], e.currentTarget));
    act('calcul', () => F.appelApi('/api/lancer-app', { id: 'calcul', fichier: f.chemin }).then(() => toast('Ouverture dans Calcul…', 'info')).catch(e => toast(e.message, 'erreur')));
    act('reanalyser', async () => { for (const a of await analyser([f.chemin])) majAnalyse(a); rendreFichiers(); });
    act('emplacement', () => F.afficherDansExplorateur(f.chemin));
    act('retirer', () => { S.fichiers.splice(S.fichiers.indexOf(f), 1); S.ouverts.delete(f.chemin); rendreFichiers(); });
  });
}

// ----- Réparation : plan, copie de sécurité, correction, contrôle -----
const AVERTISSEMENTS = {
  'protection-feuille': 'Les cellules verrouillées deviendront modifiables. Ne le faites que pour un classeur dont vous avez la responsabilité ou avec l\'accord de son auteur.',
  'protection-classeur': 'La structure du classeur (ajout, suppression, renommage des feuilles) ne sera plus protégée.',
  'mot-de-passe-ecriture': 'Le classeur s\'ouvrira directement en modification, sans mot de passe.',
  liens: 'Les formules qui lisent d\'autres classeurs seront remplacées par leur dernière valeur connue.',
  verrou: 'Le fichier de verrouillage ~$… laissé par une fermeture brutale d\'Excel sera supprimé. Si quelqu\'un a réellement ouvert le classeur sur un partage réseau, attendez qu\'il le ferme.',
};
function corrigerUn(f, code, bouton) {
  const codes = code.startsWith('protection') || code === 'mot-de-passe-ecriture' ? ['protection-feuille', 'protection-classeur', 'mot-de-passe-ecriture'].filter(c => f.problemes.some(p => p.code === c)) : [code];
  return reparerAvecPlan([{ f, codes }], bouton);
}
async function corrigerAvecExcel(f, code, bouton) {
  const p = f.problemes.find(x => x.code === code);
  const r = await dialogue({
    titre: 'Intervention avec Microsoft Excel', contenu: `<p><b>${esc(f.nom)}</b> — ${esc(p.titre)}</p><p>${esc(p.detail)}</p>
      <p>Cette action démarre <b>Microsoft Excel</b> en arrière-plan sur ce poste pour ouvrir le classeur et l'enregistrer de nouveau (« ${esc(p.action)} »). Excel doit être installé ; l'opération peut prendre un moment. Le classeur est d'abord copié dans l'historique des versions, puis le résultat est relu et contrôlé.</p>`,
    boutons: [{ label: 'Annuler', valeur: null }, { label: 'Lancer avec Excel', valeur: true, primaire: true, id: 'confirmer-excel' }],
  });
  if (!r) return;
  await executer([{ f, codes: [code] }], bouton);
}

/** Présente ce qui a été détecté et ce qui sera tenté, puis lance la réparation après confirmation. */
async function reparerAvecPlan(lots, bouton) {
  lots = lots.filter(l => l.codes.length);
  if (!lots.length) return;
  const avert = [...new Set(lots.flatMap(l => l.codes))].map(c => AVERTISSEMENTS[c]).filter(Boolean);
  const r = await dialogue({
    titre: 'Réparation : ce qui va être fait', taille: 'large',
    contenu: `${lots.map(({ f, codes }) => `<div class="plan-fichier"><b>${esc(f.nom)}</b>
        <div class="plan-col"><span>Détecté</span><ul>${codes.map(c => `<li>${esc(f.problemes.find(p => p.code === c)?.titre || c)}</li>`).join('')}</ul></div>
        <div class="plan-col"><span>Sera tenté</span><ul>${codes.map(c => `<li>${esc(f.problemes.find(p => p.code === c)?.action || 'Corriger')}</li>`).join('')}</ul></div></div>`).join('')}
      ${avert.length ? `<div class="plan-avert">${ico('triangle-alert', 'p')}<div>${avert.map(a => `<p>${esc(a)}</p>`).join('')}</div></div>` : ''}
      <p class="texte-aide">Avant toute modification, chaque classeur est copié dans l'historique des versions de Calcul. Après la réparation, le fichier est relu et analysé de nouveau ; s'il ne se relit plus, la version d'origine est remise en place.</p>`,
    boutons: [{ label: 'Annuler', valeur: null }, { label: 'Réparer', valeur: true, primaire: true, id: 'confirmer-reparation' }],
  });
  if (!r) return;
  await executer(lots, bouton);
}

async function executer(lots, bouton) {
  if (S.enCours) return;
  S.enCours = true; occupe(bouton, true); rendreFichiersSiInactif();
  const rapports = [];
  try { for (const l of lots) rapports.push(await reparerFichier(l.f, l.codes)); }
  finally { S.enCours = false; occupe(bouton, false); }
  rendreFichiers(); chargerJournal();
  afficherRapport(rapports);
  return rapports;
}
function rendreFichiersSiInactif() { $('#tout-corriger').disabled = true; }

/** Répare un classeur et contrôle réellement le résultat. Renvoie un rapport détaillé. */
async function reparerFichier(f, codes) {
  const rap = { nom: f.nom, chemin: f.chemin, lignes: [], copie: null, avant: null, apres: null };
  const ligne = (etat, texte) => rap.lignes.push({ etat, texte });
  const titre = c => f.problemes.find(p => p.code === c)?.titre || c;
  // 1. lecture et copie de sécurité dans l'historique
  let avant = null;
  try { avant = await F.lireChemin(f.chemin); rap.avant = await controlerClasseur(avant, extension(f.chemin)); }
  catch (e) { ligne('echec', `Lecture impossible avant réparation (${e.message}) : rien n'a été modifié.`); return rap; }
  if (H) {
    try { rap.copie = await H.capturer({ octets: avant, chemin: f.chemin, nom: f.nom, raison: 'Avant réparation (Dépannage)', origine: 'depannage' }); ligne('info', `Copie de sécurité dans l'historique des versions : ${rap.copie.deja ? 'déjà présente et vérifiée' : 'créée et vérifiée'}.`); }
    catch (e) {
      const ok = await confirmer('Copie de sécurité impossible', `« ${f.nom} » n'a pas pu être copié dans l'historique (${e.message}). Le moteur fera tout de même sa propre sauvegarde avant correction. Continuer ?`, 'Continuer', true);
      if (!ok) { ligne('echec', 'Réparation abandonnée : pas de copie de sécurité.'); return rap; }
    }
  }
  // 2. correction par le moteur
  let r;
  try { r = await api('corriger', { chemin: f.chemin, codes }); }
  catch (e) { ligne('echec', `La correction a échoué : ${e.message}.`); return rap; }
  // 3. contrôle : relecture du fichier et nouvelle analyse
  let apres = null;
  try { apres = await F.lireChemin(f.chemin); rap.apres = await controlerClasseur(apres, extension(f.chemin)); } catch (e) { rap.apres = { lisible: false, detail: 'Fichier introuvable après réparation : ' + e.message, points: [] }; }
  const modifie = !!(apres && rap.avant && rap.apres.sha256 !== rap.avant.sha256);
  const analyse = r.analyse || (await api('analyser', { chemins: [f.chemin] })).fichiers?.[0];
  for (const c of codes) {
    const res = (r.resultats || []).find(x => x.code === c);
    const encore = (analyse?.problemes || []).some(p => p.code === c);
    if (res && !res.ok) ligne('echec', `${titre(c)} — échec : ${res.texte}`);
    else if (encore) ligne('non-applique', `${titre(c)} — non corrigé : le problème est toujours détecté après l'opération${modifie ? '' : ' et le fichier n\'a pas été modifié'}.`);
    else ligne('verifie', `${titre(c)} — corrigé et vérifié : le problème n'est plus détecté${res?.texte ? ` (${res.texte.replace(/\.$/, '')})` : ''}.`);
  }
  // 4. le fichier obtenu doit rester lisible : sinon la version d'origine est remise en place
  if (rap.avant?.lisible && !rap.apres?.lisible) {
    try {
      await F.enregistrerFichier({ octets: avant, chemin: f.chemin });
      const relu = await F.lireChemin(f.chemin);
      if (await sha256(relu) !== rap.avant.sha256) throw new Error('la relecture ne correspond pas');
      rap.lignes.forEach(l => { if (l.etat === 'verifie') l.etat = 'annule'; });
      ligne('annule', `Le fichier obtenu ne se relisait plus (${rap.apres.detail}) : la version d'origine a été remise en place et vérifiée.`);
      rap.apres = rap.avant;
    } catch (e) { ligne('echec', `Le fichier obtenu ne se relit plus et la remise en place a échoué (${e.message}) : restaurez-le depuis l'historique des versions de Calcul.`); }
  } else if (rap.apres) {
    ligne(rap.apres.lisible ? 'verifie' : 'echec', rap.apres.lisible ? `Fichier relu par Calcul après réparation : ${rap.apres.detail.replace(/^Lisible par Calcul : /, '')}.` : `Le fichier reste illisible par Calcul (${rap.apres.detail}).`);
  }
  // fichiers créés par la correction (ex. conversion .xls → .xlsx)
  for (const x of (r.resultats || []).filter(x => x.chemin && x.ok)) {
    const c = await controleCalcul(x.chemin);
    ligne(c.lisible ? 'verifie' : 'echec', `Nouveau fichier ${x.chemin.split(/[\\/]/).pop()} : ${c.lisible ? 'relu et lisible' : 'illisible'} (${c.detail}).`);
    ajouter([x.chemin]);
  }
  // 5. copie de la version réparée dans l'historique
  if (H && modifie && rap.apres?.lisible) { try { await H.capturer({ octets: apres, chemin: f.chemin, nom: f.nom, raison: 'Après réparation (Dépannage)', origine: 'depannage' }); } catch { } }
  if (analyse) majAnalyse({ ...analyse, calcul: rap.apres?.sha256 ? rap.apres : await controleCalcul(f.chemin) });
  S.ouverts.add(f.chemin);
  return rap;
}

const ETIQ = { verifie: ['ok', 'Vérifié'], 'non-applique': ['alerte', 'Non appliqué'], echec: ['erreur', 'Échec'], annule: ['alerte', 'Annulé'], info: ['info', 'Info'] };
function afficherRapport(rapports) {
  const z = $('#resultat-auto');
  const n = t => rapports.reduce((s, r) => s + r.lignes.filter(l => l.etat === t && !/^Fichier relu|^Nouveau fichier/.test(l.texte)).length, 0);
  const ok = n('verifie'), ko = n('echec') + n('non-applique') + n('annule');
  z.innerHTML = `<h3>${ok ? `${ok} correction${ok > 1 ? 's' : ''} vérifiée${ok > 1 ? 's' : ''}` : 'Aucune correction vérifiée'}${ko ? ` · ${ko} non réussie${ko > 1 ? 's' : ''}` : ''}</h3>
    ${rapports.map(r => `<div class="rapport-fichier"><b>${esc(r.nom)}</b>${r.avant ? ` <small>avant : ${esc(r.avant.lisible ? 'lisible par Calcul' : 'illisible par Calcul')}${r.apres ? ` · après : ${esc(r.apres.lisible ? 'lisible par Calcul' : 'illisible par Calcul')}` : ''}</small>` : ''}
      <ul>${r.lignes.map(l => `<li class="r-${l.etat}"><span class="etat ${ETIQ[l.etat][0]}">${ETIQ[l.etat][1]}</span> ${esc(l.texte)}</li>`).join('')}</ul></div>`).join('')}`;
  z.classList.remove('masque');
  z.scrollIntoView({ block: 'nearest' });
}

async function reparerTout() {
  const lots = S.fichiers.map(f => ({ f, codes: (f.problemes || []).filter(estSure).map(p => p.code) })).filter(l => l.codes.length);
  if (!lots.length) { toast('Aucune correction sûre à appliquer. Les interventions avec Excel se lancent une par une.', 'info'); return; }
  return reparerAvecPlan(lots, $('#tout-corriger'));
}
function occupe(b, oui) {
  if (!b) return;
  b.disabled = oui;
  if (oui) { b.dataset.html = b.innerHTML; b.innerHTML = `${ico('refresh-cw', 'p tourne')}<span>Réparation…</span>`; }
  else if (b.isConnected && b.dataset.html) b.innerHTML = b.dataset.html;
}

// ----- Excel et Windows (facultatif) -----
const ETAT_V = { ok: ['ok', 'Bon'], alerte: ['alerte', 'À vérifier'], erreur: ['erreur', 'Problème'], info: ['info', 'Info'] };
async function chargerPoste() {
  $('#liste-poste').innerHTML = `<div class="vide-dep">${ico('refresh-cw', 'tourne')}<p>Vérification d'Excel et du presse-papiers (lecture seule)…</p></div>`;
  try { S.poste = (await api('poste')).verifications || []; } catch (e) { S.poste = []; }
  rendrePoste();
}
function rendrePoste() {
  const z = $('#liste-poste');
  const ordre = { erreur: 0, alerte: 1, info: 2, ok: 3 };
  const l = [...S.poste].sort((a, b) => ordre[a.etat] - ordre[b.etat]);
  const nPb = l.filter(v => v.etat === 'erreur' || v.etat === 'alerte').length;
  const res = $('#resume-poste'); res.className = 'etat ' + (nPb ? 'alerte' : 'ok'); res.textContent = nPb ? `${nPb} point(s) à voir` : 'Rien à signaler';
  z.innerHTML = l.map(v => {
    const [cls, txt] = ETAT_V[v.etat] || ETAT_V.info;
    return `<div class="verif" data-code="${esc(v.code)}"><span class="pastille-v ${cls}"></span>
      <div class="txt"><div style="font-weight:600">${esc(v.titre)} <span class="etat ${cls}" style="margin-left:4px">${txt}</span></div><div class="detail-p" style="color:var(--encre-2);font-size:13px;margin-top:2px">${esc(v.detail)}</div>
      ${v.elements?.length ? `<div class="elements">${v.elements.map(e => `<div class="element"><span title="${esc(e.nom)}">${esc(e.nom)}${e.detail ? ` <small>— ${esc(e.detail)}</small>` : ''}</span>${e.action ? `<button class="btn petit" data-element="${esc(e.id)}">${esc(e.action)}…</button>` : ''}</div>`).join('')}</div>` : ''}
      ${v.action ? `<div style="margin-top:8px"><button class="btn petit" data-action>${esc(v.action)}…</button></div>` : ''}</div></div>`;
  }).join('') || `<div class="vide-dep"><p>Aucune vérification disponible.</p></div>`;
  $$('.verif', z).forEach(n => {
    const v = S.poste.find(x => x.code === n.dataset.code);
    const b = $('[data-action]', n);
    if (b) b.onclick = () => corrigerPoste(v.code, '', b, v, v.action);
    $$('[data-element]', n).forEach(be => be.onclick = () => corrigerPoste(v.code === 'presse-papiers' ? 'presse-papiers-processus' : v.code, be.dataset.element, be, v, be.textContent.replace(/…$/, '')));
  });
}
async function corrigerPoste(code, param, bouton, v, libelle) {
  const r0 = await dialogue({
    titre: 'Intervention sur le poste', contenu: `<p><b>${esc(libelle || v.action || v.titre)}</b></p><p>${esc(v.detail)}</p>
      ${v.avertissement ? `<div class="plan-avert">${ico('triangle-alert', 'p')}<div><p>${esc(v.avertissement)}</p></div></div>` : ''}
      <p class="texte-aide">Cette action agit sur Excel ou Windows, pas sur vos classeurs. Elle est inscrite dans l'historique des corrections et peut y être annulée lorsque c'est possible. Le résultat est vérifié par une nouvelle analyse du poste.</p>`,
    boutons: [{ label: 'Annuler', valeur: null }, { label: 'Confirmer', valeur: true, primaire: true, id: 'confirmer-poste' }],
  });
  if (!r0) return;
  occupe(bouton, true);
  try {
    const r = await api('poste/corriger', { code, parametre: param });
    S.poste = r.verifications || S.poste; rendrePoste();
    const ko = (r.resultats || []).filter(x => !x.ok), ok = (r.resultats || []).filter(x => x.ok);
    const apres = S.poste.find(x => x.code === v.code);
    if (ko.length) toast(ko.map(x => x.texte).join(' '), 'erreur', { duree: 8000 });
    else if (ok.length && (!apres || apres.etat === 'ok' || apres.etat === 'info')) toast(ok.map(x => x.texte).join(' ') + ' Vérifié par une nouvelle analyse.', 'succes');
    else if (ok.length) toast(ok.map(x => x.texte).join(' ') + ' La nouvelle analyse signale encore : ' + (apres?.titre || 'un point à voir') + '.', 'alerte', { duree: 9000 });
    else toast('Aucun changement constaté.', 'info');
    chargerJournal();
  } catch (e) { toast(e.message || String(e), 'erreur'); }
  finally { occupe(bouton, false); }
}

// ----- Historique des corrections -----
async function chargerJournal() {
  try { S.journal = (await api('journal')).entrees || []; } catch { S.journal = []; }
  const z = $('#liste-historique');
  if (!S.journal.length) { z.innerHTML = `<div class="vide-dep" style="padding:18px"><p style="margin:0">Les corrections apparaîtront ici, avec la possibilité de les annuler.</p></div>`; return; }
  z.innerHTML = S.journal.slice(0, 40).map(e => {
    const d = new Date(e.date);
    const annulable = !e.annule && (e.sauvegarde || e.registre);
    return `<div class="entree${e.annule ? ' annule' : ''}" data-id="${esc(e.id)}"><span class="quand">${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="quoi">${esc(e.texte)}${e.fichier ? `<small>${esc(e.fichier)}</small>` : ''}</span>
      ${annulable ? `<button class="btn petit" data-annuler>${ico('undo-2', 'p')}<span>Annuler</span></button>` : e.annule ? '<span class="etat info">Annulé</span>' : ''}</div>`;
  }).join('');
  $$('[data-annuler]', z).forEach(b => b.onclick = async () => {
    const id = b.closest('.entree').dataset.id;
    const e = S.journal.find(x => x.id === id);
    if (!await confirmer('Annuler la correction', 'Le fichier ou le réglage retrouvera son état d\'avant la correction. La version actuelle du classeur est d\'abord copiée dans l\'historique des versions.', 'Annuler la correction')) return;
    try {
      if (H && e?.fichier) { try { await H.capturer({ octets: await F.lireChemin(e.fichier), chemin: e.fichier, raison: 'Avant annulation d\'une correction', origine: 'depannage' }); } catch { } }
      await api('annuler', { id });
      toast('Correction annulée.', 'succes');
      chargerJournal();
      if (e?.fichier && S.fichiers.some(f => f.chemin === e.fichier)) { for (const a of await analyser([e.fichier])) majAnalyse(a); rendreFichiers(); }
      chargerPoste();
    } catch (err) { toast(err.message || String(err), 'erreur'); }
  });
}

// ----- Démarrage -----
rendreFichiers();
chargerPoste();
chargerJournal();
if (H) setTimeout(() => H.reparer().catch(() => { }), 2000);
if (F.SESSION?.fichier) ajouter([F.SESSION.fichier]);
window.__depannage = { S, ajouter, reparerTout, executer, reparerFichier, chargerPoste, corrigerPoste };
