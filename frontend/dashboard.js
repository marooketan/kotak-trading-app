// ===== SMART REFRESH SYSTEM =====
let isUserActive = false;
let activityTimer = null;
const ACTIVITY_TIMEOUT = 10000; // 10 seconds

function markUserActive() {
    isUserActive = true;
    clearTimeout(activityTimer);
    activityTimer = setTimeout(() => {
        isUserActive = false;
        console.log('User idle, resume auto-refresh');
    }, ACTIVITY_TIMEOUT);
}


const NFO_INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];

const BFO_INDICES = ['SENSEX', 'BANKEX'];
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


class TradingDashboard {
    constructor() {
        this.oneClickMode = false;
        this.pendingOrder = null;
        this.isBasketMode = false;

        this.basketOrders = [];
        // Load saved basket
        try {
            const saved = localStorage.getItem('basketOrders');
            if (saved) {
                this.basketOrders = JSON.parse(saved);
                // Ensure each item has selected property
                this.basketOrders.forEach(item => {
                    if (item.selected === undefined) item.selected = true;
                });
            }
        } catch (e) {
            console.error('Failed to load basket:', e);
        }
        
        this.isBasketExecuting = false;

        // === MARKET PROTECTION SETTING ===
        // Loads from 'appSettings' (if your popup saves there) or defaults to 10%
        this.marketProtectionPercent = 10; 
        try {
            const settings = JSON.parse(localStorage.getItem('appSettings'));
            if (settings && settings.marketProtection) {
                this.marketProtectionPercent = parseFloat(settings.marketProtection);
            }
        } catch(e) {}

        this.isInitialized = false;
        this.currentUser = 'ketan'; 
        
        // === 1. ROBUST HEARTBEAT VARIABLES ===
        this.refreshTimer = null;       // Holds the setInterval ID
        this.fetchController = null;    // Holds the AbortController
        this.isFetching = false;        // Lock: Are we currently downloading?
        this.lastFetchTime = 0;         // Watchdog: When did we last start?
        this.requestCounter = 0;        // Ticket System
        this.optionChainRetryCount = 0;
        this.lastUserActivity = Date.now(); 
        this.activityManager = new UserActivityManager();
        this.watchlistManager = new WatchlistManager();
        this.uiController = new OptionChainUIController(this);
        this.wasIdleBefore = false;
        this.lastIdleState = false;
        this.optionChain = new OptionChainManager(this, this.activityManager);

        this.init();
    }
        trackUserActivity() {
            this.activityManager.trackUserActivity();


    }
        
