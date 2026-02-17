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
        await new Promise(r => setTimeout(r, 2500)); 

        // --- STEP 1: FIND BUTTONS ---
        const candidates = await page.evaluate(() => {
            function isVisible(el) {
                const s = window.getComputedStyle(el);
                return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
            }

            // RECURSIVE PAINT HUNTER
            function findColoredNode(node) {
                if (!node) return null;
                const s = window.getComputedStyle(node);
                
                // Check Self
                if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent' && s.backgroundColor !== 'rgba(255, 255, 255, 0)') return node;
                if (parseInt(s.borderWidth) > 0 && s.borderColor !== 'rgba(0, 0, 0, 0)' && s.borderColor !== 'transparent') return node;

                // Check Children (Deep)
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

            // Anti-Cookie Force Field
            function isCookieArtifact(text) {
                const t = text.toLowerCase();
                const badWords = ['cookie', 'accept', 'akceptuj', 'zgoda', 'agree', 'privacy', 'polityka', 'settings', 'ustawienia', 'close', 'zamknij'];
                return badWords.some(w => t.includes(w));
            }

            const allElements = Array.from(document.querySelectorAll('a, button, div[role="button"], input[type="submit"]'));
            
            return allElements.map((el, index) => {
                const rect = el.getBoundingClientRect();
                
                if (rect.width < 30 || rect.height < 15) return null;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return null;

                // Hunt for Paint
                const visualNode = findColoredNode(el);
                const s = window.getComputedStyle(visualNode);
                
                // If transparent, kill it
                const isTransparent = (s.backgroundColor === 'rgba(0, 0, 0, 0)' || s.backgroundColor === 'transparent');
                const hasBorder = (parseInt(s.borderWidth) > 0 && s.borderColor !== 'transparent');
                
                if (isTransparent && !hasBorder) return null;

                let text = el.innerText.trim();
                if (!text) text = el.getAttribute('aria-label') || "";
                if (!text) text = visualNode.innerText.trim();
                
                let score = 0;
                if (isCookieArtifact(text)) score = -500;
                
                const relativeY = rect.top / window.innerHeight;
                if (relativeY > 0.1 && relativeY < 0.6) score += 50;
                if (!isTransparent) score += 20; 
                if (rect.width > 100) score += 10;
                
                const goodWords = ['shop', 'kup', 'buy', 'get', 'start', 'discover'];
                if (goodWords.some(w => text.toLowerCase().includes(w))) score += 40;

                return {
                    id: index,
                    text: text.substring(0, 25).trim() || "Button",
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
            .filter(item => item !== null && item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 6);
        });

        // --- STEP 2: MOUSE HOVER (UPGRADED) ---
        for (const btn of candidates) {
            try {
                // 1. Move Mouse
                await page.mouse.move(btn.x, btn.y);
                
                // 2. WAIT LONGER (600ms) for CSS transitions
                await new Promise(r => setTimeout(r, 600));
                
                const hoverData = await page.evaluate((x, y) => {
                    const el = document.elementFromPoint(x, y);
                    if (!el) return null;

                    // 3. COPY OF THE EXACT SAME "PAINT HUNTER" LOGIC
                    function findColoredNode(node) {
                        if (!node) return null;
                        const s = window.getComputedStyle(node);
                        if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') return node;
                        if (parseInt(s.borderWidth) > 0 && s.borderColor !== 'rgba(0, 0, 0, 0)') return node;
                        
                        // Deep Search Children
                        let bestChild = null;
                        let maxArea = 0;
                        const allDescendants = node.querySelectorAll('*');
                        for (let child of allDescendants) {
                            const cs = window.getComputedStyle(child);
                            const isColored = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent');
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

                    // 4. Try the element hit by mouse
                    let visual = findColoredNode(el);
                    let s = window.getComputedStyle(visual);
                    
                    // 5. If still transparent, Try the PARENT (Wrapper logic)
                    if (s.backgroundColor === 'rgba(0, 0, 0, 0)' && el.parentElement) {
                        visual = findColoredNode(el.parentElement);
                        s = window.getComputedStyle(visual);
                    }

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

        // --- STEP 3: AI ANALYSIS (Groq) ---
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