require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const Groq = require("groq-sdk");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function getUrlFromClientName(name) {
    if (name.includes('.') && !name.includes(' ')) {
        return name.startsWith('http') ? name : `https://${name}`;
    }
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
        await new Promise(r => setTimeout(r, 2500)); // Wait a bit longer for hydration

        // --- THE PAINT HUNTER SCRAPER ---
        const candidates = await page.evaluate(() => {
            
            // 1. Helper: Is it actually colored?
            function isColorVisible(color) {
                return color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent' && color !== 'rgba(255, 255, 255, 0)';
            }

            // 2. Helper: Recursive Search for the PAINT (Style)
            function getVisibleStyle(node) {
                if (!node) return null;
                
                const s = window.getComputedStyle(node);
                const before = window.getComputedStyle(node, '::before');
                const after = window.getComputedStyle(node, '::after');

                // Check Element itself
                if (isColorVisible(s.backgroundColor)) return s;
                if (parseInt(s.borderWidth) > 0 && isColorVisible(s.borderColor)) return s;

                // Check Pseudo ::before
                if (isColorVisible(before.backgroundColor)) return before;
                
                // Check Pseudo ::after
                if (isColorVisible(after.backgroundColor)) return after;

                // Check Children (Deep Dive)
                // We prioritize children that look like buttons
                const children = node.querySelectorAll('*');
                let bestStyle = null;
                let maxArea = 0;

                for (let child of children) {
                    const cs = window.getComputedStyle(child);
                    if (isColorVisible(cs.backgroundColor)) {
                        const rect = child.getBoundingClientRect();
                        const area = rect.width * rect.height;
                        if (area > maxArea) {
                            maxArea = area;
                            bestStyle = cs;
                        }
                    }
                }
                return bestStyle; // Might be null if nothing found
            }

            // 3. Helper: Anti-Cookie Logic
            function isCookieArtifact(text) {
                const t = text.toLowerCase();
                const badWords = ['cookie', 'accept', 'akceptuj', 'zgoda', 'agree', 'privacy', 'polityka', 'settings', 'ustawienia', 'close', 'zamknij'];
                return badWords.some(w => t.includes(w));
            }

            // --- MAIN LOOP ---
            const allElements = Array.from(document.querySelectorAll('a, button, div[role="button"], input[type="submit"]'));
            
            const results = allElements.map((el, index) => {
                const rect = el.getBoundingClientRect();
                
                // Filter out tiny or invisible click targets
                if (rect.width < 30 || rect.height < 15) return null;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return null;

                // HUNT FOR PAINT
                const visibleStyle = getVisibleStyle(el);
                
                // GHOST BUSTER: If no color found anywhere in the tree, KILL IT.
                if (!visibleStyle) return null;

                let text = el.innerText.trim();
                if (!text) text = el.getAttribute('aria-label') || "";
                
                // SCORING
                let score = 0;
                
                // Cookie Penalty
                if (isCookieArtifact(text)) score = -500;
                
                // Position Bonus (Hero)
                const relativeY = rect.top / window.innerHeight;
                if (relativeY > 0.1 && relativeY < 0.6) score += 50;
                
                // Style Bonus
                score += 20; // It has color (we verified above)
                if (rect.width > 100) score += 10;
                
                // Keyword Bonus
                const goodWords = ['shop', 'kup', 'buy', 'get', 'start', 'discover'];
                if (goodWords.some(w => text.toLowerCase().includes(w))) score += 40;

                return {
                    id: index,
                    text: text.substring(0, 25).trim() || "Button",
                    score: score,
                    x: rect.x + (rect.width / 2),
                    y: rect.y + (rect.height / 2),
                    defaultStyle: {
                        bg: visibleStyle.backgroundColor,
                        color: visibleStyle.color,
                        radius: visibleStyle.borderRadius,
                        font: visibleStyle.fontFamily.split(',')[0].replace(/"/g, '')
                    }
                };
            })
            .filter(item => item !== null && item.score > 0) // STRICT FILTER
            .sort((a, b) => b.score - a.score)
            .slice(0, 6);

            return results;
        });

        // --- STEP 2: MOUSE HOVER ---
        for (const btn of candidates) {
            try {
                await page.mouse.move(btn.x, btn.y);
                await new Promise(r => setTimeout(r, 300));
                
                const hoverData = await page.evaluate((x, y) => {
                    const el = document.elementFromPoint(x, y);
                    if (!el) return null;

                    // Re-use logic to find color on the hovered element
                    function isColorVisible(color) {
                         return color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent';
                    }
                    
                    const s = window.getComputedStyle(el);
                    if (isColorVisible(s.backgroundColor)) return { bg: s.backgroundColor, color: s.color };

                    // Check deep if direct hit didn't have color
                    const children = el.querySelectorAll('*');
                    for (let child of children) {
                        const cs = window.getComputedStyle(child);
                        if (isColorVisible(cs.backgroundColor)) return { bg: cs.backgroundColor, color: cs.color };
                    }
                    return null;
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

        // --- STEP 3: AI ANALYSIS ---
        try {
            const prompt = `
                Analyze this website design data.
                Site BG: ${siteData.backgroundColor}
                Buttons Found: ${JSON.stringify(finalButtons.slice(0,2))}
                Return JSON: { "mood": "string", "gsap_ease": "string", "animation_advice": "string" }
            `;

            const completion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "You are a creative developer assistant. Output JSON only." },
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