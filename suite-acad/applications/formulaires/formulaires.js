// FonctionGrist — tables de données, fiches, synthèses et formulaires de collecte
import { $, $$, el, esc, ico, toast, dialogue, confirmer, demander, menu, fermerMenu, creerRuban, raccourcis, debounce, nomSansExtension, telechargerBlob } from './commun/ui.js';
import { creerDocument } from './commun/document.js';
import * as Fi from './commun/fichiers.js';
import * as XLSX from './commun/vendor/xlsx.mjs';
import { TYPES, COULEURS_CHOIX, EMOJIS, MODELES, uid, nouvelleBase, nouvelleTable, colonne, table, colonneDe, estVide, texteValeur, libelleLigne, convertir, valeurBrute, valeurExport, calculer, verifierFormule, deviner, valeurImportee, NOMS_FONCTIONS, dateFr } from './modele.js';
import { definitionFormulaire, pageFormulaire } from './generateur.js';

let B = MODELES[0].creer();
const V = { vue: 'grille', table: B.tables[0]?.id, formulaire: null, tri: null, recherche: '', filtres: {}, cel: null, lignesSel: new Set(), fiche: 0, saisie: null };
const T = () => table(B, V.table) || B.tables[0];
const F = () => B.formulaires.find(f => f.id === V.formulaire);
const zone = $('#zone');

// ---------- Historique ----------
const pile = [], futur = [];
const etat = () => JSON.stringify(B);
function avant() { const e = etat(); if (pile[pile.length - 1] !== e) pile.push(e); if (pile.length > 100) pile.shift(); futur.length = 0; }
function appliquerEtat(s) { B = JSON.parse(s); if (!T()) V.table = B.tables[0]?.id; if (V.formulaire && !F()) { V.formulaire = null; V.vue = 'grille'; } rendreTout(); }
function annuler() { if (fermerEditeur(false)) return; if (!pile.length) return; futur.push(etat()); appliquerEtat(pile.pop()); doc.marquerModifie(); }
function retablir() { if (!futur.length) return; pile.push(etat()); appliquerEtat(futur.pop()); doc.marquerModifie(); }
function modifie() { doc.marquerModifie(); }

// ---------- Navigation ----------
function rendreNavigation() {
  const n = $('#navigation');
  n.innerHTML = `<h3>Tables</h3>${B.tables.map(t => `<button class="element-nav ${V.vue !== 'concepteur' && t.id === V.table ? 'actif' : ''}" data-t="${t.id}" title="${esc(t.nom)}"><span class="emoji">${esc(t.emoji || '📋')}</span><span class="nom">${esc(t.nom)}</span><span class="compte">${t.lignes.length}</span></button>`).join('')}
    <button class="element-nav ajout-nav" data-a="table">${ico('plus', 'p')}<span class="nom">Nouvelle table</span></button>
    <h3>Formulaires</h3>${B.formulaires.map(f => `<button class="element-nav ${V.vue === 'concepteur' && f.id === V.formulaire ? 'actif' : ''}" data-f="${f.id}" title="${esc(f.titre)}"><span class="emoji">📝</span><span class="nom">${esc(f.titre)}</span></button>`).join('')}
    <button class="element-nav ajout-nav" data-a="formulaire">${ico('plus', 'p')}<span class="nom">Nouveau formulaire</span></button>`;
  $$('[data-t]', n).forEach(b => { b.onclick = () => ouvrirTable(b.dataset.t); b.oncontextmenu = e => { e.preventDefault(); ouvrirTable(b.dataset.t); menuTable(e.clientX, e.clientY); }; b.ondblclick = () => renommerTable(); });
  $$('[data-f]', n).forEach(b => { b.onclick = () => ouvrirFormulaire(b.dataset.f); b.oncontextmenu = e => { e.preventDefault(); ouvrirFormulaire(b.dataset.f); menu([{ label: 'Dupliquer le formulaire', ico: 'copy', faire: dupliquerFormulaire }, { label: 'Supprimer le formulaire', ico: 'trash-2', faire: supprimerFormulaire }], e.clientX, e.clientY); }; });
  $('[data-a="table"]', n).onclick = () => creerTable(); $('[data-a="formulaire"]', n).onclick = () => creerFormulaire();
}
function ouvrirTable(id) { fermerEditeur(true); if (V.table !== id) { V.table = id; V.tri = null; V.filtres = {}; V.recherche = ''; V.cel = null; V.lignesSel.clear(); V.fiche = 0; } if (V.vue === 'concepteur') V.vue = 'grille'; rendreTout(); }
function ouvrirFormulaire(id) { fermerEditeur(true); V.formulaire = id; V.vue = 'concepteur'; rendreTout(); }
function menuTable(x, y) { menu([{ label: 'Renommer la table…', ico: 'pencil', faire: renommerTable }, { label: 'Dupliquer la structure', ico: 'copy', faire: dupliquerTable }, { label: 'Exporter vers Excel', ico: 'file-spreadsheet', faire: () => doc.exporter('xlsx') }, '-', { label: 'Supprimer la table', ico: 'trash-2', faire: supprimerTable }], x, y); }

// ---------- Tables ----------
async function dialogueTable(titre, t = { nom: '', emoji: '📋' }) {
  return dialogue({ titre, contenu: `<label class="champ">Nom de la table<input type="text" name="nom" value="${esc(t.nom)}" placeholder="Par exemple : Matériel"></label><p style="margin:12px 0 6px;font-weight:600">Icône</p><div style="display:flex;flex-wrap:wrap;gap:4px">${EMOJIS.map(e => `<label style="cursor:pointer"><input type="radio" name="emoji" value="${e}" ${e === t.emoji ? 'checked' : ''} style="display:none"><span class="emoji-choix" style="display:inline-grid;place-items:center;width:36px;height:36px;font-size:20px;border-radius:6px;border:2px solid ${e === t.emoji ? 'var(--accent)' : 'transparent'}">${e}</span></label>`).join('')}</div>`,
    boutons: [{ label: 'Annuler', valeur: null }, { label: 'OK', valeur: true, primaire: true }],
    init: c => $$('input[name=emoji]', c).forEach(i => i.onchange = () => $$('.emoji-choix', c).forEach(s => s.style.borderColor = s.previousElementSibling.checked ? 'var(--accent)' : 'transparent')),
    valider: d => !d.nom.trim() ? 'Indiquez un nom.' : B.tables.some(x => x !== t && x.nom.toLowerCase() === d.nom.trim().toLowerCase()) ? 'Une table porte déjà ce nom.' : null });
}
async function creerTable() {
  const r = await dialogueTable('Nouvelle table'); if (!r) return;
  avant(); const t = nouvelleTable(r.nom.trim(), r.emoji || '📋'); B.tables.push(t); modifie(); ouvrirTable(t.id);
}
async function renommerTable() { const t = T(); if (!t) return; const r = await dialogueTable('Renommer la table', t); if (!r) return; avant(); t.nom = r.nom.trim(); t.emoji = r.emoji || t.emoji; modifie(); rendreTout(); }
function dupliquerTable() { const t = T(); avant(); const c = JSON.parse(JSON.stringify(t)); c.id = uid('t'); c.nom = t.nom + ' (copie)'; c.lignes = []; const correspondance = {}; c.colonnes.forEach(x => { const n = uid('c'); correspondance[x.id] = n; x.id = n; }); B.tables.push(c); modifie(); ouvrirTable(c.id); }
async function supprimerTable() {
  const t = T(); if (!t) return;
  const liens = B.tables.filter(x => x !== t && x.colonnes.some(c => c.type === 'reference' && c.refTable === t.id));
  if (!(await confirmer('Supprimer la table', `La table « ${t.nom} » et ses ${t.lignes.length} ligne(s) seront supprimées.${liens.length ? ` Les liens depuis ${liens.map(x => x.nom).join(', ')} seront vidés.` : ''}`, 'Supprimer', true))) return;
  avant(); B.tables = B.tables.filter(x => x !== t);
  liens.forEach(x => x.colonnes.filter(c => c.type === 'reference' && c.refTable === t.id).forEach(c => { c.type = 'texte'; delete c.refTable; x.lignes.forEach(l => delete l.v[c.id]); }));
  B.formulaires = B.formulaires.filter(f => f.table !== t.id);
  if (!B.tables.length) B.tables.push(nouvelleTable('Table 1'));
  V.table = B.tables[0].id; modifie(); rendreTout();
}

// ---------- Lignes visibles (recherche, filtres, tri) ----------
function lignesVisibles(t) {
  let l = t.lignes;
  const q = V.recherche.trim().toLowerCase();
  if (q) l = l.filter(x => t.colonnes.some(c => texteValeur(B, t, c, x.v[c.id], x).toLowerCase().includes(q)));
  for (const [cid, vals] of Object.entries(V.filtres)) { const c = colonneDe(t, cid); if (!c) continue; const s = new Set(vals); l = l.filter(x => { const v = valeurBrute(B, t, c, x); const k = Array.isArray(v) ? v : [texteValeur(B, t, c, v, x)]; return k.some(y => s.has(Array.isArray(v) ? y : y)) || (k.length === 0 && s.has('')); }); }
  if (V.tri) {
    const c = colonneDe(t, V.tri.col);
    if (c) {
      const cle = x => { const v = valeurBrute(B, t, c, x); if (estVide(v) || v instanceof Error) return null; if (typeof v === 'number' || typeof v === 'boolean') return +v; if (c.type === 'choix') { const i = (c.choix || []).findIndex(o => o.v === v); return i >= 0 ? i : 999; } return texteValeur(B, t, c, v, x).toLowerCase(); };
      const s = V.tri.sens;
      l = [...l].sort((a, b) => { const x = cle(a), y = cle(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true })) * s; });
    }
  }
  return l;
}

// ---------- Rendu d'une cellule ----------
function htmlValeur(t, c, l) {
  const v = valeurBrute(B, t, c, l);
  if (c.type === 'case') return `<input type="checkbox" ${v ? 'checked' : ''} tabindex="-1" aria-label="${esc(c.nom)}">`;
  if (v instanceof Error) return '#' + esc(v.message);
  if (estVide(v)) return '';
  if (c.type === 'choix') { const o = (c.choix || []).find(x => x.v === v); return `<span class="puce" style="background:${o?.c || '#E8E8E8'}">${esc(v)}</span>`; }
  if (c.type === 'choixMultiple') return (Array.isArray(v) ? v : [v]).map(x => { const o = (c.choix || []).find(y => y.v === x); return `<span class="puce" style="background:${o?.c || '#E8E8E8'}">${esc(x)}</span>`; }).join('');
  if (c.type === 'note') return `<span class="etoiles-c">${'★'.repeat(+v || 0)}<span class="vide">${'★'.repeat(5 - (+v || 0))}</span></span>`;
  if (c.type === 'reference') return `<span class="lien-ref">${esc(texteValeur(B, t, c, v, l))}</span>`;
  if (c.type === 'lien') return `<a href="${esc(v)}" data-lien="${esc(v)}">${esc(String(v).replace(/^https?:\/\//, ''))}</a>`;
  if (c.type === 'email') return `<a href="mailto:${esc(v)}" data-lien="mailto:${esc(v)}">${esc(v)}</a>`;
  return esc(texteValeur(B, t, c, v, l)).replace(/\n/g, ' ');
}

