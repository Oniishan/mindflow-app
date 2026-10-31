// Calcul — modèles de classeurs
import { nouveauClasseur, nouvelleFeuille, cle } from './modele.js';
import { serieDate } from './formules.js';

const apercu = (contenu) => `<svg viewBox="0 0 120 90" width="110" height="82" aria-hidden="true"><rect x=".5" y=".5" width="119" height="89" fill="#fff" stroke="#c9d0dc"/>${[...Array(8)].map((_, i) => `<line x1="0" y1="${10 + i * 10}" x2="120" y2="${10 + i * 10}" stroke="#eef0f3"/>`).join('')}${[...Array(5)].map((_, i) => `<line x1="${24 * (i + 1)}" y1="0" x2="${24 * (i + 1)}" y2="90" stroke="#eef0f3"/>`).join('')}${contenu}</svg>`;
const ent = { gras: true, fond: '#1E7444', couleur: '#FFFFFF', alignH: 'centre', alignV: 'milieu' };
const bord = { h: { style: 'thin', couleur: '#A6A6A6' }, b: { style: 'thin', couleur: '#A6A6A6' }, g: { style: 'thin', couleur: '#A6A6A6' }, d: { style: 'thin', couleur: '#A6A6A6' } };
function remplir(f, r0, c0, lignes, styles = {}) {
  lignes.forEach((l, i) => l.forEach((v, j) => {
    if (v === undefined) return;
    const o = {};
    if (typeof v === 'string' && v.startsWith('=')) o.f = v; else if (v !== null) o.v = v;
    const s = typeof styles === 'function' ? styles(i, j, v) : styles;
    if (s && Object.keys(s).length) o.s = { ...s };
    f.cellules.set(cle(r0 + i, c0 + j), o);
  }));
}

