import { ActionIcon, Button, Group } from '@mantine/core'
import { useModel } from '../store'
import { NumField, TextCell, fmt } from '../components/ui'
import { baseSalariesMonthly } from '../model/fot'

// Вкладка «Штат»: единая картина фонда оплаты труда.
// Штатное расписание (fot.*) редактируется здесь; условные роли (повар,
// IT-куратор) показаны read-only — их ставки задаются там, где живёт
// выключатель слоя: Допущения → F&B и вкладка IT соответственно.
export function Staff() {
  const { params, setParam } = useModel()
  const P = params
  const er = 1 + P.taxes.employerRate

  const staffMonthly = P.fot.count.reduce((s, c, i) => s + c * P.fot.salary[i], 0)
  const cookMonthly = P.fb.enabled ? P.fb.cookCount * P.fb.cookSalary : 0
  const curatorMonthly = P.it.enabled ? P.it.curator : 0
  const totalBase = baseSalariesMonthly(P)

  const removeRole = (i: number) => {
    setParam('fot.roles', P.fot.roles.filter((_, j) => j !== i))
    setParam('fot.count', P.fot.count.filter((_, j) => j !== i))
    setParam('fot.salary', P.fot.salary.filter((_, j) => j !== i))
  }
  const addRole = () => {
    setParam('fot.roles', [...P.fot.roles, `Роль ${P.fot.roles.length + 1}`])
    setParam('fot.count', [...P.fot.count, 1])
    setParam('fot.salary', [...P.fot.salary, 1200])
  }

  const CondRow = ({ name, count, salary, src, on }: { name: string; count: number; salary: number; src: string; on: boolean }) => (
    <tr style={{ opacity: on ? 1 : 0.45 }}>
      <td className="lft">{name} <small className="note">· {src}</small></td>
      <td className="lft">{on ? fmt(count) : 'выкл.'}</td>
      <td className="lft">{on ? fmt(salary) : '—'}</td>
      <td className="lft">{on ? fmt(count * salary) : '—'}</td>
      <td className="lft">{on ? fmt(count * salary * er) : '—'}</td>
      <td />
    </tr>
  )

  return (
    <div>
      <p className="note" style={{ maxWidth: 720 }}>
        Штатное расписание и связанные ставки. Оклады индексируются инфляцией ежегодно
        и облагаются взносами работодателя ({(P.taxes.employerRate * 100).toFixed(2)}%).
        KPI ролей за услуги — во вкладке «Спецификации» (процент от прайса каждой услуги).
      </p>

      <div className="form-row">
      <fieldset className="f2">
        <legend>Штатное расписание</legend>
        <div className="table-wrap">
          <table className="month-table spec">
            <thead>
              <tr>
                <th>Роль</th><th>Ставок</th><th>Оклад, €/мес gross</th>
                <th>Фонд, €/мес</th><th>Со взносами, €/мес</th><th></th>
              </tr>
            </thead>
            <tbody>
              {P.fot.roles.map((role, i) => {
                const monthly = P.fot.count[i] * P.fot.salary[i]
                return (
                  <tr key={i}>
                    <td className="lft"><TextCell w={190} value={role} onChange={(v) => setParam(`fot.roles.${i}`, v)} /></td>
                    <td><NumField value={P.fot.count[i]} onChange={(v) => setParam(`fot.count.${i}`, v)} step={0.5} /></td>
                    <td><NumField value={P.fot.salary[i]} onChange={(v) => setParam(`fot.salary.${i}`, v)} step={50} /></td>
                    <td className="lft">{fmt(monthly)}</td>
                    <td className="lft">{fmt(monthly * er)}</td>
                    <td>
                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => removeRole(i)}>✕</ActionIcon>
                    </td>
                  </tr>
                )
              })}
              <CondRow name="Повар (F&B)" count={P.fb.cookCount} salary={P.fb.cookSalary} src="Допущения → F&B" on={P.fb.enabled} />
              <CondRow name="IT-куратор" count={1} salary={P.it.curator} src="вкладка IT" on={P.it.enabled} />
              <tr style={{ borderTop: '1px solid var(--bd, #333)' }}>
                <td className="lft"><b>Итого фонд окладов</b></td>
                <td className="lft"><b>{fmt(P.fot.count.reduce((a, b) => a + b, 0) + (P.fb.enabled ? P.fb.cookCount : 0))}</b></td>
                <td />
                <td className="lft"><b>{fmt(totalBase)}</b></td>
                <td className="lft"><b>{fmt(totalBase * er)}</b></td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <Group mt="xs">
          <Button size="xs" variant="subtle" color="gray" onClick={addRole}>+ Роль</Button>
        </Group>
      </fieldset>

      <div className="side-col">
        <fieldset>
          <legend>Бонусы и взносы</legend>
          <label className="field">
            <span>Взносы работодателя</span>
            <NumField value={P.taxes.employerRate} onChange={(v) => setParam('taxes.employerRate', v)} pct />
          </label>
          <small className="note">
            KPI-бонусы задаются не здесь, а во вкладке «Спецификации»: у каждой услуги —
            процент от прайса для каждой роли в её составе. Бонус месяца =
            Σ (кол-во проведённых услуг × прайс × % роли) — сверх окладов, тоже со взносами.
            Роли без строки в спеке KPI не получают.
          </small>
        </fieldset>

        <fieldset>
          <legend>Итог месяца 1 (Base, до бонусов)</legend>
          <div className="field"><span>Фонд окладов штата</span><b>€{fmt(staffMonthly)}</b></div>
          <div className="field"><span>+ условные роли</span><b>€{fmt(cookMonthly + curatorMonthly)}</b></div>
          <div className="field"><span>= оклады базы</span><b>€{fmt(totalBase)}</b></div>
          <div className="field"><span>+ взносы {(P.taxes.employerRate * 100).toFixed(2)}%</span><b>€{fmt(totalBase * er)}</b></div>
          <small className="note">
            Дальше сверху ложатся KPI-бонусы (по выручке месяца) и годовая индексация
            инфляцией. Помесячную динамику ФОТ см. в отчёте «ФОТ».
          </small>
        </fieldset>
      </div>
      </div>
    </div>
  )
}
