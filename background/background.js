/**

 * BiasNeutralizer Background Service Worker

 * Manages cloud-based AI analysis with multi-agent system

 */

import { AgentPrompts } from '../shared/prompts.js';
import { AgentPrompts as QuickPrompts } from '../shared/prompt-quick-cloud.js';

const BG_LOG_PREFIX = '[Background]';
const bgLog = (...args) => console.log(BG_LOG_PREFIX, ...args);
const bgWarn = (...args) => console.warn(BG_LOG_PREFIX, ...args);
const bgError = (...args) => console.error(BG_LOG_PREFIX, ...args);

// === FIX #1: Configure sidepanel at startup ===

(async () => {

  try {

    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

    bgLog('Side panel behavior configured at startup');

  } catch (error) {

    bgError('Failed to set panel behavior at startup:', error);

  }

})();

let activeScanControllers = new Map(); // tabId -> AbortController

class RetriableError extends Error {}

// Enhanced normalize with genre safeguard

function normalizeForRenderer(text, contextJSON = null) {

  let out = String(text || '').replace(/\r\n?/g, '\n');

  // Map bracket labels to canonical form the renderer expects

  out = out

    .replace(/\[RATING\]\s*:/gi, 'Rating:')

    .replace(/\[CONFIDENCE\]\s*:/gi, 'Confidence:');

  // Ensure the top section exists

  if (!/^\s*##\s*Overall Bias Assessment/im.test(out)) {

    out = '## Overall Bias Assessment\n' + out;

  }

  // Enforce allowed ratings + default if missing

  const allowedRatings = ['Center','Lean Left','Lean Right','Strong Left','Strong Right','Unclear'];

  const ratingRegex = /(Rating:\s*)([^\n]+)/i;

  if (ratingRegex.test(out)) {

    out = out.replace(ratingRegex, (m, p1, p2) => {

      let r = String(p2 || '').trim();

      const map = { 'Unknown':'Unclear', 'Left':'Lean Left', 'Right':'Lean Right', 'Centre':'Center' };

      r = map[r] || r;

      if (!allowedRatings.includes(r)) r = 'Unclear';

      return p1 + r;

    });

  } else {

    out += '\nRating: Unclear';

  }

  // Enforce Confidence (High/Medium/Low) + default if missing

  const confRegex = /(Confidence:\s*)([^\n]+)/i;

  if (confRegex.test(out)) {

    out = out.replace(confRegex, (m, p1, p2) => {

      let c = String(p2 || '').trim();

      if (!['High','Medium','Low'].includes(c)) c = 'Medium';

      return p1 + c;

    });

  } else {

    out += '\nConfidence: Medium';

  }

  // NEW: Genre safeguard for historical/biographical

  if (contextJSON && (contextJSON.type?.toLowerCase().includes('historical') || contextJSON.subtype === 'biography')) {

    // Extract points from hunter (assume stored in text or parse simple)

    const pointsMatch = out.match(/total points:\s*([\d.]+)/i);

    const points = parseFloat(pointsMatch?.[1] || 0);

    if (points < 3) {  // Stricter threshold

      out = out.replace(/(Rating:\s*)([^\n]+)/i, '$1Center');  // Force Center

      out = out.replace(/(Confidence:\s*)([^\n]+)/i, '$1High');  // Boost conf

    }

  }

  return out.trim();

}

// Helper extractors

