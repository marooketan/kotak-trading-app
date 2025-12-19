class TradingDashboard {
    constructor() {
        this.oneClickMode = false;
        this.pendingOrder = null;
        this.isInitialized = false;
        this.init();
    }

    init() {
        if (this.isInitialized) return;
        console.log('Initializing TradingDashboard...');
        this.setupEventListeners();
        this.setupDropdownListeners();

        // Initial Data Load
        this.loadExpiries().then(() => this.loadOptionChain());

        // Blank out P&L at start
        this.blankPortfolio();

        // Set initial Login Banner
        this.updateLoginBanner(false);

        this.isInitialized = true;
    }

    setupEventListeners() {
        // One-click mode toggle
        const toggleBtn = document.getElementById('toggleMode');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.oneClickMode = !this.oneClickMode;
                toggleBtn.textContent = `One-Click: ${this.oneClickMode ? 'ON' : 'OFF'}`;
                toggleBtn.className = this.oneClickMode ? 'on' : '';
            });
        }

        // Refresh button
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.loadOptionChain();
            });
        }

        // Order History Button
        const orderHistoryBtn = document.getElementById('orderHistoryBtn');
        if (orderHistoryBtn) {
            orderHistoryBtn.addEventListener('click', () => {
                this.showOrderHistory();
            });
        }

        // Portfolio Button
        const portfolioBtn = document.getElementById('portfolioBtn');
        if (portfolioBtn) {
            portfolioBtn.addEventListener('click', () => {
                this.showPortfolio();
            });
        }

        // Index Prices Button
        const indexPricesBtn = document.getElementById('indexPricesBtn');
        if (indexPricesBtn) {
            indexPricesBtn.addEventListener('click', () => {
                this.showIndexPrices();
            });
        }

        this.setupLoginListeners();
    }

    setupDropdownListeners() {
        ['marketType', 'indexSelect', 'expirySelect', 'strikeCount'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => this.loadOptionChain());
        });
    }
    setupLoginListeners() {
    const hideLoginBtn = document.getElementById('hideLoginBtn');
    const nextBtn = document.getElementById('nextBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const totpInput = document.getElementById('totpInput'); // ✅ ADD THIS LINE

    if (hideLoginBtn) {
        hideLoginBtn.addEventListener('click', () => {
            document.querySelector('.login-section').style.display = 'none';
        });
    }

    if (nextBtn) {
        nextBtn.textContent = "Login Securely";
        nextBtn.addEventListener('click', () => {
            this.performOneStepLogin();
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => this.kotakLogout());
    }

    // ✅ ADD THIS: Enter key support for TOTP input
    if (totpInput) {
        totpInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.performOneStepLogin();
            }
        });
    }
}

        async performOneStepLogin() {
        const totpInput = document.getElementById('totpInput');
        const totp = totpInput.value.trim();
        const status = document.getElementById('loginStatus');

        if (!totp || totp.length !== 6 || isNaN(totp)) {
            status.innerHTML = '❌ Enter valid 6-digit TOTP';
            status.style.color = '#e74c3c';
            return;
        }

        status.innerHTML = '🔄 Logging in...';
        status.style.color = '#f39c12';

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `totp=${encodeURIComponent(totp)}&mpin=000000`
            });

            const data = await response.json();
            console.log('Login response:', data);

            if (data.success) {
                status.innerHTML = '✅ Login Successful!';
                status.style.color = '#27ae60';
                this.showLoggedInState();
                totpInput.value = '';
                this.updateLoginBanner(true);

                // Start order history updates if available
                if (window.popupManager && typeof window.popupManager.startOrderHistoryUpdates === 'function') {
                    setTimeout(() => {
                        window.popupManager.startOrderHistoryUpdates();
                    }, 1000);
                }

                this.autoRefreshInterval = setInterval(() => this.loadOptionChain(), 30000);
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
        if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);

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
            header.parentNode.insertBefore(banner, header);
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
        const expirySelect = document.getElementById('expirySelect');
        try {
            const response = await fetch(`/api/expiries`);
            const data = await response.json();
            if (data.success && data.expiries.length > 0) {
                expirySelect.innerHTML = data.expiries.map(expiry =>
                    `<option value="${expiry}">${expiry}</option>`
                ).join('');
            }
        } catch (error) {
            console.error('Failed to load expiries:', error);
        }
    }

    async loadOptionChain() {
        const market = document.getElementById('marketType')?.value || 'NFO';
        const index = document.getElementById('indexSelect')?.value || 'NIFTY';
        const expiry = document.getElementById('expirySelect')?.value;
        const strikes = document.getElementById('strikeCount')?.value || '10';

        if (!expiry) return;
        try {
            const response = await fetch(`/api/option-chain?market=${market}&index=${index}&expiry=${expiry}&strikes=${strikes}`);
            const data = await response.json();

            if (data.success) {
                this.displayOptionChain(data.data, data.spot);
            }
        } catch (error) {
            console.log('Error loading chain:', error);
        }
    }

    displayOptionChain(data, spotPrice) {
        const tbody = document.getElementById('optionData');
        const loading = document.getElementById('loading');
        const optionTable = document.getElementById('optionTable');

        if (loading) loading.style.display = 'none';
        if (optionTable) optionTable.style.display = data.length ? '' : 'none';

        if (tbody) {
            const atmStrike = Math.round(spotPrice / 50) * 50;
            tbody.innerHTML = data.map(row => {
                const isATM = row.strike === atmStrike;
                const atmStyle = isATM ? 'background-color: #fff9c4;' : '';
                return `
                <tr class="${row.strike < spotPrice ? 'itm' : 'otm'}" style="${atmStyle}">
                    <td><strong>${row.strike}</strong>${isATM ? ' <span style="color:#ffb300;font-weight:bold;">ATM</span>' : ''}</td>
                    <td>${parseFloat(row.call.bid).toFixed(2)}</td>
                    <td>${parseFloat(row.call.ask).toFixed(2)}</td>
                    <td>${parseFloat(row.call.ltp).toFixed(2)}</td>
                    <td>
                        <button class="buy-btn" onclick="dashboard.placeOrder('BUY', 'CE', ${row.strike}, ${parseFloat(row.call.ask)}, '${row.pTrdSymbol}')">B</button>
                        <button class="sell-btn" onclick="dashboard.placeOrder('SELL', 'CE', ${row.strike}, ${parseFloat(row.call.bid)}, '${row.pTrdSymbol}')">S</button>
                    </td>
                    <td>${parseFloat(row.put.bid).toFixed(2)}</td>
                    <td>${parseFloat(row.put.ask).toFixed(2)}</td>
                    <td>${parseFloat(row.put.ltp).toFixed(2)}</td>
                    <td>
                        <button class="buy-btn" onclick="dashboard.placeOrder('BUY', 'PE', ${row.strike}, ${parseFloat(row.put.ask)}, '${row.pTrdSymbol}')">B</button>
                        <button class="sell-btn" onclick="dashboard.placeOrder('SELL', 'PE', ${row.strike}, ${parseFloat(row.put.bid)}, '${row.pTrdSymbol}')">S</button>
                    </td>
                </tr>
                `;
            }).join('');
        }
    }

    placeOrder(action, optionType, strike, price, symbol) {
        const lots = parseInt(document.getElementById('orderQty')?.value) || 1;
        const product = document.getElementById('productType')?.value || 'NRML';
        
        const orderDetails = {
            symbol: symbol,
            action: action,
            price: price,
            strike: strike,
            optionType: optionType,
            quantity: lots * 75,
            product: product
        };
        
        console.log("📝 Opening order entry for:", orderDetails);
        
        // Use the global openOrderEntry function
        if (typeof openOrderEntry === 'function') {
            openOrderEntry(orderDetails);
        } else {
            console.error('openOrderEntry function not found');
            // Fallback: place order directly
            if (confirm(`Place ${action} order for ${symbol} at ${price}?`)) {
                this.placeConfirmedOrder(orderDetails);
            }
        }
    }

    blankPortfolio() {
        const pnlElement = document.getElementById('pnlDisplay');
        if (pnlElement) pnlElement.innerHTML = '';
    }

    placeConfirmedOrder(orderDetails) {
        console.log("🔄 Placing order:", orderDetails);
        
        const orderData = {
            symbol: orderDetails.symbol,
            transaction_type: orderDetails.action === 'BUY' ? 'B' : 'S',
            quantity: orderDetails.quantity,
            product_code: orderDetails.product || 'NRML',
            price: orderDetails.price.toString(),
            order_type: orderDetails.priceType === 'MARKET' ? 'MKT' : 'L',
            validity: 'DAY',
            am_flag: 'NO'
        };

        console.log("📦 Sending to API:", orderData);

        fetch('/api/place-order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(orderData)
        })
        .then(response => response.json())
        .then(data => {
            console.log("📡 API Response:", data);
            if (data.success) {
                alert(`✅ Order Placed Successfully! Order Number: ${data.order_number}`);
                
                if (window.popupManager && typeof window.popupManager.refreshOrderHistory === 'function') {
                    setTimeout(() => {
                        window.popupManager.refreshOrderHistory();
                    }, 1000);
                }
            } else {
                alert(`❌ Order Failed: ${data.message}`);
            }
        })
        .catch(error => {
            console.error('❌ Order Error:', error);
            alert('❌ Network Error - Check console');
        });
    }

    showOrderHistory() {
        if (typeof showOrderHistoryWindow === 'function') {
            showOrderHistoryWindow();
        } else {
            console.error('showOrderHistoryWindow function not found');
        }
    }

    showPortfolio() {
        if (window.popupManager && typeof window.popupManager.showWindow === 'function') {
            window.popupManager.showWindow('portfolioWindow');
        } else {
            console.error('PopupManager not available for portfolio');
        }
    }

    showIndexPrices() {
        if (window.popupManager && typeof window.popupManager.showWindow === 'function') {
            window.popupManager.showWindow('indexPricesWindow');
            if (typeof startIndexPriceUpdates === 'function') {
                startIndexPriceUpdates();
            }
        } else {
            console.error('PopupManager not available for index prices');
        }
    }
}

let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new TradingDashboard();
});

function getDashboard() {
    return dashboard;
}

// Index Prices Functions
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
                if (item.exchange_token === "Nifty 50")
                    document.getElementById('popupNiftyPrice').textContent = item.ltp;
                if (item.exchange_token === "Nifty Bank")
                    document.getElementById('popupBankniftyPrice').textContent = item.ltp;
                if (item.exchange_token === "SENSEX")
                    document.getElementById('popupSensexPrice').textContent = item.ltp;
            });
        })
        .catch(error => {
            console.error('Error fetching index prices:', error);
        });
}

let indexPriceInterval;
function startIndexPriceUpdates() {
    updateIndexPricesPopup();
    if (!indexPriceInterval)
        indexPriceInterval = setInterval(updateIndexPricesPopup, 30000);
}

function stopIndexPriceUpdates() {
    clearInterval(indexPriceInterval);
    indexPriceInterval = null;
}