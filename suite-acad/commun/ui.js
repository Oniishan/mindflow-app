// Suite Acad’ — composants d'interface communs
import { ICONES } from './icones.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function ico(nom, cls = '') {
  const c = ICONES[nom] || ICONES['circle-help'] || '';
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${c}</svg>`;
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export function debounce(f, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); };
}
export function formatOctets(n) {
  if (n == null || isNaN(n)) return '';
  const u = ['o', 'Ko', 'Mo', 'Go'];
  let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)).toString().replace('.', ',') + ' ' + u[i];
}
export function uid(p = 'x') { return p + Math.random().toString(36).slice(2, 9); }

// ---------- Thème ----------
export function appliquerTheme(t) {
  const r = document.documentElement;
  if (t === 'clair' || t === 'sombre') r.dataset.theme = t; else delete r.dataset.theme;
}

// ---------- Notifications ----------
let zoneToasts;
export function toast(message, type = 'info', opts = {}) {
  if (!zoneToasts) { zoneToasts = el('<div class="zone-toasts" role="status" aria-live="polite"></div>'); document.body.appendChild(zoneToasts); }
  const t = el(`<div class="toast ${type}"><span>${esc(message)}</span></div>`);
  if (opts.action) {
    const b = el(`<button>${esc(opts.action.label)}</button>`);
    b.onclick = () => { opts.action.faire(); t.remove(); };
    t.appendChild(b);
  }
  const f = el(`<button aria-label="Fermer">${ico('x', 'p')}</button>`);
  f.onclick = () => t.remove();
  t.appendChild(f);
  zoneToasts.appendChild(t);
  setTimeout(() => t.remove(), opts.duree || (type === 'erreur' ? 8000 : 4000));
  return t;
}

// ---------- Dialogues ----------
export function dialogue({ titre, contenu = '', boutons = [{ label: 'OK', valeur: true, primaire: true }], taille = '', init, valider, fermable = true }) {
  return new Promise(resolve => {
    const prec = document.activeElement;
    const v = el(`<div class="voile"><div class="dialogue ${taille}" role="dialog" aria-modal="true" aria-label="${esc(titre)}">
      <header><h2>${esc(titre)}</h2>${fermable ? `<button class="btn discret icone" data-fermer aria-label="Fermer">${ico('x')}</button>` : ''}</header>
      <form class="corps" novalidate></form><footer></footer></div></div>`);
    const corps = $('.corps', v);
    if (typeof contenu === 'string') corps.innerHTML = contenu; else if (contenu) corps.appendChild(contenu);
    const pied = $('footer', v);
    const fin = (val) => {
      v.remove(); document.removeEventListener('keydown', clavier, true);
      if (prec && prec.focus) try { prec.focus(); } catch { }
      resolve(val);
    };
    const donnees = () => {
      const o = {};
      $$('[name]', corps).forEach(i => {
        if (i.type === 'checkbox') o[i.name] = i.checked;
        else if (i.type === 'radio') { if (i.checked) o[i.name] = i.value; }
        else o[i.name] = i.value;
      });
      return o;
    };
    boutons.forEach(b => {
      const n = el(`<button type="button" class="btn ${b.primaire ? 'primaire' : ''} ${b.danger ? 'danger' : ''} ${b.gauche ? 'gauche' : ''}">${esc(b.label)}</button>`);
      if (b.id) n.dataset.id = b.id;
      n.onclick = async () => {
        if (b.valeur === undefined || b.valeur === null || b.valeur === false) return fin(null);
        const d = donnees();
        if (valider && b.primaire) { const err = await valider(d, corps); if (err) { toast(err, 'erreur'); return; } }
        fin({ valeur: b.valeur, ...d, donnees: d, corps });
      };
      pied.appendChild(n);
    });
    const fermer = $('[data-fermer]', v); if (fermer) fermer.onclick = () => fin(null);
    const clavier = e => {
      if (e.key === 'Escape' && fermable) { e.stopPropagation(); e.preventDefault(); fin(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !(e.target.tagName === 'BUTTON')) {
        const p = $('.btn.primaire', pied); if (p) { e.preventDefault(); p.click(); }
      }
    };
    document.addEventListener('keydown', clavier, true);
    corps.addEventListener('submit', e => e.preventDefault());
    document.body.appendChild(v);
    if (init) init(corps, v, fin);
    const premier = $('input:not([type=hidden]),select,textarea', corps) || $('.btn.primaire', pied);
    if (premier) setTimeout(() => { premier.focus(); if (premier.select && premier.type === 'text') premier.select(); }, 0);
  });
}
export async function confirmer(titre, message, ok = 'Confirmer', danger = false) {
  const r = await dialogue({ titre, contenu: `<p>${esc(message)}</p>`, boutons: [{ label: 'Annuler', valeur: null }, { label: ok, valeur: true, primaire: !danger, danger }] });
  return !!r;
}
export async function demander(titre, label, defaut = '', type = 'text') {
  const r = await dialogue({ titre, contenu: `<label class="champ">${esc(label)}<input type="${type}" name="v" value="${esc(defaut)}"></label>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'OK', valeur: true, primaire: true }] });
  return r ? r.v : null;
}
export async function alerte(titre, message) {
  await dialogue({ titre, contenu: `<p>${esc(message)}</p>` });
}

