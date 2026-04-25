chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractEmail" && request.url) {
    extractEmailFromUrl(request.url)
      .then(email => sendResponse({ email }))
      .catch(error => {
        console.log("Email extraction failed:", error?.message || error);
        sendResponse({ email: "" });
      });
    return true; // Keep the message channel open for async response
  }
});

async function extractEmailFromUrl(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds timeout

    // Add https:// if missing
    let targetUrl = url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    const response = await fetch(targetUrl, {
      signal: controller.signal
      // Note: 'User-Agent' is a forbidden header in service workers and cannot be set
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return "";
    }

    const text = await response.text();

    // Regular expression to find emails
    // Broader regex capturing standard email formats, plus handling URL encoding
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    
    // Also specifically look for mailto: links which are more reliable
    const mailtoRegex = /href=["']mailto:([^"'?>\s]+)/gi;

    let emails = new Set();

    // 1. Check mailto links first (most reliable)
    let match;
    while ((match = mailtoRegex.exec(text)) !== null) {
      try {
        const email = decodeURIComponent(match[1]).trim();
        if (isValidEmail(email)) emails.add(email.toLowerCase());
      } catch(e) {}
    }

    // 2. ALWAYS scan the rest of the page for emails as well
    const allMatches = text.match(emailRegex);
    if (allMatches) {
      for (const rawEmail of allMatches) {
        // Some emails in DOM are wrapped in unicode, or have %40 instead of @
        try {
          const email = decodeURIComponent(rawEmail).trim();
          if (isValidEmail(email) && !isFalsePositive(email)) {
            emails.add(email.toLowerCase());
          }
        } catch(e) {}
      }
    }

    // Return the first valid email found, or empty string
    return emails.size > 0 ? Array.from(emails)[0] : "";
    
  } catch (err) {
    // Expected: site may be down, refuse connections, or timeout
    const reason = err?.name === 'AbortError' ? 'timeout' : (err?.message || 'network error');
    console.log(`Fetch skipped for ${url}: ${reason}`);
    return "";
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isFalsePositive(email) {
  // Avoid common image files or CSS/JS false positives that look like emails
  const lower = email.toLowerCase();
  const invalidEndings = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.css', '.js'];
  const invalidDomains = ['example.com', 'domain.com', 'yourdomain.com', 'email.com', 'sentry.io'];
  
  if (invalidEndings.some(ext => lower.endsWith(ext))) return true;
  if (invalidDomains.some(domain => lower.includes(domain))) return true;
  if (lower.startsWith('info@') && lower.includes('example')) return true;
  
  return false;
}
