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

  if (message.type === 'HIGHLIGHT_DATA') {
    handleHighlightData(message.biasedPhrases, message.neutralPhrases);
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

// ========== HIGHLIGHTING AND NEUTRALIZATION FEATURE ==========

let currentPopup = null;
let stylesInjected = false;

function injectHighlightStyles() {
  if (stylesInjected) return;

  const styleEl = document.createElement('style');
  styleEl.id = 'bias-neutralizer-styles';
  styleEl.textContent = `
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

    .neutralizer-popup-loading {
      text-align: center;
      color: #666;
      padding: 10px;
    }

    .neutralizer-popup-result {
      margin-top: 10px;
      padding: 10px;
      background-color: #e7f3ff;
      border-radius: 6px;
      border-left: 4px solid #007bff;
    }

    .neutralizer-popup-result strong {
      display: block;
      margin-bottom: 6px;
      color: #333;
    }

    .neutralizer-popup-error {
      color: #dc3545;
      margin-top: 10px;
      padding: 8px;
      background-color: #f8d7da;
      border-radius: 4px;
      border-left: 4px solid #dc3545;
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

function highlightPhrases(phrases, className, dataType) {
  if (!phrases || phrases.length === 0) return;

  console.log('[BiasNeutralizer] Highlighting', phrases.length, dataType, 'phrases with class', className);

  // Get the main content area
  const { element: contentRoot } = pickBestContentRoot();

  // Create a TreeWalker to safely traverse text nodes
  const walker = document.createTreeWalker(
    contentRoot,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        // Skip if parent is already highlighted or is a script/style
        if (node.parentElement.classList?.contains('bias-highlight') ||
            node.parentElement.classList?.contains('neutral-highlight')) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement.closest('script, style, noscript, .neutralizer-popup')) {
          return NodeFilter.FILTER_REJECT;
        }
        // Only accept nodes with actual text content
        if (node.textContent.trim().length > 0) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      }
    }
  );

  const textNodes = [];
  let currentNode;
  while (currentNode = walker.nextNode()) {
    textNodes.push(currentNode);
  }

  console.log('[BiasNeutralizer] Found', textNodes.length, 'text nodes to search');

  // Process each phrase
  phrases.forEach(phraseObj => {
    // Handle different data structures for biased vs neutral phrases
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

    if (!phrase || typeof phrase !== 'string') return;

    const phraseNormalized = phrase.toLowerCase().trim();
    if (phraseNormalized.length === 0) return;

    // Search through text nodes for this phrase
    textNodes.forEach(textNode => {
      const text = textNode.textContent;
      const textLower = text.toLowerCase();

      let index = textLower.indexOf(phraseNormalized);
      if (index === -1) return;

      // Found the phrase, now highlight it
      const parent = textNode.parentElement;
      if (!parent) return;

      try {
        const beforeText = text.substring(0, index);
        const matchText = text.substring(index, index + phrase.length);
        const afterText = text.substring(index + phrase.length);

        const fragment = document.createDocumentFragment();

        if (beforeText) {
          fragment.appendChild(document.createTextNode(beforeText));
        }

        const mark = document.createElement('mark');
        mark.className = className;
        mark.textContent = matchText;
        mark.setAttribute('data-original-phrase', phrase);
        mark.setAttribute('data-explanation', explanation);
        mark.setAttribute('data-neutral-alternative', neutralAlternative);
        mark.setAttribute('data-type', dataType);
        mark.setAttribute('data-phrase-type', phraseType);
        fragment.appendChild(mark);

        if (afterText) {
          fragment.appendChild(document.createTextNode(afterText));
        }

        parent.replaceChild(fragment, textNode);
      } catch (error) {
        console.warn('[BiasNeutralizer] Failed to highlight phrase:', phrase, error);
      }
    });
  });

  console.log('[BiasNeutralizer] Highlighting complete for', dataType, 'phrases');
}

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

async function handleNeutralize(originalText, popup, suggestedAlternative) {
  console.log('[BiasNeutralizer] Neutralizing:', originalText);

  // Show loading state
  popup.innerHTML = `
    <div class="neutralizer-popup-loading">
      <strong>Neutralizing...</strong>
      <div style="margin-top: 8px; font-size: 12px;">Please wait while we process the text</div>
    </div>
  `;

  try {
    // Feature detection
    if (!('ai' in self) || !('rewriter' in self.ai)) {
      throw new Error('Rewriter API is not available in this browser. Please use Chrome Canary with the appropriate flags enabled.');
    }

    // Check availability
    const availability = await self.ai.rewriter.capabilities();
    console.log('[BiasNeutralizer] Rewriter availability:', availability);

    if (availability.available === 'no') {
      throw new Error('Rewriter API is not available. It may need to be downloaded first.');
    }

    if (availability.available === 'after-download') {
      popup.innerHTML = `
        <div class="neutralizer-popup-loading">
          <strong>Downloading AI model...</strong>
          <div style="margin-top: 8px; font-size: 12px;">This may take a moment on first use</div>
        </div>
      `;
    }

    // Create rewriter with neutral tone
    const rewriter = await self.ai.rewriter.create({
      sharedContext: 'Rewrite the following text to be more neutral and objective, removing biased or loaded language.'
    });

    // Rewrite the text
    const neutralText = await rewriter.rewrite(originalText);

    console.log('[BiasNeutralizer] Neutralized:', neutralText);

    // Show result
    popup.innerHTML = `
      <div>
        <strong>Original:</strong>
        <div style="margin-top: 4px; padding: 8px; background: #fff3cd; border-radius: 4px; font-size: 13px;">
          "${originalText}"
        </div>
      </div>
      <div class="neutralizer-popup-result">
        <strong>Neutral version:</strong>
        <div style="font-size: 13px;">"${neutralText}"</div>
      </div>
      ${suggestedAlternative ? `
        <div style="margin-top: 10px; padding: 8px; background: #e8f5e9; border-radius: 4px; font-size: 12px;">
          <strong style="display: block; margin-bottom: 4px;">Suggested alternative:</strong>
          "${suggestedAlternative}"
        </div>
      ` : ''}
      <div style="margin-top: 10px; text-align: center;">
        <button onclick="this.closest('.neutralizer-popup').remove()" style="padding: 6px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
      </div>
    `;

  } catch (error) {
    console.error('[BiasNeutralizer] Neutralization failed:', error);

    // Show error
    popup.innerHTML = `
      <div class="neutralizer-popup-error">
        <strong>Error:</strong>
        <div style="margin-top: 4px; font-size: 12px;">${error.message}</div>
      </div>
      ${suggestedAlternative ? `
        <div style="margin-top: 10px; padding: 8px; background: #e8f5e9; border-radius: 4px; font-size: 12px;">
          <strong style="display: block; margin-bottom: 4px;">Suggested alternative:</strong>
          "${suggestedAlternative}"
        </div>
      ` : ''}
      <div style="margin-top: 10px; text-align: center;">
        <button onclick="this.closest('.neutralizer-popup').remove()" style="padding: 6px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
      </div>
    `;
  }
}
