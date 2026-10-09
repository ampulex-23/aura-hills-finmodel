import params from '../src/data/params.json'
import scenarios from '../src/data/scenarios.json'
import items from '../src/data/nomenclature.json'
import services from '../src/data/services.json'
import { runModel } from '../src/model/run'
const r = runModel(params as any, scenarios as any, items as any, (services as any).services, 'Base')
console.log('NPV', Math.round(r.kpis.npv), '| IRR', (r.kpis.irrAnnual*100).toFixed(1)+'%', '| окуп', r.kpis.paybackMonths, 'мес | пик', Math.round(r.kpis.peakFundingNeed))
console.log('ФОТ год1', Math.round(r.fot.slice(0,12).reduce((s,m)=>s+m.total,0)), '| год4', Math.round(r.fot.slice(36,48).reduce((s,m)=>s+m.total,0)))
