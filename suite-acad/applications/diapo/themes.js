// Diapo — thèmes et dispositions
export const THEMES = [
  { id: 'atelier', nom: 'Académique', fond: '#FFFFFF', titre: '#1B2A4A', texte: '#2B2F38', accents: ['#2456B0', '#E07B00', '#1E7444', '#B0261E'], policeTitre: 'Segoe UI Semibold', policeTexte: 'Segoe UI', decor: 'bande' },
  { id: 'institution', nom: 'Institution', fond: '#FFFFFF', titre: '#000091', texte: '#1E1E1E', accents: ['#000091', '#E1000F', '#6A6AF4', '#3A3A3A'], policeTitre: 'Arial', policeTexte: 'Arial', decor: 'filet' },
  { id: 'ardoise', nom: 'Ardoise', fond: '#1E2533', titre: '#FFFFFF', texte: '#D8DEE9', accents: ['#5AA9E6', '#F4B860', '#7FC8A9', '#F07167'], policeTitre: 'Segoe UI Semibold', policeTexte: 'Segoe UI', decor: 'aucun' },
  { id: 'craie', nom: 'Tableau vert', fond: '#20372C', titre: '#F5F3E7', texte: '#E4E9DF', accents: ['#F6D365', '#9AD1D4', '#F4A6A6', '#C3E88D'], policeTitre: 'Georgia', policeTexte: 'Verdana', decor: 'aucun' },
  { id: 'mineral', nom: 'Minéral', fond: '#F2F4F6', titre: '#2F3B45', texte: '#3C4650', accents: ['#0E7380', '#B25000', '#5A6B7B', '#8A6D00'], policeTitre: 'Calibri', policeTexte: 'Calibri', decor: 'coin' },
  { id: 'aurore', nom: 'Aurore', fond: '#FFFFFF', titre: '#5B2A86', texte: '#2E2A33', accents: ['#5B2A86', '#E4572E', '#29335C', '#F3A712'], policeTitre: 'Trebuchet MS', policeTexte: 'Trebuchet MS', decor: 'bande-gauche' },
];
export const theme = id => THEMES.find(t => t.id === id) || THEMES[0];

// Dispositions (coordonnées logiques 1280 × 720 ; adaptées au 4:3 par proportion)
export const DISPOSITIONS = [
  { id: 'titre', nom: 'Diapositive de titre', zones: [{ role: 'titre', x: 120, y: 230, l: 1040, h: 140, taille: 54, align: 'center', valign: 'bottom' }, { role: 'sous-titre', x: 120, y: 390, l: 1040, h: 90, taille: 26, align: 'center', valign: 'top' }] },
  { id: 'titre-contenu', nom: 'Titre et contenu', zones: [{ role: 'titre', x: 70, y: 40, l: 1140, h: 110, taille: 40, align: 'left', valign: 'middle' }, { role: 'corps', x: 70, y: 170, l: 1140, h: 480, taille: 26, align: 'left', valign: 'top' }] },
  { id: 'section', nom: 'En-tête de section', zones: [{ role: 'titre', x: 90, y: 250, l: 1100, h: 130, taille: 50, align: 'left', valign: 'bottom' }, { role: 'sous-titre', x: 90, y: 390, l: 1100, h: 70, taille: 24, align: 'left', valign: 'top' }] },
  { id: 'deux-colonnes', nom: 'Deux contenus', zones: [{ role: 'titre', x: 70, y: 40, l: 1140, h: 110, taille: 40, align: 'left', valign: 'middle' }, { role: 'corps', x: 70, y: 170, l: 555, h: 480, taille: 24, align: 'left', valign: 'top' }, { role: 'corps', x: 655, y: 170, l: 555, h: 480, taille: 24, align: 'left', valign: 'top' }] },
  { id: 'comparaison', nom: 'Comparaison', zones: [{ role: 'titre', x: 70, y: 40, l: 1140, h: 100, taille: 38, align: 'left', valign: 'middle' }, { role: 'sous-titre', x: 70, y: 155, l: 555, h: 60, taille: 26, align: 'left', valign: 'middle', gras: true }, { role: 'corps', x: 70, y: 220, l: 555, h: 430, taille: 22, align: 'left', valign: 'top' }, { role: 'sous-titre', x: 655, y: 155, l: 555, h: 60, taille: 26, align: 'left', valign: 'middle', gras: true }, { role: 'corps', x: 655, y: 220, l: 555, h: 430, taille: 22, align: 'left', valign: 'top' }] },
  { id: 'titre-seul', nom: 'Titre seul', zones: [{ role: 'titre', x: 70, y: 40, l: 1140, h: 110, taille: 40, align: 'left', valign: 'middle' }] },
  { id: 'image-legende', nom: 'Image avec légende', zones: [{ role: 'titre', x: 70, y: 70, l: 430, h: 150, taille: 32, align: 'left', valign: 'bottom' }, { role: 'corps', x: 70, y: 235, l: 430, h: 400, taille: 20, align: 'left', valign: 'top' }, { role: 'image', x: 540, y: 60, l: 670, h: 600 }] },
  { id: 'vide', nom: 'Vide', zones: [] },
];
export const INVITES = { titre: 'Cliquez pour ajouter un titre', 'sous-titre': 'Cliquez pour ajouter un sous-titre', corps: 'Cliquez pour ajouter du texte', image: 'Cliquez sur l\'icône pour ajouter une image' };