function extractRating(text) {
  bgLog('extractRating: Starting extraction from text length:', text?.length || 0);
  
  if (!text || typeof text !== 'string') {
    bgLog('extractRating: Invalid input, falling back to default');
    return 'Unclear';
  }

  // Strategy 1: Try multiple markdown patterns WITHOUT line-start anchors
  const ratingHeaderPatterns = [
    // Pattern 1: Bullet point with bold markdown (most likely from Judge)
    /[-*]\s*\*\*Overall Bias Assessment:\*\*\s*\[?([^\]\n]+)\]?/i,
    // Pattern 2: Just the bold header anywhere in text
    /\*\*Overall Bias Assessment:\*\*\s*:?\s*\[?([^\]\n]+)\]?/i,
    // Pattern 3: Without bold markers
    /Overall Bias Assessment:\s*:?\s*\[?([^\]\n]+)\]?/i,
    // Pattern 4: With colon variations
    /Overall\s+Bias\s+Assessment\s*[::]\s*\[?([^\]\n]+)\]?/i
  ];

  for (const pattern of ratingHeaderPatterns) {
    const markdownMatch = text.match(pattern);
    if (markdownMatch && markdownMatch[1]) {
      let result = markdownMatch[1]
        .trim()
        .replace(/[\[\]]/g, '') // Remove any brackets
        .replace(/^["']|["']$/g, '') // Remove quotes
        .replace(/\.$/, ''); // Remove trailing period
      
      // Normalize common variations
      const normalizations = {
        'centre': 'Center',
        'left': 'Lean Left',
        'right': 'Lean Right',
        'strong left': 'Strong Left',
        'strong right': 'Strong Right',
        'unknown': 'Unclear',
        'n/a': 'Unclear',
        'none': 'Unclear'
      };
      
      const normalized = normalizations[result.toLowerCase()] || result;
      
      // Validate it's an allowed rating
      const allowedRatings = ['Center', 'Lean Left', 'Lean Right', 'Strong Left', 'Strong Right', 'Unclear'];
      if (allowedRatings.some(r => r.toLowerCase() === normalized.toLowerCase())) {
        // Return with correct casing
        const finalResult = allowedRatings.find(r => r.toLowerCase() === normalized.toLowerCase()) || normalized;
        bgLog('extractRating: Success via markdown pattern ->', finalResult);
        return finalResult;
      }
      
      bgLog('extractRating: Found value but not in allowed list:', result);
    }
  }

  // Strategy 2: Try simple "Rating:" patterns (legacy format)
  const simplePatterns = [
    /Rating:\s*\[?([^\]\n]+)\]?/i,
    /\[RATING\]\s*:\s*\[?([^\]\n]+)\]?/i,
    /Final Rating:\s*\[?([^\]\n]+)\]?/i
  ];

  for (const pattern of simplePatterns) {
    const simpleMatch = text.match(pattern);
    if (simpleMatch && simpleMatch[1]) {
      const result = simpleMatch[1]
        .trim()
        .replace(/[\[\]]/g, '')
        .replace(/^["']|["']$/g, '');
      bgLog('extractRating: Success via simple pattern ->', result);
      return result;
    }
  }

  // Strategy 3: Try JSON parsing
  bgLog('extractRating: Trying JSON parsing...');
  const parsedJson = safeJSON(text, null);
  
  if (parsedJson && typeof parsedJson === 'object') {
    // Check various possible JSON paths
    const jsonPaths = [
      parsedJson?.findings?.overall_bias_assessment,
      parsedJson?.report?.findings?.overall_bias_assessment,
      parsedJson?.verdict?.overall_bias_assessment,
      parsedJson?.overall_bias_assessment,
      parsedJson?.bias_assessment,
      parsedJson?.rating,
      parsedJson?.final_rating
    ];

    for (const value of jsonPaths) {
      if (value && typeof value === 'string') {
        const result = value.trim();
        bgLog('extractRating: Success via JSON path ->', result);
        return result;
      }
    }
    bgLog('extractRating: JSON parsed but no rating found in expected paths');
  }

  // Strategy 4: Last resort - scan for rating keywords in context
  const contextPatterns = [
    /(?:rating|assessment|verdict).*?(?:is|:|=)\s*["']?([^"'\n]+?)["']?(?:\.|,|\n|$)/i
  ];

  for (const pattern of contextPatterns) {
    const contextMatch = text.match(pattern);
    if (contextMatch && contextMatch[1]) {
      const potentialRating = contextMatch[1].trim();
      const allowedRatings = ['Center', 'Lean Left', 'Lean Right', 'Strong Left', 'Strong Right', 'Unclear'];
      if (allowedRatings.some(r => potentialRating.toLowerCase().includes(r.toLowerCase()))) {
        const result = allowedRatings.find(r => potentialRating.toLowerCase().includes(r.toLowerCase()));
        bgLog('extractRating: Success via context scan ->', result);
        return result;
      }
    }
  }

  // Fallback
  bgLog('extractRating: All strategies failed, falling back to default "Unclear"');
  return 'Unclear';
}

function extractConfidence(text) {
  bgLog('extractConfidence: Starting extraction from text length:', text?.length || 0);
  
  if (!text || typeof text !== 'string') {
    bgLog('extractConfidence: Invalid input, falling back to default');
    return 'Medium';
  }

  // Strategy 1: Try multiple markdown patterns WITHOUT line-start anchors
  const confidenceHeaderPatterns = [
    // Pattern 1: Bullet point with bold markdown (most likely from Judge)
    /[-*]\s*\*\*Confidence:\*\*\s*\[?([^\]\n]+)\]?/i,
    // Pattern 2: Just the bold header anywhere in text
    /\*\*Confidence:\*\*\s*:?\s*\[?([^\]\n]+)\]?/i,
    // Pattern 3: Without bold markers
    /Confidence:\s*:?\s*\[?([^\]\n]+)\]?/i,
    // Pattern 4: With variations
    /Confidence\s+Level\s*[::]\s*\[?([^\]\n]+)\]?/i,
    /Confidence\s*[::]\s*\[?([^\]\n]+)\]?/i
  ];

  for (const pattern of confidenceHeaderPatterns) {
    const markdownMatch = text.match(pattern);
    if (markdownMatch && markdownMatch[1]) {
      let result = markdownMatch[1]
        .trim()
        .replace(/[\[\]]/g, '') // Remove any brackets
        .replace(/^["']|["']$/g, '') // Remove quotes
        .replace(/\.$/, ''); // Remove trailing period
      
      // Normalize common variations
      const normalizations = {
        'very high': 'High',
        'very low': 'Low',
        'moderate': 'Medium',
        'mid': 'Medium',
        'unclear': 'Medium',
        'unknown': 'Medium'
      };
      
      const normalized = normalizations[result.toLowerCase()] || result;
      
      // Validate it's an allowed confidence level
      const allowedLevels = ['High', 'Medium', 'Low'];
      if (allowedLevels.some(l => l.toLowerCase() === normalized.toLowerCase())) {
        // Return with correct casing
        const finalResult = allowedLevels.find(l => l.toLowerCase() === normalized.toLowerCase()) || normalized;
        bgLog('extractConfidence: Success via markdown pattern ->', finalResult);
        return finalResult;
      }
      
      bgLog('extractConfidence: Found value but not in allowed list:', result);
    }
  }

  // Strategy 2: Try simple "Confidence:" patterns (legacy format)
  const simplePatterns = [
    /Confidence:\s*\[?([^\]\n]+)\]?/i,
    /\[CONFIDENCE\]\s*:\s*\[?([^\]\n]+)\]?/i,
    /Confidence Level:\s*\[?([^\]\n]+)\]?/i
  ];

  for (const pattern of simplePatterns) {
    const simpleMatch = text.match(pattern);
    if (simpleMatch && simpleMatch[1]) {
      const result = simpleMatch[1]
        .trim()
        .replace(/[\[\]]/g, '')
        .replace(/^["']|["']$/g, '');
      bgLog('extractConfidence: Success via simple pattern ->', result);
      return result;
    }
  }

  // Strategy 3: Try JSON parsing
  bgLog('extractConfidence: Trying JSON parsing...');
  const parsedJson = safeJSON(text, null);
  
  if (parsedJson && typeof parsedJson === 'object') {
    // Check various possible JSON paths
    const jsonPaths = [
      parsedJson?.findings?.confidence,
      parsedJson?.report?.findings?.confidence,
      parsedJson?.verdict?.confidence,
      parsedJson?.confidence,
      parsedJson?.confidence_level,
      parsedJson?.report?.confidence,
      parsedJson?.findings?.confidence_level
    ];

    for (const value of jsonPaths) {
      if (value && typeof value === 'string') {
        const result = value.trim();
        bgLog('extractConfidence: Success via JSON path ->', result);
        return result;
      }
    }
    bgLog('extractConfidence: JSON parsed but no confidence found in expected paths');
  }

  // Strategy 4: Last resort - scan for confidence keywords in context
  const contextPatterns = [
    /(?:confidence|certainty).*?(?:is|:|=)\s*["']?([^"'\n]+?)["']?(?:\.|,|\n|$)/i
  ];

  for (const pattern of contextPatterns) {
    const contextMatch = text.match(pattern);
    if (contextMatch && contextMatch[1]) {
      const potentialConfidence = contextMatch[1].trim();
      const allowedLevels = ['High', 'Medium', 'Low'];
      if (allowedLevels.some(l => potentialConfidence.toLowerCase().includes(l.toLowerCase()))) {
        const result = allowedLevels.find(l => potentialConfidence.toLowerCase().includes(l.toLowerCase()));
        bgLog('extractConfidence: Success via context scan ->', result);
        return result;
      }
    }
  }

  // Fallback
  bgLog('extractConfidence: All strategies failed, falling back to default "Medium"');
  return 'Medium';
}

async function callGemini(apiKey, prompt, thinkingBudget, signal, analysisDepth, opts = {}) {

  const { normalize = true, retries = 3, agentRole = 'default' } = opts;

  const isDeep = analysisDepth === 'deep';

  const isJudge = agentRole === 'judge';

  // Deep mode: gemini-2.5-pro ? gemini-flash-latest (with max thinking)
  // Quick mode: gemini-flash-lite-latest (except Judge uses gemini-2.5-flash with 2048 thinking)

  let primary, fallbacks, models;

  if (isDeep) {
    primary = 'gemini-2.5-pro';
    fallbacks = ['gemini-flash-latest'];
  } else {
    // Quick mode
    if (isJudge) {
      primary = 'gemini-2.5-flash';
      fallbacks = []; // No fallback for Judge in quick mode
    } else {
      primary = 'gemini-flash-lite-latest';
      fallbacks = []; // No fallback for regular agents in quick mode
    }
  }

  models = [primary, ...fallbacks];

  let lastErr;

  for (let attempt = 0; attempt < retries; attempt++) {

    const attemptNumber = attempt + 1;
    const delayMs = 400 * Math.pow(attemptNumber, 2) + Math.floor(Math.random() * 200);

    for (const model of models) {

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const body = {

        contents: [{ role: 'user', parts: [{ text: prompt }]}],

        generationConfig: {

          temperature: 0.2,

          topP: 0.8,

          maxOutputTokens: 30000,

          response_mime_type: "application/json"

        }

      };

      // Add thinkingConfig for supported models
      // Deep mode fallback: use max thinking (-1) for gemini-flash-latest
      // Quick mode Judge: use 2048 thinking for gemini-2.5-flash

      let effectiveThinkingBudget = thinkingBudget;

      // Override thinking budget for Deep mode fallback to gemini-flash-latest
      if (isDeep && model === 'gemini-flash-latest') {
        effectiveThinkingBudget = -1; // Max thinking budget for fallback
      }

      // Override thinking budget for Quick mode Judge
      if (!isDeep && isJudge && model === 'gemini-2.5-flash') {
        effectiveThinkingBudget = 2048; // Specific thinking budget for Judge
      }

      if (typeof effectiveThinkingBudget === "number") {

        if (model.includes("flash") || model.includes("2.0-flash")) {

          body.generationConfig.thinkingConfig = { thinkingBudget: effectiveThinkingBudget };

        } else if (model.includes("2.5-pro") || model.includes("2.0-pro")) {

          if (effectiveThinkingBudget === -1 || effectiveThinkingBudget >= 128) {

            body.generationConfig.thinkingConfig = { thinkingBudget: effectiveThinkingBudget };

          }

        }

      }

      try {

        bgLog(`Calling Gemini model ${model} (attempt ${attemptNumber}/${retries})`);

        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {

          const msg = (data && data.error && data.error.message) ? data.error.message : `HTTP ${resp.status}`;

          if (resp.status === 503 || /UNAVAILABLE|overloaded/i.test(msg)) throw new RetriableError(msg);

          throw new Error(`Gemini HTTP ${resp.status}: ${msg}`);

        }

        const candidate = data?.candidates?.[0];

        if (!candidate) throw new Error('No response from API.');

        const finishReason = candidate.finishReason;

        if (finishReason && finishReason !== 'STOP') {

          const reasons = {

            'SAFETY': 'Content was blocked by safety filters',

            'RECITATION': 'Content flagged as potentially plagiarized',

            'MAX_TOKENS': 'Response exceeded token limit',

            'OTHER': 'Request blocked by content policy'

          };

          const message = reasons[finishReason] || `Request failed: ${finishReason}`;

          throw new Error(message);

        }

        const text = (candidate.content?.parts || []).map(p => p.text || '').join('\n').trim();

        if (!text) throw new Error('API returned empty response.');

        try {
          bgLog(`Gemini response received from ${model} (attempt ${attemptNumber}/${retries})`, {
            endpoint: `.../models/${model}:generateContent`,
            hadSignal: !!signal,
            normalized: normalize,
          });
        } catch {}

        return normalize ? normalizeForRenderer(text) : text;

      } catch (err) {

        lastErr = err;

        if (err instanceof RetriableError) {
          bgWarn(`Gemini model ${model} temporarily unavailable on attempt ${attemptNumber}: ${err.message || err}`);
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }

        bgError(`Gemini model ${model} failed on attempt ${attemptNumber}:`, err);

        throw err;

      }

    }

  }

  bgError(`Gemini request failed after ${retries} attempts`, lastErr);
  throw lastErr;

}

// Listen for extension installation

chrome.runtime.onInstalled.addListener(async (details) => {

  // === FIX #2: Configure sidepanel on install/update ===

  try {

    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

    bgLog('Side panel behavior configured on install');

  } catch (error) {

    bgError('Failed to set panel behavior:', error);

  }

  if (details.reason === 'install') {

    bgLog('Extension installed, initializing first-time setup');

    // Set hasCompletedSetup to false on first install

    chrome.storage.local.set({

      hasCompletedSetup: false,

      aiPreference: null,

    }, () => {

      bgLog('First-time setup flags initialized');

    });

  } else if (details.reason === 'update') {

    bgLog('Extension updated to version', chrome.runtime.getManifest().version);

  }

});

// Listen for extension icon clicks and open side panel

chrome.action.onClicked.addListener(async (tab) => {

  if (!tab?.id) return;

  // Check if setup has been completed

  try {

    const storage = await new Promise((resolve) => {

      chrome.storage.local.get(['hasCompletedSetup'], (result) => {

        resolve(result);

      });

    });

    bgLog('Setup status:', storage);

    // If setup not completed, open setup page instead of side panel

    if (!storage.hasCompletedSetup) {

      bgLog('Setup not completed, opening setup page');

      chrome.tabs.create({ url: chrome.runtime.getURL('setup/setup.html') });

      return;

    }

    // Setup completed, open side panel normally

    chrome.sidePanel.open({ tabId: tab.id }).catch((error) => {

      bgWarn('Failed to open side panel:', error);

    });

  } catch (error) {

    bgError('Error checking setup status:', error);

    // On error, try to open side panel anyway

    chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {

      bgWarn('Failed to open side panel:', err);

    });

  }

});

