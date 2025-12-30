
class PopupManager {
    constructor() {
        this.windows = new Map();
        this.isInitialized = false;

        // === 1. CENTRALIZED HEARTBEAT & LOCKS ===
        this.globalHeartbeatTimer = null;
        
        // Locks (Prevent overlap)
        this.isPortfolioFetching = false;
        this.isOrdersFetching = false;
        this.isIndexFetching = false;

        // Timestamps (For throttling)
        this.lastOrderFetchTime = 0;
        this.lastPortfolioFetchTime = 0;
        // 🔥 NEW: Track which windows are actually open
        this.openWindows = new Set();  
        this.portfolioRetryCount = 0; 
        this.ordersRetryCount = 0;
    }
    getBrowserHeaderHeight() {
    // Use 5% of screen height as safe margin
    const safeMargin = Math.max(20, window.innerHeight * 0.01);
    return safeMargin;
    }
    init() {
        if (this.isInitialized) return;
        console.log('Initializing PopupManager...');

        setTimeout(async () => {
            await this.fetchSessionStatus();
            
            this.setupPortfolioWindow();
            this.setupOrderHistoryWindow();
            this.setupOrderEntryWindow();
            this.setupIndexPricesWindow();
            this.setupWatchlistWindow(); // Setup Watchlist
            this.setupSettingsWindow();
            this.setupAlertWindow();
            this.setupBasketWindow();
            
            // Restore Positions (Memory)
            this.loadWindowState('portfolioWindow');
            this.loadWindowState('orderHistoryWindow');
            this.loadWindowState('orderEntryWindow');
            this.loadWindowState('indexPricesWindow');
            this.loadWindowState('settingsWindow');
            this.loadWindowState('watchlistWindow'); 
            this.loadWindowState('basketWindow');
            // Restore Layouts
            this.loadColumnLayout('portfolioWindow');
            this.loadColumnLayout('orderHistoryWindow');

            // Start the Master Loop
            this.startGlobalHeartbeat();

            this.isInitialized = true;
            console.log('✅ PopupManager initialized with Global Heartbeat');
        }, 100);
    }

    // === 2. THE MASTER HEARTBEAT ===
    startGlobalHeartbeat() {
        if (this.globalHeartbeatTimer) clearInterval(this.globalHeartbeatTimer);

        console.log("💓 Popup Heartbeat Started");
        this.globalHeartbeatTimer = setInterval(() => {
            this.heartbeatTick();
        }, 1000); // Ticks every 1 second
    }

heartbeatTick() {

    
    if (document.hidden) return; // Sleep if tab hidden

    const now = Date.now();

    // 1. WATCHDOG (Self-Healing)
    if (this.isPortfolioFetching && (now - this.lastPortfolioFetchTime > 6000)) {
        console.warn("⚠️ Portfolio stuck. Resetting lock.");
        this.isPortfolioFetching = false;
    }
    if (this.isOrdersFetching && (now - this.lastOrderFetchTime > 6000)) {
        console.warn("⚠️ Orders stuck. Resetting lock.");
        this.isOrdersFetching = false;
    }

    // 2. CHECK PORTFOLIO (only if window is open)
    if (this.openWindows.has('portfolioWindow')) {
        if (!this.isPortfolioFetching) {
            this.refreshPortfolioLTPOnly(); 
        }
    }

    // 3. CHECK ORDER HISTORY (only if window is open)
    if (this.openWindows.has('orderHistoryWindow')) {
        if (!this.isOrdersFetching && (now - this.lastOrderFetchTime > 600000)) {
            this.refreshOrderHistory();
        }
    }

    // 4. CHECK INDEX PRICES (only if window is open)
  
if (this.openWindows.has('indexPricesWindow')) {
    if (!this.isIndexFetching) {
        this.updateIndexPrices();
    }
}
    if (this.openWindows.has('indexPricesWindow')) {
     
        if (!this.isIndexFetching) {
            this.updateIndexPrices();
        }
    }
    
    // 5. Keep Popups Visible
    //this.ensurePopupVisibility();
}

 


   
   
      
 
                 
    
