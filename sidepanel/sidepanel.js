/**
 * BiasNeutralizer Side Panel Controller
 * Manages article scanning, AI analysis, and user interactions
 */
import { AgentPrompts } from '../shared/prompts.js';

const SP_LOG_PREFIX = '[Sidepanel]';
const spLog = (...args) => console.log(SP_LOG_PREFIX, ...args);
const spWarn = (...args) => console.warn(SP_LOG_PREFIX, ...args);
const spError = (...args) => console.error(SP_LOG_PREFIX, ...args);
document.addEventListener('DOMContentLoaded', async () => {
  // === STEP 1: CHECK SETUP COMPLETION (FIRST-TIME SETUP FLOW) ===
  spLog('Checking setup completion...');
  
  try {
    const storage = await new Promise((resolve) => {
      chrome.storage.local.get(['hasCompletedSetup'], (result) => {
        resolve(result);
      });
    });

    // If setup not completed, redirect to setup page
    if (!storage.hasCompletedSetup) {
      spLog('Setup not completed, redirecting to setup page');
      window.location.href = chrome.runtime.getURL('setup/setup.html');
      return; // Stop execution
    }

    spLog('Setup completed, continuing with normal flow');
  } catch (error) {
    spError('Error checking setup status:', error);
    // On error, continue with normal flow (fail-safe)
  }

  // === DEPRECATED: Rating validation now handled in background.js ===
  // This function is kept for backward compatibility but is no longer called
  // All normalization and extraction happens at source (background.js)
  function normalizeModeratorSections(markdown) {
    const allowed = new Set(['Center','Lean Left','Lean Right','Strong Left','Strong Right','Unclear']);
    let out = String(markdown || '');
    out = out.replace(/\[RATING\]\s*:/gi,'Rating:').replace(/\[CONFIDENCE\]\s*:/gi,'Confidence:');
    
    out = out.replace(/(Rating:\s*)([^\n]+)/i, (m, p1, p2) => {
      let r = String(p2 || '').trim();
      const map = { 'Unknown':'Unclear', 'Left':'Lean Left', 'Right':'Lean Right', 'Centre':'Center' };
      r = map[r] || r;
      if (!allowed.has(r)) r = 'Unclear';
      return p1 + r;
    });
    
    out = out.replace(/(Confidence:\s*)([^\n]+)/i, (m, p1, p2) => {
      let c = String(p2 || '').trim();
      if (!['High','Medium','Low'].includes(c)) c = 'Medium';
      return p1 + c;
    });
    
    if (!/^\s*##\s*Overall Bias Assessment/im.test(out)) {
      out = '## Overall Bias Assessment\n' + out;
    }
    
    // CRITICAL FIX: If no Rating: line exists, extract from bullet format
    if (!/^\s*Rating:/im.test(out)) {
      const m = out.match(/Overall Bias Assessment\**\s*:\s*([^\n]+)/i);
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
        out = out.replace(/(##\s*Overall Bias Assessment[^\n]*\n?)/i, `$1Rating: ${r}\n`);
      } else {
        out += '\nRating: Unclear';
      }
    }
    
    return out;
  }

  function getModelNameForDepth(depth) {
    // Deep tasks: gemini-2.5-pro; Fast tasks: gemini-flash-latest
    return depth === 'deep' ? 'gemini-2.5-pro' : 'gemini-flash-latest';
  }

  // === on-device quick-scan helpers ===
  function safeJSON(x, fallback = null) {
    try { return JSON.parse(x); } catch { return fallback; }
  }

  function countWords(text) {
    return (text || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function isValidBalancedExcerpt(example) {
    const wordCount = countWords(example);
    return wordCount >= 5 && wordCount <= 15;
  }

  async function ensureBalancedExamples(elements, sourceText, fetchSnippet) {
    if (!Array.isArray(elements) || elements.length === 0) return [];
    const resolved = [];

    for (const element of elements) {
      if (!element || typeof element !== 'object') continue;

      let example = typeof element.example === 'string' ? element.example.trim() : '';

      if (!isValidBalancedExcerpt(example) && typeof fetchSnippet === 'function') {
        try {
          const candidate = await fetchSnippet(element, sourceText);
          if (typeof candidate === 'string') {
            example = candidate.trim();
          }
        } catch (error) {
          spWarn('Failed to fetch balanced snippet (on-device):', error);
        }
      }

      if (isValidBalancedExcerpt(example)) {
        resolved.push({ ...element, example });
      } else {
        spWarn('Dropping balanced element without valid excerpt (on-device):', element);
      }
    }

    return resolved;
  }

  function deriveQuickModeratorMarkdown(contextJSON, languageJSON, hunterJSON, skepticJSON, quoteJSON) {
    const t = String(contextJSON?.type || '').toLowerCase();
    const isOpinionAnalysis = !!contextJSON?.is_opinion_or_analysis || t === 'opinion' || t === 'analysis';

    spLog('Rating calculation inputs:', {
      contextType: t,
      isOpinionAnalysis: isOpinionAnalysis,
      will_return_unclear: isOpinionAnalysis,
      biasIndicators: hunterJSON?.bias_indicators?.length || 0,
      balanceScore: skepticJSON?.balance_score || 0
    });

    // Handle Opinion/Analysis Content
    if (isOpinionAnalysis) {
      spLog('Content classified as opinion/analysis; returning "Unclear" rating');
      return [
        '### Findings',
        '- **Overall Bias Assessment:** Unclear',
        '- **Confidence:** High',
        '- **Key Observation:** This content was identified as Opinion/Analysis and was not evaluated for news bias.',
        '',
        '### Biased Languages Used',
        '- Not applicable for opinion content.',
        '',
        '### Neutral Languages Used',
        (skepticJSON?.balanced_elements?.length ? `- ${skepticJSON.balanced_elements[0].explanation}` : '- Not applicable for opinion content.'),
        '',
        '### Methodology Note',
        '- Opinion and analysis pieces are not rated for journalistic bias as they are inherently subjective.'
      ].join('\n');
    }

    // Calculate Evidence Points
    const indicators = Array.isArray(hunterJSON?.bias_indicators) ? hunterJSON.bias_indicators : [];
    let points = 0;
    let lowPoints = 0;
    const typesSeen = new Set(indicators.map(ind => ind.type));
    indicators.forEach(ind => {
      const str = String(ind?.strength || '').toLowerCase();
      if (str === 'high') points += 2;
      else if (str === 'medium') points += 1;
      else if (str === 'low') lowPoints += 0.5;
    });
    points += Math.min(lowPoints, 1);

    // Skeptic Override
    const balanceScore = Number(skepticJSON?.balance_score || 0);
    const skepticConf = String(skepticJSON?.confidence || 'Low');
    if (balanceScore >= 8 && skepticConf === 'High') {
      const findings = [
        '### Findings',
        '- **Overall Bias Assessment:** Center',
        '- **Confidence:** High',
        '- **Key Observation:** The article demonstrates exemplary balance, overriding other potential bias indicators.',
      ];
      const biasedLanguage = (languageJSON?.loaded_phrases?.length)
        ? languageJSON.loaded_phrases.slice(0, 3).map(p => `- **"${p.phrase}"**: ${p.explanation}.`)
        : ['- No significant loaded or biased language was identified in the narrative.'];
      const neutralElements = (skepticJSON?.balanced_elements?.length)
        ? skepticJSON.balanced_elements.slice(0, 2).map(el => `- ${el.explanation}.`)
        : ['- Multiple perspectives were included and sourced transparently.'];
      const methodology = [
        '### Methodology Note',
        `- This 'Center' rating was determined by a high balance score (${balanceScore}/10), which overrides minor instances of loaded language.`
      ];
      return [
        ...findings,
        '',
        '### Biased Languages Used',
        ...biasedLanguage,
        '',
        '### Neutral Languages Used',
        ...neutralElements,
        '',
        ...methodology
      ].join('\n');
    }

    // Determine Rating
    let rating = 'Center';
    const dir = String(hunterJSON?.overall_bias || 'Center').toLowerCase();
    if (points >= 2 && typesSeen.size >= 2) {
      if (dir.includes('left')) rating = points >= 4 ? 'Strong Left' : 'Lean Left';
      else if (dir.includes('right')) rating = points >= 4 ? 'Strong Right' : 'Lean Right';
    }

    // Determine Confidence
    let confidence = 'Medium';
    if (points === 0 || (points < 2 && balanceScore >= 6)) confidence = 'High';
    if (points >= 4 && typesSeen.size >= 3) confidence = 'High';

    // Build Report Sections
    const keyObservation = rating === 'Center'
      ? 'The article maintains a generally neutral tone and adheres to journalistic standards.'
      : `The rating was influenced by ${points.toFixed(1)} evidence points across ${typesSeen.size} indicator types.`;

    const findings = [
      '### Findings',
      `- **Overall Bias Assessment:** ${rating}`,
      `- **Confidence:** ${confidence}`,
      `- **Key Observation:** ${keyObservation}`,
    ];

    const biasedLanguage = (languageJSON?.loaded_phrases?.length)
      ? languageJSON.loaded_phrases.slice(0, 3).map(p => `- **"${p.phrase}"**: ${p.explanation || 'This phrase is emotionally charged or speculative'}. A neutral alternative is "${p.neutral_alternative}".`)
      : ['- No significant loaded or biased language was identified in the narrative.'];

    const neutralElements = (skepticJSON?.balanced_elements?.length)
      ? skepticJSON.balanced_elements.slice(0, 2).map(el => `- **${el.type}:** ${el.explanation}.`)
      : ['- The article provides basic factual reporting.'];

    const methodology = [
      '### Methodology Note',
      `- The '${rating}' rating is based on a multi-factor analysis, including ${points.toFixed(1)} bias evidence points and a balance score of ${balanceScore}/10.`
    ];

    return [
      ...findings,
      '',
      '### Biased Languages Used',
      ...biasedLanguage,
      '',
      '### Neutral Languages Used',
      ...neutralElements,
      '',
      ...methodology
    ].join('\n');
  }

  // ========================================
  // CONSTANTS
  // ========================================
  const CONSTANTS = {
    FADE_DURATION_MS: 400,
    MESSAGE_INTERVAL_MS: 2500,
    MIN_ARTICLE_LENGTH: 100,
    MAX_PARAGRAPHS_TO_ANALYZE: 10,
  };

  const SCAN_MESSAGES = [
    "Analyzing article structure & context...",
    "Scanning narrative for loaded language...",
    "Identifying potential bias indicators...",
    "Checking for journalistic balance...",
    "Building case: Examining evidence...",
    "Cross-examining: Challenging findings...",
    "Synthesizing results: Judge rendering verdict...",
    "Finalizing comprehensive bias report..."
  ];

  // ========================================
  // DOM ELEMENTS
  // ========================================
  const elements = {
    mainContainer: document.querySelector('.panel-container'),
    animationContainer: document.querySelector('#animation-container'),
    detectionHelper: document.querySelector('.detection-helper'),
    privateToggle: document.querySelector('#private-toggle'),
    realtimeToggle: document.querySelector('#realtime-toggle'),
    scanButton: document.querySelector('.cta-button'),
    cancelScanButton: document.querySelector('#cancel-scan-button'),
    statusText: document.querySelector('#scan-status-text'),
    settingsButton: document.querySelector('#settings-button'),
    viewResultsButton: document.getElementById('view-results-button'),
    resultsModalContainer: document.getElementById('results-modal-container'),
    closeModalButton: document.getElementById('close-modal-button'),
  };

  // Validate all required elements exist (except optional animation container)
  for (const [key, element] of Object.entries(elements)) {
    if (!element && key !== 'animationContainer') {
      spError(`Critical UI element missing: "${key}"`);
      showFatalError(`Failed to initialize: Missing element "${key}"`);
      return;
    }
  }

  // Log warning for optional elements
  if (!elements.animationContainer) {
    spWarn('Animation container element missing; continuing without optional animation');
  }

  // ========================================
  // STATE MANAGEMENT
  // ========================================
  let state = {
    isScanning: false,
    statusInterval: null,
    currentSession: null,
    timeoutId: null,
  };

  // ========================================
  // UTILITY FUNCTIONS
  // ========================================

  /**
   * Shows a notification toast message
   * @param {string} message - The message to display
   * @param {string} type - The notification type ('success' or 'error')
   */
  function showNotification(message, type = 'error') {
    const toast = document.querySelector('#notification-toast');
    if (!toast) {
      spError('Notification toast element not found');
      return;
    }

    const messageSpan = toast.querySelector('span');
    if (!messageSpan) {
      spError('Notification toast span not found');
      return;
    }

    // Update message and type
    messageSpan.textContent = message;
    toast.className = ''; // Clear all classes
    toast.classList.add('visible', type);

    // Auto-hide after 4 seconds
    setTimeout(() => {
      toast.classList.remove('visible');
    }, 4000);
  }

  /**
   * Validates if Chrome extension APIs are available
   */
  function validateChromeAPI() {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      spError('Chrome extension APIs not available');
      return false;
    }
    return true;
  }

  /**
   * Checks GPU and shows warning if integrated graphics detected
   */
  async function checkGPU() {
    try {
      const { gpuWarningDismissed } = await chrome.storage.local.get(['gpuWarningDismissed']);
      if (gpuWarningDismissed) return;

      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      if (!gl) return;

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (!debugInfo) return;

      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      
      if (renderer.includes('Intel') && !renderer.includes('Iris Xe') && !renderer.includes('Arc')) {
        showGPUWarning();
      }
    } catch (error) {
      spWarn('GPU check failed:', error);
    }
  }

  /**
   * Shows simple GPU warning modal
   */
  function showGPUWarning() {
    const overlay = document.createElement('div');
    overlay.className = 'bn-modal-overlay visible';

    const modal = document.createElement('div');
    modal.className = 'bn-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-labelledby', 'gpu-modal-title');
    modal.setAttribute('aria-describedby', 'gpu-modal-desc');
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'bn-modal-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    
    const icon = document.createElement('div');
    icon.className = 'bn-modal-icon';
    icon.textContent = '??';
    
    const title = document.createElement('h3');
    title.id = 'gpu-modal-title';
    title.textContent = 'Integrated GPU Detected';
    
    const desc = document.createElement('p');
    desc.id = 'gpu-modal-desc';
    desc.textContent = 'Your device may experience slower processing with on-device AI. Switch to Cloud AI for faster results.';
    
    const actions = document.createElement('div');
    actions.className = 'bn-modal-actions';
    
    const primaryBtn = document.createElement('button');
    primaryBtn.id = 'gpu-switch-cloud';
    primaryBtn.className = 'bn-btn bn-btn-primary';
    primaryBtn.textContent = 'Use Cloud AI';
    
    const secondaryBtn = document.createElement('button');
    secondaryBtn.id = 'gpu-continue';
    secondaryBtn.className = 'bn-btn bn-btn-secondary';
    secondaryBtn.textContent = 'Continue Anyway';
    
    actions.appendChild(primaryBtn);
    actions.appendChild(secondaryBtn);
    
    const checkbox = document.createElement('label');
    checkbox.className = 'bn-modal-checkbox';
    const checkboxInput = document.createElement('input');
    checkboxInput.id = 'gpu-dont-show';
    checkboxInput.type = 'checkbox';
    const checkboxSpan = document.createElement('span');
    checkboxSpan.textContent = "Don't show this again";
    checkbox.appendChild(checkboxInput);
    checkbox.appendChild(checkboxSpan);
    
    modal.appendChild(closeBtn);
    modal.appendChild(icon);
    modal.appendChild(title);
    modal.appendChild(desc);
    modal.appendChild(actions);
    modal.appendChild(checkbox);
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => {
      const dontShow = checkboxInput.checked;
      if (dontShow) {
        chrome.storage.local.set({ gpuWarningDismissed: true });
      }
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 200);
    };

    closeBtn.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });

    primaryBtn.onclick = () => {
      chrome.storage.local.set({ privateMode: false, gpuWarningDismissed: true }, () => {
        elements?.privateToggle?.classList.remove('on');
        showNotification('Switched to Cloud AI', 'success');
        close();
      });
    };

    secondaryBtn.onclick = close;
  }

  /**
   * Shows a fatal error message to the user
   */
  function showFatalError(message) {
    spError('Fatal error displayed to user', message);
    if (elements.detectionHelper) {
      elements.detectionHelper.textContent = `Error: ${message}`;
      elements.detectionHelper.style.color = '#ef4444';
    }
    showNotification(message, 'error');
  }

  /**
   * Shows user-friendly error with optional recovery suggestion
   */
  function showError(message, recovery = null) {
    spError('User notification issued', { message, recovery });
    const fullMessage = recovery ? `${message}\n\n${recovery}` : message;
    showNotification(fullMessage, 'error');
  }

  /**
   * Safely updates Chrome storage with error handling
   */
  async function safeStorageSet(data) {
    if (!validateChromeAPI()) return false;
    
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(data, () => {
          if (chrome.runtime.lastError) {
            spError('Storage error:', chrome.runtime.lastError);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      } catch (error) {
        spError('Storage exception:', error);
        resolve(false);
      }
    });
  }

  /**
   * Safely retrieves Chrome storage with error handling
   */
  async function safeStorageGet(keys) {
    if (!validateChromeAPI()) return null;
    
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          if (chrome.runtime.lastError) {
            spError('Storage error:', chrome.runtime.lastError);
            resolve(null);
          } else {
            resolve(result);
          }
        });
      } catch (error) {
        spError('Storage exception:', error);
        resolve(null);
      }
    });
  }

  // ========================================
  // VIEW MANAGEMENT
  // ========================================
  
  /**
   * Changes the UI view state
   */
  function setView(view) {
    elements.mainContainer.classList.remove('scanning');
    
    if (view === 'scanning') {
      elements.mainContainer.classList.add('scanning');
    }
  }

  // ========================================
  // STATUS UPDATES
  // ========================================
  
  /**
   * Starts animated status messages during scan
   */
  function startStatusUpdates() {
    let messageIndex = 0;
    const messages = SCAN_MESSAGES.length ? SCAN_MESSAGES : ["Analyzing article..."];

    function updateMessage() {
      const currentMessage = messages[messageIndex % messages.length];
      
      elements.statusText.classList.add('exiting');
      
      setTimeout(() => {
        elements.statusText.textContent = currentMessage;
        elements.statusText.classList.remove('exiting');
      }, CONSTANTS.FADE_DURATION_MS);
      
      messageIndex++;
    }
    
    updateMessage();
    state.statusInterval = setInterval(updateMessage, CONSTANTS.MESSAGE_INTERVAL_MS);
  }

  /**
   * Stops status update animation
   */
  function stopStatusUpdates() {
    if (state.statusInterval) {
      clearInterval(state.statusInterval);
      state.statusInterval = null;
    }
  }

  // ========================================
  // RESULTS PAGE
  // ========================================
  
  /**
   * Persists the latest analysis results for later viewing
   */
  async function saveAnalysisResults(analysisData, source, articleInfo, reportId) {
    if (!validateChromeAPI()) {
      showError('Cannot save analysis results: Chrome APIs unavailable');
      return;
    }

    // Validate required data
    if (!analysisData || !source || !articleInfo) {
      spError('Invalid data for results page:', {
        hasAnalysis: !!analysisData,
        hasSource: !!source,
        hasArticleInfo: !!articleInfo,
      });
      showError('Cannot save results: Invalid analysis data');
      return;
    }

    const finalReportId = reportId || Date.now();

    spLog('Saving analysis results to history...');
    spLog('analysisData type:', typeof analysisData);
    spLog('analysisData value:', analysisData);
    spLog('analysisData length:', typeof analysisData === 'string' ? analysisData.length : 'N/A');
    spLog('source:', source);
    spLog('articleInfo:', articleInfo);

    // Data is already normalized at source (background.js)
    // Extract text and pre-extracted fields
    let normalized = (typeof analysisData === 'string')
      ? analysisData
      : (analysisData?.text || analysisData?.analysis || JSON.stringify(analysisData, null, 2));

    const resultToStore = {
      id: finalReportId, // Add unique ID for history
      summary: normalized, // already normalized from background
      source: source,
      url: articleInfo.url || '',
      title: articleInfo.title || 'Untitled Article',
      timestamp: finalReportId,
      raw: {
        analysis: analysisData,
        source: source,
        contentLength: articleInfo.fullText?.length || 0,
        paragraphCount: articleInfo.paragraphs?.length || 0,
        fullText: articleInfo.fullText || '',
        timestamp: Date.now(),
        // Store pre-extracted from background for fast rendering
        extractedRating: analysisData?.extractedRating || null,
        extractedConfidence: analysisData?.extractedConfidence || null
      },
    };

    spLog('Prepared analysis payload for storage');
    spLog('resultToStore.summary type:', typeof resultToStore.summary);
    spLog('resultToStore.summary:', resultToStore.summary);
    spLog('resultToStore.raw:', resultToStore.raw);
    spLog('Full resultToStore:', JSON.stringify(resultToStore, null, 2));

    // ===== WAIT FOR SUMMARY TO COMPLETE =====
    // Give the summary generation 30 seconds to complete
    let summaryAttempts = 0;
    const maxSummaryWait = 30; // 30 seconds max
    
    while (summaryAttempts < maxSummaryWait) {
      const summaryStorage = await safeStorageGet(['lastSummary']);
      const lastSummary = summaryStorage?.lastSummary;
      
      if (lastSummary && lastSummary.status === 'complete') {
        // Summary is ready! Embed it in the report
        resultToStore.articleSummary = lastSummary.data;
        resultToStore.summaryUsedCloud = lastSummary.usedCloudFallback || false;
        spLog('Embedded summary detected in report payload');
        break;
      }
      
      if (lastSummary && lastSummary.status === 'error') {
        spWarn('Summary embedding failed; saving report without it');
        break;
      }
      
      // Wait 1 second before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
      summaryAttempts++;
    }
    
    if (summaryAttempts >= maxSummaryWait) {
      spWarn('Summary embedding timed out; saving report without it');
    }
    // ===== END WAIT FOR SUMMARY =====

    // Read existing history
    const storage = await safeStorageGet(['analysisHistory']);
    const analysisHistory = Array.isArray(storage?.analysisHistory) ? storage.analysisHistory : [];

    // Prepend new report to history
    const updatedHistory = [resultToStore, ...analysisHistory];

    // Save both history and lastAnalysis
    const stored = await safeStorageSet({
      analysisHistory: updatedHistory,
      lastAnalysis: resultToStore
    });

    if (!stored) {
      showError(
        'Failed to save analysis results.',
        'The analysis completed but could not be saved. Please try again.'
      );
      return;
    }

    sessionStorage.setItem('viewReportId', finalReportId);

    spLog('Analysis saved to history with ID:', resultToStore.id);

    if (elements.resultsModalContainer) {
      elements.resultsModalContainer.classList.remove('modal-hidden');
      elements.resultsModalContainer.classList.add('modal-visible');
    }
    spLog('Analysis results saved to storage');
  }

  // ========================================
  // AI SCANNING
  // ========================================

  /**
   * Triggers a separate summary generation process.
   * Tries on-device first, falls back to cloud if unavailable.
   * This runs independently of the main bias scan.
   */
  async function triggerOnDeviceSummary(articleContent) {
    spLog('Starting independent summary generation...');

    // Save a placeholder immediately so the UI can show a "generating" state
    await safeStorageSet({ lastSummary: { status: 'generating' } });

    // Try on-device summarization first
    if ('Summarizer' in self) {
      try {
        const availability = await Summarizer.availability();
        if (availability !== 'unavailable') {
          const summarizer = await Summarizer.create({
            type: 'key-points',
            format: 'markdown',
            length: 'short'
          });

          const fullText = (articleContent.fullText || '').slice(0, 2000); // Only first 2k chars
          const summaryMarkdown = await summarizer.summarize(
            fullText,
            {
              context: 'Generate concise key points for a news article. 3-5 bullet points maximum.'
            }
          );

          // Save the successful on-device summary
          await safeStorageSet({ 
            lastSummary: { 
              status: 'complete', 
              data: summaryMarkdown, 
              usedCloudFallback: false 
            } 
          });
          spLog('On-device summary generation complete; result saved');
          return;
        }
      } catch (error) {
        spWarn('On-device summary failed; trying cloud fallback:', error);
      }
    }

    // Cloud fallback: Use Gemini API
    spLog('Using cloud fallback for summary generation');
    try {
      const settings = await safeStorageGet(['geminiApiKey']);
      const apiKey = settings?.geminiApiKey?.trim();
      
      if (!apiKey) {
        throw new Error('Gemini API key not configured');
      }

      const fullText = (articleContent.fullText || '').slice(0, 2000); // Only first 2k chars
      const prompt = `Summarize the following news article into 3-5 concise bullet points in markdown format. Focus on key facts and main points only.

Article:
${fullText}`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 500
          }
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      const summaryText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!summaryText) {
        throw new Error('No summary returned from API');
      }

      await safeStorageSet({ 
        lastSummary: { 
          status: 'complete', 
          data: summaryText, 
          usedCloudFallback: true 
        } 
      });
      spLog('Cloud summary generation complete; result saved');

    } catch (error) {
      spError('Summary generation failed (both on-device and cloud):', error);
      await safeStorageSet({ 
        lastSummary: { 
          status: 'error', 
          data: `Summary generation failed: ${error.message}` 
        } 
      });
    }
  }

  /**
   * Scans article using on-device AI with a "chunking" strategy to handle large texts.
   */
  async function scanWithOnDeviceAI(articleContent, tabId) {
    if (state.isScanning) {
      spWarn('On-device scan already in progress; skipping new request');
      return;
    }

    state.isScanning = true;
    elements.scanButton.disabled = true;
    setView('scanning');
    startStatusUpdates();

    try {
      // --- Immediately trigger the separate on-device summary ---
      triggerOnDeviceSummary(articleContent);
      spLog('Background summary generation started');

      const availability = await window.LanguageModel.availability();
      if (availability !== 'available') {
        throw new Error(`On-device AI is not ready. Status: ${availability}`);
      }

      spLog('Starting on-device chunk analysis');
      const session = await window.LanguageModel.create();
      state.currentSession = session;

      const fullText = articleContent.fullText || '';
      const chunkSize = 3500; // Safely below the ~4000 char (1024 token) limit
      const overlap = 500;   // Overlap chunks to maintain context
      const chunks = [];
      for (let i = 0; i < fullText.length; i += (chunkSize - overlap)) {
        chunks.push(fullText.substring(i, i + chunkSize));
      }
      spLog(`Article split into ${chunks.length} chunks.`);

      // --- Run analysis agents on each chunk in parallel ---
      const analysisPromises = chunks.map(async (chunk) => {
        // We only need the core agents for chunk analysis
        const contextPrompt = AgentPrompts.createContextPrompt(chunk);
        const contextJSON = safeJSON(await session.prompt(contextPrompt), { type: 'Unknown' });
        spLog('Context Analysis Result:', {
          type: contextJSON.type,
          is_opinion: contextJSON.is_opinion_or_analysis,
          confidence: contextJSON.confidence,
          full: contextJSON
        });
        const contextData = `${contextJSON.type || 'Unknown'} chunk.`;

        const languagePrompt = AgentPrompts.createLanguagePrompt(contextData, chunk);
        const hunterPrompt = AgentPrompts.createHunterPrompt(contextData, chunk);
        const skepticPrompt = AgentPrompts.createSkepticPrompt(contextData, chunk);
        const quotePrompt = AgentPrompts.createQuotePrompt(contextData, chunk);

        const [langRes, huntRes, skepRes, quoteRes] = await Promise.all([
          session.prompt(languagePrompt),
          session.prompt(hunterPrompt),
          session.prompt(skepticPrompt),
          session.prompt(quotePrompt)
        ]);

        const rawSkeptic = safeJSON(skepRes, { balanced_elements: [], balance_score: 5, confidence: 'High' });
        let balancedElements = [];
        if (Array.isArray(rawSkeptic.balanced_elements) && rawSkeptic.balanced_elements.length) {
          balancedElements = await ensureBalancedExamples(
            rawSkeptic.balanced_elements,
            chunk,
            async (element, chunkText) => {
              const snippetPrompt = AgentPrompts.createBalancedSnippetPrompt(contextData, chunkText, element);
              const snippetResponse = await session.prompt(snippetPrompt);
              const snippetJSON = safeJSON(snippetResponse, { example: null });
              return typeof snippetJSON.example === 'string' ? snippetJSON.example.trim() : '';
            }
          );
        }
        const skeptic = { ...rawSkeptic, balanced_elements: balancedElements };

        return {
          context: contextJSON,
          language: safeJSON(langRes, { loaded_phrases: [], neutrality_score: 10, confidence: 'High' }),
          hunter: safeJSON(huntRes, { bias_indicators: [], overall_bias: 'Center', confidence: 'High' }),
          skeptic,
          quotes: safeJSON(quoteRes, { quotes: [], quotes_with_loaded_terms: 0, total_quotes: 0, confidence: 'High' })
        };
      });

      const chunkAnalyses = await Promise.all(analysisPromises);
      spLog(`Completed analysis on all ${chunkAnalyses.length} chunks.`);

      // --- Aggregate highlight data from all chunks ---
      spLog('Aggregating highlight data');
      const allLoadedPhrases = [];
      const allBalancedElements = [];
      
      chunkAnalyses.forEach((chunkResult) => {
        // Aggregate loaded phrases from language analysis
        if (chunkResult.language && Array.isArray(chunkResult.language.loaded_phrases)) {
          allLoadedPhrases.push(...chunkResult.language.loaded_phrases);
        }
        
        // Aggregate balanced elements from skeptic analysis
        if (chunkResult.skeptic && Array.isArray(chunkResult.skeptic.balanced_elements)) {
          allBalancedElements.push(...chunkResult.skeptic.balanced_elements);
        }
      });
      
      spLog('Aggregated phrases:', {
        biasedCount: allLoadedPhrases.length,
        neutralCount: allBalancedElements.length
      });

      // --- Synthesize the results from all chunks ---
      spLog('Synthesizing final report');
      const synthesizerPrompt = AgentPrompts.createSynthesizerPrompt(JSON.stringify(chunkAnalyses, null, 2));
      const finalReportMarkdown = await session.prompt(synthesizerPrompt);

      // The final report is a simple object containing the markdown text
      const analysisResult = { text: finalReportMarkdown };

      await session.destroy();

      // --- Save to history ---
      spLog('Saving analysis entry to history');
      const reportId = Date.now();
      
      // Call saveAnalysisResults with reportId
      await saveAnalysisResults(analysisResult, 'on-device (chunked)', articleContent, reportId);

      // --- Send highlighting data to content script ---
      const hasBiasedPhrases = allLoadedPhrases.length > 0;
      const hasNeutralPhrases = allBalancedElements.length > 0;
      
      if ((hasBiasedPhrases || hasNeutralPhrases) && tabId) {
        try {
          await chrome.tabs.sendMessage(tabId, {
            type: 'HIGHLIGHT_DATA',
            biasedPhrases: allLoadedPhrases,
            neutralPhrases: allBalancedElements
          });
          spLog('Highlight data sent to content script:', {
            biasedCount: allLoadedPhrases.length,
            neutralCount: allBalancedElements.length
          });
        } catch (error) {
          spWarn('Failed to send highlight data:', error);
        }
      }

      stopStatusUpdates();
      setView('default');
      state.isScanning = false;
      elements.scanButton.disabled = false;

    } catch (error) {
      spError("On-device chunked scan failed:", error);
      if (state.currentSession) {
        try { state.currentSession.destroy(); } catch {}
      }
      setView('default');
      stopStatusUpdates();
      state.isScanning = false;
      elements.scanButton.disabled = false;
      showNotification(`On-device scan failed: ${error.message}`, 'error');
    }
  }

  async function scanWithCloudAI(articleContent) {
    if (state.isScanning) {
      spWarn('Cloud scan already in progress; ignoring duplicate request');
      return;
    }

    if (!validateChromeAPI()) {
      showError('Cannot perform scan: Chrome APIs unavailable');
      return;
    }

    state.isScanning = true;
    elements.scanButton.disabled = true;
    setView('scanning');
    startStatusUpdates();

    // --- Immediately trigger the separate on-device summary (runs independently) ---
    triggerOnDeviceSummary(articleContent);
    spLog('Background summary generation started');

    spLog('Sending scan request to background script');
    spLog('Article content length:', articleContent.fullText?.length);

    // Get the active tab ID to pass to background
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tab?.id;

    try {
      chrome.runtime.sendMessage({ type: 'REQUEST_SCAN', tabId, articleContent: articleContent }, async (response) => {


        stopStatusUpdates();
        setView('default');
        state.isScanning = false;
        elements.scanButton.disabled = false;

        // Check for errors
        if (chrome.runtime.lastError) {
          spError('Message error:', chrome.runtime.lastError);
          showError(
            'Failed to communicate with the background script.',
            'Please refresh the page and try again.'
          );
          return;
        }

        // Validate response
        if (!response) {
          spError('No response from background script');
          showError('No response from analysis service.', 'Please try again.');
          return;
        }

        if (response.type === 'SCAN_COMPLETE') {
          spLog('Cloud AI scan completed');
          spLog('Response type:', typeof response.results);
          spLog('Response results:', response.results);
          spLog('Response results length:', typeof response.results === 'string' ? response.results.length : 'N/A');
          await saveAnalysisResults(response.results, 'cloud', articleContent);
        } else if (response.type === 'SCAN_ERROR') {
          spError('Background script error:', response.error);
          showError(
            `Analysis failed: ${response.error || 'Unknown error'}`,
            'Please try again or contact support if the issue persists.'
          );
        } else {
          spError('Unexpected response type:', response.type);
          showError('Unexpected response from analysis service.');
        }
      });
    } catch (error) {
      spError('Exception sending message:', error);

      stopStatusUpdates();
      setView('default');
      state.isScanning = false;
      elements.scanButton.disabled = false;

      showError('Failed to start analysis.', 'Please refresh the page and try again.');
    }
  }

  // ========================================
  // EVENT HANDLERS
  // ========================================
  
  /**
   * Handles scan button click
   */
  async function handleScanButtonClick() { 
  if (state.isScanning) {
    spWarn('Scan already in progress; ignoring scan button click');
    return;
  }
  if (!validateChromeAPI()) {
    showError('Cannot perform scan: Chrome APIs unavailable');
    return;
  }
  
  // Clear old summary before starting new scan
  await safeStorageSet({
    lastSummary: {
      status: 'generating',
      data: null,
      timestamp: Date.now()
    }
  });
  spLog('Cleared previous summary; ready for new scan');
  
  try {
    const settings = await safeStorageGet(['privateMode']);
    if (!settings) throw new Error('Failed to load settings.');
    
    const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
    if (!tabs?.[0]?.id) throw new Error('Cannot access active tab.');
    const activeTab = tabs[0];
    
    const articleContent = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(activeTab.id, { type: 'GET_CONTENT' }, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });

    if (!articleContent) throw new Error('Could not extract content from this page.');
    
    if ((articleContent.fullText?.length || 0) < CONSTANTS.MIN_ARTICLE_LENGTH) {
      throw new Error(`Not enough text found to analyze. Found: ${articleContent.fullText?.length || 0} characters.`);
    }

    if (settings.privateMode) {
      await scanWithOnDeviceAI(articleContent, activeTab.id);
    } else {
      scanWithCloudAI(articleContent);
    }
  } catch (error) {
    spError('Scan initiation failed:', error);
    const errorMessage = (error && typeof error.message === 'string') ? error.message : '';
    if (errorMessage.includes('Receiving end does not exist')) {
      showError(
        'Failed to connect to the page.',
        'Please refresh the page you want to analyze and try again.'
      );
    } else {
      const detail = errorMessage || 'Unknown error';
      showError(
        `Failed to start scan: ${detail}`,
        'Please try again or reload the page and the extension.'
      );
    }
    // This is the important fix: reset state on failure
    state.isScanning = false;
    if (elements.scanButton) elements.scanButton.disabled = false;
  }
}

  /**
   * Handles cancel scan button click
   */
  function handleCancelScan() {
    spLog('User cancelled scan');
    
    // Stop status updates
    stopStatusUpdates();
    
    // Clear timeout
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
      state.timeoutId = null;
    }
    
    // Destroy AI session if active
    if (state.currentSession) {
      try {
        state.currentSession.destroy();
        spLog('AI session destroyed');
      } catch (error) {
        spError('Failed to destroy session:', error);
      }
      state.currentSession = null;
    }
    
    // Notify background script to cancel
    if (validateChromeAPI()) {
      try {
        chrome.runtime.sendMessage({ type: 'CANCEL_SCAN' });
      } catch (error) {
        spError('Failed to send cancel message:', error);
      }
    }
    
    // Reset UI
    setView('default');
    state.isScanning = false;
    if (elements.scanButton) elements.scanButton.disabled = false;
  }

  /**
   * Handles toggle button clicks
   */
  async function handleToggleClick(toggleElement, storageKey) {
    const isNowOn = toggleElement.classList.toggle('on');
    spLog(`Toggle ${storageKey}:`, isNowOn);
    
    const success = await safeStorageSet({ [storageKey]: isNowOn });
    
    if (!success) {
      // Revert toggle if storage failed
      toggleElement.classList.toggle('on');
      showError('Failed to save setting.', 'Please try again.');
    }
  }

  /**
   * Opens settings page
   */
  function handleSettingsClick() {
    if (!validateChromeAPI()) {
      showError('Cannot open settings: Chrome APIs unavailable');
      return;
    }

    try {
      chrome.runtime.openOptionsPage();
    } catch (error) {
      spError('Failed to open settings:', error);
      showError('Failed to open settings page.');
    }
  }

  // ========================================
  // INITIALIZATION
  // ========================================
  
  /**
   * Initializes panel state on load
   */
  async function initializePanelState() {
    spLog('Initializing panel state');

    // Load settings
    const settings = await safeStorageGet(['privateMode', 'realtimeMode']);
    
    if (settings) {
      if (settings.privateMode) {
        elements.privateToggle.classList.add('on');
        spLog('Private mode enabled');
      }
      if (settings.realtimeMode) {
        elements.realtimeToggle.classList.add('on');
        spLog('Realtime mode enabled');
      }
    }

    // Update detection helper with current tab info
    if (!validateChromeAPI()) return;

    try {
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, resolve);
      });

      if (tabs?.[0]?.url) {
        try {
          const url = new URL(tabs[0].url);
          const hostname = url.hostname.replace(/^www\./, '');
          elements.detectionHelper.textContent = `Detected: ${hostname} article ready for analysis`;
          spLog('Current domain:', hostname);
        } catch (error) {
          elements.detectionHelper.textContent = 'Ready to analyze an article';
        }
      } else {
        elements.detectionHelper.textContent = 'Ready to analyze an article';
      }
    } catch (error) {
      spError('Failed to get tab info:', error);
      elements.detectionHelper.textContent = 'Ready to analyze an article';
    }
  }

  /**
   * Sets up event listeners with delegation
   */
  function setupEventListeners() {
    spLog('Setting up event listeners');

    // Use event delegation on main container
    elements.mainContainer.addEventListener('click', (event) => {
      const target = event.target;

      // Scan button
      if (target.closest('.cta-button')) {
        event.preventDefault();
        handleScanButtonClick();
        return;
      }

      // Cancel button
      if (target.closest('#cancel-scan-button')) {
        event.preventDefault();
        handleCancelScan();
        return;
      }

      // Private mode toggle
      if (target.closest('#private-toggle')) {
        event.preventDefault();
        handleToggleClick(elements.privateToggle, 'privateMode');
        return;
      }

      // Realtime mode toggle
      if (target.closest('#realtime-toggle')) {
        event.preventDefault();
        handleToggleClick(elements.realtimeToggle, 'realtimeMode');
        return;
      }

      // Settings button
      if (target.closest('#settings-button')) {
        event.preventDefault();
        handleSettingsClick();
        return;
      }

      // Reports button - opens reports page in new tab
      if (target.closest('#reports-button')) {
        event.preventDefault();
        if (!validateChromeAPI()) {
          showError('Cannot open reports page: Chrome APIs unavailable');
          return;
        }
        try {
          chrome.tabs.create({ url: chrome.runtime.getURL('reports/reports.html') });
        } catch (error) {
          spError('Failed to open reports page:', error);
          showError('Failed to open reports page.');
        }
        return;
      }

      // Help button - opens help page in new tab
      if (target.closest('#help-button')) {
        event.preventDefault();
        if (!validateChromeAPI()) {
          showError('Cannot open help page: Chrome APIs unavailable');
          return;
        }
        try {
          chrome.tabs.create({ url: chrome.runtime.getURL('help/help.html') });
        } catch (error) {
          spError('Failed to open help page:', error);
          showError('Failed to open help page.');
        }
        return;
      }

      if (target.closest('#view-results-button')) {
        event.preventDefault();
        if (!validateChromeAPI()) {
          showError('Cannot open results page: Chrome APIs unavailable');
          return;
        }
        
        // Get the reportId from sessionStorage and pass it via URL parameter
        const reportId = sessionStorage.getItem('viewReportId');
        const baseUrl = chrome.runtime.getURL('results/results.html');
        const url = reportId ? `${baseUrl}?reportId=${reportId}` : baseUrl;
        
        chrome.tabs.create({ url: url });
        return;
      }

      if (target.closest('#close-modal-button')) {
        event.preventDefault();
        if (elements.resultsModalContainer) {
          elements.resultsModalContainer.classList.remove('modal-visible');
          elements.resultsModalContainer.classList.add('modal-hidden');
        }
        return;
      }
    });

    spLog('Event listeners ready');
  }

  /**
   * Cleanup on page unload
   */
  window.addEventListener('beforeunload', () => {
    spLog('Cleaning up before unload');
    
    stopStatusUpdates();
    
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
    }
    
    if (state.currentSession) {
      try {
        state.currentSession.destroy();
      } catch (error) {
        spError('Cleanup error:', error);
      }
    }
  });

  // ========================================
  // START APPLICATION
  // ========================================
  
  spLog('Side panel initializing...');
  initializePanelState();
  setupEventListeners();
  checkGPU();
  spLog('Side panel ready');
});









