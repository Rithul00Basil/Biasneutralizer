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

BiasNeutralizer is a powerful Chrome extension that detects and neutralizes bias in news articles using cutting-edge AI technology. It combines **cloud-scale multi-agent reasoning** with **on-device rewriting** to give you instant clarity about media bias—without compromising your privacy.

### Why BiasNeutralizer?

- 🎭 **Multi-Agent Tribunal**: 8 specialized AI agents debate and cross-examine articles
- 🔒 **Privacy-First**: On-device AI rewrites sensitive content locally
- ⚡ **Real-Time Highlighting**: Instantly see biased vs. neutral language
- 📊 **Comprehensive Analysis**: Deep insights into framing, sourcing, and word choice
- 🎨 **Beautiful Interface**: Clean, modern design that matches your workflow

---

## ✨ Features

### 🔍 **Intelligent Bias Detection**
- **Language Analysis**: Identifies loaded, emotional, or judgmental language
- **Structural Bias**: Detects framing issues, source imbalances, and omissions
- **Quote Analysis**: Separates source bias from reporter's own voice
- **Context Awareness**: Understands article genre and tone

### 🎯 **Multi-Agent Tribunal**
Eight specialized AI roles work together:
- **Context Classifier** - Determines article type and tone
- **Language Analyst** - Flags loaded language and suggests neutral alternatives
- **Bias Hunter** - Identifies structural bias patterns
- **Skeptic** - Credits balanced journalism
- **Quote Analyst** - Analyzes attribution and source bias
- **Deep Specialists** - Source diversity, framing, and omission analysis
- **Prosecutor & Defense** - Debate the evidence
- **Judge** - Delivers final verdict and confidence rating

### ✍️ **On-Device Neutralization**
- **Privacy Protected**: Rewrites happen locally on your device
- **Real-Time Streaming**: Watch AI transform biased text instantly
- **Smart Suggestions**: AI-powered neutral alternatives
- **No Data Leaks**: Sensitive content never leaves your browser

### 🎨 **User Experience**
- **Live Highlighting**: Yellow for biased, green for neutral phrases
- **Interactive Popups**: Click any highlight for detailed explanations
- **Side Panel**: Quick access without leaving your article
- **Results Dashboard**: Comprehensive analysis with streaming insights
- **Dark Mode**: Beautiful glassmorphic design

### ⚙️ **Customization**
- **Analysis Depth**: Choose Quick or Deep mode
- **Auto-Highlighting**: Toggle automatic phrase highlighting
- **Private Mode**: Switch between cloud and on-device AI
- **Storage Management**: Clear history and manage data

---

## 🚀 How It Works

### The Three-Stage Process

```
📰 Article → 🤖 AI Tribunal → ✨ Neutralization
```

1. **📰 Local Extraction**
   - Content script extracts article text
   - Removes ads, navigation, and noise
   - Keeps payload under 500KB

2. **🤖 Cloud Tribunal**
   - 8 AI agents analyze in parallel
   - Prosecutor vs Defense debate
   - Judge delivers final verdict

3. **✨ On-Device Rewriting**
   - Gemini Nano runs locally
   - Streams neutral alternatives
   - Zero data leaves your device

---



### Hybrid workflow in three stages
1. **Local extraction and heuristics (tab):** `content/content.js` isolates article narrative, de-duplicates markup, and keeps the payload under 500K characters before any cloud call.
2. **Cloud tribunal (service worker):** `background/background.js` batches prompts from `shared/prompts.js`, runs the Gemini agents in parallel, then stages a prosecutor/defense/judge debate to reach a defensible verdict.
3. **On-device rewriting (tab):** When a user taps "Neutralize wording," the Chromium `Rewriter` API (Gemini Nano) rewrites phrases locally, streaming tokens straight into the modal without leaving the device.

### Multi-Agent Pipeline

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

---

## 🔧 Technology Stack

- **Google Generative Language API (Gemini 2.5 Pro, 2.5 Flash, 2.0 variants)** - Runs all cloud agents via `https://generativelanguage.googleapis.com/v1beta/models/...:generateContent` with automatic model fallbacks and thinking budgets.
- **Chromium on-device `Rewriter` API (Gemini Nano)** - Streams neutral rewrites locally; requires Chrome 128+ with `chrome://flags/#rewriter-api-for-gemini-nano` enabled today.
- **Chrome extension APIs** - `chrome.storage`, `chrome.tabs`, `chrome.runtime`, `chrome.sidePanel`, `chrome.action`, and message passing glue the workflow together without any external backend.
- **DOMPurify and IntersectionObserver** - Keep the results dashboard safe and animated while streaming markdown or LaTeX responses.