    // === WATCHLIST WINDOW (UPDATED FOR MEMORY) ===
    setupWatchlistWindow() {
        const win = document.getElementById('watchlistWindow');
        if (!win) return;
        this.makeDraggable(win);
        this.makeResizable(win);

        const closeBtn = win.querySelector('.close-btn');
        if (closeBtn) closeBtn.addEventListener('click', () => this.hideWindow('watchlistWindow'));

        const minBtn = win.querySelector('.minimize-btn');
        if (minBtn) minBtn.addEventListener('click', () => this.toggleMinimize(win));

        // REGISTER for Memory
        this.windows.set('watchlistWindow', win);
    }

    // === SETTINGS WINDOW ===
    setupSettingsWindow() {
        const window = document.getElementById('settingsWindow');
        if (!window) return;
        
        this.makeDraggable(window);
        this.makeResizable(window);
        window.querySelector('.close-btn').addEventListener('click', () => this.hideWindow('settingsWindow'));
        window.querySelector('.minimize-btn').addEventListener('click', () => this.toggleMinimize(window));
        this.setupSettingsControls();
        this.windows.set('settingsWindow', window);
    }
    
        // === ALERT WINDOW ===
    setupAlertWindow() {
        const win = document.getElementById('alertWindow');
        if (!win) return;
        
        this.makeDraggable(win);
        this.makeResizable(win);
        
        // Close button
        const closeBtn = win.querySelector('.close-btn');
        if (closeBtn) closeBtn.addEventListener('click', () => this.hideWindow('alertWindow'));
        
        // Minimize button  
        const minBtn = win.querySelector('.minimize-btn');
        if (minBtn) minBtn.addEventListener('click', () => this.toggleMinimize(win));
        
       // Register for memory
this.windows.set('alertWindow', win);

// ✅ Allow pressing Enter in price input to act like clicking Set
const priceInput = document.querySelector('#alert-target-price');
const setButton = document.querySelector('#btn-set-alert');

if (priceInput && setButton) {
    priceInput.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();   // stop default form submit
            setButton.click();        // trigger Set button
        }
    });
}
}  // ← closing brace of setupAlertWindow()

    setupBasketWindow() {
    const win = document.getElementById('basketWindow');
    if (!win) return;
    
    this.makeDraggable(win);
    this.makeResizable(win);
    
    const closeBtn = win.querySelector('.close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideWindow('basketWindow'));
    
    const minBtn = win.querySelector('.minimize-btn');
    if (minBtn) minBtn.addEventListener('click', () => this.toggleMinimize(win));
    
    this.windows.set('basketWindow', win);
}

    setupSettingsControls() {
        const fontSizeSlider = document.getElementById('fontSizeSlider');
        const fontSizeValue = document.getElementById('fontSizeValue');
        const applyBtn = document.getElementById('applySettingsBtn');
        const resetBtn = document.getElementById('resetSettingsBtn');

        if (fontSizeSlider && fontSizeValue) {
            fontSizeSlider.addEventListener('input', (e) => {
                fontSizeValue.textContent = e.target.value + 'px';
            });
        }
        if (applyBtn) applyBtn.addEventListener('click', () => this.applyCustomStyles());
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetCustomStyles());
        this.loadSavedSettings();
    }

    applyCustomStyles() {
        const fontSize = document.getElementById('fontSizeSlider').value + 'px';
        const fontColor = document.getElementById('fontColorPicker').value;
        const headerColor = document.getElementById('headerColorPicker').value;

        document.documentElement.style.setProperty('--popup-font-size', fontSize);
        document.documentElement.style.setProperty('--popup-font-color', fontColor);
        document.documentElement.style.setProperty('--popup-header-bg', headerColor);

        this.saveSettingsToStorage({ fontSize, fontColor, headerColor });
        alert('✅ Settings applied successfully!');
    }

    resetCustomStyles() {
        const defaults = { fontSize: '14px', fontColor: '#2c3e50', headerColor: '#34495e' };
        document.documentElement.style.setProperty('--popup-font-size', defaults.fontSize);
        document.documentElement.style.setProperty('--popup-font-color', defaults.fontColor);
        document.documentElement.style.setProperty('--popup-header-bg', defaults.headerColor);

        document.getElementById('fontSizeSlider').value = 14;
        document.getElementById('fontSizeValue').textContent = '14px';
        document.getElementById('fontColorPicker').value = defaults.fontColor;
        document.getElementById('headerColorPicker').value = defaults.headerColor;

        localStorage.removeItem('popupSettings');
        alert('✅ Settings reset to defaults!');
    }

    saveSettingsToStorage(settings) {
        StorageManager.setItem('popupSettings', settings);
    }

    loadSavedSettings() {
        try {
            const saved = localStorage.getItem('popupSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                if (settings.fontSize) document.documentElement.style.setProperty('--popup-font-size', settings.fontSize);
                if (settings.fontColor) document.documentElement.style.setProperty('--popup-font-color', settings.fontColor);
                if (settings.headerColor) document.documentElement.style.setProperty('--popup-header-bg', settings.headerColor);

                if (document.getElementById('fontSizeSlider')) {
                    document.getElementById('fontSizeSlider').value = parseInt(settings.fontSize) || 14;
                    document.getElementById('fontSizeValue').textContent = settings.fontSize;
                    document.getElementById('fontColorPicker').value = settings.fontColor || '#2c3e50';
                    document.getElementById('headerColorPicker').value = settings.headerColor || '#34495e';
                }
            }
        } catch (e) {}
    }
   
    
    

    

   

    

    // === INDEX PRICES LOGIC ===
    setupIndexPricesWindow() {
        const window = document.getElementById('indexPricesWindow');
        if (!window) return;
        this.makeDraggable(window);
        this.makeResizable(window);
        window.querySelector('.close-btn').addEventListener('click', () => this.hideWindow('indexPricesWindow'));
        window.querySelector('.minimize-btn').addEventListener('click', () => this.toggleMinimize(window));
        this.windows.set('indexPricesWindow', window);
    }

    async updateIndexPrices() {
    
     // ⬇️ ADD THIS SAFETY CHECK ⬇️
    if (!this.openWindows.has('indexPricesWindow')) {
        console.log('❌ Index window closed, skipping update');
        return;
    }

                   
        if (this.isIndexFetching) return;
        this.isIndexFetching = true;

        try {
            const response = await fetch('/api/index-quotes');
            const data = await response.json();

if (!Array.isArray(data)) {
    console.warn('Index data not array:', data);
    return;
}

data.forEach(item => {

                if (item.exchange_token === "Nifty 50") document.getElementById('popupNiftyPrice').textContent = item.ltp;
                if (item.exchange_token === "Nifty Bank") document.getElementById('popupBankniftyPrice').textContent = item.ltp;
                if (item.exchange_token === "SENSEX") document.getElementById('popupSensexPrice').textContent = item.ltp;
            });
        } catch(e) { console.error('Index fetch error', e); }
        finally { this.isIndexFetching = false; }
    }
    
        // 🔥 NEW: Bring window to front
    bringWindowToFront(windowElement) {
        // Reset all windows to lower z-index
        document.querySelectorAll('.popup-window').forEach(win => {
            win.style.zIndex = '100';
        });
        
        // Bring clicked window to front
        windowElement.style.zIndex = '1000';
         // Add highlight effect
        windowElement.classList.add('window-active');
        
        setTimeout(() => {
            windowElement.classList.remove('window-active');
        }, 1000);
        
    }
    // === UTILITIES ===
    makeDraggable(element) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = element.querySelector('.window-header');
        if (header) header.onmousedown = dragMouseDown;
        element.addEventListener('click', (e) => this.bringWindowToFront(element));
        function dragMouseDown(e) {
            window.popupManager.bringWindowToFront(element);

            e = e || window.event;
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            
            let newTop = element.offsetTop - pos2;
           let newLeft = element.offsetLeft - pos1;

          // Allow almost to the top, keep 10px safety
          
          const minTop = window.popupManager.getBrowserHeaderHeight();          // was window.popupManager.getBrowserHeaderHeight()
          
          if (newTop < minTop) newTop = minTop;

          element.style.top = newTop + "px";
          element.style.left = newLeft + "px";

        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
            if (window.popupManager) window.popupManager.saveWindowState(element.id);
        }
    }

    makeResizable(element) {
        const resizeHandle = element.querySelector(':scope > .resize-handle') || element.querySelector('.resize-handle');
        if (!resizeHandle) return;
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResize);
        });

        function resize(e) {
            element.style.width = (e.clientX - element.offsetLeft) + 'px';
            element.style.height = (e.clientY - element.offsetTop) + 'px';
        }

        function stopResize() {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResize);
            if (window.popupManager) window.popupManager.saveWindowState(element.id);
        }
    }

    toggleMinimize(element) {
    if (element.style.height === '40px') {
        // Restore original height
        element.style.height = '';
        element.style.overflow = '';
    } else {
        // Save original height and collapse
        if (!element.dataset.originalHeight) {
            element.dataset.originalHeight = element.style.height || '500px';
        }
        element.style.height = '40px'; // Just header height
        element.style.overflow = 'hidden';
    }
}

    showWindow(windowId) {
        const window = this.windows.get(windowId);
        if (window) {
            // 🔥 NEW: Add window to "open" list
            this.openWindows.add(windowId);
            
            window.style.display = 'block';
            this.updateUserDisplay();
            if (!window.style.left || !window.style.top) { window.style.left = '50px'; window.style.top = '50px'; }
            this.saveWindowState(windowId);
            
            if (windowId === 'orderHistoryWindow') this.refreshOrderHistory();
            if (windowId === 'portfolioWindow') this.refreshPortfolio();
            if (windowId === 'indexPricesWindow') this.updateIndexPrices();
        }
    }

    hideWindow(windowId) {
        const window = this.windows.get(windowId);
        if (window) {
            window.style.display = 'none';
            this.openWindows.delete(windowId);
            this.saveWindowState(windowId);
        }
    }

    saveWindowState(windowId) {
        const windowEl = this.windows.get(windowId);
        if (!windowEl) return;
        const state = {
            top: windowEl.style.top,
            left: windowEl.style.left,
            width: windowEl.style.width,
            height: windowEl.style.height,
            display: windowEl.style.display
        };
        StorageManager.setItem(`popup_state_${windowId}`, state);
    }

    loadWindowState(windowId) {
        const windowEl = this.windows.get(windowId);
        if (!windowEl) return;
        const saved = localStorage.getItem(`popup_state_${windowId}`);
        if (saved) {
            const state = JSON.parse(saved);
            if (state.top) windowEl.style.top = state.top;
            if (state.left) windowEl.style.left = state.left;
            if (state.width) windowEl.style.width = state.width;
            if (state.height) windowEl.style.height = state.height;
            if (state.display === 'block') {       
                windowEl.style.display = 'block';
                this.openWindows.add(windowId);
                this.updateUserDisplay();
                if (windowId === 'basketWindow') {
    setTimeout(() => {
        if (typeof renderBasketUI === 'function') renderBasketUI();
    }, 100);
}

               if (windowId === 'indexPricesWindow') {
    setTimeout(() => {
        // Ensure dashboard is ready
        if (window.dashboard && typeof window.dashboard.showIndexPrices === 'function') {
            window.dashboard.showIndexPrices();
        } else if (typeof this.updateIndexPrices === 'function') {
            this.updateIndexPrices();
        }
    }, 500); // Longer delay
}
                // 🔥 NEW: Trigger data fetch for specific windows
                if (windowId === 'portfolioWindow') {
                    setTimeout(() => this.refreshPortfolio(), 100); // Small delay
                }
            } else {
                windowEl.style.display = 'none';
            }
        }
    }

    saveColumnLayout(windowId) {
        const table = document.querySelector(`#${windowId} table`);
        if (!table) return;
        const headers = Array.from(table.querySelectorAll('th'));
        const layout = headers.map(th => ({
            id: th.dataset.column || 'checkbox', 
            width: th.style.width
        }));
        StorageManager.setItem(`col_layout_${windowId}`, layout);
    }

    loadColumnLayout(windowId) {
        const saved = localStorage.getItem(`col_layout_${windowId}`);
        if (!saved) return;
        const layout = JSON.parse(saved);
        const table = document.querySelector(`#${windowId} table`);
        if (!table) return;
        const headers = Array.from(table.querySelectorAll('th'));
        layout.forEach(item => {
            let th = headers.find(h => h.dataset.column === item.id);
            if (!th && item.id === 'checkbox') th = headers[0];
            if (th && item.width) th.style.width = item.width;
        });
    }
}