export const MODELES = [
  { id: 'vierge', nom: 'Classeur vierge', apercu: apercu(''), creer: () => nouveauClasseur() },
  {
    id: 'budget', nom: 'Budget de service', nomDoc: 'Budget',
    apercu: apercu('<rect x="0" y="0" width="120" height="10" fill="#1E7444"/><rect x="72" y="20" width="22" height="40" fill="#cfe6d8"/><rect x="0" y="70" width="120" height="10" fill="#e2f2e8"/>'),
    creer: () => {
      const c = nouveauClasseur(); const f = c.feuilles[0]; f.nom = 'Budget';
      remplir(f, 0, 0, [['Budget prévisionnel ' + new Date().getFullYear()]], { gras: true, taille: 16, couleur: '#1E7444' });
      remplir(f, 2, 0, [['Poste', 'Prévu', 'Engagé', 'Reste', 'Taux']], { ...ent, bordures: bord });
      const postes = [['Matériel informatique', 12000, 8450], ['Logiciels et licences', 4500, 3900], ['Formation', 3000, 1200], ['Déplacements', 2500, 1875], ['Fournitures', 1800, 950], ['Maintenance', 6000, 4100]];
      postes.forEach((p, i) => { const r = 3 + i, l = r + 1; remplir(f, r, 0, [[p[0], p[1], p[2], `=B${l}-C${l}`, `=SI(B${l}=0;0;C${l}/B${l})`]], (_, j) => ({ bordures: bord, ...(j >= 1 && j <= 3 ? { format: '#,##0.00 "€"' } : j === 4 ? { format: '0%' } : {}) })); });
      const t = 3 + postes.length, tl = t + 1;
      remplir(f, t, 0, [['Total', `=SOMME(B4:B${t})`, `=SOMME(C4:C${t})`, `=B${tl}-C${tl}`, `=SI(B${tl}=0;0;C${tl}/B${tl})`]], (_, j) => ({ gras: true, fond: '#E2F2E8', bordures: bord, ...(j >= 1 && j <= 3 ? { format: '#,##0.00 "€"' } : j === 4 ? { format: '0%' } : {}) }));
      f.largeurs = { 0: 210, 1: 110, 2: 110, 3: 110, 4: 70 };
      f.mfc.push({ r1: 3, c1: 4, r2: t - 1, c2: 4, type: 'barres', couleur: '#63BE7B' });
      f.mfc.push({ r1: 3, c1: 3, r2: t - 1, c2: 3, type: 'valeur', op: 'inf', v1: 0, style: { couleur: '#C00000', gras: true } });
      f.graphiques.push({ id: 'g1', type: 'colonnes', titre: 'Prévu et engagé par poste', plage: { r1: 2, c1: 0, r2: t - 1, c2: 2 }, legende: 'bas', x: 640, y: 20, l: 520, h: 300 });
      f.figer = { l: 3, c: 0 };
      return c;
    }
  },
  {
    id: 'inventaire', nom: 'Inventaire de matériel', nomDoc: 'Inventaire',
    apercu: apercu('<rect x="0" y="0" width="120" height="10" fill="#1E7444"/><rect x="96" y="20" width="24" height="10" fill="#c6efce"/><rect x="96" y="40" width="24" height="10" fill="#ffc7ce"/>'),
    creer: () => {
      const c = nouveauClasseur(); const f = c.feuilles[0]; f.nom = 'Inventaire';
      remplir(f, 0, 0, [['N° d\'inventaire', 'Type', 'Marque', 'Modèle', 'N° de série', 'Site', 'Affectation', 'Date d\'achat', 'Garantie (ans)', 'Fin de garantie', 'État']], { ...ent, retour: true, bordures: bord });
      const d = [['INV-0001', 'Portable', 'Dell', 'Latitude 5440', 'D5440-8821', 'Rectorat 38', 'Service RH', serieDate(2024, 3, 12), 3, 'En service'], ['INV-0002', 'Unité centrale', 'HP', 'ProDesk 400 G9', 'HP400-1173', 'DSDEN 73', 'Accueil', serieDate(2021, 9, 2), 3, 'En service'], ['INV-0003', 'Écran', 'Iiyama', 'ProLite 24"', 'IY24-5530', 'DSDEN 74', 'Stock', serieDate(2022, 1, 20), 5, 'En stock'], ['INV-0004', 'Imprimante', 'Brother', 'HL-L5100', 'BR51-0092', 'Rectorat 38', 'Bureau 214', serieDate(2019, 6, 15), 2, 'À réformer']];
      d.forEach((x, i) => { const l = i + 2; remplir(f, i + 1, 0, [[x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8], `=SI(H${l}="";"";MOIS.DECALER(H${l};I${l}*12))`, x[9]]], (_, j) => ({ bordures: bord, ...(j === 7 || j === 9 ? { format: 'dd/mm/yyyy' } : {}), ...(j === 8 ? { alignH: 'centre' } : {}) })); });
      f.largeurs = { 0: 110, 1: 110, 2: 90, 3: 130, 4: 110, 5: 100, 6: 110, 7: 95, 8: 75, 9: 105, 10: 100 };
      f.hauteurs = { 0: 36 };
      f.validations.push({ r1: 1, c1: 10, r2: 500, c2: 10, liste: ['En service', 'En stock', 'En réparation', 'À réformer', 'Réformé'] });
      f.validations.push({ r1: 1, c1: 5, r2: 500, c2: 5, liste: ['Rectorat 38', 'DSDEN 73', 'DSDEN 74'] });
      f.mfc.push({ r1: 1, c1: 10, r2: 500, c2: 10, type: 'valeur', op: 'egal', v1: 'À réformer', style: { fond: '#FFC7CE', couleur: '#9C0006' } });
      f.mfc.push({ r1: 1, c1: 10, r2: 500, c2: 10, type: 'valeur', op: 'egal', v1: 'En service', style: { fond: '#C6EFCE', couleur: '#006100' } });
      f.filtre = { r1: 0, c1: 0, r2: 4, c2: 10, criteres: {} };
      f.figer = { l: 1, c: 1 };
      return c;
    }
  },
  {
    id: 'suivi', nom: 'Suivi des demandes', nomDoc: 'Suivi des demandes',
    apercu: apercu('<rect x="0" y="0" width="120" height="10" fill="#1E7444"/><rect x="72" y="10" width="24" height="60" fill="#fff2cc"/>'),
    creer: () => {
      const c = nouveauClasseur(); const f = c.feuilles[0]; f.nom = 'Demandes';
      remplir(f, 0, 0, [['N°', 'Date', 'Demandeur', 'Objet', 'Priorité', 'Responsable', 'État', 'Échéance', 'Retard (j)']], { ...ent, bordures: bord });
      const aj = serieDate(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
      [['Réinitialisation de mot de passe', 'Haute', 'Terminée', -5], ['Installation d\'imprimante', 'Normale', 'En cours', -2], ['Accès au partage réseau', 'Haute', 'À faire', 3], ['Remplacement d\'écran', 'Basse', 'À faire', 10]].forEach((x, i) => {
        const l = i + 2;
        remplir(f, i + 1, 0, [[i + 1, aj - 7 + i, 'Prénom NOM', x[0], x[1], 'Technicien', x[2], aj + x[3], `=SI(G${l}="Terminée";0;MAX(0;AUJOURDHUI()-H${l}))`]], (_, j) => ({ bordures: bord, ...(j === 1 || j === 7 ? { format: 'dd/mm/yyyy' } : {}), ...(j === 0 || j === 8 ? { alignH: 'centre' } : {}) }));
      });
      remplir(f, 7, 2, [['Demandes ouvertes', '=NBVAL(D2:D100)-NB.SI(G2:G100;"Terminée")'], ['En retard', '=NB.SI(I2:I100;">0")']], { gras: true });
      f.largeurs = { 0: 45, 1: 90, 2: 110, 3: 230, 4: 80, 5: 110, 6: 90, 7: 90, 8: 80 };
      f.validations.push({ r1: 1, c1: 4, r2: 300, c2: 4, liste: ['Basse', 'Normale', 'Haute', 'Urgente'] });
      f.validations.push({ r1: 1, c1: 6, r2: 300, c2: 6, liste: ['À faire', 'En cours', 'En attente', 'Terminée'] });
      f.mfc.push({ r1: 1, c1: 8, r2: 300, c2: 8, type: 'valeur', op: 'sup', v1: 0, style: { fond: '#FFC7CE', couleur: '#9C0006', gras: true } });
      f.mfc.push({ r1: 1, c1: 6, r2: 300, c2: 6, type: 'valeur', op: 'egal', v1: 'Terminée', style: { couleur: '#006100' } });
      f.figer = { l: 1, c: 0 };
      return c;
    }
  },
  {
    id: 'frais', nom: 'Note de frais', nomDoc: 'Note de frais',
    apercu: apercu('<rect x="0" y="0" width="70" height="10" fill="#fff" stroke="#1E7444"/><rect x="0" y="20" width="120" height="10" fill="#1E7444"/><rect x="72" y="80" width="48" height="10" fill="#e2f2e8"/>'),
    creer: () => {
      const c = nouveauClasseur(); const f = c.feuilles[0]; f.nom = 'Note de frais';
      remplir(f, 0, 0, [['Note de frais'], ['Agent :', 'Prénom NOM'], ['Service :', 'Service'], ['Période :', 'mois année']], (i, j) => i === 0 ? { gras: true, taille: 16, couleur: '#1E7444' } : j === 0 ? { gras: true } : {});
      remplir(f, 5, 0, [['Date', 'Nature', 'Description', 'Kilomètres', 'Montant']], { ...ent, bordures: bord });
      for (let i = 0; i < 8; i++) remplir(f, 6 + i, 0, [[null, null, null, null, null]], (_, j) => ({ bordures: bord, ...(j === 0 ? { format: 'dd/mm/yyyy' } : j === 4 ? { format: '#,##0.00 "€"' } : {}) }));
      remplir(f, 6, 0, [[serieDate(new Date().getFullYear(), new Date().getMonth() + 1, 1), 'Transport', 'Réunion à Chambéry', 120, '=D7*0,32']], (_, j) => ({ bordures: bord, ...(j === 0 ? { format: 'dd/mm/yyyy' } : j === 4 ? { format: '#,##0.00 "€"' } : {}) }));
      remplir(f, 14, 3, [['Total', '=SOMME(E7:E14)']], (_, j) => ({ gras: true, fond: '#E2F2E8', bordures: bord, ...(j === 1 ? { format: '#,##0.00 "€"' } : {}) }));
      f.largeurs = { 0: 95, 1: 110, 2: 240, 3: 90, 4: 110 };
      f.validations.push({ r1: 6, c1: 1, r2: 13, c2: 1, liste: ['Transport', 'Repas', 'Hébergement', 'Autre'] });
      return c;
    }
  },
  {
    id: 'planning', nom: 'Planning mensuel', nomDoc: 'Planning',
    apercu: apercu('<rect x="0" y="0" width="120" height="10" fill="#1E7444"/><rect x="24" y="20" width="24" height="10" fill="#cfe6d8"/><rect x="48" y="40" width="48" height="10" fill="#fce4d6"/>'),
    creer: () => {
      const c = nouveauClasseur(); const f = c.feuilles[0]; f.nom = 'Planning';
      const a = new Date().getFullYear(), m = new Date().getMonth() + 1;
      remplir(f, 0, 0, [['Planning', `=DATE(${a};${m};1)`]], (_, j) => ({ gras: true, taille: 14, couleur: '#1E7444', ...(j === 1 ? { format: 'mmmm yyyy' } : {}) }));
      const ligne = ['Agent']; for (let j = 0; j < 31; j++) ligne.push(`=SI(MOIS($B$1+${j})=MOIS($B$1);$B$1+${j};"")`);
      remplir(f, 2, 0, [ligne], (_, j) => ({ ...ent, ...(j ? { format: 'dd' } : {}) }));
      ['Agent 1', 'Agent 2', 'Agent 3', 'Agent 4'].forEach((n, i) => remplir(f, 3 + i, 0, [[n]], { gras: true, bordures: bord }));
      remplir(f, 8, 0, [['Légende :', 'P', 'Présent', 'C', 'Congé', 'F', 'Formation', 'T', 'Télétravail']], (_, j) => j === 0 ? { gras: true } : {});
      f.largeurs = { 0: 110 }; for (let j = 1; j <= 31; j++) f.largeurs[j] = 30;
      f.validations.push({ r1: 3, c1: 1, r2: 30, c2: 31, liste: ['P', 'C', 'F', 'T'] });
      f.mfc.push({ r1: 3, c1: 1, r2: 30, c2: 31, type: 'valeur', op: 'egal', v1: 'C', style: { fond: '#FCE4D6' } });
      f.mfc.push({ r1: 3, c1: 1, r2: 30, c2: 31, type: 'valeur', op: 'egal', v1: 'F', style: { fond: '#DDEBF7' } });
      f.mfc.push({ r1: 3, c1: 1, r2: 30, c2: 31, type: 'valeur', op: 'egal', v1: 'T', style: { fond: '#E2EFDA' } });
      f.figer = { l: 3, c: 1 };
      return c;
    }
  },
];