---

## 🔒 Privacy & Security

- **No middleman servers.** The extension never proxies through an external backend; your Gemini key talks directly to Google over HTTPS.
- **Minimum necessary payloads.** Article text is extracted client-side, stripped to narrative content, truncated to 500K characters, and forgets conversational history unless you opt in.
- **Local-only secrets.** API keys live in `chrome.storage.local`, are never synced, and can be cleared anytime.
- **On-device rewriting.** Neutralization happens with Gemini Nano on your machine, so sensitive paragraphs never leave the browser.
- **Clear state controls.** The dashboard exposes storage status, and the background worker tears down scan controllers and cached payloads once a verdict is delivered.

---

## 📦 Installation

### Prerequisites

- **Chrome Browser**: Dev or Canary 128+ (for on-device AI)
- **Gemini API Key**: Get one free at [Google AI Studio](https://makersuite.google.com/app/apikey)

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

3. **Enable On-Device AI** (Optional)
   - Go to `chrome://flags/#rewriter-api-for-gemini-nano`
   - Set to **Enabled**
   - Restart Chrome

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
3. **Hit "Scan Article"** in the side panel
4. **Watch the AI tribunal analyze** in real-time

### Features in Action

#### 📊 **View Analysis**
- Open the **Results Dashboard** for comprehensive insights
- See bias rating, evidence, and methodology
- Review tribunal debate transcripts

#### 🎨 **Explore Highlights**
- **Yellow highlights** = Biased language
- **Green highlights** = Neutral phrasing
- **Click any highlight** for detailed explanation

#### ✨ **Neutralize Text**
- Click a biased phrase
- Hit **"Neutralize"** button
- Watch AI rewrite in real-time
- See before/after comparison

#### ⚙️ **Customize Settings**
- **Analysis Depth**: Quick (5 sec) or Deep (20 sec)
- **Private Mode**: On-device only or cloud-assisted
- **Auto-Highlight**: Enable/disable automatic highlighting
- **History**: View and manage past scans

---

## 🎓 Advanced Usage

### Analysis Modes

| Mode | Agents | Speed | Detail |
|------|--------|-------|--------|
| **Quick** | 5 core agents | ~5 sec | Essential bias detection |
| **Deep** | 8 agents + specialists | ~20 sec | Comprehensive analysis |

### Keyboard Shortcuts

- `Ctrl+Shift+B` - Open side panel (coming soon)
- `Escape` - Close popups
- `Click highlight` - Show details

### API Configuration

**Environment Variables:**
```javascript
GEMINI_API_KEY=your_api_key_here
MODEL_PREFERENCE=gemini-2.5-pro // or gemini-2.0-flash
```

---

## 📁 Project Structure

```
bias-neutralizer/
├── 📂 background/        # Service worker & multi-agent orchestration
│   └── background.js     # AI tribunal coordinator
├── 📂 content/           # Content scripts for highlighting & neutralization
│   ├── content.js        # Article extraction & inline features
│   └── content.css       # Highlight styles
├── 📂 results/           # Analysis dashboard
│   ├── results.html      # Results page
│   ├── results.js        # Dashboard logic
│   └── results.css       # Dashboard styles
├── 📂 settings/          # Extension settings page
│   ├── settings.html     # Settings UI
│   ├── settings.js       # Configuration logic
│   └── settings.css      # Settings styles
├── 📂 sidepanel/         # Side panel interface
│   ├── sidepanel.html    # Panel UI
│   ├── sidepanel.js      # Panel logic
│   └── sidepanel.css     # Panel styles
├── 📂 shared/            # Shared utilities
│   ├── prompts.js        # AI prompt templates
│   └── utils.js          # Helper functions
├── 📂 setup/             # Onboarding flow
├── 📂 help/              # Help documentation
├── 📂 icons/             # Extension icons
├── manifest.json         # Extension manifest
└── README.md            # You are here!
```

---



## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Google Gemini** - For powerful AI models
- **Chrome Team** - For on-device AI APIs
- **Open Source Community** - For inspiration and tools

---

<div align="center">

**Made with ❤️ for truth-seekers everywhere**

If you find BiasNeutralizer useful, please ⭐ star this repo!

[⬆ Back to Top](#-biasneutralizer)

</div>


