require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const Groq = require("groq-sdk"); // New AI Library

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 1. SETUP GROQ AI
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// 2. SIMPLE URL HELPER (No AI = No Quota used here)
function getUrlFromClientName(name) {
    // If user typed a URL, use it
    if (name.includes('.') && !name.includes(' ')) {
        return name.startsWith('http') ? name : `https://${name}`;
    }
    // If just a name, default to Google Search (Puppeteer will scrape Google results)
    console.log(`Input is a name. Defaulting to Google Search for: ${name}`);
    return `https://www.google.com/search?q=${encodeURIComponent(name)}`;
}

app.post('/analyze', async (req, res) => {
    const { clientInput } = req.body;
    let browser = null;
    let analysis = {
        mood: "Waiting for AI...",
        gsap_ease: "power2.out",
        animation_advice: "Analysis pending."
    };
    let finalButtons = [];
    let fontUrls = new Set();
    let url = "";

    try {
        url = getUrlFromClientName(clientInput);
        console.log(`Analyzing: ${url}`);

        // 3. LAUNCH PUPPETEER (Low Memory Config)
        browser = await puppeteer.launch({
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process", "--no-zygote"]
        });
        const page = await browser.newPage();
        
        // Block Heavy Assets
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const rType = req.resourceType();
            if (['image', 'media', 'stylesheet', 'font'].includes(rType) === false) {} 
            if (rType === 'image' || rType === 'media') req.abort();
            else req.continue();
        });

        await page.setViewport({ width: 1440, height: 900 });

        page.on('response', (resp) => {
            if (resp.request().resourceType() === 'font') fontUrls.add(resp.url());
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 2000));

        // --- STEP 1: FIND BUTTONS ---
        const candidates = await page.evaluate(() => {
            function isVisible(el) {
                const s = window.getComputedStyle(el);
                return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
            }
            function getVisualNode(node) {
                if (!node) return null;
                const s = window.getComputedStyle(node);
                if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') return node;
                const children = Array.from(node.children);
                for (let child of children) {
                    const childS = window.getComputedStyle(child);
                    if (childS.backgroundColor !== 'rgba(0, 0, 0, 0)' && childS.backgroundColor !== 'transparent') return child;
                }
                return node;
            }

            const allElements = Array.from(document.querySelectorAll('a, button, div[role="button"], input[type="submit"]'));
            
            return allElements.filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 30 && rect.height > 20 && isVisible(el);
            }).map((el, index) => {
                const rect = el.getBoundingClientRect();
                const visualNode = getVisualNode(el);
                const s = window.getComputedStyle(visualNode);
                
                let score = 0;
                const relativeY = rect.top / window.innerHeight;
                if (relativeY > 0.1 && relativeY < 0.6) score += 50; 
                if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') score += 20;
                if (rect.width > 100) score += 10;
                const txt = el.innerText.toLowerCase();
                if (['cookie', 'accept', 'privacy'].some(w => txt.includes(w))) score -= 50;

                return {
                    id: index,
                    text: el.innerText.substring(0, 25).trim() || "Icon/Button",
                    score: score,
                    x: rect.x + (rect.width / 2),
                    y: rect.y + (rect.height / 2),
                    defaultStyle: {
                        bg: s.backgroundColor,
                        color: s.color,
                        radius: s.borderRadius,
                        font: s.fontFamily.split(',')[0].replace(/"/g, '')
                    }
                };
            }).sort((a, b) => b.score - a.score).slice(0, 6);
        });

        // --- STEP 2: MOUSE HOVER ---
        for (const btn of candidates) {
            try {
                await page.mouse.move(btn.x, btn.y);
                await new Promise(r => setTimeout(r, 300));
                const hoverData = await page.evaluate((x, y) => {
                    const el = document.elementFromPoint(x, y);
                    if (!el) return null;
                    const s = window.getComputedStyle(el);
                    return { bg: s.backgroundColor, color: s.color };
                }, btn.x, btn.y);
                finalButtons.push({ ...btn, hoverStyle: hoverData || btn.defaultStyle });
            } catch (e) {
                finalButtons.push(btn);
            }
        }

        const siteData = await page.evaluate(() => {
            const bodyStyle = window.getComputedStyle(document.body);
            return { backgroundColor: bodyStyle.backgroundColor };
        });

        await browser.close();

        // --- STEP 3: AI ANALYSIS (USING GROQ) ---
        try {
            const prompt = `
                Analyze this website design data.
                Site BG: ${siteData.backgroundColor}
                Buttons Found: ${JSON.stringify(finalButtons.slice(0,2))}
                
                Return a JSON object with these 3 keys: 
                1. "mood": 3 words description.
                2. "gsap_ease": Best GSAP easing curve (e.g. power2.out).
                3. "animation_advice": 1 sentence advice.
            `;

            const completion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "You are a creative developer assistant. You MUST output valid JSON only." },
                    { role: "user", content: prompt }
                ],
                model: "llama-3.1-8b-instant",
                response_format: { type: "json_object" }
            });

            analysis = JSON.parse(completion.choices[0].message.content);

        } catch (aiError) {
            console.error("❌ GROQ AI ERROR:", aiError.message);
            analysis = { 
                mood: "AI Error", 
                gsap_ease: "power2.out", 
                animation_advice: "AI failed. Scraper data below is real." 
            };
        }

        res.json({
            url: url,
            fonts: Array.from(fontUrls),
            buttons: finalButtons,
            analysis: analysis
        });

    } catch (error) {
        console.error("CRITICAL ERROR:", error.message);
        if(browser) await browser.close();
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));