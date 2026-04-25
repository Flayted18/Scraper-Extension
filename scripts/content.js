console.log("Google Maps Scraper: Extension Loaded (V3 - Fixes)");

let leads = [];
let observer = null;
let isScraping = true;
let isDeepScraping = false;
let deepScrapeIndex = 0;

const DELAY = {
    MIN_CLICK: 3000,
    MAX_CLICK: 6000,
    MIN_WAIT: 2500,
    MAX_WAIT: 5000
};

// UI Elements for Status
let statusUI = null;
let statusText = null;

function createStatusUI() {
    // If the element was created before but got removed from DOM (e.g., after SPA navigation
    // caused a full DOM swap), reset the references so we can recreate it.
    if (statusUI && !document.body.contains(statusUI)) {
        statusUI = null;
        statusText = null;
    }
    if (statusUI) return;
    statusUI = document.createElement('div');
    statusUI.style.position = 'fixed';
    statusUI.style.bottom = '20px';
    statusUI.style.right = '20px';
    statusUI.style.width = '320px';
    statusUI.style.backgroundColor = '#202124';
    statusUI.style.color = '#fff';
    statusUI.style.padding = '15px';
    statusUI.style.borderRadius = '8px';
    statusUI.style.boxShadow = '0 4px 6px rgba(0,0,0,0.5)';
    statusUI.style.zIndex = '999999';
    statusUI.style.fontFamily = 'Arial, sans-serif';
    statusUI.style.fontSize = '13px';
    statusUI.style.display = 'none';
    
    const header = document.createElement('div');
    header.innerText = '⚡ Maps Scraper - Estado';
    header.style.fontWeight = 'bold';
    header.style.marginBottom = '10px';
    header.style.color = '#fbbc04';
    header.style.borderBottom = '1px solid #5f6368';
    header.style.paddingBottom = '8px';
    
    statusText = document.createElement('div');
    statusText.style.maxHeight = '180px';
    statusText.style.overflowY = 'auto';
    statusText.style.lineHeight = '1.6';
    
    statusUI.appendChild(header);
    statusUI.appendChild(statusText);
    document.body.appendChild(statusUI);
}

function logStatus(msg) {
    console.log(msg);
    if (!statusUI) createStatusUI();
    statusUI.style.display = 'block';

    const line = document.createElement('div');
    line.innerText = `> ${msg}`;
    line.style.marginBottom = '4px';
    statusText.appendChild(line);

    // Limit lines to prevent memory bloat during long scraping sessions
    while (statusText.children.length > 40) {
        statusText.removeChild(statusText.firstChild);
    }

    // Scroll the overflowing container, not the parent
    requestAnimationFrame(() => {
        statusText.scrollTop = statusText.scrollHeight;
    });
}

function hideStatusUI() {
    if (statusUI) statusUI.style.display = 'none';
}

// Start delayed until end of script

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // startDeepScrape: triggered by popup after user confirmed
    if (request.action === "startDeepScrape") {
        sendResponse({ status: "started" });
        if (!isDeepScraping) {
            isDeepScraping = true;
            deepScrapeIndex = 0;
            if (isContextValid()) chrome.storage.local.set({ deepScraping: true });
            createStatusUI();
            logStatus("Iniciando Deep Scrape...");
            deepScrapeLoop();
        }
    }
    // stopDeepScrape: triggered by Stop button in popup
    if (request.action === "stopDeepScrape") {
        sendResponse({ status: "stopped" });
        if (isDeepScraping) {
            isDeepScraping = false;
            if (isContextValid()) chrome.storage.local.set({ deepScraping: false });
            logStatus("Deep Scrape detenido desde el popup.");
            setTimeout(hideStatusUI, 4000);
        }
    }
    return false;
});

function initialize() {
    if (!isContextValid()) return;

    // Load leads from storage once at startup
    chrome.storage.local.get(['leads'], (result) => {
        if (result.leads) leads = result.leads;
    });

    startFeedDetection();
    startNavigationWatcher();
}

// Finds the feed in the DOM and attaches the observer.
// Called on first load and again on every SPA navigation.
function startFeedDetection() {
    const checkFeed = setInterval(() => {
        if (!isContextValid()) { clearInterval(checkFeed); return; }
        const feed = document.querySelector('div[role="feed"]');
        if (feed) {
            clearInterval(checkFeed);
            console.log("Maps Scraper: Feed found. Starting observer.");
            parseList(feed);
            startObserver(feed);
        }
    }, 1000);
}

