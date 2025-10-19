// ========== CONTENT EXTRACTION FUNCTIONS ==========

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

// ========== CHROME MESSAGE LISTENER ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_CONTENT') {
    const { element, cleanedClone } = pickBestContentRoot();
    try { Object.defineProperty(element, '__BN_CLEANED_CLONE__', { value: cleanedClone, enumerable: false }); } catch {}
    const content = extractTextFromElement(element);
    sendResponse(content);
  }

  if (message.type === 'HIGHLIGHT_DATA') {
    handleHighlightData(message.biasedPhrases, message.neutralPhrases);
  }
});

// ========== CLEANUP UTILITIES ==========

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

// ========== HIGHLIGHTING AND NEUTRALIZATION FEATURE ==========

let currentPopup = null;
let stylesInjected = false;

function injectHighlightStyles() {
  if (stylesInjected) return;

  const styleEl = document.createElement('style');
  styleEl.id = 'bias-neutralizer-styles';
  styleEl.textContent = `
    /* Highlight styles - Clean and minimal */
    .bias-highlight {
      background: linear-gradient(to bottom, rgba(251, 191, 36, 0.25), rgba(251, 191, 36, 0.35));
      border-bottom: 2px solid #F59E0B;
      cursor: pointer;
      padding: 1px 2px;
      border-radius: 2px;
      transition: all 0.2s ease;
    }

    .bias-highlight:hover {
      background: linear-gradient(to bottom, rgba(251, 191, 36, 0.35), rgba(251, 191, 36, 0.45));
      box-shadow: 0 2px 6px rgba(245, 158, 11, 0.2);
    }

    .neutral-highlight {
      background: linear-gradient(to bottom, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.25));
      border-bottom: 2px solid #10B981;
      cursor: pointer;
      padding: 1px 2px;
      border-radius: 2px;
      transition: all 0.2s ease;
    }

    .neutral-highlight:hover {
      background: linear-gradient(to bottom, rgba(16, 185, 129, 0.25), rgba(16, 185, 129, 0.35));
      box-shadow: 0 2px 6px rgba(16, 185, 129, 0.2);
    }

    /* Clean minimal popup - matches app theme */
    .neutralizer-popup {
      position: absolute;
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
      padding: 0;
      z-index: 999999;
      min-width: 340px;
      max-width: 420px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #fff;
      overflow: hidden;
      animation: popupFadeIn 0.2s ease;
    }

    @keyframes popupFadeIn {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    .popup-header {
      padding: 16px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
    }

    .popup-title {
      font-weight: 600;
      font-size: 13px;
      color: #FFA500;
      margin: 0 0 6px 0;
    }

    .popup-phrase {
      font-size: 14px;
      font-weight: 400;
      margin: 0;
      color: rgba(255, 255, 255, 0.95);
      line-height: 1.5;
      word-break: break-word;
    }

    .popup-body {
      padding: 16px 18px;
      color: rgba(255, 255, 255, 0.85);
      font-size: 13px;
      line-height: 1.6;
    }

    .popup-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgba(255, 255, 255, 0.5);
      margin-bottom: 8px;
    }

    .popup-explanation {
      color: rgba(255, 255, 255, 0.85);
      margin-bottom: 16px;
    }

    .popup-neutral-result {
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 8px;
      padding: 12px;
      margin-top: 16px;
      display: none;
    }

    .popup-neutral-result.visible {
      display: block;
      animation: slideDown 0.3s ease;
    }

    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .popup-neutral-text {
      color: rgba(255, 255, 255, 0.95);
      font-size: 13px;
      line-height: 1.6;
    }

    .popup-actions {
      display: flex;
      gap: 10px;
      padding: 16px 18px;
      background: rgba(0, 0, 0, 0.2);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .popup-btn {
      flex: 1;
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }

    .popup-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .popup-btn-primary {
      background: #3B82F6;
      color: white;
    }

    .popup-btn-primary:hover:not(:disabled) {
      background: #2563EB;
      transform: translateY(-1px);
    }

    .popup-btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.9);
    }

    .popup-btn-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.12);
    }

    /* Neutral popup - minimal tooltip style */
    .neutralizer-popup.neutral-popup {
      min-width: 280px;
      max-width: 320px;
      animation: popupFadeIn 0.2s ease;
    }

    .neutral-popup .popup-header {
      padding: 12px 16px;
      border: none;
      background: rgba(16, 185, 129, 0.1);
    }

    .neutral-popup .popup-title {
      color: #10B981;
      font-size: 12px;
      margin: 0;
    }

    .neutral-popup .popup-body {
      padding: 12px 16px;
      font-size: 12px;
    }

    .neutral-popup .popup-actions {
      padding: 10px 16px;
    }

    /* GPU-efficient loading spinner */
    .btn-spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 6px;
      vertical-align: middle;
    }

    /* Optimized spin animation using transform */
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* Typing dots animation (GPU-efficient) */
    .typing-dots {
      display: inline-flex;
      gap: 4px;
      align-items: center;
    }

    .typing-dots span {
      display: inline-block;
      width: 6px;
      height: 6px;
      background: currentColor;
      border-radius: 50%;
      opacity: 0.4;
      animation: typingDot 1.4s infinite ease-in-out;
    }

    .typing-dots span:nth-child(1) {
      animation-delay: 0s;
    }

    .typing-dots span:nth-child(2) {
      animation-delay: 0.2s;
    }

    .typing-dots span:nth-child(3) {
      animation-delay: 0.4s;
    }

    @keyframes typingDot {
      0%, 60%, 100% {
        opacity: 0.4;
        transform: scale(1);
      }
      30% {
        opacity: 1;
        transform: scale(1.3);
      }
    }

    /* Streaming cursor effect */
    .streaming::after,
    .popup-neutral-text.streaming::after {
      content: '▊';
      animation: blink 1s infinite;
      margin-left: 2px;
      color: #3B82F6;
    }

    @keyframes blink {
      0%, 50% {
        opacity: 1;
      }
      51%, 100% {
        opacity: 0;
      }
    }

    /* GPU warning style */
    .gpu-warning {
      margin-top: 8px;
      animation: slideIn 0.3s ease-out;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .neutralizer-popup-buttons {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }

    .neutralizer-popup button {
      flex: 1;
      padding: 8px 12px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s ease;
    }

    .neutralizer-popup-know-more {
      background-color: #007bff;
      color: white;
    }

    .neutralizer-popup-know-more:hover {
      background-color: #0056b3;
    }

    .neutralizer-popup-neutralize {
      background-color: #28a745;
      color: white;
    }

    .neutralizer-popup-neutralize:hover {
      background-color: #218838;
    }

    /* Modal overlay styles */
    .neutralizer-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      animation: fadeIn 0.2s ease;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    .neutralizer-overlay.closing {
      animation: fadeOut 0.2s ease;
    }

    .neutralizer-modal {
      background: white;
      border-radius: 12px;
      max-width: 800px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      animation: slideUp 0.3s ease;
      display: flex;
      flex-direction: column;
    }

    .neutralizer-modal.closing {
      animation: slideDown 0.2s ease;
    }

    .neutralizer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px;
      border-bottom: 1px solid #e0e0e0;
    }

    .neutralizer-header h3 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      color: #333;
    }

    .neutralizer-close {
      background: none;
      border: none;
      font-size: 28px;
      color: #999;
      cursor: pointer;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: all 0.2s ease;
    }

    .neutralizer-close:hover {
      background: #f5f5f5;
      color: #333;
    }

    .neutralizer-body {
      padding: 24px;
      flex: 1;
      overflow-y: auto;
    }

    .text-comparison {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 16px;
      align-items: start;
    }

    .original-section,
    .neutral-section,
    .suggested-alternative {
      border-radius: 8px;
      padding: 16px;
    }

    .original-section {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
    }

    .neutral-section {
      background-color: #e7f3ff;
      border-left: 4px solid #007bff;
    }

    .suggested-alternative {
      background-color: #e8f5e9;
      border-left: 4px solid #28a745;
      margin-top: 20px;
      grid-column: 1 / -1;
    }

    .section-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
      color: #666;
    }

    .text-content {
      font-size: 15px;
      line-height: 1.6;
      color: #333;
      word-wrap: break-word;
    }

    .text-content.streaming::after {
      content: '▊';
      animation: blink 1s infinite;
      margin-left: 2px;
    }

    .arrow-divider {
      font-size: 24px;
      color: #999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding-top: 30px;
    }

    .neutralizer-footer {
      padding: 16px 24px;
      border-top: 1px solid #e0e0e0;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }

    .neutralizer-close-btn {
      padding: 10px 24px;
      border: none;
      border-radius: 6px;
      background: #6c757d;
      color: white;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .neutralizer-close-btn:hover {
      background: #5a6268;
    }

    /* Loading states */
    .neutralizer-loading {
      text-align: center;
      padding: 40px 20px;
    }

    .neutralizer-spinner {
      width: 48px;
      height: 48px;
      border: 4px solid #f3f3f3;
      border-top: 4px solid #007bff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 16px;
    }

    .neutralizer-loading-text {
      font-size: 16px;
      color: #666;
      margin-bottom: 8px;
    }

    .neutralizer-loading-subtext {
      font-size: 14px;
      color: #999;
    }

    /* Progress bar */
    .neutralizer-progress {
      width: 100%;
      height: 8px;
      background: #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
      margin: 16px 0;
    }

    .neutralizer-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #007bff, #0056b3);
      border-radius: 4px;
      transition: width 0.3s ease;
      width: 0%;
    }

    .neutralizer-progress-text {
      text-align: center;
      font-size: 14px;
      color: #666;
      margin-top: 8px;
    }

    /* Download confirmation */
    .neutralizer-download-confirm {
      padding: 30px;
      text-align: center;
    }

    .neutralizer-download-confirm h4 {
      font-size: 18px;
      margin: 0 0 16px 0;
      color: #333;
    }

    .neutralizer-download-info {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
      text-align: left;
    }

    .neutralizer-download-info ul {
      margin: 12px 0;
      padding-left: 20px;
    }

    .neutralizer-download-info li {
      margin: 8px 0;
      color: #666;
      font-size: 14px;
    }

    .neutralizer-download-buttons {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-top: 24px;
    }

    .neutralizer-btn {
      padding: 12px 32px;
      border: none;
      border-radius: 6px;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .neutralizer-btn-primary {
      background: #28a745;
      color: white;
    }

    .neutralizer-btn-primary:hover {
      background: #218838;
    }

    .neutralizer-btn-secondary {
      background: #6c757d;
      color: white;
    }

    .neutralizer-btn-secondary:hover {
      background: #5a6268;
    }

    /* Error message */
    .neutralizer-error {
      background: #f8d7da;
      border: 1px solid #f5c6cb;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
      color: #721c24;
    }

    .neutralizer-error strong {
      display: block;
      margin-bottom: 8px;
      font-size: 15px;
    }

    .neutralizer-error-message {
      font-size: 14px;
      line-height: 1.5;
    }

    /* Success state */
    .neutralizer-success {
      text-align: center;
      padding: 20px;
      color: #28a745;
    }

    .neutralizer-success-icon {
      font-size: 48px;
      margin-bottom: 16px;
      animation: scaleRotate 0.5s ease;
    }

    /* Animations */
    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes fadeOut {
      from {
        opacity: 1;
      }
      to {
        opacity: 0;
      }
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes slideDown {
      from {
        opacity: 1;
        transform: translateY(0);
      }
      to {
        opacity: 0;
        transform: translateY(20px);
      }
    }

    @keyframes blink {
      0%, 50% {
        opacity: 1;
      }
      51%, 100% {
        opacity: 0;
      }
    }

    @keyframes spin {
      0% {
        transform: rotate(0deg);
      }
      100% {
        transform: rotate(360deg);
      }
    }

    @keyframes scaleRotate {
      0% {
        transform: scale(0) rotate(0deg);
      }
      50% {
        transform: scale(1.2) rotate(180deg);
      }
      100% {
        transform: scale(1) rotate(360deg);
      }
    }

    /* Responsive design */
    @media (max-width: 768px) {
      .text-comparison {
        grid-template-columns: 1fr;
        gap: 12px;
      }

      .arrow-divider {
        transform: rotate(90deg);
        padding: 12px 0;
      }

      .neutralizer-modal {
        width: 95%;
        max-height: 90vh;
      }

      .neutralizer-header {
        padding: 16px;
      }

      .neutralizer-body {
        padding: 16px;
      }

      .neutralizer-footer {
        padding: 12px 16px;
      }
    }

    /* Warning for metered connection */
    .neutralizer-warning {
      background: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 8px;
      padding: 12px 16px;
      margin: 16px 0;
      display: flex;
      align-items: start;
      gap: 12px;
    }

    .neutralizer-warning-icon {
      font-size: 24px;
      color: #856404;
      flex-shrink: 0;
    }

    .neutralizer-warning-text {
      font-size: 14px;
      color: #856404;
      line-height: 1.5;
    }
  `;

  document.head.appendChild(styleEl);
  stylesInjected = true;
  console.log('[BiasNeutralizer] Highlight styles injected');
}

