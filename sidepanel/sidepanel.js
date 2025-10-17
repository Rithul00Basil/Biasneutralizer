/**
 * BiasNeutralizer Side Panel Controller
 * Manages article scanning, AI analysis, and user interactions
 */
import { AgentPrompts } from '../shared/prompts.js';
document.addEventListener('DOMContentLoaded', () => {
  // === sidepanel rating validation + model label helpers ===
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

  function deriveQuickModeratorMarkdown(contextJSON, languageJSON, hunterJSON, skepticJSON, quoteJSON) {
    const t = String(contextJSON?.type || '').toLowerCase();
    const isOpinionAnalysis = !!contextJSON?.is_opinion_or_analysis || t === 'opinion' || t === 'analysis';

    // Handle Opinion/Analysis Content
    if (isOpinionAnalysis) {
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
    
    PHASE_1_MESSAGES: [
      "Preparing your article for analysis...",
      "Scanning language tone and sentiment...",
      "Detecting possible bias patterns...",
      "Spotting emotionally charged phrases...",
      "Checking rhetorical devices in use...",
    ],
    
    PHASE_2_MESSAGES: [
      "Highlighting logical fallacies...",
      "Comparing source credibility metrics...",
      "Analyzing balance of perspectives...",
      "Evaluating neutrality of wording...",
      "Looking for cherry-picked examples...",
      "Measuring evidence vs opinion ratio...",
      "Cross-referencing fact consistency...",
    ],
  };

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
      console.error(`[BiasNeutralizer] Critical UI element missing: "${key}"`);
      showFatalError(`Failed to initialize: Missing element "${key}"`);
      return;
    }
  }

  // Log warning for optional elements
  if (!elements.animationContainer) {
    console.warn('[BiasNeutralizer] Optional element missing: animationContainer');
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
      console.error('[BiasNeutralizer] Notification toast element not found');
      return;
    }

    const messageSpan = toast.querySelector('span');
    if (!messageSpan) {
      console.error('[BiasNeutralizer] Notification toast span not found');
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
      console.error('[BiasNeutralizer] Chrome extension APIs not available');
      return false;
    }
    return true;
  }

  /**
   * Shows a fatal error message to the user
   */
  function showFatalError(message) {
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
    console.error(`[BiasNeutralizer] ${message}`);
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
            console.error('[BiasNeutralizer] Storage error:', chrome.runtime.lastError);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      } catch (error) {
        console.error('[BiasNeutralizer] Storage exception:', error);
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
            console.error('[BiasNeutralizer] Storage error:', chrome.runtime.lastError);
            resolve(null);
          } else {
            resolve(result);
          }
        });
      } catch (error) {
        console.error('[BiasNeutralizer] Storage exception:', error);
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
    const phase1Limit = CONSTANTS.PHASE_1_MESSAGES.length;
    
    function updateMessage() {
      let currentMessage;
      
      if (messageIndex < phase1Limit) {
        currentMessage = CONSTANTS.PHASE_1_MESSAGES[messageIndex];
      } else {
        const phase2Index = (messageIndex - phase1Limit) % CONSTANTS.PHASE_2_MESSAGES.length;
        currentMessage = CONSTANTS.PHASE_2_MESSAGES[phase2Index];
      }
      
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
      console.error('[BiasNeutralizer] Invalid data for results page:', {
        hasAnalysis: !!analysisData,
        hasSource: !!source,
        hasArticleInfo: !!articleInfo,
      });
      showError('Cannot save results: Invalid analysis data');
      return;
    }

    const finalReportId = reportId || Date.now();

    console.log('[BiasNeutralizer] ===== SAVING ANALYSIS RESULTS =====');
    console.log('[BiasNeutralizer] analysisData type:', typeof analysisData);
    console.log('[BiasNeutralizer] analysisData value:', analysisData);
    console.log('[BiasNeutralizer] analysisData length:', typeof analysisData === 'string' ? analysisData.length : 'N/A');
    console.log('[BiasNeutralizer] source:', source);
    console.log('[BiasNeutralizer] articleInfo:', articleInfo);

    // Normalize analysis payload to a clean string and map bracket labels early
    let normalized = (typeof analysisData === 'string')
      ? analysisData
      : (analysisData?.text || analysisData?.analysis || JSON.stringify(analysisData, null, 2));
    normalized = String(normalized)
      .replace(/\[RATING\]\s*:/gi, 'Rating:')
      .replace(/\[CONFIDENCE\]\s*:/gi, 'Confidence:');

    // Validate/normalize moderator sections for rating and confidence
    normalized = normalizeModeratorSections(normalized);

    const resultToStore = {
      id: finalReportId, // Add unique ID for history
      summary: normalized, // always a string
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
        timestamp: Date.now()
      },
    };

    console.log('[BiasNeutralizer] ===== RESULT TO STORE =====');
    console.log('[BiasNeutralizer] resultToStore.summary type:', typeof resultToStore.summary);
    console.log('[BiasNeutralizer] resultToStore.summary:', resultToStore.summary);
    console.log('[BiasNeutralizer] resultToStore.raw:', resultToStore.raw);
    console.log('[BiasNeutralizer] Full resultToStore:', JSON.stringify(resultToStore, null, 2));

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

    console.log('[BiasNeutralizer] Analysis saved to history with ID:', resultToStore.id);

    if (elements.resultsModalContainer) {
      elements.resultsModalContainer.classList.remove('modal-hidden');
      elements.resultsModalContainer.classList.add('modal-visible');
    }
    console.log('[BiasNeutralizer] Analysis results saved to storage');
  }

  // ========================================
  // AI SCANNING
  // ========================================

  /**
   * Triggers a separate, on-device summary generation process.
   * This runs independently of the main bias scan.
   */
  async function triggerOnDeviceSummary(articleContent) {
    console.log('[BiasNeutralizer] Starting independent on-device summary...');

    // Save a placeholder immediately so the UI can show a "generating" state
    await safeStorageSet({ lastSummary: { status: 'generating' } });

    if (!('Summarizer' in self)) {
      await safeStorageSet({ lastSummary: { status: 'error', data: 'Summarizer API not supported.' } });
      return;
    }

    try {
      const availability = await Summarizer.availability();
      if (availability === 'unavailable') {
        throw new Error('On-device model is not available on this device.');
      }

      const summarizer = await Summarizer.create({
        type: 'key-points',
        format: 'markdown',
        length: 'short' // Changed from 'long' to 'short' for speed
      });

      const fullText = articleContent.fullText || '';
      let summaryMarkdown = '';
      if (fullText.length > 5000) {
        // Chunk if >5k chars
        const chunks = fullText.match(/.{1,2000}/g); // Rough chunking
        let chunkSummaries = [];
        for (const chunk of chunks) {
          const chunkSummary = await summarizer.summarize(
            chunk,
            {
              context: 'Generate concise key points for a news article chunk. 2-3 bullet points maximum.'
            }
          );
          chunkSummaries.push(chunkSummary);
        }
        // Optionally, summarize the summaries for a final summary
        const combinedSummary = chunkSummaries.join('\n');
        summaryMarkdown = await summarizer.summarize(
          combinedSummary,
          {
            context: 'Combine and condense the following bullet points into a concise summary for a news article. 3-5 bullet points maximum.'
          }
        );
      } else {
        summaryMarkdown = await summarizer.summarize(
          fullText.slice(0, 6000),  // Only first 6k chars for speed
          {
            context: 'Generate concise key points for a news article. 3-5 bullet points maximum.'
          }
        );
      }

      // Save the successful summary
      await safeStorageSet({ lastSummary: { status: 'complete', data: summaryMarkdown } });
      console.log('[BiasNeutralizer] On-device summary complete and saved.');

    } catch (error) {
      console.error('Independent summary failed:', error);
      await safeStorageSet({ lastSummary: { status: 'error', data: error.message } });
    }
  }

  /**
   * Scans article using on-device AI with a "chunking" strategy to handle large texts.
   */
  async function scanWithOnDeviceAI(articleContent, tabId) {
    if (state.isScanning) {
      console.warn('[BiasNeutralizer] Scan already in progress');
      return;
    }

    state.isScanning = true;
    elements.scanButton.disabled = true;
    setView('scanning');
    startStatusUpdates();

    try {
      // --- Immediately trigger the separate on-device summary ---
      triggerOnDeviceSummary(articleContent);

      const availability = await window.LanguageModel.availability();
      if (availability !== 'available') {
        throw new Error(`On-device AI is not ready. Status: ${availability}`);
      }

      console.log("--- Starting On-Device Chunk Analysis ---");
      const session = await window.LanguageModel.create();
      state.currentSession = session;

      const fullText = articleContent.fullText || '';
      const chunkSize = 3500; // Safely below the ~4000 char (1024 token) limit
      const overlap = 500;   // Overlap chunks to maintain context
      const chunks = [];
      for (let i = 0; i < fullText.length; i += (chunkSize - overlap)) {
        chunks.push(fullText.substring(i, i + chunkSize));
      }
      console.log(`Article split into ${chunks.length} chunks.`);

      // --- Run analysis agents on each chunk in parallel ---
      const analysisPromises = chunks.map(async (chunk) => {
        // We only need the core agents for chunk analysis
        const contextPrompt = AgentPrompts.createContextPrompt(chunk);
        const contextJSON = safeJSON(await session.prompt(contextPrompt), { type: 'Unknown' });
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

        return {
          context: contextJSON,
          language: safeJSON(langRes, { loaded_phrases: [], neutrality_score: 10, confidence: 'High' }),
          hunter: safeJSON(huntRes, { bias_indicators: [], overall_bias: 'Center', confidence: 'High' }),
          skeptic: safeJSON(skepRes, { balanced_elements: [], balance_score: 5, confidence: 'High' }),
          quotes: safeJSON(quoteRes, { quotes: [], quotes_with_loaded_terms: 0, total_quotes: 0, confidence: 'High' })
        };
      });

      const chunkAnalyses = await Promise.all(analysisPromises);
      console.log(`Completed analysis on all ${chunkAnalyses.length} chunks.`);

      // --- Aggregate highlight data from all chunks ---
      console.log("--- Aggregating Highlight Data ---");
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
      
      console.log('[BiasNeutralizer] Aggregated phrases:', {
        biasedCount: allLoadedPhrases.length,
        neutralCount: allBalancedElements.length
      });

      // --- Synthesize the results from all chunks ---
      console.log("--- Synthesizing Final Report ---");
      const synthesizerPrompt = AgentPrompts.createSynthesizerPrompt(JSON.stringify(chunkAnalyses, null, 2));
      const finalReportMarkdown = await session.prompt(synthesizerPrompt);

      // The final report is a simple object containing the markdown text
      const analysisResult = { text: finalReportMarkdown };

      await session.destroy();

      // --- Save to history ---
      console.log("--- Saving to Analysis History ---");
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
          console.log('[BiasNeutralizer] Highlight data sent to content script:', {
            biasedCount: allLoadedPhrases.length,
            neutralCount: allBalancedElements.length
          });
        } catch (error) {
          console.warn('[BiasNeutralizer] Failed to send highlight data:', error);
        }
      }

      stopStatusUpdates();
      setView('default');
      state.isScanning = false;
      elements.scanButton.disabled = false;

    } catch (error) {
      console.error("On-device chunked scan failed:", error);
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
      console.warn('[BiasNeutralizer] Scan already in progress');
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

    console.log('[BiasNeutralizer] Sending scan request to background script');
    console.log('[BiasNeutralizer] Article content length:', articleContent.fullText?.length);

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
          console.error('[BiasNeutralizer] Message error:', chrome.runtime.lastError);
          showError(
            'Failed to communicate with the background script.',
            'Please reload the extension and try again.'
          );
          return;
        }

        // Validate response
        if (!response) {
          console.error('[BiasNeutralizer] No response from background script');
          showError('No response from analysis service.', 'Please try again.');
          return;
        }

        if (response.type === 'SCAN_COMPLETE') {
          console.log('[BiasNeutralizer] ===== CLOUD AI SCAN COMPLETE =====');
          console.log('[BiasNeutralizer] Response type:', typeof response.results);
          console.log('[BiasNeutralizer] Response results:', response.results);
          console.log('[BiasNeutralizer] Response results length:', typeof response.results === 'string' ? response.results.length : 'N/A');
          await saveAnalysisResults(response.results, 'cloud', articleContent);
        } else if (response.type === 'SCAN_ERROR') {
          console.error('[BiasNeutralizer] Background script error:', response.error);
          showError(
            `Analysis failed: ${response.error || 'Unknown error'}`,
            'Please try again or contact support if the issue persists.'
          );
        } else {
          console.error('[BiasNeutralizer] Unexpected response type:', response.type);
          showError('Unexpected response from analysis service.');
        }
      });
    } catch (error) {
      console.error('[BiasNeutralizer] Exception sending message:', error);

      stopStatusUpdates();
      setView('default');
      state.isScanning = false;
      elements.scanButton.disabled = false;

      showError('Failed to start analysis.', 'Please reload the extension and try again.');
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
    console.warn('[BiasNeutralizer] Scan already in progress, ignoring click');
    return;
  }
  if (!validateChromeAPI()) {
    showError('Cannot perform scan: Chrome APIs unavailable');
    return;
  }
  
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
    console.error('[BiasNeutralizer] Scan initiation failed:', error);
    showError(
      `Failed to start scan: ${error.message}`,
      'Please try again or reload the page and the extension.'
    );
    // This is the important fix: reset state on failure
    state.isScanning = false;
    if (elements.scanButton) elements.scanButton.disabled = false;
  }
}

  /**
   * Handles cancel scan button click
   */
  function handleCancelScan() {
    console.log('[BiasNeutralizer] User cancelled scan');
    
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
        console.log('[BiasNeutralizer] AI session destroyed');
      } catch (error) {
        console.error('[BiasNeutralizer] Failed to destroy session:', error);
      }
      state.currentSession = null;
    }
    
    // Notify background script to cancel
    if (validateChromeAPI()) {
      try {
        chrome.runtime.sendMessage({ type: 'CANCEL_SCAN' });
      } catch (error) {
        console.error('[BiasNeutralizer] Failed to send cancel message:', error);
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
    console.log(`[BiasNeutralizer] Toggle ${storageKey}:`, isNowOn);
    
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
      console.error('[BiasNeutralizer] Failed to open settings:', error);
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
    console.log('[BiasNeutralizer] Initializing panel state');

    // Load settings
    const settings = await safeStorageGet(['privateMode', 'realtimeMode']);
    
    if (settings) {
      if (settings.privateMode) {
        elements.privateToggle.classList.add('on');
        console.log('[BiasNeutralizer] Private mode enabled');
      }
      if (settings.realtimeMode) {
        elements.realtimeToggle.classList.add('on');
        console.log('[BiasNeutralizer] Realtime mode enabled');
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
          console.log('[BiasNeutralizer] Current domain:', hostname);
        } catch (error) {
          elements.detectionHelper.textContent = 'Ready to analyze an article';
        }
      } else {
        elements.detectionHelper.textContent = 'Ready to analyze an article';
      }
    } catch (error) {
      console.error('[BiasNeutralizer] Failed to get tab info:', error);
      elements.detectionHelper.textContent = 'Ready to analyze an article';
    }
  }

  /**
   * Sets up event listeners with delegation
   */
  function setupEventListeners() {
    console.log('[BiasNeutralizer] Setting up event listeners');

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
          console.error('[BiasNeutralizer] Failed to open reports page:', error);
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
          console.error('[BiasNeutralizer] Failed to open help page:', error);
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

    console.log('[BiasNeutralizer] Event listeners ready');
  }

  /**
   * Cleanup on page unload
   */
  window.addEventListener('beforeunload', () => {
    console.log('[BiasNeutralizer] Cleaning up before unload');
    
    stopStatusUpdates();
    
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
    }
    
    if (state.currentSession) {
      try {
        state.currentSession.destroy();
      } catch (error) {
        console.error('[BiasNeutralizer] Cleanup error:', error);
      }
    }
  });

  // ========================================
  // START APPLICATION
  // ========================================
  
  console.log('[BiasNeutralizer] Side panel initializing...');
  initializePanelState();
  setupEventListeners();
  console.log('[BiasNeutralizer] Side panel ready');
});
