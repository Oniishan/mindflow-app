// Texte — modèles de documents
const auj = () => new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const apercu = (lignes) => `<svg viewBox="0 0 100 130" width="80" height="104" aria-hidden="true"><rect x="0.5" y="0.5" width="99" height="129" fill="#fff" stroke="#c9d0dc"/>${lignes}</svg>`;
const l = (x, y, w, h = 3, c = '#c3cad6') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${c}"/>`;

export const MODELES = [
  { id: 'vierge', nom: 'Document vierge', apercu: apercu(''), html: () => '<p><br></p>' },
  {
    id: 'courrier', nom: 'Courrier', nomDoc: 'Courrier',
    apercu: apercu(l(10, 10, 30, 4, '#2456B0') + l(10, 17, 25) + l(10, 22, 22) + l(60, 36, 30) + l(60, 41, 26) + l(60, 46, 28) + l(10, 58, 40, 3, '#7a869c') + [66, 71, 76, 81, 86, 91].map(y => l(10, y, 80)).join('') + l(60, 106, 28)),
    html: () => `<p><b>Nom du service</b><br>Adresse du service<br>Code postal Ville<br>Téléphone · courriel</p>
<p style="margin-left:340px">Prénom NOM<br>Fonction<br>Adresse<br>Code postal Ville</p>
<p style="text-align:right">Ville, le ${auj()}</p>
<p><b>Objet :</b> objet du courrier<br><b>Réf. :</b> référence du dossier<br><b>P. J. :</b> pièces jointes</p>
<p>Madame, Monsieur,</p>
<p style="text-align:justify">Rédigez ici le corps de votre courrier. Exposez d'abord le contexte, puis la demande ou l'information principale, et terminez par la suite à donner.</p>
<p style="text-align:justify">Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.</p>
<p style="margin-left:340px">Prénom NOM<br>Fonction</p>`
  },
  {
    id: 'compte-rendu', nom: 'Compte rendu de réunion', nomDoc: 'Compte rendu',
    apercu: apercu(l(10, 10, 60, 6, '#2456B0') + l(10, 22, 40) + l(10, 32, 30, 4, '#1F3864') + [39, 44, 49].map(y => l(14, y, 70)).join('') + l(10, 58, 30, 4, '#1F3864') + `<rect x="10" y="66" width="80" height="30" fill="none" stroke="#c3cad6"/>` + l(10, 66, 80, 7, '#dfe5ef') + l(10, 104, 30, 4, '#1F3864') + l(14, 111, 60)),
    html: () => `<p class="st-titre">Compte rendu de réunion</p>
<p class="st-sous-titre">Objet de la réunion</p>
<table class="tab"><tbody><tr><th style="background-color:#E7ECF5;width:30%">Date</th><td>${auj()}</td></tr><tr><th style="background-color:#E7ECF5">Lieu</th><td>Salle, site</td></tr><tr><th style="background-color:#E7ECF5">Rédacteur</th><td>Prénom NOM</td></tr><tr><th style="background-color:#E7ECF5">Participants</th><td>Prénom NOM (service), Prénom NOM (service)</td></tr><tr><th style="background-color:#E7ECF5">Excusés</th><td>—</td></tr></tbody></table>
<h1>Ordre du jour</h1><ol><li>Point 1</li><li>Point 2</li><li>Questions diverses</li></ol>
<h1>Échanges</h1><h2>1. Point 1</h2><p>Résumé des échanges.</p><h2>2. Point 2</h2><p>Résumé des échanges.</p>
<h1>Décisions et actions</h1>
<table class="tab"><thead><tr><th style="background-color:#E7ECF5">Action</th><th style="background-color:#E7ECF5">Responsable</th><th style="background-color:#E7ECF5">Échéance</th><th style="background-color:#E7ECF5">État</th></tr></thead><tbody><tr><td>Action à mener</td><td>Prénom NOM</td><td>jj/mm/aaaa</td><td>À faire</td></tr><tr><td><br></td><td><br></td><td><br></td><td><br></td></tr></tbody></table>
<p><b>Prochaine réunion :</b> date et lieu.</p>`
  },
  {
    id: 'note', nom: 'Note de service', nomDoc: 'Note de service',
    apercu: apercu(l(30, 12, 40, 6, '#2456B0') + l(10, 26, 35) + l(10, 31, 30) + l(10, 36, 32) + `<line x1="10" y1="44" x2="90" y2="44" stroke="#c3cad6"/>` + [52, 57, 62, 67, 72, 80, 85, 90].map(y => l(10, y, 80)).join('') + l(60, 108, 28)),
    html: () => `<p class="st-titre" style="text-align:center">Note de service</p>
<p><b>De :</b> Prénom NOM, fonction<br><b>À :</b> destinataires<br><b>Date :</b> ${auj()}<br><b>Objet :</b> objet de la note</p>
<hr>
<p style="text-align:justify">Présentez en quelques lignes le contexte de la note.</p>
<h2>Dispositions</h2><ul><li>Première disposition</li><li>Deuxième disposition</li></ul>
<h2>Calendrier</h2><p>Dates à retenir.</p>
<p style="margin-left:340px">Prénom NOM<br>Fonction</p>`
  },
  {
    id: 'rapport', nom: 'Rapport', nomDoc: 'Rapport',
    apercu: apercu(l(10, 30, 70, 8, '#2456B0') + l(10, 44, 50, 4) + l(10, 70, 30, 3, '#7a869c') + l(10, 76, 40) + l(10, 81, 36) + l(10, 86, 38)),
    html: () => `<p class="st-titre">Titre du rapport</p><p class="st-sous-titre">Sous-titre ou périmètre</p><p>Version 1.0 — ${auj()}</p>
<div class="sommaire" contenteditable="false"><p class="titre-sommaire">Sommaire</p></div>
<hr class="saut-page" contenteditable="false">
<h1>Introduction</h1><p style="text-align:justify">Contexte, objectifs et méthode.</p>
<h1>Constats</h1><h2>Premier constat</h2><p style="text-align:justify">Description.</p><h2>Second constat</h2><p style="text-align:justify">Description.</p>
<h1>Recommandations</h1><ol><li>Première recommandation</li><li>Deuxième recommandation</li></ol>
<h1>Conclusion</h1><p style="text-align:justify">Synthèse.</p>`,
    reglages: { pied: { gauche: '{titre}', centre: '', droite: 'Page {page} sur {pages}' } }
  },
  {
    id: 'attestation', nom: 'Attestation', nomDoc: 'Attestation',
    apercu: apercu(l(10, 10, 30, 4, '#2456B0') + l(10, 16, 24) + l(28, 36, 44, 6, '#1F3864') + [52, 57, 62, 67, 72].map(y => l(10, y, 80)).join('') + l(60, 92, 28) + l(60, 98, 22)),
    html: () => `<p><b>Nom du service</b><br>Adresse du service</p>
<p class="st-titre" style="text-align:center;margin-top:40px">Attestation</p>
<p style="text-align:justify">Je soussigné(e), Prénom NOM, fonction, atteste que Madame / Monsieur Prénom NOM, né(e) le jj/mm/aaaa, exerce les fonctions de … au sein de … depuis le jj/mm/aaaa.</p>
<p style="text-align:justify">La présente attestation est délivrée à l'intéressé(e) pour servir et valoir ce que de droit.</p>
<p style="margin-left:340px;margin-top:30px">Fait à Ville, le ${auj()}<br><br>Prénom NOM<br>Fonction</p>`
  },
];