function handleHighlightData(biasedPhrases, neutralPhrases) {
  console.log('[BiasNeutralizer] Highlight data received:', {
    biasedCount: biasedPhrases?.length || 0,
    neutralCount: neutralPhrases?.length || 0,
    sampleBiased: biasedPhrases?.[0],
    sampleNeutral: neutralPhrases?.[0]
  });

  // Inject styles first
  injectHighlightStyles();

  // Highlight biased phrases (orange/yellow)
  if (biasedPhrases && biasedPhrases.length > 0) {
    highlightPhrases(biasedPhrases, 'bias-highlight', 'biased');
  }

  // Highlight neutral/balanced phrases (green)
  if (neutralPhrases && neutralPhrases.length > 0) {
    highlightPhrases(neutralPhrases, 'neutral-highlight', 'neutral');
  }

  // Add global click listener for highlights
  setupHighlightClickListeners();
}

// ========== IMPROVED ROBUST HIGHLIGHTING ==========

/**
 * Main highlighting function - uses TreeWalker for robust text matching
 * More reliable than the original implementation
 */
function highlightPhrases(phrases, className, dataType) {
  if (!phrases || phrases.length === 0) return;

  console.log('[BiasNeutralizer] Highlighting', phrases.length, dataType, 'phrases with class', className);

  // Get the main content area
  const { element: contentRoot } = pickBestContentRoot();

  // Create a set to track which text ranges we've already highlighted
  const highlightedRanges = new Set();

  // Sort phrases by length (longest first) to handle overlapping matches better
  const sortedPhrases = [...phrases].sort((a, b) => {
    const phraseA = dataType === 'biased' ? a.phrase : a.example;
    const phraseB = dataType === 'biased' ? b.phrase : b.example;
    return (phraseB?.length || 0) - (phraseA?.length || 0);
  });

  // Process each phrase
  sortedPhrases.forEach(phraseObj => {
    try {
      highlightSinglePhrase(phraseObj, className, dataType, contentRoot, highlightedRanges);
    } catch (error) {
      console.warn('[BiasNeutralizer] Error highlighting phrase:', error);
    }
  });

  console.log('[BiasNeutralizer] Highlighting complete for', dataType, 'phrases');
}

