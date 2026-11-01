// Dépannage — contrôles « côté Calcul » d'un classeur, en lecture seule
// (aucune écriture : le fichier est lu en mémoire puis analysé)
import { unzipSync, strFromU8 } from './commun/vendor/fflate.js';
import * as XLSX from './commun/vendor/xlsx.mjs';
import { sha256 } from './commun/versions.js';

const ZIP = new Set(['xlsx', 'xlsm', 'xltx', 'xltm']);

/**
 * Contrôle un classeur à partir de ses octets.
 * Renvoie { sha256, taille, lisible, feuilles, macros, detail, points: [{code, gravite, titre, detail}] }
 */
export async function controlerClasseur(octets, ext) {
  const res = { sha256: await sha256(octets), taille: octets.length, lisible: false, feuilles: [], macros: null, points: [] };
  const point = (code, gravite, titre, detail) => res.points.push({ code, gravite, titre, detail });
  if (!octets.length) { point('vide', 'erreur', 'Fichier vide', 'Le fichier ne contient aucun octet : il n\'y a rien à récupérer dans ce fichier lui-même.'); return res; }
  let z = null;
  if (ZIP.has(ext)) {
    try { z = unzipSync(octets); }
    catch (e) { point('archive', 'erreur', 'Archive du classeur endommagée', `L'enveloppe ZIP du classeur ne se décompresse pas (${e.message || e}). Calcul ne peut pas l'ouvrir.`); }
    if (z) {
      if (!z['xl/workbook.xml']) point('archive', 'erreur', 'Partie principale manquante', 'Le fichier xl/workbook.xml est absent : ce n\'est pas un classeur complet.');
      if (z['xl/vbaProject.bin']) {
        res.macros = { taille: z['xl/vbaProject.bin'].length, signe: !!z['xl/vbaProjectSignature.bin'] };
        point('macros', 'info', 'Contient des macros VBA', `Projet VBA de ${Math.round(res.macros.taille / 1024)} Ko${res.macros.signe ? ', signé' : ''}. Calcul ouvre les données mais n'exécute pas les macros ; il les conserve à l'identique lorsqu'il enregistre au format .xlsm.`);
        if (ext === 'xlsx') point('macros-extension', 'alerte', 'Macros dans un fichier .xlsx', 'Un .xlsx ne devrait pas contenir de macros : Excel refusera de l\'ouvrir tel quel. Renommer le fichier en .xlsm peut suffire.');
      }
      const liens = Object.keys(z).filter(k => /^xl\/externalLinks\/externalLink\d+\.xml$/.test(k));
      if (liens.length) point('liaisons', 'info', `${liens.length} liaison(s) vers d'autres classeurs`, 'Calcul affiche la dernière valeur enregistrée des formules liées, sans mettre à jour les liaisons.');
      if (z['xl/workbook.xml'] && /<fileSharing[^>]*(reservationPassword|readOnlyRecommended)/.test(strFromU8(z['xl/workbook.xml']))) point('lecture-seule', 'info', 'Ouverture en lecture seule recommandée ou protégée par mot de passe', 'Calcul ignore cette recommandation : vérifiez que vous avez le droit de modifier ce classeur.');
    }
  }
  if (!res.points.some(p => p.code === 'archive' || p.code === 'vide')) {
    try {
      const wb = XLSX.read(octets, { type: 'array', bookSheets: false, cellFormula: true, sheetStubs: false });
      res.feuilles = wb.SheetNames || [];
      res.lisible = res.feuilles.length > 0;
      if (!res.lisible) point('lecture', 'erreur', 'Aucune feuille lisible', 'Le classeur s\'ouvre mais ne contient aucune feuille utilisable par Calcul.');
    } catch (e) { point('lecture', 'erreur', 'Illisible par Calcul', `La lecture du contenu échoue (${e.message || e}).`); }
  }
  res.detail = res.lisible ? `Lisible par Calcul : ${res.feuilles.length} feuille${res.feuilles.length > 1 ? 's' : ''}${res.macros ? ', macros VBA présentes (conservées, non exécutées)' : ''}` : 'Non lisible par Calcul';
  return res;
}
