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
    /* Highlight styles */
    .bias-highlight {
      background-color: #fff3cd;
      border-bottom: 2px solid #ffc107;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
      transition: background-color 0.2s ease;
    }

    .bias-highlight:hover {
      background-color: #ffe69c;
    }

    .neutral-highlight {
      background-color: #d4edda;
      border-bottom: 2px solid #28a745;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
      transition: background-color 0.2s ease;
    }

    .neutral-highlight:hover {
      background-color: #c3e6cb;
    }

    /* Small popup styles */
    .neutralizer-popup {
      position: absolute;
      background: white;
      border: 1px solid #ccc;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 12px;
      z-index: 999999;
      min-width: 250px;
      max-width: 400px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
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
  console.log('[BiasNeutralizer] Received highlight request:', {
    biasedCount: biasedPhrases.length,
    neutralCount: neutralPhrases.length
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
    phrase = phraseObj.example;
    explanation = phraseObj.explanation || '';
    neutralAlternative = '';
    phraseType = phraseObj.type || '';
  }

  if (!phrase || typeof phrase !== 'string' || phrase.trim().length === 0) {
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
 */
function findTextMatches(searchText, container) {
  const matches = [];
  const searchLower = searchText.toLowerCase();

  // Create a TreeWalker for text nodes
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        // Skip if parent is already highlighted
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        if (parent.classList?.contains('bias-highlight') ||
            parent.classList?.contains('neutral-highlight') ||
            parent.closest('script, style, noscript, .neutralizer-popup')) {
          return NodeFilter.FILTER_REJECT;
        }

        // Only accept nodes with content that might contain our search text
        const text = node.textContent.toLowerCase();
        if (text.includes(searchLower)) {
          return NodeFilter.FILTER_ACCEPT;
        }

        return NodeFilter.FILTER_REJECT;
      }
    }
  );

  // Collect all matching text nodes
  const textNodes = [];
  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }

  // Search each text node for matches
  textNodes.forEach(textNode => {
    const text = textNode.textContent;
    const textLower = text.toLowerCase();

    let startIndex = 0;
    let foundIndex;

    // Find all occurrences in this text node
    while ((foundIndex = textLower.indexOf(searchLower, startIndex)) !== -1) {
      try {
        // Create a range for this match
        const range = document.createRange();
        range.setStart(textNode, foundIndex);
        range.setEnd(textNode, foundIndex + searchText.length);

        matches.push({
          range: range,
          text: text.substring(foundIndex, foundIndex + searchText.length)
        });

        startIndex = foundIndex + searchText.length;
      } catch (error) {
        console.warn('[BiasNeutralizer] Error creating range:', error);
        break;
      }
    }
  });

  return matches;
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
  // Remove any existing listener
  document.removeEventListener('click', handleDocumentClick);

  // Add new listener
  document.addEventListener('click', handleDocumentClick);

  console.log('[BiasNeutralizer] Click listeners setup');
}

function handleDocumentClick(event) {
  const target = event.target;

  // If clicked on a biased highlight (orange), show biased popup
  if (target.classList.contains('bias-highlight')) {
    event.preventDefault();
    event.stopPropagation();
    showBiasedPopup(target);
    return;
  }

  // If clicked on a neutral highlight (green), show neutral popup
  if (target.classList.contains('neutral-highlight')) {
    event.preventDefault();
    event.stopPropagation();
    showNeutralPopup(target);
    return;
  }

  // If clicked outside popup and highlight, close popup
  if (currentPopup && !currentPopup.contains(target)) {
    closePopup();
  }
}

