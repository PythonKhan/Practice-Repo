// One-off: renders the app icons into public/icons/ (requires Playwright + Chromium).
const { chromium } = require('playwright');
const path = require('node:path');

const svg = (pad) => {
  const ticks = Array.from({ length: 60 }, (_, i) =>
    `<line x1="256" y1="${pad + 8}" x2="256" y2="${pad + 44}" stroke="#35a862" stroke-width="11" stroke-linecap="round" transform="rotate(${i * 6} 256 256)"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0f2033"/>${ticks}
  <text x="256" y="${pad ? 318 : 330}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${pad ? 170 : 210}" fill="#fff">10</text></svg>`;
};

(async () => {
  const browser = await chromium.launch();
  const out = path.join(__dirname, '..', 'public', 'icons');
  for (const [name, size, pad] of [['icon-192.png', 192, 40], ['icon-512.png', 512, 40], ['apple-touch-icon.png', 180, 40], ['icon-maskable-512.png', 512, 96]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg(pad)}`);
    await page.screenshot({ path: path.join(out, name) });
    await page.close();
  }
  await browser.close();
})();
