// BiasNeutralizer Settings Page Script

(function() {
  'use strict';

  const state = {
    geminiApiKey: '',
    savedApiKey: '',
    apiConnectionStatus: 'disconnected',
    apiConnectionMessage: 'Not connected',
    biasDetectionLevel: 'medium',
    analysisDepth: 'quick'
  };

  const elements = {};
  let currentTab = 'api';

  const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const hasRuntime = typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function';

  const storage = {
    async get(keys) {
      const keyArray = Array.isArray(keys) ? keys : [keys];

      if (hasChromeStorage) {
        return new Promise((resolve, reject) => {
          chrome.storage.local.get(keyArray, (result) => {
            const error = chrome.runtime && chrome.runtime.lastError;
            if (error) {
              reject(error);
            } else {
              resolve(result || {});
            }
          });
        });
      }

      const result = {};
      keyArray.forEach((key) => {
        const raw = window.localStorage.getItem(key);
        if (raw !== null) {
          try {
            result[key] = JSON.parse(raw);
          } catch (error) {
            result[key] = raw;
          }
        }
      });
      return result;
    },

    async set(items) {
      if (hasChromeStorage) {
        return new Promise((resolve, reject) => {
          chrome.storage.local.set(items, () => {
            const error = chrome.runtime && chrome.runtime.lastError;
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      }

      Object.entries(items).forEach(([key, value]) => {
        if (value === undefined) {
          window.localStorage.removeItem(key);
        } else {
          window.localStorage.setItem(key, JSON.stringify(value));
        }
      });
      return Promise.resolve();
    }
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheElements();
    bindEvents();
    activateTab(currentTab);
    loadSettings();
  }

  function cacheElements() {
    elements.tabButtons = Array.from(document.querySelectorAll('.tab-button'));
    elements.tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
    elements.apiKeyInput = document.getElementById('gemini-api-key');
    elements.statusIndicator = document.getElementById('connection-status-indicator');
    elements.statusText = document.getElementById('connection-status-text');
    elements.testButton = document.getElementById('test-connection');
    elements.saveButton = document.getElementById('save-api-key');
    elements.apiFeedback = document.getElementById('api-feedback');
    elements.biasRadios = document.querySelectorAll('input[name="bias-detection"]');
    elements.analysisRadios = document.querySelectorAll('input[name="analysis-depth"]');
    elements.applyButton = document.getElementById('apply-changes');
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

    if (elements.testButton) {
      elements.testButton.addEventListener('click', handleTestConnection);
    }

    if (elements.saveButton) {
      elements.saveButton.addEventListener('click', handleSaveApiKey);
    }

    elements.biasRadios.forEach((radio) => {
      radio.addEventListener('change', handleBiasSelection);
    });

    elements.analysisRadios.forEach((radio) => {
      radio.addEventListener('change', handleAnalysisSelection);
    });

    if (elements.applyButton) {
      elements.applyButton.addEventListener('click', handleApplyChanges);
    }

    if (elements.backButton) {
      elements.backButton.addEventListener('click', navigateBack);
    }
  }

  async function loadSettings() {
    try {
      const stored = await storage.get([
        'geminiApiKey',
        'apiConnectionStatus',
        'apiConnectionMessage',
        'biasDetectionLevel',
        'analysisDepth'
      ]);

      const storedApiKey = typeof stored.geminiApiKey === 'string' ? stored.geminiApiKey : '';
      state.geminiApiKey = storedApiKey;
      state.savedApiKey = storedApiKey;

      if (elements.apiKeyInput) {
        elements.apiKeyInput.value = storedApiKey;
      }

      state.biasDetectionLevel = stored.biasDetectionLevel || state.biasDetectionLevel;
      state.analysisDepth = stored.analysisDepth || state.analysisDepth;

      syncRadioGroup(elements.biasRadios, state.biasDetectionLevel);
      syncRadioGroup(elements.analysisRadios, state.analysisDepth);

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
  }

  async function testGeminiApiKey(apiKey) {
    try {
      // Make a simple test request to validate the API key
      const testPayload = {
        contents: [{
          parts: [{
            text: "Hello, this is a test message."
          }]
        }]
      };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
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

    const apiKey = (state.geminiApiKey || '').trim();
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

        try {
          await storage.set({
            apiConnectionStatus: state.apiConnectionStatus,
            apiConnectionMessage: state.apiConnectionMessage
          });
        } catch (error) {
          console.error('Failed to persist connection status:', error);
        }

        finish('Connected', 1400);
      } else {
        updateConnectionStatus('error', 'Invalid API key');
        showFeedback(elements.apiFeedback, testResult.error || 'API key is invalid or expired.', 'error');

        try {
          await storage.set({
            apiConnectionStatus: state.apiConnectionStatus,
            apiConnectionMessage: state.apiConnectionMessage
          });
        } catch (error) {
          console.error('Failed to persist connection status:', error);
        }

        finish('Try Again', 1400);
      }
    } catch (error) {
      console.error('API test error:', error);
      updateConnectionStatus('error', 'Connection failed');
      showFeedback(elements.apiFeedback, 'Unable to connect to Gemini API. Check your internet connection.', 'error');

      try {
        await storage.set({
          apiConnectionStatus: state.apiConnectionStatus,
          apiConnectionMessage: state.apiConnectionMessage
        });
      } catch (storageError) {
        console.error('Failed to persist connection status:', storageError);
      }

      finish('Try Again', 1400);
    }
  }

  async function handleSaveApiKey(event) {
    const button = event.currentTarget;
    flashButton(button);
    const finish = setButtonWorking(button, 'Saving...');

    const apiKey = (elements.apiKeyInput ? elements.apiKeyInput.value : '').trim();
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

    try {
      await storage.set({
        geminiApiKey: apiKey,
        apiConnectionStatus: state.apiConnectionStatus,
        apiConnectionMessage: state.apiConnectionMessage
      });
      finish(apiKey ? 'Saved!' : 'Cleared', 1400);
    } catch (error) {
      console.error('Failed to save API key:', error);
      showFeedback(elements.apiFeedback, 'Unable to save API key. Try again.', 'error');
      finish('Retry', 1400);
    }
  }

  // Thinking toggle removed

  function handleBiasSelection(event) {
    state.biasDetectionLevel = event.target.value;
    showFeedback(elements.advancedFeedback, '');
  }

  function handleAnalysisSelection(event) {
    state.analysisDepth = event.target.value;
    showFeedback(elements.advancedFeedback, '');
  }

  async function handleApplyChanges(event) {
    const button = event.currentTarget;
    flashButton(button);
    const finish = setButtonWorking(button, 'Applying...');

    try {
      await storage.set({
        biasDetectionLevel: state.biasDetectionLevel,
        analysisDepth: state.analysisDepth
      });
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
