document.addEventListener('DOMContentLoaded', () => {
    updateUI();

    document.getElementById('refreshBtn').addEventListener('click', updateUI);
    document.getElementById('clearBtn').addEventListener('click', clearData);
    document.getElementById('downloadBtn').addEventListener('click', downloadCSV);

    // Check if deep scrape is currently running
    chrome.storage.local.get(['deepScraping'], (data) => {
        setScrapingUI(!!data.deepScraping);
    });

    const deepBtn = document.getElementById('deepScrapeBtn');
    deepBtn.addEventListener('click', () => {
        // Get the tab ID first, THEN show confirm.
        // If we show confirm() first, Chrome may dismiss the popup before
        // the async tab query returns, breaking message delivery.
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0]?.id;
            if (!tabId) {
                alert("No se encontró una pestaña activa de Google Maps.");
                return;
            }

            const ok = confirm("¿Deseas comenzar el Deep Scrape?\nEsto controlará la pantalla e irá extrayendo los correos lentamente.");
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
    const container = document.querySelector('.container');

    if (isScraping) {
        deepBtn.style.display = 'none';
        stopBtn.style.display = '';

        // Insert scraping banner if not already there
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
    const data = await chrome.storage.local.get(['leads']);
    const leads = data.leads || [];

    // Update stats
    document.getElementById('count').textContent = leads.length;
    document.getElementById('status').textContent = 'Activo';

    // Update table
    const tbody = document.getElementById('previewBody');
    tbody.innerHTML = '';

    if (leads.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="3">Navega en Google Maps para detectar negocios...</td></tr>';
        document.getElementById('downloadBtn').disabled = true;
        return;
    }

    document.getElementById('downloadBtn').disabled = false;

    // Show last 10 (reversed)
    const previewLeads = leads.slice().reverse().slice(0, 10);

    previewLeads.forEach(lead => {
        const tr = document.createElement('tr');

        // Use textContent instead of innerHTML to prevent XSS
        // if a business name contains HTML special characters
        const tdName = document.createElement('td');
        tdName.title = lead.name || '';
        tdName.textContent = lead.name || '-';

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

        const tdEmail = document.createElement('td');
        tdEmail.title = lead.email || '';
        tdEmail.textContent = lead.email || '-';

        tr.appendChild(tdName);
        tr.appendChild(tdWebsite);
        tr.appendChild(tdEmail);
        tbody.appendChild(tr);
    });
}

function clearData() {
    if (confirm('¿Estás seguro de que quieres borrar todos los datos capturados?')) {
        chrome.storage.local.remove('leads', () => {
            updateUI();
        });
    }
}

async function downloadCSV() {
    const data = await chrome.storage.local.get(['leads']);
    const leads = data.leads || [];

    if (leads.length === 0) return;

    const headers = ['Nombre', 'Teléfono', 'Ubicación', 'Website', 'Email Extraído', 'Rating', 'Categoría', 'Link'];
    const csvContent = [
        headers.join(','),
        ...leads.map(lead => {
            return [
                escapeCSV(lead.name),
                escapeCSV(lead.phone),
                escapeCSV(lead.address),
                escapeCSV(lead.website),
                escapeCSV(lead.email),
                escapeCSV(lead.rating),
                escapeCSV(lead.category),
                escapeCSV(lead.link) // Maps link
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
