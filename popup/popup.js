document.addEventListener('DOMContentLoaded', () => {
    updateUI();

    document.getElementById('refreshBtn').addEventListener('click', updateUI);
    document.getElementById('clearBtn').addEventListener('click', clearSavedLeads);
    document.getElementById('downloadBtn').addEventListener('click', downloadCSV);
    document.getElementById('saveBtn').addEventListener('click', saveCurrentLeads);
    document.getElementById('clearSearchBtn').addEventListener('click', clearCurrentLeads);

    chrome.storage.local.get(['deepScraping'], (data) => {
        setScrapingUI(!!data.deepScraping);
    });

    const deepBtn = document.getElementById('deepScrapeBtn');
    deepBtn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0]?.id;
            if (!tabId) {
                alert("No se encontró una pestaña activa de Google Maps.");
                return;
            }

            const ok = confirm("¿Deseas comenzar el Deep Scrape?\nEsto controlará la pantalla e irá extrayendo nombre, horario, teléfono, website y dirección.");
            if (!ok) return;

            chrome.tabs.sendMessage(tabId, { action: "startDeepScrape" }, (response) => {
                if (chrome.runtime.lastError) {
                    alert("Error: El content script no está listo. Recarga la pestaña de Google Maps.");
                    return;
                }
                window.close();
            });
        });
    });

    const stopBtn = document.getElementById('stopBtn');
    stopBtn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "stopDeepScrape" }, () => {
                    if (chrome.runtime.lastError) console.log("Content script not ready");
                    window.close();
                });
            } else {
                window.close();
            }
        });
    });
});

function setScrapingUI(isScraping) {
    const deepBtn = document.getElementById('deepScrapeBtn');
    const stopBtn = document.getElementById('stopBtn');

    if (isScraping) {
        deepBtn.style.display = 'none';
        stopBtn.style.display = '';

        if (!document.getElementById('scrapingBanner')) {
            const banner = document.createElement('div');
            banner.id = 'scrapingBanner';
            banner.className = 'scraping-banner';
            banner.innerHTML = '<div class="scraping-dot"></div> Deep Scrape activo...';
            const actions = document.querySelector('.actions');
            actions.parentNode.insertBefore(banner, actions);
        }
    } else {
        deepBtn.style.display = '';
        stopBtn.style.display = 'none';
        const banner = document.getElementById('scrapingBanner');
        if (banner) banner.remove();
    }
}

async function updateUI() {
    const data = await chrome.storage.local.get(['leads', 'savedLeads']);
    const leads = data.leads || [];
    const savedLeads = data.savedLeads || [];

    document.getElementById('count').textContent = leads.length;
    document.getElementById('savedCount').textContent = savedLeads.length;
    document.getElementById('status').textContent = 'Activo';

    const tbody = document.getElementById('previewBody');
    tbody.innerHTML = '';

    document.getElementById('downloadBtn').disabled = savedLeads.length === 0;
    document.getElementById('saveBtn').disabled = leads.length === 0;
    document.getElementById('clearSearchBtn').disabled = leads.length === 0;

    if (leads.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="3">Navega en Google Maps para detectar negocios...</td></tr>';
        return;
    }

    const previewLeads = leads.slice().reverse().slice(0, 10);

    previewLeads.forEach(lead => {
        const tr = document.createElement('tr');

        const tdName = document.createElement('td');
        tdName.title = lead.name || '';
        tdName.textContent = lead.name || '-';

        const tdPhone = document.createElement('td');
        tdPhone.title = lead.phone || '';
        tdPhone.textContent = lead.phone || '-';

        const tdWebsite = document.createElement('td');
        tdWebsite.title = lead.website || '';
        if (lead.website) {
            try {
                tdWebsite.textContent = new URL(lead.website).hostname.replace(/^www\./, '');
            } catch(e) {
                tdWebsite.textContent = lead.website;
            }
        } else {
            tdWebsite.textContent = '-';
        }

        tr.appendChild(tdName);
        tr.appendChild(tdPhone);
        tr.appendChild(tdWebsite);
        tbody.appendChild(tr);
    });
}

async function saveCurrentLeads() {
    const tabId = await getActiveTabId();
    if (!tabId) return;

    chrome.tabs.sendMessage(tabId, { action: "getLeads" }, async (response) => {
        if (chrome.runtime.lastError) {
            alert("Error: Recarga la pestaña de Google Maps.");
            return;
        }

        const leads = response?.leads || [];
        const savedData = await chrome.storage.local.get(['savedLeads']);
        const savedLeads = savedData.savedLeads || [];

        // Count how many are already saved
        const existingLinks = new Set(savedLeads.map(l => l.link));
        const newLeads = leads.filter(l => !existingLinks.has(l.link));
        const totalAfter = savedLeads.length + newLeads.length;

        const ok = confirm(`Se guardarán ${leads.length} negocios nuevos.\nTotal acumulado: ${totalAfter} negocios.\n¿Continuar?`);
        if (!ok) return;

        // Send save command to content script
        chrome.tabs.sendMessage(tabId, { action: "saveLeadsToStorage" }, () => {
            if (chrome.runtime.lastError) {
                // Fallback: save directly from popup
                const merged = [...savedLeads];
                leads.forEach(lead => {
                    if (!merged.some(l => l.link === lead.link)) {
                        merged.push(lead);
                    }
                });
                chrome.storage.local.set({ savedLeads: merged, leads: [] });
            }
        });

        updateUI();
    });
}

async function getActiveTabId() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve(tabs[0]?.id || null);
        });
    });
}

function clearSavedLeads() {
    if (confirm('¿Estás seguro de que quieres borrar TODOS los negocios guardados?')) {
        chrome.storage.local.remove('savedLeads', () => {
            updateUI();
        });
    }
}

async function clearCurrentLeads() {
    const tabId = await getActiveTabId();
    if (!tabId) return;

    chrome.tabs.sendMessage(tabId, { action: "getLeads" }, (response) => {
        const leads = response?.leads || [];
        if (leads.length === 0) return;

        const ok = confirm(`¿Borrar los ${leads.length} negocios de esta búsqueda? (No afecta los guardados)`);
        if (!ok) return;

        chrome.tabs.sendMessage(tabId, { action: "clearCurrentLeads" }, () => {
            if (chrome.runtime.lastError) {
                chrome.storage.local.set({ leads: [] });
            }
            updateUI();
        });
    });
}

async function downloadCSV() {
    const data = await chrome.storage.local.get(['savedLeads']);
    const leads = data.savedLeads || [];

    if (leads.length === 0) return;

    const headers = ['Nombre', 'Horario', 'Teléfono', 'Website', 'Dirección', 'Link'];
    const csvContent = [
        headers.join(','),
        ...leads.map(lead => {
            return [
                escapeCSV(lead.name),
                escapeCSV(lead.hours),
                escapeCSV(lead.phone),
                escapeCSV(lead.website),
                escapeCSV(lead.address),
                escapeCSV(lead.link)
            ].join(',');
        })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `leads_google_maps_${new Date().toISOString().slice(0, 10)}.csv`);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function escapeCSV(str) {
    if (!str) return '';
    const string = String(str);
    if (string.includes(',') || string.includes('"') || string.includes('\n')) {
        return `"${string.replace(/"/g, '""')}"`;
    }
    return string;
}