// Main message listener for side panel communication

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'REQUEST_SCAN') {

    handleScanRequest(message, sender, sendResponse);

    return true;

  }

  if (message.type === 'CANCEL_SCAN') {

    handleCancelScan(sender);

    return false;

  }

  if (message.type === 'OPEN_RESULTS_PAGE') {

    chrome.tabs.create({ url: chrome.runtime.getURL('results/results.html') })

      .then(() => {

        bgLog('Results page opened');

      })

      .catch((error) => {

        bgError('Failed to open results page:', error);

      });

    return false;

  }

});

async function handleScanRequest(message, sender, sendResponse) {

  bgLog('Scan request received');

  bgLog('Message:', message);

  let tabId = null; // <-- hoist so catch/finally can see it

  try {

    // Get the tab ID from the message or sender

    tabId = message?.tabId ?? sender?.tab?.id;

    if (!tabId) {

      try {

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

        tabId = tabs?.[0]?.id ?? null;

      } catch (e) {

        bgWarn('tabs.query failed:', e);

      }

    }

    if (!tabId) {

      bgWarn('No tab ID available, cannot track scan');

    }

    // Cancel any existing scan for this specific tab

    if (tabId && activeScanControllers.has(tabId)) {

      activeScanControllers.get(tabId).abort();

      activeScanControllers.delete(tabId);

    }

    const settings = await getStorageData(['geminiApiKey', 'analysisDepth']);

    bgLog('Settings loaded:', {

      hasApiKey: !!settings.geminiApiKey,

      apiKeyLength: settings.geminiApiKey?.trim().length || 0,

      analysisDepth: settings.analysisDepth

    });

    const apiKey = settings.geminiApiKey?.trim();

    if (!apiKey) {

      bgError('API key missing; aborting scan');

      sendResponse({

        type: 'SCAN_ERROR',

        error: 'Gemini API key is required. Please configure it in Settings.'

      });

      return;

    }

    bgLog('API key validated, proceeding with scan');

    const articleContent = message.articleContent;

    if (!articleContent || !articleContent.fullText || !articleContent.fullText.trim()) {

      sendResponse({

        type: 'SCAN_ERROR',

        error: 'No article content provided for analysis.'

      });

      return;

    }

    const trimmedText = articleContent.fullText.trim();

    if (trimmedText.length < 200) {

      sendResponse({

        type: 'SCAN_ERROR',

        error: 'Article is too short for meaningful analysis (minimum 200 characters).'

      });

      return;

    }

    const analysisDepth = settings.analysisDepth || 'quick';

    bgLog('Starting cloud AI scan:', {

      analysisDepth,

      textLength: articleContent.fullText.length

    });

    const controller = new AbortController();

    if (tabId) {

      activeScanControllers.set(tabId, controller);

    }

    const result = await performMultiAgentScan(

      articleContent.fullText,

      apiKey,

      analysisDepth,

      controller.signal

    );

    bgLog('Scan result received from API');

    bgLog('Result type:', typeof result);

    bgLog('Result length:', typeof result === 'string' ? result.length : 'N/A');

    bgLog('Result value:', result);

    sendResponse({

      type: 'SCAN_COMPLETE',

      results: result

    });

    bgLog('Response sent to sidepanel');

    // Send highlighting data to content script for both biased and neutral phrases

    const hasBiasedPhrases = result.languageAnalysis && result.languageAnalysis.length > 0;

    const hasNeutralPhrases = result.balancedElements && result.balancedElements.length > 0;

    if ((hasBiasedPhrases || hasNeutralPhrases) && tabId) {

      try {

        await chrome.tabs.sendMessage(tabId, {

          type: 'HIGHLIGHT_DATA',

          biasedPhrases: result.languageAnalysis || [],

          neutralPhrases: result.balancedElements || []

        });

        bgLog('Highlight data sent to content script:', {

          biasedCount: result.languageAnalysis?.length || 0,

          neutralCount: result.balancedElements?.length || 0

        });

      } catch (error) {

        bgWarn('Failed to send highlight data:', error);

      }

    }

  } catch (error) {

    bgError('Scan failed:', error);

    let errorMessage = 'Analysis failed. Please try again.';

    if (error.name === 'AbortError') errorMessage = 'Analysis was cancelled.';

    else if (error.message?.includes('API key')) errorMessage = 'Invalid API key. Please check your settings.';

    else if (error.message?.includes('network') || error.message?.includes('fetch')) errorMessage = 'Network error. Check your internet connection.';

    else if (error.message) errorMessage = error.message;

    sendResponse({ type: 'SCAN_ERROR', error: errorMessage });

  } finally {

    // Centralized cleanup; safe even if already deleted

    if (tabId) activeScanControllers.delete(tabId);

  }

}

