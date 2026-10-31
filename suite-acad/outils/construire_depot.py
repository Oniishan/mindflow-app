#!/usr/bin/env python3
"""Construit un dépôt de mises à jour Suite Acad’ à partir des sources de ce dossier.

Le dépôt produit (catalogue.json + applications/*.zip + LISEZMOI.txt) est le format
attendu par SuiteAcad.exe : Réglages > Mises à jour > Source des mises à jour,
ou champ « sourceMaj » de politique.json.

Usage :
    python3 suite-acad/outils/construire_depot.py [--sortie DOSSIER] [--exe CHEMIN/SuiteAcad.exe]

Les versions et notes de chaque application sont lues dans applications/<id>/manifeste.json
(champ « version » et premier élément de « versions »). Le catalogue de base est
outils/catalogue-depot-1.1.0.json (catalogue exporté par SuiteAcad.exe 1.1.0).
"""
import argparse, copy, hashlib, json, os, shutil, sys, zipfile
from datetime import date

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPS = os.path.join(RACINE, 'applications')
COMMUN = os.path.join(RACINE, 'commun')
VENDOR = os.path.join(RACINE, 'vendor')
DATE_FIXE = (2026, 10, 31, 12, 0, 0)  # dates des entrées zip : archives reproductibles

LISEZMOI = """Dépôt de mises à jour de la suite Suite Acad’

Indiquez ce dossier dans Réglages > Mises à jour > Source des mises à jour,
ou dans politique.json (champ sourceMaj) pour l'imposer à tous les postes.

Pour publier une nouvelle version : remplacez l'archive dans applications\\ et mettez à jour
la version, la taille et la somme SHA-256 correspondantes dans catalogue.json.
"""


def fichiers_app(app):
    """Liste (chemin_dans_zip, chemin_disque) pour une application."""
    base = os.path.join(APPS, app)
    res = []
    for d, _, fs in os.walk(base):
        for f in fs:
            if f.startswith('.'):
                continue
            p = os.path.join(d, f)
            res.append((os.path.relpath(p, base).replace(os.sep, '/'), p))
    for d, _, fs in os.walk(COMMUN):
        for f in fs:
            p = os.path.join(d, f)
            res.append(('commun/' + os.path.relpath(p, COMMUN).replace(os.sep, '/'), p))
    vf = os.path.join(base, '.vendor')
    if os.path.exists(vf):
        for v in open(vf, encoding='utf-8').read().split():
            res.append(('commun/vendor/' + v, os.path.join(VENDOR, v)))
    # ordre stable : fichiers de l'application d'abord (comme les archives d'origine), puis commun/
    res.sort(key=lambda x: (x[0].startswith('commun/'), x[0]))
    return res


def construire_zip(app, dest):
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for nom, p in fichiers_app(app):
            zi = zipfile.ZipInfo(nom, DATE_FIXE)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            with open(p, 'rb') as f:
                z.writestr(zi, f.read(), compresslevel=9)
    # contrôle : l'archive se relit et chaque fichier est intact
    with zipfile.ZipFile(dest) as z:
        if z.testzip() is not None:
            raise SystemExit(f'archive corrompue : {dest}')


def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sortie', default=os.path.join(RACINE, 'depot'))
    ap.add_argument('--exe', help='SuiteAcad.exe à joindre au dépôt (facultatif)')
    a = ap.parse_args()
    cat = json.load(open(os.path.join(RACINE, 'outils', 'catalogue-depot-1.1.0.json'), encoding='utf-8'))
    out = a.sortie
    if os.path.isdir(os.path.join(out, 'applications')):
        shutil.rmtree(os.path.join(out, 'applications'))
    os.makedirs(os.path.join(out, 'applications'), exist_ok=True)
    par_id = {x['id']: x for x in cat['applications']}
    for app in sorted(os.listdir(APPS)):
        man_p = os.path.join(APPS, app, 'manifeste.json')
        if not os.path.exists(man_p):
            continue
        man = json.load(open(man_p, encoding='utf-8'))
        version = man.get('version')
        if not version:
            raise SystemExit(f'{app} : champ « version » absent de manifeste.json')
        nom_zip = f'{app}-{version}.zip'
        dest = os.path.join(out, 'applications', nom_zip)
        construire_zip(app, dest)
        entree = par_id.get(app)
        if entree is None:
            entree = {'id': app, 'captures': [], 'versions': []}
            cat['applications'].append(entree)
            par_id[app] = entree
        for k in ('nom', 'slogan', 'inspire', 'categorie', 'ordre', 'couleur', 'lettre', 'iconeRessource',
                  'description', 'formats', 'fonctionnalites'):
            if k in man:
                entree[k] = copy.deepcopy(man[k])
        notes = (man.get('versions') or [{}])[0].get('notes', '')
        vdate = (man.get('versions') or [{}])[0].get('date', date.today().isoformat())
        entree['versions'] = [{
            'version': version, 'date': vdate, 'notes': notes,
            'fichier': 'applications/' + nom_zip, 'sha256': sha256(dest), 'taille': os.path.getsize(dest),
        }]
        print(f'{app:12s} {version:8s} {os.path.getsize(dest):>9d} octets  {nom_zip}')
    if a.exe:
        shutil.copy2(a.exe, os.path.join(out, 'SuiteAcad.exe'))
        cat['lanceur']['sha256'] = sha256(a.exe)
        cat['lanceur']['taille'] = os.path.getsize(a.exe)
    with open(os.path.join(out, 'catalogue.json'), 'w', encoding='utf-8') as f:
        json.dump(cat, f, ensure_ascii=False, indent=2)
    with open(os.path.join(out, 'LISEZMOI.txt'), 'w', encoding='utf-8', newline='\r\n') as f:
        f.write(LISEZMOI)
    print('Dépôt écrit dans', out)


if __name__ == '__main__':
    main()
