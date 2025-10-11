// BiasNeutralizer Settings Page Script

(function() {
  'use strict';

  // ---- settings.js storage helpers (robust) ----
  async function storageGet(keys) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        try {
          chrome.storage.local.get(keys, (res) => {
            if (chrome.runtime?.lastError) {
              console.error('[Settings] storage.get error', chrome.runtime.lastError);
              resolve({});
            } else {
              resolve(res || {});
            }
          });
        } catch (e) { console.error('[Settings] storage.get exception', e); resolve({}); }
      } else {
        try {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach(k => { out[k] = JSON.parse(localStorage.getItem(k)); });
          resolve(out);
        } catch { resolve({}); }
      }
    });
  }

  async function storageSet(obj) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        try {
          chrome.storage.local.set(obj, () => {
            if (chrome.runtime?.lastError) {
              console.error('[Settings] storage.set error', chrome.runtime.lastError);
              resolve(false);
            } else resolve(true);
          });
        } catch (e) { console.error('[Settings] storage.set exception', e); resolve(false); }
      } else {
        try {
          Object.entries(obj).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
          resolve(true);
        } catch { resolve(false); }
      }
    });
  }

  // ---- debounce helper ----
  function debounce(fn, ms = 400) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  const state = {
    geminiApiKey: '',
    savedApiKey: '',
    apiConnectionStatus: 'disconnected',
    apiConnectionMessage: 'Not connected',
    analysisDepth: 'quick',
    assistantModel: 'on-device'
  };

  const elements = {};
  let currentTab = 'api';

  const hasRuntime = typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function';

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheElements();
    // Ensure the visibility icon reflects current input type on load
    syncVisibilityToggleIcon();
    bindEvents();
    activateTab(currentTab);
    loadSettings();
  }

  function cacheElements() {
    elements.tabButtons = Array.from(document.querySelectorAll('.tab-button'));
    elements.tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
    elements.apiKeyInput = document.getElementById('gemini-api-key');
    elements.toggleKeyVisibility = document.getElementById('toggle-key-visibility');
    // Eye icons within the toggle button
    elements.eyeIcon = document.querySelector('.eye-icon');
    elements.eyeOffIcon = document.querySelector('.eye-off-icon');
    elements.statusIndicator = document.getElementById('connection-status-indicator');
    elements.statusText = document.getElementById('connection-status-text');
    elements.testButton = document.getElementById('test-connection');
    elements.saveButton = document.getElementById('save-api-key');
    elements.apiFeedback = document.getElementById('api-feedback');
    elements.analysisRadios = document.querySelectorAll('input[name="analysis-depth"]');
    elements.applyButton = document.getElementById('apply-changes');
    elements.assistantModelRadios = document.querySelectorAll('input[name="assistant-model"]');
    elements.advancedFeedback = document.getElementById('advanced-feedback');
    elements.backButton = document.getElementById('back-button');
  }

  function bindEvents() {
    elements.tabButtons.forEach((button) => {
      button.addEventListener('click', () => activateTab(button.dataset.tab));
      button.addEventListener('keydown', handleTabKeydown);
    });

    if (elements.apiKeyInput) {
      elements.apiKeyInput.addEventListener('input', handleApiKeyInput);
    }

    if (elements.toggleKeyVisibility && elements.apiKeyInput) {
      elements.toggleKeyVisibility.addEventListener('click', (e) => {
        e.preventDefault();
        const isPassword = elements.apiKeyInput.getAttribute('type') === 'password';
        if (isPassword) {
          // Switching to text: show the real key from state
          elements.apiKeyInput.setAttribute('type', 'text');
          elements.apiKeyInput.value = state.savedApiKey || state.geminiApiKey;
        } else {
          // Switching to password: hide the key
          elements.apiKeyInput.setAttribute('type', 'password');
        }
        syncVisibilityToggleIcon();
      });
    }

    if (elements.testButton) {
      elements.testButton.addEventListener('click', handleTestConnection);
    }

    if (elements.saveButton) {
      elements.saveButton.addEventListener('click', handleSaveApiKey);
    }

    elements.analysisRadios.forEach((radio) => {
      radio.addEventListener('change', handleAnalysisSelection);
    });

    elements.assistantModelRadios.forEach((radio) => {
      radio.addEventListener('change', handleAssistantModelSelection);
    });

    if (elements.applyButton) {
      elements.applyButton.addEventListener('click', handleApplyChanges);
    }

    if (elements.backButton) {
      elements.backButton.addEventListener('click', navigateBack);
    }
  }

  // Sync the eye icons state based on the input's current type
  function syncVisibilityToggleIcon() {
    if (!elements || !elements.toggleKeyVisibility || !elements.apiKeyInput) return;
    const isPasswordNow = elements.apiKeyInput.getAttribute('type') === 'password';
    const eye = elements.eyeIcon || elements.toggleKeyVisibility.querySelector('.eye-icon');
    const eyeOff = elements.eyeOffIcon || elements.toggleKeyVisibility.querySelector('.eye-off-icon');

    if (eye && eyeOff) {
      // Toggle visible class
      eye.classList.toggle('is-visible', isPasswordNow);
      eyeOff.classList.toggle('is-visible', !isPasswordNow);

      // Trigger a subtle pop animation on the icon becoming visible
      const nowVisible = isPasswordNow ? eye : eyeOff;
      if (nowVisible) {
        nowVisible.classList.remove('popping');
        // Force reflow to restart animation
        void nowVisible.offsetWidth;
        nowVisible.classList.add('popping');
        setTimeout(() => nowVisible.classList.remove('popping'), 280);
      }
    }

    // Update accessible label and title
    const label = isPasswordNow ? 'Show API key' : 'Hide API key';
    elements.toggleKeyVisibility.setAttribute('aria-label', label);
    elements.toggleKeyVisibility.setAttribute('title', label);
  }

  async function loadSettings() {
    try {
      const stored = await storageGet([
        'geminiApiKey',
        'apiConnectionStatus',
        'apiConnectionMessage',
        'analysisDepth',
        'assistantModel'
      ]);

      const storedApiKey = typeof stored.geminiApiKey === 'string' ? stored.geminiApiKey : '';
      state.geminiApiKey = storedApiKey;
      state.savedApiKey = storedApiKey;

      if (elements.apiKeyInput) {
        elements.apiKeyInput.value = '';
        elements.apiKeyInput.placeholder = storedApiKey ? '•••••••••••••••••••• (saved)' : 'Paste your Gemini API key';
      }
      
      state.analysisDepth = stored.analysisDepth || state.analysisDepth;
      syncRadioGroup(elements.analysisRadios, state.analysisDepth);

      state.assistantModel = stored.assistantModel || state.assistantModel;
      syncRadioGroup(elements.assistantModelRadios, state.assistantModel);

      const hasStoredStatus = storedApiKey && stored.apiConnectionStatus;
      if (hasStoredStatus) {
        updateConnectionStatus(stored.apiConnectionStatus, stored.apiConnectionMessage);
      } else {
        updateConnectionStatus('disconnected', 'Not connected');
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      updateConnectionStatus('disconnected', 'Not connected');
    }
  }

  function activateTab(targetTab) {
    if (!targetTab || targetTab === currentTab) {
      targetTab = targetTab || currentTab;
    }

    currentTab = targetTab;

    elements.tabButtons.forEach((button) => {
      const isActive = button.dataset.tab === targetTab;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    elements.tabPanels.forEach((panel) => {
      const isActive = panel.dataset.tab === targetTab;
      panel.classList.toggle('active', isActive);
      if (isActive) {
        panel.removeAttribute('hidden');
      } else {
        panel.setAttribute('hidden', 'true');
      }
    });
  }

  function handleTabKeydown(event) {
    const key = event.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const currentIndex = elements.tabButtons.indexOf(event.currentTarget);
    if (currentIndex === -1) {
      return;
    }

    const direction = key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (currentIndex + direction + elements.tabButtons.length) % elements.tabButtons.length;
    const nextButton = elements.tabButtons[nextIndex];
    if (nextButton) {
      nextButton.focus();
      activateTab(nextButton.dataset.tab);
    }
  }

  function handleApiKeyInput(event) {
    const value = event.target.value || '';
    state.geminiApiKey = value;
    showFeedback(elements.apiFeedback, '');

    if (state.apiConnectionStatus === 'connected' && value !== state.savedApiKey) {
      updateConnectionStatus('disconnected', 'Not connected');
    }
    if (value && value !== '••••••••••') {
      saveApiKeyDebounced();
    }
  }

  const saveApiKeyDebounced = debounce(async () => {
    if (!elements.apiKeyInput) return;
    const newKey = (elements.apiKeyInput.value.trim() && elements.apiKeyInput.value.indexOf('•') === -1) ? elements.apiKeyInput.value.trim() : state.savedApiKey;
    const payload = { settings: { geminiApiKey: newKey, analysisDepth: state.analysisDepth || 'quick', assistantModel: state.assistantModel || 'on-device' } };
    payload.geminiApiKey = newKey;
    state.savedApiKey = newKey;
    payload.analysisDepth = state.analysisDepth || 'quick';
    payload.assistantModel = state.assistantModel || 'on-device';
    await storageSet(payload);
  }, 400);

  async function testGeminiApiKey(apiKey) {
    try {
      // Make a simple test request to validate the API key
      const testPayload = {
        contents: [{
          parts: [{
            text: "just testing if api works!"
          }]
        }]
      };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(testPayload)
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.candidates && data.candidates[0]) {
          return { success: true };
        } else {
          return {
            success: false,
            error: 'Unexpected API response format'
          };
        }
      } else if (response.status === 400) {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData.error?.message || 'Invalid API key format'
        };
      } else if (response.status === 403) {
        return {
          success: false,
          error: 'API key access denied. Check your key permissions.'
        };
      } else {
        return {
          success: false,
          error: `API returned status ${response.status}`
        };
      }
    } catch (error) {
      console.error('API test request failed:', error);
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        return {
          success: false,
          error: 'Network error. Check your internet connection.'
        };
      }
      return {
        success: false,
        error: 'Failed to connect to Gemini API'
      };
    }
  }

  async function handleTestConnection(event) {
    const button = event.currentTarget;
    flashButton(button);

    // Always use the most up-to-date key from state or input
    const apiKey = (elements.apiKeyInput.value.trim() && elements.apiKeyInput.value !== '••••••••••')
      ? elements.apiKeyInput.value.trim()
      : (state.savedApiKey || '');

    if (!apiKey) {
      updateConnectionStatus('error', 'API key required');
      showFeedback(elements.apiFeedback, 'Enter your Gemini API key before testing.', 'error');
      return;
    }

    const finish = setButtonWorking(button, 'Testing...');
    updateConnectionStatus('testing', 'Testing connection...');
    showFeedback(elements.apiFeedback, 'Attempting to reach Gemini API…');

    // Test the API key with a real API call
    try {
      const testResult = await testGeminiApiKey(apiKey);

      if (testResult.success) {
        updateConnectionStatus('connected', 'Connected');
        showFeedback(elements.apiFeedback, 'Connection successful. API key is valid.', 'success');

        await storageSet({ apiConnectionStatus: state.apiConnectionStatus, apiConnectionMessage: state.apiConnectionMessage });

        finish('Connected', 1400);
      } else {
        updateConnectionStatus('error', 'Invalid API key');
        showFeedback(elements.apiFeedback, testResult.error || 'API key is invalid or expired.', 'error');

        await storageSet({ apiConnectionStatus: state.apiConnectionStatus, apiConnectionMessage: state.apiConnectionMessage });

        finish('Try Again', 1400);
      }
    } catch (error) {
      console.error('API test error:', error);
      updateConnectionStatus('error', 'Connection failed');
      showFeedback(elements.apiFeedback, 'Unable to connect to Gemini API. Check your internet connection.', 'error');

      await storageSet({ apiConnectionStatus: state.apiConnectionStatus, apiConnectionMessage: state.apiConnectionMessage });

      finish('Try Again', 1400);
    }
  }

  async function handleSaveApiKey(event) {
    const button = event.currentTarget;
    flashButton(button);
    const finish = setButtonWorking(button, 'Saving...');

    const apiKey = (elements.apiKeyInput.value || '').trim();
    state.geminiApiKey = apiKey;
    state.savedApiKey = apiKey;

    if (!apiKey) {
      updateConnectionStatus('disconnected', 'Not connected');
      showFeedback(elements.apiFeedback, 'API key cleared.', 'error');
    } else if (state.apiConnectionStatus === 'error' || state.apiConnectionStatus === 'disconnected') {
      // Keep status but inform the user to test if not already connected
      showFeedback(elements.apiFeedback, 'API key saved. Test the connection when ready.', 'success');
    } else {
      showFeedback(elements.apiFeedback, 'API key saved.', 'success');
    }

    const settingsPayload = { geminiApiKey: apiKey, analysisDepth: state.analysisDepth || 'quick', assistantModel: state.assistantModel || 'on-device' };
    const ok = await storageSet({
      settings: settingsPayload,
      geminiApiKey: apiKey,
      ...settingsPayload,
      apiConnectionStatus: state.apiConnectionStatus,
      apiConnectionMessage: state.apiConnectionMessage
    });
    if (!ok) {
      console.error('Failed to save API key');
      showFeedback(elements.apiFeedback, 'Unable to save API key. Try again.', 'error');
      finish('Retry', 1400);
    } else {
      finish(apiKey ? 'Saved!' : 'Cleared', 1400);
    }
  }

  // Thinking toggle removed

  function handleAnalysisSelection(event) {
    state.analysisDepth = event.target.value;
  }

  function handleAssistantModelSelection(event) {
    state.assistantModel = event.target.value;
    showFeedback(elements.advancedFeedback, '');
  }

  async function handleApplyChanges(event) {
    const button = event.currentTarget;
    flashButton(button);
    const finish = setButtonWorking(button, 'Applying...');

    try {
      const settingsPayload = { analysisDepth: state.analysisDepth, assistantModel: state.assistantModel, geminiApiKey: state.savedApiKey || '' };
      const ok = await storageSet({ settings: settingsPayload, ...settingsPayload });
      if (!ok) throw new Error('storageSet failed');
      showFeedback(elements.advancedFeedback, 'Preferences applied.', 'success');
      finish('Applied!', 1400);
    } catch (error) {
      console.error('Failed to apply settings:', error);
      showFeedback(elements.advancedFeedback, 'Could not save preferences. Try again.', 'error');
      finish('Retry', 1400);
    }
  }

  function navigateBack() {
    const target = hasRuntime ? chrome.runtime.getURL('sidepanel/sidepanel.html') : '../sidepanel/sidepanel.html';
    window.location.assign(target);
  }

  function syncRadioGroup(nodeList, value) {
    if (!nodeList) {
      return;
    }

    nodeList.forEach((node) => {
      node.checked = node.value === value;
    });
  }

  function updateConnectionStatus(status, message) {
    const allowedStatuses = ['connected', 'testing', 'error', 'disconnected'];
    const normalizedStatus = allowedStatuses.includes(status) ? status : 'disconnected';
    const fallbackMessages = {
      connected: 'Connected',
      testing: 'Testing connection...',
      error: 'Unable to connect',
      disconnected: 'Not connected'
    };

    const text = message || fallbackMessages[normalizedStatus];
    state.apiConnectionStatus = normalizedStatus;
    state.apiConnectionMessage = text;

    if (elements.statusText) {
      elements.statusText.textContent = text;
    }

    if (elements.statusIndicator) {
      const indicator = elements.statusIndicator;
      indicator.classList.remove(
        'status-indicator--connected',
        'status-indicator--testing',
        'status-indicator--error',
        'status-indicator--disconnected'
      );
      indicator.classList.add(`status-indicator--${normalizedStatus}`);
    }
  }

  function showFeedback(element, message, type) {
    if (!element) {
      return;
    }

    element.textContent = message || '';
    element.classList.remove('success', 'error');

    if (type === 'success') {
      element.classList.add('success');
    } else if (type === 'error') {
      element.classList.add('error');
    }
  }

  function flashButton(button) {
    if (!button) {
      return;
    }

    button.classList.add('is-pressed');
    setTimeout(() => {
      button.classList.remove('is-pressed');
    }, 180);
  }

  function setButtonWorking(button, workingText) {
    if (!button) {
      return () => {};
    }

    const originalText = button.dataset.originalText || button.textContent.trim();
    button.dataset.originalText = originalText;
    button.disabled = true;

    if (workingText) {
      button.textContent = workingText;
    }

    return function finish(resultText, revertDelay) {
      const delayMs = typeof revertDelay === 'number' ? revertDelay : 1000;
      if (resultText) {
        button.textContent = resultText;
      }

      setTimeout(() => {
        button.disabled = false;
        button.textContent = button.dataset.originalText || originalText;
      }, delayMs);
    };
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