    init() {
        if (this.isInitialized) return;
        console.log('Initializing TradingDashboard...');
        
        this.loadUsers();
        this.checkSessionStatus();
        this.setupEventListeners();
        
        this.optionChain.loadExpiries();
 
        
        this.blankPortfolio();
        this.updateLoginBanner(false);
        this.setupSettingsUI(); // <--- ADD THIS LINE
        // === 2. AUTO-WAKEUP (Tab Switching Fix) ===
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                console.log('👁️ Tab Visible: Waking up Heartbeat...');
                // Force a restart if logged in
                const logoutSection = document.getElementById('logoutSection');

                if (logoutSection && logoutSection.style.display !== 'none') {
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
                
                const status = document.getElementById('headerLoginStatus');
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
                this.activityManager.trackUserActivity();

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
                // Reset the flag to allow table rebuild on manual refresh
                if (this.optionChain) this.optionChain.hasInitialLoad = false;
                // 2. Fetch Fresh Data
                this.optionChain.loadOptionChain();

            });
        }
         const optionTable = document.getElementById('optionTable');
    if (optionTable) {
        optionTable.addEventListener('mousemove', () => {
            this.activityManager.trackUserActivity();
        });
        
        optionTable.addEventListener('click', () => {
            this.activityManager.trackUserActivity();
        });
        optionTable.addEventListener('scroll', () => {
            this.activityManager.trackUserActivity();
        });
        optionTable.addEventListener('mouseenter', () => {
            this.activityManager.trackUserActivity();
        });
         optionTable.addEventListener('mouseover', (event) => {
            if (event.target.classList.contains('buy-btn') || 
                event.target.classList.contains('sell-btn')) {
                this.activityManager.trackUserActivity();
            }
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
       
         
        const orderHistoryBtn = document.getElementById('orderHistoryBtn');
        if (orderHistoryBtn) orderHistoryBtn.addEventListener('click', () => this.showOrderHistory());

        const portfolioBtn = document.getElementById('portfolioBtn');
        if (portfolioBtn) portfolioBtn.addEventListener('click', () => this.showPortfolio());

        const indexPricesBtn = document.getElementById('indexPricesBtn');
        if (indexPricesBtn) indexPricesBtn.addEventListener('click', () => this.showIndexPrices());

        this.setupLoginListeners();
    }

   
    setupLoginListeners() {
        const hideLoginBtn = document.getElementById('hideLoginBtn');
        const nextBtn = document.getElementById('nextBtn');
        const logoutBtn = document.getElementById('headerLogoutBtn');
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
                const status = document.getElementById('headerLoginStatus');
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
        const status = document.getElementById('headerLoginStatus');

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
        // 🔥 NEW: Stop bot data fetcher
        if (window.botFetcher) window.botFetcher.stop();
        if (window.popupManager && typeof window.popupManager.stopOrderHistoryUpdates === 'function') {
            window.popupManager.stopOrderHistoryUpdates();
        }
        this.showLoggedOutState();
        
        document.getElementById('headerLoginStatus').innerHTML = 'Enter TOTP to Login';
        document.getElementById('headerLoginStatus').style.color = '#7f8c8d';
        this.updateLoginBanner(false);
    }

    showLoggedInState() {
        
        const kStatus = document.getElementById('kotakStatus');
        if (kStatus) {
            kStatus.textContent = '(Live Mode)';
            kStatus.style.color = '#27ae60';    
        }
           if (typeof updateAllPopupStatuses === 'function') updateAllPopupStatuses(true);
           
    }

    showLoggedOutState() {
        
        const kStatus = document.getElementById('kotakStatus');
        if (kStatus) {
            kStatus.textContent = '(Demo Mode)';
            kStatus.style.color = '#e74c3c';
        }
            if (typeof updateAllPopupStatuses === 'function') updateAllPopupStatuses(false);   
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
            const header = document.querySelector('header');
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

        // === 3. THE HEARTBEAT MANAGER (Replaces Recursive Timeout) ===
    startRealtimeUpdates() {
        if (this.refreshTimer) clearInterval(this.refreshTimer); // Ensure we kill old intervals
        console.log("💓 Heartbeat Started");
        
        // Run Heartbeat Check every 1 second
        this.refreshTimer = setInterval(() => {
            this.optionChain.heartbeatTick();

        }, 1000);

        // Run immediately
        this.optionChain.heartbeatTick();
         // 🔥 NEW: Start bot data fetcher
        if (window.botFetcher) window.botFetcher.start();

    }

    

                
         
        // Make this function async so we can use await inside
    // Update arguments to accept segmentOverride

    async placeOrder(action, optionType, strike, priceOrId, symbol, segmentOverride = null) {
     this.activityManager.trackUserActivity();
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
    
    // Inside placeOrder function...
    
    // Get priceType from the popup (MARKET or LIMIT)
    const priceTypeEl = document.querySelector('select[name="priceType"], input[name="priceType"]');
    const priceType = priceTypeEl?.value || 'MARKET'; // <--- CHANGED TO MARKET

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
if (!this.isBasketMode && typeof openOrderEntry === 'function') {
    openOrderEntry(orderDetails);
} else if (!this.isBasketMode) {
    if (confirm(`Place ${action} order for ${symbol} at ${price}?`)) {
        const orderId = window.OrderTracker.createOrder(orderDetails);
        window.OrderTracker.updateState(orderId, 'SENT');
        this.placeConfirmedOrder(orderDetails, orderId);
    }
}


}
basketOrder() {
    console.warn('Basket contents:', this.basketOrders);
    alert('Basket items: ' + this.basketOrders.length);
}
addToBasket(orderDetails) {
        this.pendingOrder = null;

        // Save EVERYTHING, don't filter fields
        this.basketOrders.push({
            ...orderDetails, 
            selected: true
        });

        // Ensure UI updates
        if (typeof this.renderBasketUI === 'function') this.renderBasketUI();
        localStorage.setItem('basketOrders', JSON.stringify(this.basketOrders));
    }clearBasket() {
    this.basketOrders = [];
    
}
removeBasketItem(index) {
        this.basketOrders.splice(index, 1); // Delete from memory
        this.renderBasketUI();              // Redraw Table AND Save to LocalStorage
    }
addOrderPopupToBasket() {
        const symbol = document.getElementById('orderSymbol').value;
        const strike = document.getElementById('orderStrike').value;
        const optionType = document.getElementById('orderOptionType').value;
        
        const orderQtyElement = document.getElementById('orderQty') || document.getElementById('headerOrderQty');
        const qtyLots = parseInt(orderQtyElement?.value || '1', 10);
        
        const priceType = document.getElementById('priceTypeSelect').value;
        const limitPrice = parseFloat(document.getElementById('limitPrice').value) || 0;
        const triggerPrice = parseFloat(document.getElementById('triggerPrice').value) || 0;

        const segment = this.currentSegment || 'NFO';
        const action = document.getElementById('actionBuy').classList.contains('buy-active') ? 'BUY' : 'SELL';

        // Fix Price Logic
        const price = (priceType === 'MARKET' || priceType === 'SL-M') ? 0 : limitPrice;
        
        const orderDetails = {
            action, 
            optionType, 
            strike, 
            price,
            triggerPrice, 
            priceType, 
            symbol, 
            segment,
            selected: true,
            quantity: qtyLots, // Used for display
            qty: qtyLots,      // Keep 'qty' for backward compatibility with executeBasket
            product: document.getElementById('orderTypeSelect').value || 'NRML'
        };

        // CHECK MODE: Update or Add?
        const win = document.getElementById('orderEntryWindow');
        const editIndex = win.dataset.editIndex;

        if (editIndex !== undefined && editIndex !== null && editIndex !== "") {
            // UPDATE EXISTING
            this.basketOrders[editIndex] = orderDetails;
            console.log(`Basket Item #${editIndex} Updated`);
            
            // Cleanup Edit Mode
            delete win.dataset.editIndex;
            const btn = document.getElementById('addToBasketBtn');
            if (btn) {
                btn.textContent = "Add to Basket";
                btn.style.backgroundColor = "";
                btn.style.color = "";
            }
        } else {
            // ADD NEW (This calls our fixed addToBasket above)
            this.addToBasket(orderDetails);
        }
        
        if (typeof this.renderBasketUI === 'function') this.renderBasketUI();
        if (window.popupManager) window.popupManager.hideWindow('orderEntryWindow');
    }    // === 1. EDIT BASKET ITEM ===
    editBasketItem(index) {
        const item = this.basketOrders[index];
        if (!item) return;

        // Open the existing popup with this item's data
        if (window.popupManager) {
            window.popupManager.openOrderEntry(item);
            
            // ENABLE EDIT MODE: Tag the window with the index we are editing
            const win = document.getElementById('orderEntryWindow');
            win.dataset.editIndex = index;
            
            // VISUAL CUE: Change button text
            const btn = document.getElementById('addToBasketBtn');
            if (btn) {
                btn.textContent = "Update Basket";
                btn.style.backgroundColor = "#ffc107"; // Yellow/Orange warning color
                btn.style.color = "#000";
            }
        }
    }

    // === 2. RENDER BASKET UI (The Missing Piece) ===
    renderBasketUI() {
        const tbody = document.getElementById('basketData'); // Ensure your HTML has this ID in the basket table
        if (!tbody) return;

        tbody.innerHTML = this.basketOrders.map((item, index) => {
            const isBuy = item.action === 'BUY';
            const colorClass = isBuy ? 'text-success' : 'text-danger';
            
            return `
                <tr class="basket-row">
                    <td><input type="checkbox" ${item.selected ? 'checked' : ''} onchange="dashboard.toggleBasketItem(${index})"></td>
                    <td class="${colorClass} fw-bold">${item.action}</td>
                    <td>${item.symbol}</td>
                    <td>${item.product}</td>
                    <td>${item.priceType}</td>
                    <td>${item.quantity}</td>
                    <td>${item.price || 'MKT'}</td>
                    <td>${item.triggerPrice || '-'}</td>
                    <td>
                        <button class="btn-sm btn-edit" onclick="dashboard.editBasketItem(${index})">✏️</button>
                        <button class="btn-sm btn-delete" onclick="dashboard.removeBasketItem(${index})">🗑️</button>
                    </td>
                </tr>
            `;
        }).join('');
        
        // Save to storage whenever we render
        localStorage.setItem('basketOrders', JSON.stringify(this.basketOrders));
    }
    
    toggleBasketItem(index) {
        if(this.basketOrders[index]) {
            this.basketOrders[index].selected = !this.basketOrders[index].selected;
            this.renderBasketUI();
        }
    }

// --- START of executeBasket() in dashboard.js ---

async executeBasket() {
   
    // 🔒 1. PREVENT DOUBLE EXECUTION (CHECK)
    if (this.isBasketExecuting) {
        console.warn('Basket execution already in progress');
        return;
    }

    // --- INITIAL CHECKS (BEFORE LOCK IS SET) ---
    const selectedOrders = this.basketOrders.filter(o => o.selected);
    
    if (selectedOrders.length === 0) {
        alert('Please select at least one item from basket');
        return; // Safe to exit, lock was never set.
    }

    // 🔑 2. NEW: CONFIRMATION MODAL
    if (!confirm(`WARNING: You are about to execute ${selectedOrders.length} orders (${selectedOrders.filter(o => o.action === 'BUY').length} BUY, ${selectedOrders.filter(o => o.action === 'SELL').length} SELL). Are you absolutely sure?`)) {
        console.log('Basket execution cancelled by user.');
        return; // Safe to exit, lock was never set.
    }
    // --- END INITIAL CHECKS ---
    
    // 3. SET THE LOCK AND START
    this.isBasketExecuting = true;

    try {
        console.log('Executing basket with', selectedOrders.length, 'items');

        // Separate BUY and SELL orders
        const buyOrders = selectedOrders.filter(o => o.action === 'BUY');
        const sellOrders = selectedOrders.filter(o => o.action === 'SELL');
        
        console.log('BUY orders:', buyOrders.length, 'SELL orders:', sellOrders.length);

        // Execute BUY first, then SELL
        const allOrders = [...buyOrders, ...sellOrders];
        
        for (let index = 0; index < allOrders.length; index++) {
    const item = allOrders[index];

    // 👇 NEW: decide segment once
    if (!item.segment) {
        if (item.symbol.includes('SENSEX') || item.symbol.includes('BANKEX')) {
            item.segment = 'BFO';
        } else {
            item.segment = 'NFO';
        }
    }

    // Small delay between orders (500ms gap)
    if (index > 0) {
        await sleep(500);
    }
            
    try {
        // Get lot size
        const response = await fetch(
            `/api/lot-size?symbol=${encodeURIComponent(item.symbol)}&segment=${item.segment}`
        );

                const lotData = await response.json();
                const lotSize = lotData.success ? lotData.lot_size : 75;
                
                // Prepare order details
                const orderDetails = {
                    symbol: item.symbol,
                    action: item.action,
                    optionType: item.optionType,
                    strike: item.strike,
                    price: item.price || 0,
                    quantity: (parseInt(item.qty) || 1) * lotSize,

                    product: 'NRML',
                    // === NEW: Pass the correct Type and Trigger from Basket Item ===
                    priceType: item.priceType || (item.price ? 'LIMIT' : 'MARKET'), 
                    triggerPrice: item.triggerPrice || 0,
                    
                    segment: item.segment,
                };
                
                // Create tracker order
                const orderId = window.OrderTracker?.createOrder(orderDetails);
                
                // Place actual order
                this.placeConfirmedOrder(orderDetails, orderId);
                
            } catch (error) {
                console.error('Basket item failed:', item.symbol, error);
            }
        }
        
        alert(`✅ Basket execution completed: ${buyOrders.length} BUY → ${sellOrders.length} SELL orders sent.`);
        
        // Just refresh UI
        if (typeof renderBasketUI === 'function') renderBasketUI();

    } catch (criticalError) {
        console.error('🔴 CRITICAL EXECUTION FAILED:', criticalError);
        alert('❌ Basket execution failed due to a critical error. Check console.');
    } finally {
        // 🔑 4. GUARANTEE LOCK RELEASE
        this.isBasketExecuting = false;
        console.log("Basket execution finished. Lock released.");
    }
     

}
// --- END of executeBasket() in dashboard.js ---   

       
    blankPortfolio() {
        const pnlElement = document.getElementById('pnlDisplay');
        if (pnlElement) pnlElement.innerHTML = '';
    }

   placeConfirmedOrder(orderDetails, orderId) {
    console.log("🔄 Placing order:", orderDetails);
    
    // Disable buttons briefly
    const buttons = document.querySelectorAll('.buy-btn, .sell-btn');
    buttons.forEach(btn => btn.disabled = true);
    
    showOrderLoading(true, `Placing ${orderDetails.action} order...`);

    let finalOrderType = 'L'; // Default to Limit
    let finalPrice = parseFloat(orderDetails.price) || 0;
    let finalTriggerPrice = parseFloat(orderDetails.triggerPrice) || 0;

    // === 🛡️ MARKET PROTECTION SYSTEM ===
    // If user selects MARKET, we convert it to a Safe LIMIT order
    if (orderDetails.priceType === 'MARKET') {
        
        // 1. Get Live LTP (Try Data first, then fallback to passed price)
        let liveLtp = 0;
        if (window.optionChainData) {
            const item = window.optionChainData.find(row => 
                row.symbol === orderDetails.symbol
            );
            if (item) {
                // Use Call or Put LTP based on option type
                liveLtp = parseFloat(item.ltp) || 0;
            }
        }
        // Fallback if data search failed
        if (liveLtp === 0 && orderDetails.price > 0) {
            liveLtp = orderDetails.price;
        }

        if (liveLtp > 0) {
            // 2. Calculate Safety Buffer
            const bufferPercent = this.marketProtectionPercent || 5; // Default 5%
            const buffer = liveLtp * (bufferPercent / 100);
            
            if (orderDetails.action === 'BUY') {
                // BUY: Cap price at LTP + Buffer (e.g., 100 + 5 = 105)
                // You get filled at best price (100), but never pay more than 105.
                finalPrice = liveLtp + buffer;
                finalPrice = Math.round(finalPrice / 0.05) * 0.05; // Tick size
                console.log(`🛡️ Shield Active: BUY Market converted to Limit @ ${finalPrice} (LTP ${liveLtp})`);
            } else {
                // SELL: Floor price at LTP - Buffer (e.g., 100 - 5 = 95)
                finalPrice = liveLtp - buffer;
                finalPrice = Math.round(finalPrice / 0.05) * 0.05;
                if (finalPrice < 0.05) finalPrice = 0.05;
                console.log(`🛡️ Shield Active: SELL Market converted to Limit @ ${finalPrice} (LTP ${liveLtp})`);
            }

            // 3. FORCE ORDER TYPE TO LIMIT
            finalOrderType = 'L'; 
            
        } else {
            // If we have ZERO price info, we must send as MKT (High Risk, but fallback)
            console.warn("⚠️ Market Protection Skipped: No LTP found.");
            finalOrderType = 'MKT';
            finalPrice = 0;
        }
    } 
    else if (orderDetails.priceType === 'SL') {
        finalOrderType = 'SL';
        // Price and Trigger stay as defined by user
    }
    else if (orderDetails.priceType === 'SL-M') {
        finalOrderType = 'SL-M';
        finalPrice = 0;
        // Note: Since SL-M is forbidden on some segments, consider using SL-Limit instead.
    }
    
    // Final sanity check
    if (orderDetails.priceType === 'LIMIT') {
        finalOrderType = 'L';
        finalPrice = orderDetails.price;
    }

    const finalSegment = orderDetails.segment || document.getElementById('marketType')?.value || 'NFO';

    const orderData = {
        symbol: orderDetails.symbol,
        transaction_type: orderDetails.action === 'BUY' ? 'B' : 'S',
        quantity: orderDetails.quantity,
        product_code: orderDetails.product || 'NRML',
        price: finalPrice.toFixed(2),
        order_type: finalOrderType,
        trigger_price: finalTriggerPrice.toString(),
        validity: 'DAY',
        am_flag: 'NO',
        segment: finalSegment
    };

    // Update Tracker
    if (window.OrderTracker && orderId) {
        window.OrderTracker.updateState(orderId, 'SENT');
    }

    // Send to Backend
    fetch('/api/place-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
    })
    .then(response => response.json())
    .then(data => {
        if (window.OrderTracker && orderId) {
            if (data.success) {
                window.OrderTracker.updateState(orderId, 'CONFIRMED', {
                    orderNumber: data.order_number,
                    brokerOrderId: data.order_id
                });
                showOrderLoading(false, `✅ Order Placed! #${data.order_number}`);
            } else {
                window.OrderTracker.updateState(orderId, 'REJECTED', {
                    error: data.message,
                    brokerResponse: data
                });
                showOrderLoading(false, `❌ Failed: ${data.message}`);
            }
        } else {
            if (data.success) {
                showOrderLoading(false, `✅ Order Placed! #${data.order_number}`);
            } else {
                showOrderLoading(false, `❌ Failed: ${data.message}`);
            }
        }
        
        // Refresh Windows
        if (window.popupManager) {
            if (typeof window.popupManager.refreshOrderHistory === 'function') setTimeout(() => window.popupManager.refreshOrderHistory(), 1000);
            if (typeof window.popupManager.refreshPortfolio === 'function') setTimeout(() => window.popupManager.refreshPortfolio(), 1500);
        }
    })
    .catch(error => {
        if (window.OrderTracker && orderId) {
            window.OrderTracker.updateState(orderId, 'REJECTED', {
                error: error.message,
                type: 'network_error'
            });
        }
        console.error('❌ Order Error:', error);
        showOrderLoading(false, '❌ Network Error');
    })
    .finally(() => {
        setTimeout(() => {
            const buttons = document.querySelectorAll('.buy-btn, .sell-btn');
            buttons.forEach(btn => btn.disabled = false);
        }, 2000);
    });
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
            // Start the price updates
            if (typeof startIndexPriceUpdates === 'function') {
                startIndexPriceUpdates();
            }
        }
    }

    // 👇 PASTE NEW CODE HERE (INSIDE THE CLASS) 👇
    setupSettingsUI() {
        const slider = document.getElementById('marketProtectionSlider');
        const display = document.getElementById('marketProtectionValue');
        const applyBtn = document.getElementById('applySettingsBtn');
        const resetBtn = document.getElementById('resetSettingsBtn');

        if (!slider || !applyBtn) return;

        // 1. LOAD: Set slider to current value on open
        slider.value = this.marketProtectionPercent;
        display.textContent = this.marketProtectionPercent + "%";

        // 2. LIVE UPDATE: Update text as you drag
        slider.addEventListener('input', (e) => {
            display.textContent = e.target.value + "%";
        });

        // 3. SAVE: When "Apply Changes" is clicked
        applyBtn.addEventListener('click', () => {
            const newValue = parseFloat(slider.value);
            this.marketProtectionPercent = newValue;

            // Update Storage (Preserve other settings)
            let currentSettings = {};
            try {
                currentSettings = JSON.parse(localStorage.getItem('appSettings')) || {};
            } catch(e) {}

            currentSettings.marketProtection = newValue;
            localStorage.setItem('appSettings', JSON.stringify(currentSettings));
            
            // Visual Feedback
            const originalText = applyBtn.textContent;
            applyBtn.textContent = "✅ Saved!";
            setTimeout(() => applyBtn.textContent = originalText, 1000);
            console.log(`🛡️ Market Protection updated to ${newValue}%`);
        });

        // 4. RESET: When "Reset" is clicked
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                slider.value = 10;
                display.textContent = "10%";
                this.marketProtectionPercent = 10;
                
                let s = JSON.parse(localStorage.getItem('appSettings')) || {};
                s.marketProtection = 10;
                localStorage.setItem('appSettings', JSON.stringify(s));
            });
        }
    }
    // 👆 END OF NEW CODE 👆

} // <---- CLASS ENDS HERE
function getDashboard() { 
    return window.dashboard; 
}
function showIndexPricesWindow() {
    if (window.popupManager && typeof window.popupManager.showWindow === 'function') {
        window.popupManager.showWindow('indexPricesWindow');
        startIndexPriceUpdates();
    }
}



