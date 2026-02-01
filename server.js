require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-001" });

// Helper: AI URL Guesser (Now with Fallback)
async function getUrlFromClientName(name) {
    // If it looks like a URL, just return it
    if (name.includes('.') && !name.includes(' ')) {
        return name.startsWith('http') ? name : `https://${name}`;
    }

    console.log(`Guessing URL for: ${name}`);
    try {
        const prompt = `What is the official homepage URL for the brand "${name}"? Reply with ONLY the URL.`;
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) {
        // CRITICAL FALLBACK: If AI fails, tell user to type URL manually
        throw new Error("AI is offline (Quota Reached). Please enter the full URL (e.g., https://nike.com) instead of the name.");
    }
}

app.post('/analyze', async (req, res) => {
    const { clientInput } = req.body;
    let browser = null;

    // DEFAULT MOCK DATA (Prevents 'undefined' errors)
    let analysis = {
        mood: "Waiting for AI...",
        gsap_ease: "power1.out",
        animation_advice: "Analysis pending."
    };
    let finalButtons = [];
    let fontUrls = new Set();
    let url = "";

    try {
        // 1. Get URL
        url = await getUrlFromClientName(clientInput);
        console.log(`Analyzing: ${url}`);

        // 2. Launch Puppeteer
        browser = await puppeteer.launch({
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1600, height: 1000 });

        page.on('response', (resp) => {
            if (resp.request().resourceType() === 'font') fontUrls.add(resp.url());
        });

        // 'domcontentloaded' triggers as soon as HTML/CSS is ready (much faster)
        // Increase timeout to 60 seconds (60000ms) just in case
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // 3. Scrape Buttons
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
            const filtered = allElements.filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 30 && rect.height > 20 && isVisible(el);
            });

            return filtered.map((el, index) => {
                const rect = el.getBoundingClientRect();
                const visualNode = getVisualNode(el);
                const s = window.getComputedStyle(visualNode);
                el.setAttribute('data-puppeteer-id', index);

                let score = 0;
                const relativeY = rect.top / window.innerHeight;
                if (relativeY > 0.1 && relativeY < 0.6) score += 50;
                if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') score += 20;
                if (rect.width > 100) score += 10;

                return {
                    id: index,
                    text: el.innerText.substring(0, 25).trim() || "Icon/Image",
                    score: score,
                    defaultStyle: {
                        bg: s.backgroundColor,
                        color: s.color,
                        radius: s.borderRadius,
                        font: s.fontFamily.split(',')[0].replace(/"/g, '')
                    }
                };
            }).sort((a, b) => b.score - a.score).slice(0, 6);
        });

        // 4. Hover Loop
        for (const btn of candidates) {
            try {
                const handle = await page.$(`[data-puppeteer-id="${btn.id}"]`);
                if (handle) {
                    await handle.hover();
                    await new Promise(r => setTimeout(r, 400));
                    const hoverData = await page.evaluate((el) => {
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
                        const v = getVisualNode(el);
                        const s = window.getComputedStyle(v);
                        return { bg: s.backgroundColor, color: s.color };
                    }, handle);
                    finalButtons.push({ ...btn, hoverStyle: hoverData });
                }
            } catch (e) {
                finalButtons.push(btn);
            }
        }

        const siteData = await page.evaluate(() => {
            const bodyStyle = window.getComputedStyle(document.body);
            return { backgroundColor: bodyStyle.backgroundColor };
        });

        await browser.close();

        // 5. Try AI Analysis
        try {
            const prompt = `
                Site BG: ${siteData.backgroundColor}
                Buttons Found: ${JSON.stringify(finalButtons.slice(0, 2))}
                Return JSON with:
                1. "mood": 3 words description.
                2. "gsap_ease": Best GSAP ease.
                3. "animation_advice": 1 sentence.
            `;
            const aiResult = await model.generateContent(prompt);
            const aiText = aiResult.response.text();
            analysis = JSON.parse(aiText.replace(/```json/g, '').replace(/```/g, ''));
        } catch (aiError) {
            // LOG THE REAL REASON
            console.error("❌ ACTUAL AI ERROR:", aiError.message);
            console.error("Full details:", JSON.stringify(aiError, null, 2));
            
            // Only say "Quota Hit" if it actually is one
            let moodMsg = "AI Error (Check Logs)";
            if (aiError.message.includes('429')) moodMsg = "Quota Limit Reached";
            if (aiError.message.includes('API_KEY')) moodMsg = "Missing API Key";

            analysis = { 
                mood: moodMsg, 
                gsap_ease: "power2.out (Fallback)", 
                animation_advice: "AI failed. Scraper data below is real." 
            };
        }

        // 6. Send Response (Guaranteed to have data)
        res.json({
            url: url,
            fonts: Array.from(fontUrls),
            buttons: finalButtons,
            analysis: analysis
        });

    } catch (error) {
        console.error("Main Process Error:", error.message);
        if (browser) await browser.close();

        // Pass the error to the frontend
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));