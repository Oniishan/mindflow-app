#!/usr/bin/env python3
"""Crée les classeurs de test (dans tests/fichiers/) utilisés par les tests de bout en bout."""
import os, struct, zipfile, openpyxl, xlsxwriter
from openpyxl.styles import Font, PatternFill
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fichiers')
os.makedirs(D, exist_ok=True)
p = lambda n: os.path.join(D, n)

# classeur simple, sain
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Ventes'
ws.append(['Produit', 'Prix', 'Qté', 'Total'])
for i in range(1, 11): ws.append([f'Article {i}', i * 1.5, i, f'=B{i+1}*C{i+1}'])
wb.create_sheet('Notes')['A1'] = 'Feuille 2'
wb.save(p('simple.xlsx'))

# styles accumulés (copier-coller entre classeurs) : 6000 styles distincts
wb = openpyxl.Workbook(); ws = wb.active
for i in range(6000):
    c = ws.cell(row=i + 1, column=1, value=i)
    c.font = Font(size=8 + (i % 20), color='%06X' % (i * 2797 % 0xFFFFFF)); c.fill = PatternFill('solid', fgColor='%06X' % (i * 7919 % 0xFFFFFF))
wb.save(p('styles.xlsx'))

# feuille protégée
wb = openpyxl.Workbook(); ws = wb.active; ws['A1'] = 'protégé'; ws.protection.sheet = True; ws.protection.password = 'secret'
wb.save(p('protege.xlsx'))

