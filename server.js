const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const ANTHROPIC_API_KEY = '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';

// Main endpoint - generuje email pro jeden lead
app.post('/api/generate-email', async (req, res) => {
    try {
        const { lead, settings } = req.body;
        
        console.log(`Processing: ${lead.company}`);
        
        // 1. Vyhledat a načíst web
        const webInfo = await scrapeWeb(lead.company);
        
        // 2. Vygenerovat email pomocí AI
        const email = await generateEmail(lead, settings, webInfo);
        
        res.json({
            success: true,
            email: email,
            webInfo: webInfo
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Web scraping pomocí Puppeteer
async function scrapeWeb(companyName) {
    let browser;
    try {
        console.log(`Searching for: ${companyName}`);
        
        // Spustit browser
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
        
        const page = await browser.newPage();
        
        // Google search
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(companyName)}&hl=cs`;
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Najít první organický výsledek
        const firstLink = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            for (let link of links) {
                const href = link.href;
                if (href && href.startsWith('http') && 
                    !href.includes('google.com') && 
                    !href.includes('youtube.com')) {
                    return {
                        url: href,
                        title: link.textContent
                    };
                }
            }
            return null;
        });
        
        if (!firstLink) {
            await browser.close();
            return { found: false };
        }
        
        console.log(`Found: ${firstLink.url}`);
        
        // Načíst obsah webu
        await page.goto(firstLink.url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        const content = await page.evaluate(() => {
            // Odstranit scripty a styly
            const scripts = document.querySelectorAll('script, style, noscript');
            scripts.forEach(s => s.remove());
            
            const text = document.body.textContent || '';
            return text.replace(/\s+/g, ' ').trim().substring(0, 2000);
        });
        
        await browser.close();
        
        return {
            found: true,
            url: firstLink.url,
            title: firstLink.title,
            content: content,
            verified: content.toLowerCase().includes(companyName.toLowerCase())
        };
        
    } catch (error) {
        if (browser) await browser.close();
        console.error('Scraping error:', error);
        return { found: false };
    }
}

// AI generování emailu
async function generateEmail(lead, settings, webInfo) {
    try {
        const firstName = lead.name.split(' ')[0];
        const vocative = getVocative(firstName);
        
        let webContext = '';
        if (webInfo.found && webInfo.verified && webInfo.content) {
            webContext = `
WEB NALEZEN ✓:
URL: ${webInfo.url}
Obsah: ${webInfo.content.substring(0, 500)}

POUŽIJ konkrétní info z webu!
`;
        } else {
            webContext = `Web nenalezen.`;
        }
        
        const prompt = `Napiš krátký přátelský email (max 100 slov):

Lead: ${lead.name} (oslovení: ${vocative})
Firma: ${lead.company}

${webContext}

Email:
- "Dobrý den ${vocative}, děkuji za kontakt přes Facebook."
${webInfo.found ? '- Začni konkrétním complimentem z webu' : ''}
- Platforma: 180 000 lidí/měsíc
- 1 000 Kč/rok, poptávky
- ${settings.userName}, ${settings.userPhone}

Krátce!

JSON:
{"subject": "...", "body": "..."}`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 600,
                temperature: 0.7,
                messages: [{ role: 'user', content: prompt }]
            })
        });
        
        const data = await response.json();
        const text = data.content[0].text;
        const match = text.match(/\{[^}]+\}/);
        
        if (match) {
            return JSON.parse(match[0]);
        }
        
        throw new Error('Parse error');
        
    } catch (error) {
        console.error('AI error:', error);
        return {
            subject: `${lead.name}, nabídka`,
            body: `Dobrý den ${lead.name},\n\nděkuji za kontakt.\n\n${settings.userName}\n${settings.userPhone}`
        };
    }
}

function getVocative(name) {
    if (!name) return name;
    const n = name.toLowerCase();
    if (n.endsWith('a')) return name.slice(0, -1) + 'o';
    if (n.endsWith('el')) return name.slice(0, -2) + 'le';
    if (n.endsWith('ek')) return name.slice(0, -2) + 'ku';
    if (n.endsWith('r') || n.endsWith('n') || n.endsWith('t') || n.endsWith('l')) return name + 'e';
    return name + 'e';
}

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