// ======================================================
// SIMPLE BOT DATA FETCHER (CLEAN & SIMPLE)
// ======================================================
class SimpleBotFetcher {
    constructor() {
        this.timer = null;
        this.niftyExpiry = null;
    }
    
    async start() {
        console.log("🤖 Starting Simple Bot Fetcher...");
        await this.getNearestExpiry();
        
        if (this.niftyExpiry) {
            // Fetch every 2 seconds (faster updates for bot)
            this.timer = setInterval(() => {
                this.fetchNiftyForBot();
            }, 2000); 
            
            // Fetch immediately once
            this.fetchNiftyForBot();
        } else {
            console.log("🤖 Could not get expiry, retrying in 5s");
            setTimeout(() => this.start(), 5000);
        }
    }
    
    stop() {
        if (this.timer) clearInterval(this.timer);
        console.log("🤖 Bot Fetcher Stopped");
    }
    
    async getNearestExpiry() {
        try {
            const response = await fetch('/api/expiries-v2?index=NIFTY&segment=NFO');
            const data = await response.json();
            
            if (data.success && data.expiries && data.expiries.length > 0) {
                // 🧠 SIMPLE LOGIC: The backend already sorts by date.
                // The first item is ALWAYS the nearest/current expiry.
                this.niftyExpiry = data.expiries[0];
                console.log(`🤖 Bot locked on Current Expiry: ${this.niftyExpiry}`);
            }
        } catch (error) {
            console.log("🤖 Failed to get expiry:", error);
        }
    }
    
    async fetchNiftyForBot() {
        if (!this.niftyExpiry) return;
        
        try {
            // Fetch strikes=20 to give bot enough data
            const url = `/api/option-chain?index=NIFTY&expiry=${encodeURIComponent(this.niftyExpiry)}&strikes=20&segment=NFO`;
            await fetch(url);
        } catch (error) {
            // Ignore errors silently
        }
    }
}

window.botFetcher = new SimpleBotFetcher();





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