(() => {
  'use strict';

  // ========================================
  // SUMMARY LOADER
  // ========================================
  async function loadAndRenderSummary() {
    console.log('[Results] Loading summary...');

    const summarySection = document.getElementById('summary-content');
    const summaryCard = document.querySelector('.analysis-card--summary');
    if (!summarySection) return;

    // Get the current report being viewed
    const urlParams = new URLSearchParams(window.location.search);
    const viewReportId = urlParams.get('reportId');
    
    let currentReport = null;
    
    if (viewReportId) {
      // Viewing specific report from history
      const { analysisHistory = [] } = await storageGet(['analysisHistory']);
      currentReport = analysisHistory.find(r => String(r.id) === String(viewReportId));
    } else {
      // Viewing latest analysis
      const { lastAnalysis } = await storageGet(['lastAnalysis']);
      currentReport = lastAnalysis;
    }
    
    if (!currentReport) {
      summarySection.innerHTML = '<p class="placeholder-text">Report not found</p>';
      return;
    }
    
    // Check if this report has an embedded summary
    if (currentReport.articleSummary) {
      // Use the embedded summary (from when this report was created)
      summarySection.innerHTML = currentReport.articleSummary;
      
      if (currentReport.summaryUsedCloud && summaryCard) {
        const cardHeader = summaryCard.querySelector('.card-header');
        if (cardHeader && !cardHeader.querySelector('.cloud-fallback-note')) {
          const note = document.createElement('span');
          note.className = 'cloud-fallback-note';
          note.textContent = 'ℹ️ Cloud-generated summary';
          note.title = 'Summary generated using Gemini API (on-device model unavailable)';
          cardHeader.appendChild(note);
        }
      }
      
      console.log('[Results] ✅ Summary loaded from embedded report data');
      return;
    }
    
    // Fallback: Try to get summary from lastSummary (for active scans)
    let attempts = 0;
    const maxAttempts = 60;

    const pollInterval = setInterval(async () => {
      attempts++;

      const storage = await storageGet(['lastSummary']);
      const summaryData = storage?.lastSummary;

      if (!summaryData) {
        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          summarySection.innerHTML = '<p class="placeholder-text">Summary not available</p>';
        }
        return;
      }

      if (summaryData.status === 'complete') {
        clearInterval(pollInterval);
        summarySection.innerHTML = summaryData.data || '<p class="placeholder-text">Summary completed but empty</p>';
        
        if (summaryData.usedCloudFallback && summaryCard) {
          const cardHeader = summaryCard.querySelector('.card-header');
          if (cardHeader && !cardHeader.querySelector('.cloud-fallback-note')) {
            const note = document.createElement('span');
            note.className = 'cloud-fallback-note';
            note.textContent = 'ℹ️ Cloud-generated summary';
            note.title = 'Summary generated using Gemini API (on-device model unavailable)';
            cardHeader.appendChild(note);
          }
        }
        
        console.log('[Results] ✅ Summary loaded from lastSummary (active scan)');
      } else if (summaryData.status === 'generating') {
        summarySection.innerHTML = '<p class="placeholder-text">⏳ Generating summary...</p>';
      } else if (summaryData.status === 'error') {
        clearInterval(pollInterval);
        summarySection.innerHTML = `<p class="placeholder-text">Summary generation failed: ${summaryData.data}</p>`;
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        summarySection.innerHTML = '<p class="placeholder-text">Summary generation timed out</p>';
      }
    }, 1000);
  }

  // ========================================
  // STORAGE HELPERS
  // ========================================
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
        } catch (e) { 
          console.error('[Results] storage.get exception', e); 
          resolve({}); 
        }
      } else {
        try {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            out[k] = JSON.parse(localStorage.getItem(k));
          });
          resolve(out);
        } catch { 
          resolve({}); 
        }
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
        } catch (e) { 
          console.error('[Results] storage.set exception', e); 
          resolve(false); 
        }
      } else {
        try {
          Object.entries(obj).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
          resolve(true);
        } catch { 
          resolve(false); 
        }
      }
    });
  }

  // ========================================
  // ENHANCED MARKDOWN RENDERING WITH LATEX
  // ========================================
  function enhancedMarkdownToHtml(text) {
    if (!text) return '';

    let html = text
      // Escape HTML entities first
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks (must be before inline code)
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang || '';
      return `<pre><code class="language-${language}">${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers (h1-h3)
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr/>');
    html = html.replace(/^\*\*\*$/gm, '<hr/>');

    // Bold and italic (must be before lists to avoid conflicts)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');

    // Unordered lists
    html = html.replace(/^[-•*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, ''); // Merge consecutive lists

    // Numbered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/^([^<])/gm, '<p>$1');
    html = html.replace(/([^>])$/gm, '$1</p>');

    // Clean up malformed paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>(<[hulo])/g, '$1');
    html = html.replace(/(<\/[hulo][^>]*>)<\/p>/g, '$1');

    return html;
  }

  function renderLatexInElement(element) {
    // Use KaTeX to render LaTeX in the element
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(element, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false }
          ],
          throwOnError: false,
          errorColor: '#cc0000'
        });
      } catch (error) {
        console.warn('[Results] LaTeX rendering error:', error);
      }
    }
  }

  // ========================================
  // NORMALIZATION
  // ========================================
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

    // If missing a canonical Rating line, derive it from Overall Bias Assessment
    if (!/^\s*Rating:/im.test(out)) {
      const m = out.match(/Overall Bias Assessment\*\*\s*:\s*([^\n]+)/i);
      if (m && m[1]) {
        let r = m[1].trim();
        const map = {
          'Unknown':'Unclear',
          'Centrist':'Center',
          'Neutral':'Center',
          'Centre':'Center',
          'Left':'Lean Left',
          'Right':'Lean Right'
        };
        r = map[r] || r;
        if (!allowed.has(r)) r = 'Unclear';
        out = out.replace(/(##\s*Overall Bias Assessment[^\n]*\n?)/i, '$1Rating: \n');
      }
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

  // ========================================
  // STATE
  // ========================================
  let lastRenderedTs = 0;
  let conversationHistory = [];
  let isFirstAssistantLoad = true;

  const els = {};

  // ========================================
  // INITIALIZATION
  // ========================================
  async function initResultsPage() {
    try {
      const assistantOverlay = document.getElementById('assistant-overlay');
      if (assistantOverlay) {
        assistantOverlay.style.display = 'none';
        assistantOverlay.classList.remove('visible');
        console.log('[Results] ✅ Hidden #assistant-overlay (display + class)');
      }

      document.body.style.pointerEvents = 'auto';
      console.log('[Results] ✅ Set pointer-events to auto');
    } catch (err) {
      console.error('[Results] Error initializing overlays:', err);
    }

    cacheEls();
    bindEvents();
    setupStorageListener();
    await refreshResults();
    initScrollAnimations();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initResultsPage);
  } else {
    initResultsPage();
  }

  function cacheEls() {
    els.title = document.getElementById('article-title');
    els.domain = document.getElementById('article-domain');
    els.time = document.getElementById('analysis-time');
    els.source = document.getElementById('analysis-source');
    els.mainContent = document.getElementById('main-content');
    els.keyFindings = document.getElementById('findings-content');
    els.loadedLanguage = document.getElementById('biased-languages-content');
    els.balancedElements = document.getElementById('neutral-languages-content');
    els.backToSidepanel = document.getElementById('back-to-sidepanel');
    els.loadingState = document.getElementById('loading-state');
    els.tribunalVerdictsCard = document.getElementById('tribunal-verdicts-card');
    els.tribunalVerdictsContent = document.getElementById('tribunal-verdicts-content');
    els.structuralAnalysisCard = document.getElementById('structural-analysis-card');
    els.structuralAnalysisContent = document.getElementById('structural-analysis-content');
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
    els.backToSidepanel?.addEventListener('click', () => {
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

  // ========================================
  // REFRESH RESULTS
  // ========================================
  async function refreshResults() {
    console.log('[DEBUG] refreshResults: Function started.');
  
    // Show loading state at the very beginning
    if (els.loadingState) els.loadingState.classList.remove('hidden');
    if (els.mainContent) els.mainContent.classList.add('hidden');
  
    try {
      // This is the core of the fix:
      // We create a promise that will automatically fail after 5 seconds.
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Storage operation timed out after 5 seconds')), 5000)
      );
  
      // We create a function that performs the actual data fetching.
      const dataFetchOperation = async () => {
        const { lastAnalysis, analysisHistory = [] } = await storageGet(['lastAnalysis', 'analysisHistory']);
        console.log('[DEBUG] refreshResults: Fetched data from storage.', { lastAnalysis, analysisHistory });
  
        const urlParams = new URLSearchParams(window.location.search);
        const viewReportId = urlParams.get('reportId');
        let analysisData = null;
  
        if (viewReportId) {
          analysisData = analysisHistory.find(r => String(r.id) === String(viewReportId)) || null;
        }
        if (!analysisData) {
          analysisData = lastAnalysis || null;
        }
  
        if (!analysisData || typeof analysisData !== 'object') {
          // We throw an error here to be caught by the main catch block.
          throw new Error('No valid analysis found');
        }
        return analysisData;
      };
  
      // Promise.race() will proceed with whichever promise finishes first.
      // If dataFetchOperation() takes >5s, timeoutPromise will reject and trigger the catch block.
      const analysisData = await Promise.race([
        dataFetchOperation(),
        timeoutPromise
      ]);
  
      // If we get here, it means the data fetch completed in time.
      if (analysisData.timestamp && analysisData.timestamp === lastRenderedTs) {
        console.log('[BiasNeutralizer Results] No change since last render.');
        return; // The 'finally' block will still run to hide the spinner.
      }
  
      lastRenderedTs = analysisData.timestamp || Date.now();
      renderWhenVisible(async () => await render(analysisData));
  
    } catch (error) {
      // This block now catches both regular errors AND the timeout error.
      console.error('[DEBUG] refreshResults: Caught error!', error);
      console.error('[BiasNeutralizer Results] Failed to load results:', error);
  
      // Display a more specific error message for timeouts.
      const errorMessage = error.message.includes('timed out')
        ? 'Analysis data took too long to load. The browser storage might be busy or unresponsive.'
        : 'Something went wrong while loading the analysis.';
  
      const errorContent = document.getElementById('main-content');
      if (errorContent) {
        errorContent.innerHTML = `
          <div style="padding: 32px; text-align: center;">
            <h2 style="color: #EF4444; margin: 0 0 12px 0;">Error Loading Analysis</h2>
            <p style="color: #999; margin: 0;">${errorMessage}</p>
            <p style="color: #666; font-size: 12px; margin-top: 16px;">Try refreshing the page or running a new analysis.</p>
          </div>
        `;
      }
    } finally {
      // This block is the safety net. It ALWAYS runs, hiding the spinner.
      console.log('[DEBUG] refreshResults: Finally block - ensuring UI is in stable state');
  
      const loadingState = document.getElementById('loading-state');
      if (loadingState) {
        loadingState.classList.add('hidden');
        console.log('[Results] ✅ Ensured #loading-state is hidden');
      }
  
      const mainContent = document.getElementById('main-content');
      if (mainContent) {
        mainContent.classList.remove('hidden');
        console.log('[Results] ✅ Ensured #main-content is visible');
      }
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
  }

  // ========================================
  // RENDER
  // ========================================
  async function render(data) {
    console.log('[DEBUG] render: Function started with data:', data);
    console.log('[BiasNeutralizer Results] ===== RENDERING ANALYSIS =====');
    console.log('[BiasNeutralizer Results] Raw data:', data);

    const { url, title, summary, source, timestamp, raw } = sanitizeAnalysisData(data);
    
    console.log('[BiasNeutralizer Results] Sanitized data:');
    console.log('[BiasNeutralizer Results] - summary:', summary);
    console.log('[BiasNeutralizer Results] - raw:', raw);
    
    const domain = safeDomain(url);
    els.title.textContent = title || (domain ? `Article on ${domain}` : 'Article');
    els.title.href = url || '#';
    // Make link open in new tab with security
    if (url) {
      els.title.target = '_blank';
      els.title.rel = 'noopener noreferrer';
    } else {
      els.title.removeAttribute('target');
      els.title.removeAttribute('rel');
    }
    els.domain.textContent = domain || '—';
    els.time.textContent = timestamp ? formatTime(timestamp) : '—';
    if (source) { 
      els.source.textContent = source; 
      els.source.hidden = false; 
    } else { 
      els.source.hidden = true; 
    }
    
    let summaryText;
    if (typeof summary === 'string' && summary.trim().length) {
      summaryText = summary;
    } else {
      summaryText = defaultSummaryFromRaw(raw);
    }
    
    let md = normalizeModeratorSections(summaryText);
    // Remove truncation - let full analysis display
    // if (md.length > 200000) md = md.slice(0, 200000) + '\n\n…';

    await parseAndRenderAnalysis(md, raw);

    const biasHeroEl = document.querySelector('.bias-hero');
    if (biasHeroEl) {
      biasHeroEl.classList.remove('initially-hidden');
    }
    
    // Use pre-extracted from storage if available
    const analysisData = (raw && raw.analysis) ? raw.analysis : raw;
    const storedRating = analysisData?.extractedRating || null;
    const storedConfidence = analysisData?.extractedConfidence || null;
    const extracted = extractBiasRating(md, storedRating, storedConfidence);
    const ratingEl = document.getElementById('bias-rating');
    const confidenceEl = document.getElementById('bias-confidence');
    
    if (ratingEl) {
      ratingEl.style.opacity = '0';
      ratingEl.textContent = extracted.rating;
      setTimeout(() => {
        ratingEl.style.transition = 'opacity 0.5s ease-in-out';
        ratingEl.style.opacity = '1';
      }, 100);
    }
    
    if (confidenceEl) confidenceEl.textContent = `Confidence: ${extracted.confidence}`;
    
    animateRatingRing(extracted.rating, extracted.confidence);

    loadAndRenderSummary();

    // Render new Tribunal and Structural sections
    const tribunal = raw && raw.tribunalDebate ? raw.tribunalDebate : null;
    renderTribunalVerdictsV2(tribunal);
    renderStructuralAnalysis(tribunal && tribunal.verifiedFacts ? tribunal.verifiedFacts : null);

    // Conditionally show API footer only for on-device mode
    const { assistantModel } = await storageGet(['assistantModel']);
    const apiFooter = document.querySelector('.api-footer');
    if (apiFooter) {
      if (assistantModel === 'on-device' || !assistantModel) {
        apiFooter.style.display = 'block';
      } else {
        apiFooter.style.display = 'none';
      }
    }

    // === CRITICAL FIX: Reveal main content after successful render ===
    console.log('[DEBUG] render: All rendering logic complete. Revealing main content.');
    try {
      // Ensure main content is visible and interactive
      const mainContent = document.getElementById('main-content');
      if (mainContent) {
        mainContent.classList.remove('hidden');
        console.log('[Results] ✅ Removed hidden class from #main-content');
      } else {
        console.error('[Results] ❌ #main-content element not found!');
      }
      
      // Ensure loading state is hidden (if it still exists)
      const loadingState = document.getElementById('loading-state');
      if (loadingState) {
        loadingState.classList.add('hidden');
        console.log('[Results] ✅ Hidden #loading-state');
      }
    } catch (err) {
      console.error('[Results] ❌ Error revealing main content:', err);
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
    
    if (raw && raw.analysis) {
      if (typeof raw.analysis === 'string') return raw.analysis;
      if (typeof raw.analysis.text === 'string') return raw.analysis.text;
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
      
      if (typeof d.summary === 'string') {
        out.summary = d.summary;
      } else if (typeof d.summary === 'object' && d.summary !== null) {
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

  // Helper extractors (match background.js)
  function extractRating(text) {
    const match = text.match(/Rating:\s*([^\n]+)/i);
    return match ? match[1].trim() : 'Unclear';
  }

  function extractConfidence(text) {
    const match = text.match(/Confidence:\s*([^\n]+)/i);
    return match ? match[1].trim() : 'Medium';
  }

  function extractBiasRating(text, storedRating = null, storedConfidence = null) {
    // Priority 1: Use pre-extracted from storage
    if (storedRating && storedConfidence) {
      console.log('[BiasNeutralizer] ✅ Using pre-extracted rating:', { rating: storedRating, confidence: storedConfidence });
      return {
        rating: storedRating,
        confidence: storedConfidence
      };
    }

    // Priority 2: Extract from text
    if (!text || typeof text !== 'string') {
      return {
        rating: 'Unknown',
        confidence: 'Unknown'
      };
    }
    
    try {
      const rating = extractRating(text);
      const confidence = extractConfidence(text);
      
      console.log('[BiasNeutralizer] ✅ Extracted rating from text:', { rating, confidence });
      return {
        rating: rating,
        confidence: confidence
      };
    } catch (e) {
      console.warn('[BiasNeutralizer] Failed to extract rating:', e);
    }
    
    // Fallback
    console.warn('[BiasNeutralizer] ⚠️ Could not extract rating, returning Unknown');
    return { rating: 'Unknown', confidence: 'Unknown' };
  }

  // ========================================
  // PARSE AND RENDER ANALYSIS
  // ========================================
  // ========================================
  // TYPEWRITER EFFECTS
  // ========================================
  
  /**
   * TRUE typewriter effect - types each character like ChatGPT
   */
  async function trueTypewriter(element, htmlContent, speed = 15) {
    // Convert HTML to plain text for typing effect
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;
    const plainText = tempDiv.textContent || tempDiv.innerText;
    
    element.textContent = '';
    element.style.opacity = '1';
    
    for (let i = 0; i < plainText.length; i++) {
      element.textContent += plainText[i];
      
      // Variable speed - faster for spaces, slower for punctuation
      const char = plainText[i];
      let delay = speed;
      if (char === ' ') delay = speed / 3;
      else if (char === '.' || char === '!' || char === '?') delay = speed * 3;
      else if (char === ',') delay = speed * 2;
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // After typing completes, replace with formatted HTML
    element.innerHTML = htmlContent;
  }

  /**
   * Fade-in effect for HTML content (faster alternative)
   */
  async function fadeInEffect(element, htmlContent, delay = 200) {
    await new Promise(resolve => setTimeout(resolve, delay));
    element.innerHTML = htmlContent;
    
    // Animate opacity
    element.style.opacity = '0';
    element.style.transition = 'opacity 0.5s ease-in-out';
    setTimeout(() => {
      element.style.opacity = '1';
    }, 50);
  }

  // ========================================
  // PARSE AND RENDER ANALYSIS
  // ========================================
  
  async function parseAndRenderAnalysis(text, raw) {
    const sections = parseAnalysisSections(text);
    
    window.__analysisSections = sections;
    window.__rawAnalysis = raw;
    
    console.log('[Results] parseAndRenderAnalysis - sections:', sections);
    console.log('[Results] parseAndRenderAnalysis - raw:', raw);
    
    const analysisData = (raw && raw.analysis) ? raw.analysis : raw;
    
    // Populate Key Findings with streaming effect
    if (sections.keyFindings && sections.keyFindings.length > 0) {
      els.keyFindings.innerHTML = '<p class="placeholder-text">Loading findings...</p>';
      setTimeout(() => {
        renderBulletList(els.keyFindings, sections.keyFindings);
      }, 300);
    } else if (analysisData && analysisData.biasIndicators && analysisData.biasIndicators.length > 0) {
      const findings = analysisData.biasIndicators.map(ind => 
        `${ind.type}: ${ind.explanation || ind.example}`
      );
      els.keyFindings.innerHTML = '<p class="placeholder-text">Loading findings...</p>';
      setTimeout(() => {
        renderBulletList(els.keyFindings, findings);
      }, 300);
    } else {
      els.keyFindings.innerHTML = '<p class="placeholder-text">No significant bias indicators found</p>';
    }
    
    // Populate Loaded Language with streaming effect
    setTimeout(() => {
      renderLoadedFromRaw();
    }, 600);
    
    // Populate Balanced Elements with streaming effect
    if (sections.balancedElements && sections.balancedElements.length > 0) {
      els.balancedElements.innerHTML = '<p class="placeholder-text">Loading balanced elements...</p>';
      setTimeout(() => {
        renderBulletList(els.balancedElements, sections.balancedElements);
      }, 900);
    } else if (analysisData && analysisData.balancedElements && analysisData.balancedElements.length > 0) {
      const elements = analysisData.balancedElements.map(el => 
        `${el.type}: ${el.explanation}`
      );
      els.balancedElements.innerHTML = '<p class="placeholder-text">Loading balanced elements...</p>';
      setTimeout(() => {
        renderBulletList(els.balancedElements, elements);
      }, 900);
    } else {
      els.balancedElements.innerHTML = '<p class="placeholder-text">No notable balanced elements identified</p>';
    }
    
    // Render methodology with delay
    setTimeout(() => {
      renderMethodology();
    }, 1200);
  }

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

  function renderLoadedFromRaw() {
    const raw = window.__rawAnalysis;
    const sections = window.__analysisSections || {};
    
    console.log('[Results] renderLoadedFromRaw - raw:', raw);
    console.log('[Results] renderLoadedFromRaw - sections:', sections);
    
    const analysisData = (raw && raw.analysis) ? raw.analysis : raw;
    
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
    
    if (sections.loadedLanguage && sections.loadedLanguage.length > 0) {
      renderLoadedLanguageExamples(els.loadedLanguage, sections.loadedLanguage, raw);
      return;
    }
    
    els.loadedLanguage.innerHTML = '<p class="placeholder-text">No significant biased language detected in the narrative</p>';
  }

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

    const lines = text.split('\n');
    let currentSection = null;
    let currentItems = [];

    const sectionHeaders = {
      'KEY FINDINGS': 'keyFindings',
      'LOADED LANGUAGE': 'loadedLanguage',
      'LOADED LANGUAGE EXAMPLES': 'loadedLanguage',
      'BIASED LANGUAGES USED': 'loadedLanguage',
      'BALANCED ELEMENTS': 'balancedElements',
      'NEUTRAL LANGUAGES USED': 'balancedElements',
      'METHODOLOGY NOTE': 'methodology',
      'OVERALL BIAS ASSESSMENT': null,
      'IMPORTANT RULES': null
    };

    for (const line of lines) {
      const trimmed = line.trim();
      
      const headerMatch = Object.keys(sectionHeaders).find(h => 
        trimmed.toUpperCase().startsWith(h) || 
        trimmed.toUpperCase() === h ||
        trimmed.match(new RegExp(`^###?\\s*${h}`, 'i'))
      );
      
      if (headerMatch) {
        if (currentSection && currentItems.length > 0) {
          sections[currentSection] = currentItems;
        }
        currentSection = sectionHeaders[headerMatch];
        currentItems = [];
        continue;
      }
      
      if (currentSection) {
        const bulletMatch = trimmed.match(/^[-•*]\s+(.+)$/);
        if (bulletMatch) {
          currentItems.push(bulletMatch[1].trim());
        } else if (trimmed.length > 0 && !trimmed.match(/^[=#*-]+$/)) {
          if (trimmed.length > 20 && !trimmed.match(/^(Rating|Confidence):/i)) {
            currentItems.push(trimmed);
          }
        }
      }
    }
    
    if (currentSection && currentItems.length > 0) {
      sections[currentSection] = currentItems;
    }

    return sections;
  }

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

  function renderLoadedLanguageExamples(container, items, raw) {
    while (container.firstChild) container.removeChild(container.firstChild);
    
    let examples = [];
    
    if (raw && raw.languageAnalysis && Array.isArray(raw.languageAnalysis)) {
      examples = raw.languageAnalysis.slice(0, 5);
    } else {
      examples = items.slice(0, 5).map(item => {
        const arrowMatch = item.match(/["'](.+?)["']\s*[→'-]\s*(.+)/);
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

  // ========================================
  // TRIBUNAL VERDICTS
  // ========================================
  function renderTribunalVerdicts(raw) {
    if (!els.tribunalVerdictsCard || !els.tribunalVerdictsContent) return;
    
    if (!raw || !raw.tribunalDebate || !raw.tribunalDebate.charges || raw.tribunalDebate.charges.length === 0) {
      els.tribunalVerdictsCard.style.display = 'none';
      return;
    }
    
    els.tribunalVerdictsCard.style.display = 'block';
    
    const { charges, rebuttals, verifiedFacts } = raw.tribunalDebate;
    
    els.tribunalVerdictsContent.innerHTML = '';
    
    if (charges.length === 0) {
      const noChargesP = document.createElement('p');
      noChargesP.className = 'tribunal-section-content';
      noChargesP.textContent = 'No charges were filed. The Prosecutor determined there was insufficient evidence to prosecute for bias.';
      els.tribunalVerdictsContent.appendChild(noChargesP);
      return;
    }
    
    charges.forEach((charge, index) => {
      const chargeDiv = document.createElement('div');
      chargeDiv.className = 'tribunal-charge';
      
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
      
      if (charge.claim) {
        const chargeClaim = document.createElement('p');
        chargeClaim.className = 'charge-claim';
        chargeClaim.textContent = charge.claim;
        chargeDiv.appendChild(chargeClaim);
      }
      
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
      
      const rebuttal = rebuttals && rebuttals.find(r => r.charge_id === charge.charge_id);
      if (rebuttal) {
        const defenseSection = document.createElement('div');
        defenseSection.className = 'tribunal-section';
        
        const defenseTitle = document.createElement('div');
        defenseTitle.className = 'tribunal-section-title';
        defenseTitle.textContent = "🛡️ Defense's Rebuttal";
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
      
      const facts = verifiedFacts && verifiedFacts.find(f => f.charge_id === charge.charge_id);
      if (facts && facts.findings) {
        const investigatorSection = document.createElement('div');
        investigatorSection.className = 'tribunal-section';
        
        const investigatorTitle = document.createElement('div');
        investigatorTitle.className = 'tribunal-section-title';
        investigatorTitle.textContent = "🔬 Investigator's Facts";
        investigatorSection.appendChild(investigatorTitle);
        
        const factsContent = document.createElement('p');
        factsContent.className = 'tribunal-section-content';
        
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

  // ========================================
  // TRIBUNAL RENDER (V2)
  // ========================================
  function renderTribunalVerdictsV2(tribunalDebate) {
    if (!els.tribunalVerdictsCard || !els.tribunalVerdictsContent) return;
    const td = tribunalDebate;
    if (!td || !Array.isArray(td.charges) || td.charges.length === 0) {
      els.tribunalVerdictsCard.style.display = 'none';
      return;
    }
    els.tribunalVerdictsCard.style.display = 'block';
    els.tribunalVerdictsContent.innerHTML = '';

    const charges = td.charges || [];
    const rebuttals = Array.isArray(td.rebuttals) ? td.rebuttals : [];
    const verdicts = Array.isArray(td.verdicts) ? td.verdicts : [];

    charges.forEach((charge, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'tribunal-charge';

      const head = document.createElement('div');
      head.className = 'charge-header';
      const h3 = document.createElement('h3');
      h3.className = 'charge-title';
      h3.textContent = `Charge ${i + 1}`;
      head.appendChild(h3);
      if (charge && charge.severity) {
        const sev = document.createElement('span');
        sev.className = `charge-severity ${String(charge.severity).toLowerCase()}`;
        sev.textContent = charge.severity;
        head.appendChild(sev);
      }
      wrap.appendChild(head);

      if (charge && charge.claim) {
        const claim = document.createElement('p');
        claim.className = 'charge-claim';
        claim.textContent = charge.claim;
        wrap.appendChild(claim);
      }

      const rebuttal = rebuttals[i] || null;
      if (rebuttal && rebuttal.counter_argument) {
        const def = document.createElement('div');
        def.className = 'tribunal-section';
        const t = document.createElement('div');
        t.className = 'tribunal-section-title';
        t.textContent = "Defense's Rebuttal";
        def.appendChild(t);
        const body = document.createElement('p');
        body.className = 'tribunal-section-content';
        body.textContent = rebuttal.counter_argument;
        def.appendChild(body);
        wrap.appendChild(def);
      }

      let verdict = verdicts[i] || null;
      if (!verdict && verdicts.length) {
        verdict = verdicts.find(v => v.charge && charge && v.charge === charge.claim) || null;
      }
      if (verdict && (verdict.ruling || verdict.reasoning)) {
        const judge = document.createElement('div');
        judge.className = 'tribunal-section';
        const jt = document.createElement('div');
        jt.className = 'tribunal-section-title';
        jt.textContent = "Judge's Verdict";
        judge.appendChild(jt);
        const jb = document.createElement('div');
        jb.className = 'tribunal-section-content';
        const ruling = verdict.ruling ? `<strong>${verdict.ruling}</strong>` : '';
        const reasoning = verdict.reasoning ? ` — ${verdict.reasoning}` : '';
        jb.innerHTML = `${ruling}${reasoning}`;
        judge.appendChild(jb);
        wrap.appendChild(judge);
      }

      els.tribunalVerdictsContent.appendChild(wrap);
    });
  }

  // ========================================
  // STRUCTURAL ANALYSIS
  // ========================================
  function renderStructuralAnalysis(verifiedFacts) {
    if (!els.structuralAnalysisCard || !els.structuralAnalysisContent) return;
    const vf = verifiedFacts && typeof verifiedFacts === 'object' ? verifiedFacts : null;
    if (!vf || Object.keys(vf).length === 0) {
      els.structuralAnalysisCard.style.display = 'none';
      return;
    }
    els.structuralAnalysisCard.style.display = 'block';
    const container = els.structuralAnalysisContent;
    container.innerHTML = '';
    const ul = document.createElement('ul');
    Object.entries(vf).forEach(([k, v]) => {
      const li = document.createElement('li');
      const key = String(k).replace(/_/g, ' ').replace(/\b\w/g, s => s.toUpperCase());
      li.textContent = `${key}: ${typeof v === 'string' ? v : JSON.stringify(v)}`;
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  // ========================================
  // ASSISTANT MODAL
  // ========================================
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
    // Safe fallback if DOMPurify isn't loaded
    const sanitizedContent = (window.DOMPurify
      ? DOMPurify.sanitize(content, { 
          ALLOWED_TAGS: ['strong','em','ul','li','p','br'], 
          ALLOWED_ATTR: [] 
        })
      : content
          .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/\\*\\*(.*?)\\*\\*/g,'<strong></strong>')
          .replace(/\\*(.*?)\\*/g,'<em></em>')
    );
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
      // Feature detection
      if (!('LanguageModel' in self)) {
        throw new Error('On-device AI is not supported in this browser. Please update Chrome or enable the feature flag.');
      }

      // Check availability
      const availability = await self.LanguageModel.availability();
      if (availability === 'no') {
        throw new Error('On-device model is not available on this device.');
      }
      if (availability === 'after-download') {
        messageElement.classList.remove('typing-indicator');
        messageElement.textContent = 'Downloading language model... This may take a moment.';
      }

      // Create session (safe in user-activated event handler)
      const session = await self.LanguageModel.create({
        systemPrompt: 'You are a knowledgeable AI assistant with expertise in news bias analysis, media literacy, journalism, and general topics. While you have access to a specific news analysis in the context, you can answer ANY question the user asks - not just about the analysis. When discussing the analysis, reference the specific data provided. For other topics, use your general knowledge. Format responses using markdown including LaTeX for mathematical expressions (use $...$ for inline math and $$...$$ for display math).'
      });

      // Prepare context
      const { lastAnalysis } = await storageGet(['lastAnalysis']);
      const analysisContext = JSON.stringify(lastAnalysis, null, 2);

      // Build context with conversation history
      let contextPrompt = `ANALYSIS DATA:\n${analysisContext}\n\n--- Recent Conversation ---\n`;
      if (conversationHistory.length > 1) {
        // Include last 3 exchanges for context
        const recentHistory = conversationHistory.slice(-6);
        contextPrompt += recentHistory
          .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.parts[0].text}`)
          .join('\n');
        contextPrompt += '\n';
      }
      contextPrompt += `User: ${userInput}\nAssistant:`;

      // Stream the response
      messageElement.classList.remove('typing-indicator');
      messageElement.textContent = '';
      let fullResponseText = '';

      const stream = session.promptStreaming(contextPrompt);
      
      for await (const chunk of stream) {
        fullResponseText = chunk.trim();
        
        // Use enhanced markdown to HTML conversion
        const dirtyHtml = enhancedMarkdownToHtml(fullResponseText);
        messageElement.innerHTML = (window.DOMPurify
          ? DOMPurify.sanitize(dirtyHtml, { 
              ALLOWED_TAGS: ['strong', 'em', 'ul', 'li', 'p', 'br', 'h1', 'h2', 'h3', 'code', 'pre', 'blockquote', 'hr'], 
              ALLOWED_ATTR: ['class'] 
            })
          : dirtyHtml
        );
        
        // Render LaTeX expressions
        renderLatexInElement(messageElement);
        
        // Auto-scroll to bottom
        els.assistantChatWindow.scrollTop = els.assistantChatWindow.scrollHeight;
      }

      // Cleanup
      await session.destroy();

      // Save to conversation history
      conversationHistory.push({ role: 'model', parts: [{ text: fullResponseText }] });

    } catch (error) {
      console.error("On-device assistant error:", error);
      messageElement.classList.remove('typing-indicator');
      messageElement.textContent = `Sorry, the on-device assistant encountered an error: ${error.message}`;
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
      await handleOnDeviceAssistant(userInput, messageElement);
      return;
    }

    const systemPrompt = `You are a knowledgeable AI assistant with expertise in news bias analysis, media literacy, journalism, and general topics.

You have access to a news bias analysis (provided below), but you can answer ANY question the user asks:
- Questions about the analysis: Use the specific data from the context below
- Questions about bias, journalism, media literacy: Use your expertise
- General questions on any topic: Answer helpfully using your knowledge
- Be conversational, helpful, and informative

Format your responses using markdown (bold, italics, lists, headers, code blocks) and LaTeX for math (use $...$ for inline, $$...$$ for display).

ANALYSIS CONTEXT (for reference when discussing this article):
${analysisContext}`;

    // Use very fast model for results assistant cloud mode
    const model = 'gemini-flash-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${geminiApiKey}&alt=sse`;

    const requestBody = {
  contents: conversationHistory,
  systemInstruction: {
    parts: [{ text: systemPrompt }]
  },
  generationConfig: {
    maxOutputTokens: 512,
    temperature: 0.7,
    topP: 0.9
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
              
              // Use enhanced markdown to HTML conversion
              const dirtyHtml = enhancedMarkdownToHtml(fullResponseText);
              messageElement.innerHTML = DOMPurify.sanitize(dirtyHtml, {
                ALLOWED_TAGS: ['strong', 'em', 'ul', 'li', 'p', 'br', 'h1', 'h2', 'h3', 'code', 'pre', 'blockquote', 'hr'],
                ALLOWED_ATTR: ['class']
              });
              
              // Render LaTeX expressions
              renderLatexInElement(messageElement);
              
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

  // ========================================
  // ANIMATIONS
  // ========================================
  function animateRatingRing(rating, confidence) {
    const progressCircle = document.getElementById('rating-progress');
    if (!progressCircle) return;
    
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
    
    const circumference = 339.292;
    const offset = circumference - (targetPercent / 100) * circumference;
    
    setTimeout(() => {
      if (progressCircle) {
        progressCircle.style.strokeDashoffset = offset;
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

  // initScrollAnimations is invoked within initResultsPage after DOM is ready

  document.documentElement.style.scrollBehavior = 'smooth';

})();
