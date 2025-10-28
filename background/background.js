/**

 * BiasNeutralizer Background Service Worker

 * Manages cloud-based AI analysis with multi-agent system

 */

import { AgentPrompts } from '../shared/prompts-deep-cloud.js';
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

// ========== GROUNDING COORDINATOR ==========
// Generates strategic search queries and calls Gemini with Google Search tool
// to provide real-time grounded context for bias analysis

/**
 * Main coordinator - orchestrates grounding with retry logic
 * @param {Object} articleData - { title, text, url }
 * @param {string} apiKey - Gemini API key
 * @param {string} analysisDepth - 'quick' or 'deep'
 * @param {boolean} isRetry - Whether this is a retry attempt (reduced queries)
 * @returns {Object|null} - { contextText, citations, insights } or null on failure
 */
async function coordinateGrounding(articleData, apiKey, analysisDepth, isRetry = false) {
  const logPrefix = '[Grounding]';
  try {
    console.log(`${logPrefix} Starting coordinator for: ${articleData.title}`);
    
    // Generate queries with AI or fallback
    let queries;
    let queryMethod = 'AI';
    
    if (isRetry) {
      // On retry, use fast fallback to save time
      console.log(`${logPrefix} Retry mode: using algorithmic fallback`);
      queries = generateSearchQueriesFallback(articleData).slice(0, 3);
      queryMethod = 'algorithmic (retry)';
    } else {
      // First attempt: try AI for intelligent queries
      queries = await generateQueriesWithAI(articleData, apiKey);
      
      if (!queries || queries.length === 0) {
        // AI failed, use fallback
        console.log(`${logPrefix} Using algorithmic fallback`);
        queries = generateSearchQueriesFallback(articleData);
        queryMethod = 'algorithmic (fallback)';
      }
    }
    
    console.log(`${logPrefix} Generated ${queries.length} queries (${queryMethod}):`);
    queries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
    
    // Execute searches
    const startTime = Date.now();
    const groundedResults = await executeGroundedSearches(queries, apiKey, analysisDepth);
    const searchTime = Date.now() - startTime;
    
    // Format context for tribunal
    const groundingContext = formatGroundingContext(groundedResults);
    
    // Calculate quality metrics
    const totalCitations = groundingContext.citations.length;
    const uniqueSources = new Set(groundingContext.citations.map(c => {
      try {
        return new URL(c.url).hostname;
      } catch (e) {
        return c.url;
      }
    })).size;
    const avgCitationsPerQuery = (totalCitations / queries.length).toFixed(1);
    
    console.log(`${logPrefix} Search complete in ${(searchTime / 1000).toFixed(1)}s:`);
    console.log(`${logPrefix}   - Total citations: ${totalCitations}`);
    console.log(`${logPrefix}   - Unique sources: ${uniqueSources}`);
    console.log(`${logPrefix}   - Avg per query: ${avgCitationsPerQuery}`);
    console.log(`${logPrefix}   - Method: ${queryMethod}`);
    
    return groundingContext;
    
  } catch (error) {
    console.error(`${logPrefix} Failed:`, error);
    return null;
  }
}

/**
 * Create prompt for AI query generation
 * @param {Object} articleData - { title, text, url }
 * @returns {string} - Prompt for AI
 */