/**
 * Highlight a single phrase using a more robust approach
 */
function highlightSinglePhrase(phraseObj, className, dataType, contentRoot, highlightedRanges) {
  // Extract phrase and metadata based on data type
  let phrase, explanation, neutralAlternative, phraseType;

  if (dataType === 'biased') {
    phrase = phraseObj.phrase;
    explanation = phraseObj.explanation || '';
    neutralAlternative = phraseObj.neutral_alternative || '';
    phraseType = phraseObj.type || '';
  } else if (dataType === 'neutral') {
    // Try multiple possible field names for neutral phrases
    phrase = phraseObj.example || phraseObj.phrase || phraseObj.text || '';
    
    // NEW: If still empty, extract from explanation as fallback
    if (!phrase && phraseObj.explanation) {
      // Extract first quoted text or first 50 chars from explanation
      const quotedMatch = phraseObj.explanation.match(/"([^"]+)"/);
      if (quotedMatch) {
        phrase = quotedMatch[1];
        console.log('[BiasNeutralizer] Extracted phrase from quotes in explanation:', phrase);
      } else {
        // Use first sentence or first 50 chars
        const sentences = phraseObj.explanation.split(/[.!?]/);
        phrase = sentences[0].slice(0, 50).trim();
        console.log('[BiasNeutralizer] Extracted phrase from explanation text:', phrase);
      }
    }
    
    explanation = phraseObj.explanation || '';
    neutralAlternative = '';
    phraseType = phraseObj.type || '';
  }

  // Defensive check after extraction
  if (!phrase || typeof phrase !== 'string') {
    console.warn('[BiasNeutralizer] Neutral phrase missing text:', phraseObj);
    return;
  }
  
  if (phrase.trim().length === 0) {
    console.warn('[BiasNeutralizer] Empty phrase text:', phraseObj);
    return;
  }

  // Use a more robust text search approach
  const matches = findTextMatches(phrase, contentRoot);

  matches.forEach(match => {
    try {
      // Check if this range overlaps with already highlighted text
      if (isRangeHighlighted(match.range, highlightedRanges)) {
        return;
      }

      // Create the highlight element
      const mark = document.createElement('mark');
      mark.className = className;
      mark.textContent = match.text;
      mark.setAttribute('data-original-phrase', phrase);
      mark.setAttribute('data-explanation', explanation);
      mark.setAttribute('data-neutral-alternative', neutralAlternative);
      mark.setAttribute('data-type', dataType);
      mark.setAttribute('data-phrase-type', phraseType);

      // Use Range.surroundContents for cleaner DOM manipulation
      try {
        match.range.surroundContents(mark);
        highlightedRanges.add(getRangeIdentifier(match.range));
      } catch (e) {
        // surroundContents fails if range partially selects nodes
        // Fall back to more complex but safer extraction method
        const extracted = match.range.extractContents();
        mark.appendChild(extracted);
        match.range.insertNode(mark);
        highlightedRanges.add(getRangeIdentifier(match.range));
      }
    } catch (error) {
      console.warn('[BiasNeutralizer] Failed to highlight match:', error);
    }
  });
}

