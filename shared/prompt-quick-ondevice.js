// On-Device Quick Scan Prompts (Chrome Gemini Nano Optimized)
// Compressed for 1024 token limit - sacrifices verbosity for speed
// Use for Chrome Built-in AI only (window.LanguageModel)

export const OnDevicePrompts = {
  // ---------- 1) CONTEXT (Compressed) ----------
  createContextPrompt: (text) => `Return JSON only. Classify article type.
Types: News (factual reporting) | Opinion (labeled op-ed/column/commentary) | Analysis (interpretation beyond facts) | Satire | Academic | Other
Opinion markers: "Opinion:", "Column", "Commentary" in header OR first-person throughout (not just quotes)
Rules: Descriptive language is normal. Default to News unless explicit markers.

Output format:
{"type":"News/Opinion/Analysis/Satire/Academic/Other/Unknown","is_opinion_or_analysis":true/false,"summary":"exactly 10 words","tone":"Neutral/Emotional/Analytical/Mixed","confidence":"High/Medium/Low"}

Article: ${text}`,

  // ---------- 2) LANGUAGE (Compressed) ----------
  createLanguagePrompt: (context, text) => `Context: ${context}

Find biased/loaded phrases in NARRATIVE ONLY (exclude all quotes).

Flag ONLY: moral judgments without attribution | speculation as fact | emotional manipulation | unnecessary characterization | baseless hyperbole

Skip: descriptive adjectives | common verbs (announced, stated) | technical terms | sourced claims | temporal descriptors

Output:
{"loaded_phrases":[{"phrase":"exact text","explanation":"why biased","neutral_alternative":"factual version"}],"neutrality_score":0-10,"confidence":"High/Medium/Low"}

Article: ${text}`,

  // ---------- 3) HUNTER (Compressed) ----------
  createHunterPrompt: (context, text) => `Context: ${context}

Find bias patterns in narrative. Default: unbiased unless strong evidence.

Flag: selective framing (counter-evidence buried >75% through) | unbalanced sourcing (>70% one side) | loaded descriptors without attribution | causality leaps | editorial insertion

Skip: inverted pyramid structure | beat reporting | investigative findings | data-driven conclusions | expert consensus

Output:
{"bias_indicators":[{"type":"Framing/Sourcing/Language/Causality/Editorial","example":"specific evidence","explanation":"why bias","strength":"Low/Medium/High"}],"overall_bias":"Strong Left/Lean Left/Center/Lean Right/Strong Right/Unclear","confidence":"High/Medium/Low"}

Article: ${text}`,

  // ---------- 4) SKEPTIC (Compressed) ----------
  createSkepticPrompt: (context, text) => `Context: ${context}

Score journalistic balance 0-10. Most professional news: 6-8.

Credit: attribution for claims | multiple sources | data cited | counterpoints in first 50% | transparency | both sides contacted

Examples must be 5-15 consecutive words copied verbatim from article.

Output:
{"balance_score":0-10,"balanced_elements":[{"type":"Attribution/Sources/Data/Counterpoint/Transparency","example":"exact 5-15 word phrase","explanation":"why demonstrates balance"}],"confidence":"High/Medium/Low"}

Article: ${text}`,

  // ---------- 5) MODERATOR (Simple Synthesis) ----------
  createModeratorPrompt: (chunksJSON) => `Synthesize bias analysis from article chunks.

Aggregate: loaded phrases, bias indicators, balance scores across all chunks.
Look for patterns: front-loaded emotion, late counterpoints, systematic bias.
Default: Center unless strong evidence (multiple corroborating indicators).

Rating scale: Center | Lean Left | Lean Right | Strong Left | Strong Right | Unclear
Confidence: High (clear evidence) | Medium (mixed) | Low (insufficient)

Output markdown format:
### Findings
- **Overall Bias Assessment:** [rating]
- **Confidence:** [level]
- **Key Observation:** [2-3 sentences explaining main factor in decision]

### Biased Language Identified
- **"[phrase]"**: [why problematic]. Alternative: *"[suggestion]"*
[or "No problematic language identified."]

### Balanced Journalism Elements
- [Specific technique with explanation]
[or "Article provides basic factual reporting."]

### Methodology Note
- [1 sentence on analysis approach]

Chunk data:
${chunksJSON}`
};
