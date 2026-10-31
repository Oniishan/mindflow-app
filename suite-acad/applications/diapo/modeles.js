// Diapo — modèles de présentations
let n = 0; const id = p => p + (++n) + Math.random().toString(36).slice(2, 6);
const z = (role, x, y, l, h, html, style = {}) => ({ id: id('e'), type: 'texte', role, x, y, l, h, html, style });
const apercu = (fond, titre, accent, bande = true) => `<svg viewBox="0 0 160 90" width="140" height="79" aria-hidden="true"><rect width="160" height="90" fill="${fond}"/>${bande ? `<rect y="86" width="160" height="4" fill="${accent}"/>` : ''}<rect x="20" y="34" width="120" height="9" rx="2" fill="${titre}"/><rect x="45" y="50" width="70" height="5" rx="2" fill="${accent}" opacity=".7"/></svg>`;
const auj = () => new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const titre = (t, s, disp = 'titre') => ({ id: id('d'), disposition: disp, elements: [z('titre', 120, 230, 1040, 140, `<p>${t}</p>`, { taille: 54, align: 'center', valign: 'bottom' }), z('sous-titre', 120, 390, 1040, 90, `<p>${s}</p>`, { taille: 26, align: 'center', valign: 'top' })], notes: '', transition: 'fondu' });
const contenu = (t, items, notes = '') => ({ id: id('d'), disposition: 'titre-contenu', elements: [z('titre', 70, 40, 1140, 110, `<p>${t}</p>`, { taille: 40, valign: 'middle' }), z('corps', 70, 170, 1140, 480, `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`, { taille: 26 })], notes, transition: 'fondu' });
const section = (t, s) => ({ id: id('d'), disposition: 'section', elements: [z('titre', 90, 250, 1100, 130, `<p>${t}</p>`, { taille: 50, valign: 'bottom' }), z('sous-titre', 90, 390, 1100, 70, `<p>${s}</p>`, { taille: 24 })], notes: '', transition: 'fondu' });