// ✅ GLOBAL HELPERS
function showOrderHistoryWindow() {
    ensurePopupManagerReady().then(() => window.popupManager.showWindow('orderHistoryWindow'));
}
function showPortfolioWindow() {
    ensurePopupManagerReady().then(() => window.popupManager.showWindow('portfolioWindow'));
}
function showSettingsWindow() {
    ensurePopupManagerReady().then(() => window.popupManager.showWindow('settingsWindow'));
}
function showIndexPricesWindow() {
    ensurePopupManagerReady().then(() => window.popupManager.showWindow('indexPricesWindow'));
}
function showWatchlistWindow() {
    ensurePopupManagerReady().then(() => window.popupManager.showWindow('watchlistWindow'));
}
function openOrderEntry(orderDetails) {
    ensurePopupManagerReady().then(() => window.popupManager.openOrderEntry(orderDetails));
}

function ensurePopupManagerReady() {
    return new Promise((resolve) => {
        if (window.popupManager && window.popupManager.isInitialized) { resolve(); return; }
        if (!window.popupManager) window.popupManager = new PopupManager();
        if (!window.popupManager.isInitialized) window.popupManager.init();
        
        let attempts = 0;
        const check = () => {
            attempts++;
            if (window.popupManager && window.popupManager.isInitialized) resolve();
            else if (attempts < 10) setTimeout(check, 300);
            else resolve();
        };
        check();
    });
}
// 🔔 PIZZA TRACKER LISTENER (Step 5)
if (window.OrderTracker && typeof window.OrderTracker.onChange === 'function') {
    window.OrderTracker.onChange((changedOrder, allOrders) => {
        console.log("🍕 Pizza Tracker change detected:", changedOrder);
        renderActiveOrders(allOrders);

       
    });
} else {
    console.warn("🍕 OrderTracker not ready for Pizza UI updates");
}

