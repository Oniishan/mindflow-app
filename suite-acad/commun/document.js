// Suite Acad’ — cycle de vie d'un document (nouveau, ouvrir, enregistrer, exporter, récupérer) et menu Fichier
import { $, $$, el, esc, ico, toast, confirmer, dialogue, raccourcis, extension, nomSansExtension, appliquerTheme, formatOctets, menu } from './ui.js';
import * as F from './fichiers.js';

export function creerDocument(cfg) {
  const {
    app, nomApp, lettre, barreTitre,
    formatsOuverture = [], formatsEnregistrement = [], exports = [], modeles = [],
    nouveau, charger, informations, optionsApp, apresChargement, intercepter
  } = cfg;
  const doc = { nom: 'Sans titre', chemin: null, format: formatsEnregistrement[0]?.ext, prefs: {} };
  // chaque modification incrémente une révision : la récupération automatique ne réécrit que si le document a changé
  let _modifie = false, revision = 0, revisionSauvee = 0;
  Object.defineProperty(doc, 'modifie', { get: () => _modifie, set: v => { _modifie = !!v; if (v) revision++; }, enumerable: true });
  let numSansTitre = 1;

  // ----- Barre de titre -----
  barreTitre.innerHTML = `<div class="tuile${lettre.length > 2 ? ' long' : ''}" aria-hidden="true">${esc(lettre)}</div>
    <button class="btn-t" data-a="enregistrer" title="Enregistrer (Ctrl+S)" aria-label="Enregistrer">${ico('save', 'p')}</button>
    <button class="btn-t" data-a="annuler" title="Annuler (Ctrl+Z)" aria-label="Annuler">${ico('undo-2', 'p')}</button>
    <button class="btn-t" data-a="retablir" title="Rétablir (Ctrl+Y)" aria-label="Rétablir">${ico('redo-2', 'p')}</button>
    <button class="nom-doc" title="Renommer le document">Sans titre</button><span class="etat-doc"></span>
    <span class="espace"></span>
    <label class="recherche-cmd" title="Rechercher une commande (Alt+Q)">${ico('search', 'p')}<input type="search" placeholder="Rechercher une commande" aria-label="Rechercher une commande"></label>
    <span class="espace"></span><span style="opacity:.85;font-size:12px">${esc(nomApp)}</span>`;
  const nomEl = $('.nom-doc', barreTitre), etatEl = $('.etat-doc', barreTitre);
  $('[data-a="enregistrer"]', barreTitre).onclick = () => doc.enregistrer();
  $('[data-a="annuler"]', barreTitre).onclick = () => cfg.annuler && cfg.annuler();
  $('[data-a="retablir"]', barreTitre).onclick = () => cfg.retablir && cfg.retablir();
  nomEl.onclick = async () => {
    const r = await dialogue({ titre: 'Renommer', contenu: `<label class="champ">Nom du document<input type="text" name="nom" value="${esc(nomSansExtension(doc.nom))}"></label>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Renommer', valeur: true, primaire: true }] });
    if (r && r.nom.trim()) { doc.nom = r.nom.trim() + (doc.format ? '.' + doc.format : ''); if (doc.chemin) { doc.chemin = null; } majTitre(); doc.marquerModifie(); }
  };
  // Recherche de commandes (comme « Rechercher » d'Office)
  const rech = $('.recherche-cmd input', barreTitre);
  rech.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const q = rech.value.trim().toLowerCase(); if (!q) return;
      const res = (cfg.commandes ? cfg.commandes() : []).filter(c => c.label.toLowerCase().includes(q)).slice(0, 12);
      menu(res.length ? res.map(c => ({ label: c.label, ico: c.ico, faire: c.faire })) : [{ label: 'Aucune commande trouvée', desactive: true }], 0, 0, rech);
    }
  });

  function majTitre() {
    nomEl.textContent = nomSansExtension(doc.nom);
    etatEl.textContent = doc.modifie ? '• Modifié' : (doc.chemin ? 'Enregistré' : '');
    F.definirTitre(`${nomSansExtension(doc.nom)}${doc.modifie ? ' •' : ''} — ${nomApp}`);
  }
  doc.majTitre = majTitre;
  doc.marquerModifie = (v = true) => { if (v) revision++; if (_modifie !== !!v) { _modifie = !!v; majTitre(); } };

  // ----- Formats -----
  const tousFiltresOuverture = () => [{ nom: 'Tous les formats pris en charge', ext: formatsOuverture.flatMap(f => f.ext) }, ...formatsOuverture.map(f => ({ nom: f.nom, ext: f.ext }))];
  const formatEnr = ext => formatsEnregistrement.find(f => f.ext === ext);

  async function nouveauDoc(modele) {
    if (!(await doc.verifierAbandon())) return false;
    await nouveau(modele);
    numSansTitre++;
    doc.nom = (modele && modele.nomDoc) || (numSansTitre > 2 ? `Sans titre ${numSansTitre - 1}` : 'Sans titre');
    doc.chemin = null; doc.format = formatsEnregistrement[0]?.ext; doc.modifie = false; majTitre();
    fermerCoulisses(); return true;
  }
  doc.nouveau = nouveauDoc;

  async function chargerFichier(f, { ignorerAbandon = false } = {}) {
    if (intercepter) { const r = await intercepter(f); if (r !== undefined) { fermerCoulisses(); return r; } }
    if (!ignorerAbandon && !(await doc.verifierAbandon())) return false;
    const ext = extension(f.nom);
    const fmt = formatsOuverture.find(x => x.ext.includes(ext));
    if (!fmt) { toast(`Le format .${ext} n'est pas pris en charge par ${nomApp}.`, 'erreur'); return false; }
    try {
      await charger({ ...f, ext, format: fmt });
    } catch (e) {
      console.error(e); toast(`Impossible d'ouvrir ${f.nom} : ${e.message || e}`, 'erreur'); return false;
    }
    doc.nom = f.nom; doc.chemin = formatEnr(ext) ? f.chemin : null; doc.format = formatEnr(ext) ? ext : formatsEnregistrement[0]?.ext;
    if (!formatEnr(ext)) doc.nom = nomSansExtension(f.nom) + '.' + doc.format;
    doc.modifie = false; majTitre();
    if (f.chemin) F.ajouterRecent(app, f.chemin, f.nom);
    fermerCoulisses();
    apresChargement && apresChargement();
    return true;
  }
  doc.chargerFichier = chargerFichier;

  doc.ouvrir = async () => {
    if (!(await doc.verifierAbandon())) return;
    const f = await F.ouvrirFichier({ titre: 'Ouvrir', filtres: tousFiltresOuverture() });
    if (f) await chargerFichier(f, { ignorerAbandon: true });
  };
  doc.ouvrirChemin = async (chemin, ignorerAbandon = false) => {
    try {
      const octets = await F.lireChemin(chemin);
      return chargerFichier({ nom: chemin.split(/[\\/]/).pop(), chemin, octets }, { ignorerAbandon });
    } catch (e) { toast(`Impossible d'ouvrir ${chemin} : ${e.message}`, 'erreur'); F.retirerRecent(app, chemin); return false; }
  };

  doc.enregistrer = async () => {
    const fmt = formatEnr(doc.format);
    if (!doc.chemin || !fmt) return doc.enregistrerSous();
    return ecrireAvec(fmt, doc.chemin);
  };
  async function ecrireAvec(fmt, chemin) {
    try {
      const octets = await fmt.ecrire();
      const r = await F.enregistrerFichier({ octets, chemin, nomSuggere: nomSansExtension(doc.nom), filtres: [{ nom: fmt.nom, ext: [fmt.ext] }] });
      if (!r) return false;
      doc.chemin = r.chemin; doc.nom = r.nom; doc.format = fmt.ext; doc.modifie = false; majTitre();
      if (r.chemin) F.ajouterRecent(app, r.chemin, r.nom);
      effacerRecuperation();
      toast(`Enregistré : ${r.nom}`, 'succes');
      fermerCoulisses();
      return true;
    } catch (e) { console.error(e); toast(`Échec de l'enregistrement : ${e.message || e}`, 'erreur'); return false; }
  }
  doc.enregistrerSous = async (ext) => {
    let fmt = formatEnr(ext) || formatEnr(doc.format) || formatsEnregistrement[0];
    if (!ext && formatsEnregistrement.length > 1 && !F.NATIF) {
      // En mode navigateur, demander le format
      const r = await dialogue({ titre: 'Enregistrer sous', contenu: `<label class="champ">Format<select name="f">${formatsEnregistrement.map(f => `<option value="${f.ext}" ${f.ext === fmt.ext ? 'selected' : ''}>${esc(f.nom)} (.${f.ext})</option>`).join('')}</select></label>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Enregistrer', valeur: true, primaire: true }] });
      if (!r) return false; fmt = formatEnr(r.f);
    }
    if (F.NATIF && !ext) {
      const filtres = [fmt, ...formatsEnregistrement.filter(f => f !== fmt)].map(f => ({ nom: f.nom, ext: [f.ext] }));
      const r = await F.appelApi('/api/fichier/choisir-enregistrement', { nomSuggere: nomSansExtension(doc.nom), filtres, titre: 'Enregistrer sous' });
      if (!r || r.annule) return false;
      fmt = formatEnr(extension(r.chemin)) || fmt;
      let chemin = r.chemin; if (extension(chemin) !== fmt.ext) chemin += '.' + fmt.ext;
      return ecrireAvec(fmt, chemin);
    }
    return ecrireAvec(fmt, null);
  };
  doc.exporter = async (id) => {
    const x = exports.find(e => e.id === id); if (!x) return;
    fermerCoulisses();
    try {
      if (x.faire) return await x.faire();
      const octets = await x.ecrire();
      const r = await F.enregistrerFichier({ octets, nomSuggere: nomSansExtension(doc.nom), filtres: [{ nom: x.label, ext: [x.ext] }], titre: 'Exporter' });
      if (r) toast(`Exporté : ${r.nom}`, 'succes');
    } catch (e) { console.error(e); toast(`Échec de l'export : ${e.message || e}`, 'erreur'); }
  };
  doc.imprimer = () => { fermerCoulisses(); (cfg.imprimer || (() => window.print()))(); };

  doc.verifierAbandon = async () => {
    if (!doc.modifie) return true;
    const r = await dialogue({
      titre: nomApp, contenu: `<p>Voulez-vous enregistrer les modifications apportées à « ${esc(nomSansExtension(doc.nom))} » ?</p>`,
      boutons: [{ label: 'Annuler', valeur: null }, { label: 'Ne pas enregistrer', valeur: 'non', id: 'ne-pas-enregistrer' }, { label: 'Enregistrer', valeur: 'oui', primaire: true }]
    });
    if (!r) return false;
    if (r.valeur === 'oui') return await doc.enregistrer();
    return true;
  };
  // Appelé par le moteur natif quand l'utilisateur ferme la fenêtre
  window.__atelierFermer = async () => { if (await doc.verifierAbandon()) { effacerRecuperation(); F.fermerFenetre(); } };
  window.addEventListener('beforeunload', e => { if (doc.modifie && !F.NATIF) { e.preventDefault(); e.returnValue = ''; } });

  // ----- Récupération automatique -----
  let recuperationEnCours = false;
  async function sauverRecuperation() {
    if (!doc.modifie || !F.NATIF || !formatsEnregistrement[0] || recuperationEnCours || revision === revisionSauvee) return;
    recuperationEnCours = true;
    const rev = revision;
    try {
      // attendre un moment d'inactivité pour ne pas interrompre la saisie
      await new Promise(r => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 8000 }) : setTimeout(r, 200)));
      const octets = await (cfg.ecrireRecuperation || formatsEnregistrement[0].ecrire)();
      revisionSauvee = rev;
      await F.appelApi(`/api/recuperation/ecrire?app=${app}&nom=${encodeURIComponent(nomSansExtension(doc.nom) + '.' + formatsEnregistrement[0].ext)}`, undefined, { binaire: octets });
    } catch { } finally { recuperationEnCours = false; }
  }
  function effacerRecuperation() { if (F.NATIF) F.appelApi('/api/recuperation/effacer?app=' + app, {}).catch(() => { }); }
  setInterval(sauverRecuperation, cfg.intervalleRecuperation || 60000);
  doc.sauverRecuperation = sauverRecuperation;
  async function proposerRecuperation() {
    if (!F.NATIF) return false;
    try {
      const info = await F.appelApi('/api/recuperation?app=' + app, undefined, { methode: 'GET' });
      if (!info || !info.nom) return false;
      const r = await dialogue({ titre: 'Récupération de document', contenu: `<p>${esc(nomApp)} s'est fermé alors que « ${esc(nomSansExtension(info.nom))} » contenait des modifications non enregistrées (${esc(new Date(info.date).toLocaleString('fr-FR'))}).</p><p>Voulez-vous récupérer cette version ?</p>`, boutons: [{ label: 'Ignorer', valeur: 'non', id: 'ignorer' }, { label: 'Récupérer', valeur: 'oui', primaire: true }] });
      if (r && r.valeur === 'oui') {
        const octets = await F.appelApi('/api/recuperation/lire?app=' + app, {}, { brut: true });
        await charger({ nom: info.nom, chemin: null, octets, ext: extension(info.nom), format: formatsOuverture.find(x => x.ext.includes(extension(info.nom))) });
        doc.nom = info.nom; doc.chemin = null; doc.modifie = true; majTitre(); return true;
      }
      effacerRecuperation();
    } catch { }
    return false;
  }

  // ----- Coulisses (menu Fichier) -----
  let coulisses = null;
  function fermerCoulisses() {
    if (!coulisses) return;
    coulisses.remove(); coulisses = null;
    // rendre le clavier à la zone de travail de l'application
    if (cfg.focus) setTimeout(() => { const a = document.activeElement; if (!a || a === document.body || !a.isConnected) { try { cfg.focus(); } catch { } } }, 0);
  }
  doc.fermerCoulisses = fermerCoulisses;
  doc.ouvrirCoulisses = async (section = 'accueil') => {
    fermerCoulisses();
    coulisses = el(`<div class="coulisses" role="dialog" aria-label="Fichier">
      <nav>
        <button class="retour" data-s="retour">${ico('arrow-left')}<span>Retour</span></button>
        <button data-s="accueil">${ico('house')}<span>Accueil</span></button>
        <button data-s="nouveau">${ico('file-plus')}<span>Nouveau</span></button>
        <button data-s="ouvrir">${ico('folder-open')}<span>Ouvrir</span></button>
        <button data-s="infos">${ico('info')}<span>Informations</span></button>
        ${F.NATIF ? `<button data-s="externe">${ico('external-link')}<span>Ouvrir avec…</span></button>` : ''}
        <hr>
        <button data-s="enregistrer">${ico('save')}<span>Enregistrer</span></button>
        <button data-s="enregistrer-sous">${ico('save-all')}<span>Enregistrer sous</span></button>
        ${exports.length ? `<button data-s="exporter">${ico('file-output')}<span>Exporter</span></button>` : ''}
        <button data-s="imprimer">${ico('printer')}<span>Imprimer</span></button>
        <hr>
        <button data-s="fermer">${ico('x')}<span>Fermer</span></button>
        <span style="flex:1"></span>
        <button data-s="options">${ico('settings')}<span>Options</span></button>
      </nav><div class="panneau-c"></div></div>`);
    document.body.appendChild(coulisses);
    const panneau = $('.panneau-c', coulisses);
    const afficher = async (s) => {
      $$('nav button', coulisses).forEach(b => b.classList.toggle('actif', b.dataset.s === s));
      if (s === 'retour') return fermerCoulisses();
      if (s === 'enregistrer') return doc.enregistrer();
      if (s === 'enregistrer-sous') return doc.enregistrerSous();
      if (s === 'imprimer') return doc.imprimer();
      if (s === 'fermer') { if (await doc.verifierAbandon()) { doc.modifie = false; if (F.NATIF) { effacerRecuperation(); F.fermerFenetre(); } else { await nouveau(); doc.nom = 'Sans titre'; doc.chemin = null; majTitre(); fermerCoulisses(); } } return; }
      if (s === 'accueil' || s === 'nouveau') {
        panneau.innerHTML = `<h1>${s === 'accueil' ? 'Bonjour' : 'Nouveau'}</h1><div class="modeles"></div>${s === 'accueil' ? '<h3>Récents</h3><div class="liste-recents"></div>' : ''}`;
        const zm = $('.modeles', panneau);
        modeles.forEach(m => {
          const b = el(`<button class="modele" data-modele="${esc(m.id)}"><div class="apercu">${m.apercu || ''}</div><div>${esc(m.nom)}</div></button>`);
          b.onclick = () => nouveauDoc(m); zm.appendChild(b);
        });
        if (s === 'accueil') await rendreRecents($('.liste-recents', panneau), 6);
      }
      if (s === 'ouvrir') {
        panneau.innerHTML = `<h1>Ouvrir</h1><div class="actions-c"><button class="action-c" data-a="parcourir">${ico('folder-search', 'g')}<span><b>Parcourir</b><small>${esc(formatsOuverture.map(f => f.ext.map(e => '.' + e).join(' ')).join(' '))}</small></span></button></div><h3>Documents récents</h3><div class="liste-recents"></div>`;
        $('[data-a="parcourir"]', panneau).onclick = () => doc.ouvrir();
        await rendreRecents($('.liste-recents', panneau), 20);
      }
      if (s === 'externe') {
        panneau.innerHTML = `<h1>Ouvrir avec une autre application</h1><p style="color:var(--encre-2);max-width:70ch">Pour un document très complexe, vous pouvez l'ouvrir dans une autre suite bureautique installée sur ce poste. Le document est d'abord enregistré.</p><div class="actions-c liste-ext"><p>Recherche des applications installées…</p></div>`;
        let l = [];
        try { l = (await F.appelApi('/api/externes/lister', { ext: doc.format || '' })).applications || []; } catch { }
        const z = $('.liste-ext', panneau);
        if (!l.length) { z.innerHTML = `<p style="color:var(--encre-2)">Aucune autre suite bureautique compatible avec ce format n'est installée sur ce poste (Euro-Office, LibreOffice, Microsoft Office…).</p>`; return; }
        z.innerHTML = l.map(a => `<button class="action-c" data-ext="${esc(a.id)}">${ico('external-link', 'g')}<span><b>${esc(a.nom)}</b><small>Ouvrir « ${esc(nomSansExtension(doc.nom))}.${esc(doc.format || '')} »</small></span></button>`).join('');
        $$('[data-ext]', z).forEach(b => b.onclick = async () => {
          if (!doc.chemin || doc.modifie) { const ok = await doc.enregistrer(); if (!ok || !doc.chemin) return; }
          try { await F.appelApi('/api/externes/ouvrir', { id: b.dataset.ext, chemin: doc.chemin }); toast('Ouverture dans ' + b.querySelector('b').textContent + '…', 'info'); fermerCoulisses(); }
          catch (e) { toast(e.message, 'erreur'); }
        });
      }
      if (s === 'infos') {
        const inf = informations ? await informations() : [];
        panneau.innerHTML = `<h1>Informations</h1><table class="tab-infos" style="border-collapse:collapse;min-width:420px">${[['Nom', nomSansExtension(doc.nom)], ['Emplacement', doc.chemin || 'Non enregistré'], ['Format', doc.format ? '.' + doc.format : ''], ['État', doc.modifie ? 'Modifications non enregistrées' : 'À jour'], ...inf].map(([k, v]) => `<tr><th style="text-align:left;padding:8px 24px 8px 0;color:var(--encre-2);font-weight:600">${esc(k)}</th><td style="padding:8px 0">${esc(v)}</td></tr>`).join('')}</table>
          ${doc.chemin && F.NATIF ? `<p style="margin-top:18px"><button class="btn" data-a="explorer">${ico('folder')}Afficher dans l'Explorateur</button></p>` : ''}`;
        const be = $('[data-a="explorer"]', panneau); if (be) be.onclick = () => F.afficherDansExplorateur(doc.chemin);
      }
      if (s === 'exporter') {
        panneau.innerHTML = `<h1>Exporter</h1><div class="actions-c"></div>`;
        const z = $('.actions-c', panneau);
        exports.forEach(x => { const b = el(`<button class="action-c" data-export="${x.id}">${ico(x.ico || 'file-output', 'g')}<span><b>${esc(x.label)}</b><small>${esc(x.desc || '')}</small></span></button>`); b.onclick = () => doc.exporter(x.id); z.appendChild(b); });
      }
      if (s === 'options') {
        panneau.innerHTML = `<h1>Options</h1><div style="display:flex;flex-direction:column;gap:16px;max-width:520px">
          <label class="champ">Thème<select name="theme"><option value="systeme">Comme le système</option><option value="clair">Clair</option><option value="sombre">Sombre</option></select></label>
          <div class="opts-app"></div></div>`;
        const s = $('[name="theme"]', panneau); s.value = doc.prefs.theme || 'systeme';
        s.onchange = () => { doc.prefs.theme = s.value; appliquerTheme(s.value); F.ecrirePrefs(app, doc.prefs); };
        if (optionsApp) optionsApp($('.opts-app', panneau), doc.prefs, () => F.ecrirePrefs(app, doc.prefs));
      }
    };
    $$('nav button', coulisses).forEach(b => b.onclick = () => afficher(b.dataset.s));
    coulisses.addEventListener('keydown', e => { if (e.key === 'Escape') fermerCoulisses(); });
    await afficher(section);
    $('nav [data-s="retour"]', coulisses).focus();
  };
  async function rendreRecents(zone, n) {
    const l = (await F.recents(app)).slice(0, n);
    if (!l.length) { zone.innerHTML = `<div class="vide">Les documents que vous ouvrez apparaîtront ici.</div>`; return; }
    zone.innerHTML = '';
    l.forEach(r => {
      const b = el(`<button title="${esc(r.chemin)}">${ico('file-text')}<span style="min-width:0"><div>${esc(r.nom)}</div><div class="chemin">${esc(r.chemin)}</div></span></button>`);
      b.onclick = () => doc.ouvrirChemin(r.chemin); zone.appendChild(b);
    });
  }

  // ----- Raccourcis communs -----
  raccourcis({
    'Ctrl+S': () => doc.enregistrer(),
    'Ctrl+Maj+S': () => doc.enregistrerSous(),
    'F12': () => doc.enregistrerSous(),
    'Ctrl+O': () => doc.ouvrir(),
    'Ctrl+N': () => nouveauDoc(),
    'Ctrl+P': () => doc.imprimer(),
    'Alt+q': () => rech.focus(), 'Alt+Q': () => rech.focus(),
  });

  // ----- Démarrage -----
  doc.demarrer = async () => {
    doc.prefs = await F.lirePrefs(app);
    appliquerTheme(doc.prefs.theme || 'systeme');
    await nouveau();
    majTitre();
    const ses = F.SESSION;
    if (ses && ses.diagnostic) { setTimeout(() => import('./diagnostic.js').then(d => d.lancer(doc, cfg)), 600); return; }
    if (ses && ses.fichier) { await doc.ouvrirChemin(ses.fichier, true); return; }
    if (await proposerRecuperation()) return;
    if (cfg.coulissesAuDemarrage !== false && !(ses && ses.test)) doc.ouvrirCoulisses('accueil');
  };
  doc.formatOctets = formatOctets;
  return doc;
}
