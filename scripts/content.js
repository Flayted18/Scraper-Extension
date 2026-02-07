console.log("Google Maps Scraper: Extension Loaded (V3 - Fixes)");

let leads = [];
let observer = null;
let isScraping = true;
let isDeepScraping = false;
let deepScrapeIndex = 0;

const DELAY = {
    MIN_CLICK: 1500,
    MAX_CLICK: 4000,
    MIN_WAIT: 1000,
    MAX_WAIT: 3000
};

// Start
initialize();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "toggleDeepScrape") {
        toggleDeepScrape();
        sendResponse({ status: isDeepScraping ? "started" : "stopped" });
    }
});

function initialize() {
    chrome.storage.local.get(['leads'], (result) => {
        if (result.leads) leads = result.leads;
    });

    // Try to find the feed continuously until it appears
    const checkFeed = setInterval(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) {
            clearInterval(checkFeed);
            console.log("Feed found. Starting observer.");

            // Auto-parse existing items immediately
            parseList(feed);

            startObserver(feed);
        }
    }, 1000);
}

function startObserver(feedNode) {
    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
        if (!isScraping || isDeepScraping) return;
        parseList(feedNode);
    });

    observer.observe(feedNode, { childList: true, subtree: true });
}

async function toggleDeepScrape() {
    isDeepScraping = !isDeepScraping;
    if (isDeepScraping) {
        if (confirm("Iniciar Deep Scrape? Esto tomará control de la navegación.")) {
            deepScrapeLoop();
        } else {
            isDeepScraping = false;
        }
    } else {
        // Stop called
        console.log("Deep Scrape stopped by user.");
    }
}

async function deepScrapeLoop() {
    while (isDeepScraping) {
        // Select cards, not just links, to be more precise
        const cards = Array.from(document.querySelectorAll('div[role="article"]'));
        const items = cards.filter(card => card.querySelector('a[href*="/maps/place/"]'));

        // Scroll logic update for 200+ items
        if (deepScrapeIndex >= items.length) {
            const feed = document.querySelector('div[role="feed"]');
            if (feed) {
                console.log(`Scrolling... Current items: ${items.length}`);
                feed.scrollTop = feed.scrollHeight; // Scroll to bottom
                await sleep(randomInt(2500, 4000)); // Wait for load

                // Double check if new items loaded
                const newCards = document.querySelectorAll('div[role="article"]');
                if (newCards.length <= items.length) {
                    // Retry once more
                    console.log("No new items, retrying scroll...");
                    feed.scrollTop = feed.scrollHeight - 200;
                    await sleep(2000);
                    feed.scrollTop = feed.scrollHeight;
                    await sleep(3000);

                    const retryCards = document.querySelectorAll('div[role="article"]');
                    if (retryCards.length <= items.length) {
                        console.log("End of list reached.");
                        isDeepScraping = false;
                        alert(`Deep Scrape finalizado. Total capturados: ${leads.length}`);
                        break;
                    }
                }
                continue;
            } else {
                break;
            }
        }

        const card = items[deepScrapeIndex];
        if (!card) { deepScrapeIndex++; continue; }

        const link = card.querySelector('a[href*="/maps/place/"]');
        if (!link) { deepScrapeIndex++; continue; }

        link.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Human delay before click
        await sleep(randomInt(DELAY.MIN_CLICK, DELAY.MAX_CLICK));

        link.click();
        console.log(`Deep Scrape: Processing item ${deepScrapeIndex + 1} / ${items.length}`);

        await waitForDetails();
        const data = scrapeDetails();

        updateLead(data);
        deepScrapeIndex++;
    }
}

function waitForDetails() {
    return new Promise(resolve => {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            const h1 = document.querySelector('h1.DUwDvf');
            if ((h1) || attempts > 30) {
                clearInterval(interval);
                resolve();
            }
        }, 200);
    });
}

// Placeholder for future feature
async function fetchWebsiteContent(url) {
    if (!url) return {};
    // TODO: Implement fetching logic (requires background script or CORS proxy)
    console.log("Future: Fetching content from", url);
    return {
        metaTitle: "",
        metaDescription: "",
        emails: []
    };
}

