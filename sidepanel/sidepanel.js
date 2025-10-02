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
      
      console.log("--- Starting Quote-Aware Analysis ---");
      state.currentSession = await window.LanguageModel.create();
      const textToSend = (articleContent.fullText || '').slice(0, 8000);
      
      // PHASE 1: Context Agent with Quote Detection
      console.log("Phase 1: Context Agent...");
      const contextPrompt = `You are a content classifier. Analyze the text below.

OUTPUT FORMAT:
TYPE: [News/Opinion/Analysis/Satire/Academic]
SUMMARY: [10 words exactly]
TONE: [Neutral/Emotional/Analytical]
QUOTE_RATIO: [Low/Medium/High - what % is direct quotes vs narrative?]

ARTICLE TEXT:
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

      // PHASE 2: Run 4 Agents
      console.log("Phase 2: Running 4 specialized agents...");

      // Agent 1: Quote Attribution
  const quotePrompt = `Context: ${contextData}

Your ONLY job: Find direct quotes (text inside "quotation marks" or after attribution like "X said").

EXAMPLES OF QUOTES:
- Trump said "this is terrible" ← QUOTE
- "We must act now," she stated ← QUOTE
- Critics argue ← NOT A QUOTE (paraphrasing)

Find 2-3 EXACT quotes:
Format:
- "exact quote": [Who said it - reflects THEIR view, not the article's]

If NO quotes: "No significant quotes found."

TEXT:
${textToSend}`;

      // Agent 2: Language Decoder (NARRATIVE ONLY)
  const languagePrompt = `Context: ${contextData}

Find 2-3 loaded/emotional words in NARRATIVE ONLY (reporter's voice).

IGNORE anything in "quotation marks" - that's someone speaking.

EXAMPLES:
✓ ANALYZE: "The controversial policy sparked outrage" ← reporter's words
✗ SKIP: Trump said "this sparked outrage" ← Trump's words

Format:
- "exact phrase from narrative": explanation
Neutrality: X/10

TEXT:
${textToSend}`;

      // Agent 3: Bias Hunter (NARRATIVE ONLY)
      const hunterPrompt = `Context: ${contextData}

Find 2-3 bias indicators in the NARRATIVE.

CRITICAL: If something is in quotes, that's the SPEAKER's bias, not the article's.
Only flag the REPORTER's choices.

Format:
- Type: "exact phrase" - explanation

TEXT:
${textToSend}`;

      // Agent 4: Bias Skeptic
      const skepticPrompt = `Context: ${contextData}

Find 2-3 neutral/factual elements in the narrative.

Format:
- "exact quote": why balanced

TEXT:
${textToSend}`;

      // Execute all agents
      const quoteResponse = await state.currentSession.prompt(quotePrompt);
      console.log("--- QUOTE AGENT ---");
      console.log(quoteResponse);

      const languageResponse = await state.currentSession.prompt(languagePrompt);
      console.log("--- LANGUAGE AGENT ---");
      console.log(languageResponse);

      const hunterResponse = await state.currentSession.prompt(hunterPrompt);
      console.log("--- HUNTER AGENT ---");
      console.log(hunterResponse);

      const skepticResponse = await state.currentSession.prompt(skepticPrompt);
      console.log("--- SKEPTIC AGENT ---");
      console.log(skepticResponse);

      // PHASE 3: Moderator
      console.log("Phase 3: Moderator synthesis...");
      const moderatorPrompt = `You are the Final Moderator. Synthesize findings.
      
CONTEXT: ${contextData}

QUOTES (reflect SOURCES' bias):
${quoteResponse}

NARRATIVE LANGUAGE:
${languageResponse}

BIAS INDICATORS:
${hunterResponse}

BALANCED ELEMENTS:
${skepticResponse}

ANALYSIS RULES:
1. Count how many loaded phrases came from QUOTES vs NARRATIVE
2. If 70%+ of loaded language is in quotes → lean toward Center rating
3. If 70%+ is in narrative → apply appropriate Left/Right rating

Format:
OVERALL BIAS ASSESSMENT
Rating: [Left-Leaning/Center-Left/Center/Center-Right/Right-Leaning]
Confidence: [High/Medium/Low]
Summary: [2-3 sentences explaining the rating. If bias is mainly in quotes, state: "Most charged language comes from sources quoted, not the reporting itself."]

KEY FINDINGS
- [Finding about the REPORTING]
- [Finding about the REPORTING]

BALANCED ELEMENTS
- [Neutral aspect]

Rules:
- Do NOT mention "agents"
- Keep under 250 words
- Start with "OVERALL BIAS ASSESSMENT"`;

      const moderatorResponse = await state.currentSession.prompt(moderatorPrompt);
      console.log("--- MODERATOR ---");
      console.log(moderatorResponse);

      // Cleanup
      if (state.currentSession) {
        try { state.currentSession.destroy(); } catch {}
        state.currentSession = null;
      }
      
      stopStatusUpdates();
      setView('default');
      state.isScanning = false;
      elements.scanButton.disabled = false;

      await openResultsPage(moderatorResponse, 'private', articleContent);
      
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