function showBiasedPopup(highlightElement) {
  // Close any existing popup
  closePopup();

  const originalPhrase = highlightElement.getAttribute('data-original-phrase');
  const explanation = highlightElement.getAttribute('data-explanation');
  const neutralAlternative = highlightElement.getAttribute('data-neutral-alternative');

  // Create popup
  const popup = document.createElement('div');
  popup.className = 'neutralizer-popup';

  // Create content
  const content = document.createElement('div');
  content.innerHTML = `
    <div style="margin-bottom: 8px;">
      <strong>Biased phrase detected:</strong>
      <div style="margin-top: 4px; color: #666;">"${originalPhrase}"</div>
    </div>
  `;

  if (explanation) {
    const explanationDiv = document.createElement('div');
    explanationDiv.style.fontSize = '12px';
    explanationDiv.style.color = '#666';
    explanationDiv.style.marginTop = '6px';
    explanationDiv.textContent = explanation;
    content.appendChild(explanationDiv);
  }

  popup.appendChild(content);

  // Create buttons
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'neutralizer-popup-buttons';

  const knowMoreBtn = document.createElement('button');
  knowMoreBtn.className = 'neutralizer-popup-know-more';
  knowMoreBtn.textContent = 'Know more';
  knowMoreBtn.onclick = () => handleKnowMore();

  const neutralizeBtn = document.createElement('button');
  neutralizeBtn.className = 'neutralizer-popup-neutralize';
  neutralizeBtn.textContent = 'Neutralize';
  neutralizeBtn.onclick = () => handleNeutralize(originalPhrase, popup, neutralAlternative);

  buttonContainer.appendChild(knowMoreBtn);
  buttonContainer.appendChild(neutralizeBtn);
  popup.appendChild(buttonContainer);

  // Position popup
  document.body.appendChild(popup);
  positionPopup(popup, highlightElement);

  currentPopup = popup;
  console.log('[BiasNeutralizer] Biased popup shown');
}

function showNeutralPopup(highlightElement) {
  // Close any existing popup
  closePopup();

  const originalPhrase = highlightElement.getAttribute('data-original-phrase');
  const explanation = highlightElement.getAttribute('data-explanation');
  const phraseType = highlightElement.getAttribute('data-phrase-type');

  // Create popup
  const popup = document.createElement('div');
  popup.className = 'neutralizer-popup';

  // Create content
  const content = document.createElement('div');
  content.innerHTML = `
    <div style="margin-bottom: 8px;">
      <strong style="color: #28a745;">Good journalism example:</strong>
      <div style="margin-top: 4px; color: #666;">"${originalPhrase}"</div>
    </div>
  `;

  // Add type badge if available
  if (phraseType) {
    const typeBadge = document.createElement('div');
    typeBadge.style.display = 'inline-block';
    typeBadge.style.padding = '2px 8px';
    typeBadge.style.backgroundColor = '#e8f5e9';
    typeBadge.style.color = '#28a745';
    typeBadge.style.borderRadius = '12px';
    typeBadge.style.fontSize = '11px';
    typeBadge.style.fontWeight = '600';
    typeBadge.style.marginTop = '6px';
    typeBadge.style.marginBottom = '6px';
    typeBadge.textContent = phraseType;
    content.appendChild(typeBadge);
  }

  // Add explanation
  if (explanation) {
    const explanationDiv = document.createElement('div');
    explanationDiv.style.fontSize = '13px';
    explanationDiv.style.color = '#333';
    explanationDiv.style.marginTop = '10px';
    explanationDiv.style.padding = '10px';
    explanationDiv.style.backgroundColor = '#f8f9fa';
    explanationDiv.style.borderRadius = '6px';
    explanationDiv.style.borderLeft = '3px solid #28a745';
    explanationDiv.innerHTML = `<strong style="display: block; margin-bottom: 4px; font-size: 12px; color: #28a745;">Why this is good:</strong>${explanation}`;
    content.appendChild(explanationDiv);
  }

  popup.appendChild(content);

  // Create button container with only "Know more" button
  const buttonContainer = document.createElement('div');
  buttonContainer.style.marginTop = '12px';
  buttonContainer.style.textAlign = 'center';

  const knowMoreBtn = document.createElement('button');
  knowMoreBtn.className = 'neutralizer-popup-know-more';
  knowMoreBtn.textContent = 'Know more';
  knowMoreBtn.style.width = '100%';
  knowMoreBtn.onclick = () => handleKnowMore();

  buttonContainer.appendChild(knowMoreBtn);
  popup.appendChild(buttonContainer);

  // Position popup
  document.body.appendChild(popup);
  positionPopup(popup, highlightElement);

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