function scrapeDetails() {
    const nameNode = document.querySelector('h1.DUwDvf');
    const name = nameNode ? cleanName(nameNode.innerText) : "Unknown";
    let phone = "";
    let website = "";
    let address = "";
    let rating = "";
    let category = "";

    // 1. Phone Extraction (Io6YTe)
    const infoTexts = Array.from(document.querySelectorAll('div.Io6YTe'));
    const phoneRegex = /^(\+\d{1,3}[-. ]?)?\(?\d{2,4}\)?[-. ]?\d{3,4}[-. ]?\d{3,4}$/;

    for (const div of infoTexts) {
        const text = div.innerText.trim();
        const digits = text.replace(/\D/g, '').length;
        const letters = text.replace(/[^a-zA-Z]/g, '').length;

        if (digits > 6 && letters < 3) {
            if (!phone) {
                phone = text;
                console.log("Found phone:", phone);
            }
        }
    }

    // 2. Website Extraction (CsEnBe class or authority item)
    // Check specific class first (User suggestion)
    const websiteDiv = document.querySelector('div.CsEnBe, a.CsEnBe');
    if (websiteDiv) {
        // It might be a parent of the link or the link itself
        // Usually holds the text "website.com" but we need the href if it's a link
        if (websiteDiv.tagName === 'A') website = websiteDiv.href;
        else if (websiteDiv.parentElement.tagName === 'A') website = websiteDiv.parentElement.href;
        if (!website) website = websiteDiv.innerText; // Fallback to text
    }

    // 3. Category Extraction (DkEaL class)
    const categoryBtn = document.querySelector('button.DkEaL');
    if (categoryBtn) {
        category = categoryBtn.innerText;
    }

    // 4. Fallbacks for missing info via standard buttons
    const buttons = Array.from(document.querySelectorAll('button[data-item-id], a[data-item-id], button[aria-label], a[href]'));

    buttons.forEach(btn => {
        const aria = (btn.getAttribute('aria-label') || "").toLowerCase();
        const href = btn.href || "";
        const itemId = (btn.getAttribute('data-item-id') || "").toLowerCase();
        const iconImg = btn.querySelector('img');
        const iconSrc = iconImg ? iconImg.src : "";

        // Website Fallback
        if (!website) {
            if (itemId === "authority" || aria.includes("website") || aria.includes("sitio web")) {
                website = href;
            } else if (iconSrc.includes("public")) {
                website = href;
            }
        }

        // Address
        if (!address) {
            if (itemId === "address" || aria.includes("address") || aria.includes("dirección")) {
                address = (aria.split(":").pop() || btn.innerText).trim();
            } else if (iconSrc.includes("pin")) {
                address = btn.innerText || aria;
            }
        }
    });

    // Rating
    const stars = document.querySelector('span[aria-label*="stars"], span[aria-label*="estrellas"]');
    if (stars) rating = stars.getAttribute('aria-label');

    return { name, phone, website, address, rating, category };
}

function updateLead(data) {
    // Use link or name to identify? Name is unique enough for this context usually.
    const index = leads.findIndex(l => l.name === data.name);

    if (index >= 0) {
        leads[index] = { ...leads[index], ...data, timestamp: Date.now() };
    } else {
        leads.push({ ...data, timestamp: Date.now() });
    }

    chrome.storage.local.set({ leads: leads });
}

function parseList(feedNode) {
    // 1. Find all Card elements (Role Article)
    const cards = feedNode.querySelectorAll('div[role="article"]');

    if (cards.length === 0) return;

    let newCount = 0;

    cards.forEach(card => {
        // Find the main link
        const linkNode = card.querySelector('a[href*="/maps/place/"]');
        if (!linkNode) return;

        const url = linkNode.href;

        // Avoid duplicates based on URL
        if (leads.some(l => l.link === url)) return;

        // Extract Name
        let name = "";
        const titleDiv = card.querySelector('.fontHeadlineSmall');
        if (titleDiv) {
            name = titleDiv.innerText; // Best source, visual text
        } else {
            // Fallback to aria-label but clean it
            name = linkNode.getAttribute('aria-label') || linkNode.innerText.split('\n')[0];
        }

        name = cleanName(name);

        // Extract Rating (Partial)
        const ratingNode = card.querySelector('span[aria-label*="stars"], span[aria-label*="estrellas"]');
        const rating = ratingNode ? ratingNode.getAttribute('aria-label') : "";

        // Extract Phone (Visible in list sometimes?)
        // Usually not, but text might contain it.

        if (name) {
            leads.push({
                name: name,
                link: url,
                rating: rating,
                phone: "",
                website: "",
                address: "",
                timestamp: Date.now()
            });
            newCount++;
        }
    });

    if (newCount > 0) {
        console.log(`Passive Scrape: Added ${newCount} leads.`);
        chrome.storage.local.set({ leads: leads });
    }
}

function cleanName(rawName) {
    if (!rawName) return "";
    // Fix encoding issues if any literal characters ended up there (rare in JS strings but possible if double encoded)
    // Remove "Visited link" or "Vínculo visitado" or "Link turned" suffix
    let name = rawName.replace(/·\s*(Visited link|Vínculo visitado|Enlace visitado).*/i, "")
        .replace(/(Visited link|Vínculo visitado|Enlace visitado)$/i, "")
        .trim();

    // Remove trailing middots or separators often used by Google
    name = name.replace(/[·•|]\s*$/, "").trim();

    return name;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1) + min); }
