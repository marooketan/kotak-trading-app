const NFO_INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
const BFO_INDICES = ['SENSEX', 'BANKEX'];

class TradingDashboard {
    constructor() {
        this.oneClickMode = false;
        this.pendingOrder = null;
        this.isInitialized = false;
        this.currentUser = 'ketan'; 
        
        // === 1. ROBUST HEARTBEAT VARIABLES ===
        this.refreshTimer = null;       // Holds the setInterval ID
        this.fetchController = null;    // Holds the AbortController
        this.isFetching = false;        // Lock: Are we currently downloading?
        this.lastFetchTime = 0;         // Watchdog: When did we last start?
        this.requestCounter = 0;        // Ticket System
        this.optionChainRetryCount = 0;
        this.lastUserActivity = Date.now();  // ← ADD THIS LINE
        this.init();
    }
    trackUserActivity() {
    const oldTime = this.lastUserActivity;
    this.lastUserActivity = Date.now();
    
    }
    isUserIdle() {
    const IDLE_TIMEOUT = 5000; // 5 seconds
    const timeSinceLastActivity = Date.now() - this.lastUserActivity;
    
    return timeSinceLastActivity > IDLE_TIMEOUT;
    }
    init() {
        if (this.isInitialized) return;
        console.log('Initializing TradingDashboard...');
        
        this.loadUsers();
        this.checkSessionStatus();
        this.setupEventListeners();
        this.setupDropdownListeners();
        this.loadExpiries(); 
        
        this.blankPortfolio();
        this.updateLoginBanner(false);

        // === 2. AUTO-WAKEUP (Tab Switching Fix) ===
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                console.log('👁️ Tab Visible: Waking up Heartbeat...');
                // Force a restart if logged in
                if (document.getElementById('logoutSection').style.display !== 'none') {
                    this.startRealtimeUpdates();
                }
            }
        });

        this.isInitialized = true;
    }

    // === SESSION RESTORE ===
    async checkSessionStatus() {
        try {
            const response = await fetch('/api/session-status');
            const data = await response.json();
            
            if (data.authenticated && data.user) {
                console.log(`♻️ Restoring session for: ${data.user}`);
                
                const userSelect = document.getElementById('userSelect');
                if (userSelect) userSelect.value = data.user;
                this.currentUser = data.user;

                this.showLoggedInState();
                this.updateLoginBanner(true);
                
                const status = document.getElementById('loginStatus');
                if(status) {
                    status.innerHTML = `✅ Session Restored (${data.user})`;
                    status.style.color = '#27ae60';
                }

                this.startRealtimeUpdates();
            }
        } catch (error) {
            console.error('Session check failed:', error);
        }
    }

    async loadUsers() {
        try {
            const response = await fetch('/api/users');
            const data = await response.json();
            if (data.success && data.users) {
                const userSelect = document.getElementById('userSelect');
                if (userSelect) {
                    const savedValue = userSelect.value;
                    userSelect.innerHTML = '';
                    data.users.forEach(user => {
                        const option = document.createElement('option');
                        option.value = user;
                        option.text = "👤 " + user.charAt(0).toUpperCase() + user.slice(1);
                        userSelect.appendChild(option);
                    });
                    if (savedValue) userSelect.value = savedValue;
                }
            }
        } catch (error) {
            console.error('Failed to load users list:', error);
        }
    }

    setupEventListeners() {
        const toggleBtn = document.getElementById('toggleMode');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.oneClickMode = !this.oneClickMode;
                toggleBtn.textContent = `One-Click: ${this.oneClickMode ? 'ON' : 'OFF'}`;
                toggleBtn.className = this.oneClickMode ? 'on' : '';
            });
        }

        // Manual Refresh with VISUAL FEEDBACK
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                console.log("🔄 Manual Refresh Clicked");
                this.trackUserActivity();

                // 1. Visual Wipe (Like the popups)
                const table = document.getElementById('optionTable');
                const tbody = document.getElementById('optionData');
                const loadingDiv = document.getElementById('loading');

                if (table) table.style.display = 'none'; // Hide the table
                if (tbody) tbody.innerHTML = '';         // Clear the rows
                
                if (loadingDiv) {
                    loadingDiv.style.display = 'block';
                    loadingDiv.innerHTML = '<div class="loading-spinner">⏳ Refreshing Option Chain...</div>';
                }

                // 2. Fetch Fresh Data
                this.loadOptionChain();
            });
        }

       const watchlistBtn = document.getElementById('watchlistBtn');