// ---------- Menus flottants ----------
let menuOuvert = null;
export function fermerMenu() { if (menuOuvert) { menuOuvert.remove(); menuOuvert = null; } }
export function menu(items, x, y, ancre) {
  fermerMenu();
  const m = el('<div class="menu-flottant" role="menu"></div>');
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.appendChild(el('<hr>')); continue; }
    if (it.titre) { m.appendChild(el(`<div class="titre-m">${esc(it.titre)}</div>`)); continue; }
    if (it.element) { m.appendChild(it.element); continue; }
    const b = el(`<button class="item-m ${it.danger ? 'danger' : ''}" role="menuitem">${it.coche !== undefined ? `<span class="coche">${it.coche ? ico('check', 'p') : ''}</span>` : (it.ico ? ico(it.ico, 'p') : '')}<span>${esc(it.label)}</span>${it.raccourci ? `<span class="raccourci">${esc(it.raccourci)}</span>` : ''}</button>`);
    if (it.id) b.dataset.id = it.id;
    if (it.desactive) b.disabled = true;
    b.onclick = (e) => { e.stopPropagation(); fermerMenu(); it.faire && it.faire(); };
    m.appendChild(b);
  }
  document.body.appendChild(m);
  if (ancre) { const r = ancre.getBoundingClientRect(); x = r.left; y = r.bottom + 2; }
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(4, Math.min(x, innerWidth - w - 6)) + 'px';
  m.style.top = Math.max(4, (y + h > innerHeight - 6 ? Math.max(4, y - h - (ancre ? ancre.offsetHeight + 4 : 0)) : y)) + 'px';
  menuOuvert = m;
  const p = m.querySelector('button'); if (p) p.focus({ preventScroll: true });
  m.addEventListener('keydown', e => {
    const bs = $$('button.item-m:not(:disabled)', m); const i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); fermerMenu(); }
  });
  return m;
}
document.addEventListener('mousedown', e => { if (menuOuvert && !menuOuvert.contains(e.target)) fermerMenu(); }, true);
window.addEventListener('blur', fermerMenu);

