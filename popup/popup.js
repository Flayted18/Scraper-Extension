document.addEventListener('DOMContentLoaded', () => {
    updateUI();

    document.getElementById('refreshBtn').addEventListener('click', updateUI);
    document.getElementById('clearBtn').addEventListener('click', clearData);
    document.getElementById('downloadBtn').addEventListener('click', downloadCSV);

    const deepBtn = document.getElementById('deepScrapeBtn');
    deepBtn.addEventListener('click', () => {
        // Send message to content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "toggleDeepScrape" }, (response) => {
                    // Optional: Update UI based on response state
                    if (chrome.runtime.lastError) console.log("Content script not ready");
                });
            }
        });
        window.close(); // Close popup to let it work
    });
});

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
        tr.innerHTML = `
      <td title="${lead.name}">${lead.name || '-'}</td>
      <td>${lead.rating || '-'}</td>
      <td title="${lead.phone}">${lead.phone || '-'}</td>
    `;
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

    const headers = ['Nombre', 'Teléfono', 'Ubicación', 'Website', 'Email', 'Rating', 'Categoría', 'Link'];
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
