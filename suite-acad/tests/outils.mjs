// Outils communs des tests de bout en bout : vrai moteur SuiteAcad.exe (Wine) + Chromium (Playwright)
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
export const ICI = path.dirname(fileURLToPath(import.meta.url));
export const BANC = path.join(ICI, 'banc');
export const WINEPREFIX = process.env.WINEPREFIX || '/tmp/wineprefix';
export const DONNEES = path.join(WINEPREFIX, 'drive_c/users/root/AppData/Local/SuiteAcad');
export const ESSAI = process.env.DOSSIER_ESSAI || '/tmp/essai-suite';
export const versWin = p => 'Z:' + p.replace(/\//g, '\\');

let resultats = [], nomSuite = '';
export function suite(nom) { nomSuite = nom; resultats = []; console.log(`\n=== ${nom} ===`); }
export function verifier(test, ok, detail = '') {
  resultats.push({ test, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? '  OK  ' : '  ÉCHEC'} ${test}${detail ? ' — ' + detail : ''}`);
  return !!ok;
}
export function bilan() {
  const ko = resultats.filter(r => !r.ok);
  console.log(`\n${nomSuite} : ${resultats.length - ko.length}/${resultats.length} vérifications réussies`);
  const dir = path.join(ICI, 'resultats'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, nomSuite.replace(/\W+/g, '-') + '.json'), JSON.stringify(resultats, null, 2));
  return ko.length === 0;
}

/** Lance une application dans le vrai moteur et l'ouvre dans Chromium. */
export async function lancer(app, args = []) {
  const url = execFileSync(path.join(BANC, 'lancer.sh'), [app, ...args], { encoding: 'utf8' }).trim();
  if (!url.startsWith('http')) throw new Error('le moteur n\'a pas démarré : ' + url);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  // les 404 attendus (copie absente lors d'un contrôle) ne sont pas des erreurs JavaScript
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push(m.text()); });
  await page.goto(url);
  const html = await (await fetch(url)).text();
  const jeton = /"jeton":"([0-9a-f]+)"/.exec(html)[1];
  const api = async (chemin, corps, { methode = 'POST', brut = false } = {}) => {
    const r = await fetch(url.replace(/\/$/, '') + chemin, { method: methode, headers: { 'X-Suite-Jeton': jeton, 'Content-Type': 'application/json' }, body: methode === 'GET' ? undefined : JSON.stringify(corps ?? {}) });
    if (brut) return { status: r.status, octets: new Uint8Array(await r.arrayBuffer()) };
    const t = await r.text(); return { status: r.status, json: t ? JSON.parse(t) : null };
  };
  return { url, browser, page, api, erreurs };
}
export async function arreter(ctx) {
  try { await ctx?.browser?.close(); } catch { }
  execFileSync(path.join(BANC, 'arreter.sh'));
}
export const attendre = ms => new Promise(r => setTimeout(r, ms));
export function sha256Fichier(p) { return require('node:crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