// Watches for Google Maps SPA navigations (URL changes without a page reload).
// When a new search is performed, reattaches the observer to the new feed node.
let navigationWatcherStarted = false;
function startNavigationWatcher() {
    if (navigationWatcherStarted) return;
    navigationWatcherStarted = true;

    let currentUrl = location.href;
    setInterval(() => {
        if (!isContextValid()) return;
        if (location.href !== currentUrl) {
            currentUrl = location.href;
            console.log('Maps Scraper: URL changed, reattaching observer...');
            // NOTE: We do NOT reload leads from storage — the in-memory array
            // keeps accumulating across all searches in this tab.
            startFeedDetection();
        }
    }, 1500);
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
    if (!isDeepScraping) {
        if (confirm("¿Deseas comenzar el Deep Scrape?\nEsto controlará la pantalla e irá extrayendo los correos lentamente para evitar congelamientos.")) {
            isDeepScraping = true;
            deepScrapeIndex = 0;
            if (isContextValid()) chrome.storage.local.set({ deepScraping: true });
            createStatusUI();
            logStatus("Iniciando Deep Scrape...");
            deepScrapeLoop();
        }
    } else {
        isDeepScraping = false;
        if (isContextValid()) chrome.storage.local.set({ deepScraping: false });
        logStatus("Deep Scrape detenido por el usuario.");
        setTimeout(hideStatusUI, 5000);
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
                logStatus(`Buscando más resultados... (Actuales: ${items.length})`);
                feed.scrollTop = feed.scrollHeight; // Scroll to bottom
                await sleep(randomInt(3000, 5000)); // Wait for load

                // Double check if new items loaded
                const newCards = document.querySelectorAll('div[role="article"]');
                if (newCards.length <= items.length) {
                    // Retry once more
                    logStatus("Reintentando scroll...");
                    feed.scrollTop = feed.scrollHeight - 200;
                    await sleep(2500);
                    feed.scrollTop = feed.scrollHeight;
                    await sleep(4000);

                    const retryCards = document.querySelectorAll('div[role="article"]');
                    if (retryCards.length <= items.length) {
                        logStatus("Fin de la lista alcanzado.");
                        isDeepScraping = false;
                        if (isContextValid()) chrome.storage.local.set({ deepScraping: false });
                        alert(`Deep Scrape finalizado. Total capturados: ${leads.length}`);
                        setTimeout(hideStatusUI, 5000);
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

        // Grab current h1 text before clicking, so we know what to wait to change
        const oldH1 = document.querySelector('h1.DUwDvf');
        const oldTitle = oldH1 ? oldH1.innerText.trim() : "";

        // Human delay before click
        await sleep(randomInt(DELAY.MIN_CLICK, DELAY.MAX_CLICK));

        link.click();
        logStatus(`Abriendo negocio ${deepScrapeIndex + 1} de ${items.length}...`);

        await waitForDetails(oldTitle);
        logStatus(`Esperando que cargue la información...`);
        await sleep(2500);

        const data = await scrapeDetails();
        data.link = link.href; // Attach the Maps URL so updateLead can deduplicate by URL
        logStatus(`Datos guardados: ${data.name.substring(0, 25)}...`);

        updateLead(data);
        deepScrapeIndex++;

        // Final sleep before next item to let browser breathe
        await sleep(randomInt(1000, 2500));
    }
}

function waitForDetails(oldTitle) {
    return new Promise(resolve => {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            const h1 = document.querySelector('h1.DUwDvf');
            // Resolve if:
            // 1. We found an h1 AND its text is different from the old one (new panel loaded)
            // 2. OR we exceeded max attempts (12 seconds)
            if ((h1 && h1.innerText.trim() !== oldTitle) || attempts > 60) {
                clearInterval(interval);
                resolve();
            }
        }, 200);
    });
}

// Remove dead fetchWebsiteContent placeholder (replaced by background.js)

