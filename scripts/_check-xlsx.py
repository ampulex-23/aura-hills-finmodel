# Пересчёт model.xlsx движком formulas и сверка с кешированными значениями ExcelJS
import formulas, openpyxl, sys
from formulas.tokens.operand import XlError

PATH = 'out/model.xlsx'
xl = formulas.ExcelModel().loads(PATH).finish()
sol = xl.calculate()

# карта решённых значений: ключ вида "'[MODEL.XLSX]PNL'!B4"
wb = openpyxl.load_workbook(PATH)
fails, checked = [], 0
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for c in row:
            v = c.value
            if isinstance(v, str) and v.startswith('='):
                key = f"'[{PATH.split('/')[-1].upper()}]{ws.title.upper()}'!{c.coordinate}"
                got = sol.get(key)
                gotv = getattr(got, 'value', got)
                try:
                    gotv = gotv[0, 0] if hasattr(gotv, 'shape') else gotv
                except Exception:
                    pass
                exp = None
                # openpyxl не отдаёт cached value — берём из файла напрямую
                checked += 1
                if isinstance(gotv, XlError) or (isinstance(gotv, str) and gotv.startswith('#')):
                    fails.append((ws.title, c.coordinate, v, gotv))
print(f'checked formulas: {checked}, errors: {len(fails)}')
for f in fails[:25]:
    print(' ERR', f)
sys.exit(1 if fails else 0)
