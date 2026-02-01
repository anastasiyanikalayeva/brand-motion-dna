require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 1. SETUP AI (Stable Model)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-001" });

// 2. ROBUST URL GUESSER (With Google Search Fallback)
async function getUrlFromClientName(name) {
    // If user typed a URL, use it
    if (name.includes('.') && !name.includes(' ')) {
        return name.startsWith('http') ? name : `https://${name}`;
    }
    
    console.log(`Guessing URL for: ${name}`);
    try {
        const prompt = `What is the official homepage URL for the brand "${name}"? Reply with ONLY the URL.`;
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) {
        console.error("⚠️ AI URL Guessing Failed:", e.message);
        // CRITICAL FALLBACK: Return Google Search URL so Puppeteer has something to load
        return `https://www.google.com/search?q=${encodeURIComponent(name)}`;
    }
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
        url = await getUrlFromClientName(clientInput);
        console.log(`Analyzing: ${url}`);

        // 3. LOW MEMORY CONFIGURATION
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage", // Uses /tmp instead of shared memory (Critical for Docker/Render)
                "--disable-gpu",           // Save RAM
                "--single-process",        // Save RAM (Experimental but good for Free Tier)
                "--no-zygote"
            ]
        });
        const page = await browser.newPage();
        
        // 4. BLOCK HEAVY ASSETS (Images/Video)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            // Block images, media (video), and analytics beacons to save RAM
            if (['image', 'media', 'stylesheet', 'font'].includes(resourceType) === false) {
                 // We MUST allow 'script' (for React) and 'stylesheet' (for colors)
            }
            
            if (resourceType === 'image' || resourceType === 'media') {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Large viewport needed for coordinate accuracy
        await page.setViewport({ width: 1440, height: 900 });

        page.on('response', (resp) => {
            if (resp.request().resourceType() === 'font') fontUrls.add(resp.url());
        });

        // Timeout 60s
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Short wait for React hydration
        await new Promise(r => setTimeout(r, 2000));

        // --- STEP 1: FIND BUTTONS & COORDINATES ---
        const candidates = await page.evaluate(() => {
            function isVisible(el) {
                const s = window.getComputedStyle(el);
                return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
            }
            function getVisualNode(node) {
                if (!node) return null;
                const s = window.getComputedStyle(node);
                if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') return node;
                // Check immediate children
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
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 6);
        });

        // --- STEP 2: MOUSE HOVER ---
        for (const btn of candidates) {
            try {
                await page.mouse.move(btn.x, btn.y);
                await new Promise(r => setTimeout(r, 300)); // Shorter wait to save time

                const hoverData = await page.evaluate((x, y) => {
                    const el = document.elementFromPoint(x, y);
                    if (!el) return null;
                    const s = window.getComputedStyle(el);
                    // Simple check for hover color change
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

        // --- STEP 3: AI ANALYSIS (With Logs) ---
        try {
            const prompt = `
                Site BG: ${siteData.backgroundColor}
                Buttons Found: ${JSON.stringify(finalButtons.slice(0,2))}
                Return JSON object with fields: mood, gsap_ease, animation_advice.
            `;
            const aiResult = await model.generateContent(prompt);
            const aiText = aiResult.response.text();
            analysis = JSON.parse(aiText.replace(/```json/g, '').replace(/```/g, ''));
        } catch (aiError) {
            console.error("❌ REAL AI ERROR:", aiError.message);
            
            let msg = "AI Error (Check Logs)";
            if(aiError.message.includes("403") || aiError.message.includes("API_KEY")) msg = "Missing/Invalid API Key";
            if(aiError.message.includes("404")) msg = "Model Not Found";
            
            analysis = { 
                mood: msg, 
                gsap_ease: "power2.out (Fallback)", 
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