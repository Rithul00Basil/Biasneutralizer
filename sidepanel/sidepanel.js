/**
 * BiasNeutralizer Side Panel Controller
 * Manages article scanning, AI analysis, and user interactions
 */
import { AgentPrompts } from '../shared/prompts.js';
import { OnDevicePrompts } from '../shared/prompt-quick-ondevice.js';

const SP_LOG_PREFIX = '[Sidepanel]';
const spLog = (...args) => console.log(SP_LOG_PREFIX, ...args);
const spWarn = (...args) => console.warn(SP_LOG_PREFIX, ...args);
const spError = (...args) => console.error(SP_LOG_PREFIX, ...args);
document.addEventListener('DOMContentLoaded', async () => {
  // === STEP 1: CHECK SETUP COMPLETION (FIRST-TIME SETUP FLOW) ===
  spLog('Checking setup completion...');
  
  try {
    const storage = await new Promise((resolve) => {
      chrome.storage.local.get(['hasCompletedSetup'], (result) => {
        resolve(result);
      });
    });

    // If setup not completed, redirect to setup page
    if (!storage.hasCompletedSetup) {
      spLog('Setup not completed, redirecting to setup page');
      window.location.href = chrome.runtime.getURL('setup/setup.html');
      return; // Stop execution
    }

    spLog('Setup completed, continuing with normal flow');
  } catch (error) {
    spError('Error checking setup status:', error);
    // On error, continue with normal flow (fail-safe)
  }

  // === DEPRECATED: Rating validation now handled in background.js ===
  // This function is kept for backward compatibility but is no longer called
  // All normalization and extraction happens at source (background.js)
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
  function parseJSONish(raw, fallback = null) {
    try {
      if (typeof raw !== 'string') return fallback;
      
      // Strip common fences/backticks that LLMs add
      let cleaned = raw.replace(/^\s*```(?:json)?\s*/i, '')
                       .replace(/\s*```\s*$/i, '')
                       .trim();
      
      // Fallback: extract first {...} block if extra text remains
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        cleaned = match[0];
      }
      
      return JSON.parse(cleaned);
    } catch (error) {
      spWarn('JSON parse failed:', error.message, 'Raw:', raw?.slice(0, 200));
      return fallback;
    }
  }

  function countWords(text) {
    return (text || '').trim().split(/\s+/).filter(Boolean).length;
  }

  /**
   * Find all occurrences of a phrase in text (case-insensitive)
   * Returns array of [start, end] position tuples
   */
  function findAllOccurrences(text, needle) {
    const positions = [];
    if (!text || !needle) return positions;
    
    const normalizedNeedle = needle.trim();
    // Escape special regex characters
    const escaped = normalizedNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    
    let match;
    while ((match = regex.exec(text)) !== null) {
      positions.push([match.index, match.index + match[0].length]);
    }
    
    return positions;
  }

  /**
   * Verify phrases exist in article text and add positions
   * Returns only phrases that were actually found
   */
  function verifyAndLocatePhrases(phrases, articleText) {
    if (!Array.isArray(phrases) || !articleText) return [];
    
    return phrases
      .map(phrase => ({
        ...phrase,
        positions: findAllOccurrences(articleText, phrase.phrase || '')
      }))
      .filter(phrase => phrase.positions && phrase.positions.length > 0);
  }

  /**
   * Deduplicate phrases by lowercase phrase text
   */
  function deduplicatePhrases(phrases) {
    if (!Array.isArray(phrases)) return [];
    const seen = new Map();
    
    for (const phrase of phrases) {
      const key = (phrase.phrase || '').toLowerCase().trim();
      if (key && !seen.has(key)) {
        seen.set(key, phrase);
      }
    }
    
    return Array.from(seen.values());
  }

  function buildConsensusMarkdown(consensusJSON, options = {}) {
    if (!consensusJSON || typeof consensusJSON !== 'object') {
      return '';
    }

    const allowedRatings = new Set(['Center', 'Lean Left', 'Lean Right', 'Strong Left', 'Strong Right', 'Unclear']);
    const allowedConfidence = new Set(['High', 'Medium', 'Low']);

    let rating = String(consensusJSON.overall_bias_assessment || '').trim();
    if (!allowedRatings.has(rating)) {
      rating = 'Unclear';
    }

    let confidence = String(consensusJSON.confidence || '').trim();
    if (!allowedConfidence.has(confidence)) {
      confidence = 'Medium';
    }

    const keyObservation = (typeof consensusJSON.key_observation === 'string' && consensusJSON.key_observation.trim())
      ? consensusJSON.key_observation.trim()
      : 'No key observation was provided.';

    const findingsSection = [
      '### Findings',
      `- **Overall Bias Assessment:** ${rating}`,
      `- **Confidence:** ${confidence}`,
      `- **Key Observation:** ${keyObservation}`
    ];

    const loadedFallback = Array.isArray(options.loadedPhrases) ? options.loadedPhrases : [];
    const consensusBiased = Array.isArray(consensusJSON.biased_language_examples)
      ? consensusJSON.biased_language_examples
      : [];

    const biasedExamples = (consensusBiased.length ? consensusBiased : loadedFallback)
      .filter(ex => ex && (ex.phrase || ex.phrase_text))
      .slice(0, 5)
      .map(ex => {
        const phrase = ex.phrase || ex.phrase_text || '';
        const dir = ex.direction ? ` (${ex.direction})` : '';
        const explanation = ex.explanation || ex.description || 'Context not provided.';
        const alt = ex.neutral_alternative ? ` Alternative: "${ex.neutral_alternative}".` : '';
        return `- **"${phrase}"**${dir}: ${explanation}${alt}`;
      });

    if (biasedExamples.length === 0) {
      biasedExamples.push('- No significant loaded language was detected.');
    }

    const neutralFallback = Array.isArray(options.neutralElements) ? options.neutralElements : [];
    const consensusNeutral = Array.isArray(consensusJSON.neutral_elements_examples)
      ? consensusJSON.neutral_elements_examples
      : [];

    const neutralExamples = (consensusNeutral.length ? consensusNeutral : neutralFallback)
      .filter(ex => ex)
      .slice(0, 5)
      .map(ex => {
        if (typeof ex === 'string') return `- ${ex}`;
        const type = ex.type || ex.origin || 'Observation';
        const description = ex.description || ex.summary || ex.quote_summary || 'No description provided.';
        return `- **${type}:** ${description}`;
      });

    if (neutralExamples.length === 0) {
      neutralExamples.push('- No neutral or balancing elements were identified.');
    }

    const voteSummary = consensusJSON.agent_vote_summary && typeof consensusJSON.agent_vote_summary === 'object'
      ? Object.entries(consensusJSON.agent_vote_summary)
          .map(([agent, vote]) => `- **${agent.replace(/_/g, ' ')}:** ${vote}`)
      : [];

    const sections = [
      '## Overall Bias Assessment',
      `Rating: ${rating}`,
      `Confidence: ${confidence}`,
      '',
      ...findingsSection,
      '',
      '### Biased Languages Used',
      ...biasedExamples,
      '',
      '### Neutral Languages Used',
      ...neutralExamples
    ];

    if (voteSummary.length) {
      sections.push('', '### Agent Vote Summary', ...voteSummary);
    }

    return sections.join('\n');
  }

  /**
   * Recompute source balance deterministically (don't trust agent verdict)
   */
  function computeSourceBalance(sources) {
    if (!Array.isArray(sources)) {
      return { counts: { left: 0, right: 0, neutral: 0 }, verdict: 'Balanced' };
    }

    const counts = { left: 0, right: 0, neutral: 0 };
    
    for (const source of sources) {
      const lean = (source.lean || '').toLowerCase();
      if (lean.includes('left')) {
        counts.left++;
      } else if (lean.includes('right')) {
        counts.right++;
      } else {
        counts.neutral++;
      }
    }
    
    const totalLR = counts.left + counts.right;
    let verdict;
    
    if (totalLR === 0) {
      verdict = 'Balanced';
    } else if (counts.left === 0 || counts.right === 0) {
      verdict = `One-sided ${counts.left ? 'Left' : 'Right'}`;
    } else if (Math.max(counts.left, counts.right) / totalLR > 0.7) {
      verdict = `Favors ${counts.left > counts.right ? 'Left' : 'Right'}`;
    } else {
      verdict = 'Balanced';
    }
    
    return { counts, verdict };
  }

  // === Extraction functions for on-device analysis ===
  function extractRating(text) {
    spLog('extractRating: Starting extraction from text length:', text?.length || 0);
    
    if (!text || typeof text !== 'string') {
      spLog('extractRating: Invalid input, falling back to default');
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
      /Overall\s+Bias\s+Assessment\s*[:：]\s*\[?([^\]\n]+)\]?/i
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
          spLog('extractRating: Success via markdown pattern ->', finalResult);
          return finalResult;
        }
        
        spLog('extractRating: Found value but not in allowed list:', result);
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
        spLog('extractRating: Success via simple pattern ->', result);
        return result;
      }
    }

    // Strategy 3: Try JSON parsing
    spLog('extractRating: Trying JSON parsing...');
    const parsedJson = parseJSONish(text, null);
    
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
          spLog('extractRating: Success via JSON path ->', result);
          return result;
        }
      }
      spLog('extractRating: JSON parsed but no rating found in expected paths');
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
          spLog('extractRating: Success via context scan ->', result);
          return result;
        }
      }
    }

    // Fallback
    spLog('extractRating: All strategies failed, falling back to default "Unclear"');
    return 'Unclear';
  }

  function extractConfidence(text) {
    spLog('extractConfidence: Starting extraction from text length:', text?.length || 0);
    
    if (!text || typeof text !== 'string') {
      spLog('extractConfidence: Invalid input, falling back to default');
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
      /Confidence\s+Level\s*[:：]\s*\[?([^\]\n]+)\]?/i,
      /Confidence\s*[:：]\s*\[?([^\]\n]+)\]?/i
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
          spLog('extractConfidence: Success via markdown pattern ->', finalResult);
          return finalResult;
        }
        
        spLog('extractConfidence: Found value but not in allowed list:', result);
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
        spLog('extractConfidence: Success via simple pattern ->', result);
        return result;
      }
    }

    // Strategy 3: Try JSON parsing
    spLog('extractConfidence: Trying JSON parsing...');
    const parsedJson = parseJSONish(text, null);
    
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
          spLog('extractConfidence: Success via JSON path ->', result);
          return result;
        }
      }
      spLog('extractConfidence: JSON parsed but no confidence found in expected paths');
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
          spLog('extractConfidence: Success via context scan ->', result);
          return result;
        }
      }
    }

    // Fallback
    spLog('extractConfidence: All strategies failed, falling back to default "Medium"');
    return 'Medium';
  }

  function isValidBalancedExcerpt(example) {
    const wordCount = countWords(example);
    return wordCount >= 5 && wordCount <= 15;
  }

  async function ensureBalancedExamples(elements, sourceText, fetchSnippet) {
    if (!Array.isArray(elements) || elements.length === 0) return [];
    const resolved = [];

    for (const element of elements) {
      if (!element || typeof element !== 'object') continue;

      let example = typeof element.example === 'string' ? element.example.trim() : '';

      if (!isValidBalancedExcerpt(example) && typeof fetchSnippet === 'function') {
        try {
          const candidate = await fetchSnippet(element, sourceText);
          if (typeof candidate === 'string') {
            example = candidate.trim();
          }
        } catch (error) {
          spWarn('Failed to fetch balanced snippet (on-device):', error);
        }
      }

      if (isValidBalancedExcerpt(example)) {
        resolved.push({ ...element, example });
      } else {
        spWarn('Dropping balanced element without valid excerpt (on-device):', element);
      }
    }

    return resolved;
  }

  function deriveQuickModeratorMarkdown(contextJSON, languageJSON, hunterJSON, skepticJSON, quoteJSON) {
    const t = String(contextJSON?.type || '').toLowerCase();
    const isOpinionAnalysis = !!contextJSON?.is_opinion_or_analysis || t === 'opinion' || t === 'analysis';

    spLog('Rating calculation inputs:', {
      contextType: t,
      isOpinionAnalysis: isOpinionAnalysis,
      will_return_unclear: isOpinionAnalysis,
      biasIndicators: hunterJSON?.bias_indicators?.length || 0,
      balanceScore: skepticJSON?.balance_score || 0
    });

    // Handle Opinion/Analysis Content
    if (isOpinionAnalysis) {
      spLog('Content classified as opinion/analysis; returning "Unclear" rating');
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
    TIP_INTERVAL_MS: 30000,
    MIN_ARTICLE_LENGTH: 100,
    MAX_PARAGRAPHS_TO_ANALYZE: 10,
  };

  const SCAN_MESSAGES = [
    "Analyzing article structure & context...",
    "Scanning narrative for loaded language...",
    "Identifying potential bias indicators...",
    "Checking for journalistic balance...",
    "Building case: Examining evidence...",
    "Cross-examining: Challenging findings...",
    "Synthesizing results: Judge rendering verdict...",
    "Finalizing comprehensive bias report..."
  ];

  // Helpful tips displayed during scanning
  const SCAN_TIPS = [
    "Switch to Quick Analysis for faster checks.",
    "Deep Analysis compares more context and sources.",
    "Enable Cloud AI to run Deep Analysis.",
    "Use On-Device mode to keep your text private.",
    "Cloud AI processes snippets; full articles aren’t stored.",
    "Open the Reports page to review past scans.",
    "Click a report to view bias categories and examples.",
    "Bias ratings reflect language and framing, not facts.",
    "Neutralization rewrites biased wording on-device.",
    "Toggle Neutralization in Settings for clearer text.",
    "Visit Help to learn bias categories and scores.",
    "Adjust sensitivity levels in Settings to your preference.",
    "Quick Analysis runs fully on your device.",
    "Export summaries to share reports without article content.",
    "Combine Deep Analysis with Neutralization for clarity.",
    "Open Settings to switch analysis modes anytime.",
    "Reports highlight bias trends over time.",
    "Disable Cloud processing in Settings at any time.",
    "Hover the badge to see a quick bias summary.",
    "Access Help for tutorials, FAQs, and privacy info."
  ];

  // ========================================
  // DOM ELEMENTS
  // ========================================
  const elements = {
    mainContainer: document.querySelector('.panel-container'),
    animationContainer: document.querySelector('#animation-container'),
    detectionHelper: document.querySelector('.detection-helper'),
    privateToggle: document.querySelector('#private-toggle'),
    statusIcon: document.querySelector('.status-icon'),
    scanButton: document.querySelector('.cta-button'),
    cancelScanButton: document.querySelector('#cancel-scan-button'),
    statusText: document.querySelector('#scan-status-text'),
    scanTipText: document.querySelector('#scan-tip-text'),
    settingsButton: document.querySelector('#settings-button'),
    viewResultsButton: document.getElementById('view-results-button'),
    resultsModalContainer: document.getElementById('results-modal-container'),
    closeModalButton: document.getElementById('close-modal-button'),
  };

  // Validate all required elements exist (except optional animation container)
  for (const [key, element] of Object.entries(elements)) {
    if (!element && key !== 'animationContainer') {
      spError(`Critical UI element missing: "${key}"`);
      showFatalError(`Failed to initialize: Missing element "${key}"`);
      return;
    }
  }

  // Log warning for optional elements
  if (!elements.animationContainer) {
    spWarn('Animation container element missing; continuing without optional animation');
  }

  // ========================================
  // STATE MANAGEMENT
  // ========================================
  let state = {
    isScanning: false,
    statusInterval: null,
    tipInterval: null,
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
      spError('Notification toast element not found');
      return;
    }

    const messageSpan = toast.querySelector('span');
    if (!messageSpan) {
      spError('Notification toast span not found');
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
      spError('Chrome extension APIs not available');
      return false;
    }
    return true;
  }

  /**
   * Checks GPU and shows warning if integrated graphics detected
   */
  async function checkGPU() {
    try {
      const { gpuWarningDismissed } = await chrome.storage.local.get(['gpuWarningDismissed']);
      if (gpuWarningDismissed) return;

      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      if (!gl) return;

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (!debugInfo) return;

      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      
      if (renderer.includes('Intel') && !renderer.includes('Iris Xe') && !renderer.includes('Arc')) {
        showGPUWarning();
      }
    } catch (error) {
      spWarn('GPU check failed:', error);
    }
  }

  /**
   * Shows simple GPU warning modal
   */
  function showGPUWarning() {
    const overlay = document.createElement('div');
    overlay.className = 'bn-modal-overlay visible';

    const modal = document.createElement('div');
    modal.className = 'bn-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-labelledby', 'gpu-modal-title');
    modal.setAttribute('aria-describedby', 'gpu-modal-desc');
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'bn-modal-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '�';
    
    const icon = document.createElement('div');
    icon.className = 'bn-modal-icon';
    icon.textContent = '??';
    
    const title = document.createElement('h3');
    title.id = 'gpu-modal-title';
    title.textContent = 'Integrated GPU Detected';
    
    const desc = document.createElement('p');
    desc.id = 'gpu-modal-desc';
    desc.textContent = 'Your device may experience slower processing with on-device AI. Switch to Cloud AI for faster results.';
    
    const actions = document.createElement('div');
    actions.className = 'bn-modal-actions';
    
    const primaryBtn = document.createElement('button');
    primaryBtn.id = 'gpu-switch-cloud';
    primaryBtn.className = 'bn-btn bn-btn-primary';
    primaryBtn.textContent = 'Use Cloud AI';
    
    const secondaryBtn = document.createElement('button');
    secondaryBtn.id = 'gpu-continue';
    secondaryBtn.className = 'bn-btn bn-btn-secondary';
    secondaryBtn.textContent = 'Continue Anyway';
    
    actions.appendChild(primaryBtn);
    actions.appendChild(secondaryBtn);
    
    const checkbox = document.createElement('label');
    checkbox.className = 'bn-modal-checkbox';
    const checkboxInput = document.createElement('input');
    checkboxInput.id = 'gpu-dont-show';
    checkboxInput.type = 'checkbox';
    const checkboxSpan = document.createElement('span');
    checkboxSpan.textContent = "Don't show this again";
    checkbox.appendChild(checkboxInput);
    checkbox.appendChild(checkboxSpan);
    
    modal.appendChild(closeBtn);
    modal.appendChild(icon);
    modal.appendChild(title);
    modal.appendChild(desc);
    modal.appendChild(actions);
    modal.appendChild(checkbox);
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => {
      const dontShow = checkboxInput.checked;
      if (dontShow) {
        chrome.storage.local.set({ gpuWarningDismissed: true });
      }
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 200);
    };

    closeBtn.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });

    primaryBtn.onclick = () => {
      chrome.storage.local.set({ privateMode: false, gpuWarningDismissed: true }, () => {
        elements?.privateToggle?.classList.remove('on');
        try { updatePrivateIcon(false); } catch (e) { /* no-op */ }
        showNotification('Switched to Cloud AI', 'success');
        close();
      });
    };

    secondaryBtn.onclick = close;
  }

  /**
   * Shows a fatal error message to the user
   */
  function showFatalError(message) {
    spError('Fatal error displayed to user', message);
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
    spError('User notification issued', { message, recovery });
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
            spError('Storage error:', chrome.runtime.lastError);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      } catch (error) {
        spError('Storage exception:', error);
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
            spError('Storage error:', chrome.runtime.lastError);
            resolve(null);
          } else {
            resolve(result);
          }
        });
      } catch (error) {
        spError('Storage exception:', error);
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
    let lastTipIndex = -1;
    const messages = SCAN_MESSAGES.length ? SCAN_MESSAGES : ["Analyzing article..."];
    const tips = SCAN_TIPS.length ? SCAN_TIPS : ["Check Reports to review past scans."];

    function updateMessage() {
      const currentMessage = messages[messageIndex % messages.length];
      
      elements.statusText.classList.add('exiting');
      
      setTimeout(() => {
        elements.statusText.textContent = currentMessage;
        elements.statusText.classList.remove('exiting');
      }, CONSTANTS.FADE_DURATION_MS);
      
      messageIndex++;
    }

    function updateTip() {
      if (!elements.scanTipText) return;
      const chooseIndex = () => {
        if (tips.length <= 1) return 0;
        let idx;
        do { idx = Math.floor(Math.random() * tips.length); } while (idx === lastTipIndex);
        return idx;
      };
      const nextIndex = chooseIndex();
      const currentTip = tips[nextIndex];
      elements.scanTipText.classList.add('exiting');
      setTimeout(() => {
        elements.scanTipText.textContent = `Tip: ${currentTip}`;
        elements.scanTipText.classList.remove('exiting');
      }, CONSTANTS.FADE_DURATION_MS);
      lastTipIndex = nextIndex;
    }

    // Prime both immediately
    updateMessage();
    updateTip();
    // Run on separate intervals: frequent status, slow tips
    state.statusInterval = setInterval(updateMessage, CONSTANTS.MESSAGE_INTERVAL_MS);
    state.tipInterval = setInterval(updateTip, CONSTANTS.TIP_INTERVAL_MS);
  }

  /**
   * Stops status update animation
   */
  function stopStatusUpdates() {
    if (state.statusInterval) {
      clearInterval(state.statusInterval);
      state.statusInterval = null;
    }
    if (state.tipInterval) {
      clearInterval(state.tipInterval);
      state.tipInterval = null;
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
      spError('Invalid data for results page:', {
        hasAnalysis: !!analysisData,
        hasSource: !!source,
        hasArticleInfo: !!articleInfo,
      });
      showError('Cannot save results: Invalid analysis data');
      return;
    }

    const finalReportId = reportId || Date.now();

    spLog('Saving analysis results to history...');
    spLog('analysisData type:', typeof analysisData);
    spLog('analysisData value:', analysisData);
    spLog('analysisData length:', typeof analysisData === 'string' ? analysisData.length : 'N/A');
    spLog('source:', source);
    spLog('articleInfo:', articleInfo);

    // Data is already normalized at source (background.js)
    // Extract text and pre-extracted fields
    let normalized = (typeof analysisData === 'string')
      ? analysisData
      : (analysisData?.text || analysisData?.analysis || JSON.stringify(analysisData, null, 2));

    const resultToStore = {
      id: finalReportId, // Add unique ID for history
      summary: normalized, // already normalized from background
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
        timestamp: Date.now(),
        // Store pre-extracted from background for fast rendering
        extractedRating: analysisData?.extractedRating || null,
        extractedConfidence: analysisData?.extractedConfidence || null
      },
    };

    spLog('Prepared analysis payload for storage');
    spLog('resultToStore.summary type:', typeof resultToStore.summary);
    spLog('resultToStore.summary:', resultToStore.summary);
    spLog('resultToStore.raw:', resultToStore.raw);
    spLog('Full resultToStore:', JSON.stringify(resultToStore, null, 2));

    // ===== WAIT FOR SUMMARY TO COMPLETE =====
    // Give the summary generation 30 seconds to complete
    let summaryAttempts = 0;
    const maxSummaryWait = 30; // 30 seconds max
    const summaryKey = `summary_${finalReportId}`;
    
    while (summaryAttempts < maxSummaryWait) {
      const summaryStorage = await safeStorageGet([summaryKey]);
      const lastSummary = summaryStorage?.[summaryKey];
      
      if (lastSummary && lastSummary.status === 'complete') {
        // Summary is ready! Embed it in the report
        resultToStore.articleSummary = lastSummary.data;
        resultToStore.summaryUsedCloud = lastSummary.usedCloudFallback || false;
        spLog('Embedded summary detected in report payload for:', finalReportId);
        break;
      }
      
      if (lastSummary && lastSummary.status === 'error') {
        spWarn('Summary embedding failed for report', finalReportId, '- saving report without it');
        break;
      }
      
      // Wait 1 second before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
      summaryAttempts++;
    }
    
    if (summaryAttempts >= maxSummaryWait) {
      spWarn('Summary embedding timed out for report', finalReportId, '- saving report without it');
    }
    // ===== END WAIT FOR SUMMARY =====

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

    // Cleanup old summaries to prevent storage bloat
    cleanupOldSummaries();

    if (!stored) {
      showError(
        'Failed to save analysis results.',
        'The analysis completed but could not be saved. Please try again.'
      );
      return;
    }

    sessionStorage.setItem('viewReportId', finalReportId);

    spLog('Analysis saved to history with ID:', resultToStore.id);

    if (elements.resultsModalContainer) {
      elements.resultsModalContainer.classList.remove('modal-hidden');
      elements.resultsModalContainer.classList.add('modal-visible');
    }
    spLog('Analysis results saved to storage');
  }

  // ========================================
  // AI SCANNING
  // ========================================

  /**
   * Cleanup old summary entries to prevent storage bloat
   */
  async function cleanupOldSummaries() {
    try {
      const storage = await chrome.storage.local.get(null);
      const summaryKeys = Object.keys(storage).filter(k => k.startsWith('summary_'));
      
      if (summaryKeys.length > 10) {
        // Keep only last 10 summaries (most recent based on reportId timestamp)
        const keysToDelete = summaryKeys
          .sort((a, b) => {
            const idA = parseInt(a.replace('summary_', ''));
            const idB = parseInt(b.replace('summary_', ''));
            return idA - idB; // Oldest first
          })
          .slice(0, summaryKeys.length - 10);
        
        for (const key of keysToDelete) {
          await chrome.storage.local.remove(key);
        }
        spLog(`Cleaned up ${keysToDelete.length} old summary entries`);
      }
    } catch (error) {
      spWarn('Failed to cleanup old summaries:', error);
    }
  }

  /**
   * Triggers a separate summary generation process.
   * Tries on-device first, falls back to cloud if unavailable.
   * This runs independently of the main bias scan.
   * @param {Object} articleContent - The article content to summarize
   * @param {number} reportId - Unique report ID for this scan
   */
  async function triggerOnDeviceSummary(articleContent, reportId) {
    spLog('Starting independent summary generation for report:', reportId);

    // Save a placeholder with report-specific key
    const summaryKey = `summary_${reportId}`;
    await safeStorageSet({ [summaryKey]: { status: 'generating', timestamp: Date.now() } });

    // Try on-device summarization first
    if ('Summarizer' in self) {
      try {
        const availability = await Summarizer.availability();
        if (availability !== 'unavailable') {
          const summarizer = await Summarizer.create({
            type: 'key-points',
            format: 'markdown',
            length: 'short'
          });

          const fullText = (articleContent.fullText || '').slice(0, 2000); // Only first 2k chars
          const summaryMarkdown = await summarizer.summarize(
            fullText,
            {
              context: 'Generate concise key points for a news article. 3-5 bullet points maximum.'
            }
          );

          // Save the successful on-device summary with report-specific key
          await safeStorageSet({ 
            [summaryKey]: { 
              status: 'complete', 
              data: summaryMarkdown, 
              usedCloudFallback: false,
              articleUrl: articleContent.url || '',
              timestamp: Date.now()
            } 
          });
          spLog('On-device summary generation complete for report:', reportId);
          return;
        }
      } catch (error) {
        spWarn('On-device summary failed; trying cloud fallback:', error);
      }
    }

    // Cloud fallback: Use Gemini API
    spLog('Using cloud fallback for summary generation');
    try {
      const settings = await safeStorageGet(['geminiApiKey']);
      const apiKey = settings?.geminiApiKey?.trim();
      
      if (!apiKey) {
        throw new Error('Gemini API key not configured');
      }

      const fullText = (articleContent.fullText || '').slice(0, 2000); // Only first 2k chars
      const prompt = `Summarize the following news article into 3-5 concise bullet points in markdown format. Focus on key facts and main points only.

Article:
${fullText}`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 500
          }
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      const summaryText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!summaryText) {
        throw new Error('No summary returned from API');
      }

      await safeStorageSet({ 
        [summaryKey]: { 
          status: 'complete', 
          data: summaryText, 
          usedCloudFallback: true,
          articleUrl: articleContent.url || '',
          timestamp: Date.now()
        } 
      });
      spLog('Cloud summary generation complete for report:', reportId);

    } catch (error) {
      spError('Summary generation failed (both on-device and cloud):', error);
      await safeStorageSet({ 
        [summaryKey]: { 
          status: 'error', 
          data: `Summary generation failed: ${error.message}`,
          timestamp: Date.now()
        } 
      });
    }
  }

  // ============================================
  // INTELLIGENT CHUNKING CONFIGURATION
  // ============================================
  const CHUNKING_CONFIG = {
    // Strategy thresholds
    NO_CHUNK_THRESHOLD: 2800,    // 70% of articles - analyze whole
    LIGHT_CHUNK_THRESHOLD: 6000, // 20% of articles - light chunking
    // Above 6000 = heavy chunking
    
    // Chunking parameters
    CHUNK_SIZE: 2600,     // Conservative for token safety
    OVERLAP: 400,         // Find natural boundaries
    SAFETY_MARGIN: 200,   // Buffer for tokenization variance
    
    // For context extraction from long articles
    CONTEXT_SUMMARY_SIZE: 2500  // Lead + opening paragraphs
  };

  /**
   * Helper: Smart chunking at paragraph/sentence boundaries
   */
  function smartChunk(text, targetSize, overlap) {
    const chunks = [];
    let start = 0;
    
    while (start < text.length) {
      let end = Math.min(start + targetSize, text.length);
      
      // If not at end, find natural boundary
      if (end < text.length) {
        const searchStart = Math.max(0, end - 100);
        const searchEnd = Math.min(text.length, end + 100);
        const searchWindow = text.substring(searchStart, searchEnd);
        
        // Try paragraph break first
        const paragraphBreak = searchWindow.lastIndexOf('\n\n');
        if (paragraphBreak !== -1 && paragraphBreak > 50) {
          end = searchStart + paragraphBreak;
        } else {
          // Fall back to sentence boundary
          const sentenceBreak = searchWindow.lastIndexOf('. ');
          if (sentenceBreak !== -1 && sentenceBreak > 50) {
            end = searchStart + sentenceBreak + 2;
          }
        }
      }
      
      chunks.push(text.substring(start, end).trim());
      start = end - overlap;
      
      // Safety: prevent infinite loops
      if (start >= text.length - overlap) break;
    }
    
    return chunks;
  }

  /**
   * Scans article using INTELLIGENT chunking - only chunks when necessary
   */
  async function scanWithOnDeviceAI(articleContent, tabId) {
    if (state.isScanning) {
      spWarn('On-device scan already in progress; skipping new request');
      return;
    }

    state.isScanning = true;
    elements.scanButton.disabled = true;
    setView('scanning');
    startStatusUpdates();

    try {
      // Generate unique report ID for this scan
      const reportId = Date.now();
      
      // --- Immediately trigger the separate on-device summary ---
      triggerOnDeviceSummary(articleContent, reportId);
      spLog('Background summary generation started for report:', reportId);

      const availability = await window.LanguageModel.availability();
      if (availability !== 'available') {
        throw new Error(`On-device AI is not ready. Status: ${availability}`);
      }

      const session = await window.LanguageModel.create({
        outputLanguage: 'en'
      });
      state.currentSession = session;

      const fullText = (articleContent.fullText || '').replace(/\s+/g, ' ').trim();
      const articleUrl = articleContent.url || '';
      
      spLog(`📄 Multi-Agent Analysis: ${fullText.length} chars`);
      
      // ============================================
      // MULTI-AGENT ORCHESTRATION (7 AGENTS)
      // ============================================
      
      // AGENT 1: Opinion Detector (runs first - may short-circuit)
      spLog('Agent 1: Opinion Detector');
      const opinionPrompt = OnDevicePrompts.createOpinionDetectorPrompt(fullText, articleUrl);
      const opinionRes = await session.prompt(opinionPrompt);
      const opinionJSON = parseJSONish(opinionRes, { is_opinion: false, confidence: 'Medium' });
      
      spLog('Opinion Detection:', opinionJSON);
      
      // Handle Opinion and Interview content (exit early)
      if (opinionJSON.is_opinion || opinionJSON.content_type === 'Interview') {
        const contentType = opinionJSON.content_type || (opinionJSON.is_opinion ? 'Opinion' : 'Unknown');
        const ratingLabel = contentType === 'Interview' ? 'Unclear (Interview Format)' : 'Unclear';
        
        spLog(`${contentType} content detected - returning ${ratingLabel}`);
        const specialReport = `### Findings
- **Overall Bias Assessment:** ${ratingLabel}
- **Confidence:** ${opinionJSON.confidence || 'Medium'}
- **Content Type:** ${contentType}

### ${contentType} Content Detected
This content was identified as ${contentType.toLowerCase()} based on:
${(opinionJSON.signals_found || []).map(s => `- ${s}`).join('\n')}

${contentType === 'Interview' 
  ? 'Interview content presents the views of the interviewee and is not rated for journalistic bias.'
  : 'Opinion pieces are intentionally subjective and do not receive a bias rating.'}

### Recommendation
${contentType} content is evaluated differently than news reporting and does not receive a Left/Right/Center bias rating.`;
        
        const analysisResult = {
          text: specialReport,
          extractedRating: ratingLabel,
          extractedConfidence: opinionJSON.confidence || 'Medium',
          content_type: contentType
        };
        
        await session.destroy();
        const reportId = Date.now();
        await saveAnalysisResults(analysisResult, `on-device (${contentType.toLowerCase()})`, articleContent, reportId);
        
        stopStatusUpdates();
        setView('default');
        state.isScanning = false;
        elements.scanButton.disabled = false;
        return;
      }
      
      // AGENTS 2-6: Run all political analysis agents in parallel
      spLog('Running Agents 2-6 in parallel: Political analysis');
      const [politicalRes, heroRes, sourceRes, framingRes, counterpointRes] = await Promise.all([
        session.prompt(OnDevicePrompts.createPoliticalLanguagePrompt(fullText)),
        session.prompt(OnDevicePrompts.createHeroVillainPrompt(fullText)),
        session.prompt(OnDevicePrompts.createSourceBalancePrompt(fullText)),
        session.prompt(OnDevicePrompts.createFramingAnalyzerPrompt(fullText)),
        session.prompt(OnDevicePrompts.createCounterpointCheckerPrompt(fullText))
      ]);
      
      // Parse all agent results
      const politicalJSON = parseJSONish(politicalRes, { loaded_phrases: [], overall_lean: 'Neutral', confidence: 'Low' });
      const heroJSON = parseJSONish(heroRes, { portrayals: [], pattern: 'Neutral', political_lean: 'Neutral', confidence: 'Low' });
      const sourceJSON = parseJSONish(sourceRes, { source_count: {}, sources_listed: [], balance_verdict: 'Balanced', confidence: 'Low' });
      const framingJSON = parseJSONish(framingRes, { topic: 'Other', dominant_frame: 'Neutral', political_lean: 'Neutral', confidence: 'Low' });
      const counterpointJSON = parseJSONish(counterpointRes, { counterpoints_present: false, balance_verdict: 'Balanced', suggests_lean: 'Neither', confidence: 'Low' });
      
      spLog('Agent Results:', {
        political: politicalJSON.overall_lean,
        hero: heroJSON.political_lean,
        source: sourceJSON.balance_verdict,
        framing: framingJSON.political_lean,
        counterpoint: counterpointJSON.suggests_lean
      });
      
      // Unify phrase naming (handle both loaded_phrases and political_phrases)
      const rawPhrases = politicalJSON.loaded_phrases || politicalJSON.political_phrases || [];
      
      // Verify phrases exist in article text and add positions
      const verifiedPhrases = verifyAndLocatePhrases(rawPhrases, fullText);
      
      // Deduplicate phrases
      const allLoadedPhrases = deduplicatePhrases(verifiedPhrases);
      
      // Recompute source balance (don't trust agent verdict)
      const recomputedBalance = computeSourceBalance(sourceJSON.sources_listed || []);
      sourceJSON.computed_balance = recomputedBalance;
      
      spLog('Verified phrases:', {
        rawCount: rawPhrases.length,
        verifiedCount: verifiedPhrases.length,
        finalCount: allLoadedPhrases.length
      });
      
      spLog('Recomputed source balance:', recomputedBalance);
      
      // Aggregate all agent results for moderator
      const agentResults = JSON.stringify({
        opinion: opinionJSON,
        political: { 
          ...politicalJSON, 
          loaded_phrases: allLoadedPhrases, // Use verified phrases
          verified_count: allLoadedPhrases.length
        },
        hero_villain: heroJSON,
        sources: sourceJSON,
        framing: framingJSON,
        counterpoints: counterpointJSON
      }, null, 2);
      
      // AGENT 7: Consensus Moderator (synthesizes all votes)
      spLog('Agent 7: Consensus Moderator - Synthesizing votes');
      const moderatorPrompt = OnDevicePrompts.createConsensusModerator_JSON(agentResults);
      const moderatorRaw = await session.prompt(moderatorPrompt);
      const consensusJSON = parseJSONish(moderatorRaw, null);

      const neutralFallback = [];
      if (Array.isArray(counterpointJSON.examples)) {
        counterpointJSON.examples
          .filter(example => typeof example === 'string' && example.trim())
          .slice(0, 3)
          .forEach(example => neutralFallback.push({ type: 'Counterpoint', description: example.trim() }));
      }
      if (Array.isArray(sourceJSON.sources_listed)) {
        sourceJSON.sources_listed
          .filter(src => src && src.name && src.quote_summary)
          .slice(0, 3)
          .forEach(src => neutralFallback.push({ type: `Source (${src.lean || 'Neutral'})`, description: `${src.name}: ${src.quote_summary}` }));
      }

      let finalReportMarkdown = moderatorRaw;
      if (consensusJSON) {
        finalReportMarkdown = buildConsensusMarkdown(consensusJSON, {
          loadedPhrases: allLoadedPhrases,
          neutralElements: neutralFallback
        });
        spLog('Consensus Moderator JSON parsed successfully');
      } else {
        spWarn('Consensus Moderator response was not valid JSON; using raw output');
      }

      // allLoadedPhrases already computed and verified above
      spLog('Analysis complete:', {
        phrasesFound: allLoadedPhrases.length,
        reportLength: finalReportMarkdown.length
      });

      // Extract rating and confidence from the markdown BEFORE saving
      // This matches what background.js does for cloud AI
      const extractedRating = extractRating(finalReportMarkdown);
      const extractedConfidence = extractConfidence(finalReportMarkdown);

      spLog('Extracted from on-device report:', { extractedRating, extractedConfidence });

      // Include extracted values and raw agent data in the result object
      const analysisResult = { 
        text: finalReportMarkdown,
        extractedRating: extractedRating,
        extractedConfidence: extractedConfidence,
        consensusModerator: consensusJSON || null,
        // Store raw agent data for results page display
        languageAnalysis: allLoadedPhrases, // Political phrases for display
        biasIndicators: politicalJSON.loaded_phrases || [],
        balancedElements: sourceJSON.sources_listed || [],
        agentVotes: {
          political: politicalJSON.overall_lean,
          hero: heroJSON.political_lean,
          sources: sourceJSON.balance_verdict,
          framing: framingJSON.political_lean,
          counterpoints: counterpointJSON.suggests_lean
        },
        // Full agent responses for assistant context
        fullAgentData: {
          opinion: opinionJSON,
          political: politicalJSON,
          heroVillain: heroJSON,
          sources: sourceJSON,
          framing: framingJSON,
          counterpoints: counterpointJSON
        }
      };

      await session.destroy();

      // --- Save to history ---
      spLog('Saving analysis entry to history');
      // reportId already generated at start of scan
      
      // Save with multi-agent source label
      const sourceLabel = 'on-device (multi-agent)';
      await saveAnalysisResults(analysisResult, sourceLabel, articleContent, reportId);

      // --- Send highlighting data to content script ---
      const hasPoliticalPhrases = allLoadedPhrases.length > 0;
      
      if (hasPoliticalPhrases && tabId) {
        try {
          // Political phrases already in correct format from loaded_phrases
          const biasedPhrases = allLoadedPhrases;
          
          await chrome.tabs.sendMessage(tabId, {
            type: 'HIGHLIGHT_DATA',
            biasedPhrases: biasedPhrases,
            neutralPhrases: [] // Multi-agent doesn't track neutral phrases
          });
          spLog('Highlight data sent to content script:', {
            politicalPhrasesCount: biasedPhrases.length
          });
        } catch (error) {
          spWarn('Failed to send highlight data:', error);
        }
      }

      stopStatusUpdates();
      setView('default');
      state.isScanning = false;
      elements.scanButton.disabled = false;

    } catch (error) {
      spError("On-device chunked scan failed:", error);
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
      spWarn('Cloud scan already in progress; ignoring duplicate request');
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

    // Generate unique report ID for this scan
    const reportId = Date.now();

    // --- Immediately trigger the separate on-device summary (runs independently) ---
    triggerOnDeviceSummary(articleContent, reportId);
    spLog('Background summary generation started for report:', reportId);

    spLog('Sending scan request to background script');
    spLog('Article content length:', articleContent.fullText?.length);

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
          spError('Message error:', chrome.runtime.lastError);
          showError(
            'Failed to communicate with the background script.',
            'Please refresh the page and try again.'
          );
          return;
        }

        // Validate response
        if (!response) {
          spError('No response from background script');
          showError('No response from analysis service.', 'Please try again.');
          return;
        }

        if (response.type === 'SCAN_COMPLETE') {
          spLog('Cloud AI scan completed');
          spLog('Response type:', typeof response.results);
          spLog('Response results:', response.results);
          spLog('Response results length:', typeof response.results === 'string' ? response.results.length : 'N/A');
          await saveAnalysisResults(response.results, 'cloud', articleContent, reportId);
        } else if (response.type === 'SCAN_ERROR') {
          spError('Background script error:', response.error);
          showError(
            `Analysis failed: ${response.error || 'Unknown error'}`,
            'Please try again or contact support if the issue persists.'
          );
        } else {
          spError('Unexpected response type:', response.type);
          showError('Unexpected response from analysis service.');
        }
      });
    } catch (error) {
      spError('Exception sending message:', error);

      stopStatusUpdates();
      setView('default');
      state.isScanning = false;
      elements.scanButton.disabled = false;

      showError('Failed to start analysis.', 'Please refresh the page and try again.');
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
    spWarn('Scan already in progress; ignoring scan button click');
    return;
  }
  if (!validateChromeAPI()) {
    showError('Cannot perform scan: Chrome APIs unavailable');
    return;
  }
  
  // No need to clear global summary - each scan uses its own report-specific key
  spLog('Starting new scan with report-specific summary tracking');
  
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
    spError('Scan initiation failed:', error);
    const errorMessage = (error && typeof error.message === 'string') ? error.message : '';
    if (errorMessage.includes('Receiving end does not exist')) {
      showError(
        'Failed to connect to the page.',
        'Please refresh the page you want to analyze and try again.'
      );
    } else {
      const detail = errorMessage || 'Unknown error';
      showError(
        `Failed to start scan: ${detail}`,
        'Please try again or reload the page and the extension.'
      );
    }
    // This is the important fix: reset state on failure
    state.isScanning = false;
    if (elements.scanButton) elements.scanButton.disabled = false;
  }
}

  /**
   * Handles cancel scan button click
   */
  function handleCancelScan() {
    spLog('User cancelled scan');
    
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
        spLog('AI session destroyed');
      } catch (error) {
        spError('Failed to destroy session:', error);
      }
      state.currentSession = null;
    }
    
    // Notify background script to cancel
    if (validateChromeAPI()) {
      try {
        chrome.runtime.sendMessage({ type: 'CANCEL_SCAN' });
      } catch (error) {
        spError('Failed to send cancel message:', error);
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
    spLog(`Toggle ${storageKey}:`, isNowOn);
    
    const success = await safeStorageSet({ [storageKey]: isNowOn });
    
    if (!success) {
      // Revert toggle if storage failed
      toggleElement.classList.toggle('on');
      showError('Failed to save setting.', 'Please try again.');
      return;
    }

    // Side effects for specific toggles
    if (storageKey === 'privateMode') {
      updatePrivateIcon(isNowOn);
    }
  }

  /**
   * Updates the Private Mode status icon with a small fade transition
   * @param {boolean} isPrivate - true -> 🔒, false -> 🌐
   */
  function updatePrivateIcon(isPrivate) {
    if (!elements.statusIcon) return;
    const el = elements.statusIcon;
    // graceful fade-out, swap, fade-in
    el.style.transition = el.style.transition || 'opacity 160ms ease, transform 160ms ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-2px)';
    setTimeout(() => {
      el.textContent = isPrivate ? '🔒' : '🌐';
      el.style.transform = 'translateY(0)';
      el.style.opacity = '1';
    }, 120);
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
      spError('Failed to open settings:', error);
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
    spLog('Initializing panel state');

    // Load settings
    const settings = await safeStorageGet(['privateMode']);
    
    if (settings) {
      if (settings.privateMode) {
        elements.privateToggle.classList.add('on');
        spLog('Private mode enabled');
      }
      // Initialize the status icon
      updatePrivateIcon(!!settings.privateMode);
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
          spLog('Current domain:', hostname);
        } catch (error) {
          elements.detectionHelper.textContent = 'Ready to analyze an article';
        }
      } else {
        elements.detectionHelper.textContent = 'Ready to analyze an article';
      }
    } catch (error) {
      spError('Failed to get tab info:', error);
      elements.detectionHelper.textContent = 'Ready to analyze an article';
    }
  }

  /**
   * Sets up event listeners with delegation
   */
  function setupEventListeners() {
    spLog('Setting up event listeners');

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
          spError('Failed to open reports page:', error);
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
          spError('Failed to open help page:', error);
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

    spLog('Event listeners ready');
  }

  /**
   * Cleanup on page unload
   */
  window.addEventListener('beforeunload', () => {
    spLog('Cleaning up before unload');
    
    stopStatusUpdates();
    
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
    }
    
    if (state.currentSession) {
      try {
        state.currentSession.destroy();
      } catch (error) {
        spError('Cleanup error:', error);
      }
    }
  });

  // ========================================
  // START APPLICATION
  // ========================================
  
  spLog('Side panel initializing...');
  initializePanelState();
  setupEventListeners();
  checkGPU();
  spLog('Side panel ready');
});
