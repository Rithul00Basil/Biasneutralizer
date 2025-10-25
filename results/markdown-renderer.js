// ========================================
// ENHANCED MARKDOWN RENDERING ENGINE
// Uses: marked.js + highlight.js + GFM support
// ========================================

/**
 * Initialize the markdown renderer with all required libraries
 * Call this once when the page loads
 */
async function initMarkdownRenderer() {
  // Check if libraries are loaded
  if (typeof marked === 'undefined') {
    console.error('marked.js not loaded. Include: <script src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>');
    return false;
  }
  
  if (typeof hljs === 'undefined') {
    console.warn('highlight.js not loaded. Syntax highlighting will be disabled.');
  }

  // Configure marked with GFM (GitHub Flavored Markdown)
  marked.setOptions({
    gfm: true,              // Enable GitHub Flavored Markdown
    breaks: true,           // Convert \n to <br>
    tables: true,           // Enable table support (critical!)
    headerIds: true,        // Add IDs to headers
    mangle: false,          // Don't escape HTML entities in links
    pedantic: false,        // Don't be overly strict
    smartLists: true,       // Intelligently handle nested lists
    smartypants: false,     // Don't convert quotes to smart quotes
  });

  // Custom renderer for syntax highlighting and copy buttons
  const renderer = new marked.Renderer();
  
  // Override code block rendering to add syntax highlighting + copy button
  renderer.code = function(code, language) {
    const validLanguage = language && hljs.getLanguage(language) ? language : 'plaintext';
    
    // Highlight code if highlight.js is available
    const highlightedCode = typeof hljs !== 'undefined' 
      ? hljs.highlight(code, { language: validLanguage }).value
      : escapeHtml(code);
    
    // Generate unique ID for copy button
    const codeId = 'code-' + Math.random().toString(36).substr(2, 9);
    
    return `
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span class="code-language">${validLanguage}</span>
          <button class="code-copy-btn" data-code-id="${codeId}" title="Copy code">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span class="copy-text">Copy</span>
          </button>
        </div>
        <pre><code id="${codeId}" class="hljs language-${validLanguage}">${highlightedCode}</code></pre>
      </div>
    `;
  };

  // Override table rendering to add wrapper class for styling
  renderer.table = function(header, body) {
    return `
      <div class="table-wrapper">
        <table class="markdown-table">
          <thead>${header}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  };

  // Override link rendering to add security attributes
  renderer.link = function(href, title, text) {
    const titleAttr = title ? ` title="${title}"` : '';
    return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
  };

  // Override blockquote for better styling
  renderer.blockquote = function(quote) {
    return `<blockquote class="markdown-blockquote">${quote}</blockquote>`;
  };

  // Use the custom renderer
  marked.use({ renderer });

  console.log('[MarkdownRenderer] Initialized with GFM, syntax highlighting, and copy buttons');
  return true;
}

/**
 * Convert markdown text to HTML with full GFM support
 * @param {string} markdownText - Raw markdown text from AI
 * @returns {string} Safe, rendered HTML
 */
function renderMarkdown(markdownText) {
  if (!markdownText) return '';

  try {
    // Parse markdown to HTML using marked
    const rawHtml = marked.parse(markdownText);
    
    // Sanitize with DOMPurify (keep safe HTML tags)
    const safeHtml = window.DOMPurify 
      ? DOMPurify.sanitize(rawHtml, {
          ALLOWED_TAGS: [
            // Text formatting
            'p', 'br', 'strong', 'em', 'u', 's', 'del', 'mark',
            // Headers
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            // Lists
            'ul', 'ol', 'li',
            // Code
            'code', 'pre', 'span',
            // Tables
            'table', 'thead', 'tbody', 'tr', 'th', 'td',
            // Quotes and dividers
            'blockquote', 'hr',
            // Links
            'a',
            // Custom wrappers
            'div', 'button', 'svg', 'rect', 'path', 'line', 'polyline'
          ],
          ALLOWED_ATTR: [
            'href', 'title', 'target', 'rel', 
            'class', 'id', 
            'data-code-id',
            // SVG attributes
            'width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
            'x', 'y', 'x1', 'y1', 'x2', 'y2', 'rx', 'ry', 'd', 'points'
          ],
          ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
        })
      : rawHtml;
    
    return safeHtml;
  } catch (error) {
    console.error('[MarkdownRenderer] Parse error:', error);
    // Fallback: return escaped text
    return `<p>${escapeHtml(markdownText)}</p>`;
  }
}

/**
 * Render markdown and inject into DOM element with event listeners
 * @param {HTMLElement} element - Target DOM element
 * @param {string} markdownText - Markdown text to render
 */
function renderMarkdownToElement(element, markdownText) {
  // Render markdown to HTML
  const html = renderMarkdown(markdownText);
  
  // Inject into element
  element.innerHTML = html;
  
  // Add copy button event listeners
  attachCopyButtonListeners(element);
  
  // Render LaTeX if KaTeX is available
  if (typeof renderMathInElement !== 'undefined') {
    try {
      renderMathInElement(element, {
        delimiters: [
          {left: '$$', right: '$$', display: true},
          {left: '$', right: '$', display: false},
          {left: '\\[', right: '\\]', display: true},
          {left: '\\(', right: '\\)', display: false}
        ],
        throwOnError: false
      });
    } catch (e) {
      console.warn('[MarkdownRenderer] LaTeX rendering error:', e);
    }
  }
}

/**
 * Attach click listeners to copy buttons in rendered markdown
 * @param {HTMLElement} container - Container element with code blocks
 */
function attachCopyButtonListeners(container) {
  const copyButtons = container.querySelectorAll('.code-copy-btn');
  
  copyButtons.forEach(button => {
    // Remove old listeners by cloning
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);
    
    newButton.addEventListener('click', async function() {
      const codeId = this.getAttribute('data-code-id');
      const codeElement = document.getElementById(codeId);
      
      if (!codeElement) return;
      
      try {
        // Get raw text content (without HTML tags)
        const code = codeElement.textContent;
        
        // Copy to clipboard
        await navigator.clipboard.writeText(code);
        
        // Visual feedback
        const copyText = this.querySelector('.copy-text');
        const originalText = copyText.textContent;
        
        copyText.textContent = 'Copied!';
        this.classList.add('copied');
        
        setTimeout(() => {
          copyText.textContent = originalText;
          this.classList.remove('copied');
        }, 2000);
        
      } catch (err) {
        console.error('[MarkdownRenderer] Copy failed:', err);
        
        // Fallback: select text
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(codeElement);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
  });
}

/**
 * Escape HTML entities for safety
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Stream-safe markdown rendering
 * Handles incomplete markdown gracefully during streaming
 * @param {string} partialMarkdown - Potentially incomplete markdown
 * @returns {string} Rendered HTML (may have incomplete blocks)
 */
function renderPartialMarkdown(partialMarkdown) {
  if (!partialMarkdown) return '';
  
  try {
    // Check if we're in the middle of a code block
    const codeBlockMatches = partialMarkdown.match(/```/g);
    const hasUnclosedCodeBlock = codeBlockMatches && codeBlockMatches.length % 2 !== 0;
    
    // If code block is open, temporarily close it for rendering
    const textToRender = hasUnclosedCodeBlock 
      ? partialMarkdown + '\n```'
      : partialMarkdown;
    
    return renderMarkdown(textToRender);
  } catch (error) {
    console.warn('[MarkdownRenderer] Partial render error:', error);
    return renderMarkdown(partialMarkdown);
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initMarkdownRenderer,
    renderMarkdown,
    renderMarkdownToElement,
    renderPartialMarkdown
  };
}
