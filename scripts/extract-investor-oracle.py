"""Снимок расчёта инвестора «СПА Авдиму — 30 клиентов» в JSON-эталон.

Одноразовый инструмент: читает КЭШИРОВАННЫЕ значения формул xlsx (как их
сохранил Excel инвестора) и раскладывает строки по месяцам 07.2026–12.2034.
Нужен openpyxl:  python scripts/extract-investor-oracle.py <xlsx> [out.json]
"""
import json
import sys

import openpyxl

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else "tests/oracle/investor-avdimou.json"
wb = openpyxl.load_workbook(src, data_only=True)
main, revs, fot, opex = (wb[n] for n in ("СПА-ИНВ РАСЧЕТ", "Выручка база", "ФОТ", "OPEX"))

FIRST, LAST = 6, 107  # F..DC главного листа: 07.2026..12.2034
OPS0 = 21             # колонка первого операционного месяца (10.2027)
num = lambda v: float(v) if isinstance(v, (int, float)) else 0.0
row = lambda ws, r, shift=0: [num(ws.cell(r, c + shift).value) for c in range(FIRST, LAST + 1)]
# «Выручка база» сдвинута: её колонка F — это 10.2027 (главный лист, колонка U)
rev = lambda r: [0.0] * (OPS0 - FIRST) + [num(revs.cell(r, c).value) for c in range(6, 6 + LAST - OPS0 + 1)]

months = []
for i in range(LAST - FIRST + 1):
    t = 2026 * 12 + 6 + i
    months.append(f"{t // 12}-{t % 12 + 1:02d}")

MAIN = {
    "land": 14, "landLegal": 15, "landAgent": 16, "construction": 17, "smr1": 18, "smr2": 19,
    "stateFees": 20, "solar": 21, "approvals": 22, "design": 23, "supervision": 24, "contingency": 25,
    "projectOffice": 27, "fixedCore": 28, "row29": 29, "maintenance": 30, "insurance": 31, "it": 32,
    "fot": 33, "marketing": 34, "taxDepr": 35, "notionalInterest": 36, "expensesTotal": 37,
    "revenueGross": 40, "revenueNet": 42, "investments": 43, "variable": 46, "cit": 52,
    "profitBeforeFee": 53, "mgmtFee": 54, "netProfit": 55, "vat": 59, "cfExpenses": 60,
    "row62": 62, "cashFlow": 64, "cashCum": 65,
}
data = {
    "source": src.replace("\\", "/").split("/")[-1],
    "months": months,
    "opsStartIndex": OPS0 - FIRST,
    "labels": {k: str(main.cell(r, 3).value or "").strip() for k, r in MAIN.items()},
    "rows": {k: row(main, r) for k, r in MAIN.items()},
    "revenue": {
        "days": rev(11), "priceIndex": rev(8), "costIndex": rev(19),
        "guestsPerDayP1": rev(13), "guestsPerDayP2": rev(15),
        "revenueP1": rev(12), "revenueP2": rev(14), "revenueTotal": rev(16),
        "cogsSteam": rev(22), "cogsMassage": rev(24), "cogsRental": rev(26), "cogsTotal": rev(27),
    },
    "fot": {
        "salariesBase": row(fot, 26), "salaries": row(fot, 27), "guests": row(fot, 28),
        "bonusSteam": row(fot, 29), "bonusMassage": row(fot, 30), "gross": row(fot, 32),
        "contrib": row(fot, 33), "total": row(fot, 34),
    },
    "opex": {"index": row(opex, 4), "phase2Mult": row(opex, 5), "fixedPlusIt": row(opex, 23), "marketing": row(opex, 25)},
    "totals": {k: num(main.cell(r, 5).value) for k, r in {
        "revenueGross": 41, "revenueNet": 42, "expenses": 37, "cit": 52, "mgmtFee": 54,
        "netProfit": 55, "vat": 59, "cashEnd": 65, "fundingNeed": 78, "paybackMonths": 80,
        "avgProfitAfterPayback": 82,
    }.items()},
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
print(out, len(months), "мес")