// ---------- Vue grille ----------
function rendreGrille() {
  const t = T(); const lignes = lignesVisibles(t);
  const filtres = Object.entries(V.filtres).map(([cid, v]) => { const c = colonneDe(t, cid); return c ? `<span class="pastille-filtre">${esc(c.nom)} : ${esc(v.map(x => x || '(vide)').join(', ')).slice(0, 60)}<button data-retirer="${cid}" title="Retirer le filtre" aria-label="Retirer le filtre">${ico('x', 'p')}</button></span>` : ''; }).join('');
  zone.innerHTML = `<div class="outils-vue"><h2>${esc(t.emoji || '')} ${esc(t.nom)}</h2>
    <button class="btn" data-o="ligne">${ico('plus', 'p')}Ajouter une ligne</button><button class="btn" data-o="colonne">${ico('columns-3', 'p')}Ajouter une colonne</button>
    ${V.lignesSel.size ? `<button class="btn" data-o="suppr">${ico('trash-2', 'p')}Supprimer ${V.lignesSel.size} ligne${V.lignesSel.size > 1 ? 's' : ''}</button>` : ''}${filtres}
    <label class="recherche">${ico('search', 'p')}<input type="search" id="recherche" placeholder="Rechercher dans la table" value="${esc(V.recherche)}" aria-label="Rechercher dans la table"></label></div>
    <div class="conteneur-grille" id="grille" tabindex="0">${t.colonnes.length ? `<table class="grille"><colgroup><col style="width:52px">${t.colonnes.map(c => `<col style="width:${c.largeur || (c.type === 'texteLong' ? 260 : c.type === 'case' ? 90 : c.type === 'date' ? 134 : 170)}px">`).join('')}<col style="width:44px"></colgroup>
    <thead><tr><th class="num" title="Tout sélectionner"><input type="checkbox" id="tout" ${V.lignesSel.size && V.lignesSel.size === lignes.length ? 'checked' : ''} aria-label="Sélectionner toutes les lignes"></th>${t.colonnes.map((c, j) => `<th data-c="${j}" title="${esc(c.nom)} — ${esc(TYPES[c.type]?.nom || '')}${c.aide ? '\n' + esc(c.aide) : ''}"><div class="tete">${ico(TYPES[c.type]?.ico || 'type', 'p')}<span class="t">${esc(c.nom)}${c.obligatoire ? ' *' : ''}</span>${V.tri?.col === c.id ? `<span class="tri">${V.tri.sens > 0 ? '▲' : '▼'}</span>` : ''}${V.filtres[c.id] ? ico('filter', 'p') : ''}</div><span class="poignee-l" data-l="${j}"></span></th>`).join('')}<th class="ajout-col" title="Ajouter une colonne" data-o="colonne">${ico('plus', 'p')}</th></tr></thead>
    <tbody>${lignes.map((l, i) => `<tr data-l="${l.id}" class="${V.lignesSel.has(l.id) ? 'choisie' : ''}"><td class="num"><input type="checkbox" ${V.lignesSel.has(l.id) ? 'checked' : ''} aria-label="Sélectionner la ligne ${i + 1}">${i + 1}</td>${t.colonnes.map((c, j) => { const v = c.type === 'calcul' ? valeurBrute(B, t, c, l) : null; return `<td class="c ${c.type}${c.type === 'calcul' && typeof v === 'number' ? ' num-val' : ''}${v instanceof Error ? ' erreur-val' : ''}${V.cel && V.cel.l === l.id && V.cel.c === j ? ' sel' : ''}" data-c="${j}">${htmlValeur(t, c, l)}</td>`; }).join('')}<td></td></tr>`).join('')}
    <tr class="nouvelle"><td class="num">+</td>${t.colonnes.map((c, j) => `<td class="c" data-c="${j}" data-nouvelle="1">${j === 0 ? 'Nouvelle ligne' : ''}</td>`).join('')}<td></td></tr></tbody></table>` : `<div class="vide-table">Cette table n'a pas encore de colonne.<br><br><button class="btn primaire" data-o="colonne">Ajouter une colonne</button></div>`}</div>`;
  brancherGrille(t, lignes);
  majEtat(lignes.length);
}
function brancherGrille(t, lignes) {
  const g = $('#grille');
  $$('[data-o="ligne"]', zone).forEach(b => b.onclick = () => ajouterLigne());
  $$('[data-o="colonne"]', zone).forEach(b => b.onclick = () => ajouterColonne());
  $('[data-o="suppr"]', zone)?.addEventListener('click', supprimerLignes);
  $$('[data-retirer]', zone).forEach(b => b.onclick = () => { delete V.filtres[b.dataset.retirer]; rendreGrille(); });
  const rech = $('#recherche'); rech.oninput = debounce(() => { V.recherche = rech.value; const pos = rech.selectionStart; rendreGrille(); const r2 = $('#recherche'); r2.focus(); r2.setSelectionRange(pos, pos); }, 200);
  $('#tout')?.addEventListener('click', e => { e.stopPropagation(); V.lignesSel = e.target.checked ? new Set(lignes.map(l => l.id)) : new Set(); rendreGrille(); });
  $$('thead th[data-c]', g).forEach(th => {
    th.onclick = e => { if (e.target.closest('.poignee-l')) return; menuColonne(t, t.colonnes[+th.dataset.c], th); };
    th.oncontextmenu = e => { e.preventDefault(); menuColonne(t, t.colonnes[+th.dataset.c], th); };
  });
  $$('.poignee-l', g).forEach(p => p.onmousedown = e => {
    e.preventDefault(); e.stopPropagation(); const c = t.colonnes[+p.dataset.l]; const col = $$('col', g)[+p.dataset.l + 1]; const x0 = e.clientX, w0 = col.getBoundingClientRect().width || 150;
    const mv = m => { col.style.width = Math.max(60, w0 + m.clientX - x0) + 'px'; };
    const up = m => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); avant(); c.largeur = Math.max(60, Math.round(w0 + m.clientX - x0)); modifie(); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
  $$('tbody td.num', g).forEach(td => td.onclick = e => { const id = td.parentElement.dataset.l; if (!id) { ajouterLigne(); return; } if (e.shiftKey && V.ancre) { const ids = lignes.map(l => l.id); const a = ids.indexOf(V.ancre), b = ids.indexOf(id); ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => V.lignesSel.add(x)); } else { V.lignesSel.has(id) ? V.lignesSel.delete(id) : V.lignesSel.add(id); V.ancre = id; } rendreGrille(); });
  g.onmousedown = e => {
    const td = e.target.closest('td.c'); if (!td) return;
    if (td.dataset.nouvelle) { e.preventDefault(); const l = ajouterLigne(false); V.cel = { l: l.id, c: +td.dataset.c }; rendreGrille(); $('#grille').focus(); ouvrirEditeur(); return; }
    const lid = td.parentElement.dataset.l, j = +td.dataset.c; const c = t.colonnes[j];
    if (e.target.closest('a[data-lien]') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); Fi.ouvrirLien(e.target.closest('a').dataset.lien); return; }
    if (e.target.closest('a')) e.preventDefault();
    selectionner(lid, j);
    if (c.type === 'case' && e.target.tagName === 'INPUT') { e.preventDefault(); basculerCase(); return; }
    if (c.type === 'note') { const r = td.getBoundingClientRect(); const etoile = Math.min(5, Math.max(0, Math.ceil((e.clientX - r.left - 8) / 14))); if (etoile >= 1 && e.clientX - r.left < 8 + 5 * 14 + 4) { e.preventDefault(); const l = t.lignes.find(x => x.id === lid); ecrire(t, l, c, String(+l.v[c.id] === etoile ? 0 : etoile)); return; } }
  };
  g.ondblclick = e => { const td = e.target.closest('td.c'); if (td && !td.dataset.nouvelle) ouvrirEditeur(); };
  g.onkeydown = clavierGrille;
  g.addEventListener('paste', collerGrille); g.addEventListener('copy', copierGrille);
  if (V.cel) { const td = celluleDOM(); td?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}