/**
 * Find all text matches for a phrase within a container
 * Returns an array of {range, text} objects
 * Uses concatenated text search to handle phrases spanning HTML elements
 */
function findTextMatches(searchText, container) {
  const matches = [];
  const searchLower = searchText.toLowerCase().trim();
  if (!searchLower) return matches;

  // Collect all text nodes with their cumulative offset
  const textNodes = [];
  let cumulativeOffset = 0;

  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        // Skip already highlighted, scripts, styles, popups
        if (parent.classList?.contains('bias-highlight') ||
            parent.classList?.contains('neutral-highlight') ||
            parent.closest('script, style, noscript, .neutralizer-popup')) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent;
    textNodes.push({
      node: node,
      startOffset: cumulativeOffset,
      endOffset: cumulativeOffset + text.length,
      text: text
    });
    cumulativeOffset += text.length;
  }

  if (textNodes.length === 0) return matches;

  // Build concatenated text
  const fullText = textNodes.map(tn => tn.text).join('');
  const fullTextLower = fullText.toLowerCase();

  // Find all occurrences in concatenated text
  let searchPos = 0;
  while ((searchPos = fullTextLower.indexOf(searchLower, searchPos)) !== -1) {
    const matchEnd = searchPos + searchText.length;

    // Map back to DOM nodes
    const range = mapOffsetToRange(textNodes, searchPos, matchEnd);
    if (range) {
      matches.push({
        range: range,
        text: fullText.substring(searchPos, matchEnd)
      });
    }

    searchPos = matchEnd;
  }

  return matches;
}

/**
 * Helper: Map text offset to DOM Range
 * Handles phrases spanning multiple text nodes and HTML elements
 */
function mapOffsetToRange(textNodes, startOffset, endOffset) {
  let startNode = null, startPos = 0;
  let endNode = null, endPos = 0;

  for (const tn of textNodes) {
    if (!startNode && startOffset >= tn.startOffset && startOffset < tn.endOffset) {
      startNode = tn.node;
      startPos = startOffset - tn.startOffset;
    }

    if (!endNode && endOffset >= tn.startOffset && endOffset <= tn.endOffset) {
      endNode = tn.node;
      endPos = endOffset - tn.startOffset;
      break;
    } else if (!endNode && endOffset > tn.endOffset && endOffset <= tn.endOffset + textNodes[textNodes.indexOf(tn) + 1]?.text.length) {
      // Handle case where end is in next node
      continue;
    }
  }

  // If end wasn't found in exact node, search forward
  if (!endNode) {
    for (let i = textNodes.length - 1; i >= 0; i--) {
      const tn = textNodes[i];
      if (endOffset <= tn.endOffset) {
        endNode = tn.node;
        endPos = Math.min(endOffset - tn.startOffset, tn.text.length);
        break;
      }
    }
  }

  if (!startNode || !endNode) return null;

  try {
    const range = document.createRange();
    range.setStart(startNode, startPos);
    range.setEnd(endNode, endPos);
    return range;
  } catch (e) {
    console.warn('[BiasNeutralizer] Range creation failed:', e);
    return null;
  }
}

/**
 * Check if a range overlaps with already highlighted ranges
 */
function isRangeHighlighted(range, highlightedRanges) {
  const identifier = getRangeIdentifier(range);
  return highlightedRanges.has(identifier);
}

/**
 * Get a unique identifier for a range based on its position
 */
function getRangeIdentifier(range) {
  try {
    const startContainer = range.startContainer;
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;

    // Create a simple identifier based on node and offsets
    return `${startContainer.textContent}_${startOffset}_${endOffset}`;
  } catch (error) {
    return Math.random().toString(); // Fallback
  }
}

