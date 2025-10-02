/**
 * BiasNeutralizer Background Service Worker
 * Manages cloud-based AI analysis with multi-agent system
 */

let activeScanController = null;

// === Gemini helpers ===
// Use latest 2.5 models per Google guidance
// REST: thinking is supported by the model; do not send SDK-only fields
const DEFAULT_MODEL = 'gemini-2.5-flash';
const THINKING_MODELS = ['gemini-2.5-pro'];

function selectModel(enableThinking) {
  return enableThinking ? THINKING_MODELS[0] : DEFAULT_MODEL;
}

function normalizeForRenderer(text) {
  let out = (text || '').replace(/\r\n?/g, '\n');
  // Map bracket labels to what Results expects
  out = out
    .replace(/\[RATING\]\s*:/gi, 'Rating:')
    .replace(/\[CONFIDENCE\]\s*:/gi, 'Confidence:');
  // Guarantee a top section so the page never looks empty
  if (!/Overall Bias Assessment/i.test(out)) {
    out = '## Overall Bias Assessment\n' + out;
  }
  return out.trim();
}

async function callGemini(apiKey, prompt, enableThinking, thinkingBudget, signal) {
  const model = selectModel(enableThinking);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // Build request body
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }]}],
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 2048
    }
  };

  // ✅ Add thinkingConfig correctly for supported cases
  //  - Flash/Flash-Lite: allow 0 (off), -1 (auto), or positive
  //  - Pro: don't send 0 (can't disable); allow -1 or a positive minimum (>=128)
  if (typeof thinkingBudget === "number") {
    if (model.includes("2.5-flash")) {
      body.generationConfig.thinkingConfig = { thinkingBudget };
    } else if (model.includes("2.5-pro")) {
      if (thinkingBudget === -1 || thinkingBudget >= 128) {
        body.generationConfig.thinkingConfig = { thinkingBudget };
      }
      // if thinkingBudget === 0 on Pro, omit the field entirely
    }
  }

  // Lightweight debug logging (excludes API key). Safe to leave for dev
  try {
    console.log('[BiasNeutralizer] Gemini request:', {
      model,
      url: `.../models/${model}:generateContent?key=***`,
      hasSignal: !!signal,
      body
    });
  } catch (_) {}

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal
  });

  if (!resp.ok) {
    // Try to extract structured error first; fall back to text
    let errText = '';
    try {
      const j = await resp.json();
      errText = JSON.stringify(j);
    } catch (_) {
      errText = await resp.text().catch(() => '');
    }
    throw new Error(`Gemini HTTP ${resp.status}: ${errText.slice(0, 400)}`);
  }

  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('\n').trim();
  return normalizeForRenderer(text);
}

// Listen for extension icon clicks and open side panel
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Main message listener for side panel communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REQUEST_SCAN') {
    handleScanRequest(message, sendResponse);
    return true;
  }

  if (message.type === 'CANCEL_SCAN') {
    handleCancelScan();
    return false;
  }
});