export const COULEURS = ['#000000', '#434343', '#666666', '#999999', '#B7B7B7', '#CCCCCC', '#D9D9D9', '#EFEFEF', '#F3F3F3', '#FFFFFF',
  '#980000', '#FF0000', '#FF9900', '#FFFF00', '#00FF00', '#00FFFF', '#4A86E8', '#0000FF', '#9900FF', '#FF00FF',
  '#E6B8AF', '#F4CCCC', '#FCE5CD', '#FFF2CC', '#D9EAD3', '#D0E0E3', '#C9DAF8', '#CFE2F3', '#D9D2E9', '#EAD1DC',
  '#CC4125', '#E06666', '#F6B26B', '#FFD966', '#93C47D', '#76A5AF', '#6D9EEB', '#6FA8DC', '#8E7CC3', '#C27BA0',
  '#85200C', '#990000', '#B45F06', '#BF9000', '#38761D', '#134F5C', '#1155CC', '#0B5394', '#351C75', '#741B47'];
export function choisirCouleur(ancre, { aucune = false, labelAucune = 'Aucune couleur' } = {}) {
  return new Promise(res => {
    let fait = false;
    const grille = el('<div class="palette"></div>');
    COULEURS.forEach(c => { const b = el(`<button title="${c}" style="background:${c}" data-c="${c}"></button>`); b.onclick = () => { fait = true; fermerMenu(); res(c); }; grille.appendChild(b); });
    const perso = el(`<button class="item-m">${ico('pipette', 'p')}<span>Autre couleur…</span></button>`);
    const items = [{ element: grille }];
    if (aucune) items.push({ label: labelAucune, ico: 'ban', faire: () => { fait = true; res('transparent'); } });
    items.push('-', { element: perso });
    const m = menu(items, 0, 0, ancre);
    perso.onclick = () => {
      const i = document.createElement('input'); i.type = 'color'; i.style.position = 'fixed'; i.style.opacity = 0; document.body.appendChild(i);
      i.oninput = () => { fait = true; res(i.value); i.remove(); };
      i.click(); fermerMenu();
    };
    const obs = new MutationObserver(() => { if (!document.body.contains(m)) { obs.disconnect(); setTimeout(() => { if (!fait) res(null); }, 30000); } });
    obs.observe(document.body, { childList: true });
  });
}

