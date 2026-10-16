# -*- coding: utf-8 -*-
import sys, re
sys.stdout.reconfigure(encoding='utf-8')
import formulas
xl = formulas.ExcelModel().loads('out/aura-hills-tz-simple.xlsx').finish()
sol = xl.calculate()
book = 'aura-hills-tz-simple.xlsx'
key_re = re.compile(r"^'\[" + re.escape(book) + r"\]([^']+)'!(\$?[A-Z]+\$?\d+)$")
calc = {}
errs = {}
for k, v in sol.items():
    m = key_re.match(k)
    if not m: continue
    try: val = v.value[0, 0]
    except Exception:
        try: val = v.value
        except Exception: continue
    s = str(val)
    if s.startswith('#'):
        errs.setdefault(s, []).append(f"{m.group(1)}!{m.group(2)}")
    calc[(m.group(1), m.group(2).replace('$',''))] = val
print('cells:', len(calc))
for e, cells in errs.items():
    print('ERR', e, len(cells), cells[:15])
def g(sh, ad): return calc.get((sh.upper(), ad))
# Годы sheet rows — найдём ключевые строки по меткам? берём фиксированные адреса из генератора
print('--- Checks sheet results')
for r in range(2,9):
    print(' ', g('CHECKS','B%d'%r))
print('--- Годы: гости/день модель B..F и выручка/день')
# строки из генератора: gmodel_r, rmod_r — определим по labels
