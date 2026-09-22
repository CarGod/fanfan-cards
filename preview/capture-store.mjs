// Run through ego-browser nodejs (helpers are provided by Ego).
if (!process.env.EGO_TASK_SPACE || !process.env.FANFAN_ASSET_DIR) throw new Error('Set EGO_TASK_SPACE and FANFAN_ASSET_DIR (absolute output directory)')
const t = await taskSpace(Number(process.env.EGO_TASK_SPACE))
const p = t.page('p1')
const fs = await import('node:fs/promises')
const out = process.env.FANFAN_ASSET_DIR + '/'
await fs.mkdir(out, { recursive: true })
for (const [name, width, height, query] of [['promo-440x280',440,280,''], ['promo-1400x560',1400,560,'&wide=1'], ['promo-440x280-en',440,280,'&lang=en']]) {
  await p.goto('http://localhost:5199/?store=promo' + query)
  await p.waitForSelector('.promo-tile')
  await p.cdp('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false})
  const result = await p.cdp('Page.captureScreenshot', {format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}})
  await fs.writeFile(out + name + '.png', Buffer.from(result.data, 'base64'))
  console.log(name + '.png')
}
for (const lang of ['zh', 'en']) {
  for (const [n, slug, scene] of [[1,'context','reader'],[2,'fanfan','highlight&card=hidden'],[3,'revisit','highlight'],[4,'review','app'],[5,'youtube','youtube']]) {
    await p.goto(`http://localhost:5199/?store=${scene}&theme=light&lang=${lang}${n === 4 ? '#/flashcard' : ''}`)
    await p.waitForSelector('.store-frame')
    if (n === 2 || n === 3) await p.waitForFunction(() => [...CSS.highlights.values()].some(h => h.size > 0))
    if (n === 4) {
      await p.waitForSelector('.btn-primary')
      await p.click('.btn-primary')
      await p.waitForSelector('.flash-card')
      await p.click('.flash-card')
      await p.waitForSelector('.grade-row')
    }
    await p.cdp('Emulation.setDeviceMetricsOverride', {width:1280,height:800,deviceScaleFactor:1,mobile:false})
    const r = await p.cdp('Page.captureScreenshot', {format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:1280,height:800,scale:1}})
    const name = `shot-${n}-${slug}${lang === 'en' ? '-en' : ''}.png`
    await fs.writeFile(out + name, Buffer.from(r.data,'base64'))
    console.log(name)
  }
}
