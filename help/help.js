/**
 * BiasNeutralizer Help Page Controller
 * Manages navigation and interactions on the help page
 */

document.addEventListener('DOMContentLoaded', () => {
  console.log('[BiasNeutralizer] Help page initializing...');

  // ========================================
  // DOM ELEMENTS
  // ========================================
  const backButton = document.getElementById('back-button');
  const quickNavLinks = document.querySelectorAll('.quick-nav-link');
  const modeChips = document.querySelectorAll('.mode-chip');
  const comparisonTable = document.getElementById('comparison-table');

  // ========================================
  // NAVIGATION
  // ========================================

  /**
   * Handles back button click - navigates to sidepanel
   */
  function handleBackClick(e) {
    e.preventDefault();
    console.log('[BiasNeutralizer] Navigating back to sidepanel');
    
    // Direct navigation to sidepanel (most reliable in extension context)
    window.location.href = chrome.runtime.getURL('sidepanel/sidepanel.html');
  }

  /**
   * Handles quick-nav anchor clicks - scrolls to section and opens it
   */
  function handleQuickNavClick(e) {
    e.preventDefault();
    const targetId = e.currentTarget.getAttribute('href').substring(1);
    const targetSection = document.getElementById(targetId);
    
    if (targetSection) {
      // Open the details element
      targetSection.setAttribute('open', '');
      
      // Smooth scroll to section
      targetSection.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
      
      // Update URL hash without jumping
      history.pushState(null, null, `#${targetId}`);
    }
  }

  /**
   * Handles mode chip clicks to switch table content
   */
  function handleModeChipClick(e) {
    const clickedChip = e.currentTarget;
    const mode = clickedChip.getAttribute('data-mode');
    
    // Update active state
    modeChips.forEach(chip => chip.classList.remove('active'));
    clickedChip.classList.add('active');
    
    // Update table content based on mode
    if (!comparisonTable) return;
    
    const rows = comparisonTable.querySelectorAll('tbody tr');
    
    // Hide all rows first
    rows.forEach(row => row.style.display = 'none');
    
    // Show relevant rows based on mode
    if (mode === 'privacy') {
      rows[0].style.display = ''; // Privacy row
    } else if (mode === 'depth') {
      rows[2].style.display = ''; // Analysis Depth row
    } else if (mode === 'speed') {
      rows[1].style.display = ''; // Speed row
    }
  }

  /**
   * Copy text to clipboard
   */
  function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(() => {
      const originalText = button.textContent;
      button.textContent = '✓ Copied';
      button.classList.add('copied');
      
      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('copied');
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  }

  /**
   * Add copy buttons next to code elements
   */
  function addCopyButtons() {
    const codeElements = document.querySelectorAll('code');
    
    codeElements.forEach(code => {
      const text = code.textContent;
      
      // Only add copy button for URLs and flags
      if (text.includes('chrome://') || text.includes('http')) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.setAttribute('aria-label', `Copy ${text}`);
        
        copyBtn.addEventListener('click', (e) => {
          e.preventDefault();
          copyToClipboard(text, copyBtn);
        });
        
        // Wrap code and button in container
        const wrapper = document.createElement('span');
        wrapper.className = 'code-with-copy';
        code.parentNode.insertBefore(wrapper, code);
        wrapper.appendChild(code);
        wrapper.appendChild(copyBtn);
      }
    });
  }

  // ========================================
  // EVENT LISTENERS
  // ========================================
  
  if (backButton) {
    backButton.addEventListener('click', handleBackClick);
  }
  
  quickNavLinks.forEach(link => {
    link.addEventListener('click', handleQuickNavClick);
  });
  
  modeChips.forEach(chip => {
    chip.addEventListener('click', handleModeChipClick);
  });
  
  // Initialize copy buttons
  addCopyButtons();
  
  // Open section from URL hash on load
  if (window.location.hash) {
    const targetId = window.location.hash.substring(1);
    const targetSection = document.getElementById(targetId);
    if (targetSection) {
      targetSection.setAttribute('open', '');
      setTimeout(() => {
        targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }

  console.log('[BiasNeutralizer] Help page ready');
});