export const FORMES = [
  ['rect', 'Rectangle'], ['rect-arrondi', 'Rectangle arrondi'], ['ellipse', 'Ellipse'], ['triangle', 'Triangle'], ['losange', 'Losange'],
  ['fleche-droite', 'Flèche droite'], ['fleche-gauche', 'Flèche gauche'], ['chevron', 'Chevron'], ['etoile', 'Étoile'], ['bulle', 'Bulle'], ['ligne', 'Ligne'], ['fleche', 'Flèche (trait)'],
];
// tracé SVG d'une forme dans une boîte l × h
export function cheminForme(forme, l, h) {
  switch (forme) {
    case 'rect': return `M0,0H${l}V${h}H0Z`;
    case 'rect-arrondi': { const r = Math.min(l, h) * 0.16; return `M${r},0H${l - r}A${r},${r} 0 0 1 ${l},${r}V${h - r}A${r},${r} 0 0 1 ${l - r},${h}H${r}A${r},${r} 0 0 1 0,${h - r}V${r}A${r},${r} 0 0 1 ${r},0Z`; }
    case 'ellipse': return `M${l / 2},0A${l / 2},${h / 2} 0 1 1 ${l / 2},${h}A${l / 2},${h / 2} 0 1 1 ${l / 2},0Z`;
    case 'triangle': return `M${l / 2},0L${l},${h}H0Z`;
    case 'losange': return `M${l / 2},0L${l},${h / 2}L${l / 2},${h}L0,${h / 2}Z`;
    case 'fleche-droite': return `M0,${h * 0.25}H${l * 0.62}V0L${l},${h / 2}L${l * 0.62},${h}V${h * 0.75}H0Z`;
    case 'fleche-gauche': return `M${l},${h * 0.25}H${l * 0.38}V0L0,${h / 2}L${l * 0.38},${h}V${h * 0.75}H${l}Z`;
    case 'chevron': return `M0,0H${l * 0.7}L${l},${h / 2}L${l * 0.7},${h}H0L${l * 0.3},${h / 2}Z`;
    case 'etoile': { let p = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.4 : 1; p += (i ? 'L' : 'M') + (l / 2 + Math.cos(a) * r * l / 2).toFixed(1) + ',' + (h / 2 + Math.sin(a) * r * h / 2 + h * 0.04).toFixed(1); } return p + 'Z'; }
    case 'bulle': return `M0,0H${l}V${h * 0.75}H${l * 0.35}L${l * 0.18},${h}L${l * 0.2},${h * 0.75}H0Z`;
    case 'ligne': return `M0,${h / 2}H${l}`;
    case 'fleche': return `M0,${h / 2}H${l}`;
  }
  return `M0,0H${l}V${h}H0Z`;
}
