/**
 * BiasNeutralizer Background Service Worker
 * Manages cloud-based AI analysis with multi-agent system
 */

let activeScanControllers = new Map(); // tabId -> AbortController


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

async function callGemini(apiKey, prompt, thinkingBudget, signal, analysisDepth) {
  // Default to Flash if analysisDepth is invalid/missing
  const model = (analysisDepth === 'quick' || !analysisDepth) 
    ? 'gemini-2.5-flash'
    : 'gemini-2.5-pro';
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

  // Check for safety/content filtering
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    throw new Error('No response from API. The content may have been filtered.');
  }

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

  const parts = candidate.content?.parts || [];
  const text = parts.map(p => p.text || '').join('\n').trim();

  if (!text) {
    throw new Error('API returned empty response. Try a different article or adjust settings.');
  }

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
    handleCancelScan(sender);
    return false;
  }
});

async function handleScanRequest(message, sendResponse) {
  console.log('[BiasNeutralizer] ===== SCAN REQUEST RECEIVED =====');
  console.log('[BiasNeutralizer] Message:', message);
  
  try {
    // Get the tab ID from the sender
    const tabId = sender.tab?.id;
    if (!tabId) {
      console.warn('[BiasNeutralizer] No tab ID available, cannot track scan');
    }

    // Cancel any existing scan for this specific tab
    if (tabId && activeScanControllers.has(tabId)) {
      activeScanControllers.get(tabId).abort();
      activeScanControllers.delete(tabId);
    }

    const settings = await getStorageData(['geminiApiKey', 'analysisDepth']);
    console.log('[BiasNeutralizer] Settings loaded:', {
      hasApiKey: !!settings.geminiApiKey,
      apiKeyLength: settings.geminiApiKey?.trim().length || 0,
      analysisDepth: settings.analysisDepth
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

    console.log('[BiasNeutralizer] Starting cloud AI scan:', {
      analysisDepth,
      enableThinking,
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

    console.log('[BiasNeutralizer] ===== SCAN RESULT FROM API =====');
    console.log('[BiasNeutralizer] Result type:', typeof result);
    console.log('[BiasNeutralizer] Result length:', typeof result === 'string' ? result.length : 'N/A');
    console.log('[BiasNeutralizer] Result value:', result);

    if (tabId) {
      activeScanControllers.delete(tabId);
    }

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
    
    if (tabId) {
      activeScanControllers.delete(tabId);
    }
  }
}

function handleCancelScan(sender) {
  console.log('[BiasNeutralizer] Cancelling active scan');
  const tabId = sender?.tab?.id;
  if (tabId && activeScanControllers.has(tabId)) {
    activeScanControllers.get(tabId).abort();
    activeScanControllers.delete(tabId);
  }
}

async function performMultiAgentScan(articleText, apiKey, analysisDepth, signal) {
  let thinkingBudget;
  if (analysisDepth === 'deep') {
    // Deep analysis: enable thinking (auto) on Pro
    thinkingBudget = -1;
  } else {
    // Quick scan: 1000 token thinking budget on Flash
    thinkingBudget = 1000;
  }

  console.log('[BiasNeutralizer] Using thinking budget:', thinkingBudget);

  const textToAnalyze = articleText.slice(0, 8000);

  console.log('[BiasNeutralizer] Agent 1: Context analysis...');
  const contextPrompt = `You are a neutral classifier. Do NOT assume bias exists.

Task: Classify genre and extract context. If uncertain, use "Unknown" rather than guessing.

Definitions:
- News: Timely reporting, minimal opinion
- Opinion: Explicit viewpoint/commentary
- Analysis: Explains significance, includes interpretation
- Satire: Humor/irony, not literal
- Academic: Scholarly, citations, formal
- Other: Specify if none fit

Rules:
- Do not judge ideology or search for bias
- Estimate quoted material: count approximate word percentage inside quotation marks
- Low = 0-30%, Medium = 31-60%, High = 61-100%

Output ONLY this JSON (no other text):
{
  "type": "News/Opinion/Analysis/Satire/Academic/Other/Unknown",
  "summary": "EXACTLY TEN WORDS describing main topic",
  "tone": "Neutral/Emotional/Analytical/Mixed",
  "quote_ratio": "Low/Medium/High",
  "quote_percentage": NUMBER_0_TO_100,
  "confidence": "High/Medium/Low"
}

ARTICLE TEXT:
${textToAnalyze}`;

  const contextResponse = await callGemini(apiKey, contextPrompt, thinkingBudget, signal, analysisDepth);
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

Analyze ONLY reporter's narrative (exclude all quoted text).

Flag phrases ONLY if BOTH true:
1. Value-laden (judgmental adjectives/adverbs, insinuating verbs, speculative hedges)
2. A neutral, precise alternative exists

Do NOT flag:
- Precise technical/legal terms ("felony", "GDP contracted")
- Neutral quantifiers backed by facts
- Demonstrably factual descriptors

Require: Provide neutral alternative for each flagged phrase

Output ONLY this JSON:
{
  "loaded_phrases": [
    {
      "phrase": "exact narrative phrase",
      "explanation": "why loaded vs neutral alternative",
      "neutral_alternative": "plainer wording",
      "context_snippet": "30-60 chars surrounding"
    }
  ],
  "neutrality_score": NUMBER_0_TO_10,
  "confidence": "High/Medium/Low",
  "summary": "one sentence assessment"
}

If none: {"loaded_phrases": [], "neutrality_score": 10, "confidence": "High", "summary": "Language is fact-based and neutral."}

TEXT:
${textToAnalyze}`;

  const hunterPrompt = `Context: ${contextData}

Find bias indicators in NARRATIVE ONLY (ignore quotes). Do NOT assume bias exists.

Flag ONLY if falsifiable criteria met:
- Selective framing: Relevant counter-info buried (after para 8) while opposing view leads
- Unbalanced sourcing: >70% of attributions favor one side without comparable scrutiny
- Loaded descriptors: Narrative uses judgmental language without factual basis
- Causality leap: Claims causation without evidence (correlation presented as causation)
- Editorial insertion: Adjectives judging motives/morality

Require: At least 2 independent indicators OR 1 High-strength indicator corroborated by structure

Output ONLY this JSON:
{
  "bias_indicators": [
    {
      "type": "Framing/Sourcing/Language/Causality/Editorial",
      "example": "exact phrase or structural description",
      "explanation": "why this meets criteria above",
      "strength": "Low/Medium/High"
    }
  ],
  "overall_bias": "Strong Left/Lean Left/Center/Lean Right/Strong Right/Unclear",
  "confidence": "High/Medium/Low",
  "evidence_notes": "brief location/paragraph references"
}

Default to "Center" or "Unclear" if evidence insufficient.

TEXT:
${textToAnalyze}`;

  const skepticPrompt = `Context: ${contextData}

Identify genuine balance/quality signals. Do NOT manufacture symmetry or require false balance.

Credit as balanced ONLY if:
- Opposing perspectives are credibly sourced AND proportionate to claim importance
- Transparently communicates uncertainty/limitations
- Strong, checkable attribution provided
- Relevant context (history, data, scope) included
- Acknowledges complexity without oversimplifying

Do NOT require "both sides" if one lacks credible support (e.g., scientific consensus)

Output ONLY this JSON:
{
  "balanced_elements": [
    {
      "type": "Sourcing/Attribution/Context/Nuance/Transparency",
      "example": "exact text or description",
      "explanation": "why this demonstrates quality journalism"
    }
  ],
  "balance_score": NUMBER_0_TO_10,
  "confidence": "High/Medium/Low",
  "strengths": "one sentence on journalistic strengths"
}

If none: {"balanced_elements": [], "balance_score": 0, "confidence": "High", "strengths": "No notable balanced elements found."}

TEXT:
${textToAnalyze}`;

  // Quote Agent: extract direct quotes for weighting
  const quotePrompt = `Context: ${contextData}

Extract ONLY direct quotes. Do NOT infer article bias from quoted content.

Rules:
- Include: Text in quotation marks OR explicitly attributed verbatim speech
- Exclude: Paraphrases, summaries, indirect speech
- Assess: How the article frames each quote (attribution style)
- Note: Loaded language in quotes reflects SOURCE bias, not article bias

Output ONLY this JSON:
{
  "quotes": [
    {
      "text": "exact quoted text",
      "speaker": "name or Unknown",
      "source_bias_cues": ["loaded terms within quote if any"],
      "article_attribution": "Neutral/Endorsing/Skeptical/Balancing",
      "is_countered": true/false
    }
  ],
  "confidence": "High/Medium/Low"
}

If no quotes: {"quotes": [], "confidence": "High"}

TEXT:
${textToAnalyze}`;

  // Deep mode: Add 3 specialized agents for comprehensive analysis
  let sourceDiversityPrompt = '';
  let framingPrompt = '';
  let omissionPrompt = '';

  if (analysisDepth === 'deep') {
    console.log('[BiasNeutralizer] Deep mode: Activating specialized agents');
    
    sourceDiversityPrompt = `Context: ${contextData}

Analyze who gets to speak. Account for story context—not all stories need partisan balance.

Context rule: If topic is non-adversarial (e.g., natural disaster, science consensus), political balance may be "Not Applicable"

Classify sources:
- official (gov/corp/institution)
- expert (academia/research)
- stakeholder (affected community)
- advocacy (NGO/activist)
- partisan_left/partisan_right
- other

Output ONLY this JSON:
{
  "source_breakdown": {
    "official": NUMBER,
    "expert": NUMBER,
    "stakeholder": NUMBER,
    "advocacy": NUMBER,
    "partisan_left": NUMBER,
    "partisan_right": NUMBER,
    "other": NUMBER
  },
  "context_applicability": "Adversarial/Non-Adversarial/Unknown",
  "gender_representation": "Balanced/Male-dominated/Female-dominated/Unknown",
  "positioning": "who appears in lead/close",
  "missing_voices": ["perspectives reasonably relevant but absent"],
  "diversity_score": NUMBER_0_TO_10,
  "confidence": "High/Medium/Low",
  "assessment": "one sentence"
}

List missing_voices ONLY if reasonably relevant given story type.

TEXT:
${textToAnalyze}`;

    framingPrompt = `Context: ${contextData}

Examine story structure. Distinguish editorial judgment from manipulation.

Flag as manipulation ONLY if:
- Headline contradicts body content
- Lead omits essential counter-facts acknowledged later
- Passive voice systematically obscures agents in contested actions
- Causal claims in headline/lead lack support

Do NOT flag standard inverted pyramid (leading with news hook)

Output ONLY this JSON:
{
  "headline_analysis": {
    "tone": "Neutral/Sensational/Misleading/Balanced",
    "matches_content": true/false,
    "explanation": "brief rationale"
  },
  "lead_focus": "what first 3 paragraphs emphasize",
  "buried_information": ["important facts placed after para 5"],
  "voice_patterns": {
    "active_subjects": ["actors named"],
    "passive_obscured": ["agents obscured inappropriately"]
  },
  "manipulation_flags": ["specific reasons if criteria met"],
  "framing_score": NUMBER_0_TO_10,
  "confidence": "High/Medium/Low",
  "assessment": "one sentence"
}

TEXT:
${textToAnalyze}`;

    omissionPrompt = `Context: ${contextData}

Identify omissions ONLY if reasonably expected for story type and length.

Reasonable-to-include test (ALL must be true):
1. Commonly included by competent beat reporting
2. Feasible within typical article length OR materially changes interpretation
3. Publicly available or already alluded to in piece

Output ONLY this JSON:
{
  "missing_context": ["specific items passing test"],
  "unaddressed_counterarguments": ["credible opposing points relevant to claims"],
  "missing_data": ["key stats/datasets typically cited"],
  "unanswered_questions": ["obvious questions raised by piece"],
  "omission_severity": "None/Low/Medium/High",
  "confidence": "High/Medium/Low",
  "assessment": "one sentence"
}

If nothing passes test: {"missing_context": [], "unaddressed_counterarguments": [], "missing_data": [], "unanswered_questions": [], "omission_severity": "None", "confidence": "High", "assessment": "Comprehensive within scope."}

TEXT:
${textToAnalyze}`;
  }

  const quoteResponse = await callGemini(apiKey, quotePrompt, thinkingBudget, signal, analysisDepth);
  const languageResponse = await callGemini(apiKey, languagePrompt, thinkingBudget, signal, analysisDepth);
  const hunterResponse = await callGemini(apiKey, hunterPrompt, thinkingBudget, signal, analysisDepth);
  const skepticResponse = await callGemini(apiKey, skepticPrompt, thinkingBudget, signal, analysisDepth);

  // Deep mode: Execute specialized agents
  let sourceDiversityResponse = '';
  let framingResponse = '';
  let omissionResponse = '';

  if (analysisDepth === 'deep') {
    console.log('[BiasNeutralizer] Executing deep analysis agents...');
    sourceDiversityResponse = await callGemini(apiKey, sourceDiversityPrompt, thinkingBudget, signal, analysisDepth);
    framingResponse = await callGemini(apiKey, framingPrompt, thinkingBudget, signal, analysisDepth);
    omissionResponse = await callGemini(apiKey, omissionPrompt, thinkingBudget, signal, analysisDepth);
    console.log('[BiasNeutralizer] Deep analysis agents complete');
  }

  console.log('[BiasNeutralizer] Analysis agents complete');

  console.log('[BiasNeutralizer] Agent 5: Moderator synthesis...');
  const moderatorPrompt = `You are a neutral synthesizer. Do NOT assume bias exists.

CONTEXT: ${contextData}

AGENT FINDINGS:
Quotes: ${quoteResponse}
Language: ${languageResponse}
Bias Hunter: ${hunterResponse}
Balance Skeptic: ${skepticResponse}
${analysisDepth === 'deep' ? `
DEEP ANALYSIS:
Source Diversity: ${sourceDiversityResponse}
Framing: ${framingResponse}
Omission: ${omissionResponse}
` : ''}

SYNTHESIS RULES:
1. Parse JSON inputs; ignore non-JSON
2. Require ≥2 independent narrative indicators OR 1 High-strength indicator corroborated by Framing/Omission before moving from Center
3. Apply weighting:
   - If ≥70% loaded language is in QUOTES → treat as source bias; lean Center unless framing/manipulation strong
   - If ≥70% in NARRATIVE → consider direction per Hunter + Framing
4. Balance mitigates: raise neutrality one notch if balance_score ≥7 with High confidence
5. Small sample: if <2 narrative findings, default Center/Unclear
6. Default to Center/Unclear when evidence insufficient

OUTPUT EXACT STRUCTURE (no markdown, no agent mentions):

OVERALL BIAS ASSESSMENT
Rating: [Strong Left | Lean Left | Center | Lean Right | Strong Right | Unclear]
Confidence: [High | Medium | Low]
Summary: [2-3 sentences. If quotes drove charged language, state it. ${analysisDepth === 'deep' ? 'In deep mode, mention source/framing if relevant.' : ''}]

KEY FINDINGS
- [Finding about REPORTING, not quotes]
- [Another finding about journalistic choices]
- [Third if significant]
${analysisDepth === 'deep' ? '- [Source diversity or framing issue if found]\n- [Omission issue if significant]' : ''}

BALANCED ELEMENTS
- [Neutral/positive aspect]
- [Another if found]

${analysisDepth === 'deep' ? `DEEP ANALYSIS INSIGHTS
- [Source diversity finding]
- [Framing finding]
- [Omission finding if significant]

` : ''}METHODOLOGY NOTE
This separates source bias (quotes) from journalistic bias (narrative/structure). Defaults to Center/Unclear without adequate evidence.

CRITICAL: Keep under ${analysisDepth === 'deep' ? '400' : '300'} words. Base on evidence only.`;

  const moderatorResponse = await callGemini(apiKey, moderatorPrompt, thinkingBudget, signal, analysisDepth);
  
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
