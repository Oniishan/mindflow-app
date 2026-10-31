// Dépannage — classeurs Excel et dysfonctionnements d'Excel sur le poste
import { $, $$, el, esc, ico, toast, confirmer, dialogue, appliquerTheme, formatOctets } from './commun/ui.js';
import * as F from './commun/fichiers.js';

const S = { fichiers: [], ouverts: new Set(), poste: [], journal: [], enCours: false };
const api = (chemin, corps) => F.appelApi('/api/depannage/' + chemin, corps || {});
const GRAVITE = { erreur: 0, alerte: 1, info: 2 };

// ----- Barre de titre -----
const barre = $('#barre-titre');
barre.innerHTML = `<div class="tuile" aria-hidden="true">Dp</div><span class="nom-doc" style="cursor:default">Dépannage</span><span class="espace"></span>
  <button class="btn-t" id="theme" title="Thème de l'affichage">${ico('settings', 'p')}<span>Affichage</span></button>
  <button class="btn-t" id="aide" title="Aide">${ico('circle-help', 'p')}<span>Aide</span></button>`;
F.definirTitre('Dépannage');

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
  <p><b>1. Ajoutez les classeurs</b> qui posent problème (ou tout un dossier). Chacun est analysé aussitôt : son état apparaît à droite de son nom, cliquez dessus pour voir le détail.</p>
  <p><b>2. Cliquez sur « Tout corriger automatiquement ».</b> Ne sont appliquées que les corrections sans risque : déblocage des fichiers venus d'Internet ou d'un courriel, suppression des verrous laissés par un Excel fermé brutalement, nettoyage des styles et formats accumulés par les copier-coller, fermeture des Excel invisibles, libération du presse-papiers.</p>
  <p><b>3. Les autres corrections</b> se font une par une, avec leur bouton : lever la protection d'une feuille, convertir un ancien .xls, réparer un classeur endommagé avec Excel, rompre des liaisons, désactiver un complément…</p>
  <p>Avant chaque modification d'un classeur, une copie est mise de côté. L'historique en bas de la page permet d'<b>annuler</b> une correction à tout moment.</p>
  <p><b>Le copier-coller ne marche plus ?</b> Les causes les plus fréquentes sont vérifiées dans « Excel sur ce poste » : presse-papiers retenu par une application, Excel invisible en arrière-plan, session à distance, styles en trop dans le classeur, complément défaillant.</p>` });

// ----- Boutons -----
$('#tout-corriger').innerHTML = `${ico('list-checks')}<span>Tout corriger automatiquement</span>`;
$('#ajouter-fichiers').innerHTML = `${ico('file-plus')}<span>Ajouter des classeurs</span>`;
$('#ajouter-dossier').innerHTML = `${ico('folder-open')}<span>Ajouter un dossier</span>`;
$('#vider').innerHTML = ico('trash-2');
$('#reanalyser-poste').innerHTML = ico('refresh-cw');
$('#ouvrir-sauvegardes').innerHTML = `${ico('folder-open')}<span>Ouvrir les sauvegardes</span>`;

const FILTRES = [{ nom: 'Classeurs Excel', ext: ['xlsx', 'xlsm', 'xls', 'xlsb', 'xltx', 'xltm', 'csv'] }];
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
$('#tout-corriger').onclick = () => toutCorriger();

async function ajouter(chemins) {
  const nouveaux = chemins.filter(c => !S.fichiers.some(f => f.chemin.toLowerCase() === c.toLowerCase()));
  if (!nouveaux.length) return;
  for (const c of nouveaux) S.fichiers.push({ chemin: c, nom: c.split(/[\\/]/).pop(), attente: true, problemes: [] });
  rendreFichiers();
  for (let i = 0; i < nouveaux.length; i += 20) {
    const r = await api('analyser', { chemins: nouveaux.slice(i, i + 20) });
    for (const a of r.fichiers || []) majAnalyse(a);
    rendreFichiers();
  }
  if (nouveaux.length === 1) { S.ouverts.add(nouveaux[0]); rendreFichiers(); }
}
function majAnalyse(a) {
  const i = S.fichiers.findIndex(f => f.chemin === a.chemin);
  if (i >= 0) S.fichiers[i] = a; else S.fichiers.push(a);
}

// ----- Rendu des classeurs -----
function etatFichier(f) {
  if (f.attente) return ['attente', 'Analyse…'];
  if (f.erreur) return ['erreur', 'Illisible'];
  const p = (f.problemes || []).filter(x => x.gravite !== 'info' || x.corrigeable);
  const g = p.reduce((m, x) => Math.min(m, GRAVITE[x.gravite] ?? 2), 9);
  if (!p.length) return ['ok', 'Aucun problème'];
  const n = p.length + (p.length > 1 ? ' points' : ' point');
  return [g === 0 ? 'erreur' : g === 1 ? 'alerte' : 'info', n + ' à voir'];
}
function rendreFichiers() {
  const z = $('#liste-fichiers');
  $('#vider').classList.toggle('masque', !S.fichiers.length);
  if (!S.fichiers.length) {
    z.innerHTML = `<div class="vide-dep"><p>Ajoutez le classeur qui ne s'ouvre plus, refuse le copier-coller, s'affiche en lecture seule ou se dit « déjà utilisé ».</p>
      <button class="btn primaire" data-a="fichiers">${ico('file-plus')}<span>Ajouter des classeurs</span></button></div>`;
    $('[data-a="fichiers"]', z).onclick = () => $('#ajouter-fichiers').click();
    return;
  }
  z.innerHTML = S.fichiers.map((f, i) => {
    const [cls, txt] = etatFichier(f);
    const ouvert = S.ouverts.has(f.chemin);
    const probs = [...(f.problemes || [])].sort((a, b) => (GRAVITE[a.gravite] ?? 2) - (GRAVITE[b.gravite] ?? 2));
    const dossier = f.chemin.slice(0, f.chemin.length - f.nom.length).replace(/[\\/]$/, '');
    return `<div class="fichier" data-i="${i}">
      <div class="ligne-fichier" role="button" tabindex="0" aria-expanded="${ouvert}">${ico('file-spreadsheet', 'ico-f')}
        <div class="infos-f"><div class="nom">${esc(f.nom)}</div><div class="chemin">${esc(dossier)}${f.taille ? ' · ' + formatOctets(f.taille) : ''}</div></div>
        <span class="etat ${cls}">${f.attente ? ico('refresh-cw', 'p tourne') : ''}${esc(txt)}</span>${ico(ouvert ? 'chevron-up' : 'chevron-down', 'p')}</div>
      ${ouvert && !f.attente ? `<div class="detail-fichier">
        ${f.erreur ? `<div class="probleme"><span class="pastille-g erreur"></span><div class="txt"><div class="titre-p">${esc(f.erreur)}</div></div></div>` : ''}
        ${probs.length ? probs.map(p => `<div class="probleme"><span class="pastille-g ${p.gravite}"></span><div class="txt"><div class="titre-p">${esc(p.titre)}</div><div class="detail-p">${esc(p.detail)}</div></div>
          ${p.corrigeable ? `<button class="btn petit" data-corriger="${esc(p.code)}">${esc(p.action || 'Corriger')}</button>` : ''}</div>`).join('')
          : (!f.erreur ? `<div class="probleme"><span class="pastille-g ok"></span><div class="txt"><div class="titre-p">Rien d'anormal dans ce classeur</div><div class="detail-p">Si le problème persiste, il vient sans doute d'Excel : voir « Excel sur ce poste ».</div></div></div>` : '')}
        <div class="actions-f">${probs.some(p => p.auto) ? `<button class="btn primaire petit" data-a="auto">${ico('list-checks', 'p')}<span>Corriger automatiquement</span></button>` : ''}
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
    const act = (a, fn) => { const b = $(`[data-a="${a}"]`, n); if (b) b.onclick = fn; };
    act('auto', e => corrigerFichier(f, f.problemes.filter(p => p.auto).map(p => p.code), e.currentTarget));
    act('reanalyser', async () => { const r = await api('analyser', { chemins: [f.chemin] }); majAnalyse(r.fichiers[0]); rendreFichiers(); });
    act('emplacement', () => F.afficherDansExplorateur(f.chemin));
    act('retirer', () => { S.fichiers.splice(S.fichiers.indexOf(f), 1); S.ouverts.delete(f.chemin); rendreFichiers(); });
  });
}

const AVERTISSEMENTS = {
  'protection-feuille': ['Lever la protection des feuilles', 'Les cellules verrouillées deviendront modifiables. Ne le faites que pour un classeur dont vous avez la responsabilité ou avec l\'accord de son auteur.'],
  'protection-classeur': ['Lever la protection du classeur', 'La structure du classeur (ajout, suppression, renommage des feuilles) ne sera plus protégée.'],
  'mot-de-passe-ecriture': ['Retirer le mot de passe de modification', 'Le classeur s\'ouvrira directement en modification, sans mot de passe.'],
  liens: ['Rompre les liaisons', 'Les formules qui lisent d\'autres classeurs seront remplacées par leur dernière valeur connue.'],
};
async function corrigerUn(f, code, bouton) {
  const av = AVERTISSEMENTS[code];
  if (av && !await confirmer(av[0], av[1] + ' Une copie de sauvegarde est faite avant.', 'Continuer')) return;
  await corrigerFichier(f, code.startsWith('protection') || code === 'mot-de-passe-ecriture' ? ['protection-feuille', 'protection-classeur', 'mot-de-passe-ecriture'].filter(c => f.problemes.some(p => p.code === c)) : [code], bouton);
}
async function corrigerFichier(f, codes, bouton) {
  if (!codes.length) return;
  occupe(bouton, true);
  try {
    const r = await api('corriger', { chemin: f.chemin, codes });
    majAnalyse(r.analyse); S.ouverts.add(f.chemin); rendreFichiers();
    const ok = (r.resultats || []).filter(x => x.ok), ko = (r.resultats || []).filter(x => !x.ok);
    if (ko.length) toast(ko.map(x => x.texte).join(' '), 'erreur', { duree: 8000 });
    else if (ok.length) toast(ok.map(x => x.texte).join(' '), 'succes');
    const nouveau = (r.resultats || []).find(x => x.chemin);
    if (nouveau) ajouter([nouveau.chemin]);
    chargerJournal();
  } catch (e) { toast(e.message || String(e), 'erreur'); }
  finally { occupe(bouton, false); }
}
function occupe(b, oui) {
  if (!b) return;
  b.disabled = oui;
  if (oui) { b.dataset.html = b.innerHTML; b.innerHTML = `${ico('refresh-cw', 'p tourne')}<span>Correction…</span>`; }
  else if (b.isConnected && b.dataset.html) b.innerHTML = b.dataset.html;
}

// ----- Poste -----
const ETAT_V = { ok: ['ok', 'Bon'], alerte: ['alerte', 'À vérifier'], erreur: ['erreur', 'Problème'], info: ['info', 'Info'] };
async function chargerPoste() {
  $('#liste-poste').innerHTML = `<div class="vide-dep">${ico('refresh-cw', 'tourne')}<p>Vérification d'Excel et du presse-papiers…</p></div>`;
  try { S.poste = (await api('poste')).verifications || []; } catch (e) { S.poste = []; }
  rendrePoste();
}
function rendrePoste() {
  const z = $('#liste-poste');
  const ordre = { erreur: 0, alerte: 1, info: 2, ok: 3 };
  const l = [...S.poste].sort((a, b) => ordre[a.etat] - ordre[b.etat]);
  z.innerHTML = l.map((v, i) => {
    const [cls, txt] = ETAT_V[v.etat] || ETAT_V.info;
    return `<div class="verif" data-code="${esc(v.code)}"><span class="pastille-g ${cls}" style="width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:${cls === 'ok' ? 'var(--succes)' : cls === 'erreur' ? 'var(--danger)' : cls === 'alerte' ? '#C98A00' : 'var(--encre-3)'}"></span>
      <div class="txt"><div style="font-weight:600">${esc(v.titre)} <span class="etat ${cls}" style="margin-left:4px">${txt}</span></div><div class="detail-p" style="color:var(--encre-2);font-size:13px;margin-top:2px">${esc(v.detail)}</div>
      ${v.elements?.length ? `<div class="elements">${v.elements.map(e => `<div class="element"><span title="${esc(e.nom)}">${esc(e.nom)}${e.detail ? ` <small>— ${esc(e.detail)}</small>` : ''}</span>${e.action ? `<button class="btn petit" data-element="${esc(e.id)}">${esc(e.action)}</button>` : ''}</div>`).join('')}</div>` : ''}
      ${v.action ? `<div style="margin-top:8px"><button class="btn petit${v.etat === 'erreur' ? ' primaire' : ''}" data-action>${esc(v.action)}</button></div>` : ''}</div></div>`;
  }).join('') || `<div class="vide-dep"><p>Aucune vérification disponible.</p></div>`;
  $$('.verif', z).forEach(n => {
    const v = S.poste.find(x => x.code === n.dataset.code);
    const b = $('[data-action]', n);
    if (b) b.onclick = () => corrigerPoste(v.code, '', b, v);
    $$('[data-element]', n).forEach(be => be.onclick = () => corrigerPoste(v.code === 'presse-papiers' ? 'presse-papiers-processus' : v.code, be.dataset.element, be, v));
  });
}
async function corrigerPoste(code, param, bouton, v) {
  if (v?.avertissement && !await confirmer(v.titre, v.avertissement, 'Continuer', true)) return;
  occupe(bouton, true);
  try {
    const r = await api('poste/corriger', { code, parametre: param });
    S.poste = r.verifications || S.poste; rendrePoste();
    const ko = (r.resultats || []).filter(x => !x.ok), ok = (r.resultats || []).filter(x => x.ok);
    if (ko.length) toast(ko.map(x => x.texte).join(' '), 'erreur', { duree: 8000 }); else if (ok.length) toast(ok.map(x => x.texte).join(' '), 'succes');
    chargerJournal();
  } catch (e) { toast(e.message || String(e), 'erreur'); }
  finally { occupe(bouton, false); }
}