async function scrapeDetails() {
    const nameNode = document.querySelector('h1.DUwDvf');
    const name = nameNode ? cleanName(nameNode.innerText) : "Unknown";
    let phone = "";
    let website = "";
    let address = "";
    let rating = "";
    let category = "";
    let email = "";

    // 1. Phone Extraction
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

    // 2. Website Extraction
    // Strict lookup: The primary website almost always has data-item-id="authority"
    const authorityBtn = document.querySelector('a[data-item-id="authority"]');
    if (authorityBtn) {
        website = authorityBtn.href;
    } else {
        // Fallback: Check elements with the CsEnBe class, but explicitly ignore whatsapp links
        const websiteDivs = document.querySelectorAll('div.CsEnBe, a.CsEnBe');
        for (const div of websiteDivs) {
            let possibleUrl = "";
            if (div.tagName === 'A') possibleUrl = div.href;
            else if (div.parentElement && div.parentElement.tagName === 'A') possibleUrl = div.parentElement.href;
            else possibleUrl = div.innerText;

            if (possibleUrl && !possibleUrl.includes('wa.me') && !possibleUrl.includes('whatsapp.com')) {
                website = possibleUrl;
                break;
            }
        }
    }

    // 3. Category Extraction (DkEaL class)
    const categoryBtn = document.querySelector('button.DkEaL');
    if (categoryBtn) {
        category = categoryBtn.innerText;
    }

    // 4. Fallbacks for missing info via standard buttons and item IDs
    const buttons = Array.from(document.querySelectorAll('button[data-item-id], a[data-item-id], button[aria-label], a[href]'));

    buttons.forEach(btn => {
        const aria = (btn.getAttribute('aria-label') || "").toLowerCase();
        const href = btn.href || "";
        const itemId = (btn.getAttribute('data-item-id') || "").toLowerCase();
        const iconImg = btn.querySelector('img');
        const iconSrc = iconImg ? iconImg.src : "";

        // Phone Fallback
        if (!phone) {
            if (itemId.startsWith("phone:tel:") || href.startsWith("tel:")) {
                phone = href.replace('tel:', '') || itemId.replace('phone:tel:', '');
            } else if (iconSrc.includes("phone")) {
                phone = btn.innerText || aria;
            }
        }

        // Website Fallback (ignoring Whatsapp)
        if (!website) {
            const isWhatsapp = href.includes('wa.me') || href.includes('whatsapp.com');
            if (!isWhatsapp) {
                if (itemId === "authority" || aria.includes("website") || aria.includes("sitio web")) {
                    website = href;
                } else if (iconSrc.includes("public")) {
                    website = href;
                }
            }
        }

        // Address Fallback
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

    // 5. Email Extraction (via Background Script)
    if (website && !website.includes("google.com")) {
        logStatus(`Buscando correo en: ${website}`);
        if (isContextValid()) {
            try {
                const response = await chrome.runtime.sendMessage({ action: "extractEmail", url: website });
                if (response && response.email) {
                    email = response.email;
                    logStatus(`¡Correo encontrado!: ${email}`);
                } else {
                    logStatus(`Sin correo en el sitio web.`);
                }
            } catch (e) {
                console.log("Error buscando correo:", e.message);
                logStatus(`Error buscando correo.`);
            }
        }
    }

    return { name, phone, website, address, rating, category, email };
}

function updateLead(data) {
    if (!isContextValid()) return;

    // Match by URL (link) first for accuracy — this correctly merges a passively-detected
    // lead (which has a link) with its deep-scraped details. Fall back to name match.
    let index = data.link ? leads.findIndex(l => l.link === data.link) : -1;
    if (index < 0) index = leads.findIndex(l => l.name === data.name);

    if (index >= 0) {
        leads[index] = { ...leads[index], ...data, timestamp: Date.now() };
    } else {
        leads.push({ ...data, timestamp: Date.now() });
    }

    try {
        chrome.storage.local.set({ leads: leads });
    } catch (e) {
        console.log("Could not save leads: extension context invalidated.");
    }
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
                email: "",
                timestamp: Date.now()
            });
            newCount++;
        }
    });

    if (newCount > 0) {
        console.log(`Passive Scrape: Added ${newCount} leads.`);
        if (!isContextValid()) return;
        try {
            chrome.storage.local.set({ leads: leads });
        } catch (e) {
            console.log("Could not save leads: extension context invalidated.");
        }
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

// Checks if the extension context is still valid.
// When the extension is reloaded while a Maps tab is open, the content script
// becomes orphaned and all chrome.* API calls will throw "Extension context invalidated".
function isContextValid() {
    try {
        return !!chrome.runtime?.id;
    } catch (e) {
        return false;
    }
}

// Start
initialize();