function createQueryGenerationPrompt(articleData, options = {}) {
  const safeData = articleData || {};
  const { maxChars = 8000 } = options;
  const title = typeof safeData.title === 'string' ? safeData.title : '';
  const text = typeof safeData.text === 'string' ? safeData.text : '';
  const url = typeof safeData.url === 'string' ? safeData.url : '';
  
  // Limit text to the requested number of characters to control token usage
  const articleText = text.slice(0, maxChars);
  const snippetNotice = text.length > maxChars
    ? `\n(Note: content truncated to first ${maxChars} characters for prompt efficiency.)`
    : '';
  
  // Extract domain for context
  let domain = 'unknown';
  if (url) {
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      // Invalid URL
    }
  }
  
  return `You are an expert fact-checking research assistant. Your task is to analyze a news article and generate optimal search queries for verification.

ARTICLE INFORMATION:
Title: ${title}
Source: ${domain}
Content (first ${articleText.length} characters):
${articleText}
${snippetNotice}

YOUR TASK:
Generate 6-8 strategic Google search queries that will help verify the accuracy of this article's claims.

QUERY GENERATION GUIDELINES:

1. IDENTIFY KEY CLAIMS
   - Find 3-4 specific factual claims that can be verified
   - Focus on: numbers/statistics, event descriptions, quotes, policy details
   - Ignore opinions or subjective statements

2. QUERY TYPES (aim for diverse coverage):
   a) CLAIM VERIFICATION (3-4 queries): Turn specific factual claims into searches
      - Include specific numbers, dates, names from the claim
      - Add year "2025" for time-sensitive topics
      - Use official terminology when relevant
      
   b) SOURCE VERIFICATION (1-2 queries): Check people/organizations quoted
      - Search for the person/org + their statement/claim
      - Include context (their role, organization)
      
   c) CONTEXT QUERIES (1-2 queries): Broader background information
      - Related developments, policies, or events
      - Expert analysis or official data
      
   d) BIAS CHECK (1 query): Assess source credibility
      - Format: "${domain} bias rating media bias"

3. QUERY QUALITY CHECKLIST:
   - Specific: include names, numbers, dates
   - Searchable: match how people actually search (no questions)
   - Verifiable: likely to surface authoritative sources
   - Time-aware: include the year 2025 for current claims
   - Concise: keep queries roughly 3-8 words
   - Avoid copying raw sentences from the article
   - Avoid vague words like "news", "updates", "information"
   - Avoid question formats; use declarative phrasing

4. ADAPT TO ARTICLE TYPE:
   - News: Verify events, statistics, quotes
   - Opinion: Only verify cited facts, not opinions
   - Press release: High skepticism, verify all claims
   - Analysis: Check if based on accurate facts

EXAMPLES OF GOOD VS BAD QUERIES:

GOOD:
- "DHS AI systems immigration enforcement 2025 official count"
- "border crossing statistics June 2025 CBP data"
- "One Big Beautiful Bill immigration legislation 2025"
- "Kurt Volker Trump foreign policy statements 2025"

BAD:
- "Trump AI plan news" (too vague)
- "What is the border situation?" (question format)
- "verify Steps have been taken, however..." (raw article text)
- "immigration information updates" (generic, not searchable)

OUTPUT FORMAT:
Return ONLY valid JSON (no markdown, no explanation):

{
  "queries": [
    {
      "query": "exact search query string",
      "purpose": "Claim verification | Source check | Context | Bias assessment",
      "reasoning": "brief why this query matters",
      "priority": "high | medium | low"
    }
  ],
  "article_type": "News | Opinion | Analysis | Press Release",
  "key_claims_identified": ["list of 3-4 main factual claims"],
  "overall_strategy": "one sentence explaining query strategy"
}

Generate exactly 6-8 queries. Prioritize high-priority queries first.`;
}

/**
 * Generate queries using AI (gemini-flash-lite-latest)
 * @param {Object} articleData - { title, text, url }
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<string[]>} - Array of search queries
 */
