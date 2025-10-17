/**
 * BiasNeutralizer Analysis History Page - Refactored
 * Manages display and interaction with saved analysis reports
 * 
 * Improvements:
 * - URL sanitization for security
 * - Auto-refresh on storage changes
 * - Fixed rename keydown bug
 * - Error safety guards
 * - Search functionality
 * - Export JSON feature
 * - Accessibility improvements
 */

document.addEventListener("DOMContentLoaded", () => {
  console.log("[Reports] Analysis History page loading...");

  // Chrome API Guards - prevents crashes when opened outside extension context
  const EXT = {
    has: typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.storage,
    url: (p) => (typeof chrome !== "undefined" && chrome?.runtime?.getURL) ? chrome.runtime.getURL(p) : p
  };

  // State
  let history = [];
  let sortDesc = true;
  let searchQuery = "";
  let initialPaint = true; // Track first render for animation optimization

  // DOM Elements
  const elements = {
    emptyState: document.getElementById("empty-state"),
    reportsList: document.getElementById("reports-list"),
    totalReports: document.getElementById("total-reports"),
    thisWeek: document.getElementById("this-week"),
    storageUsed: document.getElementById("storage-used"),
    sortButton: document.getElementById("sort-button"),
    sortLabel: document.querySelector(".sort-label"),
    backButton: document.getElementById("back-button"),
    searchInput: document.getElementById("search-input"),
    exportButton: document.getElementById("export-button")
  };

  // Validate elements
  for (const [key, element] of Object.entries(elements)) {
    if (!element) {
      console.warn(`[Reports] Missing element: ${key}`);
    }
  }

  /**
   * Sanitize URL to prevent javascript: and data: URIs
   * Only allows http and https protocols
   */
  function sanitizeUrl(url) {
    if (!url || typeof url !== "string") return "#";
    
    try {
      const parsed = new URL(url);
      // Only allow http and https protocols
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return url;
      }
    } catch (e) {
      // Invalid URL
      console.warn("[Reports] Invalid URL:", url);
    }
    
    return "#";
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  /**
   * Safe date parsing with fallback
   */
  function formatDate(timestamp) {
    try {
      if (!timestamp) return { dateStr: "Unknown", timeStr: "Unknown" };
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return { dateStr: "Unknown", timeStr: "Unknown" };
      
      const dateStr = date.toLocaleDateString("en-US", { 
        month: "short", 
        day: "numeric", 
        year: "numeric" 
      });
      const timeStr = date.toLocaleTimeString("en-US", { 
        hour: "2-digit", 
        minute: "2-digit" 
      });
      
      return { dateStr, timeStr };
    } catch (e) {
      console.error("[Reports] Date parsing error:", e);
      return { dateStr: "Unknown", timeStr: "Unknown" };
    }
  }

  /**
   * Safe domain extraction from URL
   */
  function extractDomain(url) {
    if (!url) return "Unknown";
    
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace("www.", "");
    } catch (e) {
      // Invalid URL, try to extract manually
      try {
        const match = String(url).match(/^(?:https?:\/\/)?(?:www\.)?([^\/]+)/i);
        return match ? match[1] : "Unknown";
      } catch (err) {
        return "Unknown";
      }
    }
  }

  /**
   * Load history from chrome.storage.local (guarded for non-extension context)
   */
  async function loadHistory() {
    try {
      if (!EXT.has) {
        // Not in extension context, show empty state
        history = [];
        render();
        updateStats();
        return;
      }
      const result = await chrome.storage.local.get(["analysisHistory"]);
      history = Array.isArray(result.analysisHistory) ? result.analysisHistory : [];
      console.log(`[Reports] Loaded ${history.length} reports from storage`);
      render();
      updateStats();
    } catch (error) {
      console.error("[Reports] Failed to load history:", error);
      showEmptyState();
    }
  }

  /**
   * Filter reports based on search query
   */
  function filterReports() {
    if (!searchQuery) return history;
    
    const query = searchQuery.toLowerCase();
    return history.filter(report => {
      const title = (report.title || "").toLowerCase();
      const url = (report.url || "").toLowerCase();
      const source = (report.source || "").toLowerCase();
      
      return title.includes(query) || url.includes(query) || source.includes(query);
    });
  }

  /**
   * Render the reports list
   */
  function render() {
    if (!elements.reportsList) return;

    // Clear the list
    elements.reportsList.innerHTML = "";

    // Filter reports based on search
    const filtered = filterReports();

    // Handle empty state
    if (filtered.length === 0) {
      if (searchQuery) {
        // Show "no results" message instead of empty state
        elements.emptyState.classList.remove("hidden");
        elements.emptyState.querySelector(".empty-title").textContent = "No Matching Reports";
        elements.emptyState.querySelector(".empty-description").textContent = 
          "Try adjusting your search query. Clear the search to see all reports.";
      } else {
        showEmptyState();
      }
      elements.reportsList.classList.add("hidden");
      return;
    }

    // Hide empty state, show list
    elements.emptyState?.classList.add("hidden");
    elements.reportsList.classList.remove("hidden");

    // Sort the filtered history
    const sorted = [...filtered].sort((a, b) => {
      const timeA = a.timestamp || 0;
      const timeB = b.timestamp || 0;
      return sortDesc ? (timeB - timeA) : (timeA - timeB);
    });

    // Create report items
    sorted.forEach((report, index) => {
      const item = createReportItem(report, index);
      // Only add fade animation on first render to prevent jank
      if (initialPaint) {
        item.classList.add("fade-in");
      }
      elements.reportsList.appendChild(item);
    });

    // Mark that initial paint is complete
    initialPaint = false;

    console.log(`[Reports] Rendered ${sorted.length} report items (filtered from ${history.length})`);
  }

  /**
   * Create a report item element
   */
  function createReportItem(report, index) {
    const div = document.createElement("div");
    div.className = "report-item";
    div.dataset.reportId = report.id || report.timestamp;
    div.dataset.index = index;

    const { dateStr, timeStr } = formatDate(report.timestamp);
    const domain = extractDomain(report.url);
    const safeUrl = sanitizeUrl(report.url);
    const sourceText = escapeHtml(report.source || "cloud");

    div.innerHTML = `
      <div class="report-header">
        <div class="report-info">
          <div class="report-title-wrapper">
            <span class="report-title">${escapeHtml(report.title || "Untitled Analysis")}</span>
            <input type="text" class="report-title-input hidden" value="${escapeHtml(report.title || "Untitled Analysis")}" aria-label="Edit report title" />
          </div>
          <div class="report-metadata">
            <div class="metadata-item">
              <span class="metadata-icon">📅</span>
              <span>${dateStr}</span>
            </div>
            <div class="metadata-divider"></div>
            <div class="metadata-item">
              <span class="metadata-icon">🕐</span>
              <span>${timeStr}</span>
            </div>
            <div class="metadata-divider"></div>
            <div class="metadata-item">
              <span class="metadata-icon">🌐</span>
              <a href="${safeUrl}" class="report-url" target="_blank" rel="noopener noreferrer">${escapeHtml(domain)}</a>
            </div>
            <div class="metadata-divider"></div>
            <div class="metadata-item">
              <span class="report-source-badge">${sourceText}</span>
            </div>
          </div>
        </div>
        <div class="report-actions">
          <button class="action-btn view-btn" data-action="view" aria-label="View full report">View</button>
          <button class="action-btn" data-action="rename" aria-label="Rename report">Rename</button>
          <button class="action-btn delete-btn" data-action="delete" aria-label="Delete report">Delete</button>
        </div>
      </div>
    `;

    return div;
  }

  /**
   * Show empty state
   */
  function showEmptyState() {
    if (elements.emptyState && elements.reportsList) {
      elements.emptyState.classList.remove("hidden");
      elements.reportsList.classList.add("hidden");
      elements.reportsList.innerHTML = "";
      
      // Reset empty state text
      elements.emptyState.querySelector(".empty-title").textContent = "No Analysis Reports Yet";
      elements.emptyState.querySelector(".empty-description").textContent = 
        "Your analysis history will appear here. Start by analyzing an article from the side panel.";
    }
  }

  /**
   * Update statistics
   */
  function updateStats() {
    if (!elements.totalReports) return;

    // Total reports
    elements.totalReports.textContent = history.length;

    // Reports this week
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const thisWeekCount = history.filter(r => (r.timestamp || 0) > oneWeekAgo).length;
    if (elements.thisWeek) {
      elements.thisWeek.textContent = thisWeekCount;
    }

    // Storage used (approximate)
    try {
      const storageStr = JSON.stringify(history);
      const bytes = new Blob([storageStr]).size;
      const kb = Math.round(bytes / 1024);
      if (elements.storageUsed) {
        elements.storageUsed.textContent = `${kb} KB`;
      }
    } catch (error) {
      console.error("[Reports] Storage calculation error:", error);
      if (elements.storageUsed) {
        elements.storageUsed.textContent = "N/A";
      }
    }

    console.log(`[Reports] Stats updated: ${history.length} total, ${thisWeekCount} this week`);
  }

  /**
   * Toggle sort order
   */
  function toggleSort() {
    sortDesc = !sortDesc;
    if (elements.sortLabel) {
      elements.sortLabel.textContent = sortDesc ? "Newest First" : "Oldest First";
    }
    console.log(`[Reports] Sort changed to: ${sortDesc ? "Newest First" : "Oldest First"}`);
    render();
  }

  /**
   * Handle search input
   */
  function handleSearch(event) {
    searchQuery = event.target.value.trim();
    console.log(`[Reports] Search query: "${searchQuery}"`);
    render();
  }

  /**
   * Export all reports as JSON
   */
  function handleExport() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
      const filename = `biasneutralizer-reports-${timestamp}.json`;
      
      const dataStr = JSON.stringify(history, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(dataBlob);
      
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      
      URL.revokeObjectURL(url);
      
      console.log(`[Reports] Exported ${history.length} reports to ${filename}`);
    } catch (error) {
      console.error("[Reports] Export failed:", error);
      alert("Failed to export reports. Please try again.");
    }
  }

  /**
   * Handle action button clicks (View, Rename, Delete)
   */
  async function handleAction(event) {
    const button = event.target.closest(".action-btn");
    if (!button) return;

    const action = button.dataset.action;
    const reportItem = button.closest(".report-item");
    if (!reportItem) return;

    const reportId = reportItem.dataset.reportId;
    const report = history.find(r => String(r.id || r.timestamp) === String(reportId));
    
    if (!report) {
      console.error("[Reports] Report not found:", reportId);
      return;
    }

    switch (action) {
      case "view":
        handleView(report);
        break;
      case "rename":
        handleRename(reportItem);
        break;
      case "delete":
        await handleDelete(report, reportItem);
        break;
    }
  }

  /**
   * Handle view action
   */
  function handleView(report) {
    console.log("[Reports] Viewing report:", report.id || report.timestamp);

    // Store the report ID in sessionStorage
    sessionStorage.setItem("selectedReportId", report.id || report.timestamp);

    // Navigate to results page (using guarded URL helper)
    window.location.href = EXT.url("results/results.html");
  }

  /**
   * Handle rename action (FIXED: removed once:true from keydown)
   */
  function handleRename(reportItem) {
    const titleSpan = reportItem.querySelector(".report-title");
    const titleInput = reportItem.querySelector(".report-title-input");
    
    if (!titleSpan || !titleInput) return;

    // Show input, hide span
    titleSpan.classList.add("hidden");
    titleInput.classList.remove("hidden");
    titleInput.focus();
    titleInput.select();

    // Handle save on blur
    const saveRename = async () => {
      const newTitle = titleInput.value.trim();
      if (!newTitle) {
        titleInput.value = titleSpan.textContent;
        titleInput.classList.add("hidden");
        titleSpan.classList.remove("hidden");
        return;
      }

      const reportId = reportItem.dataset.reportId;
      const report = history.find(r => String(r.id || r.timestamp) === String(reportId));
      
      if (report) {
        report.title = newTitle;
        titleSpan.textContent = newTitle;

        // Save to storage (guarded)
        if (EXT.has) {
          try {
            await chrome.storage.local.set({ analysisHistory: history });
            console.log("[Reports] Report renamed:", reportId, newTitle);
          } catch (error) {
            console.error("[Reports] Failed to save rename:", error);
          }
        }
      }

      // Hide input, show span
      titleInput.classList.add("hidden");
      titleSpan.classList.remove("hidden");
    };

    // Handle keydown (FIXED: removed once:true so it works every time)
    const handleKeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        titleInput.blur();
      } else if (e.key === "Escape") {
        titleInput.value = titleSpan.textContent;
        titleInput.blur();
      }
    };

    titleInput.addEventListener("blur", saveRename, { once: true });
    titleInput.addEventListener("keydown", handleKeydown);
    
    // Remove keydown listener after blur to prevent memory leaks
    titleInput.addEventListener("blur", () => {
      titleInput.removeEventListener("keydown", handleKeydown);
    }, { once: true });
  }

  /**
   * Handle delete action
   */
  async function handleDelete(report, reportItem) {
    const title = report.title || "this report";
    const confirmed = confirm(`Are you sure you want to delete "${title}"? This action cannot be undone.`);
    
    if (!confirmed) return;

    console.log("[Reports] Deleting report:", report.id || report.timestamp);

    // Remove from history array
    const index = history.findIndex(r => r === report);
    if (index > -1) {
      history.splice(index, 1);
    }

    // Save updated history (guarded)
    if (!EXT.has) {
      console.warn("[Reports] Cannot delete - not in extension context");
      return;
    }

    try {
      await chrome.storage.local.set({ analysisHistory: history });
      console.log("[Reports] Report deleted successfully");

      // Remove from DOM with animation
      reportItem.style.opacity = "0";
      reportItem.style.transform = "translateX(-20px)";

      setTimeout(() => {
        reportItem.remove();

        // Check if list is now empty
        if (history.length === 0) {
          showEmptyState();
        }

        updateStats();
      }, 300);

    } catch (error) {
      console.error("[Reports] Failed to delete report:", error);
      alert("Failed to delete report. Please try again.");
    }
  }

  /**
   * Handle back button click (closes the current tab)
   */
  function handleBackClick() {
    console.log("[Reports] Closing reports tab");
    // Close the current tab to return to previous tab with side panel
    try {
      window.close();
    } catch (error) {
      console.error("[Reports] Failed to close tab:", error);
    }
  }

  /**
   * Listen for storage changes and auto-refresh (guarded)
   */
  if (EXT.has && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes.analysisHistory) {
        console.log("[Reports] Storage changed, reloading...");
        loadHistory();
      }
    });
  }

  // Event Listeners
  if (elements.sortButton) {
    elements.sortButton.addEventListener("click", toggleSort);
  }

  if (elements.backButton) {
    elements.backButton.addEventListener("click", handleBackClick);
  }

  if (elements.searchInput) {
    elements.searchInput.addEventListener("input", handleSearch);
  }

  if (elements.exportButton) {
    elements.exportButton.addEventListener("click", handleExport);
  }

  // Event delegation for action buttons
  if (elements.reportsList) {
    elements.reportsList.addEventListener("click", handleAction);
  }

  // Initialize
  loadHistory();

  console.log("[Reports] Analysis History page ready");
});