// ---------- Ruban ----------
// def : [{id, titre, groupes:[{titre, items:[...]}]}]
// item : {type:'bouton'|'bascule'|'select'|'couleur'|'menu'|'pile'|'ligne'|'sep'|'html'|'saisie', id, ico, label, grand, title, ...}
export function creerRuban(conteneur, def, { onFichier, actions = {} } = {}) {
  const onglets = el('<div class="onglets-ruban" role="tablist"></div>');
  const ruban = el('<div class="ruban" role="toolbar"></div>');
  conteneur.append(onglets, ruban);
  const etat = { courant: null, elements: {} };
  const bf = el(`<button class="onglet-r fichier" data-onglet="fichier">Fichier</button>`);
  bf.onclick = () => onFichier && onFichier();
  onglets.appendChild(bf);
  const panneaux = {};
  const rendreItem = (it, parent) => {
    if (it.type === 'sep') { parent.appendChild(el('<div class="sep-r"></div>')); return; }
    if (it.type === 'pile' || it.type === 'ligne') {
      const p = el(`<div class="${it.type}-r"></div>`); it.items.forEach(s => rendreItem(s, p)); parent.appendChild(p); return;
    }
    if (it.type === 'html') { const n = typeof it.html === 'string' ? el(it.html) : it.html; parent.appendChild(n); if (it.id) etat.elements[it.id] = n; return; }
    if (it.type === 'select') {
      const s = el(`<select title="${esc(it.title || it.label || '')}" aria-label="${esc(it.title || it.label || '')}" data-id="${it.id}" style="width:${it.largeur || 120}px"></select>`);
      (it.options || []).forEach(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; s.appendChild(el(`<option value="${esc(v)}">${esc(l)}</option>`)); });
      s.onchange = () => { const f = actions[it.id]; f && f(s.value); };
      s.addEventListener('mousedown', () => { etat.memoSel = true; });
      parent.appendChild(s); etat.elements[it.id] = s; return;
    }
    if (it.type === 'saisie') {
      const s = el(`<input type="${it.typeSaisie || 'text'}" data-id="${it.id}" title="${esc(it.title || '')}" aria-label="${esc(it.title || it.label || '')}" style="width:${it.largeur || 80}px" ${it.attrs || ''}>`);
      s.onchange = () => { const f = actions[it.id]; f && f(s.value); };
      if (it.label) { const w = el(`<label class="ligne-r" style="gap:4px;font-size:12px">${esc(it.label)}</label>`); w.appendChild(s); parent.appendChild(w); } else parent.appendChild(s);
      etat.elements[it.id] = s; return;
    }
    const b = el(`<button class="btn-r ${it.grand ? 'grand' : ''} ${it.type === 'couleur' ? 'couleur' : ''}" data-id="${it.id}" title="${esc((it.title || it.label || '') + (it.raccourci ? ' (' + it.raccourci + ')' : ''))}" aria-label="${esc(it.title || it.label || '')}">
      ${it.ico ? ico(it.ico) : ''}${it.label && (it.grand || it.avecLabel) ? `<span>${esc(it.label)}</span>` : ''}${it.type === 'menu' || it.type === 'couleur' ? ico('chevron-down', 'fleche') : ''}${it.type === 'couleur' ? `<span class="barre-c" style="background:${it.defaut || '#000'}"></span>` : ''}</button>`);
    if (it.type === 'bascule') b.setAttribute('aria-pressed', 'false');
    b.onmousedown = e => { if (!it.focus) e.preventDefault(); };
    b.onclick = async e => {
      if (it.type === 'menu') {
        if (actions[it.id]) { actions[it.id](b); return; }
        const items = typeof it.items === 'function' ? it.items() : it.items;
        menu(items, 0, 0, b); return;
      }
      if (it.type === 'couleur') {
        const fl = b.querySelector(".fleche")?.getBoundingClientRect(); const zoneFleche = !!e.target.closest?.(".fleche") || (fl ? e.clientX >= fl.left : false);
        let c = b.dataset.couleur || it.defaut;
        if (zoneFleche || !it.applicationDirecte) {
          c = await choisirCouleur(b, { aucune: it.aucune, labelAucune: it.labelAucune });
          if (!c) return;
          b.dataset.couleur = c; b.querySelector('.barre-c').style.background = c === 'transparent' ? 'repeating-linear-gradient(45deg,#ccc 0 2px,#fff 2px 4px)' : c;
        }
        const f = actions[it.id]; f && f(c); return;
      }
      const f = actions[it.id]; f && f(b);
    };
    parent.appendChild(b); etat.elements[it.id] = b;
  };
  def.forEach((o, i) => {
    const b = el(`<button class="onglet-r ${o.contextuel ? 'contextuel masque' : ''}" role="tab" data-onglet="${o.id}">${esc(o.titre)}</button>`);
    b.onclick = () => api.afficher(o.id);
    b.ondblclick = () => ruban.classList.toggle('replie');
    onglets.appendChild(b);
    const p = el(`<div class="contenu-ruban" data-panneau="${o.id}" style="display:contents"></div>`);
    o.groupes.forEach(g => {
      const ge = el(`<div class="groupe-r" data-groupe="${esc(g.titre)}"><div class="contenu-g"></div><div class="titre-g">${esc(g.titre)}</div></div>`);
      g.items.forEach(it => rendreItem(it, $('.contenu-g', ge)));
      p.appendChild(ge);
    });
    panneaux[o.id] = p;
  });
  const api = {
    onglets, ruban,
    afficher(id) {
      etat.courant = id;
      ruban.classList.remove('replie');
      $$('.onglet-r', onglets).forEach(b => b.classList.toggle('actif', b.dataset.onglet === id));
      ruban.innerHTML = ''; ruban.appendChild(panneaux[id]);
    },
    contextuel(id, visible) {
      const b = $(`[data-onglet="${id}"]`, onglets); if (!b) return;
      b.classList.toggle('masque', !visible);
      if (!visible && etat.courant === id) api.afficher(def[0].id);
    },
    el: id => etat.elements[id],
    actif(id, v) { const b = etat.elements[id]; if (b) { b.classList.toggle('actif', !!v); b.setAttribute('aria-pressed', v ? 'true' : 'false'); } },
    valeur(id, v) { const s = etat.elements[id]; if (s && document.activeElement !== s) { if (s.tagName === 'SELECT' && v !== '' && v != null && ![...s.options].some(o => o.value == v)) s.appendChild(el(`<option value="${esc(v)}">${esc(v)}</option>`)); s.value = v ?? ''; } },
    desactiver(id, v) { const b = etat.elements[id]; if (b) b.disabled = !!v; },
    get courant() { return etat.courant; },
    // liste de toutes les commandes du ruban (pour la recherche de commandes)
    commandes() {
      const l = [];
      const parcourir = (items, onglet) => items.forEach(it => {
        if (it.items && (it.type === 'pile' || it.type === 'ligne')) return parcourir(it.items, onglet);
        const lib = it.title || it.label; if (!lib || !it.id) return;
        l.push({ label: lib, ico: it.ico, faire: () => { if (onglet.contextuel && $(`[data-onglet="${onglet.id}"]`, onglets).classList.contains('masque')) return; api.afficher(onglet.id); const e = etat.elements[it.id]; if (e) { if (e.tagName === 'SELECT' || e.tagName === 'INPUT') e.focus(); else e.click(); } } });
      });
      def.forEach(o => o.groupes.forEach(g => parcourir(g.items, o)));
      return l;
    }
  };
  api.afficher(def[0].id);
  return api;
}

