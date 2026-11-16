// Screenshots of preview screens at desktop, laptop and phone widths.
// usage: node tools/ui-preview/shoot.mjs <outDir> [Screen[:path]] ...   (preview server must be running on :5199)
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const [out, ...targets] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const SIZES = { desktop: [1440, 900], laptop: [1280, 720], phone: [390, 844] }
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
for (const target of targets.length ? targets : ['CarePathways']) {
  const [screen, path] = target.split(':')
  for (const [name, [w, h]] of Object.entries(SIZES)) {
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    await page.goto(`http://localhost:5199/?screen=${screen}${path ? `&path=${encodeURIComponent(path)}` : ''}`)
    await page.waitForTimeout(1500)
    const file = `${out}/${screen}${path ? '-' + path.replace(/\W+/g, '') : ''}-${name}.png`
    await page.screenshot({ path: file, fullPage: false })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    console.log(file, overflow > 0 ? `HORIZONTAL OVERFLOW ${overflow}px` : 'no horizontal overflow')
    await page.close()
  }
}
await browser.close()
