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

let statusUI = null;
let statusText = null;

function createStatusUI() {
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

    while (statusText.children.length > 40) {
        statusText.removeChild(statusText.firstChild);
    }

    requestAnimationFrame(() => {
        statusText.scrollTop = statusText.scrollHeight;
    });
}

function hideStatusUI() {
    if (statusUI) statusUI.style.display = 'none';
}

function qs(selector, fallbackSelector) {
    const el = document.querySelector(selector);
    if (el) return el;
    return fallbackSelector ? document.querySelector(fallbackSelector) : null;
}

function qsa(selector, fallbackSelector) {
    const nodes = document.querySelectorAll(selector);
    if (nodes.length > 0) return nodes;
    return fallbackSelector ? document.querySelectorAll(fallbackSelector) : [];
}

function cleanHours(rawHours) {
    if (!rawHours) return "";
    let text = rawHours;
    // Remove "copiar el horario de atención" and following metadata
    text = text.replace(/^(?:copiar el horario de atenci[oó]n|informaci[oó]n sobre los horarios de mayor concurrencia)[\s\S]*/i, '');
    // Remove patterns like "Viernes, de 12 a 11 p.m., " prefix when followed by more days
    text = text.replace(/^([\wáéíóú]+,\s*de\s*[\d:]+\s*(?:a\.m\.|p\.m\.|am|pm)\s*,\s*)+/, '');
    // Clean up artifacts
    text = text.replace(/^[\s·•|]+/, '').trim();
    return text;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
    if (request.action === "stopDeepScrape") {
        sendResponse({ status: "stopped" });
        if (isDeepScraping) {
            isDeepScraping = false;
            if (isContextValid()) chrome.storage.local.set({ deepScraping: false });
            logStatus("Deep Scrape detenido desde el popup.");
            setTimeout(hideStatusUI, 4000);
        }
    }
    if (request.action === "saveLeadsToStorage") {
        if (!isContextValid()) { sendResponse({ status: "error", message: "Context invalid" }); return; }
        chrome.storage.local.get(['savedLeads'], (result) => {
            const savedLeads = result.savedLeads || [];
            const merged = [...savedLeads];
            leads.forEach(lead => {
                if (!merged.some(l => l.link === lead.link)) {
                    merged.push(lead);
                }
            });
            chrome.storage.local.set({ savedLeads: merged, leads: [] }, () => {
                leads = [];
                sendResponse({ status: "saved", count: merged.length });
            });
        });
        return true;
    }
    if (request.action === "clearCurrentLeads") {
        leads = [];
        if (isContextValid()) chrome.storage.local.set({ leads: [] });
        sendResponse({ status: "cleared" });
    }
    if (request.action === "getLeads") {
        sendResponse({ leads: leads });
    }
    return false;
});

function initialize() {
    if (!isContextValid()) return;

    chrome.storage.local.get(['leads'], (result) => {
        if (result.leads) leads = result.leads;
    });

    startFeedDetection();
    startNavigationWatcher();
}

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