// ----- Correction automatique -----
async function toutCorriger() {
  if (S.enCours) return;
  S.enCours = true;
  const b = $('#tout-corriger'); occupe(b, true);
  const lignes = [];
  try {
    const r = await api('poste/corriger', { code: 'auto' });
    for (const x of r.resultats || []) lignes.push(x);
    S.poste = r.verifications || S.poste; rendrePoste();
    for (const f of S.fichiers) {
      const codes = (f.problemes || []).filter(p => p.auto).map(p => p.code);
      if (!codes.length) continue;
      const rf = await api('corriger', { chemin: f.chemin, codes });
      majAnalyse(rf.analyse);
      for (const x of rf.resultats || []) lignes.push({ ...x, texte: f.nom + ' : ' + x.texte });
    }
    rendreFichiers(); chargerJournal();
    const z = $('#resultat-auto');
    const ok = lignes.filter(x => x.ok && x.code !== 'auto').length, ko = lignes.filter(x => !x.ok).length;
    const restant = S.fichiers.reduce((n, f) => n + (f.problemes || []).filter(p => p.corrigeable && !p.auto).length, 0) + S.poste.filter(v => v.etat === 'erreur').length;
    z.innerHTML = `<h3>${ok ? `${ok} correction${ok > 1 ? 's' : ''} appliquée${ok > 1 ? 's' : ''}` : 'Aucune correction automatique nécessaire'}${ko ? ` · ${ko} impossible${ko > 1 ? 's' : ''}` : ''}</h3>
      <ul>${lignes.map(x => `<li class="${x.ok ? '' : 'echec'}">${esc(x.texte)}</li>`).join('')}</ul>
      ${restant ? `<p style="margin:8px 0 0;color:var(--encre-2)">${restant} point${restant > 1 ? 's' : ''} demande${restant > 1 ? 'nt' : ''} votre accord : utilisez les boutons à côté de chacun.</p>` : ''}
      ${!S.fichiers.length ? `<p style="margin:8px 0 0;color:var(--encre-2)">Ajoutez aussi le classeur concerné pour vérifier son contenu.</p>` : ''}`;
    z.classList.remove('masque');
  } catch (e) { toast(e.message || String(e), 'erreur'); }
  finally { S.enCours = false; occupe(b, false); }
}

// ----- Historique -----
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
    if (!await confirmer('Annuler la correction', 'Le fichier ou le réglage retrouvera son état d\'avant la correction.', 'Annuler la correction')) return;
    try {
      await api('annuler', { id });
      toast('Correction annulée.', 'succes');
      chargerJournal();
      const e = S.journal.find(x => x.id === id);
      if (e?.fichier && S.fichiers.some(f => f.chemin === e.fichier)) { const r = await api('analyser', { chemins: [e.fichier] }); majAnalyse(r.fichiers[0]); rendreFichiers(); }
      chargerPoste();
    } catch (err) { toast(err.message || String(err), 'erreur'); }
  });
}

// ----- Démarrage -----
rendreFichiers();
chargerPoste();
chargerJournal();
if (F.SESSION?.fichier) ajouter([F.SESSION.fichier]);
window.__depannage = { S, ajouter, toutCorriger, corrigerFichier, chargerPoste };
