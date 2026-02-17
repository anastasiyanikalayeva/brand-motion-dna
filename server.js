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

            // RECURSIVE DEEP SEARCH FOR COLOR
            function findColoredNode(node) {
                if (!node) return null;
                const s = window.getComputedStyle(node);
                if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent' && s.backgroundColor !== 'rgba(255, 255, 255, 0)') return node;
                if (parseInt(s.borderWidth) > 0 && s.borderColor !== 'rgba(0, 0, 0, 0)' && s.borderColor !== 'transparent') return node;

                let bestChild = null;
                let maxArea = 0;
                const allDescendants = node.querySelectorAll('*');
                for (let child of allDescendants) {
                    const childS = window.getComputedStyle(child);
                    const isColored = (childS.backgroundColor !== 'rgba(0, 0, 0, 0)' && childS.backgroundColor !== 'transparent');
                    if (isColored) {
                        const rect = child.getBoundingClientRect();
                        const area = rect.width * rect.height;
                        if (area > maxArea) {
                            maxArea = area;
                            bestChild = child;
                        }
                    }
                }
                return bestChild || node;
            }

            // --- THE ANTI-COOKIE FORCE FIELD ---
            function isCookieArtifact(el, text) {
                const t = text.toLowerCase();
                // 1. Keyword Blacklist (English + Polish + Common)
                const badWords = [
                    'cookie', 'cookies', 'plik', 'pliki', // Basic
                    'accept', 'akceptuj', 'agree', 'zgoda', 'zezwól', // Actions
                    'privacy', 'polityka', 'policy', 'prywatności', // Legal
                    'settings', 'ustawienia', 'preferences', 'preferencje', // Config
                    'partner', 'vendor', 'dostawc', 'rodo', 'gdpr', // Legal
                    'close', 'zamknij', 'x', 'got it', 'rozumiem' // Dismiss
                ];
                
                if (badWords.some(w => t.includes(w))) return true;

                // 2. ID/Class Blacklist (Common Providers)
                const htmlStr = el.outerHTML.toLowerCase();
                const badIDs = ['onetrust', 'cookie', 'consent', 'didomi', 'osano', 'usercentrics', 'gdpr', 'rodo'];
                if (badIDs.some(id => htmlStr.includes(id))) return true;

                // 3. Parent Container Check
                // Walk up 3 levels to see if we are in a cookie banner container
                let parent = el.parentElement;
                let depth = 0;
                while (parent && depth < 4) {
                    const pClass = (parent.className || "").toString().toLowerCase();
                    const pId = (parent.id || "").toString().toLowerCase();
                    if (badIDs.some(bad => pClass.includes(bad) || pId.includes(bad))) return true;
                    parent = parent.parentElement;
                    depth++;
                }

                return false;
            }

            const allElements = Array.from(document.querySelectorAll('a, button, div[role="button"], input[type="submit"]'));
            
            return allElements
                .filter(el => {
                    const rect = el.getBoundingClientRect();
                    return rect.width > 30 && rect.height > 20 && isVisible(el);
                })
                .map((el, index) => {
                    const rect = el.getBoundingClientRect();
                    const visualNode = findColoredNode(el);
                    const s = window.getComputedStyle(visualNode);
                    
                    let text = el.innerText.trim();
                    if (!text) text = el.getAttribute('aria-label') || "";
                    if (!text) text = visualNode.innerText.trim();
                    
                    let score = 0;
                    
                    // --- SCORING LOGIC ---
                    
                    // 1. Cookie Penalty (DEATH SENTENCE)
                    if (isCookieArtifact(el, text)) {
                        score = -1000; // Impossible to recover
                    } else {
                        // 2. Hero Zone Bonus (Top of screen, but not Nav)
                        const relativeY = rect.top / window.innerHeight;
                        if (relativeY > 0.15 && relativeY < 0.65) score += 50; 
                        
                        // 3. Size Bonus
                        if (rect.width > 120 && rect.height > 35) score += 20;
                        
                        // 4. Color Bonus
                        const isTransparent = (s.backgroundColor === 'rgba(0, 0, 0, 0)' || s.backgroundColor === 'transparent');
                        if (!isTransparent) score += 30;
                        
                        // 5. Keyword Bonus (Action words)
                        const goodWords = ['shop', 'kup', 'buy', 'get', 'start', 'join', 'dołącz', 'odkryj', 'discover', 'zobacz', 'view', 'read'];
                        if (goodWords.some(w => text.toLowerCase().includes(w))) score += 40;
                    }

                    return {
                        id: index,
                        text: text.substring(0, 25).trim() || "Icon/Button",
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
                .filter(b => b.score > 0) // Only positive scores survive
                .sort((a, b) => b.score - a.score)
                .slice(0, 6);
        });

        // --- STEP 2: MOUSE HOVER ---
        for (const btn of candidates) {
            try {
                await page.mouse.move(btn.x, btn.y);
                await new Promise(r => setTimeout(r, 300));
                
                const hoverData = await page.evaluate((x, y) => {
                    const el = document.elementFromPoint(x, y);
                    if (!el) return null;
                    
                    function findColoredNode(node) {
                        if(!node) return null;
                        const s = window.getComputedStyle(node);
                        if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') return node;
                        const children = node.querySelectorAll('*'); 
                        for (let child of children) {
                            const cs = window.getComputedStyle(child);
                            if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') return child;
                        }
                        return node;
                    }

                    const v = findColoredNode(el);
                    const s = window.getComputedStyle(v);
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

        // --- STEP 3: AI ANALYSIS ---
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