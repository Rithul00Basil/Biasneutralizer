<div align="center">

# 🎯 BiasNeutralizer

### AI-Powered News Bias Detection & Neutralization

*Exposing media bias with hybrid AI - cloud intelligence meets on-device privacy*

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=google-chrome)](https://www.google.com/chrome/)
[![Gemini AI](https://img.shields.io/badge/Powered%20by-Gemini%20AI-orange?logo=google)](https://ai.google.dev/)
[![Privacy First](https://img.shields.io/badge/Privacy-First-green?logo=lock)](https://github.com)

[Features](#-features) • [How It Works](#-how-it-works) • [Installation](#-installation) • [Usage](#-usage) • [Architecture](#-architecture)

</div>

---

## 🌟 Overview

BiasNeutralizer is a powerful Chrome extension that detects and neutralizes bias in news articles using cutting-edge AI technology. It combines **cloud-scale multi-agent reasoning** with **on-device rewriting** and **real-time fact-checking** to give you instant clarity about media bias—without compromising your privacy.

### Why BiasNeutralizer?

- 🎭 **Multi-Agent Tribunal**: 8 specialized AI agents debate and cross-examine articles
- 🔍 **Real-Time Grounding**: NEW! Fact-checks articles with Google Search integration
- 🔒 **Privacy-First**: On-device AI analyzes and rewrites sensitive content locally
- ⚡ **Instant Highlighting**: See biased vs. neutral language with click-to-explain
- 📊 **Comprehensive Analysis**: Deep insights into framing, sourcing, and word choice
- 📚 **Analysis History**: Track and revisit past scans with full report storage
- 🎨 **Beautiful Interface**: Clean, modern glassmorphic design that matches your workflow

---

## ✨ Features

### 🔍 **Real-Time Fact-Checking & Grounding** ⚡ NEW!
- **Google Search Integration**: Automatically fact-checks articles with real-time web searches
- **Smart Query Generation**: AI generates 6-8 strategic verification queries per article
- **Source Citations**: Every claim is cross-referenced with authoritative sources
- **Grounding Insights**: See what external sources say about key claims
- **Cloud-Only Feature**: Requires Cloud Mode for secure API access

### 🎯 **Intelligent Bias Detection**
- **Language Analysis**: Identifies loaded, emotional, or judgmental language
- **Structural Bias**: Detects framing issues, source imbalances, and omissions
- **Quote Analysis**: Separates source bias from reporter's own voice
- **Context Awareness**: Understands article genre and tone

### 🎭 **Multi-Agent Tribunal**
Eight specialized AI roles work together:
- **Context Classifier** - Determines article type and tone
- **Language Analyst** - Flags loaded language and suggests neutral alternatives
- **Bias Hunter** - Identifies structural bias patterns
- **Skeptic** - Credits balanced journalism
- **Quote Analyst** - Analyzes attribution and source bias
- **Deep Specialists** - Source diversity, framing, and omission analysis (Deep mode only)
- **Prosecutor & Defense** - Debate the evidence with adversarial review
- **Judge** - Delivers final verdict and confidence rating

### ✍️ **On-Device Analysis & Neutralization**
- **Privacy Protected**: Analysis and rewrites happen locally on your device
- **Real-Time Streaming**: Watch AI transform biased text instantly
- **Smart Suggestions**: AI-powered neutral alternatives for every biased phrase
- **No Data Leaks**: Sensitive content never leaves your browser
- **Dual Mode**: Choose between Cloud (powerful) or Private (on-device) analysis

### 🎨 **User Experience**
- **Live Highlighting**: Yellow for biased, green for neutral phrases
- **Interactive Popups**: Click any highlight for detailed explanations
- **Side Panel**: Quick access without leaving your article
- **Results Dashboard**: Comprehensive analysis with streaming markdown insights
- **Analysis History**: Browse, search, and export past scans
- **Scanning Tips**: Helpful tips displayed during analysis
- **Beautiful UI**: Modern glassmorphic design with smooth animations

### ⚙️ **Customization**
- **Analysis Depth**: Choose Quick (5 agents, ~5s) or Deep (8 agents, ~20s) mode
- **Real-Time Grounding**: Toggle fact-checking with Google Search (Cloud mode only)
- **Private Mode**: Switch between Cloud (powerful) and Private (on-device) AI
- **Auto-Highlighting**: Toggle automatic phrase highlighting on results page
- **Storage Management**: Clear history and manage data with one click

---

## 🚀 How It Works

### The Four-Stage Process

```
📰 Article → 🔍 Fact-Check → 🤖 AI Tribunal → ✨ Neutralization
```

1. **📰 Local Extraction**
   - Content script extracts article text
   - Removes ads, navigation, and noise
   - Keeps payload under 500KB

2. **🔍 Real-Time Grounding** (Optional - Cloud Mode)
   - AI generates 6-8 strategic search queries
   - Gemini executes Google Search for each query
   - Collects citations and cross-references claims
   - Provides external context for tribunal analysis

3. **🤖 Cloud or On-Device Tribunal**
   - **Cloud Mode**: 8 AI agents analyze in parallel (Quick: 5 agents, Deep: 8 agents)
   - **Private Mode**: On-device AI analysis with Gemini Nano
   - Prosecutor vs Defense debate evidence
   - Judge delivers final verdict with confidence rating

4. **✨ On-Device Rewriting**
   - Gemini Nano runs locally on your device
   - Streams neutral alternatives in real-time
   - Zero article content leaves your browser

---



### Hybrid Workflow in Four Stages

1. **Local extraction and heuristics (tab):** `content/content.js` isolates article narrative, de-duplicates markup, and keeps the payload under 500K characters before any cloud call.

2. **Real-time grounding (service worker - optional):** When enabled, `background/background.js` uses the Grounding Coordinator to:
   - Generate 6-8 strategic verification queries using AI (`generateQueriesWithAI`)
   - Execute Google Search via Gemini's Search tool (`executeGroundedSearches`)
   - Collect citations and insights from authoritative sources
   - Format grounding context for tribunal analysis

3. **Cloud or on-device tribunal (service worker/tab):** 
   - **Cloud Mode**: `background/background.js` batches prompts from `shared/prompts-deep-cloud.js` or `shared/prompt-quick-cloud.js`, runs Gemini agents in parallel, then stages a prosecutor/defense/judge debate to reach a defensible verdict
   - **Private Mode**: Uses on-device prompts from `shared/prompts-deep-ondevice.js` or `shared/prompt-quick-ondevice.js` with Gemini Nano for local analysis

4. **On-device rewriting (tab):** When a user taps "Neutralize," the Chromium `Rewriter` API (Gemini Nano) rewrites phrases locally, streaming tokens straight into the modal without leaving the device.

### Multi-Agent Pipeline

| Phase | Role | Responsibility |
| --- | --- | --- |
| Pre-analysis (optional) | **Grounding Coordinator** | Generates search queries, executes Google Search, collects citations and insights for fact-checking. |
| Evidence gathering | **Context Classifier** | Determines genre, tone, and quote density to steer the rest of the stack. |
|  | **Language Analyst** | Flags only reporter-authored loaded language and proposes neutral alternatives. |
|  | **Bias Hunter** | Looks for falsifiable structural bias indicators (framing, sourcing, causality leaps). |
|  | **Skeptic** | Credits genuine balance signals and can override ratings when journalism is solid. |
|  | **Quote Analyst** | Separates source bias inside quotes from the reporter's own voice. |
| Deep mode (optional) | **Source Diversity, Framing, Omission Specialists** | Add beat-reporter style critiques on sourcing mix, headline integrity, and missing context. |
| Tribunal | **Prosecutor vs Defense** | Argue over the evidence to stress-test assumptions before the verdict. Uses grounding data when available. |
| Verdict | **Judge** | Issues the final bias rating, key observation, and confidence, enforced by hard rules (e.g., opinion pieces default to "Unclear"). |

---

## 🔧 Technology Stack

- **Google Generative Language API (Gemini 2.5 Pro, 2.5 Flash, Flash-Lite)** - Runs all cloud agents via `https://generativelanguage.googleapis.com/v1beta/models/...:generateContent` with automatic model fallbacks, thinking budgets, and **Google Search grounding tool** for real-time fact-checking.
- **Chromium on-device AI (Gemini Nano)** - Powers both local analysis and rewriting; requires Chrome 128+ with `chrome://flags/#prompt-api-for-gemini-nano` and `chrome://flags/#rewriter-api-for-gemini-nano` enabled.
- **Chrome Extension APIs** - `chrome.storage`, `chrome.tabs`, `chrome.runtime`, `chrome.sidePanel`, `chrome.action`, and message passing glue the workflow together without any external backend.
- **Markdown Rendering** - Custom markdown renderer with syntax highlighting, LaTeX support, and DOMPurify sanitization for secure content display.
- **IntersectionObserver** - Smooth animations and lazy loading for the results dashboard and history page.

---

## 🔒 Privacy & Security

- **No middleman servers.** The extension never proxies through an external backend; your Gemini API key communicates directly with Google's servers over HTTPS.
- **Minimum necessary payloads.** Article text is extracted client-side, stripped to narrative content, truncated to 500K characters, and conversation history is cleared after analysis.
- **Local-only secrets.** API keys are stored in `chrome.storage.local`, never synced across devices, and can be cleared anytime from settings.
- **On-device options.** Private Mode runs all analysis locally with Gemini Nano—zero article content sent to the cloud. Neutralization always happens on-device regardless of mode.
- **Secure grounding.** When Real-time Grounding is enabled, only search queries (not full article text) are sent to Google Search via Gemini API.
- **Clear state controls.** The Reports page exposes storage status with statistics. The background worker tears down scan controllers and cached payloads once analysis is delivered.
- **User control.** Toggle between Cloud Mode (powerful, requires API) and Private Mode (on-device, no internet needed for analysis) at any time.

---

## 📦 Installation

### Prerequisites

- **Chrome Browser**: 
  - Chrome Stable 128+ (basic features)
  - Chrome Dev/Canary 128+ recommended (for full on-device AI support)
- **Gemini API Key**: Get one free at [Google AI Studio](https://aistudio.google.com/app/apikey)
  - Free tier includes 15 requests/minute, 1,500 requests/day
  - Supports both Cloud analysis and Real-time Grounding features
- **Internet Connection**: Required for Cloud Mode and Real-time Grounding (Private Mode works offline after initial setup)

### Quick Install

1. **Clone the Repository**
   ```bash
   git clone https://github.com/yourusername/bias-neutralizer.git
   cd bias-neutralizer
   ```

2. **Load in Chrome**
   - Open Chrome and navigate to `chrome://extensions`
   - Enable **Developer mode** (top-right toggle)
   - Click **Load unpacked**
   - Select the `bias-neutralizer` folder

3. **Enable On-Device AI** (Required for Private Mode & Neutralization)
   - Go to `chrome://flags/#prompt-api-for-gemini-nano`
   - Set to **Enabled**
   - Go to `chrome://flags/#rewriter-api-for-gemini-nano`
   - Set to **Enabled**
   - Restart Chrome
   - Chrome will download Gemini Nano model (~2GB) in the background

4. **Configure Extension**
   - Click extension icon → **Settings**
   - Paste your Gemini API key
   - Run connection test
   - Customize analysis preferences

---

## 🎯 Usage

### Quick Start

1. **Navigate to any news article**
2. **Click the BiasNeutralizer icon** in your toolbar
3. **Toggle Real-time Grounding** (optional - enables fact-checking with Google Search)
4. **Hit "Scan Article"** in the side panel
5. **Watch the AI tribunal analyze** in real-time with live progress updates

### Features in Action

#### 📊 **View Analysis**
- Open the **Results Dashboard** for comprehensive insights
- See bias rating, evidence, methodology, and grounding citations
- Review tribunal debate transcripts with full argumentation
- View external fact-check sources when Real-time Grounding is enabled

#### 🎨 **Explore Highlights**
- **Yellow highlights** = Biased language
- **Green highlights** = Neutral phrasing
- **Click any highlight** for detailed explanation

#### ✨ **Neutralize Text**
- Click any yellow highlighted phrase
- Hit **"Neutralize"** button in the popup
- Watch on-device AI rewrite in real-time (streaming)
- See before/after comparison with explanation

#### 📚 **Browse History**
- Click **"View Reports"** in the side panel
- Search past analyses by title, URL, or source
- Export all reports as JSON for backup
- Delete individual or bulk reports
- View detailed statistics (total reports, this week, storage used)

#### ⚙️ **Customize Settings**
- **Analysis Depth**: Quick (5 agents, ~5s) or Deep (8 agents, ~20s)
- **Real-Time Grounding**: Enable fact-checking with Google Search (Cloud mode only)
- **Private Mode**: Switch between Cloud (powerful) and Private (on-device) analysis
- **Auto-Highlight**: Enable/disable automatic phrase highlighting
- **History**: View, search, export, and manage past scans in the Reports page

---



## 📁 Project Structure

```
bias-neutralizer/
├── 📂 background/              # Service worker & multi-agent orchestration
│   └── background.js           # AI tribunal coordinator + grounding system
├── 📂 content/                 # Content scripts for highlighting & neutralization
│   ├── content.js              # Article extraction & inline features
│   └── content.css             # Highlight styles
├── 📂 results/                 # Analysis dashboard
│   ├── results.html            # Results page
│   ├── results.js              # Dashboard logic with streaming markdown
│   ├── results.css             # Dashboard styles
│   └── markdown-renderer.js    # Custom markdown renderer with LaTeX support
├── 📂 reports/                 # Analysis history viewer
│   ├── reports.html            # History page with search & export
│   ├── reports.js              # History management logic
│   └── reports.css             # History page styles
├── 📂 settings/                # Extension settings page
│   ├── settings.html           # Settings UI
│   ├── settings.js             # Configuration logic
│   └── settings.css            # Settings styles
├── 📂 sidepanel/               # Side panel interface
│   ├── sidepanel.html          # Panel UI with Real-time toggle
│   ├── sidepanel.js            # Panel logic with grounding support
│   └── sidepanel.css           # Panel styles
├── 📂 shared/                  # Shared utilities & prompts
│   ├── prompts-deep-cloud.js   # Deep mode cloud prompts (8 agents)
│   ├── prompt-quick-cloud.js   # Quick mode cloud prompts (5 agents)
│   ├── prompts-deep-ondevice.js# Deep mode on-device prompts
│   ├── prompt-quick-ondevice.js# Quick mode on-device prompts
│   └── utils.js                # Helper functions
├── 📂 setup/                   # First-time setup & onboarding
├── 📂 help/                    # Help documentation & guides
├── 📂 icons/                   # Extension icons (16, 32, 48, 128px)
├── 📂 vendor/                  # Third-party libraries
│   └── fonts/                  # Custom fonts
├── manifest.json               # Extension manifest (v3)
└── README.md                   # You are here!
```

---



## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Google Gemini** - For powerful AI models (2.5 Pro, 2.5 Flash, Flash-Lite, Nano) and the Google Search grounding tool
- **Chrome Team** - For pioneering on-device AI APIs (Prompt API & Rewriter API)
- **Open Source Community** - For inspiration, tools, and best practices in AI-powered applications

---

<div align="center">

**Made with ❤️ for truth-seekers everywhere**

If you find BiasNeutralizer useful, please ⭐ star this repo!

[⬆ Back to Top](#-biasneutralizer)

</div>