function celluleDOM() { if (!V.cel) return null; return $(`#grille tr[data-l="${V.cel.l}"] td.c[data-c="${V.cel.c}"]`); }
function selectionner(lid, j) {
  $$('#grille td.c.sel').forEach(x => x.classList.remove('sel')); V.cel = { l: lid, c: j };
  const td = celluleDOM(); td?.classList.add('sel'); td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const t = T(); const l = t.lignes.find(x => x.id === lid); const c = t.colonnes[j];
  $('#etat-cel').textContent = l && c ? `${c.nom} : ${texteValeur(B, t, c, valeurBrute(B, t, c, l), l).slice(0, 80)}` : '';
}
function deplacer(dl, dc) {
  const t = T(); const lignes = lignesVisibles(t); if (!lignes.length || !t.colonnes.length) return;
  if (!V.cel) { selectionner(lignes[0].id, 0); return; }
  let i = lignes.findIndex(l => l.id === V.cel.l); let j = V.cel.c;
  i = Math.max(0, Math.min(lignes.length - 1, i + dl)); j = Math.max(0, Math.min(t.colonnes.length - 1, j + dc));
  selectionner(lignes[i].id, j);
}
function clavierGrille(e) {
  if (V.editeur) return;
  const t = T(); const k = e.key, ctrl = e.ctrlKey || e.metaKey;
  const fl = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
  if (fl) { e.preventDefault(); if (ctrl) { const lignes = lignesVisibles(t); if (fl[0]) { const l = fl[0] > 0 ? lignes[lignes.length - 1] : lignes[0]; if (l) selectionner(l.id, V.cel?.c || 0); } else selectionner(V.cel?.l || lignes[0]?.id, fl[1] > 0 ? t.colonnes.length - 1 : 0); } else deplacer(...fl); return; }
  if (k === 'Tab') { e.preventDefault(); deplacer(0, e.shiftKey ? -1 : 1); return; }
  if (!V.cel) return;
  const l = t.lignes.find(x => x.id === V.cel.l); const c = t.colonnes[V.cel.c]; if (!l || !c) return;
  if (k === 'Enter' || k === 'F2') { e.preventDefault(); if (c.type === 'case') basculerCase(); else ouvrirEditeur(); return; }
  if (k === ' ' && c.type === 'case') { e.preventDefault(); basculerCase(); return; }
  if ((k === 'Delete' || k === 'Backspace') && c.type !== 'calcul') { e.preventDefault(); ecrire(t, l, c, ''); return; }
  if (ctrl && k.toLowerCase() === 'd') { e.preventDefault(); const lignes = lignesVisibles(t); const i = lignes.findIndex(x => x.id === l.id); if (i > 0 && c.type !== 'calcul') { avant(); l.v[c.id] = JSON.parse(JSON.stringify(lignes[i - 1].v[c.id] ?? null)); modifie(); rendreGrille(); } return; }
  if (!ctrl && !e.altKey && k.length === 1 && c.type !== 'calcul' && c.type !== 'case') { e.preventDefault(); ouvrirEditeur(k); }
}
function basculerCase() { const t = T(); const l = t.lignes.find(x => x.id === V.cel?.l); const c = t.colonnes[V.cel?.c]; if (!l || c?.type !== 'case') return; avant(); l.v[c.id] = !l.v[c.id]; l.modifie = new Date().toISOString(); modifie(); rendreGrille(); $('#grille').focus(); }
function ecrire(t, l, c, saisie, { rendre = true } = {}) {
  if (c.type === 'calcul') return true;
  const r = convertir(B, c, saisie);
  if (r.erreur) { toast(`${c.nom} : ${r.erreur}`, 'erreur'); return false; }
  avant();
  if (r.nouveauChoix) { c.choix = c.choix || []; (Array.isArray(r.v) ? r.v : [r.v]).forEach(x => { if (!c.choix.some(o => o.v === x)) c.choix.push({ v: x, c: COULEURS_CHOIX[c.choix.length % COULEURS_CHOIX.length] }); }); }
  if (r.v == null || (Array.isArray(r.v) && !r.v.length)) delete l.v[c.id]; else l.v[c.id] = r.v;
  l.modifie = new Date().toISOString(); modifie();
  if (rendre) { rendreGrille(); $('#grille')?.focus(); }
  return true;
}
function texteEdition(t, c, l) {
  const v = l.v[c.id]; if (estVide(v)) return '';
  if (c.type === 'nombre' || c.type === 'monetaire') return String(v).replace('.', ',');
  if (c.type === 'date') return dateFr(v); if (c.type === 'choixMultiple') return (Array.isArray(v) ? v : [v]).join('; ');
  if (c.type === 'reference') return v; return String(v);
}
function ouvrirEditeur(initial) {
  const t = T(); const td = celluleDOM(); if (!td || !V.cel) return;
  const l = t.lignes.find(x => x.id === V.cel.l); const c = t.colonnes[V.cel.c]; if (!l || !c || c.type === 'calcul') return;
  if (c.type === 'case') { basculerCase(); return; }
  if (c.type === 'choixMultiple') { menuChoixMultiple(t, l, c, td); return; }
  const r = td.getBoundingClientRect(), rz = $('#grille').getBoundingClientRect(); const g = $('#grille');
  let ed;
  if (c.type === 'choix' || c.type === 'reference') {
    const opts = c.type === 'choix' ? (c.choix || []).map(o => [o.v, o.v]) : (table(B, c.refTable)?.lignes || []).map(x => [x.id, libelleLigne(B, table(B, c.refTable), x)]).sort((a, b) => a[1].localeCompare(b[1], 'fr'));
    ed = el(`<select class="editeur"><option value="">(vide)</option>${opts.map(([v, lib]) => `<option value="${esc(v)}">${esc(lib)}</option>`).join('')}</select>`);
    ed.value = l.v[c.id] ?? '';
    if (initial) { const o = opts.find(([, lib]) => lib.toLowerCase().startsWith(initial.toLowerCase())); if (o) ed.value = o[0]; }
  } else if (c.type === 'texteLong') { ed = el('<textarea class="editeur"></textarea>'); ed.value = initial ?? texteEdition(t, c, l); }
  else { ed = el(`<input class="editeur" type="text"${c.type === 'date' ? ' placeholder="jj/mm/aaaa"' : ''}>`); ed.value = initial ?? texteEdition(t, c, l); }
  ed.style.left = (r.left - rz.left + g.scrollLeft - 2) + 'px'; ed.style.top = (r.top - rz.top + g.scrollTop - 2) + 'px'; ed.style.minWidth = (r.width + 4) + 'px'; ed.style.height = c.type === 'texteLong' ? '140px' : (r.height + 4) + 'px';
  if (c.type === 'texteLong') ed.style.width = Math.max(320, r.width + 4) + 'px';
  g.appendChild(ed); V.editeur = { ed, t, l, c };
  ed.focus(); if (ed.setSelectionRange && ed.type === 'text') ed.setSelectionRange(ed.value.length, ed.value.length);
  ed.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermerEditeur(false); $('#grille').focus(); return; }
    if (e.key === 'Enter' && c.type === 'texteLong' && (e.shiftKey || e.altKey)) { if (e.altKey) { e.preventDefault(); const p = ed.selectionStart; ed.value = ed.value.slice(0, p) + '\n' + ed.value.slice(ed.selectionEnd); ed.selectionStart = ed.selectionEnd = p + 1; } return; }
    if (e.key === 'Enter') { e.preventDefault(); if (fermerEditeur(true)) deplacer(1, 0); return; }
    if (e.key === 'Tab') { e.preventDefault(); if (fermerEditeur(true)) deplacer(0, e.shiftKey ? -1 : 1); }
  };
  if (ed.tagName === 'SELECT') ed.onchange = () => { if (fermerEditeur(true)) $('#grille').focus(); };
  ed.onblur = () => setTimeout(() => { if (V.editeur?.ed === ed) fermerEditeur(true); }, 0);
}
function fermerEditeur(valider) {
  const e = V.editeur; if (!e) return false; V.editeur = null;
  if (valider) { const ok = ecrire(e.t, e.l, e.c, e.ed.value, { rendre: false }); if (!ok) { V.editeur = e; e.ed.focus(); return false; } }
  e.ed.remove(); if (V.vue === 'grille') { const cel = V.cel; rendreGrille(); V.cel = cel; $('#grille')?.focus(); }
  return true;
}
function menuChoixMultiple(t, l, c, ancre) {
  const actuels = new Set(Array.isArray(l.v[c.id]) ? l.v[c.id] : []);
  const g = el(`<div style="padding:6px 4px;min-width:220px"><div style="max-height:260px;overflow:auto">${(c.choix || []).map((o, i) => `<label class="case" style="padding:4px 8px"><input type="checkbox" data-i="${i}" ${actuels.has(o.v) ? 'checked' : ''}> <span class="puce" style="background:${o.c}">${esc(o.v)}</span></label>`).join('') || '<p style="padding:4px 8px;color:var(--encre-3)">Aucun choix défini.</p>'}</div><div style="padding:6px 8px 2px"><input type="text" placeholder="Ajouter un choix…" style="width:100%" data-nouveau></div></div>`);
  const appliquer = () => { const v = (c.choix || []).filter((o, i) => $(`[data-i="${i}"]`, g)?.checked).map(o => o.v); const n = $('[data-nouveau]', g).value.trim(); if (n) v.push(n); ecrire(t, l, c, v); };
  $$('[data-i]', g).forEach(i => i.onchange = () => { appliquer(); ouvrirEditeur(); });
  $('[data-nouveau]', g).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); appliquer(); fermerMenu(); } };
  menu([{ element: g }], 0, 0, ancre);
}
function copierGrille(e) {
  if (V.editeur || !V.cel) return; const t = T(); const l = t.lignes.find(x => x.id === V.cel.l); const c = t.colonnes[V.cel.c]; if (!l || !c) return;
  e.preventDefault(); e.clipboardData.setData('text/plain', texteValeur(B, t, c, valeurBrute(B, t, c, l), l));
}
function collerGrille(e) {
  if (V.editeur || !V.cel) return; const txt = e.clipboardData.getData('text/plain'); if (!txt) return; e.preventDefault();
  const t = T(); const lignes = lignesVisibles(t); let i0 = lignes.findIndex(x => x.id === V.cel.l); const j0 = V.cel.c;
  const rangs = txt.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(r => r.split('\t'));
  avant(); const pileAvant = pile.length; let erreurs = 0;
  rangs.forEach((r, di) => {
    let l = lignes[i0 + di]; if (!l) { l = { id: uid('l'), v: {}, cree: new Date().toISOString() }; t.lignes.push(l); }
    r.forEach((s, dj) => { const c = t.colonnes[j0 + dj]; if (!c || c.type === 'calcul') return; const x = convertir(B, c, s); if (x.erreur) { erreurs++; return; } if (x.nouveauChoix) { c.choix = c.choix || []; (Array.isArray(x.v) ? x.v : [x.v]).forEach(y => { if (!c.choix.some(o => o.v === y)) c.choix.push({ v: y, c: COULEURS_CHOIX[c.choix.length % COULEURS_CHOIX.length] }); }); } if (x.v == null) delete l.v[c.id]; else l.v[c.id] = x.v; });
  });
  pile.length = pileAvant; modifie(); rendreGrille(); rendreNavigation(); $('#grille').focus();
  toast(`${rangs.length} ligne${rangs.length > 1 ? 's' : ''} collée${rangs.length > 1 ? 's' : ''}${erreurs ? ` (${erreurs} valeur${erreurs > 1 ? 's' : ''} ignorée${erreurs > 1 ? 's' : ''})` : ''}.`, erreurs ? 'avertissement' : 'succes');
}
function nouvelleLigneDe(t) { const l = { id: uid('l'), v: {}, cree: new Date().toISOString() }; t.colonnes.forEach(c => { if (c.type === 'case') l.v[c.id] = false; }); return l; }
function ajouterLigne(rendre = true) {
  const t = T(); avant(); const l = nouvelleLigneDe(t); t.lignes.push(l); modifie();
  if (V.tri || V.recherche || Object.keys(V.filtres).length) { V.tri = null; V.recherche = ''; V.filtres = {}; }
  if (rendre) { V.cel = { l: l.id, c: 0 }; if (V.vue === 'fiche') { V.fiche = lignesVisibles(t).length - 1; rendreFiche(); } else { rendreGrille(); $('#grille').focus(); } rendreNavigation(); }
  return l;
}
async function supprimerLignes() {
  const t = T(); const ids = V.lignesSel.size ? [...V.lignesSel] : (V.cel ? [V.cel.l] : []); if (!ids.length) return;
  if (ids.length > 1 && !(await confirmer('Supprimer des lignes', `Supprimer ${ids.length} lignes ?`, 'Supprimer', true))) return;
  avant(); const s = new Set(ids); t.lignes = t.lignes.filter(l => !s.has(l.id));
  B.tables.forEach(x => x.colonnes.filter(c => c.type === 'reference' && c.refTable === t.id).forEach(c => x.lignes.forEach(l => { if (s.has(l.v[c.id])) delete l.v[c.id]; })));
  V.lignesSel.clear(); V.cel = null; modifie(); rendreTout();
}

