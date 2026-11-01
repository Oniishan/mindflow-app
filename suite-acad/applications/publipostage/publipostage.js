// Publipostage — assistant en 4 étapes : données, modèle, contrôle et aperçu, génération
import { $, $$, el, esc, ico, toast, confirmer, dialogue, appliquerTheme, formatOctets, telechargerBlob } from './commun/ui.js';
import * as F from './commun/fichiers.js';
import { sha256 } from './commun/versions.js';
import { htmlVersPdf } from './commun/rendu-pdf.js';
import { zipSync, strToU8 } from './commun/vendor/fflate.js';
import * as M from './fusion.js';

const S = {
  etape: 1, donnees: null, feuille: null, avecEntetes: true, entetes: [], lignes: [], sel: new Set(), filtre: '',
  modele: null, source: 'word', texte: '', apercu: 0,
  sortie: { format: 'docx-un', motif: '', dossier: null, sousDossier: true, listeEnvoi: true },
  dernier: null, prefs: {},
};
const SEP = (F.SESSION?.plateforme || 'Windows').startsWith('Windows') ? '\\' : '/';
const joindre = (d, n) => d.replace(/[\\/]+$/, '') + SEP + n;
const FORMATS = {
  'docx-un': { ext: 'docx', unique: false, label: 'Un document Word par ligne', desc: 'Fidèle au modèle Word (mise en page, en-têtes, images).' },
  'docx-unique': { ext: 'docx', unique: true, label: 'Un seul document Word', desc: 'Toutes les lignes à la suite, une par page.' },
  'pdf-un': { ext: 'pdf', unique: false, label: 'Un PDF par ligne', desc: 'Mise en page simplifiée depuis un modèle Word.' },
  'pdf-unique': { ext: 'pdf', unique: true, label: 'Un seul PDF', desc: 'Toutes les lignes à la suite.' },
  'txt-un': { ext: 'txt', unique: false, label: 'Un fichier texte par ligne', desc: 'Modèle texte uniquement.', texteSeul: true },
};

// ---------- Barre de titre ----------
$('#barre-titre').innerHTML = `<div class="tuile" aria-hidden="true">PJ</div><span class="nom-doc" style="cursor:default">Publipostage</span><span class="espace"></span>
  <button class="btn-t" id="b-aide" title="Aide">${ico('circle-help', 'p')}<span>Aide</span></button>`;
F.definirTitre('Publipostage');
$('#confidentialite').textContent = 'Traitement sur ce poste : aucun fichier n\'est envoyé sur Internet.';
$('#b-aide').onclick = () => dialogue({ titre: 'Publipostage : mode d\'emploi', taille: 'large', boutons: [{ label: 'Compris', valeur: true, primaire: true }], contenu: `
  <p><b>1. Données.</b> Un tableau Excel, OpenDocument ou CSV : une ligne par destinataire, la première ligne contient les titres de colonnes. Décochez les lignes à ne pas traiter.</p>
  <p><b>2. Modèle.</b> Un document Word dans lequel les noms de colonnes sont écrits entre accolades, par exemple <code>{Nom}</code>. Les champs de fusion de Word et la forme <code>«Nom»</code> sont aussi reconnus. <code>{Prénom|Madame, Monsieur}</code> donne une valeur par défaut si la cellule est vide. Vous pouvez aussi rédiger un modèle texte directement ici, ou créer un modèle Word express à compléter.</p>
  <p><b>3. Contrôle et aperçu.</b> Les champs sans colonne, valeurs manquantes, doublons et adresses invalides sont signalés. L'aperçu montre le document de chaque destinataire, valeurs surlignées.</p>
  <p><b>4. Génération.</b> Un document par ligne (Word ou PDF) ou un document unique, dans le dossier choisir. Les noms de fichiers sont rendus sûrs et rien n'est écrasé. Chaque fichier est relu après écriture. Une liste d'envoi (adresse + fichier) peut être produite pour l'envoi avec Fusion PJ dans Thunderbird.</p>` });

// ---------- Navigation ----------
function aller(n) {
  S.etape = n;
  $$('.etape-pp').forEach((e, i) => e.classList.toggle('masque', i + 1 !== n));
  $$('#etapes button').forEach(b => { const k = +b.dataset.etape; b.classList.toggle('actif', k === n); b.classList.toggle('fait', k < n && etapeValide(k)); b.setAttribute('aria-current', k === n ? 'step' : 'false'); });
  $('#precedent').innerHTML = `${ico('arrow-left', 'p')}<span>Précédent</span>`; $('#precedent').disabled = n === 1;
  $('#suivant').innerHTML = n === 4 ? `${ico('check', 'p')}<span>Terminé</span>` : `<span>Suivant</span>${ico('arrow-right', 'p')}`;
  $('#suivant').classList.toggle('masque', n === 4);
  ({ 1: rendre1, 2: rendre2, 3: rendre3, 4: rendre4 })[n]();
  majResumes();
}
const etapeValide = k => k === 1 ? !!S.donnees && lignesChoisies().length > 0 : k === 2 ? !!S.modele && !S.modele.erreurs.length : true;
$$('#etapes button').forEach(b => b.onclick = () => { const k = +b.dataset.etape; if (k > 1 && !etapeValide(1)) return toast('Choisissez d\'abord les données.', 'info'); if (k > 2 && !etapeValide(2)) return toast('Choisissez d\'abord un modèle valide.', 'info'); aller(k); });
$('#precedent').onclick = () => S.etape > 1 && aller(S.etape - 1);
$('#suivant').onclick = () => { if (!etapeValide(S.etape)) return toast(S.etape === 1 ? 'Chargez un tableau et gardez au moins une ligne cochée.' : 'Choisissez un modèle sans erreur.', 'info'); aller(S.etape + 1); };
function majResumes() {
  $('#r1').textContent = S.donnees ? `${lignesChoisies().length}/${S.lignes.filter(l => !l.vide).length} lignes · ${S.donnees.nom}` : 'à choisir';
  $('#r2').textContent = S.modele ? `${S.modele.champs.length} champ(s) · ${S.modele.nom}` : 'à choisir';
  $('#r3').textContent = S.modele && S.donnees ? (() => { const c = controlesActuels(); const n = c.filter(p => p.gravite === 'erreur' || p.gravite === 'alerte').length; return n ? `${n} point(s) à voir` : 'prêt'; })() : '';
  $('#r4').textContent = S.dernier ? `${S.dernier.ok} document(s) produit(s)` : FORMATS[S.sortie.format].label;
}
const lignesChoisies = () => S.lignes.filter(l => !l.vide && S.sel.has(l.num));