export const MODELES = [
  { id: 'vierge', nom: 'Présentation vierge', apercu: apercu('#fff', '#d5d9e0', '#2456B0'), creer: () => ({ format: '16:9', theme: 'atelier', diapos: [{ id: id('d'), disposition: 'titre', elements: [z('titre', 120, 230, 1040, 140, '', { taille: 54, align: 'center', valign: 'bottom' }), z('sous-titre', 120, 390, 1040, 90, '', { taille: 26, align: 'center', valign: 'top' })], notes: '' }] }) },
  {
    id: 'reunion', nom: 'Réunion de service', nomDoc: 'Réunion de service', apercu: apercu('#fff', '#000091', '#E1000F', false),
    creer: () => ({ format: '16:9', theme: 'institution', diapos: [
      titre('Réunion de service', auj()),
      contenu('Ordre du jour', ['Informations générales', 'Point sur les dossiers en cours', 'Calendrier des prochaines échéances', 'Questions diverses']),
      section('1. Informations générales', 'Actualités du service'),
      contenu('Dossiers en cours', ['Dossier A : avancement et prochaines étapes', 'Dossier B : points de vigilance', 'Dossier C : décisions attendues'], 'Rappeler les responsables de chaque dossier.'),
      { id: id('d'), disposition: 'titre-contenu', elements: [z('titre', 70, 40, 1140, 110, '<p>Calendrier</p>', { taille: 40, valign: 'middle' }), { id: id('e'), type: 'tableau', x: 70, y: 180, l: 1140, h: 260, cellules: [['Échéance', 'Action', 'Responsable'], ['Semaine 1', 'Lancement', 'Équipe'], ['Semaine 3', 'Point d\'étape', 'Chef de service'], ['Semaine 6', 'Bilan', 'Équipe']], taille: 20, entete: true, style: {} }], notes: '', transition: 'fondu' },
      contenu('Questions diverses', ['Tour de table', 'Prochaine réunion : date et lieu']),
    ] })
  },
  {
    id: 'bilan', nom: 'Bilan de projet', nomDoc: 'Bilan de projet', apercu: apercu('#1E2533', '#ffffff', '#5AA9E6', false),
    creer: () => ({ format: '16:9', theme: 'ardoise', diapos: [
      titre('Bilan du projet', 'Comité de pilotage — ' + auj()),
      contenu('Objectifs initiaux', ['Objectif 1 : description mesurable', 'Objectif 2 : description mesurable', 'Objectif 3 : description mesurable']),
      { id: id('d'), disposition: 'deux-colonnes', elements: [z('titre', 70, 40, 1140, 110, '<p>Réalisations et écarts</p>', { taille: 40, valign: 'middle' }), z('corps', 70, 170, 555, 480, '<p><b>Réalisé</b></p><ul><li>Livrable 1</li><li>Livrable 2</li></ul>', { taille: 24 }), z('corps', 655, 170, 555, 480, '<p><b>Écarts</b></p><ul><li>Retard sur le lot 3</li><li>Budget : +4 %</li></ul>', { taille: 24 })], notes: '', transition: 'fondu' },
      { id: id('d'), disposition: 'titre-seul', elements: [z('titre', 70, 40, 1140, 110, '<p>Indicateurs</p>', { taille: 40, valign: 'middle' }), ...[['92 %', 'des livrables'], ['18', 'agents formés'], ['3', 'sites équipés']].map(([a, b], i) => ({ id: id('e'), type: 'forme', forme: 'rect-arrondi', x: 70 + i * 390, y: 230, l: 360, h: 260, remplissage: ['#5AA9E6', '#F4B860', '#7FC8A9'][i], contour: 'transparent', html: `<p><span style="font-size:72px;font-weight:bold">${a}</span></p><p>${b}</p>`, style: { align: 'center', valign: 'middle', couleur: '#1E2533', taille: 26 } }))], notes: '', transition: 'zoom' },
      contenu('Suites à donner', ['Décision 1', 'Décision 2', 'Calendrier de la phase suivante']),
    ] })
  },
  {
    id: 'formation', nom: 'Support de formation', nomDoc: 'Formation', apercu: apercu('#20372C', '#F5F3E7', '#F6D365', false),
    creer: () => ({ format: '16:9', theme: 'craie', diapos: [
      titre('Titre de la formation', 'Animée par Prénom NOM'),
      contenu('Objectifs de la séance', ['À la fin de la séance, vous saurez…', '… réaliser telle tâche', '… utiliser tel outil']),
      section('Partie 1', 'Les notions essentielles'),
      contenu('À retenir', ['Notion clé 1', 'Notion clé 2', 'Notion clé 3']),
      contenu('Exercice pratique', ['Consigne', 'Durée : 15 minutes', 'Mise en commun']),
      titre('Merci de votre attention', 'Questions ?'),
    ] })
  },
  {
    id: 'institution', nom: 'Présentation institutionnelle', nomDoc: 'Présentation', apercu: apercu('#fff', '#5B2A86', '#E4572E', false),
    creer: () => ({ format: '16:9', theme: 'aurore', diapos: [
      titre('Présentation du service', 'Missions, organisation et projets'),
      contenu('Nos missions', ['Accompagner les usagers', 'Assurer la continuité du service', 'Conduire les projets de modernisation']),
      { id: id('d'), disposition: 'titre-seul', elements: [z('titre', 70, 40, 1140, 110, '<p>Organisation</p>', { taille: 40, valign: 'middle' }), { id: id('e'), type: 'forme', forme: 'rect-arrondi', x: 490, y: 180, l: 300, h: 90, remplissage: '#5B2A86', contour: 'transparent', html: '<p>Direction</p>', style: { align: 'center', valign: 'middle', couleur: '#FFFFFF', taille: 24 } }, ...['Pôle A', 'Pôle B', 'Pôle C'].map((t, i) => ({ id: id('e'), type: 'forme', forme: 'rect-arrondi', x: 150 + i * 340, y: 400, l: 300, h: 90, remplissage: '#F3E9FA', contour: '#5B2A86', epaisseur: 2, html: `<p>${t}</p>`, style: { align: 'center', valign: 'middle', couleur: '#5B2A86', taille: 22 } })), ...[[639, 270, 2, 65], [300, 334, 682, 2], [299, 335, 2, 65], [639, 335, 2, 65], [979, 335, 2, 65]].map(([x, y, l, h]) => ({ id: id('e'), type: 'forme', forme: 'rect', x, y, l, h, remplissage: '#5B2A86', contour: 'transparent', html: '' }))], notes: '', transition: 'fondu' },
      contenu('Projets en cours', ['Projet 1', 'Projet 2', 'Projet 3']),
      titre('Contact', 'service@ac-exemple.fr'),
    ] })
  },
];
