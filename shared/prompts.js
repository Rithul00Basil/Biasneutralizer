/**
 * Shared Agent Prompts Module
 * Contains all agent prompt templates used by both on-device and cloud analysis
 */

export const AgentPrompts = {
  /**
   * Context Agent: Classifies genre and extracts context
   */
  createContextPrompt: (textToAnalyze) => `You are a neutral classifier. Do NOT assume bias exists.

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
${textToAnalyze}`,

  /**
   * Language Agent: Analyzes loaded language in narrative
   */
  createLanguagePrompt: (contextData, textToAnalyze) => `Context: ${contextData}

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
${textToAnalyze}`,

  /**
   * Bias Hunter Agent: Finds bias indicators in narrative
   */
  createHunterPrompt: (contextData, textToAnalyze) => `Context: ${contextData}

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
${textToAnalyze}`,

  /**
   * Skeptic Agent: Identifies balanced elements
   */
  createSkepticPrompt: (contextData, textToAnalyze) => `Context: ${contextData}

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
${textToAnalyze}`,

  /**
   * Quote Agent: Extracts and analyzes direct quotes
   */
  createQuotePrompt: (contextData, textToAnalyze) => `Context: ${contextData}

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
${textToAnalyze}`,

  /**
   * Source Diversity Agent: Analyzes source representation (Deep mode only)
   */
  createSourceDiversityPrompt: (contextData, textToAnalyze) => `Context: ${contextData}

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
${textToAnalyze}`,

  /**
   * Framing Agent: Examines story structure (Deep mode only)
   */
  createFramingPrompt: (contextData, textToAnalyze) => `Context: ${contextData}

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
${textToAnalyze}`,

  /**
   * Omission Agent: Identifies missing context (Deep mode only)
   */
  createOmissionPrompt: (contextData, textToAnalyze) => `Context: ${contextData}

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
${textToAnalyze}`,

  /**
   * Moderator Agent: Synthesizes all agent findings
   */
  createModeratorPrompt: (contextData, languageResponse, hunterResponse, skepticResponse, quoteResponse, analysisDepth, deepAnalysisResponses = null) => {
    const deepSection = (analysisDepth === 'deep' && deepAnalysisResponses) ? `
SOURCE_DIVERSITY_JSON:
${deepAnalysisResponses.sourceDiversity}
FRAMING_JSON:
${deepAnalysisResponses.framing}
OMISSION_JSON:
${deepAnalysisResponses.omission}
` : '';

    return `You are the Moderator. Merge the agent evidence into a neutral, methodical report.

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

Evidence (verbatim JSON from agents):
CONTEXT: ${contextData}
LANGUAGE_JSON:
${languageResponse}
HUNTER_JSON:
${hunterResponse}
SKEPTIC_JSON:
${skepticResponse}
QUOTES_JSON:
${quoteResponse}
${deepSection}
SYNTHESIS RULES:
1. Require ≥2 independent narrative indicators OR 1 High-strength indicator before moving from Center
2. If ≥70% loaded language is in QUOTES → treat as source bias; lean Center unless framing/manipulation strong
3. Balance mitigates: raise neutrality if balance_score ≥7 with High confidence
4. Default to Center/Unclear when evidence insufficient

CRITICAL: Keep under ${analysisDepth === 'deep' ? '400' : '300'} words. Do NOT mention "agents".`;
  }
};

// For on-device AI that expects simpler string-based prompts
export const SimpleAgentPrompts = {
  createLanguagePrompt: (contextData, textToSend) => `Context: ${contextData}

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
${textToSend}`,

  createHunterPrompt: (contextData, textToSend) => `Context: ${contextData}

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
${textToSend}`,

  createSkepticPrompt: (contextData, textToSend) => `Context: ${contextData}

Credit genuine balance; avoid forced symmetry. No "both sides" if one is fringe.

Format:
- TYPE: Sourcing/Attribution/Context/Nuance/Transparency
  EXAMPLE: "text"
  WHY: reason

BALANCE_SCORE: 0-10
CONFIDENCE: High/Medium/Low
STRENGTHS: one sentence

TEXT:
${textToSend}`,

  createSourceDiversityPrompt: (contextData, textToSend) => `Context: ${contextData}

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
${textToSend}`,

  createFramingPrompt: (contextData, textToSend) => `Context: ${contextData}

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
${textToSend}`,

  createOmissionPrompt: (contextData, textToSend) => `Context: ${contextData}

List omissions ONLY if reasonable-to-include test passed (commonly included, feasible, available).

MISSING_CONTEXT: a, b
UNADDRESSED_COUNTERARGUMENTS: a, b
MISSING_DATA: a, b
UNANSWERED_QUESTIONS: a, b
OMISSION_SEVERITY: None/Low/Medium/High
CONFIDENCE: High/Medium/Low
ASSESSMENT: one sentence

TEXT:
${textToSend}`
};
