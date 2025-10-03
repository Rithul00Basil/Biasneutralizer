(() => {
  'use strict';

  const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const hasRuntime = typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function';

  const storage = {
    async get(keys) {
      const keyArray = Array.isArray(keys) ? keys : [keys];
      if (hasChromeStorage) {
        return new Promise((resolve, reject) => {
          chrome.storage.local.get(keyArray, (result) => {
            const err = chrome.runtime && chrome.runtime.lastError;
            if (err) reject(err); else resolve(result || {});
          });
        });
      }
      const res = {}; keyArray.forEach(k => {
        const raw = localStorage.getItem(k);
        if (raw != null) { try { res[k] = JSON.parse(raw); } catch { res[k] = raw; } }
      });
      return res;
    }
  };

  const els = {};
  document.addEventListener('DOMContentLoaded', async () => {
    cacheEls();
    bindEvents();
    await loadLatest();
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
    els.refresh?.addEventListener('click', loadLatest);
    els.openSidepanel?.addEventListener('click', openSidePanel);
    els.openArticle?.addEventListener('click', () => {
      if (els.title && els.title.href && els.title.href !== '#') {
        window.open(els.title.href, '_blank', 'noopener');
      }
    });
  }

  async function loadLatest() {
    try {
      const { lastAnalysis } = await storage.get('lastAnalysis');
      console.log('[BiasNeutralizer Results] ===== LOADING ANALYSIS =====');
      console.log('[BiasNeutralizer Results] lastAnalysis:', lastAnalysis);
      console.log('[BiasNeutralizer Results] lastAnalysis type:', typeof lastAnalysis);
      if (!lastAnalysis || typeof lastAnalysis !== 'object') {
        console.warn('[BiasNeutralizer Results] No valid analysis found');
        renderEmpty();
        return;
      }
      render(lastAnalysis);
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
    
    console.log('[BiasNeutralizer Results] Final summaryText:', summaryText);
    console.log('[BiasNeutralizer Results] Final summaryText length:', summaryText?.length);
    
    // Parse and render the analysis into separate cards
    parseAndRenderAnalysis(summaryText, raw);

    // Show the Bias Hero section and update bias rating display
    const biasHeroEl = document.querySelector('.bias-hero');
    if (biasHeroEl) {
      biasHeroEl.classList.remove('initially-hidden');
    }
    const extracted = extractBiasRating(summaryText);
    const ratingEl = document.getElementById('bias-rating');
    const confidenceEl = document.getElementById('bias-confidence');
    if (ratingEl) ratingEl.textContent = extracted.rating;
    if (confidenceEl) confidenceEl.textContent = `Confidence: ${extracted.confidence}`;
    els.openArticle.disabled = !url;

    // Show neutral on-device prompt only when it makes sense
    if (els.onDeviceWarning) {
      const suggest = shouldSuggestDeep(raw, source, summaryText);
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

  // Legacy: Safely render analysis text by building DOM nodes (prevents HTML injection)
  function safeRenderAnalysis(container, text) {
    console.log('[BiasNeutralizer Results] ===== RENDERING TEXT =====');
    console.log('[BiasNeutralizer Results] text type:', typeof text);
    console.log('[BiasNeutralizer Results] text length:', text?.length);
    console.log('[BiasNeutralizer Results] text value:', text);
    
    try {
      while (container.firstChild) container.removeChild(container.firstChild);
      let t = (typeof text === 'string') ? text : '';
      // normalize headings and strip triple backtick fences
      t = t.replace(/^###\s+/gm, '## ')
           .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''));
      if (!t.trim().length) {
        console.warn('[BiasNeutralizer Results] Empty text, showing fallback message');
        const p = document.createElement('p');
        p.textContent = 'No analysis available.';
        container.appendChild(p);
        return;
      }
      
      console.log('[BiasNeutralizer Results] Parsing and rendering analysis text...');

      const lines = t.replace(/\r\n?/g, '\n').split('\n');
      let ul = null;
      let para = null;
      const pushPara = () => {
        if (para && para.textContent.trim().length) {
          container.appendChild(para);
        }
        para = null;
      };
      const pushUl = () => {
        if (ul) {
          container.appendChild(ul);
        }
        ul = null;
      };

      const mkH3 = (txt) => {
        const h = document.createElement('h3');
        h.textContent = txt.trim();
        h.style.color = 'var(--text-white-100)';
        h.style.fontSize = '16px';
        h.style.fontWeight = '600';
        h.style.margin = '16px 0 8px 0';
        h.style.fontFamily = 'var(--font-inter)';
        return h;
      };

      for (let raw of lines) {
        const line = raw.trimEnd();
        if (!line.trim().length) {
          // blank line: end current paragraph and list
          pushPara();
          pushUl();
          continue;
        }

        // Markdown-style header
        const headerMatch = line.match(/^###\s*(.+)$/);
        // Or fixed headings from strict template
        const fixedHeading = /^(OVERALL BIAS ASSESSMENT|KEY FINDINGS|BALANCED ELEMENTS|IMPORTANT RULES)$/i;

        if (headerMatch) {
          pushPara();
          pushUl();
          container.appendChild(mkH3(headerMatch[1]));
          continue;
        }
        if (fixedHeading.test(line)) {
          pushPara();
          pushUl();
          container.appendChild(mkH3(line.toUpperCase()));
          continue;
        }

        // Bullet item
        const bullet = line.match(/^\-\s+(.+)$/);
        if (bullet) {
          if (!ul) {
            ul = document.createElement('ul');
            ul.style.listStyle = 'disc';
            ul.style.paddingLeft = '20px';
          }
          const li = document.createElement('li');
          li.textContent = bullet[1].trim();
          li.style.marginBottom = '6px';
          li.style.color = 'var(--text-white-90)';
          ul.appendChild(li);
          continue;
        }

        // Paragraph accumulation
        if (!para) {
          para = document.createElement('p');
          para.style.margin = '8px 0';
          para.style.color = 'var(--text-white-90)';
          para.style.lineHeight = '1.6';
          para.textContent = line.trim();
        } else {
          para.textContent += '\n' + line.trim();
        }
      }

      // flush any open structures
      pushPara();
      pushUl();
    } catch (e) {
      // Fallback: plain text
      container.textContent = (typeof text === 'string') ? text : 'No analysis available.';
    }
  }
})();
