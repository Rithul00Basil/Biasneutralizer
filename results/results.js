(() => {
  'use strict';

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

  // legacy storage wrapper removed in favor of storageGet/storageSet

  const els = {};
  document.addEventListener('DOMContentLoaded', async () => {
    cacheEls();
    bindEvents();
    await refreshResults();
  });

  function cacheEls() {
    els.title = document.getElementById('article-title');
    els.domain = document.getElementById('article-domain');
    els.time = document.getElementById('analysis-time');
    els.source = document.getElementById('analysis-source');
    els.keyFindings = document.getElementById('key-findings-content');
    els.loadedLanguage = document.getElementById('loaded-language-content');
    els.balancedElements = document.getElementById('balanced-elements-content');
    els.openArticle = document.getElementById('open-article');
    els.refresh = document.getElementById('refresh-results');
    els.openSidepanel = document.getElementById('open-sidepanel');
    els.onDeviceWarning = document.getElementById('on-device-warning');
  }

  function bindEvents() {
    els.refresh?.addEventListener('click', refreshResults);
    els.openSidepanel?.addEventListener('click', openSidePanel);
    els.openArticle?.addEventListener('click', () => {
      if (els.title && els.title.href && els.title.href !== '#') {
        window.open(els.title.href, '_blank', 'noopener');
      }
    });
  }

  async function refreshResults() {
    try {
      const { lastAnalysis } = await storageGet(['lastAnalysis']);
      console.log('[BiasNeutralizer Results] ===== LOADING ANALYSIS =====');
      console.log('[BiasNeutralizer Results] lastAnalysis:', lastAnalysis);
      console.log('[BiasNeutralizer Results] lastAnalysis type:', typeof lastAnalysis);
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
    els.openArticle.disabled = true;
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

    // Show the Bias Hero section and update bias rating display
    const biasHeroEl = document.querySelector('.bias-hero');
    if (biasHeroEl) {
      biasHeroEl.classList.remove('initially-hidden');
    }
    const extracted = extractBiasRating(md);
    const ratingEl = document.getElementById('bias-rating');
    const confidenceEl = document.getElementById('bias-confidence');
    if (ratingEl) ratingEl.textContent = extracted.rating;
    if (confidenceEl) confidenceEl.textContent = `Confidence: ${extracted.confidence}`;
    els.openArticle.disabled = !url;

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
    if (raw && raw.analysis && typeof raw.analysis === 'string') return raw.analysis;
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
    
    // Populate Key Findings card
    if (sections.keyFindings && sections.keyFindings.length > 0) {
      renderBulletList(els.keyFindings, sections.keyFindings);
    } else {
      els.keyFindings.innerHTML = '<p class="placeholder-text">No data available</p>';
    }
    
    // Populate Loaded Language card - prefer structured data from raw
    renderLoadedFromRaw();
    
    // Populate Balanced Elements card
    if (sections.balancedElements && sections.balancedElements.length > 0) {
      renderBulletList(els.balancedElements, sections.balancedElements);
    } else {
      els.balancedElements.innerHTML = '<p class="placeholder-text">No data available</p>';
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
    
    // Try structured data first
    if (raw && raw.analysis && Array.isArray(raw.analysis.languageAnalysis) && raw.analysis.languageAnalysis.length > 0) {
      const items = raw.analysis.languageAnalysis;
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
        
        els.loadedLanguage.appendChild(exampleDiv);
      });
    } else if (sections.loadedLanguage && sections.loadedLanguage.length > 0) {
      // Fall back to parsed text sections
      renderLoadedLanguageExamples(els.loadedLanguage, sections.loadedLanguage, raw);
    } else {
      els.loadedLanguage.innerHTML = '<p class="placeholder-text">No data available</p>';
    }
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

  // legacy text renderer removed
})();
