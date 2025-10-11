(() => {
  'use strict';

  async function loadAndRenderSummary(targetElement) {
    const { lastSummary } = await storageGet(['lastSummary']);

    if (!lastSummary || lastSummary.status === 'generating') {
      targetElement.innerHTML = '<p class="placeholder-text">Generating on-device summary...</p>';
      return;
    }

    if (lastSummary.status === 'error') {
      targetElement.innerHTML = `<p class="placeholder-text error-text">Could not generate summary: ${lastSummary.data}</p>`;
      return;
    }

    if (lastSummary.status === 'complete') {
      const summaryMarkdown = lastSummary.data;
      const keyPoints = summaryMarkdown.split('- ').filter(p => p.trim().length > 0);
      const ul = document.createElement('ul');
      keyPoints.forEach(pointText => {
        const li = document.createElement('li');
        li.textContent = pointText.trim();
        ul.appendChild(li);
      });
      targetElement.innerHTML = '';
      targetElement.appendChild(ul);
    }
  }

  const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const hasRuntime = typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function';

  // ---- results.js storage helpers (robust) ----
  function storageGet(keys) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        try {
          chrome.storage.local.get(keys, (res) => {
            if (chrome.runtime.lastError) {
              console.error('[Results] storage.get error', chrome.runtime.lastError);
              resolve({});
            } else resolve(res || {});
          });
        } catch (e) { console.error('[Results] storage.get exception', e); resolve({}); }
      } else {
        try {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            out[k] = JSON.parse(localStorage.getItem(k));
          });
          resolve(out);
        } catch { resolve({}); }
      }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        try {
          chrome.storage.local.set(obj, () => {
            if (chrome.runtime.lastError) {
              console.error('[Results] storage.set error', chrome.runtime.lastError);
              resolve(false);
            } else resolve(true);
          });
        } catch (e) { console.error('[Results] storage.set exception', e); resolve(false); }
      } else {
        try {
          Object.entries(obj).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
          resolve(true);
        } catch { resolve(false); }
      }
    });
  }

  // ---- results.js normalization (mirror of sidepanel) ----
  function normalizeModeratorSections(markdown) {
    const allowed = new Set(['Center','Lean Left','Lean Right','Strong Left','Strong Right','Unclear']);
    let out = String(markdown || '')
      .replace(/\[RATING\]\s*:/gi, 'Rating:')
      .replace(/\[CONFIDENCE\]\s*:/gi, 'Confidence:');

    out = out.replace(/(Rating:\s*)([^\n]+)/i, (m, p1, p2) => {
      let r = String(p2 || '').trim();
      const map = { 'Unknown':'Unclear', 'Left':'Lean Left', 'Right':'Lean Right', 'Centre':'Center' };
      r = map[r] || r;
      if (!allowed.has(r)) r = 'Unclear';
      return p1 + r;
    });

    if (!/Confidence:\s*/i.test(out)) out += '\nConfidence: Medium';
    out = out.replace(/(Confidence:\s*)([^\n]+)/i, (m, p1, p2) => {
      let c = String(p2 || '').trim();
      if (!['High','Medium','Low'].includes(c)) c = 'Medium';
      return p1 + c;
    });

    if (!/^\s*##\s*Overall Bias Assessment/im.test(out)) {
      out = '## Overall Bias Assessment\n' + out;
    }
    return out;
  }

  function renderWhenVisible(doRender) {
    if (document.visibilityState === 'visible') return doRender();
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', onVis);
        doRender();
      }
    };
    document.addEventListener('visibilitychange', onVis);
  }

  let lastRenderedTs = 0;
  let conversationHistory = [];
  let isFirstAssistantLoad = true;

  // legacy storage wrapper removed in favor of storageGet/storageSet

  const els = {};
  document.addEventListener('DOMContentLoaded', async () => {
    cacheEls();
    bindEvents();
    setupStorageListener(); // <- ADD THIS LINE
    await refreshResults();
  });

  function cacheEls() {
    els.title = document.getElementById('article-title');
    els.domain = document.getElementById('article-domain');
    els.time = document.getElementById('analysis-time');
    els.source = document.getElementById('analysis-source');
    els.keyFindings = document.getElementById('findings-content');
    els.loadedLanguage = document.getElementById('biased-languages-content');
    els.balancedElements = document.getElementById('neutral-languages-content');
    els.backToSidepanel = document.getElementById('back-to-sidepanel');
    els.loadingState = document.getElementById('loading-state');
    els.tribunalVerdictsCard = document.getElementById('tribunal-verdicts-card');
    els.tribunalVerdictsContent = document.getElementById('tribunal-verdicts-content');
    
    els.refresh = document.getElementById('refresh-results');
    els.openSidepanel = document.getElementById('open-sidepanel');
    els.onDeviceWarning = document.getElementById('on-device-warning');
    els.assistantTrigger = document.getElementById('assistant-trigger');
    els.assistantOverlay = document.getElementById('assistant-overlay');
    els.assistantModal = document.getElementById('assistant-modal');
    els.assistantCloseBtn = document.getElementById('assistant-close-btn');
    els.assistantChatWindow = document.getElementById('assistant-chat-window');
    els.assistantForm = document.getElementById('assistant-form');
    els.assistantInput = document.getElementById('assistant-input');
    els.promptStarterBtns = document.querySelectorAll('.prompt-starter-btn');
    els.firstUseNotice = document.getElementById('assistant-first-use-notice');
  }

