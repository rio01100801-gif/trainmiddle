import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const pages = ["dashboard","setup","goal","calendar","results","analysis","race","meet","heat"];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = {};
for (const vp of [{name:"pc", width:1280, height:900}, {name:"sp", width:390, height:844}]) {
  const ctx = await b.newContext({ viewport: {width: vp.width, height: vp.height}, deviceScaleFactor: 1.5 });
  for (const pg of pages) {
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(`file:///home/claude/train800/harness/page.html?p=${pg}`);
    await p.waitForTimeout(600);
    // 横スクロール検出
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await p.screenshot({ path: `/home/claude/shots/${pg}_${vp.name}.png`, fullPage: true });
    if (errs.length || overflow > 2) errors[`${pg}_${vp.name}`] = { errs: errs.slice(0,3), overflow };
    await p.close();
  }
  await ctx.close();
}
await b.close();
console.log(Object.keys(errors).length === 0 ? "ALL CLEAN" : JSON.stringify(errors, null, 1));
