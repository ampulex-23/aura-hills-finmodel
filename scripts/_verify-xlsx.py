# Сверка пересчитанных формул против эталонных значений ядра
import formulas, openpyxl, json, sys
sys.stdout.reconfigure(encoding='utf-8')

PATH = 'out/model.xlsx'
xl = formulas.ExcelModel().loads(PATH).finish()
sol = xl.calculate()
BK = PATH.split('/')[-1].upper()

def val(sheet, addr):
    k = f"'[model.xlsx]{sheet.upper()}'!{addr}"
    v = sol.get(k)
    v = getattr(v, 'value', v)
    try:
        while hasattr(v, 'shape') or isinstance(v, (list, tuple)):
            v = v[0, 0] if hasattr(v, 'shape') else v[0]
    except Exception:
        pass
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

wb = openpyxl.load_workbook(PATH)
checks = wb['Checks']
bad = 0
for row in checks.iter_rows(min_row=2, max_row=7):
    name, _, expect, _ = [c.value for c in row[:4]]
    got = val('Checks', f'D{row[0].row}')
    ok = got is not None and abs(got - expect) < 1
    print(f'{"OK " if ok else "FAIL"} {name}: expect {expect:,.0f} recalc {got if got is not None else "None"}')
    bad += 0 if ok else 1

sys.exit(bad)
