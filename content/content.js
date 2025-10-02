function extractMainContent() {
  const contentSelectors = [
    'article', '[role="main"]', 'main', '.article-content',
    '.post-content', '#content', '.entry-content'
  ];

  // First pass: try common semantic containers
  for (const selector of contentSelectors) {
    const found = document.querySelector(selector);
    if (found && getTextLength(found) > 200) return found;
  }

  // Second pass: text-density heuristic over divs
  const isNoise = (el) => {
    const noiseSelectors = ['nav','header','footer','aside'];
    if (el.closest(noiseSelectors.join(','))) return true;
    const cls = (el.className || '').toString().toLowerCase();
    const id = (el.id || '').toString().toLowerCase();
    const hay = cls + ' ' + id;
    return /\b(sidebar|nav|menu|footer|header|comment|comments|ad|ads|advert|promo|related|share|subscribe|signup|modal|popup|cookie|banner|breadcrumbs)\b/.test(hay);
  };

  let best = null;
  let bestLen = 0;

  const candidates = Array.from(document.querySelectorAll('div'))
    .filter((el) => !isNoise(el))
    .filter((el) => {
      // quick visibility + content check
      const visible = (el.offsetWidth + el.offsetHeight) > 0 || el.getClientRects().length > 0;
      if (!visible) return false;
      // prefer divs that contain paragraphs or substantial text
      const hasParagraph = el.querySelector('p');
      const quickLen = (el.innerText || '').trim().length;
      return hasParagraph || quickLen > 300;
    });

  for (const el of candidates) {
    const len = getTextLength(el);
    if (len > bestLen) {
      best = el;
      bestLen = len;
    }
  }

  // Fallback to body only if nothing reasonable found
  return best && bestLen > 200 ? best : document.body;
}

function getTextLength(el) {
  try {
    const clone = el.cloneNode(true);
    // Remove obviously non-content areas and scripts/styles
    const unwanted = clone.querySelectorAll(
      'script, style, nav, header, footer, aside, .advertisement, .ads, .ad, .promo, .related, ' +
      '.sidebar, .comments, [role="banner"], [role="navigation"], [role="complementary"], [hidden]'
    );
    unwanted.forEach((n) => n.remove());
    const text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length;
  } catch {
    return 0;
  }
}

function extractTextFromElement(element) {
  const clone = element.cloneNode(true);
  const unwanted = clone.querySelectorAll(
    'script, style, nav, header, footer, aside, .advertisement, ' +
    '.sidebar, .comments, [role="banner"], [role="navigation"], ' +
    '[role="complementary"], [hidden]'
  );
  unwanted.forEach(el => el.remove());
  
  const headlines = Array.from(clone.querySelectorAll('h1, h2, h3'))
    .map(h => h.textContent.trim());
  
  const paragraphs = Array.from(clone.querySelectorAll('p'))
    .map(p => p.textContent.trim())
    .filter(text => text.length > 20);
  
  const fullText = (clone.innerText || clone.textContent || '').trim().replace(/\s+/g, ' ');
  
  return {
    url: window.location.href,
    title: document.title,
    headlines,
    paragraphs,
    fullText: fullText.slice(0, 50000)
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_CONTENT') {
    const mainElement = extractMainContent();
    const content = extractTextFromElement(mainElement);
    sendResponse(content);
  }
});
