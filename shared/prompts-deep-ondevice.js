// On-Device Deep Mode AI Prompts
// Simplified tribunal for Gemini Nano (no streaming, shorter prompts, 10k char limit)

export const DeepOnDevicePrompts = {
  
  // ---------- 1) CONTEXT ----------
  createContextPrompt: (textToAnalyze) => `
Return only JSON. No prose, no code fences.

You are a neutral classifier. Default to "News" for standard reporting.

Task: Classify genre and extract context.

Definitions:
- News: Factual reporting
- Opinion: Explicitly labeled opinion pieces
- Analysis: In-depth interpretation
- Other: Press release, transcript, etc.

Rules:
- Only classify as Opinion if explicitly labeled in header/byline
- Quote ratio: Low = 0–25%, Medium = 26–50%, High = 51–100%

Output ONLY this JSON:
{
  "type": "News/Opinion/Analysis/Other",
  "is_opinion_or_analysis": true/false,
  "summary": "exactly ten words describing main topic",
  "tone": "Neutral/Emotional/Analytical",
  "quote_ratio": "Low/Medium/High",
  "confidence": "High/Medium/Low"
}

<article_text>
${textToAnalyze.slice(0, 10000)}
</article_text>
`,

  // ---------- 2) LANGUAGE ----------
  createLanguagePrompt: (contextData, textToAnalyze) => `
Return only JSON. No prose, no code fences.

Context: ${contextData}

Analyze ONLY reporter's narrative (exclude ALL quoted material).

STRICT CRITERIA - Flag phrases ONLY when ALL conditions met:
1) Contains clear judgment, emotion, or speculation beyond facts
2) Substantially changes reader interpretation
3) A meaningfully different neutral alternative exists

NEVER FLAG:
- Standard descriptive adjectives (large, small, new, old)
- Common news verbs (announced, reported, stated)
- Technical terms (recession, surge, crisis)
- Sourced assessments ("experts say")

ONLY FLAG:
- Unsourced moral judgments ("shameful", "heroic")
- Speculation as fact ("clearly intends")
- Emotionally manipulative language
- Unnecessary characterization

Output ONLY this JSON:
{
  "loaded_phrases": [
    {
      "phrase": "exact narrative phrase",
      "explanation": "specific reason this crosses into bias",
      "neutral_alternative": "factual alternative",
      "context_snippet": "30 chars surrounding"
    }
  ],
  "neutrality_score": NUMBER_0_TO_10,
  "confidence": "High/Medium/Low"
}

If none: {"loaded_phrases": [], "neutrality_score": 10, "confidence": "High"}

<article_text>
${textToAnalyze.slice(0, 10000)}
</article_text>
`,

  // ---------- 3) HUNTER ----------
  createHunterPrompt: (contextData, textToAnalyze) => `
Return only JSON. No prose, no code fences.

Context: ${contextData}

Find CLEAR bias patterns. Default: article is unbiased.

HIGH BAR CRITERIA:
- Selective framing (HIGH): Counter-evidence buried after 75%
- Unbalanced sourcing (HIGH): >85% sources favor one side
- Loaded descriptors (HIGH): Moral language without attribution
- Editorial insertion (HIGH): Reporter's opinion stated as fact

REQUIRED THRESHOLDS:
- Need 3+ Medium indicators from DIFFERENT categories, OR
- 2 High indicators, OR
- 1 High + 2 Medium from different categories

Output ONLY this JSON:
{
  "bias_indicators": [
    {
      "type": "Framing/Sourcing/Language/Editorial",
      "example": "specific evidence",
      "explanation": "why this meets criteria",
      "strength": "Low/Medium/High"
    }
  ],
  "overall_bias": "Strong Left/Lean Left/Center/Lean Right/Strong Right/Unclear",
  "confidence": "High/Medium/Low"
}

Default to "Center" unless evidence meets thresholds.

<article_text>
${textToAnalyze.slice(0, 10000)}
</article_text>
`,

  // ---------- 4) SKEPTIC ----------
  createSkepticPrompt: (contextData, textToAnalyze) => `
Return only JSON. No prose, no code fences.

Context: ${contextData}

Identify journalistic quality and balance.

SCORING GUIDE (0-10):
- 0-2 = Clearly one-sided
- 3-4 = Minimal balance
- 5-6 = Some balance with gaps
- 7-8 = Good balance (MOST NEWS SHOULD SCORE HERE)
- 9-10 = Exceptional balance

CREDIT THESE:
- Attribution for all claims
- Multiple credible sources
- Data cited
- Counterarguments within first 50%
- Transparency about limitations

Output ONLY this JSON:
{
  "balance_score": NUMBER_0_TO_10,
  "balanced_elements": [
    { 
      "type": "Attribution/Sources/Data/Counterpoint", 
      "example": "5-15 consecutive words from article",
      "explanation": "why this demonstrates good journalism" 
    }
  ],
  "confidence": "High/Medium/Low"
}

Most professional news = 6-8.

<article_text>
${textToAnalyze.slice(0, 10000)}
</article_text>
`,

  // ---------- 5) PROSECUTOR ----------
  createProsecutorPrompt: (contextData, languageJSON, hunterJSON, skepticJSON) => `
Return only JSON. No prose, no code fences.

You are the Prosecutor. Build case for bias IF strong evidence exists.

<context>
${contextData}
</context>

<evidence>
LANGUAGE: ${JSON.stringify(languageJSON, null, 2)}
HUNTER: ${JSON.stringify(hunterJSON, null, 2)}
SKEPTIC: ${JSON.stringify(skepticJSON, null, 2)}
</evidence>

Formulate charges ONLY if you find:
1. Clear patterns across multiple evidence types
2. Substantial impact on reader interpretation
3. Evidence that would convince skeptical reader

REQUIREMENTS:
- Must have corroboration from 2+ agents
- Must involve more than isolated phrases
- Must show systematic pattern

CHARGE THRESHOLDS:
- HIGH: Systematic distortion with clear intent
- MEDIUM: Consistent pattern affecting interpretation
- LOW: Noticeable but limited impact

Output ONLY this JSON:
{
  "charges": [
    {
      "charge_id": "charge_1",
      "claim": "Specific, falsifiable claim about bias pattern",
      "supporting_evidence": [
        "Direct evidence from agents",
        "Corroborating evidence"
      ],
      "why_this_is_bias": "Explanation of impact",
      "severity": "Low/Medium/High"
    }
  ],
  "prosecution_summary": "Overview of case strength",
  "confidence": "High/Medium/Low"
}

If insufficient: {"charges": [], "prosecution_summary": "Insufficient evidence for systematic bias.", "confidence": "High"}
`,

  // ---------- 6) DEFENSE ----------
  createDefensePrompt: (prosecutorJSON, contextData, languageJSON, hunterJSON, skepticJSON) => `
Return only JSON. No prose, no code fences.

You are Defense Attorney. Challenge prosecution's case.

<prosecution>
${JSON.stringify(prosecutorJSON, null, 2)}
</prosecution>

<context>
${contextData}
</context>

<original_evidence>
LANGUAGE: ${JSON.stringify(languageJSON, null, 2)}
HUNTER: ${JSON.stringify(hunterJSON, null, 2)}
SKEPTIC: ${JSON.stringify(skepticJSON, null, 2)}
</original_evidence>

For EACH charge provide:
1. Alternative explanations grounded in journalism
2. Mitigating evidence from Skeptic
3. Context about standard practices

Output ONLY this JSON:
{
  "rebuttals": [
    {
      "charge_id": "charge_1",
      "counter_argument": "Why charge should be dismissed/downgraded",
      "mitigating_evidence": [
        "Evidence of balance",
        "Alternative explanation"
      ],
      "recommended_verdict": "Dismiss/Downgrade to Low/Sustain"
    }
  ],
  "defense_summary": "Overall argument for integrity",
  "confidence": "High/Medium/Low"
}
`,

  // ---------- 7) JUDGE ----------
  createJudgePrompt: (prosecutorJSON, defenseJSON, contextData) => `
Return structured markdown report. NO JSON.

You are Judge. Render fair verdicts.

<context>
${contextData}
</context>

<prosecution>
${JSON.stringify(prosecutorJSON, null, 2)}
</prosecution>

<defense>
${JSON.stringify(defenseJSON, null, 2)}
</defense>

VERDICT STANDARDS:
- Dismiss: Defense provides compelling alternative OR evidence weak
- Sustain: Evidence clear, pattern systematic
- Inconclusive: Arguments balanced

RATING THRESHOLDS:
- Center: No sustained charges OR minor issues
- Lean Left/Right: 1-2 sustained Medium OR 3+ Low
- Strong Left/Right: 2+ sustained High OR 3+ Medium
- Unclear: Opinion, insufficient evidence

Output ONLY this markdown:

### Findings
- **Overall Bias Assessment:** [Center | Lean Left | Lean Right | Strong Left | Strong Right | Unclear]
- **Confidence:** [High | Medium | Low]
- **Key Observation:** [2-3 sentences explaining primary factor in decision]

### Tribunal Verdicts
[For each charge:]
- **Charge [N]: [Claim]**
  - **Verdict:** [Sustained | Dismissed | Inconclusive]
  - **Reasoning:** [3-4 sentences weighing evidence]

[If no charges:]
- **No Charges Filed:** The article meets professional standards.

### Biased Language Identified
[For sustained charges:]
- **"[phrase]"**: [Explanation]. Alternative: *"[suggestion]"*

[If none:]
- No problematic language patterns identified.

### Balanced Journalism Elements
[List 2-3 positive elements:]
- [Specific technique with explanation]

### Methodology Note
- This assessment used an adversarial tribunal with [N] charges. [1-2 sentences about process]

REMEMBER: Most professional journalism = "Center".
`
};