if (watchlistBtn) {
    watchlistBtn.addEventListener('click', () => {
    if (window.popupManager && typeof window.popupManager.showWindow === 'function') {
        window.popupManager.showWindow('watchlistWindow');
    } else {
        // Fallback if popupManager isn't ready
        const win = document.getElementById('watchlistWindow');
        if (win) win.style.display = 'block';
    }
});
}
       // === WATCHLIST LOGIC START ===
        const wlSegment = document.getElementById('wlSegmentSelect');
        const wlIndex = document.getElementById('wlIndexSelect');
        const wlExpiry = document.getElementById('wlExpirySelect');
        const wlOptionType = document.getElementById('wlOptionTypeSelect');
        const wlStrike = document.getElementById('wlStrikeSelect');

        // 1. When Segment (NFO/BFO) Changes -> Fill Index
        if (wlSegment && wlIndex) {
            const fillIndices = () => {
                const currentSeg = wlSegment.value; // Read fresh value
                wlIndex.innerHTML = '<option value="">Select Index</option>';
                const list = currentSeg === 'BFO' ? BFO_INDICES : NFO_INDICES;
                
                list.forEach(name => {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    wlIndex.appendChild(opt);
                });
            };

            // Run once on load, and whenever changed
            fillIndices();
            wlSegment.addEventListener('change', fillIndices);
        }

        // 2. When Index Changes -> Load Expiries
        if (wlIndex && wlExpiry && wlSegment) {
            wlIndex.addEventListener('change', async () => {
                const index = wlIndex.value;
                // STRICT CHECK: Get the value directly from the element
                const segment = document.getElementById('wlSegmentSelect').value; 

                wlExpiry.innerHTML = '<option value="">Loading...</option>';
                wlStrike.innerHTML = '<option value="">Select Strike</option>'; // Clear strikes too

                if (!index) return;

                try {
                    console.log(`🔍 Watchlist: Fetching Expiries for ${index} (${segment})`);
                    const response = await fetch(
                        `/api/expiries-v2?index=${encodeURIComponent(index)}&segment=${encodeURIComponent(segment)}`
                    );
                    const data = await response.json();

                    wlExpiry.innerHTML = '<option value="">Select Expiry</option>';

                    if (data.success && Array.isArray(data.expiries) && data.expiries.length > 0) {
                        data.expiries.forEach(exp => {
                            const opt = document.createElement('option');
                            opt.value = exp;
                            opt.textContent = exp;
                            wlExpiry.appendChild(opt);
                        });

                        // Auto-select first expiry
                        wlExpiry.selectedIndex = 1; 
                        // Force the next step (Loading Strikes) immediately
                        wlExpiry.dispatchEvent(new Event('change'));
                    } else {
                        wlExpiry.innerHTML = '<option value="">No Data</option>';
                    }
                } catch (e) {
                    console.error("Watchlist Expiry Error:", e);
                    wlExpiry.innerHTML = '<option value="">Error</option>';
                }
            });
        }
            // 3. When Expiry Changes -> Load Strikes (UPDATED to save Trading Symbol)
        if (wlExpiry && wlOptionType && wlStrike && wlIndex && wlSegment) {
            wlExpiry.addEventListener('change', async () => {
                const index = wlIndex.value;
                const expiry = wlExpiry.value;
                const segment = document.getElementById('wlSegmentSelect').value;
                
                wlStrike.innerHTML = '<option value="">Loading...</option>';

                if (!index || !expiry || expiry === 'Loading...') return;

                try {
                   const recenterFlag = "true"; // Watchlist always uses fresh data
                   const response = await fetch(
                       `/api/option-chain?index=${encodeURIComponent(index)}&expiry=${encodeURIComponent(expiry)}&strikes=all&segment=${encodeURIComponent(segment)}&recenter=${recenterFlag}`
                   );
                    const data = await response.json();

                    wlStrike.innerHTML = '<option value="">Select Strike</option>';

                    if (data.success && Array.isArray(data.data)) {
                        const strikesSet = new Set();
                        data.data.forEach(row => { if (row && row.strike) strikesSet.add(row.strike); });

                        const sortedStrikes = Array.from(strikesSet).sort((a, b) => a - b);
                        
                        sortedStrikes.forEach(strike => {
                            const opt = document.createElement('option');
                            opt.value = strike;
                            opt.textContent = strike;
                            
                            // FIND THE ROW to get Token AND Trading Symbol
                            const row = data.data.find(r => r.strike === strike);
                            if(row) {
                                // Save Tokens
                                if(row.call) opt.setAttribute('data-ce-token', row.call.token);
                                if(row.put) opt.setAttribute('data-pe-token', row.put.token);

                                // === NEW: Save Trading Symbols (Required for Buy/Sell) ===
                                if(row.call) opt.setAttribute('data-ce-symbol', row.call.pTrdSymbol);
                                if(row.put) opt.setAttribute('data-pe-symbol', row.put.pTrdSymbol);
                            }
                            
                            wlStrike.appendChild(opt);
                        });
                    } else {
                         wlStrike.innerHTML = '<option value="">No Data</option>';
                    }
                } catch (err) {
                    console.error('Watchlist strike load failed:', err);
                    wlStrike.innerHTML = '<option value="">Error</option>';
                }
            });
        }
                // === WATCHLIST LOGIC END ===

         
        const orderHistoryBtn = document.getElementById('orderHistoryBtn');
        if (orderHistoryBtn) orderHistoryBtn.addEventListener('click', () => this.showOrderHistory());

        const portfolioBtn = document.getElementById('portfolioBtn');
        if (portfolioBtn) portfolioBtn.addEventListener('click', () => this.showPortfolio());

        const indexPricesBtn = document.getElementById('indexPricesBtn');
        if (indexPricesBtn) indexPricesBtn.addEventListener('click', () => this.showIndexPrices());

        this.setupLoginListeners();
    }

    setupDropdownListeners() {
        // 1. Generic listeners (Market, Expiry, Strikes) -> Just reload the table
        // REMOVED 'indexSelect' from this list!
        ['expirySelect', 'strikeCount'].forEach(id => {
            const el = document.getElementById(id);
           if (el) el.addEventListener('change', () => {
    console.log("🔄 Dropdown changed -> HARD refresh option chain");
    this.trackUserActivity(); 

    const table = document.getElementById('optionTable');
    const tbody = document.getElementById('optionData');
    const loadingDiv = document.getElementById('loading');

    // Hide old table & clear rows
    if (table) table.style.display = 'none';
    if (tbody) tbody.innerHTML = '';

    // Show loading spinner
    if (loadingDiv) {
        loadingDiv.style.display = 'block';
        loadingDiv.innerHTML = '<div class="loading-spinner">⏳ Refreshing Option Chain...</div>';
    }

    // Now load fresh data
    this.loadOptionChain();
});

        });

       // 2. Special listener for marketType -> change available indices
const marketTypeEl = document.getElementById('marketType');
const indexSelectEl = document.getElementById('indexSelect');

if (marketTypeEl && indexSelectEl) {
   marketTypeEl.addEventListener('change', () => {
    console.log("🔁 Market type changed -> HARD reset option chain");
    this.trackUserActivity();
    const table = document.getElementById('optionTable');
    const tbody = document.getElementById('optionData');
    const loadingDiv = document.getElementById('loading');

    if (table) table.style.display = 'none';
    if (tbody) tbody.innerHTML = '';

    if (loadingDiv) {
        loadingDiv.style.display = 'block';
        loadingDiv.innerHTML = '<div class="loading-spinner">⏳ Reloading for new segment...</div>';
    }

    const market = marketTypeEl.value; // "NFO" or "BFO"


        // Clear existing index options
        indexSelectEl.innerHTML = '';

        // Decide which indices to show
        let indices = [];
        if (market === 'BFO') {
            indices = ['SENSEX', 'BANKEX'];
        } else {
            indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
        }

        // Add options to the dropdown
        indices.forEach(idx => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = idx;
            indexSelectEl.appendChild(opt);
                // ✅ NEW: auto-select the first index (NIFTY or SENSEX)
        if (indices.length > 0) {
            indexSelectEl.value = indices[0];
        }

        });
        // Automatically load expiries for the first index
        // 1. Tell backend to switch segment (very important!)
        fetch('/api/switch-segment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `segment=${market}`
       });

       // 2. Load expiries after backend switched
       this.loadExpiries();

        
        


        // After changing index list, you can later load expiries here
        // (we will handle that in the next step)
    });
}
 
     
        // 2. SPECIAL Listener for Index (NIFTY/BANKNIFTY)
        // When Index changes, we must load NEW EXPIRIES first!
        const indexSelect = document.getElementById('indexSelect');
