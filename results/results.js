(() => {
  'use strict';

  // ========================================
  // SUMMARY LOADER
  // ========================================
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
  // NORMALIZATION
  // ========================================
  function normalizeModeratorSections(markdown) {
    const allowed = new Set(['Center','Lean Left','Lean Right','Strong Left','Strong Right','Unclear']);
    let out = String(markdown || '')
      .replace(/\\[RATING\\]\\s*:/gi, 'Rating:')
      .replace(/\\[CONFIDENCE\\]\\s*:/gi, 'Confidence:');

    out = out.replace(/(Rating:\\s*)([^\\n]+)/i, (m, p1, p2) => {
      let r = String(p2 || '').trim();
      const map = { 'Unknown':'Unclear', 'Left':'Lean Left', 'Right':'Lean Right', 'Centre':'Center' };
      r = map[r] || r;
      if (!allowed.has(r)) r = 'Unclear';
      return p1 + r;
    });

    if (!/Confidence:\\s*/i.test(out)) out += '\\nConfidence: Medium';
    out = out.replace(/(Confidence:\\s*)([^\\n]+)/i, (m, p1, p2) => {
      let c = String(p2 || '').trim();
      if (!['High','Medium','Low'].includes(c)) c = 'Medium';
      return p1 + c;
    });

    if (!/^\\s*##\\s*Overall Bias Assessment/im.test(out)) {
      out = '## Overall Bias Assessment\\n' + out;
    }

    // If missing a canonical Rating line, derive it from Overall Bias Assessment
    if (!/^\\s*Rating:/im.test(out)) {
      const m = out.match(/Overall Bias Assessment\\**\\s*:\\s*([^\\n]+)/i);
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
        out = out.replace(/(##\\s*Overall Bias Assessment[^\\n]*\\n?)/i, $1Rating: \\n);
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
  document.addEventListener('DOMContentLoaded', async () => {
    cacheEls();
    bindEvents();
    setupStorageListener();
    // Show loading, hide main content initially
    try {
      els.loadingState?.classList.remove('hidden');
      els.mainContent?.classList.add('hidden');
    } catch {}
    await refreshResults();
  });

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
    if (els.loadingState) els.loadingState.classList.remove('hidden');
    if (els.mainContent) els.mainContent.classList.add('hidden');
    
    try {
      const { lastAnalysis } = await storageGet(['lastAnalysis']);
      console.log('[BiasNeutralizer Results] ===== LOADING ANALYSIS =====');
      console.log('[BiasNeutralizer Results] lastAnalysis:', lastAnalysis);
      
      // keep loading visible until render completes
      
      if (!lastAnalysis || typeof lastAnalysis !== 'object') {
        console.warn('[BiasNeutralizer Results] No valid analysis found');
        if (els.loadingState) els.loadingState.classList.add('hidden');
        if (els.mainContent) els.mainContent.classList.remove('hidden');
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
      if (els.loadingState) els.loadingState.classList.add('hidden');
      if (els.mainContent) els.mainContent.classList.remove('hidden');
      renderEmpty();
    }
  }

  function renderEmpty() {
    els.title.textContent = 'No analysis yet';
    els.title.href = '#';
    els.domain.textContent = 'Ã¢â‚¬â€';
    els.time.textContent = 'Ã¢â‚¬â€';
    els.source.hidden = true;
    els.keyFindings.innerHTML = '<p class="placeholder-text">No analysis has been run yet. Open the side panel to start a scan.</p>';
    els.loadedLanguage.innerHTML = '<p class="placeholder-text">No data available</p>';
    els.balancedElements.innerHTML = '<p class="placeholder-text">No data available</p>';
  }

  // ========================================
  // RENDER
  // ========================================
  function render(data) {
    console.log('[BiasNeutralizer Results] ===== RENDERING ANALYSIS =====');
    console.log('[BiasNeutralizer Results] Raw data:', data);
    
    const { url, title, summary, source, timestamp, raw } = sanitizeAnalysisData(data);
    
    console.log('[BiasNeutralizer Results] Sanitized data:');
    console.log('[BiasNeutralizer Results] - summary:', summary);
    console.log('[BiasNeutralizer Results] - raw:', raw);
    
    const domain = safeDomain(url);
    els.title.textContent = title || (domain ? `Article on ${domain}` : 'Article');
    els.title.href = url || '#';
    els.domain.textContent = domain || 'Ã¢â‚¬â€';
    els.time.textContent = timestamp ? formatTime(timestamp) : 'Ã¢â‚¬â€';
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
    if (md.length > 200000) md = md.slice(0, 200000) + '\n\nÃ¢â‚¬Â¦';

    parseAndRenderAnalysis(md, raw);

    const biasHeroEl = document.querySelector('.bias-hero');
    if (biasHeroEl) {
      biasHeroEl.classList.remove('initially-hidden');
    }
    
    const extracted = extractBiasRating(md);
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

    loadAndRenderSummary(document.getElementById('summary-content'));

    // Render new Tribunal and Structural sections
    const tribunal = raw && raw.tribunalDebate ? raw.tribunalDebate : null;
    renderTribunalVerdictsV2(tribunal);
    renderStructuralAnalysis(tribunal && tribunal.verifiedFacts ? tribunal.verifiedFacts : null);

    // Reveal main content after successful render
    try {
      els.loadingState?.classList.add('hidden');
      els.mainContent?.classList.remove('hidden');
    } catch {}
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

  function extractBiasRating(text) {
    if (!text || typeof text !== 'string') {
      return {
        rating: 'Unknown',
        confidence: 'Unknown'
      };
    }
    
    const ratingMatch = text.match(/\[?Rating\]?:?\s*(Strong\s+Left|Left|Lean\s+Left|Center|Lean\s+Right|Right|Strong\s+Right|Unclear)/i)
      || text.match(/\[RATING\]\s*:\s*([^\n]+)/i);
    const confidenceMatch = text.match(/\[?Confidence\]?:?\s*(High|Medium|Low)/i)
      || text.match(/\[CONFIDENCE\]\s*:\s*([^\n]+)/i);

    return {
      rating: ratingMatch ? (ratingMatch[1] || ratingMatch[0].replace(/.*:\s*/, '')).trim() : 'Unknown',
      confidence: confidenceMatch ? (confidenceMatch[1] || confidenceMatch[0].replace(/.*:\s*/, '')).trim() : 'Unknown'
    };
  }

  // ========================================
  // PARSE AND RENDER ANALYSIS
  // ========================================
  function parseAndRenderAnalysis(text, raw) {
    const sections = parseAnalysisSections(text);
    
    window.__analysisSections = sections;
    window.__rawAnalysis = raw;
    
    console.log('[Results] parseAndRenderAnalysis - sections:', sections);
    console.log('[Results] parseAndRenderAnalysis - raw:', raw);
    
    const analysisData = (raw && raw.analysis) ? raw.analysis : raw;
    
    // Populate Key Findings
    if (sections.keyFindings && sections.keyFindings.length > 0) {
      renderBulletList(els.keyFindings, sections.keyFindings);
    } else if (analysisData && analysisData.biasIndicators && analysisData.biasIndicators.length > 0) {
      const findings = analysisData.biasIndicators.map(ind => 
        `${ind.type}: ${ind.explanation || ind.example}`
      );
      renderBulletList(els.keyFindings, findings);
    } else {
      els.keyFindings.innerHTML = '<p class="placeholder-text">No significant bias indicators found</p>';
    }
    
    // Populate Loaded Language
    renderLoadedFromRaw();
    
    // Populate Balanced Elements
    if (sections.balancedElements && sections.balancedElements.length > 0) {
      renderBulletList(els.balancedElements, sections.balancedElements);
    } else if (analysisData && analysisData.balancedElements && analysisData.balancedElements.length > 0) {
      const elements = analysisData.balancedElements.map(el => 
        `${el.type}: ${el.explanation}`
      );
      renderBulletList(els.balancedElements, elements);
    } else {
      els.balancedElements.innerHTML = '<p class="placeholder-text">No notable balanced elements identified</p>';
    }
    
    renderMethodology();
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
        const bulletMatch = trimmed.match(/^[-Ã¢â‚¬Â¢*]\s+(.+)$/);
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
        const arrowMatch = item.match(/["'](.+?)["']\s*[Ã¢â€ â€™'-]\s*(.+)/);
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
        prosecutorTitle.textContent = 'Ã¢Å¡Â¡ Prosecutor\'s Evidence';
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
        defenseTitle.textContent = 'Ã°Å¸â€ºÂ¡Ã¯Â¸Â Defense\'s Rebuttal';
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
        investigatorTitle.textContent = 'Ã°Å¸â€Â¬ Investigator\'s Facts';
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
        const reasoning = verdict.reasoning ? ` Ã¢â‚¬â€ ${verdict.reasoning}` : '';
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
      const availability = await window.ai.languageModel.availability();
      if (availability !== 'available') {
        throw new Error(`On-device model not available. Status: ${availability}`);
      }

      const session = await window.ai.languageModel.create();
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
      await handleOnDeviceAssistant(userInput, messageElement);
      return;
    }

    const systemPrompt = `You are the BiasNeutralizer Analysis Assistant. Your purpose is to explain the provided news analysis clearly, neutrally, and concisely.
- You MUST base your answers strictly on the JSON context provided below. Do not invent information.
- If the user asks a question that cannot be answered by the context, politely state that.
- Format your response using simple markdown (bold, italics, lists).

ANALYSIS CONTEXT:
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollAnimations);
  } else {
    initScrollAnimations();
  }

  document.documentElement.style.scrollBehavior = 'smooth';

})();