// ADD THIS NEW FUNCTION:
function setupStorageListener() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.lastAnalysis) {
        console.log('[BiasNeutralizer Results] New analysis detected, refreshing...');
        refreshResults();
      }
    });
  }
}

  function bindEvents() {
    els.refresh?.addEventListener('click', refreshResults);
    els.openSidepanel?.addEventListener('click', openSidePanel);
    els.backToSidepanel?.addEventListener('click', () => {
        // Navigate back to the sidepanel page
        window.location.assign(chrome.runtime.getURL('sidepanel/sidepanel.html'));
    });
    
    els.assistantTrigger?.addEventListener('click', openAssistant);
    els.assistantCloseBtn?.addEventListener('click', closeAssistant);
    els.assistantOverlay?.addEventListener('click', (e) => {
        if (e.target === els.assistantOverlay) {
            closeAssistant();
        }
    });
    els.assistantForm?.addEventListener('submit', handleAssistantSubmit);
    els.promptStarterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const prompt = btn.dataset.prompt;
            if (prompt) {
                openAssistant();
                els.assistantInput.value = prompt;
                handleAssistantSubmit(new Event('submit'));
            }
        });
    });
  }

  async function refreshResults() {
    // Show loading state
    if (els.loadingState) {
      els.loadingState.classList.remove('hidden');
    }
    
    try {
      const { lastAnalysis } = await storageGet(['lastAnalysis']);
      console.log('[BiasNeutralizer Results] ===== LOADING ANALYSIS =====');
      console.log('[BiasNeutralizer Results] lastAnalysis:', lastAnalysis);
      console.log('[BiasNeutralizer Results] lastAnalysis type:', typeof lastAnalysis);
      
      // Hide loading state after data is loaded
      if (els.loadingState) {
        els.loadingState.classList.add('hidden');
      }
      
      if (!lastAnalysis || typeof lastAnalysis !== 'object') {
        console.warn('[BiasNeutralizer Results] No valid analysis found');
        renderEmpty();
        return;
      }
      if (lastAnalysis.timestamp && lastAnalysis.timestamp === lastRenderedTs) {
        console.log('[BiasNeutralizer Results] No change since last render.');
        return;
      }
      lastRenderedTs = lastAnalysis.timestamp || Date.now();
      renderWhenVisible(() => render(lastAnalysis));
    } catch (e) {
      console.error('[BiasNeutralizer Results] Failed to load results:', e);
      // Hide loading state on error
      if (els.loadingState) {
        els.loadingState.classList.add('hidden');
      }
      renderEmpty();
    }
  }

  function renderEmpty() {
    els.title.textContent = 'No analysis yet';
    els.title.href = '#';
    els.domain.textContent = '—';
    els.time.textContent = '—';
    els.source.hidden = true;
    els.keyFindings.innerHTML = '<p class="placeholder-text">No analysis has been run yet. Open the side panel to start a scan.</p>';
    els.loadedLanguage.innerHTML = '<p class="placeholder-text">No data available</p>';
    els.balancedElements.innerHTML = '<p class="placeholder-text">No data available</p>';
    if (els.onDeviceWarning) {
      els.onDeviceWarning.classList.remove('visible');
    }
  }

  function render(data) {
    console.log('[BiasNeutralizer Results] ===== RENDERING ANALYSIS =====');
    console.log('[BiasNeutralizer Results] Raw data:', data);
    
    const { url, title, summary, source, timestamp, raw } = sanitizeAnalysisData(data);
    
    console.log('[BiasNeutralizer Results] Sanitized data:');
    console.log('[BiasNeutralizer Results] - summary type:', typeof summary);
    console.log('[BiasNeutralizer Results] - summary length:', typeof summary === 'string' ? summary.length : 'N/A');
    console.log('[BiasNeutralizer Results] - summary value:', summary);
    console.log('[BiasNeutralizer Results] - raw:', raw);
    
    const domain = safeDomain(url);
    els.title.textContent = title || (domain ? `Article on ${domain}` : 'Article');
    els.title.href = url || '#';
    els.domain.textContent = domain || '—';
    els.time.textContent = timestamp ? formatTime(timestamp) : '—';
    if (source) { els.source.textContent = source; els.source.hidden = false; } else { els.source.hidden = true; }
    
    // Parse and render the summary with proper formatting
    let summaryText;
    if (typeof summary === 'string' && summary.trim().length) {
      summaryText = summary;
      console.log('[BiasNeutralizer Results] Using summary field');
    } else {
      summaryText = defaultSummaryFromRaw(raw);
      console.log('[BiasNeutralizer Results] Using fallback from raw');
    }
    
    // Normalize and bound summary markdown
    let md = normalizeModeratorSections(summaryText);
    if (md.length > 200000) md = md.slice(0, 200000) + '\n\n…';

    console.log('[BiasNeutralizer Results] Final summaryText (normalized):', md);
    console.log('[BiasNeutralizer Results] Final summaryText length:', md?.length);

    // Parse and render the analysis into separate cards
    parseAndRenderAnalysis(md, raw);

    // Show the Bias Hero section and update bias rating display with animations
    const biasHeroEl = document.querySelector('.bias-hero');
    if (biasHeroEl) {
      biasHeroEl.classList.remove('initially-hidden');
    }
    const extracted = extractBiasRating(md);
    const ratingEl = document.getElementById('bias-rating');
    const confidenceEl = document.getElementById('bias-confidence');
    const confidenceValueEl = document.getElementById('confidence-value');
    const analysisTypeValueEl = document.getElementById('analysis-type-value');
    
    // Animate bias rating with fade in
    if (ratingEl) {
      ratingEl.style.opacity = '0';
      ratingEl.textContent = extracted.rating;
      setTimeout(() => {
        ratingEl.style.transition = 'opacity 0.5s ease-in-out';
        ratingEl.style.opacity = '1';
      }, 100);
    }
    
    if (confidenceEl) confidenceEl.textContent = `Confidence: ${extracted.confidence}`;
    if (confidenceValueEl) confidenceValueEl.textContent = extracted.confidence || 'Medium';
    if (analysisTypeValueEl) analysisTypeValueEl.textContent = source ? source.toUpperCase() : 'STANDARD';
    
    // Animate the rating progress ring
    animateRatingRing(extracted.rating, extracted.confidence);

    // Load the on-device summary from storage
    loadAndRenderSummary(document.getElementById('summary-content'));

    // Render tribunal verdicts if available
    renderTribunalVerdicts(raw);

    // Show neutral on-device prompt only when it makes sense
    if (els.onDeviceWarning) {
      const suggest = shouldSuggestDeep(raw, source, md);
      els.onDeviceWarning.classList.toggle('visible', suggest);
    }

  }

  function shouldSuggestDeep(raw, source, summaryText) {
    // Only suggest when current analysis was on-device/private
    const isPrivate = source === 'private' || source === 'on-device' || !source;
    if (!isPrivate) return false;

    try {
      const len = Number(raw?.contentLength || 0);
      const paras = Number(raw?.paragraphCount || 0);
      // Heuristics for "long/complex"
      const isLong = len >= 4000 || paras >= 18;
      // If the summary mentions comparison or multiple sources, treat as complex
      const s = (summaryText || '').toLowerCase();
      const mentionsCompare = /compare|comparison|multiple sources|cross-check|multi-source/.test(s);
      return isLong || mentionsCompare;
    } catch (_) {
      return false;
    }
  }

  function safeDomain(u) {
    try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; }
  }

  function formatTime(ts) {
    try { return new Date(ts).toLocaleString(); } catch { return ''; }
  }

  function defaultSummaryFromRaw(raw) {
  if (!raw) return 'Analysis complete.';
  if (typeof raw === 'string') return raw;
  
  // Fix: Check for raw.analysis.text (object with text field)
  if (raw && raw.analysis) {
    if (typeof raw.analysis === 'string') return raw.analysis;
    if (typeof raw.analysis.text === 'string') return raw.analysis.text; // <- ADD THIS LINE
  }
  
  if (raw && raw.source) return `Analysis from the ${raw.source} model is complete.`;
  return 'Analysis complete.';
}

  function sanitizeAnalysisData(data) {
    const out = {};
    try {
      const d = (data && typeof data === 'object') ? data : {};
      out.url = (typeof d.url === 'string' && d.url.length < 2048) ? d.url : '';
      out.title = (typeof d.title === 'string' && d.title.trim().length) ? d.title.trim().slice(0, 500) : '';
      
      // Handle summary field - check if it's a string or an object
      if (typeof d.summary === 'string') {
        out.summary = d.summary;
      } else if (typeof d.summary === 'object' && d.summary !== null) {
        // If summary is an object, try to extract meaningful data
        if (d.summary.analysis && typeof d.summary.analysis === 'string') {
          out.summary = d.summary.analysis;
        } else {
          out.summary = JSON.stringify(d.summary);
        }
      } else {
        out.summary = '';
      }
      
      out.source = (typeof d.source === 'string' && d.source.trim().length) ? d.source.trim().slice(0, 120) : '';
      out.timestamp = (typeof d.timestamp === 'number' && isFinite(d.timestamp)) ? d.timestamp : 0;
      out.raw = (typeof d.raw === 'object' || typeof d.raw === 'string') ? d.raw : null;
      
      console.log('[BiasNeutralizer Results] sanitizeAnalysisData output:', out);
    } catch (e) {
      console.error('[BiasNeutralizer Results] Error in sanitizeAnalysisData:', e);
      out.url = '';
      out.title = '';
      out.summary = '';
      out.source = '';
      out.timestamp = 0;
      out.raw = null;
    }
    return out;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;');
  }

  async function openSidePanel() {
    try {
      // Try opening the side panel on the active tab
      const [tab] = await new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
      if (tab && tab.id != null && chrome.sidePanel && chrome.sidePanel.open) {
        await chrome.sidePanel.open({ tabId: tab.id });
        return;
      }
    } catch (e) {
      // fall through to open the sidepanel html page
    }
    const url = hasRuntime ? chrome.runtime.getURL('sidepanel/sidepanel.html') : '../sidepanel/sidepanel.html';
    window.location.assign(url);
  }

  function extractBiasRating(text) {
    // Type guard: handle null/undefined/non-string
    if (!text || typeof text !== 'string') {
      return {
        rating: 'Unknown',
        confidence: 'Unknown'
      };
    }
    
    // Parse both old style ("Rating:") and bracketed labels ("[RATING]:")
    const ratingMatch = text.match(/\[?Rating\]?:?\s*(Strong\s+Left|Left|Lean\s+Left|Center|Lean\s+Right|Right|Strong\s+Right|Unclear)/i)
      || text.match(/\[RATING\]\s*:\s*([^\n]+)/i);
    const confidenceMatch = text.match(/\[?Confidence\]?:?\s*(High|Medium|Low)/i)
      || text.match(/\[CONFIDENCE\]\s*:\s*([^\n]+)/i);

    return {
      rating: ratingMatch ? (ratingMatch[1] || ratingMatch[0].replace(/.*:\s*/, '')).trim() : 'Unknown',
      confidence: confidenceMatch ? (confidenceMatch[1] || confidenceMatch[0].replace(/.*:\s*/, '')).trim() : 'Unknown'
    };
  }

  // Parse analysis text into sections and populate cards
  function parseAndRenderAnalysis(text, raw) {
  const sections = parseAnalysisSections(text);
  
  // Store globally for other renderers
  window.__analysisSections = sections;
  window.__rawAnalysis = raw;
  
  console.log('[Results] parseAndRenderAnalysis - sections:', sections);
  console.log('[Results] parseAndRenderAnalysis - raw:', raw);
  
  // Populate Key Findings card - try structured data first
  const analysisData = (raw && raw.analysis) ? raw.analysis : raw;
  
  if (sections.keyFindings && sections.keyFindings.length > 0) {
    renderBulletList(els.keyFindings, sections.keyFindings);
  } else if (analysisData && analysisData.biasIndicators && analysisData.biasIndicators.length > 0) {
    // Fallback to bias indicators from structured data
    const findings = analysisData.biasIndicators.map(ind => 
      `${ind.type}: ${ind.explanation || ind.example}`
    );
    renderBulletList(els.keyFindings, findings);
  } else {
    els.keyFindings.innerHTML = '<p class="placeholder-text">No significant bias indicators found</p>';
  }
  
  // Populate Loaded Language card - prefer structured data from raw
  renderLoadedFromRaw();
  
  // Populate Balanced Elements card - try structured data first
  if (sections.balancedElements && sections.balancedElements.length > 0) {
    renderBulletList(els.balancedElements, sections.balancedElements);
  } else if (analysisData && analysisData.balancedElements && analysisData.balancedElements.length > 0) {
    // Fallback to structured data
    const elements = analysisData.balancedElements.map(el => 
      `${el.type}: ${el.explanation}`
    );
    renderBulletList(els.balancedElements, elements);
  } else {
    els.balancedElements.innerHTML = '<p class="placeholder-text">No notable balanced elements identified</p>';
  }
  
  // Populate Methodology Note
  renderMethodology();
}
  
  // Render Methodology dynamically
  function renderMethodology() {
    const methodEl = document.getElementById('methodology-content');
    if (!methodEl) return;
    
    const s = window.__analysisSections || {};
    methodEl.innerHTML = '';
    const text = (s.methodology && s.methodology.length) ? s.methodology.join(' ') : '';
    
    if (text) {
      const p = document.createElement('p');
      p.className = 'methodology-text';
      p.textContent = text;
      methodEl.appendChild(p);
    } else {
      methodEl.innerHTML = '<p class="methodology-text">Method: narrative bias vs. quoted-source bias evaluated separately; only falsifiable indicators are flagged; genuine balance credited.</p>';
    }
  }
  
  // Render Loaded Language from structured data when available
  function renderLoadedFromRaw() {
  const raw = window.__rawAnalysis;
  const sections = window.__analysisSections || {};
  
  console.log('[Results] renderLoadedFromRaw - raw:', raw);
  console.log('[Results] renderLoadedFromRaw - sections:', sections);
  
  // Check multiple possible locations for language analysis data
  const analysisData = (raw && raw.analysis) ? raw.analysis : raw;
  
  // Try structured data first
  if (analysisData && Array.isArray(analysisData.languageAnalysis) && analysisData.languageAnalysis.length > 0) {
    const items = analysisData.languageAnalysis;
    els.loadedLanguage.innerHTML = '';
    
    items.slice(0, 8).forEach(x => {
      const exampleDiv = document.createElement('div');
      exampleDiv.className = 'language-example';
      
      const phrase = typeof x === 'string' ? x : (x.phrase || JSON.stringify(x));
      const phraseDiv = document.createElement('div');
      phraseDiv.className = 'language-phrase';
      phraseDiv.textContent = `"${phrase}"`;
      exampleDiv.appendChild(phraseDiv);
      
      if (x.explanation) {
        const explanationDiv = document.createElement('div');
        explanationDiv.className = 'language-explanation';
        explanationDiv.textContent = x.explanation;
        exampleDiv.appendChild(explanationDiv);
      }
      
      if (x.neutral_alternative) {
        const altDiv = document.createElement('div');
        altDiv.className = 'language-alternative';
        altDiv.textContent = `Alternative: "${x.neutral_alternative}"`;
        exampleDiv.appendChild(altDiv);
      }
      
      els.loadedLanguage.appendChild(exampleDiv);
    });
    return;
  }
  
  // Try parsing from text sections
  if (sections.loadedLanguage && sections.loadedLanguage.length > 0) {
    renderLoadedLanguageExamples(els.loadedLanguage, sections.loadedLanguage, raw);
    return;
  }
  
  // Final fallback
  els.loadedLanguage.innerHTML = '<p class="placeholder-text">No significant biased language detected in the narrative</p>';
}

  // Parse the analysis text into structured sections
  function parseAnalysisSections(text) {
    if (!text || typeof text !== 'string') {
      return { keyFindings: [], loadedLanguage: [], balancedElements: [], methodology: [] };
    }

    const sections = {
      keyFindings: [],
      loadedLanguage: [],
      balancedElements: [],
      methodology: []
    };

    // Split text into lines and find section headers
    const lines = text.split('\n');
    let currentSection = null;
    let currentItems = [];

    const sectionHeaders = {
      'KEY FINDINGS': 'keyFindings',
      'LOADED LANGUAGE': 'loadedLanguage',
      'LOADED LANGUAGE EXAMPLES': 'loadedLanguage',
      'BALANCED ELEMENTS': 'balancedElements',
      'METHODOLOGY NOTE': 'methodology',
      'OVERALL BIAS ASSESSMENT': null,
      'IMPORTANT RULES': null
    };

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Check if this line is a section header
      const headerMatch = Object.keys(sectionHeaders).find(h => 
        trimmed.toUpperCase().startsWith(h) || 
        trimmed.toUpperCase() === h ||
        trimmed.match(new RegExp(`^###?\\s*${h}`, 'i'))
      );
      
      if (headerMatch) {
        // Save previous section
        if (currentSection && currentItems.length > 0) {
          sections[currentSection] = currentItems;
        }
        // Start new section
        currentSection = sectionHeaders[headerMatch];
        currentItems = [];
        continue;
      }
      
      // If we're in a tracked section, collect bullet items or paragraphs
      if (currentSection) {
        // Match bullet points
        const bulletMatch = trimmed.match(/^[-•*]\s+(.+)$/);
        if (bulletMatch) {
          currentItems.push(bulletMatch[1].trim());
        } else if (trimmed.length > 0 && !trimmed.match(/^[=#*-]+$/)) {
          // Include non-empty, non-separator lines as items if they're substantial
          if (trimmed.length > 20 && !trimmed.match(/^(Rating|Confidence):/i)) {
            currentItems.push(trimmed);
          }
        }
      }
    }
    
    // Save final section
    if (currentSection && currentItems.length > 0) {
      sections[currentSection] = currentItems;
    }

    return sections;
  }

  // Render a bullet list in a container
  function renderBulletList(container, items) {
    while (container.firstChild) container.removeChild(container.firstChild);
    
    const ul = document.createElement('ul');
    items.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    });
    
    container.appendChild(ul);
  }

  // Render loaded language examples with special formatting
  function renderLoadedLanguageExamples(container, items, raw) {
    while (container.firstChild) container.removeChild(container.firstChild);
    
    // Try to extract more detailed language analysis from raw data if available
    let examples = [];
    
    if (raw && raw.languageAnalysis && Array.isArray(raw.languageAnalysis)) {
      examples = raw.languageAnalysis.slice(0, 5);
    } else {
      // Use the parsed items as simple examples
      examples = items.slice(0, 5).map(item => {
        // Try to parse "phrase" → explanation format
        const arrowMatch = item.match(/["'](.+?)["']\s*[→-]\s*(.+)/);
        if (arrowMatch) {
          return {
            phrase: arrowMatch[1],
            explanation: arrowMatch[2]
          };
        }
        return { phrase: item, explanation: '' };
      });
    }
    
    if (examples.length === 0) {
      container.innerHTML = '<p class="placeholder-text">No data available</p>';
      return;
    }
    
    examples.forEach(ex => {
      const exampleDiv = document.createElement('div');
      exampleDiv.className = 'language-example';
      
      const phraseDiv = document.createElement('div');
      phraseDiv.className = 'language-phrase';
      phraseDiv.textContent = `"${ex.phrase || ex}"`;
      exampleDiv.appendChild(phraseDiv);
      
      if (ex.explanation) {
        const explanationDiv = document.createElement('div');
        explanationDiv.className = 'language-explanation';
        explanationDiv.textContent = ex.explanation;
        exampleDiv.appendChild(explanationDiv);
      }
      
      if (ex.direction) {
        const directionSpan = document.createElement('span');
        directionSpan.className = 'language-direction';
        directionSpan.textContent = ex.direction;
        exampleDiv.appendChild(directionSpan);
      }
      
      container.appendChild(exampleDiv);
    });
  }

  // Render Tribunal Verdicts card
  function renderTribunalVerdicts(raw) {
    if (!els.tribunalVerdictsCard || !els.tribunalVerdictsContent) return;
    
    // Check if tribunal data exists
    if (!raw || !raw.tribunalDebate || !raw.tribunalDebate.charges || raw.tribunalDebate.charges.length === 0) {
      els.tribunalVerdictsCard.style.display = 'none';
      return;
    }
    
    // Show the card
    els.tribunalVerdictsCard.style.display = 'block';
    
    const { charges, rebuttals, verifiedFacts } = raw.tribunalDebate;
    
    els.tribunalVerdictsContent.innerHTML = '';
    
    // If no charges were filed
    if (charges.length === 0) {
      const noChargesP = document.createElement('p');
      noChargesP.className = 'tribunal-section-content';
      noChargesP.textContent = 'No charges were filed. The Prosecutor determined there was insufficient evidence to prosecute for bias.';
      els.tribunalVerdictsContent.appendChild(noChargesP);
      return;
    }
    
    // Render each charge with its debate
    charges.forEach((charge, index) => {
      const chargeDiv = document.createElement('div');
      chargeDiv.className = 'tribunal-charge';
      
      // Charge Header
      const chargeHeader = document.createElement('div');
      chargeHeader.className = 'charge-header';
      
      const chargeTitle = document.createElement('h3');
      chargeTitle.className = 'charge-title';
      chargeTitle.textContent = `Charge ${index + 1}`;
      chargeHeader.appendChild(chargeTitle);
      
      if (charge.severity) {
        const severityBadge = document.createElement('span');
        severityBadge.className = `charge-severity ${charge.severity.toLowerCase()}`;
        severityBadge.textContent = charge.severity;
        chargeHeader.appendChild(severityBadge);
      }
      
      chargeDiv.appendChild(chargeHeader);
      
      // Charge Claim
      if (charge.claim) {
        const chargeClaim = document.createElement('p');
        chargeClaim.className = 'charge-claim';
        chargeClaim.textContent = charge.claim;
        chargeDiv.appendChild(chargeClaim);
      }
      
      // Prosecutor's Evidence
      if (charge.supporting_evidence && charge.supporting_evidence.length > 0) {
        const prosecutorSection = document.createElement('div');
        prosecutorSection.className = 'tribunal-section';
        
        const prosecutorTitle = document.createElement('div');
        prosecutorTitle.className = 'tribunal-section-title';
        prosecutorTitle.textContent = '⚡ Prosecutor\'s Evidence';
        prosecutorSection.appendChild(prosecutorTitle);
        
        const evidenceList = document.createElement('ul');
        evidenceList.className = 'tribunal-section-content';
        charge.supporting_evidence.forEach(evidence => {
          const li = document.createElement('li');
          li.textContent = evidence;
          evidenceList.appendChild(li);
        });
        prosecutorSection.appendChild(evidenceList);
        
        chargeDiv.appendChild(prosecutorSection);
      }
      
      // Defense's Rebuttal
      const rebuttal = rebuttals && rebuttals.find(r => r.charge_id === charge.charge_id);
      if (rebuttal) {
        const defenseSection = document.createElement('div');
        defenseSection.className = 'tribunal-section';
        
        const defenseTitle = document.createElement('div');
        defenseTitle.className = 'tribunal-section-title';
        defenseTitle.textContent = '🛡️ Defense\'s Rebuttal';
        defenseSection.appendChild(defenseTitle);
        
        const rebuttalContent = document.createElement('p');
        rebuttalContent.className = 'tribunal-section-content';
        rebuttalContent.textContent = rebuttal.counter_argument;
        defenseSection.appendChild(rebuttalContent);
        
        if (rebuttal.mitigating_evidence && rebuttal.mitigating_evidence.length > 0) {
          const mitigatingList = document.createElement('ul');
          mitigatingList.className = 'tribunal-section-content';
          rebuttal.mitigating_evidence.forEach(evidence => {
            const li = document.createElement('li');
            li.textContent = evidence;
            mitigatingList.appendChild(li);
          });
          defenseSection.appendChild(mitigatingList);
        }
        
        chargeDiv.appendChild(defenseSection);
      }
      
      // Investigator's Facts
      const facts = verifiedFacts && verifiedFacts.find(f => f.charge_id === charge.charge_id);
      if (facts && facts.findings) {
        const investigatorSection = document.createElement('div');
        investigatorSection.className = 'tribunal-section';
        
        const investigatorTitle = document.createElement('div');
        investigatorTitle.className = 'tribunal-section-title';
        investigatorTitle.textContent = '🔬 Investigator\'s Facts';
        investigatorSection.appendChild(investigatorTitle);
        
        const factsContent = document.createElement('p');
        factsContent.className = 'tribunal-section-content';
        
        // Create a readable summary of the findings
        let factsSummary = '';
        if (facts.investigation_type) {
          factsSummary += `<strong>${facts.investigation_type}:</strong> `;
        }
        if (facts.findings.verdict) {
          factsSummary += facts.findings.verdict;
        } else {
          factsSummary += JSON.stringify(facts.findings);
        }
        
        factsContent.innerHTML = factsSummary;
        investigatorSection.appendChild(factsContent);
        
        // Add verdict badge if available
        if (rebuttal && rebuttal.recommended_verdict) {
          const verdictBadge = document.createElement('div');
          const verdictClass = rebuttal.recommended_verdict.toLowerCase().includes('dismiss') ? 'dismissed' :
                               rebuttal.recommended_verdict.toLowerCase().includes('sustain') ? 'sustained' :
                               'inconclusive';
          verdictBadge.className = `verdict-badge ${verdictClass}`;
          verdictBadge.textContent = rebuttal.recommended_verdict;
          investigatorSection.appendChild(verdictBadge);
        }
        
        chargeDiv.appendChild(investigatorSection);
      }
      
      els.tribunalVerdictsContent.appendChild(chargeDiv);
    });
  }

  // legacy text renderer removed
  function openAssistant() {
    if (!els.assistantOverlay || !els.firstUseNotice) return;

    if (isFirstAssistantLoad) {
      els.firstUseNotice.style.display = 'block';
      isFirstAssistantLoad = false;
    }

    els.assistantOverlay.style.display = 'flex';
    setTimeout(() => {
        els.assistantOverlay.classList.add('visible');
        els.assistantInput.focus();
    }, 10);
  }

function closeAssistant() {
    if (!els.assistantOverlay) return;
    els.assistantOverlay.classList.remove('visible');
    setTimeout(() => {
        els.assistantOverlay.style.display = 'none';
    }, 300);
}

function addMessageToChat(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `assistant-message ${role}`;
    // Sanitize content to prevent XSS attacks
    const sanitizedContent = DOMPurify.sanitize(content, {
        ALLOWED_TAGS: ['strong', 'em', 'ul', 'li', 'p', 'br'],
        ALLOWED_ATTR: []
    });
    messageDiv.innerHTML = sanitizedContent;
    els.assistantChatWindow.appendChild(messageDiv);
    els.assistantChatWindow.scrollTop = els.assistantChatWindow.scrollHeight;
    return messageDiv;
}

async function handleAssistantSubmit(event) {
    event.preventDefault();
    const userInput = els.assistantInput.value.trim();
    if (!userInput) return;

    addMessageToChat('user', userInput);
    conversationHistory.push({ role: 'user', parts: [{ text: userInput }] });
    els.assistantInput.value = '';
    els.assistantInput.disabled = true;

    const typingIndicator = addMessageToChat('assistant typing-indicator', '<span></span><span></span><span></span>');

    try {
        await streamAssistantResponse(userInput, typingIndicator);
    } catch (error) {
        console.error("Assistant Error:", error);
        typingIndicator.textContent = "Sorry, I encountered an error. Please try again.";
    } finally {
        els.assistantInput.disabled = false;
        els.assistantInput.focus();
    }
}

async function handleOnDeviceAssistant(userInput, messageElement) {
    try {
        const availability = await window.LanguageModel.availability();
        if (availability !== 'available') {
            throw new Error(`On-device model not available. Status: ${availability}`);
        }

        const session = await window.LanguageModel.create();
        const { lastAnalysis } = await storageGet(['lastAnalysis']);
        const analysisContext = JSON.stringify(lastAnalysis, null, 2);

        const systemPrompt = `You are a helpful assistant for the BiasNeutralizer app. Your answers MUST be based *only* on the JSON analysis data provided below. Do not invent information. If the user asks something not in the context, say so.

        ANALYSIS CONTEXT:
        ${analysisContext}`;

        const fullPrompt = `${systemPrompt}\n\n--- Conversation History ---\n${conversationHistory
            .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.parts[0].text}`)
            .join('\n')}\nUser: ${userInput}\nAssistant:`;

        const responseText = await session.prompt(fullPrompt);
        await session.destroy();

        messageElement.classList.remove('typing-indicator');
        const formattedHtml = responseText
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
        messageElement.innerHTML = DOMPurify.sanitize(formattedHtml, { ALLOWED_TAGS: ['strong', 'em', 'p', 'br'] });

        conversationHistory.push({ role: 'model', parts: [{ text: responseText }] });

    } catch (error) {
        console.error("On-device assistant error:", error);
        messageElement.classList.remove('typing-indicator');
        messageElement.textContent = `Sorry, the on-device assistant failed: ${error.message}`;
    }
}

async function streamAssistantResponse(userInput, messageElement) {
    const settings = await storageGet(['lastAnalysis', 'geminiApiKey', 'assistantModel']);
    const { lastAnalysis, geminiApiKey } = settings;
    const assistantModel = settings.assistantModel || 'on-device';

    if (assistantModel === 'cloud' && !geminiApiKey) {
        messageElement.textContent = "Error: Gemini API key not found in settings.";
        return;
    }

    const analysisContext = JSON.stringify(lastAnalysis, null, 2);

    if (assistantModel === 'on-device') {
        // Call the new on-device handler function we just created
        await handleOnDeviceAssistant(userInput, messageElement);
        return; // Exit the function here
    }

    const systemPrompt = `You are the BiasNeutralizer Analysis Assistant. Your purpose is to explain the provided news analysis clearly, neutrally, and concisely.
    - You MUST base your answers strictly on the JSON context provided below. Do not invent information.
    - If the user asks a question that cannot be answered by the context, politely state that.
    - Format your response using simple markdown (bold, italics, lists).

    ANALYSIS CONTEXT:
    ${analysisContext}`;

    const model = 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${geminiApiKey}&alt=sse`;

    // Add system prompt and current history to the request
    const requestBody = {
        contents: [
            ...conversationHistory
        ],
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
    }

    messageElement.classList.remove('typing-indicator');
    messageElement.textContent = '';
    let fullResponseText = '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try {
                    const jsonStr = line.substring(6);
                    const data = JSON.parse(jsonStr);
                    const textPart = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (textPart) {
                        fullResponseText += textPart;
                        // Convert markdown to HTML with proper escaping
                        const markdownToHtml = (text) => {
                            let html = text
                                .replace(/&/g, '&amp;')
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;')
                                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                .replace(/^- (.*$)/gm, '<ul><li>$1</li></ul>')
                                .replace(/<\/ul>(\s*)<ul>/g, '$1');
                            return html;
                        };
                        const dirtyHtml = markdownToHtml(fullResponseText);
                        // Sanitize to prevent XSS attacks
                        messageElement.innerHTML = DOMPurify.sanitize(dirtyHtml, {
                            ALLOWED_TAGS: ['strong', 'em', 'ul', 'li', 'p', 'br'],
                            ALLOWED_ATTR: []
                        });
                        els.assistantChatWindow.scrollTop = els.assistantChatWindow.scrollHeight;
                    }
                } catch (e) {
                    // Ignore parsing errors for incomplete chunks
                }
            }
        }
    }
    conversationHistory.push({ role: 'model', parts: [{ text: fullResponseText }] });
}