async function deepScrapeLoop() {
    while (isDeepScraping) {
        if (!isContextValid()) break;
        const cards = Array.from(document.querySelectorAll('div[role="article"]'));
        const items = cards.filter(card => card.querySelector('a[href*="/maps/place/"]'));

        if (deepScrapeIndex >= items.length) {
            const feed = document.querySelector('div[role="feed"]');
            if (feed) {
                logStatus(`Buscando más resultados... (Actuales: ${items.length})`);
                feed.scrollTop = feed.scrollHeight;
                await sleep(randomInt(3000, 5000));

                const newCards = document.querySelectorAll('div[role="article"]');
                if (newCards.length <= items.length) {
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

        const oldH1 = qs('h1.DUwDvf', 'h1');
        const oldTitle = oldH1 ? oldH1.innerText.trim() : "";

        await sleep(randomInt(DELAY.MIN_CLICK, DELAY.MAX_CLICK));

        link.click();
        logStatus(`Abriendo negocio ${deepScrapeIndex + 1} de ${items.length}...`);

        await waitForDetails(oldTitle);
        logStatus(`Esperando que cargue la información...`);
        await sleep(2500);

        const data = await scrapeDetails();
        data.link = link.href;
        logStatus(`Datos guardados: ${data.name.substring(0, 25)}... (Tel: ${data.phone || 'N/A'})`);

        updateLead(data);
        deepScrapeIndex++;

        await sleep(randomInt(1000, 2500));
    }
}

function waitForDetails(oldTitle) {
    return new Promise(resolve => {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            const h1 = qs('h1.DUwDvf', 'h1');
            if ((h1 && h1.innerText.trim() !== oldTitle) || attempts > 60) {
                clearInterval(interval);
                resolve();
            }
        }, 200);
    });
}

async function scrapeDetails() {
    const nameNode = qs('h1.DUwDvf', 'h1');
    const name = nameNode ? cleanName(nameNode.innerText) : "Unknown";
    let phone = "";
    let website = "";
    let address = "";
    let hours = "";

    const infoTexts = Array.from(qsa('div.Io6YTe', 'div[class*="fontBody"]'));

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

    const authorityBtn = document.querySelector('a[data-item-id="authority"]');
    if (authorityBtn) {
        website = authorityBtn.href;
    } else {
        const websiteDivs = qsa('div.CsEnBe, a.CsEnBe', 'a[class*="CsEnB"]');
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

    const hoursBtn = qs('div[aria-label*="hours"], div[aria-label*="horario"]', 'div[data-item-id*="hours"]');
    if (hoursBtn) {
        hours = hoursBtn.getAttribute('aria-label') || hoursBtn.innerText;
        const match = hours.match(/(?:hours|horario)[:\s]?(.*)/i);
        if (match) hours = match[1].trim();
        hours = cleanHours(hours);
    }

    if (!hours) {
        const dayNames = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        for (const div of infoTexts) {
            const text = div.innerText.toLowerCase();
            if (dayNames.some(day => text.includes(day))) {
                hours = cleanHours(div.innerText.trim());
                if (hours) break;
            }
        }
    }

    const buttons = Array.from(document.querySelectorAll('button[data-item-id], a[data-item-id], button[aria-label], a[href]'));

    buttons.forEach(btn => {
        const aria = (btn.getAttribute('aria-label') || "").toLowerCase();
        const href = btn.href || "";
        const itemId = (btn.getAttribute('data-item-id') || "").toLowerCase();
        const iconImg = btn.querySelector('img');
        const iconSrc = iconImg ? iconImg.src : "";

        if (!phone) {
            if (itemId.startsWith("phone:tel:") || href.startsWith("tel:")) {
                phone = href.replace('tel:', '') || itemId.replace('phone:tel:', '');
            } else if (iconSrc.includes("phone")) {
                phone = btn.innerText || aria;
            }
        }

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

        if (!address) {
            if (itemId === "address" || aria.includes("address") || aria.includes("dirección")) {
                address = (aria.split(":").pop() || btn.innerText).trim();
            } else if (iconSrc.includes("pin")) {
                address = btn.innerText || aria;
            }
        }

        if (!hours) {
            if (itemId.includes("hours") || aria.includes("hours") || aria.includes("horario")) {
                hours = cleanHours((aria.split(":").pop() || btn.innerText).trim());
            }
        }
    });

    return { name, hours, phone, website, address };
}

function updateLead(data) {
    if (!isContextValid()) return;

    let index = data.link ? leads.findIndex(l => l.link === data.link) : -1;
    if (index < 0) index = leads.findIndex(l => l.name === data.name);

    if (index >= 0) {
        leads[index] = { ...leads[index], ...data, timestamp: Date.now() };
    } else {
        leads.push({ ...data, timestamp: Date.now() });
    }

    saveLeads();
}

function parseList(feedNode) {
    const cards = feedNode.querySelectorAll('div[role="article"]');

    if (cards.length === 0) return;

    let newCount = 0;

    cards.forEach(card => {
        const linkNode = card.querySelector('a[href*="/maps/place/"]');
        if (!linkNode) return;

        const url = linkNode.href;

        if (leads.some(l => l.link === url)) return;

        let name = "";
        const titleDiv = card.querySelector('.fontHeadlineSmall');
        if (titleDiv) {
            name = titleDiv.innerText;
        } else {
            name = linkNode.getAttribute('aria-label') || linkNode.innerText.split('\n')[0];
        }

        name = cleanName(name);

        if (name) {
            leads.push({
                name: name,
                link: url,
                hours: "",
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
        if (!isContextValid()) return;
        saveLeads();
    }
}

function cleanName(rawName) {
    if (!rawName) return "";
    let name = rawName.replace(/·\s*(Visited link|Vínculo visitado|Enlace visitado).*/i, "")
        .replace(/(Visited link|Vínculo visitado|Enlace visitado)$/i, "")
        .trim();
    name = name.replace(/[·•|]\s*$/, "").trim();
    return name;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1) + min); }

let saveTimeout = null;
function saveLeads() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        if (!isContextValid()) return;
        try {
            chrome.storage.local.set({ leads: leads });
        } catch (e) {
            console.log("Could not save leads: extension context invalidated.");
        }
    }, 300);
}

function isContextValid() {
    try {
        return !!chrome.runtime?.id;
    } catch (e) {
        return false;
    }
}

initialize();