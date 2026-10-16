#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Разовая ТЗ-книга «Новая модель AURA HILLS — первая очередь».
Отдельный простой Excel, структура листов — ровно по разделам ТЗ,
формулы — по семантике движка src/model. Входы — синие, формулы — чёрные.
Запуск:  python scripts/_gen-tz-simple.py  ->  out/aura-hills-tz-simple.xlsx
"""
import json
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

# Источник данных: по умолчанию дефолты репо; можно передать каталог
# с сохранённой версией (params.json/nomenclature.json/services.json),
# напр. выгрузку из git-версионирования DATA_DIR сервера.
DATA_DIR = sys.argv[1] if len(sys.argv) > 1 else 'src/data'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'out/aura-hills-tz-simple.xlsx'

P = json.load(open(f'{DATA_DIR}/params.json', encoding='utf-8'))
ITEMS = json.load(open(f'{DATA_DIR}/nomenclature.json', encoding='utf-8'))
SERVICES = json.load(open(f'{DATA_DIR}/services.json', encoding='utf-8'))['services']
ITEMS = ITEMS['items'] if isinstance(ITEMS, dict) else ITEMS
BYC = {i['code']: i for i in ITEMS}

NMON = 60                      # 5 опер. лет горизонта книги (ТЗ)
OPEN_Y, OPEN_M = map(int, P['meta']['openingDate'].split('-')[:2])  # дата открытия из данных

def ops_month(from_ym: str) -> int:
    """Операционный месяц календарной даты (1 = первый месяц работы)."""
    y, m = map(int, from_ym.split('-'))
    return (y - OPEN_Y) * 12 + (m - OPEN_M) + 1

_ph = P['fot'].get('phases') or []
P2_LAUNCH_M = ops_month(_ph[1]['from']) if len(_ph) > 1 else 10**6  # старт оч.2 = фаза персонала оч.2
MONTHS_RU = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']

F_IN   = Font(name='Arial', size=10, color='0000CC')
F_CALC = Font(name='Arial', size=10, color='000000')
F_HDR  = Font(name='Arial', size=11, bold=True, color='FFFFFF')
F_SEC  = Font(name='Arial', size=10, bold=True, color='1F4E79')
F_LBL  = Font(name='Arial', size=10)
F_BOLD = Font(name='Arial', size=10, bold=True)
F_NOTE = Font(name='Arial', size=9, italic=True, color='808080')
FILL_H = PatternFill('solid', fgColor='1F4E79')
FILL_I = PatternFill('solid', fgColor='FFF7DC')
FILL_T = PatternFill('solid', fgColor='E8F0E8')
THIN   = Border(bottom=Side(style='thin', color='C0C0C0'))

wb = Workbook()
wb.calculation.fullCalcOnLoad = True

def sheet(name, tab=None):
    ws = wb.create_sheet(name)
    if tab: ws.sheet_properties.tabColor = tab
    return ws

def put(ws, r, c, v, font=None, fill=None, fmt=None, border=True):
    cell = ws.cell(row=r, column=c, value=v)
    cell.font = font or F_LBL
    if fill: cell.fill = fill
    if fmt: cell.number_format = fmt
    if border: cell.border = THIN
    return cell

def inp(ws, r, c, v, fmt='#,##0.00'):
    return put(ws, r, c, v, font=F_IN, fill=FILL_I, fmt=fmt)

def fx(ws, r, c, formula, fmt='#,##0.00', font=None, fill=None):
    return put(ws, r, c, formula, font=font or F_CALC, fill=fill, fmt=fmt)

def sec(ws, r, title):
    put(ws, r, 1, title, font=F_SEC, border=False); return r + 1

def hdr(ws, r, c, title):
    put(ws, r, c, title, font=F_HDR, fill=FILL_H)

E = '#,##0'
PC = '0.0%'

ADDR = {}
def A(name, sh, r, c):
    ADDR[name] = f"'{sh}'!${get_column_letter(c)}${r}"
    return ADDR[name]

# ======================================================================
# ДОПУЩЕНИЯ
# ======================================================================
D = sheet('Допущения', '4472C4')
D.column_dimensions['A'].width = 48
for col in 'BCDEFGH': D.column_dimensions[col].width = 13
r = 1
put(D, r, 1, 'ДОПУЩЕНИЯ — новая модель AURA HILLS (первая очередь)', font=Font(name='Arial', size=13, bold=True), border=False); r += 2

r = sec(D, r, 'Общие')
put(D, r, 1, 'Валюта');                                     inp(D, r, 2, 'EUR', 'General'); r += 1
put(D, r, 1, 'Начало строительства');                       A('cstart', 'Допущения', r, 2); inp(D, r, 2, '2027-01-01', 'General'); r += 1
put(D, r, 1, 'Строительство, мес');                         A('capM', 'Допущения', r, 2); inp(D, r, 2, 9, '0'); r += 1
put(D, r, 1, 'Горизонт операционной модели, мес');          inp(D, r, 2, NMON, '0'); r += 1
put(D, r, 1, 'Инфляция, в год');                            A('infl', 'Допущения', r, 2); inp(D, r, 2, P['general']['inflation'], PC); r += 1
put(D, r, 1, 'WACC');                                       inp(D, r, 2, P['general']['wacc'], PC); r += 1
put(D, r, 1, 'Очередь 2 в расчёте P&L (Да/Нет)');           A('p2scope', 'Допущения', r, 2)
inp(D, r, 2, 'Нет', 'General')
put(D, r, 3, 'настройки оч.2 сохранены ниже; «Нет» — расчёт только первой очереди (ТЗ §1)', font=F_NOTE); r += 2

r = sec(D, r, 'Режимы')
put(D, r, 1, 'Пакетный режим продаж');                      inp(D, r, 2, P['meta']['mode'], 'General'); r += 1
put(D, r, 1, 'Режим НДС');                                  inp(D, r, 2, P['meta']['vatMode'], 'General'); r += 2

r = sec(D, r, 'Налоги и взносы')
tx = P['taxes']
for lbl, key, val in [('НДС на выручку', 'vatStd', tx['vatStd']), ('Входной НДС', 'vatInput', tx['vatInput']),
                      ('CIT (налог на прибыль)', 'cit', tx['cit']),
                      ('Взносы работодателя с ФОТ', 'employerRate', tx['employerRate']),
                      ('SDC на дивиденды', 'sdc', tx['sdc']),
                      ('GESY на дивиденды', 'gesy', tx['gesy'])]:
    put(D, r, 1, lbl); A(key, 'Допущения', r, 2); inp(D, r, 2, val, PC); r += 1
put(D, r, 1, 'GESY — потолок базы, €/год');                 inp(D, r, 2, tx['gesyCap'], E); r += 2

r = sec(D, r, 'Распределение прибыли')
hdr(D, r, 2, 'Доля'); hdr(D, r, 3, 'Статус'); r += 1
pt = P['partners']
for i in range(3):
    put(D, r, 1, pt['names'][i]); A(f'pshare{i}', 'Допущения', r, 2)
    inp(D, r, 2, pt['shares'][i], PC); inp(D, r, 3, pt['statuses'][i], 'General'); r += 1
put(D, r, 1, 'Управленческая компания');                    A('pmgmt', 'Допущения', r, 2); inp(D, r, 2, pt['corporate']['mgmt'], PC); r += 1
put(D, r, 1, 'Резерв');                                     A('pres', 'Допущения', r, 2); inp(D, r, 2, pt['corporate']['reserve'], PC); r += 1
put(D, r, 1, 'SDC применяется к дивидендам (статус резидента Кипра — по флагу)', font=F_NOTE, border=False); r += 2

r = sec(D, r, 'Прочий OPEX (фикс, €/мес — до индексации)')
hdr(D, r, 1, 'Статья'); hdr(D, r, 2, '€/мес'); hdr(D, r, 3, 'Энерго-связь'); r += 1
opex_addr = []
for x in P['opexFixed']:
    if x['name'] in ('Маркетинг и реклама', 'Бухгалтерия / юрист', 'Обслуживание модулей'):
        continue
    put(D, r, 1, x['name'])
    A('ox_' + x['name'], 'Допущения', r, 2)
    inp(D, r, 2, x['base'], E)
    put(D, r, 3, 'да' if x.get('energy') else '', font=F_LBL)
    opex_addr.append((x['name'], ADDR['ox_' + x['name']], bool(x.get('energy'))))
    r += 1
accjur = next((x['base'] for x in P['opexFixed'] if x['name'] == 'Бухгалтерия / юрист'), 400)
put(D, r, 1, 'Бухгалтерия');   A('ox_acc', 'Допущения', r, 2); inp(D, r, 2, accjur / 2, E); r += 1
put(D, r, 1, 'Юридические услуги');  A('ox_legal', 'Допущения', r, 2); inp(D, r, 2, accjur / 2, E)
put(D, r, 3, 'ТЗ §2.4 — отдельное редактируемое поле', font=F_NOTE); r += 1
put(D, r, 1, f'(в действующей модели «Бухгалтерия / юрист» = {accjur:g} €/мес единой статьёй)', font=F_NOTE, border=False); r += 1
ox_mod_base = next((x['base'] for x in P['opexFixed'] if x['name'] == 'Обслуживание модулей'), 100)
put(D, r, 1, 'Обслуживание модулей, €/мес за модуль');      A('ox_mod', 'Допущения', r, 2); inp(D, r, 2, ox_mod_base, E); r += 1
put(D, r, 1, 'IT-расходы, €/мес (сумма 7 статей модели)');  A('ox_it', 'Допущения', r, 2); inp(D, r, 2, sum(x['base'] for x in P['it']['opex']), E); r += 1
put(D, r, 1, 'Состав IT: ' + ', '.join(f"{x['name']} {x['base']}€" for x in P['it']['opex']), font=F_NOTE, border=False); r += 2

r = sec(D, r, 'Маркетинг и страхование')
mkt_item = next((x for x in P['opexFixed'] if x['name'] == 'Маркетинг и реклама'), {})
put(D, r, 1, 'Маркетинг — % от выручки');                   A('mkt_pct', 'Допущения', r, 2); inp(D, r, 2, mkt_item.get('pctOfRevenue', 0), PC); r += 1
put(D, r, 1, 'Страхование — % от выручки (доп.)');         A('ins_pct', 'Допущения', r, 2); inp(D, r, 2, 0, PC); r += 1
put(D, r, 1, 'Фиксированный маркетинг по периодам (ТЗ §2.4):', font=F_SEC, border=False); r += 1
hdr(D, r, 1, 'Период'); hdr(D, r, 2, '€/мес'); hdr(D, r, 3, 'Мес. начала'); hdr(D, r, 4, 'Мес. окончания'); r += 1
mkt_rows = []
for i, (amt, s1, s2) in enumerate([(mkt_item.get('base', 0), 1, NMON), (0, 0, 0), (0, 0, 0)]):
    put(D, r, 1, f'Период {i+1}')
    inp(D, r, 2, amt, E); inp(D, r, 3, s1, '0'); inp(D, r, 4, s2, '0')
    mkt_rows.append(r); r += 1
put(D, r, 1, f"Месяц — операционный (1 = первый месяц работы). В действующей модели фикс-маркетинг {mkt_item.get('base', 0):g} €/мес постоянно; по ТЗ задаётся периодами.", font=F_NOTE, border=False); r += 2

r = sec(D, r, 'Прачечная (справочно — входит в спецификации NC-159/NC-210, дублирования нет)')
put(D, r, 1, 'Стирка гостевого набора, €/цикл');            inp(D, r, 2, 4.99, '#,##0.00'); r += 1
put(D, r, 1, 'Стирка процедурного набора, €/цикл');         inp(D, r, 2, 1.50, '#,##0.00'); r += 2

r = sec(D, r, 'Земля')
put(D, r, 1, 'Режим (owned / lease / purchase)');           A('landmode', 'Допущения', r, 2); inp(D, r, 2, P['land']['mode'], 'General'); r += 1
put(D, r, 1, 'Покупка участка, €');                         A('landcost', 'Допущения', r, 2); inp(D, r, 2, P['land']['purchaseCost'], E); r += 1
put(D, r, 1, 'Аренда участка, €/мес');                      A('landrent', 'Допущения', r, 2); inp(D, r, 2, P['land']['rentMonthly'], E); r += 2

r = sec(D, r, 'Сезонность (бани), среднее = 1')
seas_row = r
for i, v in enumerate(P['seasonality']['baths']):
    put(D, r, 1, MONTHS_RU[i]); inp(D, r, 2, v, '0.0000'); r += 1
put(D, r, 1, 'Среднее'); fx(D, r, 2, f'=AVERAGE(B{seas_row}:B{seas_row+11})', '0.0000'); r += 2

r = sec(D, r, 'Модули бань. Очереди')
hdr(D, r, 1, 'Модуль'); hdr(D, r, 2, 'Очер.'); hdr(D, r, 3, 'Вмест-ть'); hdr(D, r, 4, 'Слот./день')
hdr(D, r, 5, 'Uptime'); hdr(D, r, 6, 'Цена сессии, €'); hdr(D, r, 7, 'Запуск'); hdr(D, r, 8, 'Статус'); r += 1
mod_r0 = r
for m in P['modules']:
    price = round(sum(m['prices']) / len(m['prices'])) if m.get('prices') else m['capacity'] * 100
    put(D, r, 1, f"Модуль {m['id']}")
    inp(D, r, 2, m.get('phase') or 1, '0'); inp(D, r, 3, m['capacity'], '0')
    inp(D, r, 4, m['slotsPerDay'], '0'); inp(D, r, 5, m['uptime'], '0%')
    inp(D, r, 6, price, E); inp(D, r, 7, m['launchDate'][:7], 'General')
    inp(D, r, 8, m.get('status', 'Активен'), 'General')
    r += 1
mod_r1 = r - 1
put(D, r, 1, 'Цена сессии — средняя из prices действующей модели (оч.1: 1200 € за юнит = 100 €/гость × 12). В расчёт входят только «Активен» (как в движке).', font=F_NOTE, border=False); r += 1
put(D, r, 1, 'Ёмкость оч.1, гостей/день (Σ слоты×uptime×мест)'); A('capday1', 'Допущения', r, 2)
fx(D, r, 2, f"=SUMPRODUCT(($B{mod_r0}:$B{mod_r1}=1)*($H{mod_r0}:$H{mod_r1}=\"Активен\")*$C{mod_r0}:$C{mod_r1}*$D{mod_r0}:$D{mod_r1}*$E{mod_r0}:$E{mod_r1})", '0.0'); r += 1
put(D, r, 1, 'Ёмкость оч.2, гостей/день');                  A('capday2', 'Допущения', r, 2)
fx(D, r, 2, f"=SUMPRODUCT(($B{mod_r0}:$B{mod_r1}=2)*($H{mod_r0}:$H{mod_r1}=\"Активен\")*$C{mod_r0}:$C{mod_r1}*$D{mod_r0}:$D{mod_r1}*$E{mod_r0}:$E{mod_r1})", '0.0'); r += 1
put(D, r, 1, 'Средняя цена гостя оч.2, €');                 A('avgp2', 'Допущения', r, 2)
fx(D, r, 2, f"=IFERROR(SUMPRODUCT(($B{mod_r0}:$B{mod_r1}=2)*($H{mod_r0}:$H{mod_r1}=\"Активен\")*$C{mod_r0}:$C{mod_r1}*$F{mod_r0}:$F{mod_r1})/SUMPRODUCT(($B{mod_r0}:$B{mod_r1}=2)*($H{mod_r0}:$H{mod_r1}=\"Активен\")*$C{mod_r0}:$C{mod_r1}),0)", '0.0'); r += 2

# эталон для Checks: ёмкость оч.1 по активным модулям (семантика движка)
cap1_expected = sum(m['capacity'] * m['slotsPerDay'] * m['uptime']
                    for m in P['modules'] if (m.get('phase') or 1) == 1 and m.get('status') == 'Активен')

r = sec(D, r, 'Очередь 2: стройка и финансирование')
q2 = P['phase2']
put(D, r, 1, 'Начало стройки оч.2');                        inp(D, r, 2, q2['constructionStart'], 'General'); r += 1
put(D, r, 1, 'Длительность стройки, мес');                  A('q2months', 'Допущения', r, 2); inp(D, r, 2, q2['months'], '0'); r += 1
put(D, r, 1, 'Корректировка CAPEX оч.2');                   A('q2adj', 'Допущения', r, 2); inp(D, r, 2, q2['capexAdj'], PC); r += 1
put(D, r, 1, 'CAPEX оч.2, € (по модели)');                  A('q2eur', 'Допущения', r, 2); inp(D, r, 2, 1502950, E); r += 1
put(D, r, 1, 'Финансирование (ops = из операц. потока)');   inp(D, r, 2, q2['funding'], 'General'); r += 2

r = sec(D, r, 'Общественный банный комплекс — очередь 2')
pb = P['publicBath']
put(D, r, 1, 'Включена в модель (0/1)');                    A('pb_on', 'Допущения', r, 2); inp(D, r, 2, 1 if pb.get('enabled') else 0, '0'); r += 1
put(D, r, 1, 'Билет, €');                                   A('pb_tick', 'Допущения', r, 2); inp(D, r, 2, pb['ticketEur'], E); r += 1
put(D, r, 1, 'Вместимость, чел/день');                      A('pb_cap', 'Допущения', r, 2); inp(D, r, 2, pb['capacity'], '0'); r += 1
put(D, r, 1, 'Запуск (год-месяц)');                         inp(D, r, 2, pb['launchDate'], 'General'); r += 1
put(D, r, 1, 'Траты на услуги на визит, €');                A('pb_svc', 'Допущения', r, 2); inp(D, r, 2, pb['serviceSpendPerVisit'], E); r += 1
put(D, r, 1, 'Загрузка по годам работы (доля вместимости)')
pb_load_row = r + 1; r += 1
for i, v in enumerate([0.35, 0.45, 0.55, 0.60, 0.65]):
    put(D, r, 1, f'  год {i+1}'); inp(D, r, 2, v, '0%'); r += 1
r += 1

r = sec(D, r, 'Депозит / кошелёк услуг')
put(D, r, 1, 'База кошелька (депозит на юнит), €');         inp(D, r, 2, P['deposit']['base'], E); r += 1
put(D, r, 1, 'Парение, база кошелька €');                   inp(D, r, 2, P['deposit']['steamBase'], E); r += 1
put(D, r, 1, 'Массаж, база кошелька €');                    inp(D, r, 2, P['deposit'].get('massageBase', 60), E)
put(D, r, 3, 'база кошелька ≠ розничный прайс (120 € — см. «Цены услуг»)', font=F_NOTE); r += 1
put(D, r, 1, 'Политика депозита');                          inp(D, r, 2, P['deposit']['policy'], 'General'); r += 2

r = sec(D, r, 'Амортизация')
put(D, r, 1, 'Амортизация доли — 40 лет (НА СОГЛАСОВАНИИ — ТЗ §2.3, логика не меняется)')
inp(D, r, 2, 'Сохранить', 'General'); r += 1
hdr(D, r, 1, 'Группа'); hdr(D, r, 2, 'Доля'); hdr(D, r, 3, 'Срок, лет'); r += 1
am_rows = []
for g, sh_, yr in zip(P['amort']['groups'], P['amort']['shares'], P['amort']['years']):
    put(D, r, 1, g); inp(D, r, 2, sh_, '0%'); inp(D, r, 3, yr, '0'); am_rows.append(r); r += 1
r += 1

r = sec(D, r, 'CAPEX первой очереди (итог действующей модели)')
put(D, r, 1, 'CAPEX оч.1 (модули, наполнение, IT, номенклатура), €'); A('capex1', 'Допущения', r, 2)
inp(D, r, 2, 1641175, E); put(D, r, 3, 'итог computeCapex действующей модели', font=F_NOTE); r += 1
put(D, r, 1, 'S-кривая стройки (9 весов, Σ=1)')
scurve_row = r + 1; r += 1
for i, w_ in enumerate(P['capexSCurve']):
    put(D, r, 1, f'  мес {i+1}'); inp(D, r, 2, w_, '0.00'); r += 1
r += 1

r = sec(D, r, 'Цены услуг первого года (ТЗ §6 — из спецификаций действующей модели)')
_svc = {s.get('direction', ''): s for s in SERVICES}
_rent = next((s for s in SERVICES if 'Аренда' in s.get('direction', '')), None)
_steam = next((s for s in SERVICES if 'Парен' in s.get('direction', '')), None)
_mass = next((s for s in SERVICES if 'Массаж' in s.get('direction', '')), None)
put(D, r, 1, 'Аренда банного комплекса, €/гость');          A('p_rent', 'Допущения', r, 2)
inp(D, r, 2, round((_rent['price'] if _rent else 1200) / (_rent.get('capacity', 12) if _rent else 12), 2), E)
put(D, r, 3, f"цена спеки {_rent['code'] if _rent else '—'} ÷ гостей в единице", font=F_NOTE); r += 1
put(D, r, 1, 'Парение, €/гость');                           A('p_steam', 'Допущения', r, 2)
inp(D, r, 2, _steam['price'] if _steam else 100, E)
put(D, r, 3, f"цена спеки {_steam['code'] if _steam else '—'} (расчётная единица — 1 гость)", font=F_NOTE); r += 1
put(D, r, 1, 'Массаж, €/процедуру');                        A('p_mass', 'Допущения', r, 2)
inp(D, r, 2, _mass['price'] if _mass else 120, E)
put(D, r, 3, f"цена спеки {_mass['code'] if _mass else '—'}", font=F_NOTE); r += 1

D.freeze_panes = 'A3'

# ======================================================================
# СЦЕНАРИИ
# ======================================================================
S = sheet('Сценарии', '70AD47')
S.column_dimensions['A'].width = 46
for col in 'BCD': S.column_dimensions[col].width = 14
r = 1
put(S, r, 1, 'СЦЕНАРИИ', font=Font(name='Arial', size=13, bold=True), border=False); r += 1
put(S, r, 1, 'Активный сценарий (1=Conservative, 2=Base, 3=Aggressive)')
A('scen', 'Сценарии', r, 2); inp(S, r, 2, 2, '0'); r += 2

r = sec(S, r, 'Посещаемость: гостей/день всего по 3 комплексам (ТЗ §7)')
hdr(S, r, 1, 'Опер. год'); hdr(S, r, 2, 'Conservative'); hdr(S, r, 3, 'Base'); hdr(S, r, 4, 'Aggressive'); r += 1
guest_row0 = r
base_guests = [12, 16, 20, 30, 35]
for i, g in enumerate(base_guests):
    put(S, r, 1, f'Год {i+1}')
    fx(S, r, 2, f'=$C{r}*$B$11', '0.0')
    inp(S, r, 3, g, '0.0')
    fx(S, r, 4, f'=$C{r}*$B$12', '0.0')
    r += 1
put(S, r, 1, 'Множитель спроса Conservative');  inp(S, r, 2, 0.85, '0.00'); r += 1
put(S, r, 1, 'Множитель спроса Aggressive');    inp(S, r, 2, 1.15, '0.00'); r += 1
put(S, r, 1, 'Загрузка = гости/день ÷ ёмкость модулей — формула движка (слоты×uptime×мест×загрузка)', font=F_NOTE, border=False); r += 1
put(S, r, 1, 'Загрузка аренды, активный сценарий')
load_row0 = r + 1; r += 1
for i in range(5):
    put(S, r, 1, f'Год {i+1}')
    fx(S, r, 2, f"=MIN(1,INDEX($B{guest_row0}:$D{guest_row0+4},{i+1},{ADDR['scen']})/{ADDR['capday1']})", '0.000')
    r += 1
r += 1

r = sec(S, r, 'Загрузка услуг (коэффициент на гостя)')
put(S, r, 1, 'Парений на гостя');  A('k_steam', 'Сценарии', r, 2); inp(S, r, 2, 1.0, '0.00'); r += 1
put(S, r, 1, 'Массажей на гостя'); A('k_mass', 'Сценарии', r, 2); inp(S, r, 2, 0.5, '0.00')
put(S, r, 3, '0,5 — один массаж на двух гостей в среднем (ТЗ §6)', font=F_NOTE); r += 2

r = sec(S, r, 'Прочие сценарные оси (ТЗ §3 — ресторан и месячное членство исключены)')
put(S, r, 1, 'Рост цен, в год');                    A('pgrow', 'Сценарии', r, 2); inp(S, r, 2, 0, PC)
put(S, r, 3, 'контрольная выручка ТЗ — при неизменных ценах', font=F_NOTE); r += 1
put(S, r, 1, 'Корректировка CAPEX');                A('cadj', 'Сценарии', r, 2); inp(S, r, 2, 0.10, PC); r += 1
put(S, r, 1, 'Выход на план, мес');                 A('rampM', 'Сценарии', r, 2); inp(S, r, 2, 1, '0')
put(S, r, 3, 'посещаемость задана напрямую — выход мгновенный', font=F_NOTE); r += 1
put(S, r, 1, 'Доля реализации услуг (пакетный режим)'); inp(S, r, 2, 0.30, PC); r += 1
put(S, r, 1, 'Задержка строительства, мес');        A('delay', 'Сценарии', r, 2); inp(S, r, 2, 1, '0'); r += 1
put(S, r, 1, 'Множитель энергозатрат');             A('energ', 'Сценарии', r, 2); inp(S, r, 2, 1.0, '0.00'); r += 1
S.freeze_panes = 'A3'

# ======================================================================
# СПЕКИ
# ======================================================================
SP = sheet('Спеки', 'ED7D31')
SP.column_dimensions['A'].width = 12
SP.column_dimensions['B'].width = 52
for col in 'CDE': SP.column_dimensions[col].width = 12
SP.column_dimensions['F'].width = 14
r = 1
put(SP, r, 1, 'НОМЕНКЛАТУРА И СПЕЦИФИКАЦИИ (ТЗ §5)', font=Font(name='Arial', size=13, bold=True), border=False); r += 1
put(SP, r, 1, 'Разделение OPEX/CAPEX/спецификации — по флагу use номенклатуры действующей модели. Трудовые доли — в ФОТ, не в OPEX.', font=F_NOTE, border=False); r += 2

spec_use = [(s['code'], s.get('name') or s['code']) for s in SERVICES]
spec_dir = {s['code']: s.get('direction', '') for s in SERVICES}
spec_tot = {}
labor_map = {}
for code, title in spec_use:
    sp = next(x for x in SERVICES if x['code'] == code)
    put(SP, r, 1, f'{code} — {title}', font=F_SEC, border=False); r += 1
    hdr(SP, r, 1, 'Код'); hdr(SP, r, 2, 'Позиция'); hdr(SP, r, 3, 'Ед.'); hdr(SP, r, 4, 'Кол-во'); hdr(SP, r, 5, 'Цена €'); hdr(SP, r, 6, 'Сумма €'); r += 1
    m0 = r
    for it in sp['items']:
        if it['kind'] == 'labor':
            labor_map.setdefault(code, []).append((it['role'], it.get('pct', 0))); continue
        nc = BYC[it['code']]
        put(SP, r, 1, it['code']); put(SP, r, 2, nc['name']); put(SP, r, 3, nc.get('unit', 'шт'))
        inp(SP, r, 4, it['qty'], '0.000'); inp(SP, r, 5, nc.get('priceEur', nc.get('price', 0)), '#,##0.00')
        fx(SP, r, 6, f'=D{r}*E{r}', '#,##0.00'); r += 1
    put(SP, r, 2, f'Итого материалы {code}'); fx(SP, r, 6, f'=SUM(F{m0}:F{r-1})', '#,##0.00', fill=FILL_T)
    spec_tot[code] = f'$F${r}'; r += 1
    lab = ', '.join(f"{l[0]} {l[1]:.0%}" for l in labor_map.get(code, [])) or '—'
    put(SP, r, 2, f'Трудовая доля: {lab} цены услуги — в ФОТ (бонусы)', font=F_NOTE, border=False); r += 2

r = sec(SP, r, 'Производные себестоимости')
rent_codes = [c for c in spec_tot if 'Аренда' in spec_dir.get(c, '')]
steam_codes = [c for c in spec_tot if 'Парен' in spec_dir.get(c, '')]
mass_codes = [c for c in spec_tot if 'Массаж' in spec_dir.get(c, '')]
rent_sum = '+'.join(spec_tot[c] for c in rent_codes) or '0'
put(SP, r, 1, 'Гостей в расчётной единице спеки аренды');   A('rent_n', 'Спеки', r, 2)
inp(SP, r, 2, 12, '0'); put(SP, r, 3, 'спека аренды рассчитана на 12 гостей/день — без двойного начисления (ТЗ §5)', font=F_NOTE); r += 1
put(SP, r, 1, 'Аренда — на ГОСТЯ (Σ спек аренды ÷ гостей в единице)'); A('cogs_guest', 'Спеки', r, 2)
fx(SP, r, 2, f"=({rent_sum})/{ADDR['rent_n']}", '#,##0.00'); r += 1
put(SP, r, 1, 'Гостей на «Парение Дубль» (расчётная единица)'); A('duble_n', 'Спеки', r, 2)
inp(SP, r, 2, 1, '0'); put(SP, r, 3, 'расчёт на 1 гостя — спека списывается целиком на проданную услугу (семантика движка)', font=F_NOTE); r += 1
put(SP, r, 1, 'Парение — на проданное парение');            A('cogs_steam', 'Спеки', r, 2)
fx(SP, r, 2, '=' + ('+'.join(spec_tot[c] for c in steam_codes) or '0') + f"/{ADDR['duble_n']}", '#,##0.00'); r += 1
put(SP, r, 1, 'Массаж — на процедуру');                     A('cogs_mass', 'Спеки', r, 2)
fx(SP, r, 2, '=' + ('+'.join(spec_tot[c] for c in mass_codes) or '0'), '#,##0.00'); r += 1
put(SP, r, 1, 'Статья в OPEX: «Переменные / номенклатура» (ТЗ §5)', font=F_NOTE, border=False)

# KPI-доли ролей по направлениям — источник для листов Штат и ФОТ
role_bonus_src = {}
for code, labs in labor_map.items():
    for role, pct in labs:
        role_bonus_src.setdefault(role, []).append((spec_dir.get(code, ''), code, pct))

# ======================================================================
# ШТАТ
# ======================================================================
ST = sheet('Штат', '7030A0')
ST.column_dimensions['A'].width = 26
for col in 'BCDEFGHIJ': ST.column_dimensions[col].width = 13
r = 1
put(ST, r, 1, 'ШТАТ (ТЗ §4)', font=Font(name='Arial', size=13, bold=True), border=False); r += 2
fot = P['fot']
phases = fot.get('phases') or []
hdr(ST, r, 1, 'Должность'); hdr(ST, r, 2, 'График'); hdr(ST, r, 3, 'На смене')
hdr(ST, r, 4, 'Ставка €/мес'); hdr(ST, r, 5, 'На старте')
for j, ph in enumerate(phases):
    hdr(ST, r, 6 + j, f"с {ph['from']}{' (оч.2)' if j >= 1 else ''}")
fot_c0 = 5 + len(phases)                       # первая колонка итогов ФОТ
hdr(ST, r, fot_c0 + 1, 'ФОТ старт'); hdr(ST, r, fot_c0 + 2, 'ФОТ полный'); r += 1
role_row0 = r
sched = fot.get('schedule') or ['—'] * len(fot['roles'])
for i, role in enumerate(fot['roles']):
    put(ST, r, 1, role)
    inp(ST, r, 2, sched[i] if i < len(sched) else '—', 'General')
    fx(ST, r, 3, f'=IF(B{r}="2/2",0.5,IF(B{r}="5/2",5/7,1))', '0.00')
    inp(ST, r, 4, fot['salary'][i], E)
    inp(ST, r, 5, fot['count'][i], '0')
    for j, ph in enumerate(phases):
        inp(ST, r, 6 + j, ph['count'][i], '0')
    fx(ST, r, fot_c0 + 1, f'=E{r}*D{r}', E, fill=FILL_T)
    fx(ST, r, fot_c0 + 2, f'={get_column_letter(4 + len(phases) + 1)}{r}*D{r}', E, fill=FILL_T)
    r += 1
put(ST, r, 1, 'IT-куратор'); put(ST, r, 2, '—'); put(ST, r, 3, 1, fmt='0.00')
inp(ST, r, 4, P['it']['curator'], E); inp(ST, r, 5, 1, '0')
for j in range(len(phases)):
    inp(ST, r, 6 + j, 1, '0')
fx(ST, r, fot_c0 + 1, f'=E{r}*D{r}', E, fill=FILL_T)
fx(ST, r, fot_c0 + 2, f'={get_column_letter(5 + len(phases))}{r}*D{r}', E, fill=FILL_T)
it_row = r; r += 1
L1 = get_column_letter(fot_c0 + 1); L2 = get_column_letter(fot_c0 + 2)
put(ST, r, 1, 'ИТОГО оклады/мес', font=F_BOLD); fx(ST, r, fot_c0 + 1, f'=SUM({L1}{role_row0}:{L1}{r-1})', E, fill=FILL_T)
fx(ST, r, fot_c0 + 2, f'=SUM({L2}{role_row0}:{L2}{r-1})', E, fill=FILL_T); r += 1
put(ST, r, 1, '«Баронес» из ТЗ = должность «Бронист» в действующей модели (ТЗ §4.1 — уточнить)', font=F_NOTE, border=False); r += 1
put(ST, r, 1, 'Фазы с 2031/2032 — штат второй очереди: включаются при флаге «Очередь 2 в расчёте» = Да', font=F_NOTE, border=False); r += 1
bon_txt = '; '.join(f"{role}: " + ' + '.join(f'{pct:.0%} {d.lower()}' for d, _, pct in ts)
                    for role, ts in role_bonus_src.items())
put(ST, r, 1, f'Бонусы (KPI): {bon_txt} — помесячно на листе ФОТ', font=F_NOTE, border=False); r += 1
put(ST, r, 1, 'Взносы работодателя'); A('emp_rate', 'Штат', r, 2); inp(ST, r, 2, tx['employerRate'], PC)

# ======================================================================
# Помесячные листы
# ======================================================================
def monthly_sheet(name, color):
    ws = sheet(name, color)
    ws.column_dimensions['A'].width = 46
    for i in range(NMON):
        ws.column_dimensions[get_column_letter(2 + i)].width = 10
    put(ws, 1, 1, name.upper(), font=Font(name='Arial', size=13, bold=True), border=False)
    put(ws, 2, 1, '№ месяца'); put(ws, 3, 1, 'Месяц'); put(ws, 4, 1, 'Опер. год'); put(ws, 5, 1, 'Календ. месяц')
    for i in range(NMON):
        c = 2 + i; L = get_column_letter(c); k = i + 1
        put(ws, 2, c, k, font=F_LBL, fmt='0')
        mm = (OPEN_M - 1 + i) % 12; yy = OPEN_Y + (OPEN_M - 1 + i) // 12
        put(ws, 3, c, f'{MONTHS_RU[mm]} {yy}', font=F_LBL, fmt='General')
        fx(ws, 4, c, f'=INT(({L}2-1)/12)+1', '0')
        fx(ws, 5, c, f'=MOD({L}2-1+{OPEN_M-1},12)+1', '0')
    ws.freeze_panes = 'B6'
    return ws

REV = monthly_sheet('Выручка', '4472C4')
OPX = monthly_sheet('OPEX', 'C00000')
FO  = monthly_sheet('ФОТ', '7030A0')
PNL = monthly_sheet('P&L', '548235')
TAX = monthly_sheet('Налоги', 'BF8F00')

def mrow(ws, r, label, formula_fn, fmt=E, font=None, total=False):
    put(ws, r, 1, label, font=font or F_LBL)
    for i in range(NMON):
        c = 2 + i; L = get_column_letter(c)
        fx(ws, r, c, formula_fn(L, i, c), fmt=fmt, font=font, fill=FILL_T if total else None)
    return r + 1

# ---------- ВЫРУЧКА ----------
r = 7
put(REV, r, 1, 'ОЧЕРЕДЬ 1 — три банных комплекса (периметр расчёта ТЗ)', font=F_SEC, border=False); r += 1
put(REV, r, 1, 'Сезонность')
for i in range(NMON):
    c = 2 + i; L = get_column_letter(c)
    fx(REV, r, c, f"=INDEX(Допущения!$B${seas_row}:$B${seas_row+11},{L}5)", '0.000')
seas_r = r; r += 1
mrow(REV, r, 'Выход на план (ramp)', lambda L, i, c: f"=MIN(1,{L}2/{ADDR['rampM']})", '0.00'); ramp_r = r; r += 1
mrow(REV, r, 'Загрузка аренды (сценарий)', lambda L, i, c: f"=INDEX('Сценарии'!$B${load_row0}:$B${load_row0+4},{L}4)", '0.000'); load_r = r; r += 1
mrow(REV, r, 'Гостей/день (ёмкость × загрузка × сезон × ramp)',
    lambda L, i, c: f"={ADDR['capday1']}*{L}{load_r}*{L}{seas_r}*{L}{ramp_r}", '0.0'); gday_r = r; r += 1
mrow(REV, r, 'Гостей/мес', lambda L, i, c: f'={L}{gday_r}*30', E, total=True); gm_r = r; r += 1
mrow(REV, r, 'Арендных посещений (=гостям)', lambda L, i, c: f'={L}{gm_r}', E); rent_n_r = r; r += 1
mrow(REV, r, 'Парений (×коэф. 1)', lambda L, i, c: f"={L}{gm_r}*{ADDR['k_steam']}", '0.0'); steam_n_r = r; r += 1
mrow(REV, r, 'Массажей (×коэф. 0,5)', lambda L, i, c: f"={L}{gm_r}*{ADDR['k_mass']}", '0.0'); mass_n_r = r; r += 1
mrow(REV, r, 'Ценовой фактор', lambda L, i, c: f"=(1+{ADDR['pgrow']})^({L}4-1)", '0.000'); pf_r = r; r += 1
mrow(REV, r, 'Выручка: аренда', lambda L, i, c: f"={L}{rent_n_r}*{ADDR['p_rent']}*{L}{pf_r}", E); rev_r_r = r; r += 1
mrow(REV, r, 'Выручка: парения', lambda L, i, c: f"={L}{steam_n_r}*{ADDR['p_steam']}*{L}{pf_r}", E); rev_s_r = r; r += 1
mrow(REV, r, 'Выручка: массажи', lambda L, i, c: f"={L}{mass_n_r}*{ADDR['p_mass']}*{L}{pf_r}", E); rev_m_r = r; r += 1
mrow(REV, r, 'ИТОГО ВЫРУЧКА ОЧ.1', lambda L, i, c: f'={L}{rev_r_r}+{L}{rev_s_r}+{L}{rev_m_r}', E, font=F_BOLD, total=True); rev1_r = r; r += 2

put(REV, r, 1, 'ОЧЕРЕДЬ 2 — справочно (запуск Jan-2031; в периметр первой очереди не входит, двойного учёта нет)', font=F_SEC, border=False); r += 1
mrow(REV, r, 'Оч.2 запущена (0/1)', lambda L, i, c: f'=IF({L}2>={P2_LAUNCH_M},1,0)', '0'); p2on_r = r; r += 1
mrow(REV, r, 'Обществ. баня: гостей/день', lambda L, i, c:
    f"={ADDR['pb_on']}*{L}{p2on_r}*{ADDR['pb_cap']}*INDEX(Допущения!$B${pb_load_row}:$B${pb_load_row+4},MAX(1,MIN(5,INT(({L}2-{P2_LAUNCH_M})/12)+1)))*{L}{seas_r}", '0.0'); pb_g_r = r; r += 1
mrow(REV, r, 'Обществ. баня: выручка (билет+услуги)', lambda L, i, c: f"={L}{pb_g_r}*30*({ADDR['pb_tick']}+{ADDR['pb_svc']})", E); pb_rev_r = r; r += 1
mrow(REV, r, 'Модули оч.2: ramp (9 мес)', lambda L, i, c: f'=MIN(1,MAX(0,{L}2-{P2_LAUNCH_M}+1)/9)', '0.00'); p2ramp_r = r; r += 1
mrow(REV, r, 'Модули оч.2: гостей/день', lambda L, i, c:
    f"={L}{p2on_r}*{ADDR['capday2']}*INDEX('Сценарии'!$B${load_row0}:$B${load_row0+4},{L}4)*{L}{seas_r}*{L}{p2ramp_r}", '0.0'); p2g_r = r; r += 1
mrow(REV, r, 'Модули оч.2: выручка', lambda L, i, c: f"={L}{p2g_r}*30*{ADDR['avgp2']}", E); p2rev_r = r; r += 1
mrow(REV, r, 'ИТОГО ОЧ.2 (справочно)', lambda L, i, c: f'={L}{pb_rev_r}+{L}{p2rev_r}', E, total=True); rev2_r = r; r += 1
mrow(REV, r, 'ВЫРУЧКА В P&L (оч.1 + оч.2 при флаге «Да»)', lambda L, i, c: f"={L}{rev1_r}+IF({ADDR['p2scope']}=\"Да\",{L}{rev2_r},0)", E, font=F_BOLD, total=True); rev_pl_r = r; r += 1

# ---------- OPEX ----------
r = 7
put(OPX, r, 1, 'ПЕРЕМЕННЫЕ / НОМЕНКЛАТУРА (по спецификациям, ТЗ §5)', font=F_SEC, border=False); r += 1
put(OPX, r, 1, 'Индекс инфляции')
for i in range(NMON):
    c = 2 + i; L = get_column_letter(c)
    fx(OPX, r, c, f"=(1+{ADDR['infl']})^({L}4-1)", '0.000')
infl_r = r; r += 1
mrow(OPX, r, 'Аренда — материалы (гости × себест./гостя)', lambda L, i, c: f"='Выручка'!{L}{gm_r}*{ADDR['cogs_guest']}*{L}{infl_r}", E); v_a_r = r; r += 1
mrow(OPX, r, 'Парения — материалы (парений × спека ÷ 2)', lambda L, i, c: f"='Выручка'!{L}{steam_n_r}*{ADDR['cogs_steam']}*{L}{infl_r}", E); v_s_r = r; r += 1
mrow(OPX, r, 'Массажи — материалы (массажей × спека)', lambda L, i, c: f"='Выручка'!{L}{mass_n_r}*{ADDR['cogs_mass']}*{L}{infl_r}", E); v_m_r = r; r += 1
mrow(OPX, r, 'Итого переменные / номенклатура', lambda L, i, c: f'={L}{v_a_r}+{L}{v_s_r}+{L}{v_m_r}', E, total=True); var_r = r; r += 2

put(OPX, r, 1, 'ПОСТОЯННЫЕ РАСХОДЫ И IT (действующая модель, ТЗ §8)', font=F_SEC, border=False); r += 1
fix0 = r
for name, addr, energy in opex_addr:
    coef = f"*{ADDR['energ']}" if energy else ''
    mrow(OPX, r, name + (' (энерго)' if energy else ''), lambda L, i, c, a=addr, cf=coef: f"={a}*{L}{infl_r}{cf}", E); r += 1
n_mod1 = sum(1 for m in P['modules'] if (m.get('phase') or 1) == 1 and m.get('status') == 'Активен')
mrow(OPX, r, f'Обслуживание модулей (€/модуль × {n_mod1} активных оч.1)', lambda L, i, c: f"={ADDR['ox_mod']}*{n_mod1}*{L}{infl_r}", E); r += 1
mrow(OPX, r, 'Бухгалтерия', lambda L, i, c: f"={ADDR['ox_acc']}*{L}{infl_r}", E); r += 1
mrow(OPX, r, 'Юридические услуги (ТЗ §2.4 — редактируется)', lambda L, i, c: f"={ADDR['ox_legal']}*{L}{infl_r}", E); r += 1
mrow(OPX, r, 'Аренда земли (если режим lease)', lambda L, i, c: f"=IF({ADDR['landmode']}=\"lease\",{ADDR['landrent']}*{L}{infl_r},0)", E); r += 1
mrow(OPX, r, 'IT-расходы', lambda L, i, c: f"={ADDR['ox_it']}*{L}{infl_r}", E); fix1 = r; r += 2

put(OPX, r, 1, 'МАРКЕТИНГ И СТРАХОВАНИЕ (ТЗ §2.1/§2.4 — отдельные настройки)', font=F_SEC, border=False); r += 1
mrow(OPX, r, 'Маркетинг — фикс по периодам',
    lambda L, i, c: f"=SUMPRODUCT(Допущения!$B${mkt_rows[0]}:$B${mkt_rows[-1]},({L}$2>=Допущения!$C${mkt_rows[0]}:$C${mkt_rows[-1]})*({L}$2<=Допущения!$D${mkt_rows[0]}:$D${mkt_rows[-1]}))*{L}{infl_r}", E); mkf_r = r; r += 1
mrow(OPX, r, 'Маркетинг — % от выручки', lambda L, i, c: f"={ADDR['mkt_pct']}*'Выручка'!{L}{rev_pl_r}", E); mkp_r = r; r += 1
mrow(OPX, r, 'Страхование — % от выручки', lambda L, i, c: f"={ADDR['ins_pct']}*'Выручка'!{L}{rev_pl_r}", E); ins_r = r; r += 1
mrow(OPX, r, 'ИТОГО OPEX (без ФОТ)', lambda L, i, c: f'={L}{var_r}+SUM({L}{fix0}:{L}{fix1})+{L}{mkf_r}+{L}{mkp_r}+{L}{ins_r}', E, font=F_BOLD, total=True); opex_r = r; r += 1

# ---------- ФОТ ----------
def hc_formula(rr: int, L: str) -> str:
    """Численность роли: базовая → фаза; фазы оч.2 (индекс ≥1) — при флаге «Да»."""
    expr = f'Штат!$E${rr}'
    for j, ph in enumerate(phases):
        col = get_column_letter(6 + j)
        cond = f'{L}2>={ops_month(ph["from"])}'
        if j >= 1:
            cond = f'AND({ADDR["p2scope"]}="Да",{cond})'
        expr = f'IF({cond},Штат!${col}${rr},{expr})'
    return '=' + expr

r = 7
put(FO, r, 1, 'ОКЛАДЫ: численность × ставка × инфляция (фазы включения — см. Штат)', font=F_SEC, border=False); r += 1
fot_first = r
for i, role in enumerate(fot['roles']):
    rr = role_row0 + i
    put(FO, r, 1, f'{role} — человек')
    for i2 in range(NMON):
        c = 2 + i2; L = get_column_letter(c)
        fx(FO, r, c, hc_formula(rr, L), '0')
    hc = r; r += 1
    put(FO, r, 1, f'{role} — оклады €')
    for i2 in range(NMON):
        c = 2 + i2; L = get_column_letter(c)
        fx(FO, r, c, f"={L}{hc}*Штат!$D${rr}*(1+{ADDR['infl']})^({L}4-1)", E)
    r += 1
put(FO, r, 1, 'IT-куратор')
for i2 in range(NMON):
    c = 2 + i2; L = get_column_letter(c)
    fx(FO, r, c, f"=Штат!$D${it_row}*(1+{ADDR['infl']})^({L}4-1)", E)
it_sal_r = r; r += 1
sal_rows = [fot_first + 2 * j + 1 for j in range(len(fot['roles']))] + [it_sal_r]
sal_join = '+'.join(f'{{L}}{x}' for x in sal_rows)
mrow(FO, r, 'ИТОГО оклады', lambda L, i, c, j=sal_join: '=' + j.format(L=L), E, total=True); sal_r = r; r += 2

put(FO, r, 1, 'БОНУСЫ И ВЗНОСЫ (ТЗ §4.3 — доли ролей из спецификаций)', font=F_SEC, border=False); r += 1
# KPI-бонус роли = Σ по направлениям: выручка направления × доля роли в спеке (labor pct)
bon_rows = []
for role, terms in role_bonus_src.items():
    dir_col = {'Аренда': rev_r_r, 'Парен': rev_s_r, 'Массаж': rev_m_r}
    ts = [(d, next(c for k, c in dir_col.items() if k in d), pct) for d, _, pct in terms]
    lbl = role + ': ' + ' + '.join(f'{pct:.0%} {d.lower()}' for d, _, pct in ts)
    mrow(FO, r, lbl, lambda L, i, c, t=ts: '=' + '+'.join(f"'Выручка'!{L}{col}*{pct}" for _, col, pct in t), E)
    bon_rows.append(r); r += 1
mrow(FO, r, 'ИТОГО бонусы', lambda L, i, c: '=' + '+'.join(f'{L}{x}' for x in bon_rows), E, total=True); bon_r = r; r += 1
mrow(FO, r, 'ФОТ начисленный (оклады+бонусы)', lambda L, i, c: f'={L}{sal_r}+{L}{bon_r}', E); gross_r = r; r += 1
mrow(FO, r, f"Взносы работодателя {tx['employerRate']*100:g}%", lambda L, i, c: f"={L}{gross_r}*{ADDR['emp_rate']}", E); contrib_r = r; r += 1
mrow(FO, r, 'ИТОГО ФОТ с начислениями', lambda L, i, c: f'={L}{gross_r}+{L}{contrib_r}', E, font=F_BOLD, total=True); fot_r = r; r += 1

# ---------- НАЛОГИ ----------
r = 7
put(TAX, r, 1, f'НДС — цены включают НДС, режим «{P["meta"].get("vatMode", "Гросс")}» (семантика движка)', font=F_SEC, border=False); r += 1
mrow(TAX, r, 'НДС начисленный (выручка × 19/119)', lambda L, i, c: f"='Выручка'!{L}{rev_pl_r}*{ADDR['vatStd']}/(1+{ADDR['vatStd']})", E); vo_r = r; r += 1
mrow(TAX, r, 'Входной НДС (OPEX × 19/119)', lambda L, i, c: f"='OPEX'!{L}{opex_r}*{ADDR['vatInput']}/(1+{ADDR['vatInput']})", E); vi_r = r; r += 1
vcred_r = r
mrow(TAX, r, 'Кредит НДС (накопленный)', lambda L, i, c:
    (f"=MAX(0,{L}{vi_r}-{L}{vo_r})" if i == 0 else
     f"=MAX(0,{get_column_letter(c-1)}{vcred_r}+{L}{vi_r}-{L}{vo_r})"), E); r += 1
mrow(TAX, r, 'НДС к оплате (мес)', lambda L, i, c:
    (f"=MAX(0,{L}{vo_r}-{L}{vi_r})" if i == 0 else
     f"=MAX(0,{L}{vo_r}-{L}{vi_r}-{get_column_letter(c-1)}{vcred_r})"), E); vpay_r = r; r += 1
mrow(TAX, r, 'НДС к уплате (квартальный платёж)', lambda L, i, c:
    f"=IF(MOD({L}5,3)=0,SUM({get_column_letter(max(2,c-2))}{vpay_r}:{L}{vpay_r}),0)", E); r += 2
put(TAX, r, 1, 'CIT и отчисления на дивиденды — в P&L; взносы работодателя — в ФОТ; входной НДС на CAPEX — на листе CAPEX.', font=F_NOTE, border=False)

# ---------- P&L ----------
r = 7
mrow(PNL, r, 'Выручка (брутто, с НДС)', lambda L, i, c: f"='Выручка'!{L}{rev_pl_r}", E); p_rev = r; r += 1
mrow(PNL, r, '– НДС начисленный', lambda L, i, c: f"=-'Налоги'!{L}{vo_r}", E); p_vat = r; r += 1
mrow(PNL, r, 'Выручка нетто', lambda L, i, c: f'={L}{p_rev}+{L}{p_vat}', E, total=True); p_net = r; r += 1
mrow(PNL, r, '– Переменные расходы нетто (номенклатура)', lambda L, i, c: f"=-'OPEX'!{L}{var_r}/(1+{ADDR['vatInput']})", E); p_var = r; r += 1
mrow(PNL, r, '⇒ МАРЖИНАЛЬНАЯ ПРИБЫЛЬ (выручка минус переменные)', lambda L, i, c: f'={L}{p_net}+{L}{p_var}', E, total=True); p_marg = r; r += 1
mrow(PNL, r, '– Постоянные расходы нетто + IT', lambda L, i, c: f"=-('OPEX'!{L}{opex_r}-'OPEX'!{L}{var_r})/(1+{ADDR['vatInput']})", E); p_fix = r; r += 1
mrow(PNL, r, '– ФОТ с взносами (в т.ч. процедурные бонусы)', lambda L, i, c: f"=-'ФОТ'!{L}{fot_r}", E); p_fot = r; r += 1
mrow(PNL, r, '⇒ EBITDA (учтены переменные, постоянные, IT и ФОТ)', lambda L, i, c: f'={L}{p_marg}+{L}{p_fix}+{L}{p_fot}', E, font=F_BOLD, total=True); p_ebitda = r; r += 1
mrow(PNL, r, '– Амортизация (10/7/5 лет по бакетам)', lambda L, i, c:
    f"=-{ADDR['capex1']}*(1+{ADDR['cadj']})*(IF({L}2<=Допущения!$C${am_rows[0]}*12,Допущения!$B${am_rows[0]}/Допущения!$C${am_rows[0]}/12,0)"
    f"+IF({L}2<=Допущения!$C${am_rows[1]}*12,Допущения!$B${am_rows[1]}/Допущения!$C${am_rows[1]}/12,0)"
    f"+IF({L}2<=Допущения!$C${am_rows[2]}*12,Допущения!$B${am_rows[2]}/Допущения!$C${am_rows[2]}/12,0))", E); p_am = r; r += 1
mrow(PNL, r, '⇒ EBIT', lambda L, i, c: f'={L}{p_ebitda}+{L}{p_am}', E, total=True); p_ebit = r; r += 1
mrow(PNL, r, '– CIT 15% (на положительную прибыль)', lambda L, i, c: f"=-MAX(0,{L}{p_ebit})*{ADDR['cit']}", E); p_cit = r; r += 1
mrow(PNL, r, '⇒ ЧИСТАЯ ПРИБЫЛЬ (учтены все расходы, амортизация и налог)', lambda L, i, c: f'={L}{p_ebit}+{L}{p_cit}', E, font=F_BOLD, total=True); p_np = r; r += 2
put(PNL, r, 1, 'РАСПРЕДЕЛЕНИЕ ПРИБЫЛИ', font=F_SEC, border=False); r += 1
mrow(PNL, r, 'Управленческая компания', lambda L, i, c: f"=MAX(0,{L}{p_np})*{ADDR['pmgmt']}", E); p_mg = r; r += 1
mrow(PNL, r, 'Резерв', lambda L, i, c: f"=MAX(0,{L}{p_np})*{ADDR['pres']}", E); p_rs = r; r += 1
mrow(PNL, r, 'Дивиденды партнёрам (брутто)', lambda L, i, c: f"=MAX(0,{L}{p_np})*(1-{ADDR['pmgmt']}-{ADDR['pres']})", E); p_div = r; r += 1
mrow(PNL, r, '– SDC 5% + GESY 2,65% на дивиденды', lambda L, i, c: f"=-{L}{p_div}*({ADDR['sdc']}+{ADDR['gesy']})", E); p_sdc = r; r += 1
mrow(PNL, r, '⇒ Дивиденды нетто партнёрам', lambda L, i, c: f'={L}{p_div}+{L}{p_sdc}', E, total=True); r += 1

# ---------- CAPEX ----------
CX = sheet('CAPEX', '808080')
CX.column_dimensions['A'].width = 46
put(CX, 1, 1, 'CAPEX — строительство (календарные месяцы)', font=Font(name='Arial', size=13, bold=True), border=False)
put(CX, 2, 1, f"Оч.1: {P['meta']['constructionStart'][:7]} + {P['meta']['capexMonths']} мес по S-кривой (задержка сдвигает окно). Оч.2: {q2['constructionStart']} + {q2['months']} мес — справочно, финансирование {q2['funding']}.", font=F_NOTE, border=False)
NCM = 48
put(CX, 3, 1, 'Месяц')
for i in range(NCM):
    c = 2 + i
    put(CX, 3, c, f'{MONTHS_RU[i % 12]}-{str(2027 + i // 12)[2:]}', font=F_LBL, fmt='General')
    CX.column_dimensions[get_column_letter(c)].width = 8
cxr = 4
put(CX, cxr, 1, 'Земля / участок (если purchase)')
for i in range(NCM):
    c = 2 + i; L = get_column_letter(c)
    fx(CX, cxr, c, f"=IF(AND({ADDR['landmode']}=\"purchase\",{L}$3=\"Янв-27\"),{ADDR['landcost']},0)", E)
zem_r = cxr; cxr += 1
put(CX, cxr, 1, 'CAPEX оч.1 × (1+корректировка) — S-кривая')
for i in range(NCM):
    c = 2 + i
    fx(CX, cxr, c,
       f"=IF(AND(COLUMN()-2>={ADDR['delay']},COLUMN()-2<{ADDR['delay']}+{ADDR['capM']}),"
       f"{ADDR['capex1']}*(1+{ADDR['cadj']})*INDEX(Допущения!$B${scurve_row}:$B${scurve_row+8},COLUMN()-1-{ADDR['delay']}),0)", E)
capex1_r = cxr; cxr += 1
q2_c0 = (int(q2['constructionStart'][:4]) - int(P['meta']['constructionStart'][:4])) * 12 \
        + int(q2['constructionStart'][5:7]) - int(P['meta']['constructionStart'][5:7])
put(CX, cxr, 1, f"Оч.2 стройка (с {q2['constructionStart']}, {q2['months']} мес, линейно) — СПРАВОЧНО")
for i in range(NCM):
    c = 2 + i
    fx(CX, cxr, c,
       f"=IF(AND(COLUMN()-2>={q2_c0},COLUMN()-2<{q2_c0}+{ADDR['q2months']}),{ADDR['q2eur']}*(1+{ADDR['q2adj']})/{ADDR['q2months']},0)", E)
capex2_r = cxr; cxr += 1
put(CX, cxr, 1, 'ИТОГО (оч.1 + земля; оч.2 справочно ниже)')
for i in range(NCM):
    c = 2 + i; L = get_column_letter(c)
    fx(CX, cxr, c, f'={L}{zem_r}+{L}{capex1_r}', E, fill=FILL_T)
cxr += 1
put(CX, cxr, 1, 'НДС на CAPEX (входной, к возмещению)')
for i in range(NCM):
    c = 2 + i; L = get_column_letter(c)
    fx(CX, cxr, c, f"=({L}{zem_r}+{L}{capex1_r})*{ADDR['vatInput']}/(1+{ADDR['vatInput']})", E)
cxr += 2
put(CX, cxr, 1, 'Амортизация: бакеты 40/45/15% на 10/7/5 лет от CAPEX оч.1 с корректировкой; земля не амортизируется (см. P&L).', font=F_NOTE, border=False)

# ======================================================================
# ГОДЫ
# ======================================================================
G = sheet('Годы', '2E75B6')
G.column_dimensions['A'].width = 48
for col in 'BCDEF': G.column_dimensions[col].width = 14
r = 1
put(G, r, 1, 'ГОДОВАЯ СВОДКА (операционные годы)', font=Font(name='Arial', size=13, bold=True), border=False); r += 1
hdr(G, r, 1, 'Показатель')
for y in range(5): hdr(G, r, 2 + y, f'Год {y+1}')
r += 1
def ysum(rr, fmt=E):
    global r
    for y in range(5):
        c0 = get_column_letter(2 + y * 12); c1 = get_column_letter(2 + min(y * 12 + 11, NMON - 1))
        fx(G, r, 2 + y, f"=SUM('{ysum.ws}'!{c0}{rr}:{c1}{rr})", fmt)
    r += 1
def yavg(rr, fmt='0.0'):
    global r
    for y in range(5):
        c0 = get_column_letter(2 + y * 12); c1 = get_column_letter(2 + min(y * 12 + 11, NMON - 1))
        fx(G, r, 2 + y, f"=SUM('{yavg.ws}'!{c0}{rr}:{c1}{rr})/30/COUNT('{yavg.ws}'!{c0}{rr}:{c1}{rr})", fmt)
    r += 1
put(G, r, 1, 'Гостей всего, чел'); ysum.ws = 'Выручка'; ysum(gm_r)
put(G, r, 1, 'Арендных посещений'); ysum(rent_n_r)
put(G, r, 1, 'Парений'); ysum(steam_n_r)
put(G, r, 1, 'Массажей (в среднем)'); ysum(mass_n_r, '0.0')
put(G, r, 1, 'Выручка: аренда, €'); ysum(rev_r_r)
put(G, r, 1, 'Выручка: парения, €'); ysum(rev_s_r)
put(G, r, 1, 'Выручка: массажи, €'); ysum(rev_m_r)
put(G, r, 1, 'ВЫРУЧКА оч.1, €'); ysum(rev1_r)
put(G, r, 1, 'Выручка оч.2 (справочно), €'); ysum(rev2_r)
put(G, r, 1, 'Переменные по спецификациям, €'); ysum.ws = 'OPEX'; ysum(var_r)
put(G, r, 1, 'OPEX итого (вкл. переменные), €'); ysum(opex_r)
put(G, r, 1, 'ФОТ с взносами, €'); ysum.ws = 'ФОТ'; ysum(fot_r)
put(G, r, 1, 'EBITDA, €'); ysum.ws = 'P&L'; ysum(p_ebitda)
put(G, r, 1, 'Чистая прибыль, €'); ysum(p_np)
r += 1
put(G, r, 1, 'КОНТРОЛЬ ТЗ §7 — среднее за год (сезонность в среднем = 1)', font=F_SEC, border=False); r += 1
put(G, r, 1, 'Гостей/день — модель'); yavg.ws = 'Выручка'; yavg(gm_r); gmodel_r = r - 1
put(G, r, 1, 'Гостей/день — ТЗ')
for y, gv in enumerate(base_guests): inp(G, r, 2 + y, gv, '0.0')
gtz_r = r; r += 1
put(G, r, 1, 'Выручка/день — модель, €'); yavg.ws = 'Выручка'; yavg(rev1_r, E); rmod_r = r - 1
put(G, r, 1, 'Выручка/день — ТЗ, €')
for y, gv in enumerate([3120, 4160, 5200, 7800, 9100]): inp(G, r, 2 + y, gv, E)
rtz_r = r; r += 1
put(G, r, 1, 'Отклонение, %')
for y in range(5):
    fx(G, r, 2 + y, f'={get_column_letter(2+y)}{gmodel_r}/{get_column_letter(2+y)}{gtz_r}-1', '0.0%')
r += 1

# ======================================================================
# CHECKS
# ======================================================================
CK = sheet('Checks', 'FF0000')
CK.column_dimensions['A'].width = 62
for col in 'BC': CK.column_dimensions[col].width = 16
r = 1
put(CK, r, 1, 'КОНТРОЛЬНЫЕ ПРОВЕРКИ', font=Font(name='Arial', size=13, bold=True), border=False); r += 1
ps = ADDR['pshare0'].split('!')[1]; p2 = ADDR['pshare2'].split('!')[1]
checks = [
    ('Средняя сезонность = 1', f"ABS(Допущения!$B${seas_row+12}-1)<0.001"),
    ('Год 1: гостей/день ≈ 12 (ТЗ §7)', f"ABS(Годы!$B${gmodel_r}-12)<0.5"),
    ('Контроль ТЗ §6: при 12 гостях = 3120 €/день (до налогов)', f"ABS(Годы!$B${rmod_r}-3120)<50"),
    ('Год 3: гостей/день ≈ 20, выручка ≈ 5200 €/день', f"AND(ABS(Годы!$D${gmodel_r}-20)<0.5,ABS(Годы!$D${rmod_r}-5200)<50)"),
    ('Доли партнёров + mgmt + reserve ≈ 100%', f"ABS({ADDR['pshare0']}+{ADDR['pshare1']}+{ADDR['pshare2']}+{ADDR['pmgmt']}+{ADDR['pres']}-1)<0.01"),
    ('S-кривая весов Σ = 1', f"ABS(SUM(Допущения!$B${scurve_row}:$B${scurve_row+8})-1)<0.001"),
    (f'Ёмкость оч.1 = {cap1_expected:g} гостя/день (Σ активных модулей)', f"ABS({ADDR['capday1']}-{cap1_expected})<0.01"),
]
for lbl, f in checks:
    put(CK, r, 1, lbl)
    fx(CK, r, 2, f'=IF(Допущения!1=1,IF({f},"OK","FAIL"),"FAIL")' if False else f'=IF({f},"OK","FAIL")', 'General')
    r += 1

# ======================================================================
# ОБЛОЖКА
# ======================================================================
CV = wb.active
CV.title = 'Обложка'
CV.sheet_properties.tabColor = '1F4E79'
CV.column_dimensions['A'].width = 42
CV.column_dimensions['B'].width = 62
put(CV, 2, 1, 'AURA HILLS — финансовая модель первой очереди', font=Font(name='Arial', size=16, bold=True), border=False)
put(CV, 3, 1, 'Разовая выгрузка по ТЗ: 3 банных комплекса, 12→35 гостей/день, горизонт 5 лет; очередь 2 — справочно', font=F_NOTE, border=False)
meta = [
    ('Модель', 'Новая модель AURA HILLS (ТЗ) — первая очередь', 'General'),
    ('Сценарий', '=CHOOSE(Сценарии!$B$2,"Conservative","Base","Aggressive")', 'General'),
    ('Дата выгрузки', '=TODAY()', 'YYYY-MM-DD'),
    ('Версия', 'tz-simple-1.1 (ядро: TypeScript src/model; генератор: _gen-tz-simple.py)', 'General'),
    ('Источник данных', f'{DATA_DIR} (последняя версия git-версионирования сервера)', 'General'),
    ('Валюта', 'EUR', 'General'),
    ('Горизонт', f'{MONTHS_RU[OPEN_M-1]}-{OPEN_Y} … {NMON} мес; оч.2 — справочно (старт — опер.мес. {P2_LAUNCH_M if P2_LAUNCH_M < 10**6 else "—"})', 'General'),
]
rr = 5
for k, v, f_ in meta:
    put(CV, rr, 1, k, font=F_BOLD)
    put(CV, rr, 2, v, font=F_LBL, fmt=f_)
    rr += 1
rr += 1
put(CV, rr, 1, 'ЛЕГЕНДА', font=F_SEC, border=False); rr += 1
put(CV, rr, 1, 'Синий текст на жёлтом — редактируемые входы', font=F_IN, fill=FILL_I); rr += 1
put(CV, rr, 1, 'Чёрный текст — формулы (пересчёт в Excel при изменении входов)', font=F_CALC); rr += 1
put(CV, rr, 1, 'Зелёная заливка — итоговые строки', font=F_LBL, fill=FILL_T); rr += 1
rr += 1
put(CV, rr, 1, 'СОСТАВ КНИГИ (по ТЗ)', font=F_SEC, border=False); rr += 1
for s_ in [
    'Допущения — §2: все сохранённые блоки; юридические услуги и фикс-маркетинг по периодам — редактируемые поля',
    'Сценарии — §3: посещаемость по годам, коэффициенты услуг, сценарные оси (ресторан и членство убраны)',
    'Спеки — §5: «Аренда — 12 чел», «Парение Дубль» (÷2 гостя — без двойного начисления), «Массаж 2 глубокий»',
    'Штат — §4: ставки, графики, «на смене», численность по периодам включения',
    'Выручка / OPEX / ФОТ / Налоги / P&L — помесячно, по формулам действующей модели',
    'CAPEX — земля, S-кривая оч.1, стройка оч.2 справочно',
    'Годы — сводка и контроль ТЗ §7;  Checks — контрольные проверки',
    'Исключено по ТЗ §2.2: членство, сертификаты, F&B, глэмпинг, pre-opening, maintenance CAPEX, ресторан',
    '«Амортизация доли — 40 лет» сохранена без изменения логики — вопрос на согласовании (ТЗ §2.3)',
]:
    put(CV, rr, 1, s_, font=F_LBL, border=False); rr += 1

wb.save('out/aura-hills-tz-simple.xlsx')
print('written out/aura-hills-tz-simple.xlsx')
