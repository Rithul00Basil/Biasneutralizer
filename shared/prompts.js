// prompts.js — Single source of truth for all agent prompts
// MV3 module-friendly: import as `import { AgentPrompts } from '../prompts/prompts.js'`

export const AgentPrompts = {
  // ---------- 1) CONTEXT ----------
  createContextPrompt: (textToAnalyze) => `
You are a neutral classifier. Do NOT assume bias exists.

Task: Classify genre and extract context. If uncertain, use "Unknown" rather than guessing.

Definitions:
- News: Timely reporting, minimal opinion
- Opinion: Explicit viewpoint/commentary (op-ed, column, editorial, first-person)
- Analysis: Explains significance with interpretation, not straight reporting
- Satire: Humor/irony, not literal
- Academic: Scholarly, citations, formal
- Other: Specify if none fit (e.g., press release, police report, dataset page)

Rules:
- Do not judge ideology or search for bias
- Detect opinion/analysis markers in headers/bylines (e.g., "Opinion", "Analysis", "Column")
- Identify official data releases (govt/police/statistical bulletins) as "Other: Official data release"
- Estimate quoted material: approximate % of words inside quotation marks
  • Low = 0–30%, Medium = 31–60%, High = 61–100%

Output ONLY this JSON (no other text):
{
  "type": "News/Opinion/Analysis/Satire/Academic/Other/Unknown",
  "is_opinion_or_analysis": true/false,
  "subtype": "e.g., Official data release/Press release/Column/Editorial/None",
  "summary": "EXACTLY TEN WORDS describing main topic",
  "tone": "Neutral/Emotional/Analytical/Mixed",
  "quote_ratio": "Low/Medium/High",
  "quote_percentage": NUMBER_0_TO_100,
  "confidence": "High/Medium/Low"
}

ARTICLE TEXT:
${textToAnalyze}
`,

  // ---------- 2) LANGUAGE ----------
  createLanguagePrompt: (contextData, textToAnalyze) => `
Context: ${contextData}

Analyze ONLY reporter's narrative (exclude all quoted text).

Flag phrases ONLY if ALL are true:
1) Value-laden (judgmental adjectives/adverbs, insinuating verbs, speculative hedges)
2) A neutral, precise alternative exists
3) The phrase is NOT a factual statistic, measurement, count, date, rate, quote attribution, or data-backed descriptor

Do NOT flag:
- Precise technical/legal terms ("felony", "GDP contracted")
- Numbers/percentages/rates, time trends, or sourced findings (e.g., "22% decrease" with source)
- Headlines/quotes content; treat quoted loaded terms as source bias

Require: Provide a neutral alternative for each flagged phrase.

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
${textToAnalyze}
`,

  // ---------- 3) HUNTER ----------
  createHunterPrompt: (contextData, textToAnalyze) => `
Context: ${contextData}

Find bias indicators in NARRATIVE ONLY (ignore quotes). Do NOT assume bias exists.

Flag ONLY if falsifiable criteria met:
- Selective framing: Relevant counter-info buried (e.g., after para 8) while opposing view leads
- Unbalanced sourcing: >70% of attributions favor one side without comparable scrutiny
- Loaded descriptors: Narrative uses judgmental language without factual basis
- Causality leap: Claims causation without evidence (correlation presented as causation)
- Editorial insertion: Adjectives judging motives/morality

Thresholds:
- Need ≥2 INDEPENDENT indicators (different types/examples) OR
- 1 High-strength indicator corroborated by story structure (headline/lead/positioning)

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
${textToAnalyze}
`,

  // ---------- 4) SKEPTIC ----------
  createSkepticPrompt: (contextData, textToAnalyze) => `
Context: ${contextData}

Your job: score balance and highlight genuine balancing elements.

Scoring (0-10):
- 0 = one-sided, no counterpoints
- 5 = some counterpoints but thin/late
- 8 = strong balance with timely counterpoints and proportionate sourcing
- 10 = exemplary balance, symmetric scrutiny

Output ONLY this JSON:
{
  "balance_score": NUMBER_0_TO_10,
  "balanced_elements": [
    { "type": "Counterpoint/DataDisclosure/Attribution/Placement", "explanation": "short note" }
  ],
  "confidence": "High/Medium/Low"
}

TEXT:
${textToAnalyze}
`,

  // ---------- 5) QUOTES ----------
  createQuotePrompt: (contextData, textToAnalyze) => `
Context: ${contextData}

Extract ONLY direct quotes. Do NOT infer article bias from quoted content.

Rules:
- Include: Text in quotation marks OR explicitly attributed verbatim speech
- Exclude: Paraphrases, summaries, indirect speech
- Assess: How the article frames each quote (attribution style)
- Note: Loaded language in quotes reflects SOURCE bias, not article bias

Also compute the share of quotes that contain loaded terms.

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
  "quotes_with_loaded_terms": NUMBER_OF_QUOTES_WITH_LOADED_TERMS,
  "total_quotes": TOTAL_NUMBER_OF_QUOTES,
  "confidence": "High/Medium/Low"
}

If no quotes: {"quotes": [], "quotes_with_loaded_terms": 0, "total_quotes": 0, "confidence": "High"}

TEXT:
${textToAnalyze}
`,

  // ---------- 6) DEEP MODE (optional agents) ----------
  createSourceDiversityPrompt: (contextData, textToAnalyze) => `
Context: ${contextData}

Evaluate source diversity:
- Count unique sources & institutions
- Identify if sources cluster ideologically
- Note missing obvious stakeholders

Output ONLY this JSON:
{
  "unique_sources": NUMBER,
  "clusters": ["short labels"],
  "missing_obvious": ["stakeholder names"],
  "confidence": "High/Medium/Low"
}

TEXT:
${textToAnalyze}
`,

  createFramingPrompt: (contextData, textToAnalyze) => `
Context: ${contextData}

Analyze story framing structure:
- Headline/lead vs counterpoint placement
- Early vs late burden of proof
- Omission of timely rebuttals

Output ONLY this JSON:
{
  "lead_theme": "short string",
  "counterpoint_position": "None/Early/Middle/Late",
  "burden_of_proof": "Symmetric/Asymmetric",
  "confidence": "High/Medium/Low"
}

TEXT:
${textToAnalyze}
`,

  createOmissionPrompt: (contextData, textToAnalyze) => `
Context: ${contextData}

Identify plausible omissions (clearly relevant facts/perspectives commonly expected by informed readers).

Output ONLY this JSON:
{
  "omissions": [
    { "item": "short description", "why_relevant": "short reason" }
  ],
  "confidence": "High/Medium/Low"
}

TEXT:
${textToAnalyze}
`,

  // ---------- 7) MODERATOR ----------
  createModeratorPrompt: (
    contextData,
    languageResponse,
    hunterResponse,
    skepticResponse,
    quoteResponse,
    analysisDepth,
    deepAnalysisResponses = null
  ) => {
    const deepSection = (analysisDepth === 'deep' && deepAnalysisResponses) ? `
SOURCE_DIVERSITY_JSON:
${deepAnalysisResponses.sourceDiversity}
FRAMING_JSON:
${deepAnalysisResponses.framing}
OMISSION_JSON:
${deepAnalysisResponses.omission}
` : '';

    return `You are the Moderator. Your task is to merge the agent evidence into a neutral, methodical report. You must adhere to strict evidence thresholds.

ALGORITHM (apply in order):
1) Analyze CONTEXT. If "is_opinion_or_analysis" is true, your primary rating MUST be "Unclear."
2) For News content, compute evidence points from HUNTER_JSON.bias_indicators: High=2, Medium=1, Low=0.5 (max 1 total from Low). A total score of 2 or more from at least 2 independent indicators is required to move the rating from "Center."
3) If SKEPTIC_JSON.balance_score is 8 or higher with "High" confidence, you MUST override the rating to "Center."
4) Use the evidence to populate the sections below EXACTLY as specified.

### Findings
- **Overall Bias Assessment:** [Your calculated rating: Center | Lean Left | Lean Right | Strong Left | Strong Right | Unclear]
- **Confidence:** [High | Medium | Low]
- **Key Observation:** [A one-sentence summary of the most significant factor influencing your rating, e.g., "The article maintains a neutral tone with strong source balance."]

### Biased Languages Used
- [List 2-4 of the most significant "loaded_phrases" from LANGUAGE_JSON. For each, provide the phrase, a brief explanation, and the neutral alternative. If none, state: "No significant loaded or biased language was identified in the narrative." ]

### Neutral Languages Used
- [List 1-3 of the most impactful "balanced_elements" from SKEPTIC_JSON. For each, describe the element and why it contributes to neutrality.]

### Methodology Note
- [Write a brief, DYNAMIC sentence explaining the logic for THIS specific analysis. Example: "This 'Center' rating was determined by a high balance score (9/10), which overrides minor instances of loaded language." or "The 'Lean Left' rating is based on multiple bias indicators, including selective framing and unbalanced sourcing."]

### Raw Agent Evidence (for your use only)
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
`;
  }
};
