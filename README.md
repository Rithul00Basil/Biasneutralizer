# BiasNeutralizer - Hybrid AI News Bias Detector

BiasNeutralizer is a Chrome extension built for hackathons (and beyond) that fuses cloud-scale multi-agent reasoning with on-device rewriting to expose bias in news coverage. It couples a tribunal of Gemini 2.5 agents with Chromium's local Gemini Nano rewriter so investigators, journalists, and everyday readers get instant clarity without surrendering their data.

- **Hybrid AI:** Cloud agents debate the article's structure while an on-device model rewrites loaded language directly in the page.
- **Tribunal-style analysis:** Eight specialized roles cross-examine the story before a judge delivers a verdict, bias rating, and methodology note.
- **Actionable UX:** A results dashboard, side panel, and inline highlights surface evidence, neutral alternatives, and quote-level context.

## Architecture

```mermaid
flowchart TD
    A[User News Tab] -->|Extract HTML + heuristics| B(Content Script)
    B -->|Sanitized article payload| C[Service Worker<br/>Multi-Agent Orchestrator]
    C -->|Prompt batches + retries| D[(Google Gemini APIs)]
    D -->|Structured evidence + verdict| C
    C -->|Chrome storage update| E[(chrome.storage.local)]
    E -->|Bias report + highlights| F[Results Dashboard / Side Panel]
    F -->|Highlight instructions| B
    B -->|Optional neutral rewrite| G[On-Device Rewriter<br/>(Gemini Nano)]
```

### Hybrid workflow in three stages
1. **Local extraction and heuristics (tab):** `content/content.js` isolates article narrative, de-duplicates markup, and keeps the payload under 500K characters before any cloud call.
2. **Cloud tribunal (service worker):** `background/background.js` batches prompts from `shared/prompts.js`, runs the Gemini agents in parallel, then stages a prosecutor/defense/judge debate to reach a defensible verdict.
3. **On-device rewriting (tab):** When a user taps "Neutralize wording," the Chromium `Rewriter` API (Gemini Nano) rewrites phrases locally, streaming tokens straight into the modal without leaving the device.

## Multi-agent pipeline

| Phase | Role | Responsibility |
| --- | --- | --- |
| Evidence gathering | Context classifier | Determines genre, tone, and quote density to steer the rest of the stack. |
|  | Language analyst | Flags only reporter-authored loaded language and proposes neutral alternatives. |
|  | Bias hunter | Looks for falsifiable structural bias indicators (framing, sourcing, causality leaps). |
|  | Skeptic | Credits genuine balance signals and can override ratings when journalism is solid. |
|  | Quote analyst | Separates source bias inside quotes from the reporter's own voice. |
| Deep mode (optional) | Source diversity, framing, omission specialists | Add beat-reporter style critiques on sourcing mix, headline integrity, and missing context. |
| Tribunal | Prosecutor vs defense | Argue over the evidence to stress-test assumptions before the verdict. |
| Verdict | Judge | Issues the final bias rating, key observation, and confidence, enforced by hard rules (for example, opinion pieces default to "Unclear"). |

## APIs and key libraries

- **Google Generative Language API (Gemini 2.5 Pro, 2.5 Flash, 2.0 variants)** - Runs all cloud agents via `https://generativelanguage.googleapis.com/v1beta/models/...:generateContent` with automatic model fallbacks and thinking budgets.
- **Chromium on-device `Rewriter` API (Gemini Nano)** - Streams neutral rewrites locally; requires Chrome 128+ with `chrome://flags/#rewriter-api-for-gemini-nano` enabled today.
- **Chrome extension APIs** - `chrome.storage`, `chrome.tabs`, `chrome.runtime`, `chrome.sidePanel`, `chrome.action`, and message passing glue the workflow together without any external backend.
- **DOMPurify and IntersectionObserver** - Keep the results dashboard safe and animated while streaming markdown or LaTeX responses.

## Privacy by design

- **No middleman servers.** The extension never proxies through an external backend; your Gemini key talks directly to Google over HTTPS.
- **Minimum necessary payloads.** Article text is extracted client-side, stripped to narrative content, truncated to 500K characters, and forgets conversational history unless you opt in.
- **Local-only secrets.** API keys live in `chrome.storage.local`, are never synced, and can be cleared anytime.
- **On-device rewriting.** Neutralization happens with Gemini Nano on your machine, so sensitive paragraphs never leave the browser.
- **Clear state controls.** The dashboard exposes storage status, and the background worker tears down scan controllers and cached payloads once a verdict is delivered.

## Getting started

1. **Install dependencies:** Use Chrome Dev or Canary 128+ to access the on-device Rewriter API. Create a Google AI Studio Gemini API key.
2. **Load the extension:**
   - Clone or download this repo.
   - Open `chrome://extensions`, enable "Developer mode", click "Load unpacked", and choose this folder.
3. **Configure settings:**
   - Open the extension options (`chrome://extensions/?id=<extension-id>` -> "Details" -> "Extension options").
   - Paste your Gemini API key and run the built-in connection test.
   - Choose Quick vs Deep analysis, enable auto-highlighting, and decide whether to preload Gemini Nano.
4. **Run a scan:**
   - Navigate to a news article, open the side panel, or click the action button.
   - Watch the tribunal stream in the Results view, highlight biased phrases directly on the page, or invoke the Neutralizer modal for on-device rewrites.

## Project layout

```
background/       Service worker orchestrating multi-agent Gemini flows
content/          In-tab extractor, highlighter, and on-device rewriter modal
results/          Dashboard UI with streaming assistant and analysis cards
settings/         Options page for API keys, analysis depth, and feature toggles
shared/           Prompt factory powering every agent role
setup/ and help/  Guided onboarding and FAQ for users and judges
```


