// FonctionGrist — génération d'un formulaire autonome (page HTML sans dépendance)
import { table, libelleLigne, colonneDe, TYPES } from './modele.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Définition autonome du formulaire (instantané des colonnes, choix et listes liées) */
export function definitionFormulaire(B, f) {
  const t = table(B, f.table); if (!t) throw new Error('table introuvable');
  const champs = [];
  for (const ch of f.champs) {
    const c = colonneDe(t, ch.col); if (!c || c.type === 'calcul') continue;
    const d = { id: c.id, libelle: ch.libelle || c.nom, type: c.type, aide: ch.aide ?? c.aide ?? '', obligatoire: !!(ch.obligatoire || c.obligatoire) };
    if (c.type === 'choix' || c.type === 'choixMultiple') d.choix = (c.choix || []).map(o => o.v);
    if (c.type === 'reference') { const rt = table(B, c.refTable); d.options = (rt?.lignes || []).map(l => ({ id: l.id, libelle: libelleLigne(B, rt, l) })).sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr')); }
    champs.push(d);
  }
  return { format: 'atelier-formulaires', type: 'saisie', version: 1, base: B.id, formulaire: f.id, titre: f.titre || 'Formulaire', description: f.description || '', message: f.message || 'Merci, votre réponse a bien été enregistrée.', couleur: f.couleur || '#0E7380', champs, dossierReponses: f.dossier || null, publie: new Date().toISOString() };
}

const CSS = `
*{box-sizing:border-box}html{background:#EEF3F4}body{margin:0;font:16px/1.5 "Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:#14232B}
.page{max-width:720px;margin:0 auto;padding:32px 18px 60px}
.entete{background:#fff;border-radius:12px;border-top:10px solid var(--c);padding:26px 30px 22px;box-shadow:0 1px 3px rgba(20,35,43,.12);margin-bottom:14px}
h1{margin:0 0 6px;font-size:28px;line-height:1.2}.desc{margin:0;color:#41555F;white-space:pre-wrap}.oblig{margin:14px 0 0;color:#8A1C16;font-size:14px}
.champ{background:#fff;border-radius:12px;padding:20px 30px 22px;box-shadow:0 1px 3px rgba(20,35,43,.12);margin-bottom:12px;border:2px solid transparent}
.champ.erreur{border-color:#B42318}.champ label.titre{display:block;font-weight:600;font-size:17px;margin-bottom:4px}.champ .etoile{color:#B42318;margin-left:4px}
.aide{color:#5A6B74;font-size:14px;margin:0 0 10px}.msg{color:#B42318;font-size:14px;margin-top:8px;display:none}.champ.erreur .msg{display:block}
input[type=text],input[type=email],input[type=tel],input[type=url],input[type=number],input[type=date],select,textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid #B9C6CC;border-radius:8px;background:#fff;color:inherit}
textarea{min-height:110px;resize:vertical}input:focus,select:focus,textarea:focus{outline:none;border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 22%,transparent)}
.options{display:flex;flex-direction:column;gap:8px}.options label{display:flex;gap:10px;align-items:center;cursor:pointer;padding:6px 8px;border-radius:6px}.options label:hover{background:#F1F6F7}
.options input{width:20px;height:20px;accent-color:var(--c);margin:0}
.etoiles{display:flex;gap:6px}.etoiles button{font-size:30px;line-height:1;background:none;border:0;cursor:pointer;color:#C5D0D5;padding:0 2px}.etoiles button.on{color:#E0A400}.etoiles button:focus-visible{outline:2px solid var(--c);border-radius:4px}
.actions{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:20px;flex-wrap:wrap}
button.envoyer{background:var(--c);color:#fff;border:0;border-radius:8px;padding:12px 26px;font:600 16px "Segoe UI",system-ui,Arial,sans-serif;cursor:pointer}button.envoyer:hover{filter:brightness(1.08)}button.envoyer:disabled{opacity:.6;cursor:wait}
button.lien{background:none;border:0;color:var(--c);font:inherit;cursor:pointer;text-decoration:underline;padding:0}
.merci{background:#fff;border-radius:12px;border-top:10px solid var(--c);padding:30px;box-shadow:0 1px 3px rgba(20,35,43,.12);display:none}.merci h2{margin:0 0 10px}
.pied{text-align:center;color:#6C7E86;font-size:13px;margin-top:26px}
@media (max-width:560px){.entete,.champ{padding:18px}h1{font-size:23px}}
@media print{html{background:#fff}.champ,.entete{box-shadow:none;border:1px solid #ccc}.actions{display:none}}`;

const SCRIPT = `
(function(){
const D = JSON.parse(document.getElementById('def').textContent);
const f = document.getElementById('f');
const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
function lire(ch){
  const z = f.querySelector('[data-champ="' + ch.id + '"]');
  if (ch.type === 'case') return z.querySelector('input').checked;
  if (ch.type === 'choixMultiple') return [...z.querySelectorAll('input:checked')].map(i => i.value);
  if (ch.type === 'choix') { const r = z.querySelector('input:checked'); const s = z.querySelector('select'); return s ? s.value : (r ? r.value : ''); }
  if (ch.type === 'note') return +z.dataset.note || null;
  const i = z.querySelector('input,select,textarea'); const v = i.value.trim();
  if (ch.type === 'nombre' || ch.type === 'monetaire') return v === '' ? null : Number(v.replace(/\\s/g, '').replace(',', '.'));
  return v;
}
function verifier(ch, v){
  const vide = v == null || v === '' || (Array.isArray(v) && !v.length) || (ch.type === 'case' && !v && ch.obligatoire);
  if (ch.obligatoire && vide) return 'Cette question est obligatoire.';
  if (vide) return '';
  if ((ch.type === 'nombre' || ch.type === 'monetaire') && isNaN(v)) return 'Indiquez un nombre.';
  if (ch.type === 'email' && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v)) return 'Indiquez une adresse e-mail valide.';
  if (ch.type === 'date' && !/^\\d{4}-\\d{2}-\\d{2}$/.test(v)) return 'Indiquez une date.';
  return '';
}
f.querySelectorAll('.etoiles').forEach(e => { const z = e.closest('[data-champ]'); const maj = () => e.querySelectorAll('button').forEach((b, i) => { b.classList.toggle('on', i < (+z.dataset.note || 0)); b.setAttribute('aria-pressed', i < (+z.dataset.note || 0)); }); e.querySelectorAll('button').forEach((b, i) => b.onclick = () => { z.dataset.note = (+z.dataset.note === i + 1) ? 0 : i + 1; maj(); }); maj(); });
f.addEventListener('reset', () => setTimeout(() => { f.querySelectorAll('[data-note]').forEach(z => { z.dataset.note = 0; z.querySelectorAll('.etoiles button').forEach(b => b.classList.remove('on')); }); f.querySelectorAll('.champ.erreur').forEach(z => z.classList.remove('erreur')); }));
f.addEventListener('input', e => { const z = e.target.closest('.champ'); if (z) z.classList.remove('erreur'); });
f.addEventListener('submit', async e => {
  e.preventDefault();
  const valeurs = {}; let premier = null;
  for (const ch of D.champs) {
    const v = lire(ch); const m = verifier(ch, v); const z = f.querySelector('[data-champ="' + ch.id + '"]');
    z.classList.toggle('erreur', !!m); z.querySelector('.msg').textContent = m;
    if (m && !premier) premier = z;
    if (!(v == null || v === '' || (Array.isArray(v) && !v.length))) valeurs[ch.id] = v;
  }
  if (premier) { premier.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = premier.querySelector('input,select,textarea,button'); if (i) i.focus({ preventScroll: true }); return; }
  const rep = { format: 'atelier-reponse', version: 1, id: uid(), base: D.base, formulaire: D.formulaire, titre: D.titre, date: new Date().toISOString(), valeurs };
  const btn = f.querySelector('.envoyer'); btn.disabled = true;
  try {
    let ok = false;
    const hote = window.__atelierReponse || (window.parent !== window && window.parent.__atelierReponse);
    if (hote) ok = await hote(rep);
    else {
      const d = new Date(); const p = n => String(n).padStart(2, '0');
      const nom = ((D.titre.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^A-Za-z0-9 ._()-]+/g, ' ').replace(/\\s+/g, ' ').trim() || 'Formulaire') + ' - reponse du ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + 'h' + p(d.getMinutes()) + 'm' + p(d.getSeconds())) + '.reponse';
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(rep, null, 1)], { type: 'application/octet-stream' })); a.download = nom; document.body.appendChild(a); a.click(); a.remove();
      document.getElementById('consigne').hidden = false; ok = true;
    }
    if (ok === false) { btn.disabled = false; return; }
    f.style.display = 'none'; document.querySelector('.entete').style.display = 'none'; document.getElementById('merci').style.display = 'block'; window.scrollTo(0, 0);
  } catch (err) { alert('La réponse n\\'a pas pu être enregistrée : ' + (err && err.message || err)); btn.disabled = false; }
});
document.getElementById('autre').onclick = () => { f.reset(); f.querySelectorAll('[data-note]').forEach(z => { z.dataset.note = 0; z.querySelectorAll('.etoiles button').forEach(b => b.classList.remove('on')); }); f.querySelector('.envoyer').disabled = false; f.style.display = ''; document.querySelector('.entete').style.display = ''; document.getElementById('merci').style.display = 'none'; document.getElementById('consigne').hidden = true; window.scrollTo(0, 0); };
})();`;

function htmlChamp(ch, i) {
  const id = 'q' + i, aide = ch.aide ? `<p class="aide" id="${id}-aide">${esc(ch.aide)}</p>` : '';
  const desc = ch.aide ? ` aria-describedby="${id}-aide"` : '';
  const req = ch.obligatoire ? ' required aria-required="true"' : '';
  let saisie = '';
  switch (ch.type) {
    case 'texteLong': saisie = `<textarea id="${id}"${desc}${req}></textarea>`; break;
    case 'nombre': case 'monetaire': saisie = `<input type="text" inputmode="decimal" id="${id}"${desc}${req} placeholder="${ch.type === 'monetaire' ? 'Montant en euros' : ''}">`; break;
    case 'date': saisie = `<input type="date" id="${id}"${desc}${req}>`; break;
    case 'email': saisie = `<input type="email" id="${id}"${desc}${req} autocomplete="email">`; break;
    case 'telephone': saisie = `<input type="tel" id="${id}"${desc}${req} autocomplete="tel">`; break;
    case 'lien': saisie = `<input type="url" id="${id}"${desc}${req} placeholder="https://">`; break;
    case 'case': saisie = `<div class="options"><label><input type="checkbox" id="${id}"${desc}> Oui</label></div>`; break;
    case 'choix': saisie = (ch.choix || []).length > 6 ? `<select id="${id}"${desc}${req}><option value="">Choisir…</option>${ch.choix.map(o => `<option>${esc(o)}</option>`).join('')}</select>` : `<div class="options" role="radiogroup" aria-labelledby="${id}-l">${(ch.choix || []).map(o => `<label><input type="radio" name="${id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>`; break;
    case 'choixMultiple': saisie = `<div class="options" role="group" aria-labelledby="${id}-l">${(ch.choix || []).map(o => `<label><input type="checkbox" name="${id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>`; break;
    case 'reference': saisie = `<select id="${id}"${desc}${req}><option value="">Choisir…</option>${(ch.options || []).map(o => `<option value="${esc(o.id)}">${esc(o.libelle)}</option>`).join('')}</select>`; break;
    case 'note': saisie = `<div class="etoiles" role="group" aria-labelledby="${id}-l">${[1, 2, 3, 4, 5].map(n => `<button type="button" aria-label="${n} étoile${n > 1 ? 's' : ''}">★</button>`).join('')}</div>`; break;
    default: saisie = `<input type="text" id="${id}"${desc}${req}>`;
  }
  const lab = ['choix', 'choixMultiple', 'note', 'case'].includes(ch.type) && !(ch.type === 'choix' && (ch.choix || []).length > 6) ? `<label class="titre" id="${id}-l">` : `<label class="titre" id="${id}-l" for="${id}">`;
  return `<div class="champ" data-champ="${esc(ch.id)}"${ch.type === 'note' ? ' data-note="0"' : ''}>${lab}${esc(ch.libelle)}${ch.obligatoire ? '<span class="etoile" aria-hidden="true">*</span>' : ''}</label>${aide}${saisie}<div class="msg" role="alert"></div></div>`;
}

export function pageFormulaire(def) {
  const oblig = def.champs.some(c => c.obligatoire);
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(def.titre)}</title>
<style>:root{--c:${esc(def.couleur)}}${CSS}</style></head>
<body><div class="page">
<header class="entete"><h1>${esc(def.titre)}</h1>${def.description ? `<p class="desc">${esc(def.description)}</p>` : ''}${oblig ? '<p class="oblig">* Réponse obligatoire</p>' : ''}</header>
<form id="f" novalidate>${def.champs.map(htmlChamp).join('')}
<div class="actions"><button type="submit" class="envoyer">Envoyer</button><button type="reset" class="lien">Effacer le formulaire</button></div></form>
<section class="merci" id="merci" aria-live="polite"><h2>Réponse envoyée</h2><p>${esc(def.message)}</p><p id="consigne" hidden>Votre réponse a été enregistrée dans un fichier « .reponse » (dossier Téléchargements). Transmettez ce fichier à la personne qui vous a envoyé ce formulaire.</p><button type="button" class="lien" id="autre">Envoyer une autre réponse</button></section>
<p class="pied">${esc(def.titre)}</p>
</div>
<script type="application/json" id="def">${JSON.stringify(def).replace(/</g, '\\u003c')}</script>
<script>${SCRIPT}</script>
</body></html>`;
}
export { TYPES };
