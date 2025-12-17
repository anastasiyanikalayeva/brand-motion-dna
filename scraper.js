// Run: npm install puppeteer
const puppeteer = require('puppeteer');

(async () => {
  const url = 'https://gsap.com'; // Hardcoded for testing
  console.log('Launching browser...');
  
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  console.log(`Going to ${url}...`);
  await page.goto(url, { waitUntil: 'networkidle0' });

  // 1. Get Title
  const title = await page.title();
  console.log(`Page Title: ${title}`);

  // 2. Simple Font Finder
  // (In the real tool, we will use network interception, but this is a quick test)
  const fonts = await page.evaluate(() => {
    // Find all computed styles
    const fontFaces = [];
    document.fonts.forEach(f => fontFaces.push(f.family));
    return [...new Set(fontFaces)]; // Unique fonts
  });
  
  console.log('Fonts Detected:', fonts);

  await browser.close();
})();