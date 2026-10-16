import { readFileSync } from 'fs'
import { runModel } from '../src/model/run'
const params = JSON.parse(readFileSync('src/data/params.json', 'utf8'))
const matrix = JSON.parse(readFileSync('src/data/scenarios.json', 'utf8'))
const items = JSON.parse(readFileSync('src/data/nomenclature.json', 'utf8'))
const services0 = JSON.parse(readFileSync('src/data/services.json', 'utf8')).services
const p = structuredClone(params); const mx = structuredClone(matrix)
p.preopen.enabled=false; p.capexMaint.enabled=false
p.members.enabled=false; p.units.certsEnabled=false; p.fb.enabled=false; p.glamping.enabled=false; p.laundry.enabled=false
for (const m of p.modules) if ((m.phase??1)===1) m.prices = m.prices.map(()=>m.capacity*100)
p.deposit.steamBase=100; p.deposit.massageBase=120; p.deposit.base=0
p.service.walletExtraShare=0; p.service.upgradeShare=0
const services = services0.filter((s:any)=>s.direction!=='Доп. услуги').map((s:any)=>({...s,
  weight: s.direction==='Парения'?(s.code==='SVC-P2'?1:0):s.direction==='Массаж'?(s.code==='SVC-M2'?1:0):s.weight}))
const CAP_DAY = 3*0.95*24
const tzBaths = [12,16,20,30,35].map(g=>g/CAP_DAY)
const SCALE=[0.85,1,1.15]
for (const [i,y] of ['y1','y2','y3','y4','y5'].entries()) {
  mx.baths[y] = SCALE.map(s=>Math.min(1,tzBaths[i]*s))
  mx.steam[y]=[1,1,1]; mx.massage[y]=[0.5,0.5,0.5]; mx.extra[y]=[0,0,0]
  mx.membersMonth[y]=[0,0,0]; mx.glamping[y]=[0,0,0]; mx.restaurant[y]=[0,0,0]
}
for (const k of ['priceGrowth','rampMonths'] as const) mx[k] = mx[k].map(()=>k==='priceGrowth'?0:1)
p.meta.opsMonths = 38
const r = runModel(p, mx, items, services, 'Base')
console.log('months:', r.revenue.length)
for (let y=0;y<Math.ceil(r.revenue.length/12);y++){
  let g=0, rent=0, st=0, ms=0, tot=0, n=0
  for (let k=y*12;k<Math.min(y*12+12,r.revenue.length);k++){const m=r.revenue[k]; g+=m.guests; rent+=m.rental; st+=m.steamTotal; ms+=m.massageTotal; tot+=m.total; n++}
  console.log(`y${y+1} (${n}mo): guests/d=${(g/n/30).toFixed(1)} rent/d=${(rent/n/30).toFixed(0)} steam/d=${(st/n/30).toFixed(0)} massage/d=${(ms/n/30).toFixed(0)} total/d=${(tot/n/30).toFixed(0)}`)
}
