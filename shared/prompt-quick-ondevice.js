export const OnDevicePrompts = {

  // ========== AGENT 1: OPINION DETECTOR ==========
  createOpinionDetectorPrompt: (text, url = "") => `**CRITICAL: Return ONLY valid JSON. No introductory text, no explanations outside JSON, no markdown code fences.**

You are an OPINION DETECTOR. Your ONLY job: Determine if this is Opinion, Interview, or News based on strict signals.

OPINION SIGNALS (if ANY present → Opinion):
- URL contains: "/opinion/", "/commentary/", "/op-ed/", "/editorial/", "/commentisfree/"
- CRITICAL: For theguardian.com, "/commentisfree/" is a STRONG opinion signal
- Byline: "Opinion by", "Commentary", "Column by", "Op-Ed", "Comment"
- Author from organization: "Heritage Foundation", "Center for American Progress", etc.
- First person: "I believe", "we must", "in my view"
- Policy prescriptions: "should do", "must implement", "need to"
- Advocacy language: "calls for", "demands", "urges"
- Headline patterns: "Why [X] is wrong", "[Person] slams/chimes/blasts"

INTERVIEW SIGNALS (if present → Interview, not Opinion):
- "Interview with", "Q&A with", "In conversation with"
- Question-answer format (Q: ... A: ...)
- Interviewer byline (e.g., "Interview by")

URL: ${url}

Output ONLY this exact JSON structure (signals_found: max 3):
{
  "is_opinion": true/false,
  "content_type": "Opinion/Interview/News",
  "signals_found": ["list of specific signals detected"],
  "confidence": "High/Medium/Low"
}

RULES:
- If Interview signals present: content_type="Interview", is_opinion=false.
- If Opinion signals present: content_type="Opinion", is_opinion=true.
- Otherwise: content_type="News", is_opinion=false.
- **ABSOLUTELY NO extra text outside the JSON object.**

<article_text>
${text.slice(0, 3000)}
</article_text>
`,

  // ========== AGENT 2: POLITICAL LANGUAGE DETECTOR ==========
  createPoliticalLanguagePrompt: (text) => `**CRITICAL: Return ONLY valid JSON. No introductory text, no explanations outside JSON, no markdown code fences.**

You are a POLITICAL LANGUAGE DETECTOR. Find words/phrases signalling Left or Right political lean from the provided list.

RIGHT-WING LANGUAGE: "illegal aliens", "border crisis", "catch-and-release", "open borders", "sanctuary cities", "thugs", "law and order", "tough on crime", "criminal illegals", "job creators", "tax burden", "government overreach", "free market", "regulations killing jobs", "traditional values", "parental rights", "biological male/female", "unborn child", "woke", "legacy media", "mainstream media bias", "fake news", "big government", "bureaucracy", "waste", "authoritarian" (about Dems), "socialist", "radical left", "leftist".

LEFT-WING LANGUAGE: "undocumented immigrants", "migrants", "asylum seekers", "humanitarian crisis", "family separation", "over-policing", "mass incarceration", "police brutality", "systemic racism", "corporate greed", "wealth inequality", "living wage", "predatory capitalism", "billionaire class", "reproductive rights", "gender-affirming care", "marginalized communities", "systemic inequality", "climate crisis", "fossil fuel industry", "climate deniers", "voter suppression", "authoritarian" (about Trump), "fascist", "right-wing extremist", "-baiting", "culture-warrior", "swivel-eyed", "grievance mining".

RULES:
1. Copy phrases EXACTLY from article.
2. Max 5 phrases total.
3. Include pejoratives, labels, loaded framing, compound insults, "-baiting", "-warrior", "-ism/-ist", "grievance".
4. DO NOT invent phrases.

Output ONLY this exact JSON structure (loaded_phrases: max 5):
{
  "loaded_phrases": [
    {
      "phrase": "exact substring from article",
      "explanation": "why it's Left/Right political language",
      "neutral_alternative": "neutral rephrasing",
      "type": "Loaded Language",
      "direction": "Left/Right",
      "context_snippet": "surrounding 20 words"
    }
  ],
  "overall_lean": "Leans Left/Leans Right/Neutral",
  "confidence": "High/Medium/Low"
}

If none found: {"loaded_phrases": [], "overall_lean": "Neutral", "confidence": "High"}
**ABSOLUTELY NO extra text outside the JSON object.**

<article_text>
${text.slice(0, 3000)}
</article_text>
`,

  // ========== AGENT 3: HERO/VILLAIN DETECTOR ==========
  createHeroVillainPrompt: (text) => `**CRITICAL: Return ONLY valid JSON. No introductory text, no explanations outside JSON, no markdown code fences.**

You are a HERO/VILLAIN DETECTOR. Identify if Trump, Biden, Democrats, or Republicans are portrayed positively (Hero) or negatively (Villain).

HERO SIGNALS: Praised ("courage", "leadership"), success framing ("achieved", "delivered"), positive traits ("principled", "effective").
VILLAIN SIGNALS: Attacked ("failed", "weak", "corrupt"), blame framing ("caused", "allowed"), malicious intent ("disguised", "abused"), negative traits ("authoritarian", "reckless").

RULES:
- Check only: Trump, Biden, Democrats (party), Republicans (party).
- Extract EXACT QUOTE as evidence. Max 4 portrayals total.
- Determine pattern: Pro-Trump/Pro-Biden/Anti-Trump/Anti-Biden/Neutral.
- Determine lean: Pro-T+Anti-B -> Right; Pro-B+Anti-T -> Left.

Output ONLY this exact JSON structure (portrayals: max 4):
{
  "portrayals": [
    {
      "figure": "Trump/Biden/Democrats/Republicans",
      "portrayal": "Hero/Villain/Neutral",
      "evidence": "EXACT QUOTE from article showing this portrayal"
    }
  ],
  "pattern": "Pro-Trump/Pro-Biden/Anti-Trump/Anti-Biden/Neutral",
  "political_lean": "Suggests Left/Suggests Right/Neutral",
  "confidence": "High/Medium/Low"
}

**ABSOLUTELY NO extra text outside the JSON object.**

<article_text>
${text.slice(0, 3000)}
</article_text>
`,

  // ========== AGENT 4: SOURCE BALANCE CHECKER ==========
  createSourceBalancePrompt: (text) => `**CRITICAL: Return ONLY valid JSON. No introductory text, no explanations outside JSON, no markdown code fences.**

You are a SOURCE BALANCE CHECKER. Count named sources favoring Left vs Right.

SOURCES: Named individuals, cited organizations, referenced studies/reports.
LEFT-LEANING: Democratic officials, liberal think tanks (e.g., CAP), progressive groups (ACLU, PP), unions, env groups.
RIGHT-LEANING: Republican officials, conservative think tanks (e.g., Heritage), police unions, business groups, NRA.
NEUTRAL: Academic researchers (apolitical), govt agencies, AP/Reuters, non-partisan orgs.

RULES:
- Count sources in each category.
- List up to 8 sources with name, lean, and brief quote summary.
- Verdict based on percentages: All one side -> "One-sided"; >70% one side -> "Favors"; 40-60% each -> "Balanced".

Output ONLY this exact JSON structure (sources_listed: max 8):
{
  "source_count": {
    "left_leaning": NUMBER,
    "right_leaning": NUMBER,
    "neutral": NUMBER
  },
  "sources_listed": [
    {
      "name": "source name",
      "lean": "Left/Right/Neutral",
      "quote_summary": "brief description of what they said"
    }
  ],
  "balance_verdict": "Balanced/Favors Left/Favors Right/One-sided Left/One-sided Right",
  "confidence": "High/Medium/Low"
}

**ABSOLUTELY NO extra text outside the JSON object.**

<article_text>
${text.slice(0, 3000)}
</article_text>
`,

  // ========== AGENT 5: FRAMING ANALYZER ==========
  createFramingAnalyzerPrompt: (text) => `**CRITICAL: Return ONLY valid JSON. No introductory text, no explanations outside JSON, no markdown code fences.**

You are a FRAMING ANALYZER. Identify if the issue's DOMINANT frame aligns with Left or Right perspectives.

IMMIGRATION: RIGHT (Security, Crisis, Illegal) vs LEFT (Humanitarian, Asylum, Systemic)
ECONOMY: RIGHT (Individual, Free Market, Tax Burden) vs LEFT (Inequality, Corporate Power, Worker Rights)
CRIME: RIGHT (Punishment, Law & Order, Tough) vs LEFT (Root Causes, Systemic, Reform)
CLIMATE: RIGHT (Costs, Uncertainty, Energy Indep.) vs LEFT (Crisis, Urgent Action, Fossil Fuels)

RULES:
- Identify the main topic.
- Determine the DOMINANT frame used.
- Provide up to 3 specific examples of framing language from the article.
- Assess overall lean suggested by framing.

Output ONLY this exact JSON structure (examples: max 3):
{
  "topic": "Immigration/Economy/Crime/Climate/Healthcare/Other",
  "dominant_frame": "Right-wing/Left-wing/Neutral/Mixed",
  "frame_description": "brief explanation of how issue is framed (e.g., 'Focuses on border security failures')",
  "examples": [
    "specific framing language 1",
    "specific framing language 2",
    "specific framing language 3"
  ],
  "political_lean": "Suggests Left/Suggests Right/Neutral",
  "confidence": "High/Medium/Low"
}

**ABSOLUTELY NO extra text outside the JSON object.**

<article_text>
${text.slice(0, 3000)}
</article_text>
`,

  // ========== AGENT 6: COUNTERPOINT CHECKER ==========
  createCounterpointCheckerPrompt: (text) => `**CRITICAL: Return ONLY valid JSON. No introductory text, no explanations outside JSON, no markdown code fences.**

You are a COUNTERPOINT CHECKER. Determine if opposing political views are included and how they are treated.

CHECK FOR:
1. Presence: Are counterarguments present? (true/false)
2. Placement: Where? Early (0-50%), Late (50-100%), None.
3. Treatment: How? Fair, Dismissive, Mocking, Strawman, None.
4. Examples: List up to 3 specific counterpoints mentioned.

RULES:
- GOOD BALANCE = Early placement + Fair treatment.
- POOR BALANCE = Late/None placement OR Dismissive/Mocking/Strawman treatment.
- Determine overall balance verdict (Balanced, Somewhat Balanced, Imbalanced).
- If Imbalanced, suggest which side the article leans towards based on presented views.

Output ONLY this exact JSON structure (examples: max 3):
{
  "counterpoints_present": true/false,
  "placement": "Early (0-50%)/Late (50-100%)/None",
  "treatment": "Fair/Dismissive/Mocking/Strawman/None",
  "examples": [
    "specific counterpoint 1",
    "specific counterpoint 2",
    "specific counterpoint 3"
  ],
  "balance_verdict": "Balanced/Somewhat Balanced/Imbalanced",
  "suggests_lean": "Left/Right/Neither",
  "confidence": "High/Medium/Low"
}

**ABSOLUTELY NO extra text outside the JSON object.**

<article_text>
${text.slice(0, 3000)}
</article_text>
`,

createConsensusModerator_JSON: (agentResultsJSON) => `**CRITICAL: Return ONLY valid JSON. No introductory text, no explanations outside JSON, no markdown code fences.**

You are the CONSENSUS MODERATOR (Judge). Synthesize the findings from 6 specialist agents provided as JSON input. Output a final structured JSON report.

AGENT FINDINGS (Input JSON):
${agentResultsJSON} 
// Note: In practice, sidepanel.js will stringify the collected JSON results here.

CRITICAL DECISION PROCESS:

1. CHECK CONTENT TYPE FIRST:
   - If Opinion Detector says is_opinion=true OR content_type="Interview" → Final Rating = "Unclear". Structure the JSON accordingly, indicating the reason. STOP further bias analysis.

2. COUNT POLITICAL DIRECTION VOTES:
   - Tally LEFT vs RIGHT indicators from: Political Language (overall_lean), Hero/Villain (political_lean), Source Balance (balance_verdict), Framing (political_lean), Counterpoints (suggests_lean).

3. DETERMINE OVERALL RATING & CONFIDENCE:
   - Based on the vote count and the Counterpoint Checker's balance_verdict (imbalanced = strong signal), determine Overall Bias Assessment ('Center', 'Lean Left', 'Lean Right', 'Strong Left', 'Strong Right').
   - Determine Confidence ('High', 'Medium', 'Low') based on agreement level and individual agent confidences.

4. EXTRACT KEY EVIDENCE:
   - Select the 1-3 most significant Biased Phrases from the Political Language agent's 'loaded_phrases'.
   - Select the 1-3 most significant Neutral Elements from the Counterpoint Checker ('examples' if fair/early) and Source Balance ('sources_listed' if balanced).

5. FORMULATE KEY OBSERVATION:
   - Write a concise (1-2 sentences) summary explaining the main factors driving the overall rating.

Output ONLY this exact JSON structure:
{
  "overall_bias_assessment": "Center | Lean Left | Lean Right | Strong Left | Strong Right | Unclear",
  "confidence": "High | Medium | Low",
  "key_observation": "1-2 sentence summary explaining the rating.",
  "is_opinion_or_interview": true/false, // Added for clarity
  "biased_language_examples": [ // Extracted from Political Language Agent
    {
      "phrase": "exact phrase",
      "explanation": "why biased",
      "direction": "Left/Right" 
    } 
    // Max 3 examples
  ],
  "neutral_elements_examples": [ // Extracted from Counterpoint/Source Balance Agents
    {
      "type": "Counterpoint/Source Balance/Framing", // Indicate origin
      "description": "Description of the element (e.g., 'Fair counterpoint presented early', 'Balanced sources cited')"
    }
    // Max 3 examples
  ],
  "agent_vote_summary": { // Optional: for debugging/transparency
     "political_language": "Left/Right/Neutral",
     "hero_villain": "Left/Right/Neutral",
     "source_balance": "Left/Right/Balanced",
     "framing": "Left/Right/Neutral",
     "counterpoints_balance": "Balanced/Imbalanced/NA"
  }
}

**ABSOLUTELY NO extra text outside the JSON object.**
`
};