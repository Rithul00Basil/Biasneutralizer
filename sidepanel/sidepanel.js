/**
 * BiasNeutralizer Side Panel Controller
 * Manages article scanning, AI analysis, and user interactions
 */
document.addEventListener('DOMContentLoaded', () => {
  // ========================================
  // CONSTANTS
  // ========================================
  const CONSTANTS = {
    FADE_DURATION_MS: 400,
    MESSAGE_INTERVAL_MS: 2500,
    MIN_ARTICLE_LENGTH: 100,
    MAX_PARAGRAPHS_TO_ANALYZE: 10,
    
    PHASE_1_MESSAGES: [
      "Preparing your article for analysis…",
      "Scanning language tone and sentiment…",
      "Detecting possible bias patterns…",
      "Spotting emotionally charged phrases…",
      "Checking rhetorical devices in use…",
    ],
    
    PHASE_2_MESSAGES: [
      "Highlighting logical fallacies…",
      "Comparing source credibility metrics…",
      "Analyzing balance of perspectives…",
      "Evaluating neutrality of wording…",
      "Looking for cherry-picked examples…",
      "Measuring evidence vs opinion ratio…",
      "Cross-referencing fact consistency…",
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
   * Opens results page with analysis data
   */
  async function openResultsPage(analysisData, source, articleInfo) {
    if (!validateChromeAPI()) {
      showError('Cannot open results page: Chrome APIs unavailable');
      return;
    }

    // Validate required data
    if (!analysisData || !source || !articleInfo) {
      console.error('[BiasNeutralizer] Invalid data for results page:', {
        hasAnalysis: !!analysisData,
        hasSource: !!source,
        hasArticleInfo: !!articleInfo,
      });
      showError('Cannot display results: Invalid analysis data');
      return;
    }

    console.log('[BiasNeutralizer] ===== OPENING RESULTS PAGE =====');
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

    const resultToStore = {
      summary: normalized, // always a string
      source: source,
      url: articleInfo.url || '',
      title: articleInfo.title || 'Untitled Article',
      timestamp: Date.now(),
      raw: {
        analysis: analysisData,
        source: source,
        contentLength: articleInfo.fullText?.length || 0,
        paragraphCount: articleInfo.paragraphs?.length || 0,
        timestamp: Date.now()
      },
    };

    console.log('[BiasNeutralizer] ===== RESULT TO STORE =====');
    console.log('[BiasNeutralizer] resultToStore.summary type:', typeof resultToStore.summary);
    console.log('[BiasNeutralizer] resultToStore.summary:', resultToStore.summary);
    console.log('[BiasNeutralizer] resultToStore.raw:', resultToStore.raw);
    console.log('[BiasNeutralizer] Full resultToStore:', JSON.stringify(resultToStore, null, 2));

    const stored = await safeStorageSet({ lastAnalysis: resultToStore });
    
    if (!stored) {
      showError(
        'Failed to save analysis results.',
        'The analysis completed but could not be saved. Please try again.'
      );
      return;
    }

    try {
      const resultsUrl = chrome.runtime.getURL('results/results.html');
      await chrome.tabs.create({ url: resultsUrl });
      console.log('[BiasNeutralizer] Results page opened successfully');
    } catch (error) {
      console.error('[BiasNeutralizer] Failed to open results page:', error);
      showError(
        'Failed to open results page.',
        'The analysis was saved but the results page could not be opened.'
      );
    }
  }

  // ========================================
  // AI SCANNING
  // ========================================
  

  /**
   * Scans article using on-device AI
   */
  async function scanWithOnDeviceAI(articleContent) {
    if (state.isScanning) {
      console.warn('[BiasNeutralizer] Scan already in progress');
      return;
    }

    state.isScanning = true;
    elements.scanButton.disabled = true;
    setView('scanning');
    startStatusUpdates();
    
    try {
      const availability = await window.LanguageModel.availability();
      if (availability !== 'available') {
        setView('default');
        stopStatusUpdates();
        state.isScanning = false;
        elements.scanButton.disabled = false;
        showNotification(`On-device AI is not ready. Status: ${availability}`, 'error');
        return;
      }
      
      console.log("--- Starting Quick Bias Analysis ---");
      state.currentSession = await window.LanguageModel.create();
      const textToSend = (articleContent.fullText || '').slice(0, 6000);
      
      // PHASE 1: Context Agent with Quote Detection
      console.log("Phase 1: Context Agent...");
      const contextPrompt = `Do NOT assume bias. Classify objectively.

TYPE: News/Opinion/Analysis/Satire/Academic/Other/Unknown
SUMMARY: [exactly ten words]
TONE: Neutral/Emotional/Analytical/Mixed
QUOTE_RATIO: Low/Medium/High (0-30%/31-60%/61-100%)
QUOTE_PERCENTAGE: [0-100]
CONFIDENCE: High/Medium/Low

TEXT:
${textToSend}`;

      const contextResponse = await state.currentSession.prompt(contextPrompt);
      console.log("--- CONTEXT AGENT ---");
      console.log(contextResponse);

      // Extract context
      const contextLines = contextResponse.split('\n');
      const articleType = contextLines.find(l => l.startsWith('TYPE:'))?.split(':')[1]?.trim() || 'Unknown';
      const summary = contextLines.find(l => l.startsWith('SUMMARY:'))?.split(':')[1]?.trim() || '';
      const tone = contextLines.find(l => l.startsWith('TONE:'))?.split(':')[1]?.trim() || 'Neutral';
      const quoteRatio = contextLines.find(l => l.startsWith('QUOTE_RATIO:'))?.split(':')[1]?.trim() || 'Unknown';
      
      const contextData = `${articleType} article. ${summary}. Tone: ${tone}. Quote ratio: ${quoteRatio}.`;
      console.log("Context:", contextData);

      // PHASE 2: Run 3 Agents (Quote agent removed for quick scan)
      console.log("Phase 2: Running 3 specialized agents...");

      // Agent 1: Language Decoder (NARRATIVE ONLY)
  const languagePrompt = `Context: ${contextData}

Narrative only. Ignore quotes. Flag value-laden wording; skip precise/legal terms.

Format:
- PHRASE: "exact phrase"
  WHY: brief reason
  NEUTRAL_ALT: alternative wording
  CONTEXT: short surrounding text

NEUTRALITY: [0-10]
CONFIDENCE: High/Medium/Low
SUMMARY: one sentence

TEXT:
${textToSend}`;

      // Agent 2: Bias Hunter (NARRATIVE ONLY)
      const hunterPrompt = `Context: ${contextData}

Narrative only. Do NOT assume bias. Flag only if listed criteria met. Need ≥2 indicators or 1 High-strength.

Format:
- TYPE: Framing/Sourcing/Language/Causality/Editorial
  EXAMPLE: "exact text/structure"
  WHY: reason tied to criteria
  STRENGTH: Low/Medium/High
  EVIDENCE: para/position

OVERALL_BIAS: Strong Left/Lean Left/Center/Lean Right/Strong Right/Unclear
CONFIDENCE: High/Medium/Low

Default to Center/Unclear if insufficient evidence.

TEXT:
${textToSend}`;

      // Agent 3: Bias Skeptic
      const skepticPrompt = `Context: ${contextData}

Credit genuine balance; avoid forced symmetry. No "both sides" if one is fringe.

Format:
- TYPE: Sourcing/Attribution/Context/Nuance/Transparency
  EXAMPLE: "text"
  WHY: reason

BALANCE_SCORE: 0-10
CONFIDENCE: High/Medium/Low
STRENGTHS: one sentence

TEXT:
${textToSend}`;

      // Execute all 3 agents in parallel
      const [languageResponse, hunterResponse, skepticResponse] = await Promise.all([
        state.currentSession.prompt(languagePrompt),
        state.currentSession.prompt(hunterPrompt),
        state.currentSession.prompt(skepticPrompt)
      ]);
      
      console.log("--- LANGUAGE AGENT ---");
      console.log(languageResponse);

      console.log("--- HUNTER AGENT ---");
      console.log(hunterResponse);

      console.log("--- SKEPTIC AGENT ---");
      console.log(skepticResponse);

      // Check if deep mode (based on settings)
      const settings = await safeStorageGet(['analysisDepth']);
      const isDeepMode = settings?.analysisDepth === 'deep';

      let sourceDiversityResponse = '';
      let framingResponse = '';
      let omissionResponse = '';

      if (isDeepMode) {
        console.log("Phase 2.5: Deep mode - Running specialized agents...");
        
        // Source Diversity Agent
        const sourceDiversityPrompt = `Context: ${contextData}

Account for context; not all need partisan balance.

SOURCE_BREAKDOWN:
- official: #
- expert: #
- stakeholder: #
- advocacy: #
- partisan_left: # / partisan_right: #
- other: #

CONTEXT: Adversarial/Non-Adversarial/Unknown
GENDER: Balanced/Male-dominated/Female-dominated/Unknown
POSITIONING: lead/close notes
MISSING_VOICES: a, b (only if reasonably relevant)
DIVERSITY_SCORE: 0-10
CONFIDENCE: High/Medium/Low
ASSESSMENT: one sentence

TEXT:
${textToSend}`;

        sourceDiversityResponse = await state.currentSession.prompt(sourceDiversityPrompt);
        console.log("--- SOURCE DIVERSITY AGENT ---");
        console.log(sourceDiversityResponse);

        // Framing Agent
        const framingPrompt = `Context: ${contextData}

Distinguish normal editorial judgment from manipulation. Don't flag inverted pyramid.

HEADLINE_TONE: Neutral/Sensational/Misleading/Balanced
MATCHES_CONTENT: true/false
EXPLANATION: brief
LEAD_FOCUS: summary of first 3 paras
BURIED_INFO: a, b (after para 5)
VOICE:
- ACTIVE_SUBJECTS: a, b
- PASSIVE_OBSCURED: a, b (if inappropriate)
MANIPULATION_FLAGS: a, b (only if criteria met)
FRAMING_SCORE: 0-10
CONFIDENCE: High/Medium/Low
ASSESSMENT: one sentence

TEXT:
${textToSend}`;

        framingResponse = await state.currentSession.prompt(framingPrompt);
        console.log("--- FRAMING AGENT ---");
        console.log(framingResponse);

        // Omission Agent
        const omissionPrompt = `Context: ${contextData}

List omissions ONLY if reasonable-to-include test passed (commonly included, feasible, available).

MISSING_CONTEXT: a, b
UNADDRESSED_COUNTERARGUMENTS: a, b
MISSING_DATA: a, b
UNANSWERED_QUESTIONS: a, b
OMISSION_SEVERITY: None/Low/Medium/High
CONFIDENCE: High/Medium/Low
ASSESSMENT: one sentence

TEXT:
${textToSend}`;

        omissionResponse = await state.currentSession.prompt(omissionPrompt);
        console.log("--- OMISSION AGENT ---");
        console.log(omissionResponse);
        
        console.log("Deep analysis agents complete.");
      }

      // PHASE 3: Moderator
      console.log("Phase 3: Moderator synthesis...");
      const moderatorPrompt = `You are the Moderator. Merge the agent evidence into a neutral, methodical report.

Use EXACT sections:
OVERALL BIAS ASSESSMENT
Rating: Center/Lean Left/Lean Right/Left/Right/Unclear
Confidence: High/Medium/Low

KEY FINDINGS
- (Provide 2-4 items about REPORTING choices, not quoted content)

LOADED LANGUAGE EXAMPLES
- Provide 2-5 items. Each item: "<phrase>" — short reason, neutral alternative.

BALANCED ELEMENTS
- (Provide 1-3 items about genuine journalistic quality/balance)

METHODOLOGY NOTE
- One sentence on how quotes are separated from narrative bias and how evidence thresholds avoid false positives.

Evidence:
CONTEXT: ${contextData}

NARRATIVE LANGUAGE:
${languageResponse}

BIAS INDICATORS:
${hunterResponse}

BALANCED ELEMENTS:
${skepticResponse}

${isDeepMode ? `DEEP ANALYSIS:
Source Diversity: ${sourceDiversityResponse}
Framing: ${framingResponse}
Omissions: ${omissionResponse}

` : ''}SYNTHESIS RULES:
1. Require ≥2 independent narrative indicators OR 1 High-strength indicator before moving from Center
2. Balance mitigates: raise neutrality if balance_score ≥7 with High confidence
3. Default to Center/Unclear when evidence insufficient

CRITICAL: Keep under ${isDeepMode ? '350' : '250'} words. Do NOT mention "agents".`;

      const moderatorResponse = await state.currentSession.prompt(moderatorPrompt);
      console.log("--- MODERATOR ---");
      console.log(moderatorResponse);

      // Parse agent responses to match cloud scan format
      const safeJSON = (s, fallback) => {
        try { return JSON.parse(s); }
        catch { return fallback; }
      };
      
      const languageJSON = safeJSON(languageResponse, { loaded_phrases: [], neutrality_score: 10, confidence: 'High' });
      const hunterJSON = safeJSON(hunterResponse, { bias_indicators: [], overall_bias: 'Unclear', confidence: 'High' });
      const skepticJSON = safeJSON(skepticResponse, { balanced_elements: [], balance_score: 0, confidence: 'High' });
      
      // Structure result to match cloud scan format
      const analysisResult = {
        text: moderatorResponse,
        languageAnalysis: languageJSON.loaded_phrases?.slice?.(0, 8) || [],
        balancedElements: skepticJSON.balanced_elements || [],
        biasIndicators: hunterJSON.bias_indicators || [],
        quotes: []
      };

      // Cleanup
      if (state.currentSession) {
        try { state.currentSession.destroy(); } catch {}
        state.currentSession = null;
      }
      
      stopStatusUpdates();
      setView('default');
      state.isScanning = false;
      elements.scanButton.disabled = false;

      await openResultsPage(analysisResult, 'private', articleContent);
      
    } catch (error) {
      console.error("Scan failed:", error);
      setView('default');
      stopStatusUpdates();
      
      if (state.currentSession) {
        try { state.currentSession.destroy(); } catch {}
        state.currentSession = null;
      }
      
      state.isScanning = false;
      elements.scanButton.disabled = false;
      showNotification("Scan failed. Check console.", 'error');
    }
  }
  function scanWithCloudAI(articleContent) {
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

    

    try {
      chrome.runtime.sendMessage({ type: 'REQUEST_SCAN', articleContent: articleContent }, async (response) => {
        

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
          await openResultsPage(response.results, 'cloud', articleContent);
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
      await scanWithOnDeviceAI(articleContent);
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