# classeur endommagé : archive tronquée
b = open(p('simple.xlsx'), 'rb').read(); open(p('endommage.xlsx'), 'wb').write(b[: len(b) // 2])

def ecrire_cfb(flux):
    """Écrit un conteneur OLE (CFB v3, secteurs de 512 o, mini-flux de 64 o) contenant les flux donnés.
    flux : liste de (chemin, octets) ; un seul niveau de stockage (ex. 'VBA/dir')."""
    SS, MS, COUP, FIN, LIBRE, FATS = 512, 64, 4096, 0xFFFFFFFE, 0xFFFFFFFF, 0xFFFFFFFD
    stockages = sorted({c.split('/')[0] for c, _ in flux if '/' in c})
    ent = [{'nom': 'Root Entry', 'type': 5, 'enfants': []}]
    idx = {}
    for st in stockages:
        idx[st] = len(ent); ent.append({'nom': st, 'type': 1, 'enfants': []}); ent[0]['enfants'].append(idx[st])
    for c, o in flux:
        parent = idx[c.split('/')[0]] if '/' in c else 0
        ent.append({'nom': c.split('/')[-1], 'type': 2, 'donnees': o, 'enfants': []}); ent[parent]['enfants'].append(len(ent) - 1)
    mini = bytearray(); minifat = []
    grands = []
    for e in ent:
        if e['type'] != 2: continue
        o = e['donnees']
        if len(o) < COUP:
            e['debut'] = len(mini) // MS; n = max(1, -(-len(o) // MS))
            minifat += [e['debut'] + i + 1 for i in range(n - 1)] + [FIN]
            mini += o + bytes(n * MS - len(o))
        else: grands.append(e)
    nsec = lambda n: -(-n // SS)
    ndir = nsec(len(ent) * 128); nminifat = nsec(len(minifat) * 4); nmini = nsec(len(mini))
    ngrands = sum(nsec(len(e['donnees'])) for e in grands)
    total = ndir + nminifat + nmini + ngrands
    nfat = 1
    while nfat * (SS // 4) < total + nfat: nfat += 1
    fat = [FATS] * nfat; pos = nfat
    def chaine(n):
        nonlocal pos
        d = pos; fat.extend([pos + i + 1 for i in range(n - 1)] + [FIN]); pos += n; return d
    dir0 = chaine(ndir); minifat0 = chaine(nminifat) if nminifat else FIN; mini0 = chaine(nmini) if nmini else FIN
    for e in grands: e['debut'] = chaine(nsec(len(e['donnees'])))
    ent[0]['debut'] = mini0; ent[0]['taille'] = len(mini)
    fat += [LIBRE] * (nfat * SS // 4 - len(fat))
    def entree(e):
        n = (e['nom'] + '\0').encode('utf-16-le')
        b = bytearray(128); b[:len(n)] = n; struct.pack_into('<HBB', b, 0x40, len(n), e['type'], 1)
        struct.pack_into('<III', b, 0x44, LIBRE, e.get('droite', LIBRE), e['enfants'][0] if e['enfants'] else LIBRE)
        struct.pack_into('<II', b, 0x74, e.get('debut', FIN if e['type'] != 5 else 0), e.get('taille', len(e.get('donnees', b''))))
        return bytes(b)
    for e in ent:  # frères chaînés par le pointeur droit (arbre dégénéré, lisible par les lecteurs OLE)
        for a, b in zip(e['enfants'], e['enfants'][1:]): ent[a]['droite'] = b
    tete = bytearray(512); tete[:8] = bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
    struct.pack_into('<HHHHH', tete, 0x18, 0x3E, 3, 0xFFFE, 9, 6)
    struct.pack_into('<IIIIIIII', tete, 0x2C, nfat, dir0, 0, COUP, minifat0, nminifat, FIN, 0)
    difat = list(range(nfat)) + [LIBRE] * (109 - nfat)
    struct.pack_into('<109I', tete, 0x4C, *difat)
    corps = b''.join(struct.pack('<I', x) for x in fat)
    d = b''.join(entree(e) for e in ent); corps += d + bytes(ndir * SS - len(d))
    if nminifat: m = b''.join(struct.pack('<I', x) for x in minifat); corps += m + b'\xff' * (nminifat * SS - len(m))
    if nmini: corps += bytes(mini) + bytes(nmini * SS - len(mini))
    for e in grands: corps += e['donnees'] + bytes(nsec(len(e['donnees'])) * SS - len(e['donnees']))
    return bytes(tete) + corps

# classeur avec macros (.xlsm). Le projet VBA est un vrai conteneur OLE avec flux PROJECT (liste des
# modules) ; le code compilé n'est pas valide pour Excel : les tests vérifient la conservation à
# l'octet près et la lecture des modules, pas l'exécution.
projet = ('ID="{00000000-0000-0000-0000-000000000000}"\r\nDocument=ThisWorkbook/&H00000000\r\nDocument=Feuil1/&H00000000\r\n'
          'Module=Module1\r\nModule=Outils\r\nClass=Facture\r\nName="VBAProject"\r\nHelpContextID="0"\r\nCMG="0"\r\nDPB="0"\r\nGC="0"\r\n\r\n[Host Extender Info]\r\n').encode('cp1252')
module1 = ('Attribute VB_Name = "Module1"\r\nSub Bonjour()\r\n    MsgBox "Bonjour"\r\nEnd Sub\r\n' + "' remplissage\r\n" * 400).encode('cp1252')
vba = ecrire_cfb([('PROJECT', projet), ('PROJECTwm', b'Module1\0M\0o\0\0\0\0'), ('VBA/dir', bytes(range(200))), ('VBA/_VBA_PROJECT', b'\xcc\x61\xff\xff\x00\x00\x00'), ('VBA/Module1', module1), ('VBA/ThisWorkbook', b'x' * 300)])
open(p('vbaProject.bin'), 'wb').write(vba)
w = xlsxwriter.Workbook(p('macros.xlsm')); s = w.add_worksheet('Calculs'); s.set_vba_name('Feuil1')
s.write_row(0, 0, ['Montant', 'TVA']); s.write(1, 0, 100); s.write_formula(1, 1, '=A2*0.2')
w.add_vba_project(p('vbaProject.bin')); w.set_vba_name('ThisWorkbook')
s.write_formula(2, 0, '=CUBEVALUE("Ventes")')  # fonction non prise en charge par Calcul
s.insert_button('D2', {'macro': 'Bonjour', 'caption': 'Dire bonjour'})  # bouton de formulaire lié à une macro
w.close()
os.remove(p('vbaProject.bin'))
print('\n'.join(sorted(os.listdir(D))))

# ---------- Publipostage ----------
import datetime, docx
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Inscrits'
ws.append(['Nom', 'Prénom', 'Courriel', 'Montant', 'Date de naissance', 'Ville'])
donnees = [
    ('Martin', 'Léa', 'lea.martin@exemple.fr', 125.5, datetime.date(2010, 3, 14), 'Grenoble'),
    ('Durand/Dupont', 'Hugo', 'hugo.durand@exemple.fr', 80, datetime.date(2011, 7, 2), 'Échirolles'),
    ('Bernard', None, 'famille.bernard@exemple.fr', 42, datetime.date(2009, 12, 31), 'Voiron'),
    ('Petit', 'Zoé', 'lea.martin@exemple.fr', 10, datetime.date(2012, 1, 5), 'Meylan'),
    ('Robert', 'Noé', 'adresse-invalide', 99.99, datetime.date(2010, 9, 9), 'Grenoble'),
    ('CON', 'Inès', 'ines.con@exemple.fr', 0, datetime.date(2011, 4, 1), 'Fontaine'),
]
for d in donnees: ws.append(list(d))
for r in range(2, len(donnees) + 2): ws.cell(row=r, column=5).number_format = 'dd/mm/yyyy'; ws.cell(row=r, column=4).number_format = '#,##0.00 "€"'
ws.append([None] * 6)  # ligne vide
wb.save(p('destinataires.xlsx'))
with open(p('destinataires.csv'), 'w', encoding='cp1252', newline='') as f:
    f.write('Nom;Prénom;Courriel\r\nMartin;Léa;lea.martin@exemple.fr\r\nÉlodie;Garçon;e.garcon@exemple.fr\r\n')

d = docx.Document()
d.sections[0].header.paragraphs[0].text = 'Dossier de {Nom}'
d.add_heading('Confirmation d\'inscription', 1)
par = d.add_paragraph()
for morceau in ['Bonjour {Pré', 'nom|Madame, ', 'Monsieur} ', '{Nom}', ',']:  # balise éclatée sur plusieurs morceaux
    par.add_run(morceau)
par2 = d.add_paragraph('Montant dû : ')
# champ de fusion Word complexe : MERGEFIELD Montant
for typ, txt in [('begin', None), (None, ' MERGEFIELD Montant \\* MERGEFORMAT '), ('separate', None), (None, '«Montant»'), ('end', None)]:
    r = par2.add_run()
    if typ:
        fc = OxmlElement('w:fldChar'); fc.set(qn('w:fldCharType'), typ); r._r.append(fc)
    elif 'MERGEFIELD' in txt:
        it = OxmlElement('w:instrText'); it.set(qn('xml:space'), 'preserve'); it.text = txt; r._r.append(it)
    else: r.text = txt
d.add_paragraph('Né(e) le «Date de naissance» à {Ville}. Document n° {#}.')
t = d.add_table(rows=2, cols=2); t.style = 'Table Grid'
t.cell(0, 0).text = 'Courriel'; t.cell(0, 1).text = '{Courriel}'; t.cell(1, 0).text = 'Observation'; t.cell(1, 1).text = '{Observation|Aucune}'
d.add_paragraph('Signature : le secrétariat — {Champ inconnu}')
d.save(p('modele-inscription.docx'))
print('publipostage : ok')