// ========== CLICK HANDLERS AND POPUPS ==========

function setupHighlightClickListeners() {
  // Remove existing to prevent duplicates
  document.removeEventListener('click', handleDocumentClick, true);

  // Add with capture phase for reliability
  document.addEventListener('click', handleDocumentClick, true);

  console.log('[BiasNeutralizer] Click listeners bound with capture phase');
}

function handleDocumentClick(event) {
  const target = event.target;

  // Log all clicks on highlights for debugging
  if (target.classList.contains('bias-highlight') || target.classList.contains('neutral-highlight')) {
    console.log('[BiasNeutralizer] Highlight clicked:', {
      type: target.classList.contains('bias-highlight') ? 'biased' : 'neutral',
      text: target.textContent,
      dataset: target.dataset
    });
  }

  // Check biased highlight
  if (target.classList.contains('bias-highlight')) {
    event.preventDefault();
    event.stopPropagation();
    showBiasedPopup(target);
    return;
  }

  // Check neutral highlight
  if (target.classList.contains('neutral-highlight')) {
    event.preventDefault();
    event.stopPropagation();
    showNeutralPopup(target);
    return;
  }

  // Close popup if clicked outside
  if (currentPopup && !currentPopup.contains(target) &&
      !target.closest('.bias-highlight, .neutral-highlight')) {
    closePopup();
  }
}

function showBiasedPopup(highlightElement) {
  closePopup();

  const originalPhrase = highlightElement.getAttribute('data-original-phrase');
  const explanation = highlightElement.getAttribute('data-explanation');
  const neutralAlternative = highlightElement.getAttribute('data-neutral-alternative');

  const popup = document.createElement('div');
  popup.className = 'neutralizer-popup';

  // Clean minimal design matching app theme
  popup.innerHTML = `
    <div class="popup-header">
      <div class="popup-title">Biased Language</div>
      <div class="popup-phrase">"${escapeHtml(originalPhrase)}"</div>
    </div>
    <div class="popup-body">
      <div class="popup-label">Why This Is Biased</div>
      <div class="popup-explanation">${escapeHtml(explanation || 'Loaded language detected')}</div>
      
      <div class="popup-neutral-result" id="neutral-result">
        <div class="popup-label">Neutralized Version</div>
        <div class="popup-neutral-text" id="neutral-text"></div>
      </div>
    </div>
    <div class="popup-actions">
      <button class="popup-btn popup-btn-secondary" id="learn-more-btn">Learn More</button>
      <button class="popup-btn popup-btn-primary" id="neutralize-btn">Neutralize</button>
    </div>
  `;

  document.body.appendChild(popup);
  positionPopup(popup, highlightElement);

  // Bind events
  popup.querySelector('#learn-more-btn').addEventListener('click', () => {
    handleKnowMore();
  });

  popup.querySelector('#neutralize-btn').addEventListener('click', () => {
    handleNeutralizeInPopup(originalPhrase, explanation, popup, neutralAlternative);
  });

  currentPopup = popup;
  console.log('[BiasNeutralizer] Biased popup shown');
}

/**
 * Neutralize text and show result in popup
 */
async function handleNeutralizeInPopup(originalText, explanation, popup, suggestedAlternative) {
  console.log('[BiasNeutralizer] Neutralizing:', originalText);

  const neutralBtn = popup.querySelector('#neutralize-btn');
  const neutralSection = popup.querySelector('#neutral-result');
  const neutralTextEl = popup.querySelector('#neutral-text');

  // Show loading state
  neutralBtn.disabled = true;
  neutralBtn.textContent = 'Neutralizing...';
  neutralSection.classList.add('visible');
  neutralTextEl.innerHTML = '<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>';

  try {
    // Check API support
    if (!('Rewriter' in self)) {
      throw new Error('REWRITER_NOT_SUPPORTED');
    }

    const availability = await Rewriter.availability();
    console.log('[BiasNeutralizer] Rewriter availability:', availability);

    if (availability === 'no') {
      throw new Error('MODEL_NOT_AVAILABLE');
    }

    if (availability === 'after-download') {
      neutralTextEl.innerHTML = '<div style="font-size: 12px;">Downloading AI model (22GB)...<br>This will take 10-30 minutes</div>';
    }

    // Create rewriter
    const rewriter = await Rewriter.create({
      sharedContext: `Rewrite biased language from news articles into neutral alternatives. Remove emotional language while preserving facts.`,
      tone: 'as-is',
      format: 'plain-text',
      length: 'as-is',
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const percent = Math.round(e.loaded * 100);
          neutralTextEl.innerHTML = `<div style="font-size: 12px;">Downloading: ${percent}%<br>Please keep this tab open</div>`;
        });
      }
    });

    currentRewriterSession = rewriter;

    // Stream the neutral version
    neutralTextEl.classList.add('streaming');
    neutralTextEl.textContent = '';

    const stream = await rewriter.rewriteStreaming(originalText, {
      context: `Remove bias: ${explanation}`
    });

    let fullText = '';
    for await (const chunk of stream) {
      fullText = chunk;
      neutralTextEl.textContent = `"${fullText}"`;
    }

    neutralTextEl.classList.remove('streaming');

    // Update button
    neutralBtn.textContent = 'Done';
    neutralBtn.disabled = true;

    console.log('[BiasNeutralizer] Neutralization complete');

  } catch (error) {
    console.error('[BiasNeutralizer] Neutralization failed:', error);
    
    if (error.message === 'REWRITER_NOT_SUPPORTED') {
      neutralTextEl.innerHTML = `
        <div style="color: #FFA500; font-size: 12px; margin-bottom: 8px;">On-device AI not available</div>
        ${suggestedAlternative ? `<div>"${escapeHtml(suggestedAlternative)}"</div><div style="font-size: 11px; opacity: 0.6; margin-top: 4px;">Suggested by analysis</div>` : '<div style="opacity: 0.7; font-size: 12px;">Try Cloud AI mode in settings</div>'}
      `;
    } else if (error.message === 'MODEL_NOT_AVAILABLE') {
      neutralTextEl.innerHTML = `
        <div style="color: #FFA500; font-size: 12px; margin-bottom: 8px;">Device doesn't support on-device AI</div>
        ${suggestedAlternative ? `<div style="margin-top: 8px;">"${escapeHtml(suggestedAlternative)}"</div><div style="font-size: 11px; opacity: 0.6; margin-top: 4px;">Suggested alternative</div>` : ''}
      `;
    } else {
      neutralTextEl.innerHTML = `
        <div style="color: #EF4444; font-size: 12px;">Error: ${escapeHtml(error.message)}</div>
        ${suggestedAlternative ? `<div style="margin-top: 8px;">"${escapeHtml(suggestedAlternative)}"</div><div style="font-size: 11px; opacity: 0.6; margin-top: 4px;">Suggested alternative</div>` : ''}
      `;
    }

    neutralBtn.textContent = 'Try Again';
    neutralBtn.disabled = false;
  }
}