async function handleScanRequest(message, sendResponse) {
  console.log('[BiasNeutralizer] ===== SCAN REQUEST RECEIVED =====');
  console.log('[BiasNeutralizer] Message:', message);
  
  try {
    if (activeScanController) {
      activeScanController.abort();
      activeScanController = null;
    }

    const settings = await getStorageData(['geminiApiKey', 'analysisDepth', 'enableThinking']);
    console.log('[BiasNeutralizer] Settings loaded:', {
      hasApiKey: !!settings.geminiApiKey,
      apiKeyLength: settings.geminiApiKey?.trim().length || 0,
      analysisDepth: settings.analysisDepth,
      enableThinking: settings.enableThinking
    });
    
    const apiKey = settings.geminiApiKey?.trim();
    
    if (!apiKey) {
      console.error('[BiasNeutralizer] No API key found!');
      sendResponse({
        type: 'SCAN_ERROR',
        error: 'Gemini API key is required. Please configure it in Settings.'
      });
      return;
    }
    
    console.log('[BiasNeutralizer] API key validated, proceeding with scan');

    const articleContent = message.articleContent;
    if (!articleContent || !articleContent.fullText) {
      sendResponse({
        type: 'SCAN_ERROR',
        error: 'No article content provided for analysis.'
      });
      return;
    }

    const analysisDepth = settings.analysisDepth || 'quick';
    const enableThinking = settings.enableThinking !== undefined ? settings.enableThinking : false;

    console.log('[BiasNeutralizer] Starting cloud AI scan:', {
      analysisDepth,
      enableThinking,
      textLength: articleContent.fullText.length
    });

    activeScanController = new AbortController();
    const result = await performMultiAgentScan(
      articleContent.fullText,
      apiKey,
      analysisDepth,
      enableThinking,
      activeScanController.signal
    );

    console.log('[BiasNeutralizer] ===== SCAN RESULT FROM API =====');
    console.log('[BiasNeutralizer] Result type:', typeof result);
    console.log('[BiasNeutralizer] Result length:', typeof result === 'string' ? result.length : 'N/A');
    console.log('[BiasNeutralizer] Result value:', result);

    activeScanController = null;

    sendResponse({
      type: 'SCAN_COMPLETE',
      results: result
    });
    
    console.log('[BiasNeutralizer] Response sent to sidepanel');

  } catch (error) {
    console.error('[BiasNeutralizer] Scan failed:', error);
    
    let errorMessage = 'Analysis failed. Please try again.';
    
    if (error.name === 'AbortError') {
      errorMessage = 'Analysis was cancelled.';
    } else if (error.message.includes('API key')) {
      errorMessage = 'Invalid API key. Please check your settings.';
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      errorMessage = 'Network error. Check your internet connection.';
    } else if (error.message) {
      errorMessage = error.message;
    }

    sendResponse({
      type: 'SCAN_ERROR',
      error: errorMessage
    });
    
    activeScanController = null;
  }
}

function handleCancelScan() {
  console.log('[BiasNeutralizer] Cancelling active scan');
  if (activeScanController) {
    activeScanController.abort();
    activeScanController = null;
  }
}