function handleCancelScan(sender) {

  bgLog('Cancelling active scan');

  const tabId = sender?.tab?.id;

  if (tabId && activeScanControllers.has(tabId)) {

    activeScanControllers.get(tabId).abort();

    activeScanControllers.delete(tabId);

  }

}

function safeJSON(input, fallback = null) {

  if (input == null) return fallback;

  try {

    if (typeof input === 'object') return input;

    let s = String(input).trim().replace(/^\uFEFF/, '');

    // Remove surrounding quotes that might wrap the entire response

    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {

      s = s.slice(1, -1);

    }

    // Strip HTML <pre><code> wrappers if present

    s = s

      .replace(/^<pre[^>]*>\s*<code[^>]*>/i, '')

      .replace(/<\/code>\s*<\/pre>$/i, '')

      .trim();

    // Fix malformed fences like '```'json or "```"json or ```'json

    s = s.replace(/['"]*```['"]*(json|jsonc)?['"]*\s*/gi, '```$1\n');

    s = s.replace(/['"]*```['"]*\s*$/gi, '```');

    // Extract from fenced code blocks (```json ...```, ``` ...```, ~~~ ... ~~~)

    const fence =

      s.match(/```(?:json|jsonc)?\s*([\s\S]*?)\s*```/i) ||

      s.match(/~~~(?:json|jsonc)?\s*([\s\S]*?)\s*~~~/i);

    if (fence && fence[1]) s = fence[1].trim();

    // Remove any remaining stray backticks or quotes at start/end

    s = s.replace(/^[`'"]+|[`'"]+$/g, '');

    // Helpers to allow JSONC-style comments & trailing commas

    const stripComments = t =>

      t.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

    const stripTrailingCommas = t => t.replace(/,\s*([}\]])/g, '$1');

    const tryParse = t => {

      try { return JSON.parse(t); } catch { return undefined; }

    };

    // 1) Direct parse

    let parsed = tryParse(s);

    if (parsed !== undefined) return parsed;

    // 2) Parse after cleaning comments/trailing commas

    parsed = tryParse(stripTrailingCommas(stripComments(s)));

    if (parsed !== undefined) return parsed;

    // 3) Fallback: scan for first balanced {...} or [...]

    const idx = s.search(/[\{\[]/);

    if (idx !== -1) {

      let stack = [], inStr = false, esc = false;

      for (let i = idx; i < s.length; i++) {

        const c = s[i];

        if (inStr) {

          if (esc) esc = false;

          else if (c === '\\') esc = true;

          else if (c === '"') inStr = false;

          continue;

        }

        if (c === '"') { inStr = true; continue; }

        if (c === '{' || c === '[') stack.push(c);

        else if (c === '}' || c === ']') {

          if (!stack.length) break;

          const open = stack[stack.length - 1];

          if ((open === '{' && c === '}') || (open === '[' && c === ']')) {

            stack.pop();

            if (!stack.length) {

              const candidate = s.slice(idx, i + 1);

              parsed =

                tryParse(candidate) ??

                tryParse(stripTrailingCommas(stripComments(candidate)));

              if (parsed !== undefined) return parsed;

              break;

            }

          } else {

            break;

          }

        }

      }

    }

    // Special handler for tribunal responses that may be truncated

    if (s.includes('"charges"') || s.includes('"rebuttals"') || s.includes('"verified_facts"')) {

      bgLog('Attempting to repair truncated tribunal JSON...');

      try {

        // Find the last complete object in the JSON

        let repaired = s;

        // Count braces

        const openBraces = (repaired.match(/\{/g) || []).length;

        const closeBraces = (repaired.match(/\}/g) || []).length;

        const openBrackets = (repaired.match(/\[/g) || []).length;

        const closeBrackets = (repaired.match(/\]/g) || []).length;

        // Close any unclosed arrays/objects

        if (openBrackets > closeBrackets) {

          repaired += ']'.repeat(openBrackets - closeBrackets);

        }

        if (openBraces > closeBraces) {

          repaired += '}'.repeat(openBraces - closeBraces);

        }

        // Remove trailing commas that break JSON

        repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

        const parsed = JSON.parse(repaired);

        bgLog('Tribunal JSON successfully repaired');

        return parsed;

      } catch (repairError) {

        bgWarn('Tribunal JSON repair failed, using safe fallback');

        // Continue to return fallback below

      }

    }


    // Log the problematic input for debugging

    bgWarn('JSON parse failed, using fallback. First 500 chars:', s.slice(0, 500));

  } catch (err) {

    bgError('JSON parse exception:', err.message);

  }

  return fallback;

}

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function isValidBalancedExcerpt(example) {
  const wordCount = countWords(example);
  return Number.isFinite(wordCount) && wordCount >= 5 && wordCount <= 15;
}

async function ensureBalancedExamples(elements, sourceText, requestSnippet) {
  if (!Array.isArray(elements) || elements.length === 0) return [];
  const resolved = [];

  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;

    let example = typeof element.example === 'string' ? element.example.trim() : '';

    if (!isValidBalancedExcerpt(example) && typeof requestSnippet === 'function') {
      try {
        const candidate = await requestSnippet(element, sourceText);
        if (typeof candidate === 'string') {
          example = candidate.trim();
        }
      } catch (error) {
        bgWarn('Failed to fetch balanced snippet:', error);
      }
    }

    if (isValidBalancedExcerpt(example)) {
      resolved.push({ ...element, example });
    } else {
      bgWarn('Dropping balanced element without valid excerpt:', element);
    }
  }

  return resolved;
}


async function performMultiAgentScan(articleText, apiKey, analysisDepth, signal) {

  // Select appropriate prompt module based on analysis depth
  const Prompts = analysisDepth === 'deep' ? AgentPrompts : QuickPrompts;
  bgLog(`Using ${analysisDepth} mode prompts from ${analysisDepth === 'deep' ? 'prompts.js' : 'prompt-quick-cloud.js'}`);

  let thinkingBudget;

  if (analysisDepth === 'deep') {

    // Deep analysis: enable thinking (auto) on Pro

    thinkingBudget = -1;

  } else {

    // Quick scan: 0 token thinking budget on Flash for speed

    thinkingBudget = 0;

  }

  bgLog('Using thinking budget:', thinkingBudget);

  const textToAnalyze = articleText.slice(0, 500000);

  bgLog('Agent 1: Context analysis...');

  const contextPrompt = Prompts.createContextPrompt(textToAnalyze);

  const contextResponse = await callGemini(apiKey, contextPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'context' });

  bgLog('Context analysis complete');

  const contextJson = safeJSON(contextResponse, { type: 'Unknown', summary: '', tone: 'Neutral', quote_ratio: 'Unknown', quote_percentage: 0, confidence: 'High' });

  const articleType = contextJson.type || 'Unknown';

  const summary = contextJson.summary || '';

  const tone = contextJson.tone || 'Neutral';

  const quoteRatio = contextJson.quote_ratio || 'Unknown';

  const quotePct = contextJson.quote_percentage || 0;

  const contextData = `${articleType} article. ${summary}. Tone: ${tone}. Quote ratio: ${quoteRatio} (${quotePct}%).`;

  bgLog('Context:', contextData);

  bgLog('Agents 2-4: Language, Bias, and Skeptic analysis...');

  const languagePrompt = Prompts.createLanguagePrompt(contextData, textToAnalyze);

  const hunterPrompt = Prompts.createHunterPrompt(contextData, textToAnalyze);

  const skepticPrompt = Prompts.createSkepticPrompt(contextData, textToAnalyze);

  // Quote Agent: extract direct quotes for weighting

  const quotePrompt = Prompts.createQuotePrompt(contextData, textToAnalyze);

  // Deep mode: Add 3 specialized agents for comprehensive analysis

  let sourceDiversityPrompt = '';

  let framingPrompt = '';

  let omissionPrompt = '';

  if (analysisDepth === 'deep') {

    bgLog('Deep mode: Activating specialized agents');

    sourceDiversityPrompt = AgentPrompts.createSourceDiversityPrompt(textToAnalyze);

    framingPrompt = AgentPrompts.createFramingPrompt(textToAnalyze);

    omissionPrompt = AgentPrompts.createOmissionPrompt(contextData, textToAnalyze);

  }

  // Execute agents in parallel for better performance

  const [quoteResponse, languageResponse, hunterResponse, skepticResponse] = await Promise.all([

    callGemini(apiKey, quotePrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'quote' }),

    callGemini(apiKey, languagePrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'language' }),

    callGemini(apiKey, hunterPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'hunter' }),

    callGemini(apiKey, skepticPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'skeptic' })

  ]);

  const languageJSON = safeJSON(languageResponse, { loaded_phrases: [], neutrality_score: 10, confidence: 'High' });

  const hunterJSON = safeJSON(hunterResponse, { bias_indicators: [], overall_bias: 'Unclear', confidence: 'High' });

  let skepticJSON = safeJSON(skepticResponse, { balanced_elements: [], balance_score: 0, confidence: 'High' });
  if (Array.isArray(skepticJSON.balanced_elements) && skepticJSON.balanced_elements.length) {
    const balancedElements = await ensureBalancedExamples(
      skepticJSON.balanced_elements,
      textToAnalyze,
      async (element) => {
        const snippetPrompt = Prompts.createBalancedSnippetPrompt(contextData, textToAnalyze, element);
        const snippetResponse = await callGemini(apiKey, snippetPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'snippet' });
        const snippetJSON = safeJSON(snippetResponse, { example: null });
        return typeof snippetJSON.example === 'string' ? snippetJSON.example.trim() : '';
      }
    );
    skepticJSON = { ...skepticJSON, balanced_elements: balancedElements };
  }

  const quoteJSON = safeJSON(quoteResponse, { quotes: [], confidence: 'High' });

  // Deep mode: Execute specialized agents

  let sourceDiversityResponse = '';

  let framingResponse = '';

  let omissionResponse = '';

  if (analysisDepth === 'deep') {

    bgLog('Executing deep analysis agents...');

    [sourceDiversityResponse, framingResponse, omissionResponse] = await Promise.all([

      callGemini(apiKey, sourceDiversityPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'sourceDiversity' }),

      callGemini(apiKey, framingPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'framing' }),

      callGemini(apiKey, omissionPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'omission' })

    ]);

    bgLog('Deep analysis agents complete');

  }

  bgLog('Phase 1: Initial Evidence Gathering complete');

  // ==================== PHASE 2: CROSS-EXAMINATION & CHALLENGE ====================

  bgLog('Phase 2: Tribunal Cross-Examination starting...');

  // Agent 1: Prosecutor - Build the case for bias

  bgLog('Agent 5: Prosecutor building case...');

  const prosecutorPrompt = Prompts.createProsecutorPrompt(

    contextData,

    languageJSON,

    hunterJSON,

    skepticJSON,

    quoteJSON

  );

  const prosecutorResponse = await callGemini(apiKey, prosecutorPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'prosecutor' });

  const prosecutorJSON = safeJSON(prosecutorResponse, { charges: [], prosecution_summary: 'No charges filed.', confidence: 'High' });

  bgLog('Prosecutor complete. Charges filed:', prosecutorJSON.charges?.length || 0);

  // Agent 2 & 3: Defense and Investigator run in parallel

  bgLog('Agents 6-7: Defense and Investigator running in parallel...');

  const defensePrompt = Prompts.createDefensePrompt(

    prosecutorJSON,

    contextData,

    languageJSON,

    hunterJSON,

    skepticJSON,

    quoteJSON

  );

  const investigatorPrompt = Prompts.createInvestigatorPrompt(

    prosecutorJSON,

    textToAnalyze

  );

  const [defenseResponse, investigatorResponse] = await Promise.all([

    callGemini(apiKey, defensePrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'defense' }),

    callGemini(apiKey, investigatorPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'investigator' })

  ]);

  const defenseJSON = safeJSON(defenseResponse, { rebuttals: [], defense_summary: 'No rebuttals needed.', confidence: 'High' });

  const investigatorJSON = safeJSON(investigatorResponse, { verified_facts: [], investigator_summary: 'No structural claims to investigate.', overall_confidence: 'High' });

  bgLog('Defense complete. Rebuttals filed:', defenseJSON.rebuttals?.length || 0);

  bgLog('Investigator complete. Facts verified:', investigatorJSON.verified_facts?.length || 0);

  bgLog('Phase 2: Cross-Examination complete');

  // ==================== PHASE 3: JUDICIAL SYNTHESIS ====================

  bgLog('Phase 3: Judge rendering final verdict...');

  // Agent 8: Judge - Final adjudication using tribunal debate

  const judgePrompt = Prompts.createJudgePrompt(

    prosecutorJSON,

    defenseJSON,

    investigatorJSON,

    contextData

  );

  const judgeResponse = await callGemini(apiKey, judgePrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'judge' });

  bgLog('Judge response received');

  bgLog('Judge response type:', typeof judgeResponse);

  bgLog('Judge response length:', typeof judgeResponse === 'string' ? judgeResponse.length : 'N/A');

  bgLog('Judge response:', judgeResponse);

  bgLog('Phase 3: Judicial Synthesis complete');

  bgLog('Adversarial Tribunal Analysis complete');

  // CRITICAL: Extract rating and confidence from RAW Judge response BEFORE normalization
  // This prevents normalizeForRenderer's strict validation from replacing valid values with defaults
  bgLog('Debug: Raw judgeResponse before extraction:', judgeResponse);

  const correctRating = extractRating(judgeResponse);

  const correctConfidence = extractConfidence(judgeResponse);

  bgLog('Extracted from raw Judge response:', { correctRating, correctConfidence });

  // NOW normalize the text for display (after extraction)

  const normalizedText = normalizeForRenderer(judgeResponse, contextJson);

  return {

    text: normalizedText,

    languageAnalysis: languageJSON.loaded_phrases?.slice?.(0, 8) || [],

    balancedElements: skepticJSON.balanced_elements || [],

    biasIndicators: hunterJSON.bias_indicators || [],

    quotes: quoteJSON.quotes || [],

    // Include tribunal metadata for potential UI enhancements

    tribunalDebate: {

      charges: prosecutorJSON.charges || [],

      rebuttals: defenseJSON.rebuttals || [],

      verifiedFacts: investigatorJSON.verified_facts || []

    },

    // Use values extracted from RAW response (before normalization altered them)

    extractedRating: correctRating,

    extractedConfidence: correctConfidence

  };
}

// callGeminiAPI removed; migrated to callGemini helper above

function getStorageData(keys) {

  return new Promise((resolve, reject) => {

    chrome.storage.local.get(keys, (result) => {

      if (chrome.runtime.lastError) {

        reject(chrome.runtime.lastError);

      } else {

        resolve(result);

      }

    });

  });

}


// Export for testing or module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractRating, extractConfidence };
}