document.addEventListener('DOMContentLoaded', function() {
    if (!window.popupManager) window.popupManager = new PopupManager();
    window.popupManager.init();
});

// popup-script.js (Add this function block at the bottom of the file)

function updateAllPopupStatuses(isLoggedIn) {
    // This function runs when the login status changes (e.g., when you log out)
    
    const statusText = isLoggedIn ? 'Live Mode' : 'Demo Mode';
    const statusColor = isLoggedIn ? '#27ae60' : '#e74c3c';
    
    // Looks for all elements in all popups that have the class 'popup-user-status'
    const statusElements = document.querySelectorAll('.popup-user-status'); 

    // Changes the text and color for all of them
    statusElements.forEach(el => {
        el.textContent = statusText;
        el.style.color = statusColor;
    });
}



// === One-Click big banner: inject & auto-show when One-Click is ON ===
(function oneClickBannerModule() {
  // Create banner DOM (only once)
  if (document.getElementById('oneclickBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'oneclickBanner';
  banner.className = 'oneclick-banner';
  banner.innerHTML = `
    <div class="oc-icon">⚠️</div>
    <div class="oc-text">
      <div>ONE-CLICK: ON</div>
      <div style="font-weight:400; font-size:12px; opacity:0.95;">Orders execute instantly while One-Click is ON</div>
    </div>
    <button class="oc-close" title="Dismiss">×</button>
  `;
    // ===== BANNER STYLES =====
  banner.style.cssText = `
    position: fixed;
    /* REMOVE: top: 20px; right: 20px; */
    background: rgba(255, 235, 59, 0.85);
    color: #333;
    padding: 12px 15px;
    border-radius: 8px;
    border-left: 5px solid #ff9800;
    display: none;
    align-items: center;
    gap: 10px;
    z-index: 9999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    cursor: move;
    user-select: none;
`;
  // ===== END BANNER STYLES =====
  
  document.body.appendChild(banner);
  // ===== DRAGGABLE BANNER CODE =====
let isDraggingBanner = false;
let bannerStartX = 0, bannerStartY = 0, bannerStartLeft = 0, bannerStartTop = 0;

banner.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.classList.contains('oc-close')) return;
    
    isDraggingBanner = true;
    bannerStartX = e.clientX;
    bannerStartY = e.clientY;
    
    const rect = banner.getBoundingClientRect();
    
    // ⬇️ SIMPLE FIX: Always use current position ⬇️
    bannerStartLeft = rect.left;
    bannerStartTop = rect.top;
    
    banner.style.cursor = 'grabbing';
    e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
    if (!isDraggingBanner) return;
    
    const dx = e.clientX - bannerStartX;
    const dy = e.clientY - bannerStartY;
    
    banner.style.left = `${bannerStartLeft + dx}px`;
    banner.style.top = `${bannerStartTop + dy}px`;
    banner.style.right = 'auto';
    banner.style.bottom = 'auto';
});

document.addEventListener('mouseup', () => {
    if (isDraggingBanner) {
        isDraggingBanner = false;
        banner.style.cursor = 'move';
    }
});// ===== END DRAGGABLE CODE =====
  

  const closeBtn = banner.querySelector('.oc-close');
  // session dismiss: hide for this session only
  closeBtn.addEventListener('click', () => {
    sessionStorage.setItem('oneclick_banner_dismissed', '1');
    banner.style.display = 'none';
  });

  // Helper — read One-Click state from known toggle element(s)
  function isOneClickOn() {
  const el = document.getElementById('toggleMode') || document.getElementById('oneClickToggle') || document.querySelector('.one-click-toggle');
  if (!el) return false;

  // 1) Prefer explicit indicators
  if (el.classList && el.classList.contains('on')) return true;
  if (el.dataset && (el.dataset.state === 'on' || el.dataset.oneclick === 'on')) return true;
  const aria = el.getAttribute && el.getAttribute('aria-pressed');
  if (aria === 'true' || aria === 'on') return true;

  // 2) Fallback to text detection but as a strict word match (avoid matching "ONE")
  const txt = (el.textContent || el.value || '').toString().trim().toUpperCase();

  // Match patterns like "ONE-CLICK: ON", "ONE CLICK - ON", or "ON" as a whole word
  if (/\bON\b/.test(txt) || /:\s*ON\b/.test(txt) || /-\s*ON\b/.test(txt)) return true;

  return false;
}


  // Show or hide depending on state and session dismissal
 function refreshBannerVisibility() {
  const banner = document.getElementById('oneclickBanner');
  
  if (isOneClickOn()) {
    sessionStorage.removeItem('oneclick_banner_dismissed');
    
    // ⬇️ CENTER ONLY ON FIRST SHOW ⬇️
    if (!banner.dataset.hasBeenPositioned) {
      // Remove any existing positioning
      banner.style.right = 'auto';
      banner.style.bottom = 'auto';
      banner.style.left = '50%';
      banner.style.top = '50%';
      banner.style.transform = 'translate(-50%, -50%)';
      
      // Mark as positioned so it doesn't center again
      banner.dataset.hasBeenPositioned = 'true';
    }
    
    banner.style.display = 'flex';
    return;
  }
  
  banner.style.display = 'none';
}


  // Try to observe toggle changes (works for class changes or text changes)
  function attachToggleWatcher() {
    const el = document.getElementById('toggleMode') || document.getElementById('oneClickToggle') || document.querySelector('.one-click-toggle');
    if (!el) return;
    // Use MutationObserver to detect text/class changes
    const mo = new MutationObserver(refreshBannerVisibility);
    mo.observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
    // Also listen for clicks on element (immediate feedback)
    el.addEventListener('click', () => setTimeout(refreshBannerVisibility, 50));
  }

  // Initial show/hide on page load
  window.addEventListener('load', () => setTimeout(refreshBannerVisibility, 200));
  // Also run immediately in case script loads after page
  setTimeout(() => { refreshBannerVisibility(); attachToggleWatcher(); }, 100);
  const oneClickPoll = setInterval(refreshBannerVisibility, 500);
  // Expose manual API if needed
  window.OneClickBanner = {
    show: () => { sessionStorage.removeItem('oneclick_banner_dismissed'); refreshBannerVisibility(); },
    hide: () => { banner.style.display = 'none'; sessionStorage.setItem('oneclick_banner_dismissed','1'); }

  };
})();
// Make function globally accessible
window.updateAllPopupStatuses = updateAllPopupStatuses;