async function generateQueriesWithAI(articleData, apiKey) {
  const logPrefix = '[Query Agent]';
  const attemptPlan = [
    { label: 'primary', maxChars: 8000 },
    { label: 'retry-shortened', maxChars: 4000 }
  ];
  const priorityOrder = { high: 3, medium: 2, low: 1 };
  let lastError = null;

  const requestFromAI = async ({ label, maxChars }) => {
    const availableText = typeof articleData?.text === 'string' ? articleData.text : '';
    const inspectedChars = Math.min(availableText.length, maxChars);
    console.log(`${logPrefix} Attempt ${label}: analyzing first ${inspectedChars} characters (max ${maxChars}).`);

    const prompt = createQueryGenerationPrompt(articleData, { maxChars });

    const timeoutMs = 5000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`AI query generation timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    const aiResponsePromise = callGemini(
      apiKey,
      prompt,
      0, // thinking budget
      null,
      'quick',
      { normalize: false, agentRole: 'queryGenerator' }
    );

    const aiResponse = await Promise.race([aiResponsePromise, timeoutPromise]);

    if (!aiResponse || typeof aiResponse !== 'string') {
      throw new Error('AI returned empty or non-text response');
    }

    let cleanResponse = aiResponse.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    const firstBrace = cleanResponse.indexOf('{');
    const lastBrace = cleanResponse.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleanResponse = cleanResponse.slice(firstBrace, lastBrace + 1);
    }

    let queryData;
    try {
      queryData = JSON.parse(cleanResponse);
    } catch (parseError) {
      console.error(`${logPrefix} Attempt ${label} JSON parse failed:`, parseError);
      console.error(`${logPrefix} Attempt ${label} raw response (first 500 chars):`, aiResponse.substring(0, 500));
      throw new Error('Invalid JSON response from AI');
    }

    if (!Array.isArray(queryData?.queries)) {
      throw new Error('AI response missing queries array');
    }

    const structuredQueries = queryData.queries.map((entry, index) => {
      const rawQuery = typeof entry?.query === 'string' ? entry.query.trim() : '';
      const priority = typeof entry?.priority === 'string' ? entry.priority.toLowerCase() : 'medium';
      const purpose = typeof entry?.purpose === 'string' ? entry.purpose.trim() : 'Unknown';
      const reasoning = typeof entry?.reasoning === 'string' ? entry.reasoning.trim() : '';
      return { rawQuery, priority, purpose, reasoning, index };
    }).filter(q => q.rawQuery.length > 0);

    if (structuredQueries.length < 6) {
      throw new Error(`AI produced ${structuredQueries.length} usable queries (need 6-8).`);
    }

    structuredQueries.sort((a, b) => {
      return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0) || a.index - b.index;
    });

    const deduped = [];
    const seen = new Set();
    for (const item of structuredQueries) {
      const normalized = item.rawQuery.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        deduped.push(item);
      }
    }

    const finalItems = deduped.slice(0, 8);

    if (finalItems.length < 6) {
      throw new Error(`AI produced only ${finalItems.length} unique queries after deduplication.`);
    }

    const priorityBreakdown = finalItems.reduce((acc, item) => {
      const bucket = priorityOrder[item.priority] ? item.priority : 'medium';
      acc[bucket] = (acc[bucket] || 0) + 1;
      return acc;
    }, {});

    console.log(`${logPrefix} Attempt ${label} succeeded with ${finalItems.length} queries.`);
    console.log(`${logPrefix} Article type: ${queryData.article_type || 'Unknown'}`);
    console.log(`${logPrefix} Strategy: ${queryData.overall_strategy || 'N/A'}`);
    if (Array.isArray(queryData.key_claims_identified)) {
      console.log(`${logPrefix} Key claims identified: ${queryData.key_claims_identified.length}`);
    }
    console.log(`${logPrefix} Priority breakdown: ` +
      `high=${priorityBreakdown.high || 0}, medium=${priorityBreakdown.medium || 0}, low=${priorityBreakdown.low || 0}`);

    return finalItems.map(item => item.rawQuery);
  };

  for (const attempt of attemptPlan) {
    try {
      const queries = await requestFromAI(attempt);
      if (queries && queries.length) {
        return queries;
      }
    } catch (error) {
      lastError = error;
      console.error(`${logPrefix} Attempt ${attempt.label} failed:`, error.message);
    }
  }

  if (lastError) {
    console.error(`${logPrefix} AI query generation failed after retries:`, lastError.message);
  }
  console.log(`${logPrefix} Falling back to algorithmic query generation`);
  return null;
}

/**
 * Generate 6-8 strategic search queries using hybrid heuristics (FALLBACK)
 * @param {Object} articleData - { title, text, url }
 * @returns {string[]} - Array of search queries
 */
function generateSearchQueriesFallback(articleData) {
  const queries = [];
  const { title, text, url } = articleData;
  
  // 1. Title entities - Extract key entities from title
  const titleEntities = extractEntitiesFromText(title);
  if (titleEntities.length > 0) {
    queries.push(`${titleEntities.join(' ')} latest news 2025`);
  }
  
  // 2. Topic context - Main topic from title
  const topic = extractTopicFromTitle(title);
  if (topic) {
    queries.push(`${topic} 2025 developments`);
  }
  
  // 3. Numbers/statistics - Find sentences with numbers
  const statistics = extractStatistics(text);
  statistics.forEach(stat => {
    queries.push(`verify ${stat}`);
  });
  
  // 4. Quoted sources - Extract people/orgs mentioned
  const sources = extractQuotedSources(text);
  sources.forEach(source => {
    queries.push(`${source} recent statements 2025`);
  });
  
  // 5. Source credibility - Domain bias rating
  if (url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      queries.push(`${hostname} bias rating media bias`);
    } catch (e) {
      // Invalid URL, skip
    }
  }
  
  // 6. Additional context query if we have room
  if (titleEntities.length > 0 && queries.length < 8) {
    queries.push(`${titleEntities.join(' ')} expert analysis`);
  }
  
  // Deduplicate and limit to 8
  const uniqueQueries = [...new Set(queries)];
  return uniqueQueries.slice(0, 8);
}

/**
 * Execute all search queries with Gemini grounding
 * @param {string[]} queries - Search queries
 * @param {string} apiKey - Gemini API key
 * @param {string} analysisDepth - 'quick' or 'deep'
 * @returns {Object} - { insights: array, citations: array }
 */
async function executeGroundedSearches(queries, apiKey, analysisDepth) {
  const logPrefix = '[Grounding]';
  const allInsights = [];
  const allCitations = [];
  
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    console.log(`${logPrefix} Query ${i + 1}/${queries.length}: ${query}`);
    
    try {
      const result = await callGeminiWithGrounding(query, apiKey, analysisDepth);
      
      if (result && result.text) {
        allInsights.push({
          query: query,
          answer: result.text,
          sources: result.groundingMetadata ? extractCitations(result.groundingMetadata) : []
        });
        
        // Collect citations
        if (result.groundingMetadata) {
          const citations = extractCitations(result.groundingMetadata);
          allCitations.push(...citations);
          console.log(`${logPrefix} Got ${citations.length} citations from query`);
        }
      }
    } catch (error) {
      console.warn(`${logPrefix} Query ${i + 1} failed:`, error.message);
      // Continue to next query
    }
    
    // Add 1-second delay between each query (only in deep mode for rate limiting)
    if (i < queries.length - 1 && analysisDepth === 'deep') {
      console.log(`${logPrefix} [Deep Mode] Waiting 1 second before next query...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Deduplicate citations
  const uniqueCitations = deduplicateCitations(allCitations);
  console.log(`${logPrefix} Total citations: ${allCitations.length}, unique: ${uniqueCitations.length}`);
  
  return {
    insights: allInsights,
    citations: uniqueCitations
  };
}

/**
 * Single Gemini API call with google_search tool
 * @param {string} query - Search query
 * @param {string} apiKey - Gemini API key
 * @param {string} analysisDepth - 'quick' or 'deep'
 * @returns {Object} - { text, groundingMetadata }
 */
async function callGeminiWithGrounding(query, apiKey, analysisDepth) {
  const logPrefix = '[Grounding]';
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  
  // Build generation config
  const generationConfig = {
    temperature: 0.3,
    maxOutputTokens: 500
  };
  
  // Add thinking budget for deep analysis (use thinkingBudget, not enabled)
  if (analysisDepth === 'deep') {
    generationConfig.thinkingConfig = {
      thinkingBudget: -1  // -1 means unlimited thinking for deep analysis
    };
  }
  
  const requestBody = {
    contents: [{
      parts: [{
        text: `Research query: ${query}\n\nProvide a concise, factual answer with current information.`
      }]
    }],
    tools: [{ google_search: {} }],  // Fixed: use snake_case for REST API
    generationConfig: generationConfig
  };
  
  // First attempt with thinkingConfig (if deep mode)
  try {
    const response = await fetch(`${endpoint}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      
      // Check if this is a thinkingConfig error and we haven't retried yet
      if (response.status === 400 && /thinking_config/i.test(errorText) && analysisDepth === 'deep') {
        console.log(`${logPrefix} Retrying without thinkingConfig due to 400 error`);
        
        // Remove thinkingConfig and retry
        delete requestBody.generationConfig.thinkingConfig;
        
        const retryResponse = await fetch(`${endpoint}?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });
        
        if (!retryResponse.ok) {
          const retryErrorText = await retryResponse.text();
          throw new Error(`Gemini API error: ${retryResponse.status} - ${retryErrorText}`);
        }
        
        const retryData = await retryResponse.json();
        const text = retryData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const groundingMetadata = retryData.candidates?.[0]?.groundingMetadata || null;
        
        return {
          text: text,
          groundingMetadata: groundingMetadata
        };
      }
      
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    // Extract response text and grounding metadata
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const groundingMetadata = data.candidates?.[0]?.groundingMetadata || null;
    
    return {
      text: text,
      groundingMetadata: groundingMetadata
    };
  } catch (error) {
    // If it's a network error or other non-400 error, propagate it
    if (error.message && !error.message.includes('Gemini API error')) {
      throw new Error(`Gemini grounding request failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Extract citations from Gemini's groundingMetadata
 * @param {Object} groundingMetadata - Metadata from Gemini response
 * @returns {Array} - Array of citation objects
 */
function extractCitations(groundingMetadata) {
  const citations = [];
  
  if (!groundingMetadata || !groundingMetadata.groundingChunks) {
    return citations;
  }
  
  let index = 1;
  for (const chunk of groundingMetadata.groundingChunks) {
    if (chunk.web) {
      citations.push({
        index: index++,
        title: chunk.web.title || 'Untitled',
        url: chunk.web.uri || '',
        snippet: chunk.web.snippet || ''
      });
    }
  }
  
  return citations;
}

/**
 * Remove duplicate citations by URL
 * @param {Array} citations - Array of citation objects
 * @returns {Array} - Deduplicated citations
 */
function deduplicateCitations(citations) {
  const seen = new Set();
  const unique = [];
  
  for (const citation of citations) {
    if (citation.url && !seen.has(citation.url)) {
      seen.add(citation.url);
      // Reassign index after deduplication
      citation.index = unique.length + 1;
      unique.push(citation);
    }
  }
  
  return unique;
}

/**
 * Format insights and citations into context text for tribunal
 * @param {Object} groundedResults - { insights, citations }
 * @returns {Object} - { contextText, citations, insights }
 */
function formatGroundingContext(groundedResults) {
  const { insights, citations } = groundedResults;
  
  let contextText = '--- REAL-TIME GROUNDED CONTEXT (from Google Search) ---\n\n';
  
  // Add insights
  insights.forEach((insight, i) => {
    contextText += `${i + 1}. ${insight.query}\n`;
    contextText += `   ${insight.answer}\n`;
    if (insight.sources && insight.sources.length > 0) {
      const sourceNames = insight.sources.map(s => s.title).join(', ');
      contextText += `   Sources: ${sourceNames}\n`;
    }
    contextText += '\n';
  });
  
  // Add citations section
  if (citations.length > 0) {
    contextText += 'CITATIONS:\n';
    citations.forEach(citation => {
      contextText += `[${citation.index}] ${citation.title} - ${citation.url}\n`;
    });
    contextText += '\n';
  }
  
  contextText += '--- END GROUNDED CONTEXT ---\n\n';
  contextText += 'INSTRUCTION: Use the above real-time context to inform your analysis. Reference citations where relevant.\n';
  
  return {
    contextText: contextText,
    citations: citations,
    insights: insights
  };
}

// Helper functions for query generation

/**
 * Extract entities from text (capitalized phrases)
 * @param {string} text - Text to extract from
 * @returns {string[]} - Array of entity phrases
 */
function extractEntitiesFromText(text) {
  const entities = [];
  
  // Match capitalized phrases (2-4 words)
  const regex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
  let match;
  
  const foundEntities = [];
  while ((match = regex.exec(text)) !== null) {
    foundEntities.push(match[1]);
  }
  
  // Count frequency
  const frequency = {};
  foundEntities.forEach(entity => {
    frequency[entity] = (frequency[entity] || 0) + 1;
  });
  
  // Sort by frequency and take top 3
  const sorted = Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(entry => entry[0]);
  
  return sorted;
}

/**
 * Extract statistics from text (sentences with numbers)
 * @param {string} text - Text to extract from
 * @returns {string[]} - Array of statistic phrases
 */
function extractStatistics(text) {
  const statistics = [];
  
  // Split into sentences
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  // Find sentences with numbers or percentages
  const numberSentences = sentences.filter(sentence => {
    return /\d+/.test(sentence) && sentence.length < 200;
  });
  
  // Take first 2, truncate to 80 chars
  return numberSentences
    .slice(0, 2)
    .map(s => {
      const trimmed = s.trim();
      return trimmed.length > 80 ? trimmed.substring(0, 77) + '...' : trimmed;
    });
}

/**
 * Extract quoted sources from text
 * @param {string} text - Text to extract from
 * @returns {string[]} - Array of source names
 */
function extractQuotedSources(text) {
  const sources = [];
  
  // Match quoted text with names
  const quoteRegex = /"([^"]+)"/g;
  let match;
  
  const quotes = [];
  while ((match = quoteRegex.exec(text)) !== null) {
    quotes.push(match[1]);
  }
  
  // Look for names near quotes (capitalized words)
  const nameRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+))\b/g;
  const names = [];
  let nameMatch;
  
  while ((nameMatch = nameRegex.exec(text)) !== null) {
    names.push(nameMatch[1]);
  }
  
  // Take first 2 unique names
  const uniqueNames = [...new Set(names)];
  return uniqueNames.slice(0, 2);
}

/**
 * Extract topic from title (remove common words)
 * @param {string} title - Article title
 * @returns {string} - Topic keywords
 */
function extractTopicFromTitle(title) {
  const commonWords = ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'will', 'would', 'could', 'should', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as', 'and', 'or', 'but'];
  
  const words = title.toLowerCase().split(/\s+/);
  const filteredWords = words.filter(word => {
    return word.length > 2 && !commonWords.includes(word);
  });
  
  // Take 2-4 most significant words
  return filteredWords.slice(0, 4).join(' ');
}

// ========== END GROUNDING COORDINATOR ==========

/**
 * Inject grounding context into agent prompts
 * @param {string} basePrompt - The agent's base prompt
 * @param {Object|null} groundingContext - { contextText, citations, insights }
 * @returns {string} - Modified prompt with grounding injected
 */
function injectGroundingIntoPrompt(basePrompt, groundingContext) {
  // If no grounding context, return original prompt
  if (!groundingContext || !groundingContext.contextText || typeof groundingContext.contextText !== 'string') {
    return basePrompt;
  }
  
  // Check if context is meaningful (has citations)
  if (!groundingContext.citations || groundingContext.citations.length === 0) {
    return basePrompt;
  }
  
  // Find where to inject context (after system instructions, before article text)
  // Look for <article_text> tag or similar markers
  const articleTextMarker = '<article_text>';
  
  if (basePrompt.includes(articleTextMarker)) {
    // Inject BEFORE <article_text> tag
    return basePrompt.replace(
      articleTextMarker,
      `\n${groundingContext.contextText}\n\n${articleTextMarker}`
    );
  } else {
    // If no marker found, prepend to the entire prompt
    // This ensures context is available even if prompt structure varies
    return `${groundingContext.contextText}\n\n${basePrompt}`;
  }
}

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

        // Add 1-second delay for Gemini 2.5 models (rate limiting)
        if (model.includes('2.5')) {
          bgLog(`Rate limiting: Waiting 1 second after ${model} call`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

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

    // === REAL-TIME GROUNDING COORDINATOR ===
    // Check if real-time grounding is enabled
    let groundingContext = null;
    const realtimeGrounding = message.realtimeGrounding === true;
    
    if (realtimeGrounding && apiKey) {
      bgLog('Real-time grounding enabled, starting coordinator...');
      
      // Prepare article data for grounding
      const articleData = {
        title: articleContent.title || 'Untitled Article',
        text: articleContent.fullText,
        url: articleContent.url || ''
      };
      
      // First attempt
      try {
        groundingContext = await coordinateGrounding(articleData, apiKey, analysisDepth, false);
        
        if (groundingContext && groundingContext.citations) {
          bgLog(`[Grounding] Success: ${groundingContext.citations.length} citations collected`);
        }
      } catch (error) {
        bgWarn('[Grounding] First attempt failed, retrying with reduced queries...', error.message);
        
        // Retry with reduced queries
        try {
          groundingContext = await coordinateGrounding(articleData, apiKey, analysisDepth, true);
          
          if (groundingContext && groundingContext.citations) {
            bgLog(`[Grounding] Retry success: ${groundingContext.citations.length} citations collected`);
          }
        } catch (retryError) {
          bgError('[Grounding] Failed after retry, continuing without grounding:', retryError.message);
          groundingContext = null;
        }
      }
      
      if (!groundingContext) {
        bgWarn('[Grounding] No grounding context available, proceeding with standard analysis');
      }
    }
    // === END REAL-TIME GROUNDING ===

    // Add 7-second delay after grounding completes before proceeding to analysis agents (only in deep mode)
    if (realtimeGrounding && analysisDepth === 'deep') {
      bgLog('[Grounding] [Deep Mode] Waiting 7 seconds before proceeding to analysis agents...');
      await new Promise(resolve => setTimeout(resolve, 7000));
      bgLog('[Grounding] [Deep Mode] Proceeding to analysis agents');
    }

    const controller = new AbortController();

    if (tabId) {

      activeScanControllers.set(tabId, controller);

    }

    const result = await performMultiAgentScan(

      articleContent.fullText,

      apiKey,

      analysisDepth,

      controller.signal,

      groundingContext

    );

    bgLog('Scan result received from API');

    bgLog('Result type:', typeof result);

    bgLog('Result length:', typeof result === 'string' ? result.length : 'N/A');

    bgLog('Result value:', result);

    // Log grounding metadata being sent
    bgLog('[Background] Saving results with grounding:', {
      groundingEnabled: result.groundingEnabled,
      citationCount: result.citations?.length || 0,
      insightCount: result.groundingInsights?.length || 0
    });

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


async function performMultiAgentScan(articleText, apiKey, analysisDepth, signal, groundingContext = null) {

  // Log grounding status
  const hasGrounding = groundingContext && groundingContext.citations && groundingContext.citations.length > 0;
  bgLog(`[Tribunal] Starting with grounding: ${hasGrounding}`);
  if (hasGrounding) {
    bgLog(`[Tribunal] Injecting grounded context (${groundingContext.citations.length} citations) into agent prompts`);
  }

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

  const contextPrompt = injectGroundingIntoPrompt(
    Prompts.createContextPrompt(textToAnalyze),
    groundingContext
  );

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

  const languagePrompt = injectGroundingIntoPrompt(
    Prompts.createLanguagePrompt(contextData, textToAnalyze),
    groundingContext
  );

  const hunterPrompt = injectGroundingIntoPrompt(
    Prompts.createHunterPrompt(contextData, textToAnalyze),
    groundingContext
  );

  const skepticPrompt = injectGroundingIntoPrompt(
    Prompts.createSkepticPrompt(contextData, textToAnalyze),
    groundingContext
  );

  // Quote Agent: extract direct quotes for weighting

  const quotePrompt = injectGroundingIntoPrompt(
    Prompts.createQuotePrompt(contextData, textToAnalyze),
    groundingContext
  );

  // Deep mode: Add 3 specialized agents for comprehensive analysis

  let sourceDiversityPrompt = '';

  let framingPrompt = '';

  let omissionPrompt = '';

  if (analysisDepth === 'deep') {

    bgLog('Deep mode: Activating specialized agents');

    sourceDiversityPrompt = injectGroundingIntoPrompt(
      AgentPrompts.createSourceDiversityPrompt(textToAnalyze),
      groundingContext
    );

    framingPrompt = injectGroundingIntoPrompt(
      AgentPrompts.createFramingPrompt(textToAnalyze),
      groundingContext
    );

    omissionPrompt = injectGroundingIntoPrompt(
      AgentPrompts.createOmissionPrompt(contextData, textToAnalyze),
      groundingContext
    );

  }

  // Execute agents with staggered delays for deep mode (2.5-pro) to prevent rate limiting
  let quoteResponse, languageResponse, hunterResponse, skepticResponse;

  if (analysisDepth === 'deep') {
    bgLog('Deep mode: Starting agents with 2-second delays between calls...');
    
    quoteResponse = await callGemini(apiKey, quotePrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'quote' });
    bgLog('Quote agent complete, waiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    languageResponse = await callGemini(apiKey, languagePrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'language' });
    bgLog('Language agent complete, waiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    hunterResponse = await callGemini(apiKey, hunterPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'hunter' });
    bgLog('Hunter agent complete, waiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    skepticResponse = await callGemini(apiKey, skepticPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'skeptic' });
    bgLog('Skeptic agent complete');
  } else {
    // Quick mode: Execute in parallel (no rate limit issues with flash models)
    bgLog('Quick mode: Executing agents in parallel...');
    [quoteResponse, languageResponse, hunterResponse, skepticResponse] = await Promise.all([
      callGemini(apiKey, quotePrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'quote' }),
      callGemini(apiKey, languagePrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'language' }),
      callGemini(apiKey, hunterPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'hunter' }),
      callGemini(apiKey, skepticPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'skeptic' })
    ]);
  }

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

    bgLog('Executing deep analysis specialized agents with delays...');

    sourceDiversityResponse = await callGemini(apiKey, sourceDiversityPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'sourceDiversity' });
    bgLog('Source Diversity agent complete, waiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    framingResponse = await callGemini(apiKey, framingPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'framing' });
    bgLog('Framing agent complete, waiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    omissionResponse = await callGemini(apiKey, omissionPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'omission' });

    bgLog('Deep analysis specialized agents complete');

  }

  bgLog('Phase 1: Initial Evidence Gathering complete');

  // ==================== PHASE 2: CROSS-EXAMINATION & CHALLENGE ====================

  bgLog('Phase 2: Tribunal Cross-Examination starting...');

  // Agent 1: Prosecutor - Build the case for bias

  bgLog('Agent 5: Prosecutor building case...');

  const prosecutorPrompt = injectGroundingIntoPrompt(
    Prompts.createProsecutorPrompt(
      contextData,
      languageJSON,
      hunterJSON,
      skepticJSON,
      quoteJSON
    ),
    groundingContext
  );

  const prosecutorResponse = await callGemini(apiKey, prosecutorPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'prosecutor' });

  const prosecutorJSON = safeJSON(prosecutorResponse, { charges: [], prosecution_summary: 'No charges filed.', confidence: 'High' });

  bgLog('Prosecutor complete. Charges filed:', prosecutorJSON.charges?.length || 0);

  // Agent 2 & 3: Defense and Investigator

  const defensePrompt = injectGroundingIntoPrompt(
    Prompts.createDefensePrompt(
      prosecutorJSON,
      contextData,
      languageJSON,
      hunterJSON,
      skepticJSON,
      quoteJSON
    ),
    groundingContext
  );

  const investigatorPrompt = injectGroundingIntoPrompt(
    Prompts.createInvestigatorPrompt(
      prosecutorJSON,
      textToAnalyze
    ),
    groundingContext
  );

  let defenseResponse, investigatorResponse;

  if (analysisDepth === 'deep') {
    bgLog('Agents 6-7: Defense and Investigator with delays...');
    
    defenseResponse = await callGemini(apiKey, defensePrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'defense' });
    bgLog('Defense agent complete, waiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    investigatorResponse = await callGemini(apiKey, investigatorPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'investigator' });
  } else {
    bgLog('Agents 6-7: Defense and Investigator running in parallel...');
    [defenseResponse, investigatorResponse] = await Promise.all([
      callGemini(apiKey, defensePrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'defense' }),
      callGemini(apiKey, investigatorPrompt, thinkingBudget, signal, analysisDepth, { normalize: false, agentRole: 'investigator' })
    ]);
  }

  const defenseJSON = safeJSON(defenseResponse, { rebuttals: [], defense_summary: 'No rebuttals needed.', confidence: 'High' });

  const investigatorJSON = safeJSON(investigatorResponse, { verified_facts: [], investigator_summary: 'No structural claims to investigate.', overall_confidence: 'High' });

  bgLog('Defense complete. Rebuttals filed:', defenseJSON.rebuttals?.length || 0);

  bgLog('Investigator complete. Facts verified:', investigatorJSON.verified_facts?.length || 0);

  bgLog('Phase 2: Cross-Examination complete');

  // ==================== PHASE 3: JUDICIAL SYNTHESIS ====================

  bgLog('Phase 3: Judge rendering final verdict...');

  // Agent 8: Judge - Final adjudication using tribunal debate

  const judgePrompt = injectGroundingIntoPrompt(
    Prompts.createJudgePrompt(
      prosecutorJSON,
      defenseJSON,
      investigatorJSON,
      contextData
    ),
    groundingContext
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

  // Log final grounding status
  if (hasGrounding) {
    bgLog(`[Tribunal] Complete with ${groundingContext.citations.length} citations stored`);
  }

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

    extractedConfidence: correctConfidence,

    // Include grounding metadata when available
    groundingEnabled: hasGrounding,
    citations: hasGrounding ? groundingContext.citations : [],
    groundingInsights: hasGrounding ? groundingContext.insights : []

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