// ---------- Étape 1 : données ----------
const FILTRES_DONNEES = [{ nom: 'Tableaux', ext: ['xlsx', 'xlsm', 'xls', 'ods', 'csv', 'txt'] }];
async function ouvrirDonnees() {
  const f = await F.ouvrirFichier({ titre: 'Tableau des destinataires', filtres: FILTRES_DONNEES });
  if (f) chargerDonnees(f);
}
function chargerDonnees(f) {
  try {
    const lect = M.lireDonnees(f.octets, f.nom);
    S.donnees = { nom: f.nom, chemin: f.chemin, lecteur: lect, taille: f.octets.length };
    S.feuille = lect.feuilles[0]; lireFeuille();
    toast(`${S.lignes.filter(l => !l.vide).length} ligne(s) chargée(s) depuis ${f.nom}.`, 'succes');
  } catch (e) { toast(`Impossible de lire ${f.nom} : ${e.message}`, 'erreur'); }
  rendre1(); majResumes();
}
function lireFeuille() {
  const r = S.donnees.lecteur.lire(S.feuille, S.avecEntetes);
  S.entetes = r.entetes; S.lignes = r.lignes; S.sel = new Set(r.lignes.filter(l => !l.vide).map(l => l.num)); S.apercu = 0;
  if (!S.sortie.motif || S.sortie.motifAuto) { S.sortie.motif = motifAuto(); S.sortie.motifAuto = true; }
}
function motifAuto() {
  const fic = S.entetes.find(h => /^(fichier|nomfichier|nomdufichier|filename)$/.test(M.normaliser(h)));
  if (fic) return `{${fic}}`;
  const nom = S.entetes.find(h => /^(nom|name|nomdefamille)$/.test(M.normaliser(h))) || S.entetes[0];
  const pre = S.entetes.find(h => /^(prenom|firstname)$/.test(M.normaliser(h)));
  return (S.modele ? M.nomSur(S.modele.nom.replace(/\.[^.]+$/, '')) + '_' : 'Document_') + (nom ? `{${nom}}` : '{#}') + (pre ? `_{${pre}}` : '');
}
function rendre1() {
  const z = $('#e1');
  if (!S.donnees) {
    z.innerHTML = `<h1 id="t1">1. Les données</h1><p class="texte-aide">Un tableau avec une ligne par destinataire ; la première ligne contient les titres des colonnes (Nom, Prénom, Adresse, Courriel…).</p>
      <div class="depot-pp" tabindex="0" role="button" id="depot-donnees">${ico('file-spreadsheet', 'g')}<b>Ouvrir le tableau des destinataires</b>Excel (.xlsx, .xlsm, .xls), OpenDocument (.ods) ou CSV — ou déposez le fichier ici</div>`;
    activerDepot($('#depot-donnees'), ouvrirDonnees, chargerDonnees);
    return;
  }
  const visibles = S.lignes.filter(l => !l.vide && (!S.filtre || l.valeurs.some(v => String(v).toLowerCase().includes(S.filtre.toLowerCase()))));
  const nVides = S.lignes.filter(l => l.vide).length;
  z.innerHTML = `<h1 id="t1">1. Les données</h1>
    <div class="carte-pp"><div class="ligne-pp"><div class="fichier-pp" style="flex:1">${ico('file-spreadsheet', 'g')}<div><div class="n">${esc(S.donnees.nom)}</div><small>${esc(S.donnees.chemin || '')} · ${formatOctets(S.donnees.taille)}</small></div></div>
      ${S.donnees.lecteur.feuilles.length > 1 ? `<label class="champ-ligne">Feuille <select id="feuille">${S.donnees.lecteur.feuilles.map(n => `<option ${n === S.feuille ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
      <label class="champ-ligne"><input type="checkbox" id="entetes" ${S.avecEntetes ? 'checked' : ''}> La première ligne contient les titres</label>
      <button class="btn" id="changer-donnees">${ico('folder-open', 'p')}<span>Changer de tableau</span></button></div></div>
    <div class="stats-pp"><span class="stat-pp"><b>${S.lignes.length - nVides}</b>lignes</span><span class="stat-pp"><b>${S.entetes.length}</b>colonnes</span><span class="stat-pp"><b>${lignesChoisies().length}</b>sélectionnées</span>${nVides ? `<span class="stat-pp"><b>${nVides}</b>lignes vides ignorées</span>` : ''}</div>
    <div class="carte-pp"><div class="ligne-pp" style="margin-bottom:8px"><h2 style="margin:0;flex:1">Lignes à traiter</h2>
      <input type="search" id="filtre" placeholder="Filtrer les lignes…" value="${esc(S.filtre)}" style="height:30px;padding:0 8px;border:1px solid var(--ligne-forte);border-radius:6px;background:var(--surface);color:var(--encre)">
      <button class="btn petit" id="tout">Tout cocher${S.filtre ? ' (filtrées)' : ''}</button><button class="btn petit" id="rien">Tout décocher${S.filtre ? ' (filtrées)' : ''}</button></div>
      <div class="tableau-pp"><table><thead><tr><th></th><th>Ligne</th>${S.entetes.map(h => `<th title="${esc(h)}">${esc(h)}</th>`).join('')}</tr></thead><tbody>
      ${visibles.slice(0, 500).map(l => `<tr data-num="${l.num}" class="${S.sel.has(l.num) ? '' : 'exclue'}"><td><input type="checkbox" aria-label="Ligne ${l.num}" ${S.sel.has(l.num) ? 'checked' : ''}></td><td>${l.num}</td>${l.valeurs.map(v => `<td class="${String(v).trim() ? '' : 'vide'}" title="${esc(v)}">${esc(v)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>${visibles.length > 500 ? `<p class="texte-aide">${visibles.length - 500} ligne(s) de plus ne sont pas affichées ; elles restent traitées selon leur case.</p>` : ''}</div>`;
  $('#changer-donnees').onclick = ouvrirDonnees;
  const sf = $('#feuille'); if (sf) sf.onchange = () => { S.feuille = sf.value; lireFeuille(); rendre1(); majResumes(); };
  $('#entetes').onchange = e => { S.avecEntetes = e.target.checked; lireFeuille(); rendre1(); majResumes(); };
  const fi = $('#filtre'); fi.oninput = () => { S.filtre = fi.value; const p = fi.selectionStart; rendre1(); const n = $('#filtre'); n.focus(); n.setSelectionRange(p, p); };
  $('#tout').onclick = () => { visibles.forEach(l => S.sel.add(l.num)); rendre1(); majResumes(); };
  $('#rien').onclick = () => { visibles.forEach(l => S.sel.delete(l.num)); rendre1(); majResumes(); };
  $$('tbody tr', z).forEach(tr => $('input', tr).onchange = e => { const n = +tr.dataset.num; e.target.checked ? S.sel.add(n) : S.sel.delete(n); tr.classList.toggle('exclue', !e.target.checked); majResumes(); });
}
function activerDepot(zone, clic, charger) {
  zone.onclick = clic; zone.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clic(); } };
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('survol'); };
  zone.ondragleave = () => zone.classList.remove('survol');
  zone.ondrop = async e => { e.preventDefault(); zone.classList.remove('survol'); const f = e.dataTransfer.files[0]; if (f) charger({ nom: f.name, chemin: null, octets: new Uint8Array(await f.arrayBuffer()) }); };
}

// ---------- Étape 2 : modèle ----------
const FILTRES_MODELE = [{ nom: 'Modèles Word', ext: ['docx', 'dotx', 'docm', 'dotm'] }, { nom: 'Texte', ext: ['txt'] }];
async function ouvrirModele() {
  const f = await F.ouvrirFichier({ titre: 'Modèle de document', filtres: FILTRES_MODELE });
  if (f) chargerModele(f);
}
function chargerModele(f) {
  try {
    if (/\.txt$/i.test(f.nom)) { S.source = 'texte'; S.texte = new TextDecoder().decode(f.octets); S.modele = M.preparerModeleTexte(S.texte, f.nom); }
    else { S.source = 'word'; S.modele = M.preparerModeleWord(f.octets, f.nom); S.modele.chemin = f.chemin; }
    if (S.sortie.motifAuto) S.sortie.motif = motifAuto();
    if (S.source === 'word' && S.sortie.format === 'txt-un') S.sortie.format = 'docx-un';
    toast(`Modèle chargé : ${S.modele.champs.length} champ(s).`, S.modele.erreurs.length ? 'erreur' : 'succes');
  } catch (e) { toast(`Modèle illisible : ${e.message}`, 'erreur'); }
  rendre2(); majResumes();
}
function puceChamp(c) {
  const i = c.nom === '#' ? 0 : M.colonneDe(S.entetes, c.nom);
  const cls = c.nom === '#' ? 'ok' : i >= 0 ? 'ok' : c.defaut !== null ? 'def' : 'ko';
  return `<span class="puce-pp ${cls}" title="${cls === 'ko' ? 'Aucune colonne ne correspond' : cls === 'def' ? 'Pas de colonne : valeur par défaut utilisée' : 'Colonne « ' + esc(S.entetes[i] || 'numéro de ligne') + ' »'}">${ico(cls === 'ko' ? 'circle-x' : cls === 'def' ? 'triangle-alert' : 'circle-check', 'p')}{${esc(c.balise)}}</span>`;
}
function rendre2() {
  const z = $('#e2');
  const m = S.modele;
  z.innerHTML = `<h1 id="t2">2. Le modèle</h1>
    <div class="choix-pp" role="radiogroup" aria-label="Type de modèle">
      <label><input type="radio" name="src" value="word" ${S.source === 'word' ? 'checked' : ''}><span><b>Document Word</b><small>.docx, .dotx ou .docm contenant des {Champs}</small></span></label>
      <label><input type="radio" name="src" value="texte" ${S.source === 'texte' ? 'checked' : ''}><span><b>Texte rédigé ici</b><small>Courrier simple, champs insérés en un clic</small></span></label>
    </div>
    <div id="zone-modele"></div>
    ${m ? `<div class="carte-pp"><h2>${ico('list-checks', 'p')} Champs du modèle</h2>${m.champs.length ? `<div class="puces-pp">${m.champs.map(puceChamp).join('')}</div>` : '<p class="texte-aide">Aucun champ trouvé dans le modèle.</p>'}
      ${m.erreurs.map(e => `<div class="avert-pp" style="margin-top:8px;background:var(--danger-doux)">${ico('circle-x', 'p')}<span>${esc(e)}</span></div>`).join('')}
      ${m.avertissements.map(e => `<div class="avert-pp" style="margin-top:8px">${ico('info', 'p')}<span>${esc(e)}</span></div>`).join('')}</div>` : ''}
    ${S.entetes.length ? `<div class="carte-pp"><h2>${ico('table', 'p')} Colonnes disponibles</h2><p class="texte-aide" style="margin-top:0">${S.source === 'texte' ? 'Cliquez pour insérer le champ à l\'emplacement du curseur.' : 'Cliquez pour copier le champ, puis collez-le dans votre document Word.'} <code>{#}</code> donne le numéro du document.</p>
      <div class="puces-pp">${[...S.entetes, '#'].map(h => `<button class="puce-pp" data-champ="${esc(h)}">${ico('plus', 'p')}${esc(h === '#' ? 'N° du document' : h)}</button>`).join('')}</div></div>` : ''}`;
  $$('[name="src"]', z).forEach(r => r.onchange = () => { S.source = r.value; if (S.source === 'texte') { S.modele = M.preparerModeleTexte(S.texte || modeleTexteDefaut(), 'Modèle texte'); S.texte = S.modele.texte; if (S.sortie.format === 'docx-unique') S.sortie.format = 'docx-un'; } else S.modele = null; rendre2(); majResumes(); });
  const zm = $('#zone-modele');
  if (S.source === 'word') {
    zm.innerHTML = m && m.type === 'docx' ? `<div class="carte-pp"><div class="ligne-pp"><div class="fichier-pp" style="flex:1">${ico('file-text', 'g')}<div><div class="n">${esc(m.nom)}</div><small>${esc(m.chemin || '')}</small></div></div><button class="btn" id="changer-modele">${ico('folder-open', 'p')}<span>Changer de modèle</span></button></div></div>`
      : `<div class="depot-pp" tabindex="0" role="button" id="depot-modele">${ico('file-text', 'g')}<b>Ouvrir le modèle Word</b>Les noms de colonnes sont écrits entre accolades : {Nom}, {Prénom}… — ou déposez le fichier ici</div>
        ${S.entetes.length ? `<p class="texte-aide">Pas encore de modèle ? <button class="btn petit" id="express">${ico('file-plus', 'p')}<span>Créer un modèle Word express</span></button> avec un champ par colonne, à compléter dans Word.</p>` : ''}`;
    if ($('#depot-modele')) activerDepot($('#depot-modele'), ouvrirModele, chargerModele);
    if ($('#changer-modele')) $('#changer-modele').onclick = ouvrirModele;
    if ($('#express')) $('#express').onclick = creerExpress;
  } else {
    zm.innerHTML = `<div class="carte-pp"><textarea class="editeur-pp" id="editeur" spellcheck="true" aria-label="Texte du modèle">${esc(S.texte)}</textarea>
      <p class="texte-aide">Sortie en PDF, Word ou texte. Les lignes vides séparent les paragraphes.</p></div>`;
    const ed = $('#editeur');
    ed.oninput = () => { S.texte = ed.value; S.modele = M.preparerModeleTexte(S.texte, 'Modèle texte'); const zc = z.querySelector('.carte-pp:nth-of-type(1) .puces-pp'); majResumes(); clearTimeout(ed._t); ed._t = setTimeout(() => { const pos = ed.selectionStart; rendre2(); const n = $('#editeur'); n.focus(); n.setSelectionRange(pos, pos); }, 700); };
  }
  $$('[data-champ]', z).forEach(b => b.onclick = async () => {
    const t = `{${b.dataset.champ}}`;
    const ed = $('#editeur');
    if (ed) { const a = ed.selectionStart, f = ed.selectionEnd; ed.setRangeText(t, a, f, 'end'); ed.focus(); ed.dispatchEvent(new Event('input')); }
    else { try { await navigator.clipboard.writeText(t); toast(`${t} copié : collez-le dans Word.`, 'succes'); } catch { toast(`Copiez ce champ : ${t}`, 'info', { duree: 8000 }); } }
  });
}
function modeleTexteDefaut() {
  const h = S.entetes; const nom = h.find(x => /^nom$/i.test(M.normaliser(x))) || h[0] || 'Nom'; const pre = h.find(x => /^prenom$/.test(M.normaliser(x)));
  return `Bonjour {${pre || nom}|Madame, Monsieur},\n\nNous avons le plaisir de vous confirmer votre inscription.\n\nCordialement,\nLe secrétariat`;
}
async function creerExpress() {
  const octets = M.modeleExpress(S.entetes, 'Modèle — ' + S.donnees.nom.replace(/\.[^.]+$/, ''));
  const nom = 'Modèle_' + M.nomSur(S.donnees.nom.replace(/\.[^.]+$/, '')) + '.docx';
  try {
    const r = await F.enregistrerFichier({ octets, nomSuggere: nom.replace(/\.docx$/, ''), filtres: [{ nom: 'Document Word', ext: ['docx'] }], titre: 'Enregistrer le modèle express' });
    if (!r) return;
    chargerModele({ nom: r.nom, chemin: r.chemin, octets });
    toast('Modèle express créé et chargé. Ouvrez-le dans Word pour rédiger votre texte autour des {Champs}, puis rechargez-le.', 'succes', { duree: 9000 });
  } catch (e) { toast('Création impossible : ' + e.message, 'erreur'); }
}

// ---------- Étape 3 : contrôle et aperçu ----------
const formatActuel = () => FORMATS[S.sortie.format];
const controlesActuels = () => M.controler(S.modele, S.entetes, lignesChoisies(), S.sortie.motif, formatActuel().ext);
async function htmlApercu(ligne, rang) {
  const lg = { ...ligne, rang };
  if (S.modele.type === 'texte') {
    const r = M.remplirTexte(S.modele, S.entetes, lg, { marquer: true });
    return `<pre>${marquer(esc(r.texte))}</pre>`;
  }
  const r = M.remplirWord(S.modele, S.entetes, lg, { marquer: true });
  const h = await window.mammoth.convertToHtml({ arrayBuffer: r.octets.buffer.slice(r.octets.byteOffset, r.octets.byteOffset + r.octets.byteLength) });
  return marquer(h.value) || '<p><i>Document vide</i></p>';
}
const marquer = h => h.replace(/([\s\S]*?)/g, '<mark class="val">$1</mark>').replace(/([\s\S]*?)/g, '<mark class="manque" title="Valeur manquante">[$1]</mark>').replace(/[-]/g, '');
function rendre3() {
  const z = $('#e3');
  const ctl = controlesActuels();
  const lignes = lignesChoisies();
  if (S.apercu >= lignes.length) S.apercu = 0;
  const ICO = { erreur: 'circle-x', alerte: 'triangle-alert', ok: 'circle-check', info: 'info' };
  z.innerHTML = `<h1 id="t3">3. Contrôle et aperçu</h1>
    <div class="carte-pp controles-pp" aria-live="polite"><h2>${ico('shield-check', 'p')} Contrôle</h2>${ctl.map(p => `<div class="pt ${p.gravite}">${ico(ICO[p.gravite], 'p')}<div><b>${esc(p.titre)}</b><small>${esc(p.detail)}</small></div></div>`).join('')}</div>
    <div class="carte-pp apercu-pp"><div class="nav-apercu"><h2 style="margin:0;flex:1">${ico('eye', 'p')} Aperçu par destinataire</h2>
      <button class="btn petit icone" id="ap-prec" aria-label="Destinataire précédent">${ico('chevron-left', 'p')}</button>
      <label class="champ-ligne">Document <input type="number" id="ap-num" min="1" max="${lignes.length}" value="${S.apercu + 1}" style="width:70px"> / ${lignes.length}</label>
      <button class="btn petit icone" id="ap-suiv" aria-label="Destinataire suivant">${ico('chevron-right', 'p')}</button></div>
      <p class="texte-aide" style="margin:0" id="ap-ligne"></p>
      <div class="page-apercu" id="page-apercu" aria-live="polite">Préparation de l'aperçu…</div>
      <p class="texte-aide" style="margin:0"><mark class="val" style="background:#fff1a8">valeur issue du tableau</mark> · <mark style="background:#f8d4cf">[champ sans valeur]</mark>${S.modele.type === 'docx' ? ' · Aperçu simplifié : la mise en page exacte est celle du document Word produit.' : ''}</p></div>`;
  const montrer = async () => {
    const l = lignes[S.apercu]; if (!l) return;
    $('#ap-num').value = S.apercu + 1;
    $('#ap-ligne').textContent = `Ligne ${l.num} du tableau — ${S.entetes.slice(0, 3).map((h, i) => `${h} : ${l.valeurs[i] || '—'}`).join(' · ')}`;
    try { $('#page-apercu').innerHTML = await htmlApercu(l, S.apercu + 1); } catch (e) { $('#page-apercu').textContent = 'Aperçu impossible : ' + e.message; }
  };
  $('#ap-prec').onclick = () => { S.apercu = (S.apercu - 1 + lignes.length) % lignes.length; montrer(); };
  $('#ap-suiv').onclick = () => { S.apercu = (S.apercu + 1) % lignes.length; montrer(); };
  $('#ap-num').onchange = e => { S.apercu = Math.max(0, Math.min(lignes.length - 1, (+e.target.value || 1) - 1)); montrer(); };
  montrer();
}
document.addEventListener('keydown', e => { if (S.etape !== 3 || e.target.tagName === 'INPUT') return; if (e.key === 'ArrowRight') $('#ap-suiv')?.click(); if (e.key === 'ArrowLeft') $('#ap-prec')?.click(); });

// ---------- Étape 4 : génération ----------
function rendre4() {
  const z = $('#e4');
  const fmt = formatActuel(), lignes = lignesChoisies();
  const ce = M.colonneEmail(S.entetes, lignes);
  const exemples = M.nomsPrevus(S.sortie.motif, S.entetes, lignes.slice(0, 3), fmt.ext).noms;
  z.innerHTML = `<h1 id="t4">4. Génération</h1>
    <div class="carte-pp"><h2>${ico('files', 'p')} Documents à produire</h2><div class="choix-pp" role="radiogroup" aria-label="Format">
      ${Object.entries(FORMATS).filter(([, f]) => !f.texteSeul || S.modele.type === 'texte').map(([k, f]) => `<label><input type="radio" name="fmt" value="${k}" ${S.sortie.format === k ? 'checked' : ''}><span><b>${esc(f.label)}</b><small>${esc(k.startsWith('pdf') && S.modele.type === 'docx' ? 'Mise en page simplifiée (polices standard, sans en-têtes ni pieds de page).' : f.desc)}</small></span></label>`).join('')}</div>
      ${fmt.ext === 'pdf' && S.modele.type === 'docx' ? `<div class="avert-pp" style="margin-top:10px">${ico('triangle-alert', 'p')}<span>Le PDF est produit sans Microsoft Word : texte, titres, listes, tableaux et images simples sont repris, mais pas les en-têtes et pieds de page, zones de texte ni la mise en page exacte. Pour un rendu identique à Word, produisez des .docx puis enregistrez-les en PDF depuis Word.</span></div>` : ''}</div>
    ${!fmt.unique ? `<div class="carte-pp"><h2>${ico('text-cursor-input', 'p')} Nom de chaque fichier</h2><div class="motif-pp"><input id="motif" value="${esc(S.sortie.motif)}" aria-label="Motif du nom de fichier"><span>.${fmt.ext}</span></div>
      <div class="puces-pp" style="margin-top:8px">${[...S.entetes, '#'].map(h => `<button class="puce-pp" data-motif="${esc(h)}">${ico('plus', 'p')}${esc(h === '#' ? 'N°' : h)}</button>`).join('')}</div>
      <p class="exemples-pp">Exemples : ${exemples.map(n => `<code>${esc(n)}</code>`).join(' · ')}. Les caractères interdits par Windows sont remplacés et un numéro est ajouté en cas de doublon : aucun fichier n'est écrasé.</p></div>` : ''}
    <div class="carte-pp"><h2>${ico('folder', 'p')} Emplacement</h2>
      ${F.NATIF ? `<div class="ligne-pp"><span style="flex:1">${S.sortie.dossier ? `<code>${esc(S.sortie.dossier)}</code>` : '<i>Aucun dossier choisi</i>'}</span><button class="btn" id="choisir-dossier">${ico('folder-open', 'p')}<span>Choisir le dossier…</span></button></div>
        <label class="champ-ligne" style="margin-top:8px"><input type="checkbox" id="sous-dossier" ${S.sortie.sousDossier ? 'checked' : ''}> Ranger les documents dans un nouveau sous-dossier « Publipostage <i>date heure</i> »</label>` : '<p class="texte-aide">Dans le navigateur, les documents sont rassemblés dans une archive .zip téléchargée.</p>'}
      ${ce >= 0 && !fmt.unique ? `<label class="champ-ligne" style="margin-top:6px"><input type="checkbox" id="liste-envoi" ${S.sortie.listeEnvoi ? 'checked' : ''}> Produire aussi <b>liste-envoi.csv</b> (colonne « ${esc(S.entetes[ce])} » + fichier à joindre) pour l'envoi avec Fusion PJ dans Thunderbird</label>` : ''}</div>
    <div class="ligne-pp"><button class="btn primaire grand" id="generer">${ico('play', 'p')}<span>Générer ${fmt.unique ? '1 document' : lignes.length + ' document(s)'}</span></button></div>
    <div id="progression" class="masque"><div class="progression-pp"><div></div></div><p class="texte-aide" id="prog-texte"></p></div>
    <div id="resume" class="carte-pp resume-pp masque" role="status" aria-live="polite"></div>`;
  $$('[name="fmt"]', z).forEach(r => r.onchange = () => { S.sortie.format = r.value; rendre4(); majResumes(); });
  const mi = $('#motif'); if (mi) mi.oninput = () => { S.sortie.motif = mi.value; S.sortie.motifAuto = false; const ex = M.nomsPrevus(S.sortie.motif, S.entetes, lignes.slice(0, 3), fmt.ext).noms; $('.exemples-pp').firstChild.textContent = 'Exemples : '; $('.exemples-pp').innerHTML = `Exemples : ${ex.map(n => `<code>${esc(n)}</code>`).join(' · ')}. Les caractères interdits par Windows sont remplacés et un numéro est ajouté en cas de doublon : aucun fichier n'est écrasé.`; };
  $$('[data-motif]', z).forEach(b => b.onclick = () => { const t = `{${b.dataset.motif}}`; mi.setRangeText((mi.selectionStart ? '_' : '') + t, mi.selectionStart, mi.selectionEnd, 'end'); mi.focus(); mi.dispatchEvent(new Event('input')); });
  const cd = $('#choisir-dossier'); if (cd) cd.onclick = async () => { const d = await F.choisirDossier('Dossier des documents produits'); if (d) { S.sortie.dossier = d; enregistrerPrefs(); rendre4(); } };
  const sd = $('#sous-dossier'); if (sd) sd.onchange = () => { S.sortie.sousDossier = sd.checked; enregistrerPrefs(); };
  const le = $('#liste-envoi'); if (le) le.onchange = () => { S.sortie.listeEnvoi = le.checked; };
  $('#generer').onclick = () => generer();
  if (S.dernier) afficherResume(S.dernier);
}
function enregistrerPrefs() { S.prefs.dossier = S.sortie.dossier; S.prefs.sousDossier = S.sortie.sousDossier; F.ecrirePrefs('publipostage', S.prefs); }

/** Produit les octets d'un document pour une ligne (ou pour toutes, en mode unique). */
async function produire(lignes, fmt, rangs) {
  const pdfOpts = { titre: S.modele.nom.replace(/\.[^.]+$/, ''), auteur: F.SESSION?.utilisateur || '' };
  if (S.modele.type === 'texte') {
    const textes = lignes.map((l, k) => M.remplirTexte(S.modele, S.entetes, { ...l, rang: rangs[k] }));
    const manquants = [...new Set(textes.flatMap(t => t.manquants))];
    if (fmt.ext === 'txt') return { octets: new TextEncoder().encode('﻿' + textes.map(t => t.texte.replace(/\r?\n/g, '\r\n')).join('\r\n\f\r\n')), manquants };
    if (fmt.ext === 'docx') return { octets: M.texteVersDocx(textes.map(t => t.texte).join('\n')), manquants };
    const html = textes.map((t, k) => `<div${k ? ' style="page-break-before:always"' : ''}>${t.texte.split(/\r?\n/).map(p => p.trim() ? `<p>${esc(p)}</p>` : '<p>&nbsp;</p>').join('')}</div>`).join('');
    const r = await htmlVersPdf(html, pdfOpts); return { octets: r.octets, manquants, avertissements: r.avertissements, vide: r.vide };
  }
  if (fmt.ext === 'pdf') {
    // un document Word par destinataire, converti en HTML, puis un saut de page entre destinataires
    // (mammoth ne reproduit pas les sauts de page Word)
    const parts = [], manquants = new Set(), avert = new Set();
    for (let k = 0; k < lignes.length; k++) {
      const w = M.remplirWord(S.modele, S.entetes, { ...lignes[k], rang: rangs[k] });
      w.manquants.forEach(x => manquants.add(x));
      const h = await window.mammoth.convertToHtml({ arrayBuffer: w.octets.buffer.slice(w.octets.byteOffset, w.octets.byteOffset + w.octets.byteLength) });
      if ((h.messages || []).some(m => m.type === 'warning')) avert.add('Certains éléments Word n\'ont pas d\'équivalent dans le PDF simplifié.');
      parts.push(`<div${k ? ' style="page-break-before:always"' : ''}>${h.value.replace(/<p>\s*<\/p>/g, '<p>&nbsp;</p>')}</div>`);
    }
    const r = await htmlVersPdf(parts.join(''), pdfOpts);
    return { octets: r.octets, manquants: [...manquants], avertissements: [...r.avertissements, ...avert], vide: r.vide };
  }
  const w = lignes.length > 1 || fmt.unique ? M.remplirWordUnique(S.modele, S.entetes, lignes.map((l, k) => ({ ...l, rang: rangs[k] }))) : M.remplirWord(S.modele, S.entetes, { ...lignes[0], rang: rangs[0] });
  if (fmt.ext === 'docx') return w;
  const h = await window.mammoth.convertToHtml({ arrayBuffer: w.octets.buffer.slice(w.octets.byteOffset, w.octets.byteOffset + w.octets.byteLength) });
  // mammoth sépare les pages Word par des sauts : on les reproduit
  const r = await htmlVersPdf(h.value.replace(/<p>\s*<\/p>/g, '<p>&nbsp;</p>'), pdfOpts);
  return { octets: r.octets, manquants: w.manquants, avertissements: [...r.avertissements, ...(h.messages || []).filter(m => m.type === 'warning').slice(0, 1).map(() => 'Certains éléments Word n\'ont pas d\'équivalent dans le PDF simplifié.')], vide: r.vide };
}
async function verifierProduit(octets, ext) {
  if (!octets || !octets.length) return { ok: false, detail: 'fichier vide' };
  if (ext === 'docx') { const v = M.verifierDocx(octets); return v.ok ? { ok: true } : v; }
  if (ext === 'pdf') { try { const d = await window.PDFLib.PDFDocument.load(octets); return d.getPageCount() > 0 ? { ok: true, pages: d.getPageCount() } : { ok: false, detail: 'aucune page' }; } catch (e) { return { ok: false, detail: 'PDF illisible : ' + e.message }; } }
  return { ok: true };
}
async function ecrireVerifie(chemin, octets) {
  await F.enregistrerFichier({ octets, chemin });
  const relu = await F.lireChemin(chemin);
  if (relu.length !== octets.length || await sha256(relu) !== await sha256(octets)) throw new Error('le fichier relu sur le disque ne correspond pas');
}

async function generer() {
  const fmt = formatActuel(), lignes = lignesChoisies();
  const ctl = controlesActuels();
  const bloquants = ctl.filter(p => p.gravite === 'erreur');
  if (bloquants.length) { toast(bloquants.map(p => p.titre + ' : ' + p.detail).join(' '), 'erreur', { duree: 10000 }); return; }
  const alertes = ctl.filter(p => p.gravite === 'alerte');
  if (alertes.length) {
    const r = await dialogue({ titre: 'Générer malgré les points signalés ?', contenu: `<ul>${alertes.map(p => `<li><b>${esc(p.titre)}</b> — ${esc(p.detail)}</li>`).join('')}</ul>`, boutons: [{ label: 'Revoir le contrôle', valeur: 'revoir', id: 'revoir' }, { label: 'Générer quand même', valeur: true, primaire: true, id: 'generer-quand-meme' }] });
    if (!r) return; if (r.valeur === 'revoir') return aller(3);
  }
  let dossier = null;
  if (F.NATIF) {
    if (!S.sortie.dossier) { S.sortie.dossier = await F.choisirDossier('Dossier des documents produits'); if (!S.sortie.dossier) return; enregistrerPrefs(); }
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    dossier = S.sortie.sousDossier ? joindre(S.sortie.dossier, `Publipostage ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}h${p2(d.getMinutes())}m${p2(d.getSeconds())}`) : S.sortie.dossier;
  }
  const existants = F.NATIF ? (await F.listerDossier(dossier, '').catch(() => []) || []).map(f => f.nom) : [];
  const res = { ok: 0, erreurs: [], fichiers: [], dossier, manquants: 0, avertissements: new Set(), debut: Date.now(), format: fmt.label };
  const prog = $('#progression'), barre = $('.progression-pp > div', prog), txt = $('#prog-texte');
  prog.classList.remove('masque'); $('#generer').disabled = true; $('#resume').classList.add('masque');
  const zipNav = {};
  const travaux = fmt.unique ? [{ lignes, rangs: lignes.map((_, k) => k + 1), nom: M.nomsPrevus(M.nomSur(S.modele.nom.replace(/\.[^.]+$/, '')) + ' - fusion', S.entetes, [{ valeurs: [] }], fmt.ext, existants).noms[0] }]
    : (() => { const n = M.nomsPrevus(S.sortie.motif, S.entetes, lignes, fmt.ext, existants).noms; return lignes.map((l, k) => ({ lignes: [l], rangs: [k + 1], nom: n[k] })); })();
  for (let k = 0; k < travaux.length; k++) {
    const t = travaux[k];
    barre.style.width = Math.round(k / travaux.length * 100) + '%'; txt.textContent = `Document ${k + 1} sur ${travaux.length} : ${t.nom}`;
    await new Promise(r => setTimeout(r, 0));
    try {
      const p = await produire(t.lignes, fmt, t.rangs);
      (p.avertissements || []).forEach(a => res.avertissements.add(a));
      if (p.vide) throw new Error('le document produit ne contient aucun texte');
      const v = await verifierProduit(p.octets, fmt.ext);
      if (!v.ok) throw new Error('document invalide : ' + v.detail);
      if (p.manquants?.length) res.manquants++;
      if (F.NATIF) { const chemin = joindre(dossier, t.nom); await ecrireVerifie(chemin, p.octets); res.fichiers.push({ nom: t.nom, chemin, lignes: t.lignes, taille: p.octets.length }); }
      else { zipNav[t.nom] = p.octets; res.fichiers.push({ nom: t.nom, lignes: t.lignes, taille: p.octets.length }); }
      res.ok++;
    } catch (e) { res.erreurs.push({ lignes: t.lignes.map(l => l.num), nom: t.nom, message: e.message || String(e) }); }
  }
  // liste d'envoi pour Fusion PJ
  const ce = M.colonneEmail(S.entetes, lignes);
  if (!fmt.unique && S.sortie.listeEnvoi && ce >= 0 && res.fichiers.length) {
    const q = v => /[;"\r\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    const csv = '﻿' + [['Courriel', 'Fichier', ...S.entetes.filter((_, i) => i !== ce)].map(q).join(';'), ...res.fichiers.map(f => [f.lignes[0].valeurs[ce], f.nom, ...f.lignes[0].valeurs.filter((_, i) => i !== ce)].map(v => q(String(v ?? '').replace(/\s+/g, ' ').trim())).join(';'))].join('\r\n') + '\r\n';
    try { if (F.NATIF) { await ecrireVerifie(joindre(dossier, 'liste-envoi.csv'), new TextEncoder().encode(csv)); res.liste = joindre(dossier, 'liste-envoi.csv'); } else zipNav['liste-envoi.csv'] = new TextEncoder().encode(csv); }
    catch (e) { res.erreurs.push({ lignes: [], nom: 'liste-envoi.csv', message: e.message }); }
  }
  if (!F.NATIF && res.fichiers.length) telechargerBlob(new Blob([zipSync(zipNav)]), 'Publipostage.zip');
  barre.style.width = '100%'; txt.textContent = 'Terminé.'; $('#generer').disabled = false;
  res.avertissements = [...res.avertissements]; res.duree = Date.now() - res.debut;
  S.dernier = res; afficherResume(res); majResumes();
  window.__publipostage.dernier = res;
}
function afficherResume(r) {
  const z = $('#resume'); if (!z) return;
  z.innerHTML = `<h2>${ico(r.erreurs.length ? 'triangle-alert' : 'circle-check', 'p')} ${r.ok} document(s) produit(s) et vérifié(s)${r.erreurs.length ? ` · ${r.erreurs.length} erreur(s)` : ''}</h2>
    <p class="texte-aide" style="margin:0">${esc(r.format)} — ${(r.duree / 1000).toFixed(1)} s${r.dossier ? ` — dans <code>${esc(r.dossier)}</code>` : ''}. Chaque fichier a été relu après écriture.</p>
    ${r.manquants ? `<p>${r.manquants} document(s) contiennent au moins un champ vide.</p>` : ''}
    ${r.liste ? `<p>Liste d'envoi pour Fusion PJ : <code>${esc(r.liste)}</code> (colonne « Fichier » = pièce jointe de chaque destinataire).</p>` : ''}
    ${r.avertissements.length ? `<ul>${r.avertissements.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    ${r.erreurs.length ? `<ul>${r.erreurs.map(e => `<li class="ko">${e.lignes.length ? `Ligne${e.lignes.length > 1 ? 's' : ''} ${e.lignes.slice(0, 5).join(', ')} — ` : ''}${esc(e.nom)} : ${esc(e.message)}</li>`).join('')}</ul>` : ''}
    ${r.dossier && F.NATIF ? `<p><button class="btn" id="ouvrir-dossier">${ico('folder-open', 'p')}<span>Ouvrir le dossier</span></button></p>` : ''}`;
  z.classList.remove('masque');
  const b = $('#ouvrir-dossier'); if (b) b.onclick = () => F.afficherDansExplorateur(r.fichiers[0]?.chemin || r.dossier);
}

// ---------- Démarrage ----------
(async () => {
  S.prefs = await F.lirePrefs('publipostage');
  appliquerTheme(S.prefs.theme || 'systeme');
  S.sortie.dossier = S.prefs.dossier || null; S.sortie.sousDossier = S.prefs.sousDossier !== false;
  aller(1);
  if (F.SESSION?.fichier) { try { const o = await F.lireChemin(F.SESSION.fichier); const nom = F.SESSION.fichier.split(/[\\/]/).pop(); (/\.(docx|dotx|docm|dotm)$/i.test(nom) ? chargerModele : chargerDonnees)({ nom, chemin: F.SESSION.fichier, octets: o }); } catch { } }
})();
window.__publipostage = { S, chargerDonnees, chargerModele, aller, generer, controlesActuels, htmlApercu, lignesChoisies };
