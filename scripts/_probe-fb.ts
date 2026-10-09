import params from '../src/data/params.json'
import scenarios from '../src/data/scenarios.json'
import items from '../src/data/nomenclature.json'
import services from '../src/data/services.json'
import { runModel } from '../src/model/run'
const r = runModel(params as any, scenarios as any, items as any, (services as any).services, 'Base')
const m = r.revenue[0]
console.log('guests=', m.guests.toFixed(0), 'slots=', m.slots.toFixed(1), 'memberGuests=', m.memberGuests?.toFixed(0), 'memberSlots=', m.memberSlots?.toFixed(1), 'fb=', m.fb.toFixed(0))
console.log('revenue keys:', Object.keys(m).join(', '))