if (indexSelect) {
    indexSelect.addEventListener('change', () => {
        console.log("🔁 Index changed -> HARD reset option chain");

        const table = document.getElementById('optionTable');
        const tbody = document.getElementById('optionData');
        const loadingDiv = document.getElementById('loading');

        if (table) table.style.display = 'none';
        if (tbody) tbody.innerHTML = '';

        if (loadingDiv) {
            loadingDiv.style.display = 'block';
            loadingDiv.innerHTML = '<div class="loading-spinner">⏳ Reloading for new index...</div>';
        }

        // Load fresh expiries for new index
        this.loadExpiries();
    });
}
    }

    setupLoginListeners() {
        const hideLoginBtn = document.getElementById('hideLoginBtn');
        const nextBtn = document.getElementById('nextBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const totpInput = document.getElementById('totpInput');
        const userSelect = document.getElementById('userSelect');

        if (hideLoginBtn) {
            hideLoginBtn.addEventListener('click', () => {
                document.querySelector('.login-section').style.display = 'none';
            });
        }

        if (nextBtn) {
            nextBtn.textContent = "Login Securely";
            nextBtn.addEventListener('click', () => this.performOneStepLogin());
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.kotakLogout());
        }

        if (totpInput) {
            totpInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.performOneStepLogin();
                }
            });
        }
        
        if (userSelect) {
            userSelect.addEventListener('change', async () => {
                const newUser = userSelect.value;
                this.currentUser = newUser;
                const status = document.getElementById('loginStatus');
                const totpInput = document.getElementById('totpInput');
                
                const response = await fetch('/api/switch-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `user_id=${encodeURIComponent(newUser)}`
                });
                const data = await response.json();

                if (data.success) {
                    status.innerHTML = `✅ Login Successful (${newUser})`;
                    status.style.color = '#27ae60';
                    this.showLoggedInState();
                    this.updateLoginBanner(true);
                    
                    this.startRealtimeUpdates(); 
                    
                    if (window.popupManager && typeof window.popupManager.updateUserDisplay === 'function') {
                        window.popupManager.updateUserDisplay();
                    }
                    if (window.popupManager) {
                        if (typeof window.popupManager.refreshOrderHistory === 'function') window.popupManager.refreshOrderHistory();
                        if (document.getElementById('portfolioWindow').style.display !== 'none') this.showPortfolio(); 
                    }
                } else {
                    status.innerHTML = `💡 Enter TOTP for ${newUser.charAt(0).toUpperCase() + newUser.slice(1)}`;
                    status.style.color = '#f39c12'; 
                    if (totpInput) totpInput.value = ''; 
                    this.showLoggedOutState(); 
                    this.updateLoginBanner(false);
                }
            });
        }
    }

    async performOneStepLogin() {
        const totpInput = document.getElementById('totpInput');
        const userSelect = document.getElementById('userSelect');
        const totp = totpInput.value.trim();
        const userId = userSelect ? userSelect.value : 'ketan'; 
        const status = document.getElementById('loginStatus');

        if (!totp || totp.length !== 6 || isNaN(totp)) {
            status.innerHTML = '❌ Enter valid 6-digit TOTP';
            status.style.color = '#e74c3c';
            return;
        }

        status.innerHTML = `🔄 Logging in as ${userId}...`;
        status.style.color = '#f39c12';

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `totp=${encodeURIComponent(totp)}&user_id=${encodeURIComponent(userId)}`
            });

            const data = await response.json();

            if (data.success) {
                this.currentUser = userId;
                status.innerHTML = `✅ Login Successful (${userId})`;
                status.style.color = '#27ae60';
                this.showLoggedInState();
                totpInput.value = '';
                this.updateLoginBanner(true);
                
                if (window.popupManager && typeof window.popupManager.updateUserDisplay === 'function') {
                    window.popupManager.updateUserDisplay();
                }
                if (window.popupManager && typeof window.popupManager.startOrderHistoryUpdates === 'function') {
                    setTimeout(() => window.popupManager.startOrderHistoryUpdates(), 1000);
                }
                this.startRealtimeUpdates();
            } else {
                status.innerHTML = `❌ Login failed: ${data.message}`;
                status.style.color = '#e74c3c';
                this.updateLoginBanner(false);
            }
        } catch (error) {
            console.error('Login error:', error);
            status.innerHTML = '❌ Network Error';
            status.style.color = '#e74c3c';
            this.updateLoginBanner(false);
        }
    }

    kotakLogout() {
        fetch('/api/logout', { method: 'POST' });
        // Stop Heartbeat
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.refreshTimer = null;

        if (window.popupManager && typeof window.popupManager.stopOrderHistoryUpdates === 'function') {
            window.popupManager.stopOrderHistoryUpdates();
        }
        this.showLoggedOutState();
        document.querySelector('.login-section').style.display = 'block';
        document.getElementById('loginStatus').innerHTML = 'Enter TOTP to Login';
        document.getElementById('loginStatus').style.color = '#7f8c8d';
        this.updateLoginBanner(false);
    }

    showLoggedInState() {
        const logoutSection = document.getElementById('logoutSection');
        if (logoutSection) logoutSection.style.display = 'block';
        const kStatus = document.getElementById('kotakStatus');
        if (kStatus) {
            kStatus.textContent = '(Live Mode)';
            kStatus.style.color = '#27ae60';
        }
    }

    showLoggedOutState() {
        const logoutSection = document.getElementById('logoutSection');
        if (logoutSection) logoutSection.style.display = 'none';
        const kStatus = document.getElementById('kotakStatus');
        if (kStatus) {
            kStatus.textContent = '(Demo Mode)';
            kStatus.style.color = '#e74c3c';
        }
    }

    updateLoginBanner(isLoggedIn) {
        let banner = document.getElementById('loginBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = "loginBanner";
            banner.style.fontWeight = "bold";
            banner.style.fontSize = "16px";
            banner.style.margin = "8px 0";
            banner.style.padding = "6px 12px";
            banner.style.borderRadius = "8px";
            const header = document.querySelector('.login-section');
            if(header) header.parentNode.insertBefore(banner, header);
        }
        if (isLoggedIn) {
            banner.textContent = "Logged In";
            banner.style.background = "#e7f9ec";
            banner.style.color = "#218838";
            banner.style.border = "1px solid #27ae60";
        } else {
            banner.textContent = "Logged Out";
            banner.style.background = "#fdecec";
            banner.style.color = "#c0392b";
            banner.style.border = "1px solid #e74c3c";
        }
    }

    async loadExpiries() {
        const indexSelect = document.getElementById('indexSelect');
        const expirySelect = document.getElementById('expirySelect');
        
        // 1. Get the current choice (NIFTY or BANKNIFTY)
        const selectedIndex = indexSelect.value; 

        // 2. Show "Loading..." to clear old dates immediately
        expirySelect.innerHTML = '<option>Loading...</option>';

        try {
            // 3. CRITICAL FIX: Ask backend for THIS specific index
           const marketTypeEl = document.getElementById('marketType');
           const segment = marketTypeEl ? marketTypeEl.value : 'NFO';

           const response = await fetch(
               `/api/expiries-v2?index=${encodeURIComponent(selectedIndex)}&segment=${encodeURIComponent(segment)}`

           );


            const data = await response.json();
           if (data.success && Array.isArray(data.expiries) && data.expiries.length > 0) {
        // Show a "Select Expiry" default option
        expirySelect.innerHTML = '<option value="">Select Expiry</option>';

        // Add ALL expiries (same as watchlist)
        data.expiries.forEach(exp => {
            const opt = document.createElement('option');
            opt.value = exp;
            opt.textContent = exp;
            expirySelect.appendChild(opt);
        });

        // Auto-select first real expiry
        if (expirySelect.options.length > 1) {
            expirySelect.selectedIndex = 1;
        }

        // Now load chain for selected expiry
        this.loadOptionChain();
    } else {
        expirySelect.innerHTML = '<option value="">No Dates Found</option>';
    }
 
  
        } catch (error) { 
            console.error('Failed to load expiries:', error);
            expirySelect.innerHTML = '<option>Error</option>';
        }
    }
    // === 3. THE HEARTBEAT MANAGER (Replaces Recursive Timeout) ===
    startRealtimeUpdates() {
        if (this.refreshTimer) clearInterval(this.refreshTimer); // Ensure we kill old intervals
        console.log("💓 Heartbeat Started");
        
        // Run Heartbeat Check every 1 second
        this.refreshTimer = setInterval(() => {
            this.heartbeatTick();
        }, 1000);

        // Run immediately
        this.heartbeatTick();
    }

    heartbeatTick() {
        if (document.hidden) return; // Don't run if tab is hidden

        const now = Date.now();
        // SELF-HEALING: If stuck for > 4s, reset
        if (this.isFetching && (now - this.lastFetchTime > 4000)) {
            console.warn("⚠️ Stuck Request Detected. Resetting...");
            if (this.fetchController) this.fetchController.abort();
            this.isFetching = false;
        }

        if (!this.isFetching) {
            this.loadOptionChain();
        }
    }

    getStrikeInterval(index) {
        if (index.includes('BANKNIFTY') || index.includes('MIDCPNIFTY')) return 100;
        return 50;
    }
            scheduleNextUpdate() {
        // Temporary no-op to avoid errors; real logic can be added later
    }
    async loadOptionChain() {
    // 1. RACE CONDITION HANDLING
    if (this.isFetching) {
        if (this.fetchController) this.fetchController.abort();
    }

    // 2. SETUP NEW REQUEST
    this.fetchController = new AbortController();
    this.isFetching = true;
    this.lastFetchTime = Date.now();
    this.requestCounter = (this.requestCounter || 0) + 1;
    const currentTicket = this.requestCounter;
    
    // 3. GET VALUES
    const market = document.getElementById('marketType')?.value || 'NFO';
    const index = document.getElementById('indexSelect')?.value || 'NIFTY';
    const expiry = document.getElementById('expirySelect')?.value;
    const strikes = document.getElementById('strikeCount')?.value || '10';

    if (!expiry || expiry === 'Loading...') {
        this.isFetching = false;
        return;
    }

    // === 3.5 FIX: SILENT LOADING ===
    const optionTable = document.getElementById('optionTable');
    const loadingDiv = document.getElementById('loading');
    
    if (!optionTable || optionTable.style.display === 'none') {
        if (loadingDiv) loadingDiv.style.display = 'block';
    }

    try {
        // 4. FETCH with timeout
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), 5000); // 5 second timeout
        
        // Combine abort signals: user cancellation OR timeout
        const combinedAbortController = new AbortController();
        
        // Listen to both abort signals
        this.fetchController.signal.addEventListener('abort', () => {
            combinedAbortController.abort();
        });
        timeoutController.signal.addEventListener('abort', () => {
            combinedAbortController.abort();
        });
        
        

        
        const recenterFlag = this.isUserIdle() ? "true" : "false";
        const response = await fetch(
            `/api/option-chain?index=${index}&expiry=${expiry}&strikes=${strikes}&segment=${market}&recenter=${recenterFlag}`,
            { signal: combinedAbortController.signal }
        );
        
        clearTimeout(timeoutId); // Cancel timeout if successful
        const data = await response.json();

        // 🔥 FIX: Reset retry counter on SUCCESS only
        this.optionChainRetryCount = 0;

        // 5. CHECK TICKET
        if (this.requestCounter !== currentTicket) return;

        if (data.success) {
            this.displayOptionChain(data.data, data.spot, index);
            
            // Hide loading only after success
            if (loadingDiv) loadingDiv.style.display = 'none';
            if (optionTable) optionTable.style.display = 'table';
        } else {
            console.error("Option Chain Error:", data.message);
            if (loadingDiv) {
                loadingDiv.textContent = data.message;
                loadingDiv.style.display = 'block';
            }
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Fetch error:', error);
            
            // 🔥 FIX: Auto-retry logic (counter persists between retries)
            if (this.optionChainRetryCount < 2) { // Try max 2 times
                this.optionChainRetryCount++;
                console.log(`🔄 Option Chain retry attempt ${this.optionChainRetryCount}/2`);
                
                // Show retry message (only if table is not visible)
                if (!optionTable || optionTable.style.display === 'none') {
                    if (loadingDiv) {
                        loadingDiv.innerHTML = `
                            <div class="loading-spinner">
                                📡 Loading Option Chain... Retrying (${this.optionChainRetryCount}/2)
                            </div>
                        `;
                        loadingDiv.style.display = 'block';
                    }
                }
                
                // Wait 2 seconds then retry
                setTimeout(() => {
                    this.loadOptionChain();
                }, 2000);
            } else {
                // Max retries reached - show final error
                this.optionChainRetryCount = 0; // Reset for next time
                
                // Only show error if table is not visible
                if (!optionTable || optionTable.style.display === 'none') {
                    if (loadingDiv) {
                        if (error.name === 'AbortError') {
                            loadingDiv.innerHTML = `
                                <div class="loading-error">
                                    ⏱️ Server timeout after 3 attempts. Click "Refresh" to try again.
                                </div>
                            `;
                        } else {
                            loadingDiv.innerHTML = `
                                <div class="loading-error">
                                    🌐 Network error after 3 attempts. Click "Refresh" to try again.
                                </div>
                            `;
                        }
                        loadingDiv.style.display = 'block';
                    }
                }
            }
        }
    } finally {
        if (this.requestCounter === currentTicket) {
            this.isFetching = false;
            this.scheduleNextUpdate();
        }
    }
}
        showOptionChainLoading(show, isError = false) {
        const loading = document.getElementById('loading');
        const optionTable = document.getElementById('optionTable');
        const tbody = document.getElementById('optionData');

        if (loading) {
            if (show) {
                loading.style.display = 'block';
                loading.innerHTML = '<div class="loading-spinner">⏳ Loading Option Chain...</div>';
            } else if (isError) {
                loading.style.display = 'block';
                loading.innerHTML = '<div class="loading-error">❌ Failed to load data</div>';
            } else {
                loading.style.display = 'none';
            }
        }

        if (optionTable) optionTable.style.display = show ? 'none' : 'table';
        if (tbody && show) tbody.innerHTML = '';
    }

    displayOptionChain(data, spotPrice, index) {
        const tbody = document.getElementById('optionData');
        const loading = document.getElementById('loading');
        const optionTable = document.getElementById('optionTable');

        if (loading) loading.style.display = 'none';
        if (optionTable) optionTable.style.display = data.length ? '' : 'none';

        if (!tbody || data.length === 0) return;

        const fmt = (n) => parseFloat(n).toFixed(2);

        const updateCell = (id, newVal) => {
            const el = document.getElementById(id);
            if (el) {
                const newText = fmt(newVal);
                const currentText = el.innerText;
                
                if (newText === currentText) return; 

                const oldVal = parseFloat(currentText.replace(/,/g, '')) || 0;
                const val = parseFloat(newVal);
                
                el.innerText = newText;

                if (val !== oldVal) {
                    el.style.color = val > oldVal ? '#27ae60' : '#c0392b';
                    setTimeout(() => { el.style.color = ''; }, 500);
                }
            }
        };

        const existingRows = tbody.querySelectorAll('tr');
        const needRebuild = existingRows.length === 0 || 
                            existingRows.length !== data.length ||
                            existingRows[0].id !== `row-${data[0].strike}`;

        const strikeInterval = this.getStrikeInterval(index);
        const atmStrike = Math.round(spotPrice / strikeInterval) * strikeInterval;

        if (needRebuild) {
            tbody.innerHTML = data.map(row => {
                const isATM = row.strike === atmStrike;
                const atmStyle = isATM ? 'background-color: #fff9c4;' : '';
                const ceSymbol = row.call.pTrdSymbol || '';
                const peSymbol = row.put.pTrdSymbol || '';

                return `
                <tr id="row-${row.strike}" class="${row.strike < spotPrice ? 'itm' : 'otm'}" style="${atmStyle}">
                    <td>
                        <button class="buy-btn" onclick="dashboard.trackUserActivity(); dashboard.placeOrder('BUY', 'CE', ${row.strike}, 'ce-ask-${row.strike}', '${ceSymbol}')">B</button>
                        <button class="sell-btn" onclick="dashboard.trackUserActivity(); dashboard.placeOrder('SELL', 'CE', ${row.strike}, 'ce-bid-${row.strike}', '${ceSymbol}')">S</button>
                    </td>
                    <td id="ce-bid-${row.strike}">${fmt(row.call.bid)}</td>
                    <td id="ce-ask-${row.strike}">${fmt(row.call.ask)}</td>
                    <td id="ce-ltp-${row.strike}" class="price-cell" style="font-weight:bold;">${fmt(row.call.ltp)}</td>
                    <td id="strike-cell-${row.strike}"><strong>${row.strike}</strong>${isATM ? ' <span style="color:#ffb300;font-weight:bold;">ATM</span>' : ''}</td>
                    <td id="pe-ltp-${row.strike}" class="price-cell" style="font-weight:bold;">${fmt(row.put.ltp)}</td>
                    <td id="pe-bid-${row.strike}">${fmt(row.put.bid)}</td>
                    <td id="pe-ask-${row.strike}">${fmt(row.put.ask)}</td>
                    <td>
                        <button class="buy-btn" onclick="dashboard.trackUserActivity(); dashboard.placeOrder('BUY', 'PE', ${row.strike}, 'pe-ask-${row.strike}', '${peSymbol}')">B</button>
                        <button class="sell-btn" onclick="dashboard.trackUserActivity(); dashboard.placeOrder('SELL', 'PE', ${row.strike}, 'pe-bid-${row.strike}', '${peSymbol}')">S</button>
                    </td>
                </tr>`;
            }).join('');

        } else {
            data.forEach(row => {
                updateCell(`ce-bid-${row.strike}`, row.call.bid);
                updateCell(`ce-ask-${row.strike}`, row.call.ask);
                updateCell(`ce-ltp-${row.strike}`, row.call.ltp);
                updateCell(`pe-bid-${row.strike}`, row.put.bid);
                updateCell(`pe-ask-${row.strike}`, row.put.ask);
                updateCell(`pe-ltp-${row.strike}`, row.put.ltp);

                const tr = document.getElementById(`row-${row.strike}`);
                if (tr) {
                    const isATM = row.strike === atmStrike;
                    if (isATM) tr.style.backgroundColor = '#fff9c4';
                    else tr.style.backgroundColor = '';

                    tr.className = row.strike < spotPrice ? 'itm' : 'otm';

                    const strikeCell = document.getElementById(`strike-cell-${row.strike}`);
                    if (strikeCell) {
                        const hasATM = strikeCell.innerHTML.includes('ATM');
                        if (isATM && !hasATM) strikeCell.innerHTML = `<strong>${row.strike}</strong> <span style="color:#ffb300;font-weight:bold;">ATM</span>`;
                        else if (!isATM && hasATM) strikeCell.innerHTML = `<strong>${row.strike}</strong>`;
                    }
                }
            });
        }
    }
    // Make this function async so we can use await inside
    // Update arguments to accept segmentOverride

    async placeOrder(action, optionType, strike, priceOrId, symbol, segmentOverride = null) {
     this.trackUserActivity();
    // === NEW: CHECK DUPLICATE ===
    if (!window.OrderTracker?.canPlaceOrder(symbol, action)) {
        alert(`⚠️ Same ${action} order for ${symbol} is already pending!`);
        return;
    }

    let price = priceOrId;
    if (typeof priceOrId === 'string' && (priceOrId.startsWith('ce-') || priceOrId.startsWith('pe-') || priceOrId.startsWith('wl-'))) {
        const el = document.getElementById(priceOrId);
        if (el) {
            price = parseFloat(el.innerText.replace(/,/g, ''));
        } else {
            price = 0;
        }
    }

    const lots = parseInt(document.getElementById('headerOrderQty')?.value) || 1;
    const product = document.getElementById('productType')?.value || 'NRML';
    
    // Get priceType from the popup (MARKET or LIMIT)
    const priceTypeEl = document.querySelector('select[name="priceType"], input[name="priceType"]');
    const priceType = priceTypeEl?.value || 'LIMIT'; // Default to LIMIT if not found

    // Detect Segment
    const marketTypeEl = document.getElementById('marketType');
    const currentSegment = segmentOverride || (marketTypeEl ? marketTypeEl.value : 'NFO');

    // === NEW: CREATE ORDER IN TRACKER ===
   // === NEW: PREPARE ORDER DETAILS ===
const orderDetails = {
    symbol: symbol,
    action: action,
    price: price,
    strike: strike,
    optionType: optionType,
    quantity: lots * 75,   // default fallback
    product: product,
    segment: currentSegment,
    priceType: priceType,  // MARKT/LIMIT
    orderType: priceType
};

// 🔥 ONE-CLICK PATH
if (this.oneClickMode) {
    // 👉 In one-click mode, we STILL create Pizza order here
    const orderId = window.OrderTracker.createOrder(orderDetails);
    console.log(`🍕 Order Created: ${orderId} (${priceType})`);

    try {
        // Ask backend for lot size using the CORRECT segment
        const res = await fetch(
            `/api/lot-size?symbol=${encodeURIComponent(symbol)}&segment=${encodeURIComponent(currentSegment)}`
        );
        const data = await res.json();

        let lotSize = 75; 
        if (data.success && data.lot_size) {
            lotSize = data.lot_size;
        }

        // Correct quantity: lots × lotSize
        orderDetails.quantity = lots * lotSize;

        // === UPDATE STATE TO SENT ===
        window.OrderTracker.updateState(orderId, 'SENT');
        
        // Directly place the order
        this.placeConfirmedOrder(orderDetails, orderId);
        return;
    } catch (e) {
        console.error('Lot size fetch failed, falling back to 75:', e);
        // === UPDATE STATE TO SENT ===
        window.OrderTracker.updateState(orderId, 'SENT');
        this.placeConfirmedOrder(orderDetails, orderId);
        return;
    }
}

// 🧊 Normal (non one-click) flow – ONLY open popup, NO pizza yet
if (typeof openOrderEntry === 'function') {
    openOrderEntry(orderDetails);  // 🔹 no orderId passed now
} else {
    if (confirm(`Place ${action} order for ${symbol} at ${price}?`)) {
        // Fallback path without popup: we DO create Pizza here
        const orderId = window.OrderTracker.createOrder(orderDetails);
        console.log(`🍕 Order Created: ${orderId} (${priceType})`);

        window.OrderTracker.updateState(orderId, 'SENT');
        this.placeConfirmedOrder(orderDetails, orderId);
    }
}

}
       
    blankPortfolio() {
        const pnlElement = document.getElementById('pnlDisplay');
        if (pnlElement) pnlElement.innerHTML = '';
    }

    placeConfirmedOrder(orderDetails, orderId) {  // ← ADDED orderId parameter
    console.log("🔄 Placing order:", orderDetails);
    
    // Disable buttons briefly to prevent double clicks
    const buttons = document.querySelectorAll('.buy-btn, .sell-btn');
    buttons.forEach(btn => btn.disabled = true);
    
    this.showOrderLoading(true, `Placing ${orderDetails.action} order...`);

    // === NEW: Get orderType from details ===
    const isMarket = orderDetails.priceType === 'MARKET' || orderDetails.order_type === 'MKT';
    const finalPrice = isMarket ? '0' : orderDetails.price.toString();
    const finalOrderType = isMarket ? 'MKT' : 'L';

    // FIX: Use the segment passed from placeOrder, or fallback to dropdown
    const finalSegment = orderDetails.segment || document.getElementById('marketType')?.value || 'NFO';

    const orderData = {
        symbol: orderDetails.symbol,
        transaction_type: orderDetails.action === 'BUY' ? 'B' : 'S',
        quantity: orderDetails.quantity,
        product_code: orderDetails.product || 'NRML',
        price: finalPrice,
        order_type: finalOrderType,
        validity: 'DAY',
        am_flag: 'NO',
        segment: finalSegment // <--- SENDING CORRECT SEGMENT TO PYTHON
    };

    // === NEW: Update tracker to SENT state (if not already) ===
    if (window.OrderTracker && orderId) {
        window.OrderTracker.updateState(orderId, 'SENT');
    }

    fetch('/api/place-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
    })
    .then(response => response.json())
    .then(data => {
        // === NEW: UPDATE PIZZA TRACKER ===
        if (window.OrderTracker && orderId) {
            if (data.success) {
                window.OrderTracker.updateState(orderId, 'CONFIRMED', {
                    orderNumber: data.order_number,
                    brokerOrderId: data.order_id
                });
                this.showOrderLoading(false, `✅ Order Placed! #${data.order_number}`);
                
                // Note: We'll update to FILLED when order actually fills
                // (This usually comes from order history updates)
            } else {
                window.OrderTracker.updateState(orderId, 'REJECTED', {
                    error: data.message,
                    brokerResponse: data
                });
                this.showOrderLoading(false, `❌ Failed: ${data.message}`);
            }
        } else {
            // Fallback if no tracker
            if (data.success) {
                this.showOrderLoading(false, `✅ Order Placed! #${data.order_number}`);
            } else {
                this.showOrderLoading(false, `❌ Failed: ${data.message}`);
            }
        }
        
        // Refresh Windows
        if (window.popupManager) {
            if (typeof window.popupManager.refreshOrderHistory === 'function') {
                setTimeout(() => window.popupManager.refreshOrderHistory(), 1000);
            }
            if (typeof window.popupManager.refreshPortfolio === 'function') {
                setTimeout(() => window.popupManager.refreshPortfolio(), 1500);
            }
        }
    })
    .catch(error => {
        // === NEW: UPDATE TRACKER ON NETWORK ERROR ===
        if (window.OrderTracker && orderId) {
            window.OrderTracker.updateState(orderId, 'REJECTED', {
                error: error.message,
                type: 'network_error'
            });
        }
        
        console.error('❌ Order Error:', error);
        this.showOrderLoading(false, '❌ Network Error');
    })
    .finally(() => {
        setTimeout(() => {
            const buttons = document.querySelectorAll('.buy-btn, .sell-btn');
            buttons.forEach(btn => btn.disabled = false);
        }, 2000);
    });
}


    showOrderLoading(show, message = '') {
        let loadingEl = document.getElementById('orderLoading');
        if (!loadingEl) {
            loadingEl = document.createElement('div');
            loadingEl.id = 'orderLoading';
            loadingEl.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #fff3cd;
                border: 1px solid #ffeaa7;
                padding: 10px 15px;
                border-radius: 5px;
                z-index: 10000;
                font-weight: bold;
            `;
            document.body.appendChild(loadingEl);
        }

        if (show) {
            loadingEl.textContent = message;
            loadingEl.style.display = 'block';
        } else {
            if (message) {
                loadingEl.textContent = message;
                loadingEl.style.background = message.includes('✅') ? '#d4edda' : '#f8d7da';
                loadingEl.style.borderColor = message.includes('✅') ? '#c3e6cb' : '#f5c6cb';
                setTimeout(() => loadingEl.style.display = 'none', 3000);
            } else {
                loadingEl.style.display = 'none';
            }
        }
    }

    showOrderHistory() {
        if (typeof showOrderHistoryWindow === 'function') showOrderHistoryWindow();
    }

    showPortfolio() {
        if (window.popupManager && typeof window.popupManager.showWindow === 'function') {
            window.popupManager.showWindow('portfolioWindow');
            if (typeof window.popupManager.refreshPortfolio === 'function') {
                window.popupManager.refreshPortfolio();
            }
        } else {
            console.error('PopupManager not available for portfolio');
        }
    }
    showIndexPrices() {
        if (window.popupManager && typeof window.popupManager.showWindow === 'function') {
            window.popupManager.showWindow('indexPricesWindow');
            if (typeof startIndexPriceUpdates === 'function') startIndexPriceUpdates();
        }
    }
}

function getDashboard() { 
    return window.dashboard; 
}
function showIndexPricesWindow() {
    if (window.popupManager && typeof window.popupManager.showWindow === 'function') {
        window.popupManager.showWindow('indexPricesWindow');
        startIndexPriceUpdates();
    }
}

function updateIndexPricesPopup() {
    fetch('/api/index-quotes')
        .then(r => r.json())
        .then(data => {
            data.forEach(item => {
                if (item.exchange_token === "Nifty 50") document.getElementById('popupNiftyPrice').textContent = item.ltp;
                if (item.exchange_token === "Nifty Bank") document.getElementById('popupBankniftyPrice').textContent = item.ltp;
                if (item.exchange_token === "SENSEX") document.getElementById('popupSensexPrice').textContent = item.ltp;
            });
        })
        .catch(error => console.error('Error fetching index prices:', error));
}

let indexPriceInterval;
function startIndexPriceUpdates() {
    updateIndexPricesPopup();
    if (!indexPriceInterval) indexPriceInterval = setInterval(updateIndexPricesPopup, 1000);
}

function stopIndexPriceUpdates() {
    clearInterval(indexPriceInterval);
    indexPriceInterval = null;
}
// ============================================
// 📜 WATCHLIST MANAGER (LTP + Buy/Sell Working)
// ============================================

let watchlistItems = []; 
let watchlistTimer = null; // Timer for live prices

function loadWatchlist() {
    const saved = localStorage.getItem('myWatchlist');
    if (saved) {
        watchlistItems = JSON.parse(saved);
        renderWatchlistTable();
        startWatchlistLTP(); // Start live updates immediately
    }
}

function addToWatchlist() {
    const seg = document.getElementById('wlSegmentSelect').value;
    const index = document.getElementById('wlIndexSelect').value;
    const expiry = document.getElementById('wlExpirySelect').value;
    const type = document.getElementById('wlOptionTypeSelect').value;
    const strikeSelect = document.getElementById('wlStrikeSelect');
    const strike = strikeSelect.value;

    if (!seg || !index || !expiry || !strike || !type) {
        alert("⚠️ Please select all fields.");
        return;
    }

    const selectedOption = strikeSelect.options[strikeSelect.selectedIndex];
    let token = null;
    let trdSymbol = null; // We need this for Buy/Sell

    if (type === 'CE') {
        token = selectedOption.getAttribute('data-ce-token');
        trdSymbol = selectedOption.getAttribute('data-ce-symbol');
    } else {
        token = selectedOption.getAttribute('data-pe-token');
        trdSymbol = selectedOption.getAttribute('data-pe-symbol');
    }

    if (!token || !trdSymbol) {
        alert("❌ Error: Instrument data missing. Please reload strikes.");
        return;
    }

    // Check for duplicates
    if (watchlistItems.some(item => item.token === token)) {
        alert("⚠️ Item is already in watchlist.");
        return;
    }

    const newItem = {
        id: Date.now(),
        segment: seg,
        index: index,
        expiry: expiry,
        type: type,
        strike: strike,
        token: token,
        trdSymbol: trdSymbol // Saved!
    };

    watchlistItems.push(newItem);
    localStorage.setItem('myWatchlist', JSON.stringify(watchlistItems));
    renderWatchlistTable();
    startWatchlistLTP(); // Restart loop to include new item
}
// 3. Draw the Table Rows (Buttons INSIDE Buy/Sell Columns)
function renderWatchlistTable() {
    const tbody = document.querySelector('#watchlistTable tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    watchlistItems.forEach((item) => {
        const tr = document.createElement('tr');
        tr.id = `wl-row-${item.id}`;
        
        tr.innerHTML = `
            <td>${item.segment}</td>
            <td>${item.index}</td>
            <td>${item.expiry}</td>
            <td style="color: ${item.type === 'CE' ? '#27ae60' : '#c0392b'}; font-weight:bold;">${item.type}</td>
            <td>${item.strike}</td>
            
            <td id="wl-ltp-${item.trdSymbol}" style="font-weight:bold;">-</td>
            
            <td style="text-align:center; min-width: 60px;">
                <div style="display:flex; flex-direction:column; align-items:center;">
                    <span id="wl-buy-${item.trdSymbol}" style="font-size:11px; color:#e67e22; margin-bottom:2px;">-</span>
                    <button class="buy-btn" style="padding: 2px 10px; font-size: 11px; cursor: pointer; background-color: #27ae60; color: white; border: none; border-radius: 3px;" 
                        onclick="dashboard.placeOrder('BUY', '${item.type}', ${item.strike}, 'wl-sell-${item.trdSymbol}', '${item.trdSymbol}', '${item.segment}')">B</button>
                </div>
            </td>

            <td style="text-align:center; min-width: 60px;">
                <div style="display:flex; flex-direction:column; align-items:center;">
                    <span id="wl-sell-${item.trdSymbol}" style="font-size:11px; color:#2980b9; margin-bottom:2px;">-</span>
                    <button class="sell-btn" style="padding: 2px 10px; font-size: 11px; cursor: pointer; background-color: #e74c3c; color: white; border: none; border-radius: 3px;" 
                        onclick="dashboard.placeOrder('SELL', '${item.type}', ${item.strike}, 'wl-buy-${item.trdSymbol}', '${item.trdSymbol}', '${item.segment}')">S</button>
                </div>
            </td>
            
            <td style="text-align:center;">
                <button onclick="removeFromWatchlist(${item.id})" style="background:none; border:none; cursor:pointer; color:#7f8c8d; font-weight:bold; font-size: 14px;">✖</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}
function removeFromWatchlist(id) {
    watchlistItems = watchlistItems.filter(item => item.id !== id);
    localStorage.setItem('myWatchlist', JSON.stringify(watchlistItems));
    renderWatchlistTable();
}

// === LIVE PRICE UPDATER ===
function startWatchlistLTP() {
    if (watchlistTimer) clearInterval(watchlistTimer);
    if (watchlistItems.length === 0) return;

    // Run immediately
    fetchWatchlistPrices();

    // Loop every 1 second
    watchlistTimer = setInterval(fetchWatchlistPrices, 1000);
}
function isWatchlistVisible() {
    // Check if watchlist window is open and visible
    const watchlistWindow = document.getElementById('watchlistWindow');
    return watchlistWindow && watchlistWindow.style.display === 'block';
}

async function fetchWatchlistPrices() {
    
    if (watchlistItems.length === 0 || document.hidden || !isWatchlistVisible()) return;

    const symbols = watchlistItems.map(item => item.trdSymbol).join(',');

    try {
        const response = await fetch(`/api/portfolio-ltp?symbols=${encodeURIComponent(symbols)}`);
        const data = await response.json();

        if (data.success && data.ltp_data) {
            watchlistItems.forEach(item => {
                const quote = data.ltp_data[item.trdSymbol]; // {ltp, bid, ask}
                
                if (quote && quote.ltp !== undefined) {
                    const ltp = quote.ltp;
                    const bid = quote.bid > 0 ? quote.bid : ltp; // Fallback to LTP if 0
                    const ask = quote.ask > 0 ? quote.ask : ltp; // Fallback to LTP if 0

                    // 1. Update LTP Cell
                    const ltpCell = document.getElementById(`wl-ltp-${item.trdSymbol}`);
                    if (ltpCell) {
                        const oldVal = parseFloat(ltpCell.innerText) || 0;
                        ltpCell.innerText = ltp.toFixed(2);
                        if (ltp > oldVal) ltpCell.style.color = '#27ae60';
                        else if (ltp < oldVal) ltpCell.style.color = '#e74c3c';
                    }
                    
                    // 2. Update Buy Column (Show ASK Price)
                    const buyCell = document.getElementById(`wl-buy-${item.trdSymbol}`);
                    if(buyCell) {
                        buyCell.innerText = ask.toFixed(2);
                        // Optional: Color it slightly differently to show it's Ask
                        buyCell.style.color = '#e67e22'; // Orange tint for Ask
                    }

                    // 3. Update Sell Column (Show BID Price)
                    const sellCell = document.getElementById(`wl-sell-${item.trdSymbol}`);
                    if(sellCell) {
                        sellCell.innerText = bid.toFixed(2);
                        sellCell.style.color = '#2980b9'; // Blue tint for Bid
                    }
                }
            });
        }
    } catch (e) {
        // console.error("Watchlist LTP Error", e); 
    }
}

// Connect Logic
document.addEventListener('DOMContentLoaded', () => {
    const addBtn = document.getElementById('wlAddBtn');
    if (addBtn) {
        addBtn.addEventListener('click', addToWatchlist);
    }
    loadWatchlist();
});

// === MAIN DASHBOARD INITIALIZATION ===
document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 Starting Dashboard...");

    // 1. Create the dashboard and attach it to the global 'window'
    window.dashboard = new TradingDashboard();

    // 2. Initialize it
    if (window.dashboard && typeof window.dashboard.init === 'function') {
        window.dashboard.init();
        console.log("✅ Dashboard is PUBLIC and READY!");
    } else {
        console.error("❌ Dashboard created, but init() failed. Check dashboard.js class definition.");
    }
});