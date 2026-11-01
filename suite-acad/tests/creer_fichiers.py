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

# classeur avec macros (.xlsm). Le projet VBA est un conteneur binaire de démonstration : les tests
# vérifient qu'il est conservé à l'octet près, pas qu'Excel l'exécute.
vba = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + bytes(range(256)) * 40 + b'Attribute VB_Name = "Module1"\r\nSub Bonjour()\r\nMsgBox "Bonjour"\r\nEnd Sub\r\n'
open(p('vbaProject.bin'), 'wb').write(vba)
w = xlsxwriter.Workbook(p('macros.xlsm')); s = w.add_worksheet('Calculs')
s.write_row(0, 0, ['Montant', 'TVA']); s.write(1, 0, 100); s.write_formula(1, 1, '=A2*0.2')
w.add_vba_project(p('vbaProject.bin')); w.set_vba_name('ThisWorkbook'); w.close()
os.remove(p('vbaProject.bin'))
print('\n'.join(sorted(os.listdir(D))))