async function performMultiAgentScan(articleText, apiKey, analysisDepth, enableThinking, signal) {
  let thinkingBudget;
  if (analysisDepth === 'deep') {
    thinkingBudget = -1;
  } else if (analysisDepth === 'quick' && enableThinking) {
    thinkingBudget = -1;
  } else {
    thinkingBudget = 0;
  }

  console.log('[BiasNeutralizer] Using thinking budget:', thinkingBudget);

  const textToAnalyze = articleText.slice(0, 8000);

  console.log('[BiasNeutralizer] Agent 1: Context analysis...');
  const contextPrompt = `You are a content classifier. Analyze the text and output ONLY valid JSON.

Instructions:
- TYPE must be one of: News, Opinion, Analysis, Satire, Academic
- SUMMARY must be EXACTLY 10 words describing the main topic
- TONE must be one of: Neutral, Emotional, Analytical
- QUOTE_RATIO: Estimate what percentage of the text is direct quotes vs narrative
  - Low = 0-30% quotes
  - Medium = 30-60% quotes  
  - High = 60-100% quotes

Output ONLY this JSON structure (no other text):
{
  "type": "TYPE_HERE",
  "summary": "EXACTLY TEN WORDS HERE",
  "tone": "TONE_HERE",
  "quote_ratio": "Low/Medium/High",
  "quote_percentage": NUMBER_HERE
}

ARTICLE TEXT:
${textToAnalyze}`;

  const contextResponse = await callGemini(apiKey, contextPrompt, enableThinking, thinkingBudget, signal);
  console.log('[BiasNeutralizer] Context analysis complete');

   // Parse JSON response
   let contextData;
   try {
     const contextJson = JSON.parse(contextResponse);
     const articleType = contextJson.type || 'Unknown';
     const summary = contextJson.summary || '';
     const tone = contextJson.tone || 'Neutral';
     const quoteRatio = contextJson.quote_ratio || 'Unknown';
     const quotePct = contextJson.quote_percentage || 0;
     contextData = `${articleType} article. ${summary}. Tone: ${tone}. Quote ratio: ${quoteRatio} (${quotePct}%).`;
   } catch (e) {
     // Fallback to text parsing if JSON fails
     const contextLines = contextResponse.split('\n');
     const articleType = contextLines.find(l => l.startsWith('TYPE:'))?.split(':')[1]?.trim() || 'Unknown';
     const summary = contextLines.find(l => l.startsWith('SUMMARY:'))?.split(':')[1]?.trim() || '';
     const tone = contextLines.find(l => l.startsWith('TONE:'))?.split(':')[1]?.trim() || 'Neutral';
     const quoteRatio = contextLines.find(l => l.startsWith('QUOTE_RATIO:'))?.split(':')[1]?.trim() || 'Unknown';
     contextData = `${articleType} article. ${summary}. Tone: ${tone}. Quote ratio: ${quoteRatio}.`;
   }

  console.log('[BiasNeutralizer] Context:', contextData);

  console.log('[BiasNeutralizer] Agents 2-4: Language, Bias, and Skeptic analysis...');

  const languagePrompt = `Context: ${contextData}

Identify loaded or emotional language ONLY in the NARRATIVE (reporter's voice), not in quotes.

CRITICAL DISTINCTION:
✓ ANALYZE: Reporter writes "The controversial policy sparked outrage"
✗ IGNORE: Article quotes 'Trump said "this sparked outrage"'

Find 3-5 examples of emotional/loaded language in the narrative. Rate neutrality 0-10 (10=most neutral).

Output ONLY this JSON:
{
  "loaded_phrases": [
    {
      "phrase": "exact phrase from narrative",
      "explanation": "why this is loaded/emotional",
      "bias_direction": "Left/Right/Neutral"
    }
  ],
  "neutrality_score": NUMBER_0_TO_10,
  "summary": "one sentence overall assessment"
}

If no loaded language found: {"loaded_phrases": [], "neutrality_score": 10, "summary": "Neutral language throughout"}

TEXT:
${textToAnalyze}`;

  const hunterPrompt = `Context: ${contextData}

Identify bias indicators in the JOURNALISTIC NARRATIVE (how the article is written).

CRITICAL: Only analyze the REPORTER'S choices, not quoted sources.
✗ WRONG: Article quotes 'Senator called it "a disaster"' - that's the Senator's bias
✓ RIGHT: Reporter chose to lead with criticism before mentioning support - that's journalistic bias

Types to look for:
- Selective framing (what's emphasized/minimized)
- Missing context
- Loaded descriptions
- Unbalanced sourcing
- Editorial commentary disguised as reporting

Output ONLY this JSON:
{
  "bias_indicators": [
    {
      "type": "Framing/Language/Sourcing/Context/Commentary",
      "example": "exact phrase or description",
      "explanation": "how this shows bias",
      "bias_direction": "Left/Right/Unclear"
    }
  ],
  "overall_bias": "Strong Left/Lean Left/Center/Lean Right/Strong Right",
  "confidence": "High/Medium/Low"
}

If no bias found: {"bias_indicators": [], "overall_bias": "Center", "confidence": "High"}

TEXT:
${textToAnalyze}`;

  const skepticPrompt = `Context: ${contextData}

Identify neutral, balanced, and factual elements in the article that demonstrate good journalism.

Look for:
- Balanced sourcing (multiple perspectives)
- Factual statements without editorial spin
- Attribution and transparency
- Context and nuance
- Acknowledging complexity or uncertainty

Output ONLY this JSON:
{
  "balanced_elements": [
    {
      "type": "Sourcing/Facts/Attribution/Context/Nuance",
      "example": "exact quote or description",
      "explanation": "why this demonstrates balance"
    }
  ],
  "balance_score": NUMBER_0_TO_10,
  "strengths": "one sentence about journalistic strengths"
}

If no balanced elements: {"balanced_elements": [], "balance_score": 0, "strengths": "No balanced elements found"}

TEXT:
${textToAnalyze}`;

  // Quote Agent: extract direct quotes for weighting
  const quotePrompt = `Context: ${contextData}

Extract ALL direct quotes from the article. A quote is text inside "quotation marks" or text explicitly attributed to a speaker.

Rules:
- Include ONLY actual quotes from the text
- Quote the EXACT text within quotation marks
- Include speaker if identified, otherwise use "Unknown"
- Output as JSON array

Output ONLY this JSON (no other text):
{
  "quotes": [
    {
      "text": "exact quote text here",
      "speaker": "speaker name or Unknown",
      "contains_bias_language": true/false
    }
  ]
}

If NO quotes found, output: {"quotes": [], "message": "No direct quotes found"}

TEXT:
${textToAnalyze}`;

  const quoteResponse = await callGemini(apiKey, quotePrompt, enableThinking, thinkingBudget, signal);
  const languageResponse = await callGemini(apiKey, languagePrompt, enableThinking, thinkingBudget, signal);
  const hunterResponse = await callGemini(apiKey, hunterPrompt, enableThinking, thinkingBudget, signal);
  const skepticResponse = await callGemini(apiKey, skepticPrompt, enableThinking, thinkingBudget, signal);

  console.log('[BiasNeutralizer] Analysis agents complete');

  console.log('[BiasNeutralizer] Agent 5: Moderator synthesis...');
  const moderatorPrompt = `You are the Final Moderator. Synthesize the agent findings into a structured bias report.

CONTEXT: ${contextData}

AGENT FINDINGS:
Quotes: ${quoteResponse}
Language: ${languageResponse}
Bias Hunter: ${hunterResponse}
Balance Skeptic: ${skepticResponse}

ANALYSIS RULES:
1. Parse the JSON responses from each agent
2. Weight bias based on where loaded language appears:
   - If 70%+ of loaded language is IN QUOTES → Rating tends toward Center
   - If 70%+ is in NARRATIVE → Apply appropriate Left/Right rating
3. Consider balance elements as mitigating factors

OUTPUT THIS EXACT STRUCTURE (no markdown, no extra formatting):

OVERALL BIAS ASSESSMENT
Rating: [MUST BE ONE OF: Strong Left | Lean Left | Center | Lean Right | Strong Right]
Confidence: [MUST BE ONE OF: High | Medium | Low]
Summary: [2-3 sentences. If most bias came from quotes, state: "Most charged language appears in quoted sources rather than the reporting itself."]

KEY FINDINGS
- [Specific finding about the REPORTING, not quotes]
- [Another finding about journalistic choices]
- [Third finding if significant]

BALANCED ELEMENTS
- [Neutral/positive aspect of the reporting]
- [Another balanced element if found]

METHODOLOGY NOTE
This analysis distinguishes between source bias (what people said) and journalistic bias (how the story was reported).

CRITICAL RULES:
- Keep total response under 300 words
- Do NOT use ### or ** or any markdown
- Do NOT mention agents or analysis process
- Base conclusions ONLY on the evidence provided above
- Each section MUST start with its exact header as shown`;

  const moderatorResponse = await callGemini(apiKey, moderatorPrompt, enableThinking, thinkingBudget, signal);
  
  console.log('[BiasNeutralizer] ===== MODERATOR RESPONSE =====');
  console.log('[BiasNeutralizer] Moderator response type:', typeof moderatorResponse);
  console.log('[BiasNeutralizer] Moderator response length:', typeof moderatorResponse === 'string' ? moderatorResponse.length : 'N/A');
  console.log('[BiasNeutralizer] Moderator response:', moderatorResponse);
  console.log('[BiasNeutralizer] Multi-agent scan complete');

  return moderatorResponse;
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