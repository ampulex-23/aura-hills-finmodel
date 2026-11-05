import { chromium } from 'playwright-core'

const EXE = 'C:\\Users\\user\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1208\\chrome-headless-shell-win64\\chrome-headless-shell.exe'
const BASE = 'https://shared.metodoxia25.net/'

const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  httpCredentials: { username: 'aura', password: 'AuraData26!xQ' },
})
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => { if (m.type() !== 'log') logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.name} ${e.message.slice(0, 250)}`))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) logs.push(`[${r.status()}] ${r.url().slice(0, 120)}`) })

const probe = async (tag) => {
  const info = await page.evaluate(() => ({
    blocks: document.querySelectorAll('.genplan-3d').length,
    canvases: document.querySelectorAll('.genplan-3d canvas').length,
    fallbackImgs: document.querySelectorAll('.genplan-3d .genplan-canvas img').length,
    h1: document.querySelector('h1')?.textContent ?? null,
    h2s: [...document.querySelectorAll('h2,h3')].map((h) => h.textContent).slice(0, 6),
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) + 'MB' : 'n/a',
  }))
  console.log(`--- ${tag}:`, JSON.stringify(info))
}

await page.goto(BASE + '#/doc/genplan', { waitUntil: 'networkidle' })
await page.waitForSelector('.genplan-3d', { timeout: 20000 }).catch(() => console.log('no .genplan-3d in 20s'))
await page.waitForTimeout(5000)
await probe('genplan')

const clicked = await page.evaluate(() => {
  const g = document.querySelector('g[data-slug][data-plan="1"]')
  if (!g) return null
  const r = g.getBoundingClientRect()
  return { slug: g.getAttribute('data-slug'), x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
console.log('click target:', clicked)
if (clicked) {
  await page.mouse.click(clicked.x, clicked.y)
  await page.waitForTimeout(9000)
  await probe('building-detail')
  await page.screenshot({ path: 'work-detail.png' })
}

console.log('--- logs ---')
for (const l of logs.slice(0, 40)) console.log(l)
await browser.close()