function showNeutralPopup(highlightElement) {
  closePopup();

  const originalPhrase = highlightElement.getAttribute('data-original-phrase');
  const explanation = highlightElement.getAttribute('data-explanation');

  const popup = document.createElement('div');
  popup.className = 'neutralizer-popup neutral-popup';

  popup.innerHTML = `
    <div class="popup-header">
      <div class="popup-title">Neutral Language</div>
    </div>
    <div class="popup-body">
      <div class="popup-phrase">"${escapeHtml(originalPhrase)}"</div>
      ${explanation ? `<div style="margin-top: 8px; color: rgba(255, 255, 255, 0.7); font-size: 12px;">${escapeHtml(explanation)}</div>` : ''}
    </div>
    <div class="popup-actions">
      <button class="popup-btn popup-btn-secondary" style="width: 100%;" id="learn-more-btn">Learn More</button>
    </div>
  `;

  document.body.appendChild(popup);
  positionPopup(popup, highlightElement);

  // Bind learn more
  popup.querySelector('#learn-more-btn').addEventListener('click', () => {
    handleKnowMore();
  });

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    if (currentPopup === popup) {
      closePopup();
    }
  }, 4000);

  currentPopup = popup;
  console.log('[BiasNeutralizer] Neutral popup shown');
}

function positionPopup(popup, targetElement) {
  const rect = targetElement.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();

  let top = rect.bottom + window.scrollY + 8;
  let left = rect.left + window.scrollX;

  // Adjust if popup would go off-screen
  if (left + popupRect.width > window.innerWidth) {
    left = window.innerWidth - popupRect.width - 20;
  }

  if (left < 10) {
    left = 10;
  }

  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
}

function closePopup() {
  if (currentPopup) {
    currentPopup.remove();
    currentPopup = null;
  }
}

function handleKnowMore() {
  console.log('[BiasNeutralizer] Opening results page');
  chrome.runtime.sendMessage({ type: 'OPEN_RESULTS_PAGE' });
  closePopup();
}

// ========== REWRITER API INTEGRATION WITH MODAL OVERLAY ==========

let currentRewriterSession = null;
let currentModal = null;

async function handleNeutralize(originalText, popup, suggestedAlternative) {
  console.log('[BiasNeutralizer] Neutralizing:', originalText);

  // Close the small popup
  closePopup();

  // Open modal and start neutralization
  await openNeutralizationModal(originalText, suggestedAlternative);
}

/**
 * Main modal function - handles the entire neutralization flow
 */
async function openNeutralizationModal(originalText, suggestedAlternative) {
  // Create modal overlay
  const overlay = createModalOverlay();
  const modal = createModalStructure();
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  currentModal = overlay;

  // Setup close handlers
  setupModalCloseHandlers(overlay, modal);

  try {
    // Step 2: Fix API Feature Detection
    if (!('Rewriter' in self)) {
      throw new Error('Rewriter API not available. Enable chrome://flags/#rewriter-api-for-gemini-nano or use Chrome Dev/Canary.');
    }

    // Show checking state
    showModalLoading(modal, 'Checking AI model...', 'Please wait a moment');

    // Step 3: Check Model Availability
    const availability = await Rewriter.availability();
    console.log('[BiasNeutralizer] Rewriter availability:', availability);

    if (availability === 'available') {
      // Case 1: Model is ready
      await performNeutralization(modal, originalText, suggestedAlternative);
    } else if (availability === 'after-download') {
      // Case 2: Model needs to be downloaded
      await handleModelDownload(modal, originalText, suggestedAlternative);
    } else if (availability === 'downloading') {
      // Case 3: Another tab is downloading
      await waitForModelDownload(modal, originalText, suggestedAlternative);
    } else {
      // Case 4: Unavailable
      throw new Error('Your device doesn\'t support on-device AI (need 22GB free space, 4GB+ GPU or 16GB+ RAM)');
    }
  } catch (error) {
    console.error('[BiasNeutralizer] Neutralization error:', error);
    showModalError(modal, error.message, suggestedAlternative);
  }
}

/**
 * Create the modal overlay container
 */
function createModalOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'neutralizer-overlay';
  return overlay;
}

