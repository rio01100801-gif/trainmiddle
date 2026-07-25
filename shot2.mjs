import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1240, height: 1200 }, deviceScaleFactor: 2 });
await p.goto('file:///home/claude/train800/design/screens.html');
await p.waitForTimeout(300);
await p.screenshot({ path: '/home/claude/screens.png', fullPage: true });
await b.close();
