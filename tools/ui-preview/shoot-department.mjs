// Screenshots of a large department page's tabs. usage: node tools/ui-preview/shoot-department.mjs <outDir>  (preview server on :5199)
import { chromium } from 'playwright'
const out = process.argv[2]
const shots = [['overview', '', 1440], ['roster', 'roster', 1440], ['leave', 'leave', 1440], ['queue-phone', 'queue', 390], ['roster-phone', 'roster', 390]]
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
for (const [name, tab, w] of shots) {
  const page = await browser.newPage({ viewport: { width: w, height: w > 500 ? 900 : 844 } })
  const path = tab ? `/?tab=${tab}` : '/'
  await page.goto(`http://localhost:5199/?screen=Department&dept=General%20Medicine&data=1&big=1&path=${encodeURIComponent(path)}`)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${out}/dept-${name}.png`, fullPage: w > 500 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  console.log(name, overflow > 0 ? `OVERFLOW ${overflow}` : 'ok')
  await page.close()
}
await browser.close()
