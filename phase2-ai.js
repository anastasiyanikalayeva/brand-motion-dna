require('dotenv').config();
const puppeteer = require('puppeteer');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// This alias automatically points to the currently available stable Flash model
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

(async () => {
  const url = 'https://gsap.com'; // You can change this to 'https://stripe.com' or others later
  console.log(`1. Launching browser to scan ${url}...`);

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  // Go to website
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // --- STEP A: SCRAPE DATA (The Hands) ---
  const scrapedData = await page.evaluate(() => {
    // 1. Get Body Background
    const bodyStyle = window.getComputedStyle(document.body);
    
    // 2. Find the biggest Heading (H1)
    const h1 = document.querySelector('h1');
    const h1Style = h1 ? window.getComputedStyle(h1) : null;

    // 3. Find a primary button (heuristic: looking for 'button' class or tag)
    // We grab the first <a> tag that looks like a button
    const btn = Array.from(document.querySelectorAll('a, button')).find(el => {
        const s = window.getComputedStyle(el);
        return s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent';
    });
    const btnStyle = btn ? window.getComputedStyle(btn) : null;

    return {
      backgroundColor: bodyStyle.backgroundColor,
      fontFamily: bodyStyle.fontFamily,
      headingFont: h1Style ? h1Style.fontFamily : 'Not found',
      headingColor: h1Style ? h1Style.color : 'Not found',
      buttonColor: btnStyle ? btnStyle.backgroundColor : 'Not found',
      buttonRadius: btnStyle ? btnStyle.borderRadius : 'Not found',
    };
  });

  console.log("2. Raw Data Extracted:", scrapedData);
  await browser.close();

  // --- STEP B: ANALYZE WITH AI (The Brain) ---
  console.log("3. Sending data to Gemini AI...");

  const prompt = `
    I am a Creative Developer building an HTML5 banner.
    Analyze this CSS data extracted from a client's website:
    ${JSON.stringify(scrapedData)}

    Please output a JSON object with 3 fields:
    1. "mood": A 3-word description of the brand vibe.
    2. "gsap_ease": The specific GSAP easing curve that fits this mood (e.g., "power2.out", "elastic.out").
    3. "animation_advice": A one-sentence recommendation for the banner animation style.
  `;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text();

  console.log("\n--- AI ANALYSIS RESULT ---");
  console.log(text);

})();