// ---------- Colonnes ----------
function menuColonne(t, c, ancre) {
  const j = t.colonnes.indexOf(c);
  menu([
    { label: 'Renommer…', ico: 'pencil', faire: async () => { const n = await demander('Renommer la colonne', 'Nom', c.nom); if (n && n.trim() && n.trim() !== c.nom) { if (t.colonnes.some(x => x !== c && x.nom.toLowerCase() === n.trim().toLowerCase())) return toast('Une colonne porte déjà ce nom.', 'erreur'); avant(); renommerDansFormules(t, c.nom, n.trim()); c.nom = n.trim(); modifie(); rendreTout(); } } },
    { label: 'Type et options…', ico: 'settings-2', faire: () => dialogueColonne(t, c) },
    '-', { label: 'Trier de A à Z', ico: 'arrow-down-a-z', faire: () => { V.tri = { col: c.id, sens: 1 }; rendreGrille(); } }, { label: 'Trier de Z à A', ico: 'arrow-up-z-a', faire: () => { V.tri = { col: c.id, sens: -1 }; rendreGrille(); } },
    ...(V.tri?.col === c.id ? [{ label: 'Annuler le tri', faire: () => { V.tri = null; rendreGrille(); } }] : []),
    { label: 'Filtrer…', ico: 'filter', faire: () => dialogueFiltre(t, c) },
    '-', { label: 'Insérer une colonne à gauche', ico: 'between-vertical-start', faire: () => ajouterColonne(j) }, { label: 'Insérer une colonne à droite', ico: 'between-vertical-end', faire: () => ajouterColonne(j + 1) },
    { label: 'Déplacer à gauche', ico: 'arrow-left', desactive: j === 0, faire: () => { avant(); t.colonnes.splice(j, 1); t.colonnes.splice(j - 1, 0, c); modifie(); rendreGrille(); } },
    { label: 'Déplacer à droite', ico: 'arrow-right', desactive: j === t.colonnes.length - 1, faire: () => { avant(); t.colonnes.splice(j, 1); t.colonnes.splice(j + 1, 0, c); modifie(); rendreGrille(); } },
    '-', { label: 'Supprimer la colonne', ico: 'trash-2', faire: () => supprimerColonne(t, c) },
  ], 0, 0, ancre);
}
function renommerDansFormules(t, ancien, nouveau) {
  const re = new RegExp('\\[' + ancien.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]', 'gi');
  B.tables.forEach(x => x.colonnes.forEach(c => { if (c.type === 'calcul' && c.formule) { if (x === t) c.formule = c.formule.replace(re, `[${nouveau}]`); else c.formule = c.formule.replace(new RegExp('\\]\\.\\[' + ancien.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]', 'gi'), `].[${nouveau}]`); } }));
}
async function supprimerColonne(t, c) {
  const n = t.lignes.filter(l => !estVide(l.v[c.id])).length;
  if (n && !(await confirmer('Supprimer la colonne', `La colonne « ${c.nom} » contient ${n} valeur(s). La supprimer ?`, 'Supprimer', true))) return;
  avant(); t.colonnes = t.colonnes.filter(x => x !== c); t.lignes.forEach(l => delete l.v[c.id]);
  B.formulaires.forEach(f => f.champs = f.champs.filter(ch => ch.col !== c.id)); delete V.filtres[c.id]; if (V.tri?.col === c.id) V.tri = null; V.cel = null; modifie(); rendreTout();
}
async function ajouterColonne(position) {
  const t = T(); let i = 1; while (t.colonnes.some(c => c.nom === `Colonne ${i}`)) i++;
  const c = colonne(`Colonne ${i}`, 'texte');
  const ok = await dialogueColonne(t, c, true); if (!ok) return;
  t.colonnes.splice(position ?? t.colonnes.length, 0, c); modifie(); rendreTout();
}
function convertirColonne(t, c, type) {
  if (c.type === type) return;
  const ancien = { ...c };
  if ((type === 'choix' || type === 'choixMultiple') && !(c.choix || []).length) {
    const valeurs = [...new Set(t.lignes.flatMap(l => { const v = l.v[c.id]; return estVide(v) ? [] : Array.isArray(v) ? v : [texteValeur(B, t, ancien, v, l)]; }))].slice(0, 50);
    c.choix = valeurs.map((v, i) => ({ v, c: COULEURS_CHOIX[i % COULEURS_CHOIX.length] }));
  }
  c.type = type;
  for (const l of t.lignes) {
    const v = l.v[c.id]; if (estVide(v)) { if (type === 'case') l.v[c.id] = false; continue; }
    let s;
    if (Array.isArray(v)) s = type === 'choixMultiple' ? v : v.join(', ');
    else if (ancien.type === 'case') s = v ? 'oui' : '';
    else if (ancien.type === 'date') s = dateFr(v);
    else if (ancien.type === 'reference') s = texteValeur(B, t, ancien, v, l);
    else s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    const r = convertir(B, c, s);
    if (r.erreur || r.v == null) delete l.v[c.id]; else l.v[c.id] = type === 'choix' && Array.isArray(r.v) ? r.v[0] : r.v;
  }
}
async function dialogueColonne(t, c, creation = false) {
  const autres = B.tables.filter(x => x.id !== t.id || true);
  const typesOpts = Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === c.type ? 'selected' : ''}>${v.nom}</option>`).join('');
  const r = await dialogue({
    titre: creation ? 'Nouvelle colonne' : `Colonne « ${c.nom} »`, taille: 'large',
    contenu: `<div class="grille-champs"><label class="champ">Nom<input type="text" name="nom" value="${esc(c.nom)}"></label><label class="champ">Type<select name="type">${typesOpts}</select></label></div>
      <div data-zone="choix" style="margin-top:12px"><p style="margin:0 0 6px;font-weight:600">Choix proposés</p><div class="editeur-choix"></div><button type="button" class="btn" data-ajout-choix style="margin-top:6px">${ico('plus', 'p')}Ajouter un choix</button></div>
      <div data-zone="reference" style="margin-top:12px"><label class="champ">Table liée<select name="refTable">${autres.map(x => `<option value="${x.id}" ${x.id === c.refTable ? 'selected' : ''}>${esc(x.emoji || '')} ${esc(x.nom)}</option>`).join('')}</select></label><p style="font-size:13px;color:var(--encre-2);margin:6px 0 0">Chaque ligne pourra être reliée à une ligne de cette table (affichée par sa première colonne).</p></div>
      <div data-zone="nombre" style="margin-top:12px"><label class="champ" style="max-width:200px">Décimales<input type="number" name="decimales" min="0" max="6" value="${c.decimales ?? 2}"></label></div>
      <div data-zone="calcul" style="margin-top:12px"><label class="champ">Formule<input type="text" name="formule" value="${esc(c.formule || '')}" placeholder="Exemple : [Prix] * [Quantité]" spellcheck="false" style="font-family:Consolas,monospace"></label><div class="aide-formule"><b>Colonnes :</b> ${t.colonnes.filter(x => x.id !== c.id).map(x => `<code data-ins="[${esc(x.nom)}]">[${esc(x.nom)}]</code>`).join(' ')}<br><b>Fonctions :</b> ${NOMS_FONCTIONS.map(f => `<code data-ins="${f}()">${f}</code>`).join(' ')}<br>Séparez les arguments par « ; ». Exemple : <code>SI([Statut] = "Résolue"; "Oui"; "Non")</code>. Pour une colonne liée : <code>[Matériel].[Prix]</code>.<div data-apercu style="margin-top:6px"></div></div></div>
      <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px"><label class="champ">Texte d'aide (affiché dans les formulaires)<input type="text" name="aide" value="${esc(c.aide || '')}"></label><label class="case"><input type="checkbox" name="obligatoire" ${c.obligatoire ? 'checked' : ''}> Réponse obligatoire dans les formulaires</label></div>`,
    boutons: [{ label: 'Annuler', valeur: null }, { label: creation ? 'Ajouter' : 'Appliquer', valeur: true, primaire: true }],
    init: corps => {
      const ec = $('.editeur-choix', corps);
      const ligneChoix = (o = { v: '', c: COULEURS_CHOIX[ec.children.length % COULEURS_CHOIX.length] }) => { const d = el(`<div class="ligne-c"><input type="color" value="${o.c}" aria-label="Couleur"><input type="text" value="${esc(o.v)}" placeholder="Choix" aria-label="Libellé du choix"><button type="button" class="btn discret icone" aria-label="Retirer">${ico('x', 'p')}</button></div>`); $('button', d).onclick = () => d.remove(); ec.appendChild(d); return d; };
      (c.choix || []).forEach(o => ligneChoix(o)); if (!(c.choix || []).length) { ligneChoix(); }
      $('[data-ajout-choix]', corps).onclick = () => $('input[type=text]', ligneChoix()).focus();
      const maj = () => { const ty = $('[name=type]', corps).value; $$('[data-zone]', corps).forEach(z => z.style.display = (z.dataset.zone === 'choix' && (ty === 'choix' || ty === 'choixMultiple')) || z.dataset.zone === ty || (z.dataset.zone === 'nombre' && ty === 'calcul') ? '' : 'none'); };
      $('[name=type]', corps).onchange = () => {
        const ty = $('[name=type]', corps).value;
        if ((ty === 'choix' || ty === 'choixMultiple') && !$$('.ligne-c input[type=text]', ec).some(i => i.value.trim())) {
          const valeurs = [...new Set(t.lignes.flatMap(l => { const v = l.v[c.id]; return estVide(v) ? [] : Array.isArray(v) ? v : [texteValeur(B, t, c, v, l)]; }))].slice(0, 50);
          if (valeurs.length) { ec.innerHTML = ''; valeurs.forEach((v, i) => ligneChoix({ v, c: COULEURS_CHOIX[i % COULEURS_CHOIX.length] })); }
        }
        maj();
      }; maj();
      const f = $('[name=formule]', corps);
      $$('[data-ins]', corps).forEach(k => k.onclick = () => { const p = f.selectionStart ?? f.value.length; f.value = f.value.slice(0, p) + k.dataset.ins + f.value.slice(p); f.focus(); apercu(); });
      const apercu = () => { const z = $('[data-apercu]', corps); if (!f.value.trim()) { z.textContent = ''; return; } const err = verifierFormule(f.value, t); if (err) { z.innerHTML = `<span style="color:var(--danger)">Formule incorrecte : ${esc(err)}</span>`; return; } const l = t.lignes[0]; if (!l) { z.textContent = 'Formule correcte.'; return; } const r = calculer(B, t, { ...c, type: 'calcul', formule: f.value }, l); z.innerHTML = `Résultat sur la première ligne : <b>${esc(r instanceof Error ? '#' + r.message : typeof r === 'number' ? r.toLocaleString('fr-FR') : String(r))}</b>`; };
      f.oninput = debounce(apercu, 200); apercu();
      corps.__choix = () => $$('.ligne-c', ec).map(d => ({ v: $('input[type=text]', d).value.trim(), c: $('input[type=color]', d).value })).filter(o => o.v);
    },
    valider: (d, corps) => {
      if (!d.nom.trim()) return 'Indiquez un nom.';
      if (t.colonnes.some(x => x !== c && x.nom.toLowerCase() === d.nom.trim().toLowerCase())) return 'Une colonne porte déjà ce nom.';
      if (/[[\]]/.test(d.nom)) return 'Le nom ne doit pas contenir de crochets.';
      if (d.type === 'calcul') { if (!d.formule.trim()) return 'Indiquez une formule.'; const e = verifierFormule(d.formule, t); if (e) return 'Formule : ' + e; }
      if ((d.type === 'choix' || d.type === 'choixMultiple') && !corps.__choix().length) return 'Ajoutez au moins un choix.';
      if (d.type === 'reference' && !d.refTable) return 'Choisissez la table liée.';
      return null;
    }
  });
  if (!r) return false;
  if (!creation) avant();
  const ancienNom = c.nom;
  if (r.type === 'choix' || r.type === 'choixMultiple') {
    const nouveaux = r.corps.__choix();
    // valeurs renommées : correspondance par position
    if (!creation && (c.type === 'choix' || c.type === 'choixMultiple') && c.choix) {
      const ren = {}; c.choix.forEach((o, i) => { if (nouveaux[i] && nouveaux[i].v !== o.v && !c.choix.some(x => x.v === nouveaux[i].v)) ren[o.v] = nouveaux[i].v; });
      if (Object.keys(ren).length) t.lignes.forEach(l => { const v = l.v[c.id]; if (Array.isArray(v)) l.v[c.id] = v.map(x => ren[x] ?? x); else if (ren[v]) l.v[c.id] = ren[v]; });
    }
    c.choix = nouveaux;
  }
  if (r.type === 'reference') { if (c.type === 'reference' && c.refTable !== r.refTable) t.lignes.forEach(l => delete l.v[c.id]); c.refTable = r.refTable; }
  if (!creation) convertirColonne(t, c, r.type); else c.type = r.type;
  c.nom = r.nom.trim(); if (!creation && ancienNom !== c.nom) renommerDansFormules(t, ancienNom, c.nom);
  c.decimales = +r.decimales; if (r.type === 'calcul') c.formule = r.formule.trim(); else delete c.formule;
  c.aide = r.aide.trim() || undefined; c.obligatoire = !!r.obligatoire || undefined;
  if (creation) avant();
  modifie(); if (!creation) rendreTout();
  return true;
}
async function dialogueFiltre(t, c) {
  const valeurs = new Map();
  t.lignes.forEach(l => { const v = valeurBrute(B, t, c, l); const ks = Array.isArray(v) ? (v.length ? v : ['']) : [texteValeur(B, t, c, v, l)]; ks.forEach(k => valeurs.set(k, (valeurs.get(k) || 0) + 1)); });
  const liste = [...valeurs.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr', { numeric: true }));
  const actifs = new Set(V.filtres[c.id] || liste.map(x => x[0]));
  const r = await dialogue({ titre: `Filtrer « ${c.nom} »`, contenu: `<div style="display:flex;gap:10px;margin-bottom:8px"><button type="button" class="btn" data-tout>Tout cocher</button><button type="button" class="btn" data-rien>Tout décocher</button></div><div style="max-height:320px;overflow:auto;display:flex;flex-direction:column;gap:2px;min-width:340px">${liste.map(([k, n], i) => `<label class="case"><input type="checkbox" name="v${i}" ${actifs.has(k) ? 'checked' : ''}> ${esc(k || '(vide)')} <span style="color:var(--encre-3)">(${n})</span></label>`).join('')}</div>`,
    boutons: [{ label: 'Annuler', valeur: null }, { label: 'Filtrer', valeur: true, primaire: true }],
    init: corps => { $('[data-tout]', corps).onclick = () => $$('input[type=checkbox]', corps).forEach(i => i.checked = true); $('[data-rien]', corps).onclick = () => $$('input[type=checkbox]', corps).forEach(i => i.checked = false); } });
  if (!r) return;
  const choisis = liste.filter((_, i) => r['v' + i]).map(x => x[0]);
  if (choisis.length === liste.length) delete V.filtres[c.id]; else V.filtres[c.id] = choisis;
  rendreGrille();
}

// ---------- Vue fiche ----------
function rendreFiche() {
  const t = T(); const lignes = lignesVisibles(t);
  V.fiche = Math.max(0, Math.min(lignes.length - 1, V.fiche));
  const l = lignes[V.fiche];
  zone.innerHTML = `<div class="outils-vue"><h2>${esc(t.emoji || '')} ${esc(t.nom)}</h2><span style="color:var(--encre-2)">Vue fiche</span></div><div class="fiche"><div class="nav-fiche">
    <button class="btn icone" data-n="premiere" title="Première fiche" aria-label="Première fiche">${ico('chevrons-left', 'p')}</button><button class="btn icone" data-n="prec" title="Fiche précédente" aria-label="Fiche précédente">${ico('chevron-left', 'p')}</button>
    <span class="pos">${lignes.length ? `Fiche ${V.fiche + 1} sur ${lignes.length}` : 'Aucune fiche'}</span>
    <button class="btn icone" data-n="suiv" title="Fiche suivante" aria-label="Fiche suivante">${ico('chevron-right', 'p')}</button><button class="btn icone" data-n="derniere" title="Dernière fiche" aria-label="Dernière fiche">${ico('chevrons-right', 'p')}</button>
    <span style="flex:1"></span><button class="btn" data-n="nouvelle">${ico('plus', 'p')}Nouvelle fiche</button>${l ? `<button class="btn" data-n="suppr">${ico('trash-2', 'p')}Supprimer</button>` : ''}</div>
    ${l ? `<div class="carte-fiche">${t.colonnes.map((c, j) => `<label class="champ" data-c="${j}"><span>${ico(TYPES[c.type]?.ico || 'type', 'p')}${esc(c.nom)}${c.obligatoire ? ' *' : ''}</span>${champFiche(t, c, l)}</label>`).join('')}</div>` : `<div class="carte-fiche" style="text-align:center;color:var(--encre-2)">Cette table ne contient encore aucune ligne.</div>`}</div>`;
  const nav = { premiere: () => V.fiche = 0, prec: () => V.fiche--, suiv: () => V.fiche++, derniere: () => V.fiche = lignes.length - 1 };
  $$('[data-n]', zone).forEach(b => b.onclick = () => { if (b.dataset.n === 'nouvelle') { ajouterLigne(); return; } if (b.dataset.n === 'suppr') { V.lignesSel = new Set([l.id]); supprimerLignes(); return; } nav[b.dataset.n](); rendreFiche(); });
  if (l) $$('.carte-fiche [data-c]', zone).forEach(z => {
    const c = t.colonnes[+z.dataset.c];
    const lire = () => { if (c.type === 'case') return $('input', z).checked; if (c.type === 'choixMultiple') return $$('input:checked', z).map(i => i.value); if (c.type === 'note') return z.dataset.note || ''; const i = $('input,select,textarea', z); return i ? i.value : null; };
    const valider = () => { const v = lire(); if (v === null) return; const ok = ecrire(t, l, c, v, { rendre: false }); $('input,select,textarea', z)?.classList.toggle('invalide', !ok); if (ok) { majCalculsFiche(t, l); rendreNavigation(); } };
    $$('input,select,textarea', z).forEach(i => i.addEventListener(i.type === 'checkbox' || i.tagName === 'SELECT' || i.type === 'date' ? 'change' : 'change', valider));
    $$('.etoiles-f button', z).forEach((b, k) => b.onclick = e => { e.preventDefault(); z.dataset.note = String(+l.v[c.id] === k + 1 ? 0 : k + 1); valider(); $$('.etoiles-f button', z).forEach((x, m) => x.classList.toggle('on', m < (+l.v[c.id] || 0))); });
  });
  majEtat(lignes.length);
}
function champFiche(t, c, l) {
  const v = l.v[c.id];
  switch (c.type) {
    case 'calcul': return `<div class="valeur-calcul" data-calcul>${esc(texteValeur(B, t, c, null, l)) || '&nbsp;'}</div>`;
    case 'texteLong': return `<textarea>${esc(v || '')}</textarea>`;
    case 'case': return `<div><input type="checkbox" ${v ? 'checked' : ''}> Oui</div>`;
    case 'date': return `<input type="date" value="${esc(v || '')}">`;
    case 'choix': return `<select><option value=""></option>${(c.choix || []).map(o => `<option ${o.v === v ? 'selected' : ''}>${esc(o.v)}</option>`).join('')}</select>`;
    case 'choixMultiple': return `<div class="options-fiche">${(c.choix || []).map(o => `<label><input type="checkbox" value="${esc(o.v)}" ${(Array.isArray(v) ? v : []).includes(o.v) ? 'checked' : ''}> <span class="puce" style="background:${o.c}">${esc(o.v)}</span></label>`).join('')}</div>`;
    case 'reference': { const rt = table(B, c.refTable); return `<select><option value=""></option>${(rt?.lignes || []).map(x => [x.id, libelleLigne(B, rt, x)]).sort((a, b) => a[1].localeCompare(b[1], 'fr')).map(([id, lib]) => `<option value="${id}" ${id === v ? 'selected' : ''}>${esc(lib)}</option>`).join('')}</select>`; }
    case 'note': return `<div class="etoiles-f">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${n <= (+v || 0) ? 'on' : ''}" aria-label="${n} étoile${n > 1 ? 's' : ''}">★</button>`).join('')}</div>`;
    case 'nombre': case 'monetaire': return `<input type="text" inputmode="decimal" value="${esc(estVide(v) ? '' : String(v).replace('.', ','))}">`;
    case 'email': return `<input type="email" value="${esc(v || '')}">`;
    case 'telephone': return `<input type="tel" value="${esc(v || '')}">`;
    case 'lien': return `<input type="url" value="${esc(v || '')}">`;
    default: return `<input type="text" value="${esc(v || '')}">`;
  }
}
function majCalculsFiche(t, l) { $$('.carte-fiche [data-c]').forEach(z => { const c = t.colonnes[+z.dataset.c]; if (c.type === 'calcul') $('[data-calcul]', z).textContent = texteValeur(B, t, c, null, l) || ' '; }); }

// ---------- Vue synthèse ----------
function rendreSynthese() {
  const t = T(); const lignes = lignesVisibles(t);
  const barres = (comptes, total) => { const max = Math.max(1, ...comptes.map(x => x[1])); return comptes.map(([k, n]) => `<div class="barre-s"><span class="lib" title="${esc(k)}">${esc(k || '(vide)')}</span><span class="jauge"><i style="width:${(n / max * 100).toFixed(1)}%"></i></span><span class="val">${n} · ${total ? Math.round(n / total * 100) : 0} %</span></div>`).join(''); };
  const fmt = (c, n) => c.type === 'monetaire' ? n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const cartes = t.colonnes.map(c => {
    const vals = lignes.map(l => valeurBrute(B, t, c, l));
    const remplies = vals.filter(v => !estVide(v) && !(v instanceof Error));
    let corps = '';
    if (['choix', 'reference', 'case', 'note'].includes(c.type) || c.type === 'choixMultiple') {
      const m = new Map();
      if (c.type === 'choix') (c.choix || []).forEach(o => m.set(o.v, 0));
      if (c.type === 'case') { m.set('Oui', 0); m.set('Non', 0); }
      lignes.forEach((l, i) => { const v = vals[i]; const ks = c.type === 'choixMultiple' ? (Array.isArray(v) ? v : []) : c.type === 'case' ? [v ? 'Oui' : 'Non'] : c.type === 'note' ? (estVide(v) || !+v ? [] : ['★'.repeat(+v)]) : estVide(v) ? [] : [texteValeur(B, t, c, v, l)]; ks.forEach(k => m.set(k, (m.get(k) || 0) + 1)); });
      let l = [...m.entries()]; if (c.type !== 'choix' && c.type !== 'case') l.sort((a, b) => b[1] - a[1]); if (c.type === 'note') l.sort((a, b) => b[0].length - a[0].length);
      corps = barres(l.slice(0, 15), lignes.length);
      if (c.type === 'note' && remplies.length) corps = `<div class="chiffres" style="margin-bottom:10px"><div><b>${(remplies.reduce((a, b) => a + +b, 0) / remplies.filter(x => +x).length || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} / 5</b><span>note moyenne</span></div><div><b>${remplies.filter(x => +x).length}</b><span>avis</span></div></div>` + corps;
    } else if (['nombre', 'monetaire'].includes(c.type) || (c.type === 'calcul' && remplies.length && remplies.every(v => typeof v === 'number'))) {
      const n = remplies.map(Number); const s = n.reduce((a, b) => a + b, 0);
      corps = n.length ? `<div class="chiffres"><div><b>${fmt(c, s)}</b><span>total</span></div><div><b>${fmt(c, s / n.length)}</b><span>moyenne</span></div><div><b>${fmt(c, Math.min(...n))}</b><span>minimum</span></div><div><b>${fmt(c, Math.max(...n))}</b><span>maximum</span></div></div>` : '<p style="color:var(--encre-3)">Aucune valeur.</p>';
    } else if (c.type === 'date') {
      const m = new Map(); remplies.sort().forEach(v => { const k = new Date(v + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); m.set(k, (m.get(k) || 0) + 1); });
      corps = remplies.length ? `<div class="sous">Du ${dateFr(remplies[0])} au ${dateFr(remplies[remplies.length - 1])}</div>` + barres([...m.entries()].slice(-12), remplies.length) : '<p style="color:var(--encre-3)">Aucune date.</p>';
    } else {
      const der = lignes.filter((l, i) => !estVide(vals[i])).slice(-5).reverse();
      corps = der.length ? `<ul>${der.map(l => `<li>${esc(texteValeur(B, t, c, valeurBrute(B, t, c, l), l).slice(0, 120))}</li>`).join('')}</ul>` : '<p style="color:var(--encre-3)">Aucune réponse.</p>';
    }
    return `<div class="carte-s"><h4>${ico(TYPES[c.type]?.ico || 'type', 'p')}${esc(c.nom)}</h4><div class="sous">${remplies.length} réponse${remplies.length > 1 ? 's' : ''} sur ${lignes.length}</div>${corps}</div>`;
  });
  zone.innerHTML = `<div class="outils-vue"><h2>${esc(t.emoji || '')} ${esc(t.nom)}</h2><span style="color:var(--encre-2)">Synthèse${V.recherche || Object.keys(V.filtres).length ? ' (lignes filtrées)' : ''}</span><span style="flex:1"></span><button class="btn" data-imprimer>${ico('printer', 'p')}Imprimer</button></div><div class="synthese"><div class="total-s"><b>${lignes.length}</b>ligne${lignes.length > 1 ? 's' : ''}</div><div class="grille-synthese">${cartes.join('')}</div></div>`;
  $('[data-imprimer]', zone).onclick = () => window.print();
  majEtat(lignes.length);
}

// ---------- Formulaires ----------
async function creerFormulaire() {
  const t = T();
  avant(); const f = { id: uid('f'), titre: `Formulaire — ${t.nom}`, description: '', table: t.id, champs: t.colonnes.filter(c => c.type !== 'calcul').map(c => ({ col: c.id, obligatoire: !!c.obligatoire })), message: 'Merci, votre réponse a bien été enregistrée.' };
  B.formulaires.push(f); modifie(); ouvrirFormulaire(f.id);
}
function dupliquerFormulaire() { const f = F(); if (!f) return; avant(); const c = { ...JSON.parse(JSON.stringify(f)), id: uid('f'), titre: f.titre + ' (copie)', dossier: undefined }; B.formulaires.push(c); modifie(); ouvrirFormulaire(c.id); }
async function supprimerFormulaire() { const f = F(); if (!f) return; if (!(await confirmer('Supprimer le formulaire', `Supprimer le formulaire « ${f.titre} » ? Les réponses déjà collectées restent dans la table.`, 'Supprimer', true))) return; avant(); B.formulaires = B.formulaires.filter(x => x !== f); V.vue = 'grille'; V.formulaire = null; modifie(); rendreTout(); }
function rendreConcepteur() {
  const f = F(); if (!f) { V.vue = 'grille'; return rendreTout(); }
  let t = table(B, f.table); if (!t) { f.table = B.tables[0].id; t = B.tables[0]; }
  const champs = f.champs.filter(ch => colonneDe(t, ch.col));
  const absents = t.colonnes.filter(c => c.type !== 'calcul' && !champs.some(ch => ch.col === c.id));
  const nbRecues = t.lignes.filter(l => l.formulaire === f.id).length;
  zone.innerHTML = `<div class="outils-vue"><h2>📝 ${esc(f.titre)}</h2><span style="flex:1"></span>
    <button class="btn" data-a="tester">${ico('play', 'p')}Tester</button><button class="btn" data-a="html">${ico('file-code', 'p')}Publier en page web</button><button class="btn" data-a="dossier">${ico('folder-up', 'p')}Publier dans un dossier partagé</button>${f.dossier ? `<button class="btn primaire" data-a="collecter">${ico('inbox', 'p')}Collecter les réponses</button>` : ''}</div>
    <div class="concepteur"><div class="reglages-f">
      <label class="champ">Titre<input type="text" data-p="titre" value="${esc(f.titre)}"></label>
      <label class="champ">Description<textarea data-p="description" rows="3">${esc(f.description || '')}</textarea></label>
      <label class="champ">Les réponses alimentent la table<select data-p="table">${B.tables.map(x => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${esc(x.emoji || '')} ${esc(x.nom)}</option>`).join('')}</select></label>
      <label class="champ">Message de remerciement<input type="text" data-p="message" value="${esc(f.message || '')}"></label>
      <div class="grille-champs"><label class="champ">Couleur<input type="color" data-p="couleur" value="${esc(f.couleur || '#0E7380')}" style="height:34px;padding:2px"></label>
      <label class="champ">Date de la réponse dans<select data-p="dateAuto"><option value="">(ne pas enregistrer)</option>${t.colonnes.filter(c => c.type === 'date').map(c => `<option value="${c.id}" ${c.id === f.dateAuto ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}</select></label></div>
      ${Object.keys(f.valeursParDefaut || {}).filter(k => colonneDe(t, k)).length ? `<p style="font-size:13px;color:var(--encre-2);margin:4px 0">Remplissage automatique : ${Object.entries(f.valeursParDefaut).filter(([k]) => colonneDe(t, k)).map(([k, v]) => `<b>${esc(colonneDe(t, k).nom)}</b> = ${esc(texteValeur(B, t, colonneDe(t, k), v, {}))}`).join(', ')}</p>` : ''}
      <h4>Questions (${champs.length})</h4><div class="liste-champs">${champs.map((ch, i) => { const c = colonneDe(t, ch.col); return `<div class="ligne-champ" data-i="${i}"><div class="haut">${ico(TYPES[c.type]?.ico || 'type', 'p')}<span class="nom">${esc(ch.libelle || c.nom)}</span><label class="case" title="Réponse obligatoire" style="font-size:12px"><input type="checkbox" data-ob ${ch.obligatoire || c.obligatoire ? 'checked' : ''} ${c.obligatoire ? 'disabled' : ''}> Obligatoire</label><button class="mini" data-m="-1" title="Monter" aria-label="Monter">${ico('arrow-up', 'p')}</button><button class="mini" data-m="1" title="Descendre" aria-label="Descendre">${ico('arrow-down', 'p')}</button><button class="mini" data-retirer title="Retirer du formulaire" aria-label="Retirer du formulaire">${ico('x', 'p')}</button></div><div class="detail"><input type="text" data-lib placeholder="Question (par défaut : ${esc(c.nom)})" value="${esc(ch.libelle || '')}" aria-label="Intitulé de la question"><input type="text" data-aide placeholder="Texte d'aide" value="${esc(ch.aide ?? '')}" aria-label="Texte d'aide"></div></div>`; }).join('')}</div>
      ${absents.length ? `<h4>Ajouter une question</h4><div style="display:flex;flex-wrap:wrap;gap:6px">${absents.map(c => `<button class="btn" data-ajout="${c.id}">${ico('plus', 'p')}${esc(c.nom)}</button>`).join('')}</div>` : ''}
      ${f.dossier ? `<div class="info-collecte">Publié dans : ${esc(f.dossier)}<br>${nbRecues} réponse${nbRecues > 1 ? 's' : ''} intégrée${nbRecues > 1 ? 's' : ''} à la table.</div>` : ''}
      <p style="margin-top:18px"><button class="btn" data-a="suppr">${ico('trash-2', 'p')}Supprimer ce formulaire</button></p>
    </div><div class="apercu-f"><iframe title="Aperçu du formulaire" id="apercu-f"></iframe></div></div>`;
  majApercu();
  $$('[data-p]', zone).forEach(i => i.addEventListener(i.tagName === 'SELECT' || i.type === 'color' ? 'change' : 'input', debounce(() => {
    avant(); const k = i.dataset.p;
    if (k === 'table' && i.value !== f.table) { f.table = i.value; f.champs = table(B, f.table).colonnes.filter(c => c.type !== 'calcul').map(c => ({ col: c.id })); delete f.dateAuto; f.valeursParDefaut = {}; modifie(); rendreConcepteur(); rendreNavigation(); return; }
    if (k === 'dateAuto') { if (i.value) f.dateAuto = i.value; else delete f.dateAuto; } else f[k] = i.value;
    modifie(); majApercu(); if (k === 'titre') { rendreNavigation(); $('.outils-vue h2', zone).textContent = '📝 ' + f.titre; }
  }, i.tagName === 'SELECT' || i.type === 'color' ? 0 : 300)));
  $$('.ligne-champ', zone).forEach(d => {
    const i = +d.dataset.i; const ch = champs[i];
    $('[data-ob]', d).onchange = e => { avant(); ch.obligatoire = e.target.checked; modifie(); majApercu(); };
    $('[data-lib]', d).oninput = debounce(e => { avant(); ch.libelle = e.target.value.trim() || undefined; $('.nom', d).textContent = ch.libelle || colonneDe(t, ch.col).nom; modifie(); majApercu(); }, 300);
    $('[data-aide]', d).oninput = debounce(e => { avant(); ch.aide = e.target.value.trim() || undefined; modifie(); majApercu(); }, 300);
    $$('[data-m]', d).forEach(b => b.onclick = () => { const j = i + +b.dataset.m; if (j < 0 || j >= champs.length) return; avant(); const a = f.champs.indexOf(champs[i]), z = f.champs.indexOf(champs[j]); [f.champs[a], f.champs[z]] = [f.champs[z], f.champs[a]]; modifie(); rendreConcepteur(); });
    $('[data-retirer]', d).onclick = () => { avant(); f.champs = f.champs.filter(x => x !== ch); modifie(); rendreConcepteur(); };
  });
  $$('[data-ajout]', zone).forEach(b => b.onclick = () => { avant(); f.champs.push({ col: b.dataset.ajout }); modifie(); rendreConcepteur(); });
  const act = { tester: testerFormulaire, html: publierHTML, dossier: publierDossier, collecter: () => collecter(f), suppr: supprimerFormulaire };
  $$('[data-a]', $('.outils-vue', zone)).forEach(b => b.onclick = () => act[b.dataset.a]());
  $('[data-a="suppr"]', zone).onclick = supprimerFormulaire;
  majEtat(null);
}
function majApercu() { const f = F(); const fr = $('#apercu-f'); if (!f || !fr) return; try { const h = pageFormulaire(definitionFormulaire(B, f)); fr.srcdoc = h.replace('<script>', '<script>window.__atelierReponse=async()=>{alert("Aperçu : utilisez « Tester » pour enregistrer une réponse.");return false;};'); } catch (e) { fr.srcdoc = `<p style="font:14px sans-serif;padding:20px">${esc(e.message)}</p>`; } }

// Intégration d'une réponse dans la base
function integrerReponse(rep) {
  const f = B.formulaires.find(x => x.id === rep.formulaire);
  if (!f) return { statut: 'inconnu' };
  if ((B.reponsesImportees || []).includes(rep.id)) return { statut: 'doublon' };
  const t = table(B, f.table); if (!t) return { statut: 'inconnu' };
  const l = nouvelleLigneDe(t); l.cree = rep.date || new Date().toISOString(); l.formulaire = f.id; l.reponse = rep.id;
  for (const [k, v] of Object.entries(f.valeursParDefaut || {})) if (colonneDe(t, k)) l.v[k] = v;
  if (f.dateAuto && colonneDe(t, f.dateAuto)) l.v[f.dateAuto] = (rep.date || new Date().toISOString()).slice(0, 10);
  for (const [cid, v] of Object.entries(rep.valeurs || {})) {
    const c = colonneDe(t, cid); if (!c || c.type === 'calcul') continue;
    if (c.type === 'reference') { if (table(B, c.refTable)?.lignes.some(x => x.id === v)) l.v[cid] = v; continue; }
    if (c.type === 'case') { l.v[cid] = !!v; continue; }
    if (c.type === 'nombre' || c.type === 'monetaire' || c.type === 'note') { if (typeof v === 'number' && isFinite(v)) l.v[cid] = v; continue; }
    const r = convertir(B, c, Array.isArray(v) ? v : String(v));
    if (!r.erreur && r.v != null) { l.v[cid] = r.v; if (r.nouveauChoix) { c.choix = c.choix || []; (Array.isArray(r.v) ? r.v : [r.v]).forEach(x => { if (!c.choix.some(o => o.v === x)) c.choix.push({ v: x, c: COULEURS_CHOIX[c.choix.length % COULEURS_CHOIX.length] }); }); } }
  }
  t.lignes.push(l); B.reponsesImportees = [...(B.reponsesImportees || []), rep.id];
  return { statut: 'ajoutee', table: t };
}
function lireReponse(octets) { const o = JSON.parse(new TextDecoder().decode(octets)); if (o.format !== 'atelier-reponse') throw new Error('fichier de réponse invalide'); return o; }
async function testerFormulaire() {
  const f = F(); const def = definitionFormulaire(B, f);
  await dialogue({ titre: 'Tester le formulaire', taille: 'large', contenu: `<p style="margin:0 0 8px;color:var(--encre-2)">Les réponses envoyées ici sont ajoutées à la table « ${esc(table(B, f.table).nom)} ».</p><iframe title="Test du formulaire" style="width:100%;height:62vh;border:1px solid var(--ligne);border-radius:6px;background:#EEF3F4"></iframe>`, boutons: [{ label: 'Fermer', valeur: true, primaire: true }],
    init: corps => {
      const fr = $('iframe', corps);
      fr.srcdoc = pageFormulaire(def).replace('<script>', '<script>window.__atelierReponse=r=>window.parent.__atelierTest(r);');
    } });
}
window.__atelierTest = async rep => { avant(); const r = integrerReponse(rep); if (r.statut !== 'ajoutee') { toast('Réponse non intégrée.', 'erreur'); return false; } modifie(); rendreNavigation(); toast('Réponse ajoutée à la table.', 'succes'); return true; };
async function publierHTML() {
  const f = F(); const h = pageFormulaire(definitionFormulaire(B, f));
  const r = await Fi.enregistrerFichier({ octets: h, nomSuggere: f.titre.replace(/[\\/:*?"<>|]+/g, ' ').trim(), filtres: [{ nom: 'Page web', ext: ['html'] }], titre: 'Publier le formulaire' });
  if (r) dialogue({ titre: 'Formulaire publié', contenu: `<p>Le formulaire a été enregistré dans « ${esc(r.nom)} ».</p><p>Envoyez ce fichier aux personnes concernées : il s'ouvre dans n'importe quel navigateur, sans installation. Chaque réponse produit un fichier « .reponse » à vous retourner.</p><p>Pour les intégrer, utilisez <b>Importer des réponses</b> dans l'onglet Formulaires, ou ouvrez simplement le fichier « .reponse » avec FonctionGrist.</p>`, boutons: [{ label: 'OK', valeur: true, primaire: true }] });
}
async function publierDossier() {
  const f = F();
  if (!Fi.NATIF) return toast('La publication dans un dossier partagé nécessite l\'application installée.', 'erreur');
  const dossier = await Fi.choisirDossier('Dossier partagé de publication'); if (!dossier) return;
  const sep = dossier.includes('\\') ? '\\' : '/'; const base = dossier.replace(/[\\/]+$/, '');
  const nom = f.titre.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Formulaire';
  avant(); f.dossier = base + sep + 'Réponses - ' + nom; modifie();
  const def = definitionFormulaire(B, f);
  try {
    await Fi.enregistrerFichier({ octets: JSON.stringify(def), chemin: base + sep + nom + '.formulaire' });
    await Fi.enregistrerFichier({ octets: pageFormulaire({ ...def, dossierReponses: null }), chemin: base + sep + nom + '.html' });
    await Fi.enregistrerFichier({ octets: 'Ce dossier reçoit les réponses au formulaire « ' + f.titre + ' ».\r\nNe pas supprimer les fichiers .reponse avant leur collecte.\r\n', chemin: f.dossier + sep + 'LISEZMOI.txt' });
  } catch (e) { toast('Publication impossible : ' + e.message, 'erreur'); return; }
  rendreConcepteur();
  dialogue({ titre: 'Formulaire publié', contenu: `<p>Le formulaire est disponible dans :<br><b>${esc(base)}</b></p><ul><li><b>${esc(nom)}.formulaire</b> : à ouvrir avec FonctionGrist ; les réponses sont déposées automatiquement dans le dossier « Réponses - ${esc(nom)} ».</li><li><b>${esc(nom)}.html</b> : version page web pour les personnes qui n'ont pas Suite Acad’.</li></ul><p>Cliquez ensuite sur <b>Collecter les réponses</b> pour les ajouter à la table.</p>`, boutons: [{ label: 'OK', valeur: true, primaire: true }] });
}
async function collecter(f) {
  const liste = f ? [f] : B.formulaires.filter(x => x.dossier);
  if (!liste.length) return toast('Aucun formulaire publié dans un dossier partagé.', 'erreur');
  let ajout = 0, deja = 0, erreurs = 0; avant(); const p0 = pile.length;
  for (const x of liste) {
    let fichiers = [];
    try { fichiers = await Fi.listerDossier(x.dossier, ['reponse']); } catch (e) { toast(`Dossier inaccessible : ${x.dossier}`, 'erreur'); continue; }
    const sep = x.dossier.includes('\\') ? '\\' : '/';
    for (const fi of fichiers) {
      try { const rep = lireReponse(await Fi.lireChemin(x.dossier + sep + (fi.nom || fi))); const r = integrerReponse(rep); if (r.statut === 'ajoutee') ajout++; else if (r.statut === 'doublon') deja++; else erreurs++; } catch { erreurs++; }
    }
  }
  if (!ajout) pile.length = p0 - 1 >= 0 ? p0 - 1 : 0; else modifie();
  rendreTout();
  toast(ajout ? `${ajout} nouvelle${ajout > 1 ? 's' : ''} réponse${ajout > 1 ? 's' : ''} ajoutée${ajout > 1 ? 's' : ''}${deja ? ` (${deja} déjà collectée${deja > 1 ? 's' : ''})` : ''}.` : `Aucune nouvelle réponse${deja ? ` (${deja} déjà collectée${deja > 1 ? 's' : ''})` : ''}.`, ajout ? 'succes' : 'info');
  if (erreurs) toast(`${erreurs} fichier${erreurs > 1 ? 's' : ''} ignoré${erreurs > 1 ? 's' : ''} (illisible ou formulaire inconnu).`, 'erreur');
}
async function importerReponses() {
  const fs_ = await Fi.ouvrirFichiers({ titre: 'Importer des réponses', filtres: [{ nom: 'Réponses FonctionGrist', ext: ['reponse'] }], multiple: true }); if (!fs_) return;
  avant(); let ajout = 0, deja = 0, inconnu = 0;
  for (const f of fs_) { try { const r = integrerReponse(lireReponse(f.octets)); if (r.statut === 'ajoutee') ajout++; else if (r.statut === 'doublon') deja++; else inconnu++; } catch { inconnu++; } }
  if (ajout) modifie(); else pile.pop();
  rendreTout(); toast(`${ajout} réponse${ajout > 1 ? 's' : ''} ajoutée${ajout > 1 ? 's' : ''}${deja ? `, ${deja} déjà présente${deja > 1 ? 's' : ''}` : ''}${inconnu ? `, ${inconnu} sans formulaire correspondant dans cette base` : ''}.`, ajout ? 'succes' : 'info');
}

// ---------- Saisie (fichier .formulaire publié) ----------
function ouvrirSaisie(def) {
  V.saisie = def; const s = $('#saisie'); s.classList.remove('masque'); $('#appli').style.visibility = 'hidden';
  s.innerHTML = '<iframe title="Formulaire"></iframe>';
  $('iframe', s).srcdoc = pageFormulaire(def).replace('<script>', '<script>window.__atelierReponse=r=>window.parent.__atelierDeposer(r);');
  Fi.definirTitre(def.titre);
}
window.__atelierDeposer = async rep => {
  const d = V.saisie; const nom = `${(d.titre.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Formulaire')} - ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')} - ${rep.id.slice(-6)}.reponse`;
  const octets = JSON.stringify(rep, null, 1);
  if (d.dossierReponses && Fi.NATIF) {
    const sep = d.dossierReponses.includes('\\') ? '\\' : '/';
    try { await Fi.enregistrerFichier({ octets, chemin: d.dossierReponses.replace(/[\\/]+$/, '') + sep + nom }); return true; }
    catch (e) { toast('Le dossier des réponses est inaccessible : enregistrez votre réponse puis transmettez le fichier.', 'erreur'); }
  }
  const r = await Fi.enregistrerFichier({ octets, nomSuggere: nomSansExtension(nom), filtres: [{ nom: 'Réponse FonctionGrist', ext: ['reponse'] }], titre: 'Enregistrer ma réponse' });
  return !!r;
};

// ---------- Import / export tableur ----------
function feuilleDeTable(t) {
  const lignes = [t.colonnes.map(c => c.nom), ...t.lignes.map(l => t.colonnes.map(c => valeurExport(B, t, c, l)))];
  const ws = XLSX.utils.aoa_to_sheet(lignes, { cellDates: true });
  t.colonnes.forEach((c, j) => { for (let i = 1; i < lignes.length; i++) { const ref = XLSX.utils.encode_cell({ r: i, c: j }); const cel = ws[ref]; if (!cel) continue; if (c.type === 'date' && cel.t === 'd') cel.z = 'dd/mm/yyyy'; if (c.type === 'monetaire' && cel.t === 'n') cel.z = '#,##0.00 "€"'; } });
  ws['!cols'] = t.colonnes.map(c => ({ wch: Math.min(60, Math.max(10, c.nom.length + 2, ...t.lignes.slice(0, 200).map(l => String(texteValeur(B, t, c, valeurBrute(B, t, c, l), l)).length + 1))) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, lignes.length - 1), c: Math.max(0, t.colonnes.length - 1) } }) };
  return ws;
}
const nomFeuille = (n, pris) => { let b = n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Feuille'; let k = b, i = 2; while (pris.has(k.toLowerCase())) k = b.slice(0, 28) + ' ' + i++; pris.add(k.toLowerCase()); return k; };
function exporterXlsx(toutes = true) {
  const wb = XLSX.utils.book_new(); const pris = new Set();
  (toutes ? B.tables : [T()]).forEach(t => XLSX.utils.book_append_sheet(wb, feuilleDeTable(t), nomFeuille(t.nom, pris)));
  wb.Props = { Title: B.nom, Author: '' };
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }));
}
function exporterCsv() {
  const t = T(); const q = s => { s = s instanceof Date ? s.toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : typeof s === 'number' ? String(s).replace('.', ',') : typeof s === 'boolean' ? (s ? 'Oui' : 'Non') : String(s ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [t.colonnes.map(c => q(c.nom)).join(';'), ...lignesVisibles(t).map(l => t.colonnes.map(c => q(valeurExport(B, t, c, l))).join(';'))].join('\r\n');
}
function tablesDepuisClasseur(octets, ext) {
  const wb = ext === 'csv' ? XLSX.read(new TextDecoder().decode(octets).replace(/^﻿/, ''), { type: 'string', raw: false, FS: /;/.test(new TextDecoder().decode(octets.slice(0, 2000)).split('\n')[0]) ? ';' : ',' }) : XLSX.read(octets, { type: 'array', cellDates: true });
  const tables = [];
  for (const nom of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: null, blankrows: false });
    if (!rows.length) continue;
    const entetes = rows[0].map((h, j) => String(h ?? '').trim() || `Colonne ${j + 1}`);
    const vus = new Set(); entetes.forEach((h, j) => { let k = h.replace(/[[\]]/g, ''), i = 2; while (vus.has(k.toLowerCase())) k = `${h} ${i++}`; vus.add(k.toLowerCase()); entetes[j] = k; });
    const corps = rows.slice(1).filter(r => r.some(x => x != null && String(x).trim() !== ''));
    const t = nouvelleTable(nom, '📋', []);
    entetes.forEach((h, j) => { const d = deviner(corps.map(r => r[j])); t.colonnes.push(colonne(h, d.type, d.choix ? { choix: d.choix } : {})); });
    corps.forEach(r => { const l = { id: uid('l'), v: {}, cree: new Date().toISOString() }; t.colonnes.forEach((c, j) => { const v = valeurImportee(c, r[j]); if (v != null && v !== '') l.v[c.id] = v; else if (c.type === 'case') l.v[c.id] = false; }); t.lignes.push(l); });
    tables.push(t);
  }
  if (!tables.length) throw new Error('aucune donnée trouvée');
  return tables;
}
async function importerTableur() {
  const f = await Fi.ouvrirFichier({ titre: 'Importer un fichier Excel ou CSV', filtres: [{ nom: 'Classeurs', ext: ['xlsx', 'xls', 'ods', 'csv'] }] }); if (!f) return;
  let tables; try { tables = tablesDepuisClasseur(f.octets, f.nom.split('.').pop().toLowerCase()); } catch (e) { return toast('Import impossible : ' + e.message, 'erreur'); }
  avant(); tables.forEach(t => { let n = t.nom, i = 2; while (B.tables.some(x => x.nom.toLowerCase() === n.toLowerCase())) n = `${t.nom} ${i++}`; t.nom = n; B.tables.push(t); });
  modifie(); ouvrirTable(tables[0].id); toast(`${tables.length} table${tables.length > 1 ? 's' : ''} importée${tables.length > 1 ? 's' : ''} (${tables.reduce((a, t) => a + t.lignes.length, 0)} lignes).`, 'succes');
}

// ---------- Rendu général ----------
function rendreTout() {
  rendreNavigation();
  if (V.vue === 'concepteur') rendreConcepteur(); else if (V.vue === 'fiche') rendreFiche(); else if (V.vue === 'synthese') rendreSynthese(); else rendreGrille();
  majRuban();
}
function vue(v) { fermerEditeur(true); V.vue = v; rendreTout(); }
function majEtat(n) {
  const t = T();
  $('#barre-etat').innerHTML = `<span>${V.vue === 'concepteur' ? 'Concepteur de formulaire' : `${n} ligne${n > 1 ? 's' : ''}${n !== t?.lignes.length ? ` affichée${n > 1 ? 's' : ''} sur ${t.lignes.length}` : ''}`}</span><span id="etat-cel"></span><span class="espace"></span><span>${B.tables.length} table${B.tables.length > 1 ? 's' : ''} · ${B.formulaires.length} formulaire${B.formulaires.length > 1 ? 's' : ''}</span>`;
}
function majRuban() { ruban.actif('v-grille', V.vue === 'grille'); ruban.actif('v-fiche', V.vue === 'fiche'); ruban.actif('v-synthese', V.vue === 'synthese'); ruban.desactiver('collecter', !B.formulaires.some(f => f.dossier)); }

const ruban = creerRuban($('#zone-ruban'), [
  { id: 'accueil', titre: 'Accueil', groupes: [
    { titre: 'Données', items: [{ type: 'bouton', id: 'ajouter-ligne', ico: 'list-plus', label: 'Ajouter une ligne', grand: true }, { type: 'bouton', id: 'ajouter-colonne', ico: 'columns-3', label: 'Ajouter une colonne', grand: true }, { type: 'bouton', id: 'suppr-lignes', ico: 'trash-2', label: 'Supprimer les lignes', grand: true }] },
    { titre: 'Affichage', items: [{ type: 'bascule', id: 'v-grille', ico: 'table', label: 'Grille', grand: true }, { type: 'bascule', id: 'v-fiche', ico: 'id-card', label: 'Fiche', grand: true }, { type: 'bascule', id: 'v-synthese', ico: 'chart-bar', label: 'Synthèse', grand: true }] },
    { titre: 'Trier et filtrer', items: [{ type: 'pile', items: [{ type: 'bouton', id: 'rechercher', ico: 'search', label: 'Rechercher', avecLabel: true }, { type: 'bouton', id: 'effacer-filtres', ico: 'filter-x', label: 'Effacer les filtres et le tri', avecLabel: true }] }] },
    { titre: 'Tables', items: [{ type: 'bouton', id: 'nouvelle-table', ico: 'table-properties', label: 'Nouvelle table', grand: true }, { type: 'pile', items: [{ type: 'bouton', id: 'renommer-table', ico: 'pencil', label: 'Renommer', avecLabel: true }, { type: 'bouton', id: 'dupliquer-table', ico: 'copy', label: 'Dupliquer la structure', avecLabel: true }, { type: 'bouton', id: 'suppr-table', ico: 'trash-2', label: 'Supprimer la table', avecLabel: true }] }] },
  ] },
  { id: 'formulaires', titre: 'Formulaires', groupes: [
    { titre: 'Créer', items: [{ type: 'bouton', id: 'nouveau-formulaire', ico: 'file-pen-line', label: 'Nouveau formulaire', grand: true }] },
    { titre: 'Réponses', items: [{ type: 'bouton', id: 'collecter', ico: 'inbox', label: 'Collecter les réponses', grand: true }, { type: 'bouton', id: 'importer-reponses', ico: 'file-down', label: 'Importer des réponses', grand: true }] },
  ] },
  { id: 'donnees', titre: 'Données', groupes: [
    { titre: 'Importer', items: [{ type: 'bouton', id: 'importer-tableur', ico: 'file-spreadsheet', label: 'Depuis Excel ou CSV', grand: true }] },
    { titre: 'Exporter', items: [{ type: 'bouton', id: 'exp-xlsx', ico: 'sheet', label: 'Toutes les tables (Excel)', grand: true }, { type: 'bouton', id: 'exp-table', ico: 'table-2', label: 'Cette table (Excel)', grand: true }, { type: 'bouton', id: 'exp-csv', ico: 'file-text', label: 'Cette table (CSV)', grand: true }] },
  ] },
], {
  onFichier: () => doc.ouvrirCoulisses('accueil'),
  actions: {
    'ajouter-ligne': () => { if (V.vue === 'concepteur' || V.vue === 'synthese') V.vue = 'grille'; ajouterLigne(); }, 'ajouter-colonne': () => { if (V.vue !== 'grille') vue('grille'); ajouterColonne(); }, 'suppr-lignes': supprimerLignes,
    'v-grille': () => vue('grille'), 'v-fiche': () => { if (V.cel) V.fiche = Math.max(0, lignesVisibles(T()).findIndex(l => l.id === V.cel.l)); vue('fiche'); }, 'v-synthese': () => vue('synthese'),
    rechercher: () => { if (V.vue !== 'grille') vue('grille'); $('#recherche')?.focus(); }, 'effacer-filtres': () => { V.filtres = {}; V.tri = null; V.recherche = ''; rendreTout(); },
    'nouvelle-table': creerTable, 'renommer-table': renommerTable, 'dupliquer-table': dupliquerTable, 'suppr-table': supprimerTable,
    'nouveau-formulaire': creerFormulaire, collecter: () => collecter(null), 'importer-reponses': importerReponses,
    'importer-tableur': importerTableur, 'exp-xlsx': () => doc.exporter('xlsx'), 'exp-table': () => doc.exporter('xlsx-table'), 'exp-csv': () => doc.exporter('csv'),
  }
});

// ---------- Document ----------
const apercuModele = m => `<div style="font-size:42px;line-height:96px;text-align:center;width:120px;height:96px;background:#fff;border:1px solid #c9ced8;border-radius:6px">${m.emoji}</div>`;
function chargerBase(b) {
  if (b.format !== 'atelier-formulaires') throw new Error('fichier non reconnu');
  b.tables = b.tables || []; b.formulaires = b.formulaires || []; b.reponsesImportees = b.reponsesImportees || [];
  if (!b.tables.length) b.tables.push(nouvelleTable('Table 1'));
  B = b; V.table = B.tables[0].id; V.vue = 'grille'; V.formulaire = null; V.tri = null; V.filtres = {}; V.recherche = ''; V.cel = null; V.lignesSel.clear(); pile.length = 0; futur.length = 0;
  rendreTout();
}
const doc = creerDocument({
  focus: () => $('#grille')?.focus({ preventScroll: true }),
  app: 'formulaires', nomApp: 'FonctionGrist', lettre: 'FG', barreTitre: $('#barre-titre'),
  formatsOuverture: [{ nom: 'Bases FonctionGrist', ext: ['formulaire'] }, { nom: 'Réponses', ext: ['reponse'] }, { nom: 'Classeurs Excel et CSV', ext: ['xlsx', 'xls', 'ods', 'csv'] }],
  formatsEnregistrement: [{ nom: 'Base FonctionGrist', ext: 'formulaire', ecrire: async () => JSON.stringify(B) }],
  exports: [
    { id: 'xlsx', label: 'Classeur Excel (toutes les tables)', ico: 'sheet', ext: 'xlsx', desc: 'Une feuille par table, avec les valeurs calculées.', ecrire: async () => exporterXlsx(true) },
    { id: 'xlsx-table', label: 'Classeur Excel (table affichée)', ico: 'table-2', ext: 'xlsx', desc: 'Uniquement la table en cours.', ecrire: async () => exporterXlsx(false) },
    { id: 'csv', label: 'CSV (table affichée)', ico: 'file-text', ext: 'csv', desc: 'Séparateur point-virgule, compatible Excel. Respecte la recherche et les filtres.', ecrire: async () => exporterCsv() },
  ],
  modeles: MODELES.map(m => ({ ...m, nomDoc: m.id === 'vierge' ? undefined : m.nom, apercu: apercuModele(m) })),
  async nouveau(m) { chargerBase((m || MODELES[0]).creer()); },
  async charger({ octets, ext, nom }) {
    if (ext === 'formulaire') {
      const o = JSON.parse(new TextDecoder().decode(octets));
      if (o.type === 'saisie') { ouvrirSaisie(o); return; }
      chargerBase(o); return;
    }
    if (ext === 'reponse') throw new Error('réponse inattendue');
    const tables = tablesDepuisClasseur(octets, ext); const b = nouvelleBase(nomSansExtension(nom)); b.tables = tables; chargerBase(b);
  },
  intercepter: async f => {
    if (!/\.reponse$/i.test(f.nom)) return undefined;
    let rep; try { rep = lireReponse(f.octets); } catch (e) { toast('Réponse illisible : ' + e.message, 'erreur'); return false; }
    if (B.formulaires.some(x => x.id === rep.formulaire)) { avant(); const r = integrerReponse(rep); if (r.statut === 'ajoutee') modifie(); else pile.pop(); rendreTout(); toast(r.statut === 'ajoutee' ? 'Réponse ajoutée à la table.' : 'Cette réponse est déjà présente dans la base.', r.statut === 'ajoutee' ? 'succes' : 'info'); return true; }
    const d = await dialogue({ titre: 'Réponse à un formulaire', contenu: `<p>Ce fichier contient une réponse au formulaire « <b>${esc(rep.titre || '')}</b> » envoyée le ${esc(new Date(rep.date).toLocaleString('fr-FR'))}.</p><p>Choisissez la base qui reçoit les réponses de ce formulaire.</p>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Choisir la base…', valeur: true, primaire: true }] });
    if (!d) return false;
    const fb = await Fi.ouvrirFichier({ titre: 'Base FonctionGrist', filtres: [{ nom: 'Bases FonctionGrist', ext: ['formulaire'] }] }); if (!fb) return false;
    if (!(await doc.chargerFichier(fb))) return false;
    if (!B.formulaires.some(x => x.id === rep.formulaire)) { toast('Cette base ne contient pas le formulaire de cette réponse.', 'erreur'); return true; }
    const r = integrerReponse(rep); if (r.statut === 'ajoutee') modifie(); rendreTout();
    toast(r.statut === 'ajoutee' ? 'Réponse ajoutée : pensez à enregistrer la base.' : 'Cette réponse est déjà présente dans la base.', r.statut === 'ajoutee' ? 'succes' : 'info');
    return true;
  },
  informations: async () => [['Tables', B.tables.map(t => `${t.nom} (${t.lignes.length})`).join(', ')], ['Formulaires', String(B.formulaires.length)], ['Réponses collectées', String((B.reponsesImportees || []).length)]],
  annuler, retablir, imprimer: () => window.print(),
  commandes: () => ruban.commandes(),
});
const horsSaisie = f => e => { const a = document.activeElement; if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox') || a.tagName === 'SELECT' || a.isContentEditable)) return false; return f(e); };
raccourcis({
  'Ctrl+Z': horsSaisie(annuler), 'Ctrl+Y': horsSaisie(retablir),
  'Ctrl+F': () => { if (V.vue !== 'grille') vue('grille'); $('#recherche')?.focus(); },
  'Ctrl+Maj+L': horsSaisie(() => ajouterLigne()),
});
window.__form = { B: () => B, V, T, rendreTout, doc, vue, integrerReponse, chargerBase, ouvrirTable, ouvrirFormulaire, definitionFormulaire: f => definitionFormulaire(B, f), pageFormulaire, selectionner };
(async () => { rendreTout(); await doc.demarrer(); })();
