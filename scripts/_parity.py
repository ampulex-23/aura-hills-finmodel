# Паритет: пересчёт model.xlsx через formulas vs кешированные значения движка (ExcelJS result)
import sys, re, math, datetime
import formulas
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter, column_index_from_string

EPOCH = datetime.datetime(1899, 12, 30)
def excel_serial(dt):
    return (dt - EPOCH).total_seconds() / 86400.0

PATH = sys.argv[1] if len(sys.argv) > 1 else 'out/model.xlsx'
TOL_REL, TOL_ABS = 1e-4, 1.0

wbv = load_workbook(PATH, data_only=True)   # кеш движка
xl = formulas.ExcelModel().loads(PATH).finish()
sol = xl.calculate()

book = PATH.split('/')[-1].split('\\')[-1]
key_re = re.compile(r"^'\[" + re.escape(book) + r"\]([^']+)'!(\$?[A-Z]+\$?\d+)$")

calc = {}
for k, v in sol.items():
    m = key_re.match(k)
    if not m:
        continue
    sheet, addr = m.group(1), m.group(2).replace('$', '')
    try:
        val = v.value[0, 0]
    except Exception:
        try:
            val = v.value
        except Exception:
            continue
    calc[(sheet, addr)] = val

ok, diffs, ferrs = 0, [], {}
for ws in wbv.worksheets:
    name = ws.title.upper()
    for row in ws.iter_rows():
        for c in row:
            exp = c.value
            if exp is None:
                continue
            hv = calc.get((name, c.coordinate))
            if hv is None:
                continue
            if hasattr(hv, 'value') and not isinstance(hv, (int, float, str, bool)):
                hv = getattr(hv, 'value', hv)
            s = str(hv)
            if s.startswith('#'):
                ferrs[s] = ferrs.get(s, 0) + 1
                diffs.append((f'{ws.title}!{c.coordinate}', s, exp))
                continue
            if isinstance(exp, datetime.datetime):
                exp = excel_serial(exp)
            if isinstance(exp, (int, float)) and not isinstance(exp, bool):
                try:
                    num = float(hv)
                except Exception:
                    diffs.append((f'{ws.title}!{c.coordinate}', hv, exp))
                    continue
                if abs(num - exp) <= max(TOL_ABS, abs(exp) * TOL_REL):
                    ok += 1
                else:
                    diffs.append((f'{ws.title}!{c.coordinate}', num, exp))
            elif str(hv) == str(exp) or (hasattr(hv, 'value') and str(getattr(hv, 'value', '')) == str(exp)):
                ok += 1
            else:
                diffs.append((f'{ws.title}!{c.coordinate}', hv, exp))

out = [f'OK: {ok} / {ok + len(diffs)}']
if ferrs:
    out.append('formula errors: ' + repr(dict(sorted(ferrs.items(), key=lambda x: -x[1]))))
for addr, hv, exp in diffs[:200]:
    out.append(f'DIFF {addr}: calc={hv!r} engine={exp!r}')
if len(diffs) > 200:
    out.append(f'...ещё {len(diffs) - 200}')
open('out/_parity-diffs.txt', 'w', encoding='utf-8').write('\n'.join(out))
print(out[0])
print('diffs ->', 'out/_parity-diffs.txt')

# probes: что пересчитал движок в ключевых точках
probes = [('НАЛОГИ', 'AN11'), ('НАЛОГИ', 'AN12'), ('НАЛОГИ', 'AN9'), ('НАЛОГИ', 'AN10'),
          ('CAPEX', 'E456'), ('CAPEX', 'E457'), ('CAPEX', 'F456'), ('CAPEX', 'F457'),
          ('ДОПУЩЕНИЯ', 'B108'), ('ДОПУЩЕНИЯ', 'B129'), ('ДРАЙВЕРЫ', 'AN3'), ('ДРАЙВЕРЫ', 'AN5')]
lines = []
for sh, ad in probes:
    hv = calc.get((sh, ad))
    exp = wbv[sh.title() if False else sh.capitalize()] if False else None
    lines.append(f'{sh}!{ad} = {hv!r}')
open('out/_parity-probes.txt', 'w', encoding='utf-8').write('\n'.join(lines))
