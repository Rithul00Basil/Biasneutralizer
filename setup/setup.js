/**
 * BiasNeutralizer First-Time Setup Controller
 * Handles on-device AI model download and cloud setup
 */

console.log('[BiasNeutralizer Setup] Initializing setup page...');

document.addEventListener('DOMContentLoaded', async () => {
  // ========================================
  // DOM ELEMENTS
  // ========================================
  const elements = {
    onDeviceCard: document.getElementById('on-device-card'),
    downloadButton: document.getElementById('download-model-button'),
    downloadButtonText: document.getElementById('download-button-text'),
    cancelDownloadButton: document.getElementById('cancel-download-button'),
    skipCloudButton: document.getElementById('skip-cloud-button'),
    setupStatus: document.getElementById('setup-status'),
    statusMessage: document.getElementById('status-message'),
    progressContainer: document.getElementById('progress-container'),
    progressFill: document.getElementById('progress-fill'),
    progressText: document.getElementById('progress-text'),
    deviceRequirements: document.getElementById('device-requirements'),
    notificationToast: document.getElementById('notification-toast'),
  };

  // Validate all required elements exist
  for (const [key, element] of Object.entries(elements)) {
    if (!element) {
      console.error(`[BiasNeutralizer Setup] Critical UI element missing: "${key}"`);
      return;
    }
  }

  // ========================================
  // STATE MANAGEMENT
  // ========================================
  let state = {
    isDownloading: false,
    currentSession: null,
    modelAvailability: null,
    downloadCancelled: false,
  };

  // ========================================
  // UTILITY FUNCTIONS
  // ========================================

  /**
   * Shows a notification toast message
   */
  function showNotification(message, type = 'error') {
    const toast = elements.notificationToast;
    const messageSpan = toast.querySelector('span');
    
    if (!messageSpan) return;

    messageSpan.textContent = message;
    toast.className = ''; 
    toast.classList.add('visible', type);

    setTimeout(() => {
      toast.classList.remove('visible');
    }, 4000);
  }

  /**
   * Updates the status message and styling
   */
  function updateStatus(message, type = 'info') {
    elements.setupStatus.style.display = 'block';
    elements.statusMessage.textContent = message;
    elements.statusMessage.className = 'status-message';
    
    if (type === 'success') {
      elements.statusMessage.classList.add('success');
    } else if (type === 'error') {
      elements.statusMessage.classList.add('error');
    } else if (type === 'warning') {
      elements.statusMessage.classList.add('warning');
    }
  }

  /**
   * Updates download progress bar
   */
  function updateProgress(percent) {
    elements.progressContainer.style.display = 'flex';
    elements.progressFill.style.width = `${percent}%`;
    elements.progressText.textContent = `${percent}%`;
  }

  /**
   * Hides the progress bar
   */
  function hideProgress() {
    elements.progressContainer.style.display = 'none';
  }

  /**
   * Safely saves to Chrome storage
   */
  async function safeStorageSet(data) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(data, () => {
          if (chrome.runtime.lastError) {
            console.error('[BiasNeutralizer Setup] Storage error:', chrome.runtime.lastError);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      } catch (error) {
        console.error('[BiasNeutralizer Setup] Storage exception:', error);
        resolve(false);
      }
    });
  }

  /**
   * Safely retrieves from Chrome storage
   */
  async function safeStorageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          if (chrome.runtime.lastError) {
            console.error('[BiasNeutralizer Setup] Storage error:', chrome.runtime.lastError);
            resolve(null);
          } else {
            resolve(result);
          }
        });
      } catch (error) {
        console.error('[BiasNeutralizer Setup] Storage exception:', error);
        resolve(null);
      }
    });
  }

  /**
   * Navigates to sidepanel after successful setup
   */
  function navigateToSidePanel() {
    console.log('[BiasNeutralizer Setup] Navigating to sidepanel...');
    setTimeout(() => {
      window.location.href = chrome.runtime.getURL('sidepanel/sidepanel.html');
    }, 1500);
  }

  /**
   * Completes setup with the selected preference
   */
  async function completeSetup(preference) {
    console.log(`[BiasNeutralizer Setup] Completing setup with preference: ${preference}`);
    
    const success = await safeStorageSet({
      hasCompletedSetup: true,
      aiPreference: preference,
      privateMode: preference === 'on-device', // Set privateMode based on preference
    });

    if (!success) {
      showNotification('Failed to save setup preferences. Please try again.', 'error');
      return false;
    }

    console.log('[BiasNeutralizer Setup] Setup completed successfully');
    return true;
  }

  // ========================================
  // FEATURE DETECTION & MODEL AVAILABILITY
  // ========================================

  /**
   * Step 3A: Feature Detection - Check if LanguageModel API is available
   */
  async function checkFeatureAvailability() {
    console.log('[BiasNeutralizer Setup] Checking feature availability...');
    
    updateStatus('Checking device compatibility...', 'info');

    // Check if LanguageModel API exists
    if (!('LanguageModel' in window)) {
      console.warn('[BiasNeutralizer Setup] LanguageModel API not available');
      return {
        available: false,
        reason: 'not-supported',
        message: 'On-device AI is not supported in your browser. You\'ll need to use cloud models.',
      };
    }

    try {
      // Step 3B: Check Model Availability
      console.log('[BiasNeutralizer Setup] Checking model availability...');
      
      const availability = await window.LanguageModel.availability();
      console.log('[BiasNeutralizer Setup] Model availability status:', availability);

      if (availability === 'available') {
        return {
          available: true,
          status: 'ready',
          message: 'On-device model already available!',
        };
      } else if (availability === 'unavailable') {
        return {
          available: false,
          reason: 'requirements-not-met',
          message: 'Your device doesn\'t meet the requirements for on-device AI (need 22GB free space, 4GB+ GPU or 16GB+ RAM)',
        };
      } else if (availability === 'after-download') {
        return {
          available: true,
          status: 'needs-download',
          message: 'Ready to download on-device model',
        };
      } else {
        return {
          available: false,
          reason: 'unknown',
          message: `Model status: ${availability}`,
        };
      }
    } catch (error) {
      console.error('[BiasNeutralizer Setup] Feature detection error:', error);
      return {
        available: false,
        reason: 'error',
        message: `Error checking compatibility: ${error.message}`,
      };
    }
  }

  /**
   * Updates UI based on feature availability
   */
  function updateUIForAvailability(availabilityInfo) {
    if (!availabilityInfo.available) {
      // Hide on-device option or show as unavailable
      updateStatus(availabilityInfo.message, 'warning');
      elements.downloadButton.disabled = true;
      elements.downloadButtonText.textContent = 'Not Available';
      elements.deviceRequirements.style.display = 'none';
      
      // Show explanation
      showNotification(
        'On-device AI is not available on this device. Please use cloud models.',
        'warning'
      );
    } else if (availabilityInfo.status === 'ready') {
      // Model already exists - complete setup immediately
      updateStatus(availabilityInfo.message, 'success');
      elements.downloadButton.disabled = true;
      elements.downloadButtonText.textContent = 'Already Downloaded';
      
      console.log('[BiasNeutralizer Setup] Model already available, completing setup...');
      completeSetup('on-device').then((success) => {
        if (success) {
          showNotification('Setup complete! Redirecting...', 'success');
          navigateToSidePanel();
        }
      });
    } else if (availabilityInfo.status === 'needs-download') {
      // Ready to download
      updateStatus(availabilityInfo.message, 'success');
      elements.downloadButton.disabled = false;
      hideProgress();
    }
  }

  // ========================================
  // DOWNLOAD HANDLER
  // ========================================

  /**
   * Step 3C: Download Button Handler
   */
  async function handleDownloadModel() {
    if (state.isDownloading) {
      console.warn('[BiasNeutralizer Setup] Download already in progress');
      return;
    }

    console.log('[BiasNeutralizer Setup] Starting model download...');
    state.isDownloading = true;
    state.downloadCancelled = false;

    // Update UI
    elements.downloadButton.disabled = true;
    elements.downloadButton.classList.add('loading');
    elements.downloadButtonText.textContent = 'Downloading...';
    elements.cancelDownloadButton.style.display = 'block'; // Show cancel button
    updateStatus('Downloading model... This may take a few minutes.', 'info');
    updateProgress(0);

    try {
      // Create session with progress monitoring
      console.log('[BiasNeutralizer Setup] Creating LanguageModel session...');
      
      const session = await window.LanguageModel.create({
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            const percent = Math.round(e.loaded * 100);
            console.log(`[BiasNeutralizer Setup] Download progress: ${percent}%`);
            updateProgress(percent);
            updateStatus(`Downloading model... ${percent}% complete`, 'info');
          });
        },
      });

      state.currentSession = session;
      console.log('[BiasNeutralizer Setup] Model download complete!');

      // Check if download was cancelled
      if (state.downloadCancelled) {
        console.log('[BiasNeutralizer Setup] Download cancelled by user');
        try {
          await session.destroy();
        } catch (error) {
          console.warn('[BiasNeutralizer Setup] Failed to destroy session:', error);
        }
        return; // Exit early, don't complete setup
      }

      // Destroy the session since we only needed it for download
      try {
        await session.destroy();
        console.log('[BiasNeutralizer Setup] Session destroyed');
      } catch (error) {
        console.warn('[BiasNeutralizer Setup] Failed to destroy session:', error);
      }

      // Update UI
      updateStatus('Model downloaded successfully!', 'success');
      updateProgress(100);
      elements.cancelDownloadButton.style.display = 'none'; // Hide cancel button
      showNotification('On-device model ready!', 'success');

      // Complete setup
      const success = await completeSetup('on-device');
      if (success) {
        navigateToSidePanel();
      }
    } catch (error) {
      console.error('[BiasNeutralizer Setup] Download failed:', error);
      
      // Reset state
      state.isDownloading = false;
      state.currentSession = null;
      
      // Update UI
      elements.downloadButton.disabled = false;
      elements.downloadButton.classList.remove('loading');
      elements.downloadButtonText.textContent = 'Retry Download';
      elements.cancelDownloadButton.style.display = 'none'; // Hide cancel button
      hideProgress();
      
      // Show error
      let errorMessage = 'Download failed. Please try again.';
      if (error.message) {
        errorMessage = `Download failed: ${error.message}`;
      }
      
      updateStatus(errorMessage, 'error');
      showNotification(errorMessage, 'error');
    }
  }

  // ========================================
  // SKIP HANDLER
  // ========================================

  /**
   * Step 3D: Skip Button Handler - Use cloud models
   */
  async function handleSkipToCloud() {
    console.log('[BiasNeutralizer Setup] User chose to skip on-device setup');
    
    elements.skipCloudButton.disabled = true;
    elements.skipCloudButton.textContent = 'Setting up...';

    const success = await completeSetup('cloud');
    
    if (success) {
      showNotification('Setup complete! You can configure your API key in Settings.', 'success');
      navigateToSidePanel();
    } else {
      elements.skipCloudButton.disabled = false;
      elements.skipCloudButton.textContent = 'Skip & Use Cloud';
    }
  }

  // ========================================
  // CANCEL DOWNLOAD HANDLER (Edge Case B)
  // ========================================

  /**
   * Handles cancellation of download in progress
   */
  async function handleCancelDownload() {
    console.log('[BiasNeutralizer Setup] User cancelled download');
    
    state.downloadCancelled = true;
    state.isDownloading = false;
    
    // Destroy session if exists
    if (state.currentSession) {
      try {
        await state.currentSession.destroy();
        console.log('[BiasNeutralizer Setup] Session destroyed after cancellation');
      } catch (error) {
        console.warn('[BiasNeutralizer Setup] Failed to destroy session:', error);
      }
      state.currentSession = null;
    }
    
    // Reset UI
    elements.downloadButton.disabled = false;
    elements.downloadButton.classList.remove('loading');
    elements.downloadButtonText.textContent = 'Download Model';
    elements.cancelDownloadButton.style.display = 'none';
    hideProgress();
    updateStatus('Download cancelled. You can try again or use cloud models.', 'warning');
    
    showNotification('Download cancelled', 'warning');
  }

  // ========================================
  // EVENT LISTENERS
  // ========================================

  elements.downloadButton.addEventListener('click', handleDownloadModel);
  elements.cancelDownloadButton.addEventListener('click', handleCancelDownload);
  elements.skipCloudButton.addEventListener('click', handleSkipToCloud);

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    console.log('[BiasNeutralizer Setup] Page unloading, cleaning up...');
    
    // If download is in progress, mark it for recovery
    if (state && state.isDownloading) {
      chrome.storage.local.set({ downloadInProgress: true }, () => {
        console.log('[BiasNeutralizer Setup] Download state saved for recovery');
      });
    }
    
    // Destroy session if exists
    if (state && state.currentSession) {
      try {
        state.currentSession.destroy();
      } catch (error) {
        console.error('[BiasNeutralizer Setup] Cleanup error:', error);
      }
    }
  });

  // ========================================
  // INITIALIZATION
  // ========================================

  console.log('[BiasNeutralizer Setup] Running initial feature detection...');
  
  // Check if setup was already completed (in case user navigated back)
  const storage = await safeStorageGet(['hasCompletedSetup', 'aiPreference']);
  if (storage && storage.hasCompletedSetup) {
    console.log('[BiasNeutralizer Setup] Setup already completed, redirecting...');
    showNotification('Setup already completed!', 'success');
    navigateToSidePanel();
    return;
  }

  // Check for incomplete download (Edge Case A: User closed tab during download)
  const downloadState = await safeStorageGet(['downloadInProgress']);
  if (downloadState && downloadState.downloadInProgress) {
    console.log('[BiasNeutralizer Setup] Found incomplete download, clearing state...');
    await safeStorageSet({ downloadInProgress: false });
    updateStatus('Previous download was interrupted. Please try again.', 'warning');
  }

  // Perform feature detection
  const availabilityInfo = await checkFeatureAvailability();
  state.modelAvailability = availabilityInfo;
  updateUIForAvailability(availabilityInfo);

  console.log('[BiasNeutralizer Setup] Setup page ready');
});
