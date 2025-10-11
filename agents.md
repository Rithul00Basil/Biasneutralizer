<ROLE>
You are an expert frontend developer tasked with a high-precision UI refactoring mission. Your goal is to translate detailed design instructions into flawless code modifications.

<CONTEXT>
The user requires a complete visual overhaul of the results.html page. The final design should feature a clean, balanced header, a modern chat input system, a consistent visual language across all components, and a large, immersive modal for the AI assistant, as specified in the user's design mockups.

<TASK>
You will apply four specific sets of modifications to the results.html and results.css files. Follow these instructions precisely to achieve the desired outcome.

1. Redesign the Header
Objective: Reconfigure the header for a modern, clean look. The brand identity should be on the left, the main action button on the right, and the background should be transparent.

Actions:

In results.html:

Locate the <header class="results-top-row">. Group the brand elements by wrapping the <div class="header-icon"> and the <h1 class="product-name"> within a new <a> tag that has the class results-title.

Move the <button class="back-link"...> to be the very last element inside the header.

In results.css:

Target the .results-top-row selector. Set its display to flex, justify-content to space-between, and remove the background, backdrop-filter, and border-bottom properties entirely.

2. Correct the Methodology Card Background
Objective: Ensure the methodology card's background perfectly matches the other analysis cards.

Actions:

In results.css:

Find the .methodology-card selector and delete the unique background and border properties from it. This will allow it to inherit the standard styling from the .analysis-card class.

3. Redesign the Assistant Modal to be Immersive
Objective: Transform the assistant modal into a large, near-full-screen experience as per the user's design, and simplify its title.

Actions:

In results.html:

Within the <div class="assistant-modal"...>, find the <h3> with the class assistant-title and change its text to simply "Assistant".

In results.css:

Target the .assistant-modal selector.

Set its width to 90vw (90% of the viewport width).

Set its height to 90vh (90% of the viewport height).

To ensure it looks good on very large screens, add a max-width of 1200px and a max-height of 950px.

4. Redesign the "Ask Anything" Bar and Send Button
Objective: Implement the new, modern, pill-shaped design for the chat inputs and buttons.

Actions:

In results.html:

Locate the <div class="assistant-trigger-container">. Remove the <span> with the class assistant-arrow.

Find the <button class="assistant-send-btn"> inside the modal's footer. Replace its current SVG icon with a new SVG for a simple "up arrow". The SVG should look like this: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>.

In results.css:

Target .assistant-trigger-container. Change its border-radius to var(--radius-full).

Target the .assistant-input inside the modal. Change its border-radius to var(--radius-full) and adjust its padding to 14px 24px.

Target the .assistant-send-btn. Set its width and height to 48px. Ensure the new "up arrow" SVG is centered within it.