// ---------- Raccourcis clavier ----------
export function raccourcis(map, cible = document) {
  cible.addEventListener('keydown', e => {
    const k = (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.shiftKey ? 'Maj+' : '') + (e.altKey ? 'Alt+' : '') + (e.key.length === 1 ? e.key.toUpperCase() : e.key);
    const f = map[k];
    if (f) { const r = f(e); if (r !== false) { e.preventDefault(); e.stopPropagation(); } }
  });
}

// ---------- Historique (annuler / rétablir) ----------
export class Historique {
  constructor(limite = 200) { this.pile = []; this.futur = []; this.limite = limite; }
  pousser(etat) {
    const s = typeof etat === 'string' ? etat : JSON.stringify(etat);
    if (this.pile.length && this.pile[this.pile.length - 1] === s) return;
    this.pile.push(s); if (this.pile.length > this.limite) this.pile.shift(); this.futur = [];
  }
  annuler(courant) {
    if (!this.pile.length) return null;
    const s = typeof courant === 'string' ? courant : JSON.stringify(courant);
    let p = this.pile.pop(); if (p === s && this.pile.length) { this.futur.push(p); p = this.pile.pop(); }
    this.futur.push(s); return p;
  }
  retablir(courant) {
    if (!this.futur.length) return null;
    const s = typeof courant === 'string' ? courant : JSON.stringify(courant);
    this.pile.push(s); return this.futur.pop();
  }
  get peutAnnuler() { return this.pile.length > 0; }
  get peutRetablir() { return this.futur.length > 0; }
}

// ---------- Téléchargement / lecture de fichiers côté navigateur ----------
export function lireCommeTexte(octets) { return new TextDecoder('utf-8').decode(octets); }
export function versOctets(texte) { return new TextEncoder().encode(texte); }
export function telechargerBlob(blob, nom) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export function nomSansExtension(n) { return String(n || '').replace(/\.[^.\\/]+$/, ''); }
export function extension(n) { const m = /\.([^.\\/]+)$/.exec(n || ''); return m ? m[1].toLowerCase() : ''; }
export function dateFr(d = new Date()) { return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); }