// ====================================================================
// Premium Animation Functions
// ====================================================================

function animateRatingRing(rating, confidence) {
  const progressCircle = document.getElementById('rating-progress');
  if (!progressCircle) return;
  
  // Map rating to percentage (0-100)
  const ratingMap = {
    'Center': 50,
    'Lean Left': 35,
    'Lean Right': 65,
    'Strong Left': 15,
    'Strong Right': 85,
    'Left': 25,
    'Right': 75,
    'Unknown': 50,
    'Unclear': 50
  };
  
  const confidenceMultiplier = {
    'High': 1,
    'Medium': 0.8,
    'Low': 0.6
  };
  
  let targetPercent = ratingMap[rating] || 50;
  const mult = confidenceMultiplier[confidence] || 0.8;
  
  // Calculate stroke dash offset (circumference = 2 * π * r = 2 * π * 54 ≈ 339.292)
  const circumference = 339.292;
  const offset = circumference - (targetPercent / 100) * circumference;
  
  // Animate with delay
  setTimeout(() => {
    if (progressCircle) {
      progressCircle.style.strokeDashoffset = offset;
      // Add dynamic color based on rating
      const colorMap = {
        'Center': '#10B981',
        'Lean Left': '#3B82F6',
        'Lean Right': '#3B82F6',
        'Strong Left': '#8B5CF6',
        'Strong Right': '#8B5CF6',
        'Left': '#3B82F6',
        'Right': '#3B82F6'
      };
      progressCircle.style.stroke = colorMap[rating] || '#F97316';
    }
  }, 300);
}

// Add scroll reveal animations
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  });
  
  document.querySelectorAll('.analysis-card, .report-header').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(el);
  });
}

// Initialize animations when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initScrollAnimations);
} else {
  initScrollAnimations();
}

// Add smooth scroll behavior
document.documentElement.style.scrollBehavior = 'smooth';

})();
