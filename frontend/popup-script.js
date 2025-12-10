const originalSetItem = localStorage.setItem;

class StorageManager {
    static MAX_SIZE = 4.5 * 1024 * 1024; // 4.5MB (leave 0.5MB buffer)
    
    // Safe save with size check
    static setItem(key, value) {
        try {
            // 1. Convert to string and check size
            const dataStr = JSON.stringify(value);
            const newSize = dataStr.length;
            
            // 2. Check if adding this would exceed limit
            const currentSize = this.getTotalSize();
            if (currentSize + newSize > this.MAX_SIZE) {
                console.warn(`⚠️ Storage near limit (${currentSize} bytes). Cleaning old data...`);
                this.cleanOldData();
            }
            
            // 3. Save the data
            originalSetItem.call(localStorage, key, dataStr);
            console.log(`💾 Saved ${key} (${newSize} bytes)`);
            
            return true;
        } catch (error) {
            console.error(`❌ Failed to save ${key}:`, error);
            return false;
        }
    }
    
    // Get total localStorage size
    static getTotalSize() {
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);
            total += key.length + value.length;
        }
        return total;
    }
    
    // Clean old window state data
    static cleanOldData() {
        const keysToKeep = ['popupSettings', 'myWatchlist']; // Important data
        const allKeys = [];
        
        // Collect all keys
        for (let i = 0; i < localStorage.length; i++) {
            allKeys.push(localStorage.key(i));
        }
        
        // Find and remove old window state data
        const oldWindowKeys = allKeys.filter(key => 
            key.startsWith('popup_state_') || 
            key.startsWith('col_layout_')
        );
        
        // Remove oldest half
        oldWindowKeys.sort((a, b) => {
            // Sort by last modified (we don't have timestamp, so remove alphabetically)
            return a.localeCompare(b);
        });
        
        const toRemove = oldWindowKeys.slice(0, Math.floor(oldWindowKeys.length / 2));
        toRemove.forEach(key => {
            console.log(`🧹 Cleaning old: ${key}`);
            localStorage.removeItem(key);
        });
        
        return toRemove.length;
    }
    
    // Check and clean if needed (called from localStorage.setItem override)
    static cleanIfNeeded() {
        try {
            const currentSize = JSON.stringify(localStorage).length;
            if (currentSize > this.MAX_SIZE * 0.8) {
                console.log("⚠️ Storage getting full, cleaning old window data...");
                // Simple cleanup: remove oldest window states
                const keys = Object.keys(localStorage);
                const windowKeys = keys.filter(k => k.startsWith('popup_state_'));
                if (windowKeys.length > 5) {
                    // Remove oldest 2 window states
                    windowKeys.slice(0, 2).forEach(key => {
                        localStorage.removeItem(key);
                        console.log(`🧹 Removed old: ${key}`);
                    });
                }
            }
        } catch (e) {
            console.log("⚠️ Cleanup error:", e);
        }
    }
}

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
            
            // Restore Positions (Memory)
            this.loadWindowState('portfolioWindow');
            this.loadWindowState('orderHistoryWindow');
            this.loadWindowState('orderEntryWindow');
            this.loadWindowState('indexPricesWindow');
            this.loadWindowState('settingsWindow');
            this.loadWindowState('watchlistWindow'); // <--- NEW: Restore Watchlist Position

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
    
    // 5. Keep Popups Visible
    this.ensurePopupVisibility();
}

    // === USER & SESSION LOGIC ===
    updateUserDisplay() {
        const currentUser = this.getCurrentUser();
        const userName = currentUser.charAt(0).toUpperCase() + currentUser.slice(1);
        const isLiveMode = this.isLiveMode();
        
        this.windows.forEach((window, windowId) => {
            this.addUserToHeader(window, userName, isLiveMode);
        });
    }

    getCurrentUser() {
        if (window.dashboard && window.dashboard.currentUser) {
            return window.dashboard.currentUser;
        }
        const userSelect = document.getElementById('userSelect');
        if (userSelect && userSelect.value) {
            return userSelect.value;
        }
        return 'ketan'; 
    }

    isLiveMode() {
        const kotakStatus = document.getElementById('kotakStatus');
        return true; // Always show "Live"
    }

    addUserToHeader(windowElement, userName, isLiveMode) {
        const header = windowElement.querySelector('.window-header');
        const existingUserSpan = header.querySelector('.user-display');
        
        const userDisplay = existingUserSpan || document.createElement('span');
        userDisplay.className = 'user-display';
        userDisplay.innerHTML = ` • ${userName} <span class="mode-badge">${isLiveMode ? 'Live' : 'Demo'}</span>`;
        
        if (!existingUserSpan) {
            const title = header.querySelector('.window-title');
            title.appendChild(userDisplay);
        }
    }

    async fetchSessionStatus() {
        try {
            const response = await fetch('/api/session-status');
            const data = await response.json();
            if (data.authenticated && data.user) {
                if (window.dashboard) window.dashboard.currentUser = data.user;
                const userSelect = document.getElementById('userSelect');
                if (userSelect) userSelect.value = data.user;
            }
        } catch (error) {
            console.error('Failed to fetch session status:', error);
        }
    }

    // === WINDOW MANAGEMENT ===
    getBrowserHeaderHeight() {
        const chromeHeight = window.outerHeight - window.innerHeight;
        const safeMargin = 20;
        return Math.max(chromeHeight, safeMargin);
    }

    ensurePopupVisibility() {
        const minTop = this.getBrowserHeaderHeight();
        this.windows.forEach((window, windowId) => {
            if (window.style.display === 'block') { 
                const rect = window.getBoundingClientRect();
                if (rect.top < minTop) {
                    window.style.top = minTop + 'px';
                }
            }
        });
    }

    setupPortfolioWindow() {
        const windowElement = document.getElementById('portfolioWindow');
        if (!windowElement) return;
        // Initialize sort state if not exists
        if (!this.currentSort) {
            this.currentSort = { column: null, direction: 'none' };
        }
        
        this.makeDraggable(windowElement);
        this.makeResizable(windowElement);

        windowElement.querySelector('.close-btn').addEventListener('click', () => {
            this.hideWindow('portfolioWindow');
        });

        windowElement.querySelector('.minimize-btn').addEventListener('click', () => {
            this.toggleMinimize(windowElement);
        });

        const refreshBtn = windowElement.querySelector('#portfolioRefreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshPortfolio());
        
        const squareOffBtn = windowElement.querySelector('#squareOffCheckedBtn');
        if (squareOffBtn) squareOffBtn.addEventListener('click', () => this.squareOffSelected());

        const selectAllCheckbox = windowElement.querySelector('#selectAllPositions');
        if (selectAllCheckbox) selectAllCheckbox.addEventListener('change', (e) =>                   this.toggleSelectAllPositions(e.target.checked));
        
        
        const dayFilter = windowElement.querySelector('#dayWiseFilter');
        if (dayFilter) {
            dayFilter.addEventListener('change', () => this.refreshPortfolio());
        }
                // Add sort click handlers
        document.querySelectorAll('.portfolio-table .sortable').forEach(header => {
            header.addEventListener('click', () => {
                const column = header.dataset.column;
                const currentSort = header.dataset.sort || 'none';
                
                // Determine new sort direction
                let newSort = 'asc';
                if (currentSort === 'asc') newSort = 'desc';
                else if (currentSort === 'desc') newSort = 'none';
                else newSort = 'asc';
                
                // Update all headers
                document.querySelectorAll('.portfolio-table .sortable').forEach(h => {
                    h.dataset.sort = 'none';
                });
                
                // Set new sort on clicked header
                if (newSort !== 'none') {
                    header.dataset.sort = newSort;
                }
                
                // Store sort state and refresh
                this.currentSort = { column, direction: newSort };
                this.refreshPortfolio();
                        });
        });
        
        // NEW: Exact quantity square off
        const exactQtyInput = document.getElementById('exactQtyInput');
        const squareOffExactBtn = document.getElementById('squareOffExactBtn');
        
        if (exactQtyInput) {
            exactQtyInput.addEventListener('input', () => this.checkBulkSquareOffStatus());
        }
        
                if (squareOffExactBtn) {
            
            squareOffExactBtn.addEventListener('click', () => {
                
                this.squareOffExactQty();
            });
        } else {
            
        }
        
        this.windows.set('portfolioWindow', windowElement);
        this.makeColumnsResizable();
        this.makeColumnsDraggable();
    }

    // === PORTFOLIO LOGIC ===
    async refreshPortfolioLTPOnly() {
        if (this.isPortfolioFetching) return;
        this.isPortfolioFetching = true;
        this.lastPortfolioFetchTime = Date.now();

        try {
            const tbody = document.getElementById('portfolioTableBody');
            if (!tbody) return;
            
            const rows = tbody.querySelectorAll('tr[data-symbol]');
            if (rows.length === 0) return;
            
            const symbols = [];
            rows.forEach(row => {
                const symbol = row.dataset.symbol;
                if (symbol) symbols.push(symbol);
            });
            
            if (symbols.length > 0) {
                const response = await fetch(`/api/portfolio-ltp?symbols=${symbols.join(',')}`);
                const result = await response.json();
                if (result.success && result.ltp_data) {
                    this.updatePortfolioLTP(result.ltp_data);
                }
            }
        } catch (error) {
        } finally {
            this.isPortfolioFetching = false;
        }
    }

    async refreshPortfolio() {
    // 1. VISUAL FEEDBACK: Clear table & Show Loading
    const tbody = document.getElementById('portfolioTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#34495e; font-weight:bold;">⏳ Refreshing Positions...</td></tr>';
    }

    // 2. FETCH NEW DATA
    this.isPortfolioFetching = true;
    this.lastPortfolioFetchTime = Date.now();

    try {
        // 🔥 NEW: Add timeout to fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const response = await fetch('/api/portfolio', {
            signal: controller.signal  // Connect timeout to fetch
        });
        
        clearTimeout(timeoutId); // Cancel timeout if successful
        
        const result = await response.json();
        
        // 🔥 NEW: Reset retry counter on success
        this.portfolioRetryCount = 0;
        
        if (result.success) {
            this.renderPortfolioTable(result.positions);
        } else {
            this.renderPortfolioTable(null, result.message || 'Failed to load portfolio');
        }
    } catch (error) {
        console.error('Portfolio refresh error:', error);
        
        // 🔥 NEW STEP 3: Auto-retry logic
        if (this.portfolioRetryCount < 2) { // Try max 2 times
            this.portfolioRetryCount++;
            console.log(`🔄 Portfolio retry attempt ${this.portfolioRetryCount}/2`);
            
            // Show retry message
            this.renderPortfolioTable(null, `📡 Connection issue... Retrying (${this.portfolioRetryCount}/2)`);
            
            // Wait 2 seconds then retry
            setTimeout(() => {
                this.refreshPortfolio();
            }, 2000);
        } else {
            // Max retries reached - show final error
            this.portfolioRetryCount = 0; // Reset for next time
            
            if (error.name === 'AbortError') {
                this.renderPortfolioTable(null, '⏱️ Server timeout after 3 attempts. Please check connection.');
            } else {
                this.renderPortfolioTable(null, '🌐 Network error after 3 attempts. Click "Refresh" to try again.');
            }
        }
    } finally {
        this.isPortfolioFetching = false;
    }
}

       updatePortfolioLTP(ltpData) {
        const tbody = document.getElementById('portfolioTableBody');
        if (!tbody) return;
        
        let totalMtmPnl = 0;
        const groupPnls = {}; 

        const rows = tbody.querySelectorAll('tr[data-symbol]');
        
        rows.forEach(row => {
            const qtyCell = row.querySelector('td:nth-child(4)');
            const qty = parseInt(qtyCell?.textContent) || 0;
            if (qty === 0) return; // Skip closed positions
            const symbol = row.dataset.symbol;
            const groupName = row.dataset.group;
            const quote = ltpData[symbol]; // This is now an object {ltp, bid, ask}
            const newLTP = quote ? quote.ltp : 0;
            
            if (groupName && groupPnls[groupName] === undefined) groupPnls[groupName] = 0;
            let rowPnl = 0;
            const pnlCell = row.querySelector('td:nth-child(7)');

            if (newLTP && newLTP > 0) {
                            const ltpCell = row.querySelector('td:nth-child(6)');
                const avgPriceCell = row.querySelector('td:nth-child(5)');
                const qtyCell = row.querySelector('td:nth-child(4)');
                
                if (ltpCell && avgPriceCell && qtyCell && pnlCell) {
                    const avgPrice = parseFloat(avgPriceCell.textContent) || 0;
                    const qty = parseInt(qtyCell.textContent) || 0;
                    const oldLTP = parseFloat(ltpCell.textContent) || 0;
                    
                    ltpCell.textContent = newLTP.toFixed(2);
                    if (newLTP !== oldLTP) {
                         ltpCell.style.color = newLTP > oldLTP ? '#27ae60' : '#e74c3c';
                         setTimeout(() => ltpCell.style.color = '', 500);
                    }
                    
                    if (qty > 0) rowPnl = (newLTP - avgPrice) * qty;
                    else if (qty < 0) rowPnl = (avgPrice - newLTP) * Math.abs(qty);
                    
                    pnlCell.textContent = rowPnl.toFixed(2);
                    pnlCell.style.color = rowPnl >= 0 ? '#27ae60' : '#e74c3c';
                }
            } else {
                if (pnlCell) rowPnl = parseFloat(pnlCell.textContent) || 0;
            }

            totalMtmPnl += rowPnl;

            if (groupName && row.style.display !== 'none') {
                groupPnls[groupName] += rowPnl;
            }
        });

        const realizedEl = document.getElementById('portfolioRealizedPnl');
        let currentRealized = 0;
        if(realizedEl) currentRealized = parseFloat(realizedEl.textContent.replace('+','')) || 0;
        this.updateSummaryDisplay(totalMtmPnl + currentRealized, totalMtmPnl, currentRealized);

        Object.keys(groupPnls).forEach(groupName => {
            const headerRow = tbody.querySelector(`.group-header[data-group-name="${groupName}"]`);
            if (headerRow) {
                const valSpan = headerRow.querySelector('.group-pnl-val');
                if (valSpan) {
                    valSpan.textContent = groupPnls[groupName].toFixed(2);
                    valSpan.style.color = groupPnls[groupName] >= 0 ? '#27ae60' : '#e74c3c';
                }
            }
        });
    }  

    renderPortfolioTable(positions, errorMessage = null) {
        const tbody = document.getElementById('portfolioTableBody');
        const squareOffBtn = document.getElementById('squareOffCheckedBtn');
        const safeFloat = (value) => parseFloat(value) || 0;

        const dayFilter = document.getElementById('dayWiseFilter');
        const showDayOnly = dayFilter ? dayFilter.checked : false;

        let globalTotalPnl = 0;
        let globalMtmPnl = 0;
        let globalRealizedPnl = 0;

        if (errorMessage) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: #e74c3c;">${errorMessage}</td></tr>`;
            if(squareOffBtn) squareOffBtn.disabled = true;
            this.updateSummaryDisplay(0, 0, 0);
            return;
        }
        if (!positions || positions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: #7f8c8d;">No open F&O positions.</td></tr>`;
            if(squareOffBtn) squareOffBtn.disabled = true;
            this.updateSummaryDisplay(0, 0, 0);
            return;
        }
        const parseExpiry = (symbol) => {
            try {  // <-- ADD THIS LINE (start of try block)
        const weeklyMatch = symbol.match(/[A-Z](\d{2})([1-9OND])(\d{2})\d+/); 
        if (weeklyMatch) {
            const y = parseInt(weeklyMatch[1]);
            const mChar = weeklyMatch[2];
            const d = weeklyMatch[3];
            const m_map = {'1':'JAN','2':'FEB','3':'MAR','4':'APR','5':'MAY','6':'JUN','7':'JUL','8':'AUG','9':'SEP','O':'OCT','N':'NOV','D':'DEC'};
            const monthStr = m_map[mChar] || 'UNK';
            return { label: `${d}-${monthStr}-20${y}`, value: (y * 10000) + (Object.keys(m_map).indexOf(mChar) * 100) + parseInt(d) }; 
        }
        const monthlyMatch = symbol.match(/[A-Z](\d{2})([A-Z]{3})\d+/);
        if (monthlyMatch) {
            const y = parseInt(monthlyMatch[1]);
            const mStr = monthlyMatch[2];
            const months = { 'JAN':1, 'FEB':2, 'MAR':3, 'APR':4, 'MAY':5, 'JUN':6, 'JUL':7, 'AUG':8, 'SEP':9, 'OCT':10, 'NOV':11, 'DEC':12 };
            const mNum = months[mStr] || 99;
            return { label: `Ex-${mStr}-20${y}`, value: (y * 10000) + (mNum * 100) + 99 }; 
        }
        return { label: 'OTHERS', value: 999999 };
    } catch (error) {  // <-- ADD THIS LINE (start of catch block)
        console.error('❌ parseExpiry failed for symbol:', symbol, error);
        return { label: 'UNKNOWN', value: 999999 };  // <-- SAFE FALLBACK!
    }  // <-- ADD THIS LINE (end of catch block)
};
        
        const groups = {}; 
        
        positions.forEach(pos => {
            if (showDayOnly && !pos.traded_today) return; 

            let indexName = 'STOCKS';
            if (pos.symbol.startsWith('NIFTY')) indexName = 'NIFTY';
            else if (pos.symbol.startsWith('BANKNIFTY')) indexName = 'BANKNIFTY';
            else if (pos.symbol.startsWith('FINNIFTY')) indexName = 'FINNIFTY';
            else if (pos.symbol.startsWith('MIDCPNIFTY')) indexName = 'MIDCPNIFTY';
            
            if (!groups[indexName]) groups[indexName] = [];
            
            pos.expiryInfo = parseExpiry(pos.symbol);
            groups[indexName].push(pos);
            if (pos.net_quantity === 0) {
                // Closed position
                const realizedPnl = safeFloat(pos.sell_value) - safeFloat(pos.buy_value);
                globalRealizedPnl += realizedPnl;
                globalTotalPnl += realizedPnl;
            } else {
                // Open position
                globalMtmPnl += safeFloat(pos.pnl_unrealized);
                globalRealizedPnl += safeFloat(pos.pnl_realized);
                globalTotalPnl += safeFloat(pos.pnl_total);
            }
            
        });

        let html = '';
        const sortedKeys = Object.keys(groups).sort();

        if (sortedKeys.length === 0 && showDayOnly) {
             html = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: #7f8c8d;">No active trades found for today.</td></tr>`;
        }

        sortedKeys.forEach(groupName => {
                        const groupPositions = groups[groupName];
            
            // NEW: Apply sorting if active
            if (this.currentSort && this.currentSort.direction !== 'none') {
                groupPositions.sort((a, b) => {
                    let valA, valB;
                    
                    switch(this.currentSort.column) {
                        case 'netQty':
                            valA = a.net_quantity;
                            valB = b.net_quantity;
                            break;
                        case 'ltp':
                            valA = safeFloat(a.ltp);
                            valB = safeFloat(b.ltp);
                            break;
                        case 'pnl':
                            // For P&L, need to calculate display value
                            if (a.net_quantity === 0) {
                                valA = safeFloat(a.sell_value) - safeFloat(a.buy_value);
                            } else {
                                valA = safeFloat(a.pnl_unrealized);
                            }
                            if (b.net_quantity === 0) {
                                valB = safeFloat(b.sell_value) - safeFloat(b.buy_value);
                            } else {
                                valB = safeFloat(b.pnl_unrealized);
                            }
                            break;
                        default:
                            return 0;
                    }
                    
                    // Handle null/undefined
                    valA = valA || 0;
                    valB = valB || 0;
                    
                    // Apply sort direction
                    if (this.currentSort.direction === 'asc') {
                        return valA - valB;
                    } else {
                        return valB - valA;
                    }
                });
            } else {
                // Default: sort by expiry
                groupPositions.sort((a, b) => a.expiryInfo.value - b.expiryInfo.value);
            }
            groupPositions.sort((a, b) => a.expiryInfo.value - b.expiryInfo.value);

            const uniqueExpiries = [...new Set(groupPositions.map(p => p.expiryInfo.label))];
            let optionsHtml = `<option value="ALL">All Expiries (Total)</option>`;
            uniqueExpiries.forEach(exp => {
                optionsHtml += `<option value="${exp}">${exp}</option>`;
            });

            let groupPnl = groupPositions.reduce((sum, p) => {
                if (p.net_quantity === 0) {
                     // Closed position: sell_value - buy_value
                     return sum + (safeFloat(p.sell_value) - safeFloat(p.buy_value));
                } else {
                    // Open position: pnl_unrealized
                    return sum + safeFloat(p.pnl_unrealized);
                }
            }, 0);
            const pnlColor = groupPnl >= 0 ? '#27ae60' : '#e74c3c';

            html += `
                <tr class="group-header" data-group-name="${groupName}">
                    <td colspan="8" style="vertical-align: middle;">
                        <span style="font-size:13px; margin-right: 10px;">▼ ${groupName}</span>
                        <select class="form-select" style="width: auto; padding: 2px 5px; font-size: 11px; height: 24px; border: 1px solid #bdc3c7; cursor:pointer;"
                                onchange="window.popupManager.filterGroup('${groupName}', this.value)">
                            ${optionsHtml}
                        </select>
                        <span class="group-pnl-display">
                            Group P&L: <span class="group-pnl-val" style="color:${pnlColor}">${groupPnl.toFixed(2)}</span>
                        </span>
                    </td>
                </tr>
            `;

            groupPositions.forEach(pos => {
                const pnlUnrealized = safeFloat(pos.pnl_unrealized);
                const ltp = safeFloat(pos.ltp);
                const netQty = pos.net_quantity;
                const isClosed = netQty === 0;
                const isLong = netQty > 0;

                // 🔥 FIX: Calculate P&L for closed positions
                let displayPnl;
                if (isClosed) {
                   
                   // For closed positions: P&L = sell_value - buy_value
                   displayPnl = safeFloat(pos.sell_value) - safeFloat(pos.buy_value);
                  
                } else {
                   // For open positions: use unrealized P&L
                   displayPnl = pnlUnrealized;
                }

                const rowPnlColor = displayPnl >= 0 ? '#27ae60' : '#e74c3c';
                const avgPrice = isLong ? safeFloat(pos.buy_avg) : safeFloat(pos.sell_avg);

               html += `
                    <tr data-unique-id="${pos.unique_id}" 
                        data-symbol="${pos.symbol}" 
                        data-group="${groupName}"
                        data-expiry-label="${pos.expiryInfo.label}"
                        ${isClosed ? 'style="opacity: 0.7; background-color: #f8f9fa;"' : ''}>
        
                        <td>${isClosed ? '' : '<input type="checkbox" class="position-checkbox" data-qty="' + netQty + '" data-symbol="' + pos.symbol + '">'}</td>
                       <td><strong>${pos.symbol}</strong> ${isClosed ? '<span style="color:#95a5a6; font-size:10px; margin-left:5px;">[CLOSED]</span>' : ''}</td>
                       <td style="color: ${isLong ? '#27ae60' : '#e74c3c'}; font-weight: bold;">${pos.position_type}</td>
                      <td>${netQty}</td>
                      <td>${avgPrice.toFixed(2)}</td>
                      <td>${ltp.toFixed(2)}</td>
                      
                      <td style="color: ${rowPnlColor}; font-weight: bold;">${displayPnl.toFixed(2)}</td>
                      <td>
                         ${isClosed ? 
                           '<span style="color:#95a5a6; font-size:11px;">Closed</span>' : 
                           '<button class="btn-cancel" onclick="window.popupManager.singleSquareOff(\'' + pos.symbol + '\', ' + netQty + ')">Exit</button>'
            }
                     </td>
                  </tr>
                `;
            });
        });

        tbody.innerHTML = html;
        this.updateSummaryDisplay(globalTotalPnl, globalMtmPnl, globalRealizedPnl);

        tbody.querySelectorAll('.position-checkbox').forEach(cb => {
            cb.addEventListener('change', () => this.checkBulkSquareOffStatus());
        });
        this.checkBulkSquareOffStatus();
    }
           
    filterGroup(groupName, expiryLabel) {
        const tbody = document.getElementById('portfolioTableBody');
        const rows = tbody.querySelectorAll(`tr[data-group="${groupName}"]`);
        let filteredPnl = 0;

        rows.forEach(row => {
            const rowExpiry = row.dataset.expiryLabel;
            const isVisible = (expiryLabel === 'ALL' || rowExpiry === expiryLabel);
            
            row.style.display = isVisible ? 'table-row' : 'none';

            if (isVisible) {
                const pnlCell = row.querySelector('td:nth-child(7)');
                if (pnlCell) {
                    filteredPnl += parseFloat(pnlCell.textContent) || 0;
                }
            }
        });

        const headerRow = tbody.querySelector(`.group-header[data-group-name="${groupName}"]`);
        if (headerRow) {
            const valSpan = headerRow.querySelector('.group-pnl-val');
            if (valSpan) {
                valSpan.textContent = filteredPnl.toFixed(2);
                valSpan.style.color = filteredPnl >= 0 ? '#27ae60' : '#e74c3c';
            }
        }
    }   
                 
    updateSummaryDisplay(totalPnl, totalMtmPnl, totalRealizedPnl) {
        const formatPnl = (pnl) => {
            const color = pnl >= 0 ? '#27ae60' : '#e74c3c';
            const sign = pnl >= 0 ? '+' : '';
            return `<span style="color: ${color};">${sign}${pnl.toFixed(2)}</span>`;
        };
        document.getElementById('portfolioTotalPnl').innerHTML = formatPnl(totalPnl);
        document.getElementById('portfolioMtmPnl').innerHTML = formatPnl(totalMtmPnl);
        document.getElementById('portfolioRealizedPnl').innerHTML = formatPnl(totalRealizedPnl);
    }
        checkBulkSquareOffStatus() {
        const checkedCount = document.querySelectorAll('#portfolioTableBody .position-checkbox:checked').length;
        
        
        const squareOffBtn = document.getElementById('squareOffCheckedBtn');
        squareOffBtn.disabled = checkedCount === 0;
        squareOffBtn.textContent = `❌ Square Off Checked (${checkedCount})`;
        
        // NEW: Also update exact quantity button
        const squareOffExactBtn = document.getElementById('squareOffExactBtn');
        const exactQtyInput = document.getElementById('exactQtyInput');
        
        if (squareOffExactBtn && exactQtyInput) {
            const qtyValue = parseInt(exactQtyInput.value);
            const hasValidQty = !isNaN(qtyValue) && qtyValue > 0;
            
           
           
            
            
            squareOffExactBtn.disabled = !(checkedCount > 0 && hasValidQty);
            squareOffExactBtn.textContent = `🎯 Square Off Exact (${checkedCount})`;
            
            
        }
    }
        

    async singleSquareOff(symbol, netQuantity) {
   
    

    console.log("DEBUG: singleSquareOff called with:", symbol, netQuantity);
    const segment = symbol.includes('SENSEX') || symbol.includes('BANKEX') ? 'BFO' : 'NFO';
    console.log("DEBUG: Calculated segment:", segment, "for symbol:", symbol);
    
    if (!confirm(`Are you sure you want to close ${Math.abs(netQuantity)} units of ${symbol}?`)) return;

        const action = netQuantity > 0 ? 'S' : 'B';
        const quantity = Math.abs(netQuantity);

        try {
            const segment = symbol.includes('SENSEX') || symbol.includes('BANKEX') ? 'BFO' : 'NFO';

            const orderDetails = {
            symbol: symbol,
            transaction_type: action, 
            quantity: quantity,
            product_code: 'NRML',
            price: '0',
            order_type: 'MKT',
            validity: 'DAY',
            am_flag: 'NO',
            segment: segment  // Add this line
        };
            const response = await fetch('/api/place-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderDetails)
            });
            const result = await response.json();
            if (result.success) {
                alert(`✅ Exit Order Placed for ${symbol}. Order No: ${result.order_number}`);
                this.refreshPortfolio();
            } else {
                alert(`❌ Failed to place exit order: ${result.message}`);
            }
        } catch (error) {
            alert('❌ Network error during Square Off.');
        }
    }
    
    async squareOffSelected() {
        const checkedBoxes = document.querySelectorAll('#portfolioTableBody .position-checkbox:checked');
        if (checkedBoxes.length === 0) return;

        if (!confirm(`Confirm placing market orders to Square Off all ${checkedBoxes.length} selected positions?`)) return;

        let successCount = 0;
        let failedCount = 0;
        
        for (const checkbox of checkedBoxes) {
            const symbol = checkbox.dataset.symbol;
            const netQuantity = parseInt(checkbox.dataset.qty);
            const action = netQuantity > 0 ? 'S' : 'B';
            const quantity = Math.abs(netQuantity);

            const orderDetails = {
                symbol: symbol,
                transaction_type: action,
                quantity: quantity,
                product_code: 'NRML',
                price: '0',
                order_type: 'MKT',
                validity: 'DAY',
                am_flag: 'NO',
                segment: symbol.includes('SENSEX') || symbol.includes('BANKEX') ? 'BFO' : 'NFO'
            };

            try {
                const response = await fetch('/api/place-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(orderDetails)
                });
                const result = await response.json();
                if (result.success) successCount++;
                else failedCount++;
            } catch (error) {
                failedCount++;
            }
        }
        alert(`✅ Bulk Square Off Complete! Successful: ${successCount}. Failed: ${failedCount}.`);
        this.refreshPortfolio();
    }
           async squareOffExactQty() {
        
        
        const checkedBoxes = document.querySelectorAll('#portfolioTableBody .position-checkbox:checked');
        const exactQtyInput = document.getElementById('exactQtyInput');
        
        
        
        // ... rest of function
        
        if (checkedBoxes.length === 0 || !exactQtyInput) return;
        
        const exactQty = parseInt(exactQtyInput.value) || 0;
        if (exactQty <= 0) {
            alert('❌ Please enter a valid quantity greater than 0');
            return;
        }
        
        if (!confirm(`Confirm placing market orders to Square Off ${exactQty} quantity from ${checkedBoxes.length} selected positions?`)) return;

        let successCount = 0;
        let failedCount = 0;
        
        for (const checkbox of checkedBoxes) {
            const symbol = checkbox.dataset.symbol;
            const netQuantity = parseInt(checkbox.dataset.qty);
            
            // Determine action based on position type
            const action = netQuantity > 0 ? 'S' : 'B';
            
            // Use the exact quantity entered by user
            const quantity = Math.abs(exactQty);
            
            // For short positions, we need to buy back
            // For long positions, we need to sell
            const orderDetails = {
                symbol: symbol,
                transaction_type: action,
                quantity: quantity,
                product_code: 'NRML',
                price: '0',
                order_type: 'MKT',
                validity: 'DAY',
                am_flag: 'NO',
                segment: symbol.includes('SENSEX') || symbol.includes('BANKEX') ? 'BFO' : 'NFO'
            };              

            try {
                const response = await fetch('/api/place-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(orderDetails)
                });
                const result = await response.json();
                if (result.success) successCount++;
                else failedCount++;
            } catch (error) {
                failedCount++;
            }
        }
        
        alert(`✅ Exact Quantity Square Off Complete! Successful: ${successCount}. Failed: ${failedCount}.`);
        this.refreshPortfolio();
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

    // === ORDER HISTORY LOGIC ===
    setupOrderHistoryWindow() {
        const window = document.getElementById('orderHistoryWindow');
        if (!window) return;
        this.makeDraggable(window);
        this.makeResizable(window);

        window.querySelector('.close-btn').addEventListener('click', () => this.hideWindow('orderHistoryWindow'));
        window.querySelector('.minimize-btn').addEventListener('click', () => this.toggleMinimize(window));
        
        window.querySelectorAll('.filter-tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.setActiveFilter(e.target));
        });

        const refreshBtn = window.querySelector('.refresh-orders');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshOrderHistory());

        this.windows.set('orderHistoryWindow', window);
        this.initializeAdvancedTable();
    }

    initializeAdvancedTable() {
        const table = document.getElementById('ordersTableBody');
        if (!table) return;
        this.loadColumnPreferences();
        this.makeColumnsDraggable();
        this.makeColumnsResizable();
    }

    makeColumnsDraggable() {
        const headers = document.querySelectorAll('th.resizable');
        headers.forEach(header => {
            header.setAttribute('draggable', true);
            header.addEventListener('dragstart', (e) => {
                if (e.target.classList.contains('resize-handle')) { e.preventDefault(); return; }
                e.dataTransfer.setData('text/plain', header.cellIndex);
                header.classList.add('dragging');
            });
            header.addEventListener('dragend', () => header.classList.remove('dragging'));
            header.addEventListener('dragover', (e) => e.preventDefault());
            header.addEventListener('drop', (e) => {
                e.preventDefault();
                const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                const toIndex = header.cellIndex;
                const table = header.closest('table');
                if (fromIndex !== toIndex && !isNaN(fromIndex)) this.reorderColumns(table, fromIndex, toIndex);
            });
        });
    }

    makeColumnsResizable() {
        const headers = document.querySelectorAll('th.resizable');
        headers.forEach(header => {
            if (header.querySelector('.resize-handle')) return;
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            header.appendChild(resizeHandle);
            resizeHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.startColumnResize(header, e);
            });
        });
    }

    startColumnResize(header, e) {
        const startX = e.clientX;
        const startWidth = header.offsetWidth;
        const table = header.closest('table');
        const windowId = table.closest('.popup-window').id;

        const doResize = (e) => {
            const newWidth = startWidth + (e.clientX - startX);
            if (newWidth >= 30) header.style.width = newWidth + 'px';
        };

        const stopResize = () => {
            document.removeEventListener('mousemove', doResize);
            document.removeEventListener('mouseup', stopResize);
            document.body.style.cursor = '';
            this.saveColumnLayout(windowId);
        };

        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
        document.body.style.cursor = 'col-resize';
    }

    reorderColumns(table, fromIndex, toIndex) {
        const headers = table.querySelectorAll('th');
        const rows = table.querySelectorAll('tbody tr');
        const windowId = table.closest('.popup-window').id;

        const headersArray = Array.from(headers);
        const movedHeader = headersArray[fromIndex];
        headersArray.splice(fromIndex, 1);
        headersArray.splice(toIndex, 0, movedHeader);

        const headerRow = table.querySelector('thead tr');
        headerRow.innerHTML = '';
        headersArray.forEach(header => headerRow.appendChild(header));

        rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length >= headers.length) {
                const movedCell = cells[fromIndex];
                cells.splice(fromIndex, 1);
                cells.splice(toIndex, 0, movedCell);
                row.innerHTML = '';
                cells.forEach(cell => row.appendChild(cell));
            }
        });

        this.saveColumnLayout(windowId);
        setTimeout(() => { this.makeColumnsDraggable(); this.makeColumnsResizable(); }, 100);
    }

    loadColumnPreferences() {
        try {
            const saved = localStorage.getItem('orderHistoryColumns');
            if (saved) {
                const prefs = JSON.parse(saved);
                if (prefs.widths) this.applyColumnWidths(prefs.widths);
            }
        } catch (e) {}
    }

    applyColumnWidths(widths) {
        const headers = document.querySelectorAll('#orderHistoryWindow .orders-table th');
        headers.forEach((header, index) => {
            if (widths[index]) header.style.width = widths[index];
        });
    }

    async refreshOrderHistory() {
    // Lock check
    if (this.isOrdersFetching) return;
    
    // === 1. VISUAL FEEDBACK: Clear table & Show Loading ===
    const tbody = document.getElementById('ordersTableBody');
    if (tbody) {
        // Wipes old orders instantly
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#34495e; font-weight:bold;">⏳ Refreshing Orders...</td></tr>';
    }

    // === 2. FETCH NEW DATA ===
    this.isOrdersFetching = true;
    this.lastOrderFetchTime = Date.now();
    // 🔥 SAFETY: Auto-reset if stuck for more than 10 seconds
  setTimeout(() => {
    console.log("⏰ Order history timeout check - isOrdersFetching:", this.isOrdersFetching);
    if (this.isOrdersFetching) {
        console.warn("⚠️ Order history fetch timeout - resetting");
        this.isOrdersFetching = false;
        this.ordersRetryCount = 0;
        
        // Clear the "Refreshing..." message
        const tbody = document.getElementById('ordersTableBody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: #e74c3c;">
                ⏱️ Timeout - Please refresh manually
            </td></tr>`;
        }
    }
}, 10000); // 10 second timeout

    console.log("🔄 Refreshing order history...");

    try {
        // 🔥 NEW: Add timeout to fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const response = await fetch('/api/order-book', {
            signal: controller.signal  // Connect timeout to fetch
        });
        
        clearTimeout(timeoutId); // Cancel timeout if successful
        
        const result = await response.json();
        if (result.success && result.orders) {
    // 🔥 NEW: Reset retry counter on success
    this.ordersRetryCount = 0;
    this.updateOrderHistoryDisplay(result.orders);
} else if(tbody) {
        
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: #e74c3c;">❌ Failed to load orders</td></tr>`;
        }
    } catch (error) {
        console.error('Order history fetch error:', error);
        
        // 🔥 NEW STEP 3: Auto-retry logic for orders
        if (this.ordersRetryCount < 2) { // Try max 2 times
            this.ordersRetryCount++;
            console.log(`🔄 Order History retry attempt ${this.ordersRetryCount}/2`);
            
            // Show retry message
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: #f39c12;">
                    📡 Loading orders... Retrying (${this.ordersRetryCount}/2)
                </td></tr>`;
            }
            
            // Wait 2 seconds then retry
            setTimeout(() => {
                this.refreshOrderHistory();
            }, 2000);
        } else {
            // Max retries reached - show final error
            this.ordersRetryCount = 0; // Reset for next time
            const tbody = document.getElementById('ordersTableBody');
            if (error.name === 'AbortError') {
                if(tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: #e74c3c;">
                    ⏱️ Server timeout after 3 attempts
                </td></tr>`;
            } else {
                if(tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: #e74c3c;">
                    🌐 Network error after 3 attempts. Click "Refresh" to try again.
                </td></tr>`;
            }
        }
    } finally {
        this.isOrdersFetching = false;
    }
}
        updateOrderHistoryDisplay(orders) {
        const ordersTableBody = document.getElementById('ordersTableBody');
        if (!ordersTableBody) return;

        if (!orders || orders.length === 0) {
            ordersTableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: #7f8c8d;">No orders found</td></tr>`;
            return;
        }
        
        
        // 🔄 NEW: Sync Pizza Tracker with real broker statuses
    if (window.OrderTracker) {
        orders.forEach(order => {
            let newState = null;

            if (order.status === 'COMPLETED') {
                newState = 'FILLED';
            } else if (order.status === 'CANCELLED') {
                newState = 'CANCELLED';
            } else if (order.status === 'PENDING') {
                // Optional: treat backend PENDING as CONFIRMED for pizza
                newState = 'CONFIRMED';
            }

            if (newState) {
                window.OrderTracker.updateStateByBrokerNumber(
                    order.order_number,
                    newState,
                    {
                        brokerOrderId: order.order_number,
                        exchange: order.exchange,
                        filledQuantity: order.filled_quantity,
                        pendingQuantity: order.pending_quantity
                    }
                );
            }
        });
    }

        
        ordersTableBody.innerHTML = '';
        orders.forEach(order => ordersTableBody.appendChild(this.createOrderRow(order)));
        
        const activeFilter = document.querySelector('.filter-tab.active')?.dataset?.filter || 'all';
        this.filterOrders(activeFilter);
    }

    createOrderRow(order) {
        const row = document.createElement('tr');
        row.className = `order-item ${order.status.toLowerCase()}`;
        row.dataset.uniqueId = order.unique_id;
        row.dataset.status = order.status;

        const time = this.formatTime(order.timestamp || order.ordDtTm || order.order_timestamp);
        
        const cellMap = {
            'time': time,
            'order_id': `<span style="font-size:11px; color:#bdc3c7">${order.order_number || '-'}</span>`,
            'symbol': order.symbol || 'N/A',
            'side': this.getSideDisplay(order.transaction_type),
            'quantity': order.quantity || '0',
            'price': order.price || '0.00',
            'status': this.getStatusDisplay(order.status, order.kotak_status),
            'actions': this.createActionButtons(order)
        };

        const headers = document.querySelectorAll('#orderHistoryWindow th');
        headers.forEach(header => {
            const colId = header.dataset.column;
            if (cellMap[colId] !== undefined) {
                const cell = document.createElement('td');
                cell.innerHTML = cellMap[colId];
                cell.dataset.column = colId;
                row.appendChild(cell);
            }
        });
        return row;
    }

    formatTime(timestamp) {
        if (!timestamp) return 'N/A';
        try {
            return new Date(timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch { return timestamp; }
    }

    getSideDisplay(transactionType) {
        const side = transactionType === 'B' ? 'BUY' : 'SELL';
        const color = transactionType === 'B' ? '#27ae60' : '#e74c3c';
        return `<span style="color: ${color}; font-weight: bold;">${side}</span>`;
    }

    getStatusDisplay(status, kotakStatus) {
        const statusConfig = {
            'PENDING': { color: '#f39c12', text: 'PENDING' },
            'COMPLETED': { color: '#27ae60', text: 'COMPLETED' },
            'CANCELLED': { color: '#e74c3c', text: 'CANCELLED' }
        };
        const config = statusConfig[status] || { color: '#95a5a6', text: status };
        return `<span style="color: ${config.color}; font-weight: bold;">${config.text}</span>`;
    }

    createActionButtons(order) {
        if (order.status === 'PENDING') {
            return `<div class="action-buttons">
                <button class="btn-modify" onclick="window.popupManager.openModifyOrder('${order.unique_id}')" title="Modify">✏️</button>
                <button class="btn-cancel" onclick="window.popupManager.cancelOrder('${order.order_number}')" title="Cancel">❌</button>
            </div>`;
        }
        return `<div class="action-buttons"><span style="color: #95a5a6;">-</span></div>`;
    }

    setActiveFilter(clickedTab) {
        clickedTab.parentElement.querySelectorAll('.filter-tab').forEach(tab => tab.classList.remove('active'));
        clickedTab.classList.add('active');
        this.filterOrders(clickedTab.dataset.filter);
    }

    filterOrders(filter) {
        const orders = document.querySelectorAll('.order-item');
        let visibleCount = 0;
        orders.forEach(order => {
            const orderStatus = order.dataset.status ? order.dataset.status.toUpperCase() : '';
            const matches = filter === 'all' || orderStatus === filter.toUpperCase();
            order.style.display = matches ? 'table-row' : 'none';
            if (matches) visibleCount++;
        });
        this.updateResultsCount(visibleCount);
    }

    updateResultsCount(count) {
        let resultsElement = document.getElementById('orderResultsCount');
        if (!resultsElement) {
            const filterTabs = document.querySelector('.filter-tabs');
            if (filterTabs) {
                resultsElement = document.createElement('div');
                resultsElement.id = 'orderResultsCount';
                resultsElement.style.cssText = 'margin-left: auto; color: #7f8c8d; font-size: 12px;';
                filterTabs.appendChild(resultsElement);
            }
        }
        if (resultsElement) resultsElement.textContent = `${count} orders`;
    }

    async openModifyOrder(uniqueId) {
        const orderRow = document.querySelector(`.order-item[data-unique-id="${uniqueId}"]`);
        if (!orderRow) return;

        const orderDetails = {
            unique_id: uniqueId,
            order_number: this.getCellValue(orderRow, 'order_id'), 
            symbol: this.getCellValue(orderRow, 'symbol'),
            price: this.getCellValue(orderRow, 'price'),
            quantity: this.getCellValue(orderRow, 'quantity'),
            order_type: this.getCellValue(orderRow, 'order_type'), 
            transaction_type: this.getCellValue(orderRow, 'side') === 'BUY' ? 'B' : 'S'
        };
        this.openModifyOrderPopup(orderDetails);
    }

    getCellValue(row, column) {
        const cell = row.querySelector(`td[data-column="${column}"]`);
        return cell ? cell.textContent.trim() : '';
    }

    openModifyOrderPopup(orderDetails) {
        let modifyPopup = document.getElementById('modifyOrderPopup');
        if (!modifyPopup) {
            modifyPopup = this.createModifyOrderPopup();
            document.body.appendChild(modifyPopup);
        }
        this.populateModifyForm(orderDetails);
        modifyPopup.style.display = 'block';
    }

    createModifyOrderPopup() {
        const popup = document.createElement('div');
        popup.id = 'modifyOrderPopup';
        popup.className = 'popup-window';
        popup.innerHTML = `
            <div class="window-header">
                <div class="window-title">✏️ Modify Order</div>
                <div class="window-controls"><button class="close-btn" onclick="document.getElementById('modifyOrderPopup').style.display='none'">×</button></div>
            </div>
            <div class="window-content">
                <div class="order-form">
                    <div class="form-group"><label>Symbol</label><input type="text" id="modifySymbol" readonly class="form-input"></div>
                    <div class="form-row">
                        <div class="form-group"><label>Price</label><input type="number" id="modifyPrice" step="0.05" class="form-input"></div>
                        <div class="form-group"><label>Quantity</label><input type="number" id="modifyQuantity" min="1" class="form-input"></div>
                    </div>
                    <div class="form-group"><label>Order Type</label><select id="modifyOrderType" class="form-select"><option value="L">Limit</option><option value="MKT">Market</option></select></div>
                    <div class="form-group"><label>Expiry Date</label><select id="modifyExpiry" class="form-select"><option value="">Loading...</option></select></div>
                    <div class="order-summary">
                        <div class="summary-row"><span>Current:</span><span id="currentOrderDetails">-</span></div>
                        <div class="summary-row"><span>Modified:</span><span id="modifiedOrderDetails">-</span></div>
                    </div>
                    <div class="form-buttons">
                        <button id="cancelModifyBtn" class="btn-secondary">Cancel</button>
                        <button id="submitModifyBtn" class="btn-primary">Apply Changes</button>
                    </div>
                </div>
            </div>`;
        this.setupModifyPopupEvents(popup);
        return popup;
    }

    setupModifyPopupEvents(popup) {
        popup.querySelector('#cancelModifyBtn').addEventListener('click', () => popup.style.display = 'none');
        popup.querySelector('#submitModifyBtn').addEventListener('click', () => this.submitModifyOrder());
        ['#modifyPrice', '#modifyQuantity', '#modifyOrderType', '#modifyExpiry'].forEach(s => {
            const el = popup.querySelector(s);
            if(el) {
                el.addEventListener('change', () => this.updateModifyPreview());
                el.addEventListener('input', () => this.updateModifyPreview());
            }
        });
    }

    populateModifyForm(orderDetails) {
        document.getElementById('modifySymbol').value = orderDetails.symbol;
        document.getElementById('modifyPrice').value = orderDetails.price;
        document.getElementById('modifyQuantity').value = orderDetails.quantity;
        document.getElementById('modifyOrderType').value = orderDetails.order_type === 'MKT' ? 'MKT' : 'L';
        document.getElementById('modifyOrderPopup').dataset.orderDetails = JSON.stringify(orderDetails);
        this.loadExpiriesForModify(orderDetails.symbol);
        this.updateModifyPreview();
    }

    async loadExpiriesForModify(symbol) {
        const expirySelect = document.getElementById('modifyExpiry');
        if (!expirySelect) return;
        try {
            const index = symbol.includes('BANKNIFTY') ? 'BANKNIFTY' : 'NIFTY';
            const response = await fetch(`/api/expiries-v2?index=${index}`);
            const result = await response.json();
            if (result.success) {
                expirySelect.innerHTML = '<option value="">Keep Current Expiry</option>';
                result.expiries.forEach(expiry => {
                    const option = document.createElement('option');
                    option.value = expiry;
                    option.textContent = expiry;
                    expirySelect.appendChild(option);
                });
            }
        } catch (error) { expirySelect.innerHTML = '<option value="">Error</option>'; }
    }

    updateModifyPreview() {
        const popup = document.getElementById('modifyOrderPopup');
        if (!popup) return;
        const orderDetails = JSON.parse(popup.dataset.orderDetails || '{}');
        const newPrice = document.getElementById('modifyPrice').value;
        const newQuantity = document.getElementById('modifyQuantity').value;
        const newOrderType = document.getElementById('modifyOrderType').value;
        const newExpiry = document.getElementById('modifyExpiry').value;

        document.getElementById('currentOrderDetails').textContent = `P: ${orderDetails.price}, Q: ${orderDetails.quantity}`;
        document.getElementById('modifiedOrderDetails').textContent = `P: ${newPrice}, Q: ${newQuantity}, T: ${newOrderType} ${newExpiry ? ', Exp: '+newExpiry : ''}`;
    }

    async submitModifyOrder() {
        const popup = document.getElementById('modifyOrderPopup');
        const orderDetails = JSON.parse(popup.dataset.orderDetails || '{}');
        
        const modifyData = {
            order_number: orderDetails.order_number,
            symbol: orderDetails.symbol,
            new_price: document.getElementById('modifyPrice').value || null,
            new_quantity: document.getElementById('modifyQuantity').value || null,
            new_order_type: document.getElementById('modifyOrderType').value || null,
            new_expiry: document.getElementById('modifyExpiry').value || null
        };

        try {
            const response = await fetch('/api/modify-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(modifyData)
            });
            const result = await response.json();
            if (result.success) {
                alert('✅ Order modified successfully!');
                popup.style.display = 'none';
                this.refreshOrderHistory();
            } else {
                alert(`❌ Failed: ${result.message}`);
            }
        } catch (error) { alert('❌ Network error'); }
    }

    async cancelOrder(orderNumber) {
        if (!confirm('Are you sure you want to cancel this order?')) return;
        try {
            const response = await fetch('/api/cancel-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_number: orderNumber })
            });
            const result = await response.json();
            if (result.success) {
                alert('✅ Order cancelled!');
                this.refreshOrderHistory();
            } else {
                alert(`❌ Failed: ${result.message}`);
            }
        } catch (error) { alert('❌ Network error'); }
    }

    // === ORDER ENTRY LOGIC ===
    setupOrderEntryWindow() {
        const winElement = document.getElementById('orderEntryWindow'); 
        if (!winElement) return;

        this.makeDraggable(winElement);
        this.makeResizable(winElement);
        winElement.querySelector('.close-btn').addEventListener('click', () => this.hideWindow('orderEntryWindow'));
        winElement.querySelector('.minimize-btn').addEventListener('click', () => this.toggleMinimize(winElement));
        
        document.getElementById('actionBuy').addEventListener('click', () => { this.setOrderAction('BUY'); this.calculateOrderSummary(); });
        document.getElementById('actionSell').addEventListener('click', () => { this.setOrderAction('SELL'); this.calculateOrderSummary(); });
        document.getElementById('orderQty').addEventListener('input', () => this.calculateOrderSummary());
        document.getElementById('orderQty').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault(); // Prevent form submission
        document.getElementById('submitOrderBtn').click(); // Trigger order placement
    }
});


        document.getElementById('priceTypeSelect').addEventListener('change', (e) => { this.toggleLimitPrice(e.target.value); this.calculateOrderSummary(); });
        document.getElementById('limitPrice').addEventListener('input', () => this.calculateOrderSummary());
        // === Activate Cancel button ===
        const cancelBtn = document.getElementById("cancelOrderBtn");
        if (cancelBtn) {
           cancelBtn.addEventListener("click", () => {
               // Use PopupManager method to hide the order entry window
               window.popupManager.hideWindow("orderEntryWindow");
            });
         }

        const submitOrderBtn = document.getElementById('submitOrderBtn');
        if (submitOrderBtn) {
            submitOrderBtn.addEventListener('click', () => {
            
                const orderDetails = this.getOrderDetailsFromForm();
                console.log('🍕 Popup submit orderDetails =', orderDetails);

                const dashboard = window.dashboard || (window.opener ? window.opener.dashboard : null);

             if (dashboard && typeof dashboard.placeConfirmedOrder === 'function') {
            // 👉 Create Pizza Tracker order *here* when popup is confirmed
            let orderId = null;
            if (window.OrderTracker) {
                orderId = window.OrderTracker.createOrder(orderDetails);
                console.log('🍕 Popup created orderId:', orderId);
            }

            // Pass orderId so placeConfirmedOrder can update PENDING → REJECTED/CONFIRMED
            dashboard.placeConfirmedOrder(orderDetails, orderId);
            this.hideWindow('orderEntryWindow'); 
        } else {

                    console.error("Dashboard missing. window.dashboard is:", window.dashboard);
                    alert('❌ Error: Dashboard not found. Please refresh the page.');
                }
            });
        } 
        this.windows.set('orderEntryWindow', winElement);
    }

    async openOrderEntry(orderDetails) {
        document.getElementById('orderSymbol').value = orderDetails.symbol;
        document.getElementById('orderStrike').value = orderDetails.strike;
        document.getElementById('orderOptionType').value = orderDetails.optionType;
        const orderEntryWindow = document.getElementById('orderEntryWindow');
        orderEntryWindow.dataset.currentPrice = orderDetails.price;

        this.setOrderAction(orderDetails.action || 'BUY');
        document.getElementById('orderQty').value = 1;
        document.getElementById('orderTypeSelect').value = orderDetails.product || 'NRML';
        document.getElementById('priceTypeSelect').value = 'MARKET';
        this.toggleLimitPrice('MARKET');

        document.querySelector('.qty-help').textContent = '🔄 Fetching lot size...';
        document.getElementById('totalQty').textContent = 'Calculating...';

        try {
            const response = await fetch(`/api/lot-size?symbol=${encodeURIComponent(orderDetails.symbol)}`);
            const data = await response.json();
            if (data.success) {
                window.currentLotSize = data.lot_size;
                document.querySelector('.qty-help').textContent = `1 lot = ${window.currentLotSize} units`;
            } else throw new Error();
        } catch (error) {
            document.querySelector('.qty-help').textContent = '❌ Error';
            document.getElementById('submitOrderBtn').disabled = true;
            return;
        }
        
        document.getElementById('submitOrderBtn').disabled = false;
        this.calculateOrderSummary();
        this.showWindow('orderEntryWindow');
         // NEW: Auto-focus quantity input after window opens
        setTimeout(() => {
            const qtyInput = document.getElementById('orderQty');
            if (qtyInput) {
                qtyInput.focus();
                qtyInput.select(); // Highlights the number
            }
        }, 100);
    }
    
    setOrderAction(action) {
        const safeAction = (action || 'BUY').toUpperCase();
        const buyBtn = document.getElementById('actionBuy');
        const sellBtn = document.getElementById('actionSell');

        if (!buyBtn || !sellBtn) return;

        buyBtn.classList.remove('buy-active');
        sellBtn.classList.remove('sell-active');

        if (safeAction === 'BUY') { 
            buyBtn.classList.add('buy-active'); 
        } else { 
            sellBtn.classList.add('sell-active'); 
        }
    }

    toggleLimitPrice(priceType) {
        document.getElementById('limitPriceGroup').style.display = priceType === 'LIMIT' ? 'block' : 'none';
    }

    getOrderDetailsFromForm() {
        const symbol = document.getElementById('orderSymbol').value;
        const action = document.getElementById('actionBuy').classList.contains('buy-active') ? 'BUY' : 'SELL';
        const qty = parseInt(document.getElementById('orderQty').value) || 1;
        const priceType = document.getElementById('priceTypeSelect').value;
        const limitPrice = parseFloat(document.getElementById('limitPrice').value) || 0;
        const currentPrice = parseFloat(document.getElementById('orderEntryWindow').dataset.currentPrice) || 0;
        
        const totalQty = qty * (window.currentLotSize || 0);
        const price = priceType === 'MARKET' ? currentPrice : limitPrice;

        return {
            symbol, action, quantity: totalQty, price,
            product: document.getElementById('orderTypeSelect').value || 'NRML',
            priceType,
            strike: document.getElementById('orderStrike').value,
            optionType: document.getElementById('orderOptionType').value
        };
    }

    calculateOrderSummary() {
        const qty = parseInt(document.getElementById('orderQty').value) || 1;
        const priceType = document.getElementById('priceTypeSelect').value;
        const limitPrice = parseFloat(document.getElementById('limitPrice').value) || 0;
        const currentPrice = parseFloat(document.getElementById('orderEntryWindow').dataset.currentPrice) || 0;
        const totalQty = qty * (window.currentLotSize || 0);
        
        document.getElementById('totalQty').textContent = totalQty;
        const price = priceType === 'MARKET' ? currentPrice : limitPrice;
        document.getElementById('estimatedAmount').textContent = `₹${(totalQty * price).toFixed(2)}`;
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
        if (this.isIndexFetching) return;
        this.isIndexFetching = true;

        try {
            const response = await fetch('/api/index-quotes');
            const data = await response.json();
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
            const minTop = window.popupManager.getBrowserHeaderHeight();
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
        const content = element.querySelector('.window-content');
        content.style.display = content.style.display === 'none' ? 'block' : 'none';
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
  banner.style.display = 'none'; // start hidden
  document.body.appendChild(banner);

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
  // If One-Click is ON, always show the banner and clear any prior session dismissal
  if (isOneClickOn()) {
    sessionStorage.removeItem('oneclick_banner_dismissed');
    banner.style.display = 'flex';
    return;
  }
  // Otherwise hide the banner
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
