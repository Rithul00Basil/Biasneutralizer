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
    const clone = cleanClone(el);
    const text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length;
  } catch { return 0; }
}

// Picks best article root AND returns a pre-cleaned clone to avoid double work
function pickBestContentRoot() {
  const candidates = [
    ...document.querySelectorAll('article, [role="main"], main, .article-content, .post-content, #content, .entry-content')
  ];
  let best = null, bestLen = 0, bestClean = null;

  function consider(el) {
    try {
      const c = cleanClone(el);
      const s = (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim();
      if (s.length > bestLen) { best = el; bestLen = s.length; bestClean = c; }
    } catch {}
  }

  if (candidates.length) candidates.forEach(consider);
  if (!best) {
    document.querySelectorAll('section, div').forEach(el => {
      if (el.closest('nav,header,footer,aside')) return;
      consider(el);
    });
  }

  if (!best || bestLen <= 200) {
    const bodyClean = cleanClone(document.body);
    return { element: document.body, cleanedClone: bodyClean, textLength: (bodyClean.innerText || '').length };
  }
  return { element: best, cleanedClone: bestClean, textLength: bestLen };
}

function extractTextFromElement(element) {
  const cleaned = element && element.__BN_CLEANED_CLONE__ ? element.__BN_CLEANED_CLONE__ : cleanClone(element || document.body);
  const headlines = Array.from(cleaned.querySelectorAll('h1, h2'))
    .map(h => h.textContent.trim()).filter(Boolean).slice(0, 5);
  const paraAll = Array.from(cleaned.querySelectorAll('p'))
    .map(p => p.textContent.trim()).filter(Boolean);
  const paragraphs = paraAll.slice(0, 25); // cap to reduce payload
  const rawText = (cleaned.innerText || cleaned.textContent || '').replace(/\s+/g, ' ').trim();
  const fullText = rawText.slice(0, Math.min(30000, rawText.length)); // 30k cap
  return { url: window.location.href, title: document.title, headlines, paragraphs, fullText };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_CONTENT') {
    const { element, cleanedClone } = pickBestContentRoot();
    try { Object.defineProperty(element, '__BN_CLEANED_CLONE__', { value: cleanedClone, enumerable: false }); } catch {}
    const content = extractTextFromElement(element);
    sendResponse(content);
  }
});
// ---- BiasNeutralizer: shared cleanup config (content.js) ----
const UNWANTED_SELECTORS = [
  'script','style','nav','header','footer','aside',
  '.advertisement','.ads','.ad','.promo','.related',
  '.sidebar','.comments',
  '[role="banner"]','[role="navigation"]','[role="complementary"]',
  '[hidden]'
].join(', ');

function cleanClone(el) {
  const clone = el.cloneNode(true);
  const unwanted = clone.querySelectorAll(UNWANTED_SELECTORS);
  unwanted.forEach(n => n.remove());
  return clone;
}