/**
 * Create the modal structure
 */
function createModalStructure() {
  const modal = document.createElement('div');
  modal.className = 'neutralizer-modal';
  modal.innerHTML = `
    <div class="neutralizer-header">
      <h3>Text Neutralization</h3>
      <button class="neutralizer-close" aria-label="Close">&times;</button>
    </div>
    <div class="neutralizer-body">
      <!-- Content will be dynamically inserted here -->
    </div>
    <div class="neutralizer-footer">
      <button class="neutralizer-close-btn">Close</button>
    </div>
  `;
  return modal;
}

/**
 * Setup modal close handlers
 */
function setupModalCloseHandlers(overlay, modal) {
  const closeModal = () => {
    // Clean up rewriter session
    if (currentRewriterSession) {
      try {
        currentRewriterSession.destroy();
        console.log('[BiasNeutralizer] Rewriter session destroyed');
      } catch (error) {
        console.warn('[BiasNeutralizer] Failed to destroy session:', error);
      }
      currentRewriterSession = null;
    }

    // Animate out
    overlay.classList.add('closing');
    modal.classList.add('closing');
    
    setTimeout(() => {
      overlay.remove();
      currentModal = null;
    }, 200);
  };

  // Close button in header
  const closeButton = modal.querySelector('.neutralizer-close');
  closeButton.addEventListener('click', closeModal);

  // Close button in footer
  const closeFooterBtn = modal.querySelector('.neutralizer-close-btn');
  closeFooterBtn.addEventListener('click', closeModal);

  // Click outside modal
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });

  // Escape key
  const handleEscape = (e) => {
    if (e.key === 'Escape' && currentModal) {
      closeModal();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

/**
 * Show loading state in modal
 */
function showModalLoading(modal, text, subtext) {
  const body = modal.querySelector('.neutralizer-body');
  body.innerHTML = `
    <div class="neutralizer-loading">
      <div class="neutralizer-spinner"></div>
      <div class="neutralizer-loading-text">${text}</div>
      ${subtext ? `<div class="neutralizer-loading-subtext">${subtext}</div>` : ''}
    </div>
  `;
}

/**
 * Show download confirmation dialog
 */
function showDownloadConfirmation(modal, onConfirm, onCancel) {
  const body = modal.querySelector('.neutralizer-body');
  
  // Check if on metered connection
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const isMetered = connection && (connection.saveData || connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g');

  body.innerHTML = `
    <div class="neutralizer-download-confirm">
      <h4>Download AI Model?</h4>
      <div class="neutralizer-download-info">
        <p><strong>This feature uses an on-device AI model for complete privacy. The model:</strong></p>
        <ul>
          <li>Is ~22GB and downloads once</li>
          <li>Works offline after download</li>
          <li>Processes text locally (nothing sent to servers)</li>
        </ul>
        <p><strong>Requirements:</strong></p>
        <ul>
          <li>22GB free disk space</li>
          <li>Stable internet connection</li>
          <li>4GB+ GPU or 16GB+ RAM</li>
        </ul>
        <p style="margin-top: 12px; color: #666; font-size: 13px;">Estimated time: 10-30 minutes depending on your connection</p>
      </div>
      ${isMetered ? `
        <div class="neutralizer-warning">
          <div class="neutralizer-warning-icon">⚠️</div>
          <div class="neutralizer-warning-text">
            You're on a metered connection. This will download 22GB. Continue?
          </div>
        </div>
      ` : ''}
      <div class="neutralizer-download-buttons">
        <button class="neutralizer-btn neutralizer-btn-secondary" id="cancel-download">Cancel</button>
        <button class="neutralizer-btn neutralizer-btn-primary" id="confirm-download">Download & Neutralize</button>
      </div>
    </div>
  `;

  body.querySelector('#confirm-download').addEventListener('click', onConfirm);
  body.querySelector('#cancel-download').addEventListener('click', onCancel);
}

/**
 * Show download progress
 */
function showDownloadProgress(modal) {
  const body = modal.querySelector('.neutralizer-body');
  body.innerHTML = `
    <div class="neutralizer-loading">
      <div class="neutralizer-spinner"></div>
      <div class="neutralizer-loading-text">Downloading AI model...</div>
      <div class="neutralizer-progress">
        <div class="neutralizer-progress-fill" id="progress-fill"></div>
      </div>
      <div class="neutralizer-progress-text" id="progress-text">0% (0GB / 22GB)</div>
      <div class="neutralizer-loading-subtext" style="margin-top: 16px;">This may take 10-30 minutes. Please keep this tab open.</div>
    </div>
  `;
}

/**
 * Update download progress
 */
function updateDownloadProgress(percent) {
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  
  if (progressFill && progressText) {
    progressFill.style.width = `${percent}%`;
    const downloaded = (percent * 22 / 100).toFixed(1);
    progressText.textContent = `${percent}% (${downloaded}GB / 22GB)`;
  }
}

/**
 * Handle model download flow (Case 2)
 */
async function handleModelDownload(modal, originalText, suggestedAlternative) {
  return new Promise((resolve, reject) => {
    showDownloadConfirmation(
      modal,
      // On confirm
      async () => {
        try {
          showDownloadProgress(modal);
          
          // Step 4 & 7: Create rewriter session with download progress monitoring
          const rewriter = await Rewriter.create({
            sharedContext: 'You are rewriting biased or loaded language from news articles into neutral, objective alternatives. Remove emotional adjectives, judgmental adverbs, and insinuating verbs while preserving all factual content, quotes, and attributions.',
            tone: 'as-is',
            format: 'plain-text',
            length: 'as-is',
            monitor(m) {
              m.addEventListener('downloadprogress', (e) => {
                const percent = Math.round(e.loaded * 100);
                console.log(`[BiasNeutralizer] Download progress: ${percent}%`);
                updateDownloadProgress(percent);
              });
            }
          });

          currentRewriterSession = rewriter;

          // Show success and proceed to neutralization
          showModalSuccess(modal, 'AI model ready! Neutralizing your text now...');
          
          setTimeout(async () => {
            await performNeutralization(modal, originalText, suggestedAlternative);
            resolve();
          }, 1500);

        } catch (error) {
          reject(error);
        }
      },
      // On cancel
      () => {
        showModalError(modal, 'Download cancelled. Showing suggested alternative instead.', suggestedAlternative);
        resolve();
      }
    );
  });
}

/**
 * Wait for model download in another tab (Case 3)
 */
async function waitForModelDownload(modal, originalText, suggestedAlternative) {
  showModalLoading(modal, 'AI model downloading in another tab', 'Please wait...');

  // Poll every 2 seconds
  const pollInterval = setInterval(async () => {
    try {
      const availability = await Rewriter.availability();
      
      if (availability === 'available') {
        clearInterval(pollInterval);
        await performNeutralization(modal, originalText, suggestedAlternative);
      } else if (availability !== 'downloading') {
        // Something changed, stop polling
        clearInterval(pollInterval);
        throw new Error('Model download was interrupted. Please try again.');
      }
    } catch (error) {
      clearInterval(pollInterval);
      showModalError(modal, error.message, suggestedAlternative);
    }
  }, 2000);
}

/**
 * Perform the actual neutralization with streaming (Step 4 & 5)
 */
async function performNeutralization(modal, originalText, suggestedAlternative) {
  try {
    // Create rewriter session if not already created
    if (!currentRewriterSession) {
      showModalLoading(modal, 'Initializing AI model...', 'This will only take a moment');
      
      currentRewriterSession = await Rewriter.create({
        sharedContext: 'You are rewriting biased or loaded language from news articles into neutral, objective alternatives. Remove emotional adjectives, judgmental adverbs, and insinuating verbs while preserving all factual content, quotes, and attributions.',
        tone: 'as-is',
        format: 'plain-text',
        length: 'as-is'
      });
    }

    // Show comparison UI
    showComparisonUI(modal, originalText, suggestedAlternative);

    // Step 5: Use streaming for real-time response
    const neutralSection = modal.querySelector('#neutral-text');
    neutralSection.classList.add('streaming');
    neutralSection.textContent = '';

    const stream = await currentRewriterSession.rewriteStreaming(
      originalText,
      {
        context: 'Remove all bias while preserving facts and quotes'
      }
    );

    let fullText = '';
    for await (const chunk of stream) {
      fullText = chunk;
      neutralSection.textContent = fullText;
    }

    // Remove streaming cursor when complete
    neutralSection.classList.remove('streaming');
    
    console.log('[BiasNeutralizer] Neutralization complete:', fullText);

  } catch (error) {
    console.error('[BiasNeutralizer] Neutralization failed:', error);
    showModalError(modal, error.message, suggestedAlternative);
  }
}

/**
 * Show comparison UI with original and neutral text
 */
function showComparisonUI(modal, originalText, suggestedAlternative) {
  const body = modal.querySelector('.neutralizer-body');
  body.innerHTML = `
    <div class="text-comparison">
      <div class="original-section">
        <div class="section-label">Original (Biased)</div>
        <div class="text-content">"${escapeHtml(originalText)}"</div>
      </div>
      
      <div class="arrow-divider">→</div>
      
      <div class="neutral-section">
        <div class="section-label">Neutralized</div>
        <div class="text-content streaming" id="neutral-text"></div>
      </div>
    </div>
    
    ${suggestedAlternative ? `
      <div class="suggested-alternative">
        <div class="section-label">Suggested Alternative (from analysis)</div>
        <div class="text-content">"${escapeHtml(suggestedAlternative)}"</div>
      </div>
    ` : ''}
  `;
}

/**
 * Show error state with suggested alternative
 */
function showModalError(modal, errorMessage, suggestedAlternative) {
  const body = modal.querySelector('.neutralizer-body');
  body.innerHTML = `
    <div class="neutralizer-error">
      <strong>Error</strong>
      <div class="neutralizer-error-message">${escapeHtml(errorMessage)}</div>
    </div>
    
    ${suggestedAlternative ? `
      <div class="suggested-alternative">
        <div class="section-label">Suggested Alternative (from analysis)</div>
        <div class="text-content">"${escapeHtml(suggestedAlternative)}"</div>
        <div style="margin-top: 12px; padding: 12px; background: #f8f9fa; border-radius: 6px; font-size: 13px; color: #666;">
          <strong style="color: #333;">On-device AI is not available on your device.</strong><br>
          Here's our suggested neutral alternative from the analysis.
        </div>
      </div>
    ` : ''}
    
    <div style="margin-top: 20px; text-align: center;">
      <button class="neutralizer-btn neutralizer-btn-secondary" onclick="this.closest('.neutralizer-overlay').querySelector('.neutralizer-close-btn').click()">Close</button>
    </div>
  `;
}

/**
 * Show success message
 */
function showModalSuccess(modal, message) {
  const body = modal.querySelector('.neutralizer-body');
  body.innerHTML = `
    <div class="neutralizer-success">
      <div class="neutralizer-success-icon">✓</div>
      <div class="neutralizer-loading-text">${escapeHtml(message)}</div>
    </div>
  `;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
