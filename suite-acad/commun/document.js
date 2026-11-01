// Suite Acad’ — cycle de vie d'un document (nouveau, ouvrir, enregistrer, exporter, récupérer) et menu Fichier
import { $, $$, el, esc, ico, toast, confirmer, dialogue, raccourcis, extension, nomSansExtension, appliquerTheme, formatOctets, menu } from './ui.js';
import * as F from './fichiers.js';
import { ouvrirHistorique, ETATS, sha256, octetsDe, RETENTION_DEFAUT } from './versions.js';

export function creerDocument(cfg) {
  const {
    app, nomApp, lettre, barreTitre,
    formatsOuverture = [], formatsEnregistrement = [], exports = [], modeles = [],
    nouveau, charger, informations, optionsApp, apresChargement, intercepter,
    historique: cfgHistorique, verifierOctets, avantEnregistrement
  } = cfg;
  // Historique des versions (points de restauration) : actif seulement dans l'application installée
  const H = cfgHistorique && F.NATIF ? ouvrirHistorique(cfgHistorique.espace || app, { verifierContenu: verifierOctets }) : null;
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
    ${cfgHistorique ? `<button class="btn-t" data-a="historique" title="Historique des versions" aria-label="Historique des versions">${ico('history', 'p')}</button>` : ''}
    <button class="nom-doc" title="Renommer le document">Sans titre</button><span class="etat-doc"></span>
    <span class="espace"></span>
    <label class="recherche-cmd" title="Rechercher une commande (Alt+Q)">${ico('search', 'p')}<input type="search" placeholder="Rechercher une commande" aria-label="Rechercher une commande"></label>
    <span class="espace"></span><span style="opacity:.85;font-size:12px">${esc(nomApp)}</span>`;
  const nomEl = $('.nom-doc', barreTitre), etatEl = $('.etat-doc', barreTitre);
  $('[data-a="enregistrer"]', barreTitre).onclick = () => doc.enregistrer();
  $('[data-a="annuler"]', barreTitre).onclick = () => cfg.annuler && cfg.annuler();
  $('[data-a="retablir"]', barreTitre).onclick = () => cfg.retablir && cfg.retablir();
  if (cfgHistorique) $('[data-a="historique"]', barreTitre).onclick = () => doc.ouvrirCoulisses('historique');
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
      const octets = await octetsDe(await fmt.ecrire());
      if (!octets.length) throw new Error('le fichier produit est vide : rien n\'a été écrit');
      // 1. contrôler le fichier produit AVANT de toucher au disque
      if (verifierOctets) {
        const v = await verifierOctets(octets, fmt.ext);
        if (!v.ok) throw new Error(`le fichier produit ne se relit pas (${v.detail || 'contenu invalide'}) : rien n'a été écrit, le fichier existant est intact`);
      }
      if (avantEnregistrement && (await avantEnregistrement({ fmt, chemin, octets, doc })) === false) return false;
      const r = await ecrireSur(chemin, octets, { nomSuggere: nomSansExtension(doc.nom), filtres: [{ nom: fmt.nom, ext: [fmt.ext] }], raisonAvant: 'Avant enregistrement', raisonApres: 'Enregistrement' });
      if (!r) return false;
      doc.chemin = r.chemin; doc.nom = r.nom; doc.format = fmt.ext; doc.modifie = false; majTitre();
      if (r.chemin) F.ajouterRecent(app, r.chemin, r.nom);
      effacerRecuperation();
      toast(`Enregistré : ${r.nom}${r.verifie ? ' (relu et vérifié)' : ''}`, 'succes');
      fermerCoulisses();
      return true;
    } catch (e) {
      console.error(e);
      toast(`Échec de l'enregistrement : ${e.message || e}`, 'erreur', H ? { duree: 12000, action: { label: 'Historique', faire: () => doc.ouvrirCoulisses('historique') } } : {});
      return false;
    }
  }

  /**
   * Écriture sûre d'un fichier :
   *  1. point de restauration de la version présente sur le disque (si elle existe) ;
   *  2. écriture atomique par le moteur local (fichier temporaire puis remplacement) ;
   *  3. relecture et comparaison SHA-256 ;
   *  4. copie de la nouvelle version dans l'historique.
   * En cas d'échec, la version précédente reste sur le disque (écriture atomique) et dans l'historique.
   */
  async function ecrireSur(chemin, octets, { nomSuggere, filtres, raisonAvant, raisonApres, origine = app } = {}) {
    if (!F.NATIF) return F.enregistrerFichier({ octets, chemin, nomSuggere, filtres });
    if (!chemin) {
      const c = await F.appelApi('/api/fichier/choisir-enregistrement', { nomSuggere, filtres, titre: 'Enregistrer sous' });
      if (!c || c.annule) return null;
      chemin = c.chemin;
      const ext = filtres?.[0]?.ext?.[0];
      if (ext && ext !== '*' && extension(chemin) !== ext) chemin += '.' + ext;
    }
    const nom = chemin.split(/[\\/]/).pop();
    if (H && await F.fichierExiste(chemin)) {
      let actuel = null;
      try { actuel = await F.lireChemin(chemin); } catch (e) {
        const r = await dialogue({ titre: 'Fichier actuel illisible', contenu: `<p>Le fichier « ${esc(nom)} » existe mais ne peut pas être lu (${esc(e.message)}). Il est peut-être ouvert dans une autre application.</p><p>Aucun point de restauration ne peut donc être créé avant de le remplacer.</p>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Remplacer quand même', valeur: true, danger: true }] });
        if (!r) return null;
      }
      if (actuel) {
        try { await H.capturer({ octets: actuel, chemin, nom, raison: raisonAvant || 'Avant remplacement', origine }); }
        catch (e) {
          const r = await dialogue({ titre: 'Point de restauration impossible', contenu: `<p>La version actuelle de « ${esc(nom)} » n'a pas pu être copiée dans l'historique : ${esc(e.message)}.</p><p>Si vous continuez, elle sera remplacée sans copie de secours.</p>`, boutons: [{ label: 'Annuler', valeur: null }, { label: 'Remplacer sans copie', valeur: true, danger: true }] });
          if (!r) return null;
        }
      }
    }
    await F.enregistrerFichier({ octets, chemin });
    // relecture : le fichier sur le disque doit être identique octet pour octet
    let relu = null; try { relu = await F.lireChemin(chemin); } catch { }
    const attendu = await sha256(octets);
    if (!relu || relu.length !== octets.length || await sha256(relu) !== attendu) {
      throw new Error(`le fichier « ${nom} » relu sur le disque ne correspond pas à ce qui a été enregistré${H ? ' ; la version précédente est conservée dans l\'historique' : ''}`);
    }
    if (H) { try { await H.capturer({ octets, chemin, nom, raison: raisonApres || 'Enregistrement', origine }); } catch (e) { toast(`Enregistré, mais la copie dans l'historique a échoué : ${e.message}`, 'alerte'); } }
    return { chemin, nom, verifie: true };
  }
  doc.ecrireSur = ecrireSur;
  doc.historique = H;
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
        ${cfgHistorique ? `<button data-s="historique">${ico('history')}<span>Historique des versions</span></button>` : ''}
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
      if (s === 'historique') return rendreHistorique(panneau);
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
  // ----- Historique des versions -----
  const dateLongue = d => new Date(d).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const ORIGINES = { calcul: 'Calcul', depannage: 'Dépannage', texte: 'Texte', pdf: 'PDF' };
  const pastille = e => {
    const et = ETATS[e.etat] || { label: e.etat, sain: false };
    const cls = et.sain ? 'ok' : (e.etat === 'verifiee-non-lisible' ? 'attention' : 'ko');
    return `<span class="pastille-etat ${cls}" title="${esc(et.detail || '')}">${ico(et.sain ? 'circle-check' : cls === 'attention' ? 'triangle-alert' : 'circle-x', 'p')}${esc(et.label)}</span>`;
  };
  async function rendreHistorique(panneau) {
    if (!H) {
      panneau.innerHTML = `<h1>Historique des versions</h1><p class="texte-aide">L'historique des versions n'est disponible que dans l'application installée sur le poste (il s'appuie sur le dossier de données de Suite Acad’).</p>`;
      return;
    }
    panneau.innerHTML = `<h1>Historique des versions</h1>
      <div class="hist-entete">
        <div class="hist-filtre" role="radiogroup" aria-label="Classeurs affichés">
          <label><input type="radio" name="portee" value="doc" ${doc.chemin ? 'checked' : 'disabled'}> Ce document${doc.chemin ? '' : ' (pas encore enregistré)'}</label>
          <label><input type="radio" name="portee" value="tout" ${doc.chemin ? '' : 'checked'}> Tous les documents</label>
        </div>
        <label class="champ-ligne">Conserver les versions
          <select name="retention">${[7, 14, 30, 60, 90, 180, 365].map(j => `<option value="${j}">${j} jours${j === RETENTION_DEFAUT ? ' (par défaut)' : ''}</option>`).join('')}</select></label>
      </div>
      <p class="texte-aide">Sélectionnez une version puis cliquez sur <b>Restaurer…</b> et confirmez. Avant tout remplacement, la version actuelle est elle-même copiée dans l'historique.</p>
      <div class="hist-liste" aria-live="polite"><p class="texte-aide">Chargement…</p></div>
      <details class="hist-limites"><summary>${ico('info', 'p')} Ce que l'historique protège… et ses limites</summary>
        <ul>
          <li>Une copie est créée à chaque enregistrement fait dans ${esc(nomApp)}, avant chaque remplacement d'un fichier existant, avant chaque restauration et avant les réparations ou conversions lancées depuis Dépannage.</li>
          <li>Chaque copie est relue et comparée à l'original (empreinte SHA-256) avant d'être déclarée « Vérifiée ». Le fichier enregistré est lui aussi relu après écriture ; l'écriture se fait dans un fichier temporaire remplacé d'un seul coup, si bien qu'une coupure laisse l'ancienne version intacte.</li>
          <li>Les modifications faites par d'autres logiciels (Excel, LibreOffice…) entre deux enregistrements dans ${esc(nomApp)} ne sont pas capturées.</li>
          <li>Les suppressions, déplacements et renommages faits dans l'Explorateur Windows ne sont pas suivis : les copies restent rattachées à l'ancien emplacement. « Remplacer » recrée le fichier à cet emplacement ; « Restaurer sous un nouveau nom… » permet de le recréer ailleurs.</li>
          <li>Les copies sont stockées sur ce poste, dans le dossier de données de Suite Acad’ de votre session Windows : elles ne protègent pas contre la perte ou la réinstallation du poste.</li>
          <li>Les copies plus anciennes que la durée choisie sont supprimées automatiquement, mais <b>jamais la dernière copie saine</b> d'un document.</li>
        </ul></details>`;
    const zl = $('.hist-liste', panneau), selR = $('[name="retention"]', panneau);
    selR.value = String(await H.retention().catch(() => RETENTION_DEFAUT));
    if (!selR.value) selR.value = String(RETENTION_DEFAUT);
    selR.onchange = async () => {
      try { const r = await H.definirRetention(+selR.value); toast(`Versions conservées ${selR.value} jours${r.supprimees ? ` — ${r.supprimees} copie(s) ancienne(s) supprimée(s)` : ''}.`, 'succes'); remplir(); }
      catch (e) { toast('Réglage non enregistré : ' + e.message, 'erreur'); }
    };
    $$('[name="portee"]', panneau).forEach(r => r.onchange = remplir);
    async function remplir() {
      const portee = $('[name="portee"]:checked', panneau)?.value || 'tout';
      let l;
      try { l = await H.lister(portee === 'doc' ? { chemin: doc.chemin } : {}); }
      catch (e) { zl.innerHTML = `<p class="texte-aide">Historique illisible : ${esc(e.message)}</p>`; return; }
      if (!l.length) { zl.innerHTML = `<div class="vide">${portee === 'doc' ? 'Aucune version de ce document pour l\'instant. Une copie sera créée au prochain enregistrement.' : 'Aucune version enregistrée pour l\'instant.'}</div>`; return; }
      zl.innerHTML = `<table class="tab-hist"><thead><tr><th>Date</th><th>Document</th><th>Format</th><th>Taille</th><th>Origine</th><th>État</th><th></th></tr></thead><tbody></tbody></table>`;
      const tb = $('tbody', zl);
      l.forEach(e => {
        const tr = el(`<tr tabindex="0" data-id="${esc(e.id)}">
          <td class="nowrap">${esc(dateLongue(e.date))}</td>
          <td class="doc-cell"><b>${esc(e.nom)}</b><small title="${esc(e.chemin || '')}">${esc(e.chemin || 'Non enregistré')}</small></td>
          <td>${esc(e.format ? '.' + e.format : '—')}</td>
          <td class="nowrap">${esc(formatOctets(e.taille))}</td>
          <td>${esc(e.raison)}<small>${esc(ORIGINES[e.origine] || e.origine || '')}</small></td>
          <td>${pastille(e)}${e.derniereSaine ? '<small class="derniere">Dernière copie saine</small>' : ''}${e.expiree && e.derniereSaine ? '<small>Conservée au-delà de la durée choisie</small>' : ''}</td>
          <td class="nowrap"><button class="btn primaire petit" data-r ${ETATS[e.etat]?.sain || e.etat === 'verifiee-non-lisible' ? '' : 'disabled'}>${ico('archive-restore', 'p')}Restaurer…</button>
            <button class="btn discret icone petit" data-plus aria-label="Autres actions">${ico('ellipsis', 'p')}</button></td></tr>`);
        $('[data-r]', tr).onclick = () => restaurerVersion(e).then(ok => ok ? fermerCoulisses() : remplir());
        $('[data-plus]', tr).onclick = ev => menu([
          { label: 'Restaurer sous un nouveau nom…', ico: 'save-all', faire: () => restaurerVersion(e, 'nouveau').then(ok => ok ? fermerCoulisses() : remplir()) },
          { label: 'Ouvrir une copie sans remplacer', ico: 'folder-open', faire: () => ouvrirCopie(e) },
          ...(e.chemin ? [{ label: 'Afficher le dossier d\'origine', ico: 'folder', faire: () => F.afficherDansExplorateur(e.chemin) }] : []),
          '-',
          { label: 'Supprimer cette copie', ico: 'trash-2', desactive: e.derniereSaine, faire: async () => { if (!(await confirmer('Supprimer la copie', `Supprimer définitivement la copie du ${dateLongue(e.date)} ?`, 'Supprimer', true))) return; try { await H.supprimer(e); remplir(); } catch (x) { toast(x.message, 'erreur'); } } },
        ], 0, 0, ev.currentTarget);
        tr.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target === tr) $('[data-r]', tr).click(); });
        tb.appendChild(tr);
      });
    }
    await remplir();
  }

  /** Ouvre une ancienne version dans l'application, sans toucher au fichier d'origine. */
  async function ouvrirCopie(e) {
    try {
      const octets = await H.lireCopie(e);
      if (!(await doc.verifierAbandon())) return;
      const nom = `${nomSansExtension(e.nom)} (version du ${new Date(e.date).toLocaleDateString('fr-FR')}).${e.format}`;
      const ok = await chargerFichier({ nom, chemin: null, octets }, { ignorerAbandon: true });
      if (ok) { doc.chemin = null; doc.nom = nomSansExtension(nom) + '.' + doc.format; doc.modifie = true; majTitre(); toast('Copie ouverte : enregistrez-la sous un nouveau nom pour la conserver.', 'info'); }
    } catch (x) { toast('Ouverture impossible : ' + x.message, 'erreur'); }
  }

  /**
   * Restaure une version : mode « remplacer » (emplacement d'origine) ou « nouveau » (nouveau nom).
   * La version actuelle (fichier sur le disque et modifications non enregistrées) est copiée avant.
   */
  async function restaurerVersion(e, mode) {
    let octets;
    try { octets = await H.lireCopie(e); } catch (x) { toast('Restauration impossible : ' + x.message, 'erreur'); return false; }
    if (verifierOctets) {
      const v = await verifierOctets(octets, e.format);
      if (!v.ok && !(await confirmer('Version illisible', `Cette copie est exacte mais son contenu ne se relit pas correctement (${v.detail || 'contenu invalide'}). La restaurer quand même ?`, 'Restaurer quand même', true))) return false;
    }
    if (!mode) {
      const existe = e.chemin ? await F.fichierExiste(e.chemin) : false;
      const r = await dialogue({
        titre: 'Restaurer cette version ?',
        contenu: `<p><b>${esc(e.nom)}</b> — version du ${esc(dateLongue(e.date))} (${esc(formatOctets(e.taille))}, ${esc(e.raison.toLowerCase())}).</p>
          ${e.chemin ? `<p>${existe ? 'Le fichier actuel' : 'Le fichier, aujourd\'hui absent de son emplacement,'} <code>${esc(e.chemin)}</code> ${existe ? 'sera remplacé par cette version. <b>Il est d\'abord copié dans l\'historique</b> : vous pourrez revenir en arrière.' : 'sera recréé à cet emplacement.'}</p>` : '<p>Ce document n\'avait pas d\'emplacement : choisissez où l\'enregistrer.</p>'}
          ${doc.modifie ? '<p>Les modifications non enregistrées du document ouvert seront elles aussi copiées dans l\'historique.</p>' : ''}`,
        boutons: [{ label: 'Annuler', valeur: null }, { label: 'Restaurer sous un nouveau nom…', valeur: 'nouveau', id: 'nouveau' }, ...(e.chemin ? [{ label: existe ? 'Remplacer le fichier actuel' : 'Recréer le fichier', valeur: 'remplacer', primaire: true, id: 'remplacer' }] : [])]
      });
      if (!r) return false;
      mode = r.valeur;
    }
    // copie de sécurité des modifications non enregistrées du document ouvert
    if (doc.modifie && formatEnr(doc.format)) {
      try { await H.capturer({ octets: await octetsDe(await formatEnr(doc.format).ecrire()), chemin: doc.chemin, nom: doc.nom, raison: 'Modifications non enregistrées (avant restauration)', origine: app }); }
      catch (x) { if (!(await confirmer('Copie impossible', `Les modifications non enregistrées n'ont pas pu être copiées (${x.message}). Elles seront perdues. Continuer ?`, 'Continuer', true))) return false; }
    }
    try {
      const filtres = [{ nom: 'Fichier .' + e.format, ext: [e.format] }];
      const nomSuggere = `${nomSansExtension(e.nom)} (restauré le ${new Date().toLocaleDateString('fr-FR').replace(/\//g, '-')})`;
      const r = await ecrireSur(mode === 'remplacer' ? e.chemin : null, octets, { nomSuggere, filtres, raisonAvant: 'Avant restauration', raisonApres: 'Version restaurée' });
      if (!r) return false;
      doc.modifie = false;
      const ok = await chargerFichier({ nom: r.nom, chemin: r.chemin, octets }, { ignorerAbandon: true });
      toast(`Version du ${new Date(e.date).toLocaleString('fr-FR')} restaurée dans « ${r.nom} » (relue et vérifiée).${mode === 'remplacer' ? ' La version remplacée est conservée dans l\'historique.' : ''}`, 'succes', { duree: 8000 });
      return ok !== false;
    } catch (x) { console.error(x); toast('Restauration impossible : ' + (x.message || x) + ' — le fichier actuel n\'a pas été modifié.', 'erreur', { duree: 12000 }); return false; }
  }
  doc.restaurerVersion = restaurerVersion;

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
    // contrôle des copies interrompues par un arrêt inattendu, puis purge selon la durée de conservation
    if (H && !(ses && ses.diagnostic)) setTimeout(() => H.reparer().then(() => H.purger()).catch(e => console.warn('historique', e)), 1500);
    if (ses && ses.diagnostic) { setTimeout(() => import('./diagnostic.js').then(d => d.lancer(doc, cfg)), 600); return; }
    if (ses && ses.fichier) { await doc.ouvrirChemin(ses.fichier, true); return; }
    if (await proposerRecuperation()) return;
    if (cfg.coulissesAuDemarrage !== false && !(ses && ses.test)) doc.ouvrirCoulisses('accueil');
  };
  doc.formatOctets = formatOctets;
  return doc;
}
