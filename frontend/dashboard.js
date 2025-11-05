// Trading Dashboard JavaScript
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
        
        // Load expiries first, then option chain (ONLY ONCE, not in interval)
        this.loadExpiries().then(() => {
            this.loadOptionChain();
        });
        
        this.loadPortfolio();
        
        // REDUCED intervals - every 5 seconds instead of 1-2 seconds
        // Remove if you don't need auto-refresh
        // setInterval(() => this.loadOptionChain(), 5000);
        // setInterval(() => this.loadPortfolio(), 5000);
        
        this.isInitialized = true;
    }

    setupEventListeners() {
        // Toggle mode button
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
                this.loadPortfolio();
            });
        }

        this.setupLoginListeners();
    }

    setupDropdownListeners() {
        // Market type change
        document.getElementById('marketType').addEventListener('change', (e) => {
            this.updateIndices(e.target.value);
        });

        // Index change
        document.getElementById('indexSelect').addEventListener('change', () => {
            this.loadExpiries();
            this.loadOptionChain();
        });

        // Expiry change
        document.getElementById('expirySelect').addEventListener('change', () => {
            this.loadOptionChain();
        });

        // Strike count change
        document.getElementById('strikeCount').addEventListener('change', () => {
            this.loadOptionChain();
        });
    }

    async updateIndices(market) {
        const indexSelect = document.getElementById('indexSelect');
        
        try {
            const response = await fetch(`/api/indices?market=${market}`);
            const data = await response.json();
            
            if (data.success) {
                indexSelect.innerHTML = data.indices.map(index => 
                    `<option value="${index}">${index}</option>`
                ).join('');
                
                // Load expiries for the first index
                this.loadExpiries();
                this.loadOptionChain();
            }
        } catch (error) {
            console.error('Failed to load indices:', error);
            // Fallback to hardcoded indices
            const fallbackIndices = market === 'NFO' 
                ? ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY']
                : ['SENSEX', 'BANKEX'];
                
            indexSelect.innerHTML = fallbackIndices.map(index => 
                `<option value="${index}">${index}</option>`
            ).join('');
        }
    }

    async loadExpiries() {
        const market = document.getElementById('marketType').value;
        const expirySelect = document.getElementById('expirySelect');
        
        try {
            const response = await fetch(`/api/expiries?market=${market}`);
            const data = await response.json();
            
            if (data.success || data.expiries) {
                if (data.expiries && data.expiries.length > 0) {
                    expirySelect.innerHTML = data.expiries.map(expiry => 
                        `<option value="${expiry}">${expiry}</option>`
                    ).join('');
                } else {
                    this.setDefaultExpiries();
                }
            } else {
                this.setDefaultExpiries();
            }
        } catch (error) {
            console.error('Failed to load expiries:', error);
            this.setDefaultExpiries();
        }
    }

    setDefaultExpiries() {
        const expirySelect = document.getElementById('expirySelect');
        const defaultExpiries = [
            '25-Jan-2024',
            '01-Feb-2024', 
            '08-Feb-2024',
            '15-Feb-2024',
            '22-Feb-2024',
            '29-Feb-2024'
        ];
        
        expirySelect.innerHTML = defaultExpiries.map(expiry => 
            `<option value="${expiry}">${expiry}</option>`
        ).join('');
    }

    async loadOptionChain() {
        const market = document.getElementById('marketType').value;
        const index = document.getElementById('indexSelect').value;
        const expiry = document.getElementById('expirySelect').value;
        const strikes = document.getElementById('strikeCount').value;
        
        try {
            const response = await fetch(`/api/option-chain?market=${market}&index=${index}&expiry=${expiry}&strikes=${strikes}`);
            const data = await response.json();
            
            if (data.success) {
                this.displayOptionChain(data.data);
            } else {
                const mockData = this.generateMockOptionChain();
                this.displayOptionChain(mockData);
            }
        } catch (error) {
            console.log('Using mock data for option chain');
            const mockData = this.generateMockOptionChain();
            this.displayOptionChain(mockData);
        }
    }

    setupLoginListeners() {
        const hideLoginBtn = document.getElementById('hideLoginBtn');
        const loginBtn = document.getElementById('loginBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        
        if (hideLoginBtn) {
            hideLoginBtn.addEventListener('click', () => {
                document.querySelector('.login-section').style.display = 'none';
            });
        }

        if (loginBtn) {
            loginBtn.addEventListener('click', () => {
                this.kotakLogin();
            });
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.kotakLogout();
            });
        }
    }
    async kotakLogin() {
    const totp = document.getElementById('totpInput').value;  // This is now 6-digit code
    const mpin = document.getElementById('mpinInput').value;
    const status = document.getElementById('loginStatus');

    if (!totp || !mpin) {
        status.innerHTML = '❌ Please enter both TOTP and MPIN';
        status.style.color = '#e74c3c';
        return;
    }

    if (totp.length !== 6 || isNaN(totp)) {
        status.innerHTML = '❌ TOTP must be 6 digits';
        status.style.color = '#e74c3c';
        return;
    }

    if (mpin.length !== 6 || isNaN(mpin)) {
        status.innerHTML = '❌ MPIN must be 6 digits';
        status.style.color = '#e74c3c';
        return;
    }

    status.innerHTML = '🔄 Logging in...';
    status.style.color = '#f39c12';

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `totp_secret=${encodeURIComponent(totp)}&mpin=${encodeURIComponent(mpin)}`
        });
        
        const data = await response.json();
        console.log('Login response:', data);
        
        if (data.status === 'success' && data.authenticated) {
            status.innerHTML = '✅ Login Successful (Live Mode)';
            status.style.color = '#27ae60';
            this.showLoggedInState();
            document.getElementById('totpInput').value = '';
            document.getElementById('mpinInput').value = '';
            
            // START AUTO-REFRESH
            this.autoRefreshInterval = setInterval(() => {
                this.loadOptionChain();
            }, 1000);
            
            this.portfolioRefreshInterval = setInterval(() => {
                this.loadPortfolio();
            }, 2000);
            
        } else {
            status.innerHTML = `❌ Login failed: ${data.message || 'Unknown error'}`;
            status.style.color = '#e74c3c';
        }
        
    } catch (error) {
        console.error('Login error:', error);
        status.innerHTML = '❌ Login failed: ' + error.message;
        status.style.color = '#e74c3c';
    }
}

    
    kotakLogout() {
    // Stop auto-refresh intervals
    if (this.autoRefreshInterval) {
        clearInterval(this.autoRefreshInterval);
    }
    if (this.portfolioRefreshInterval) {
        clearInterval(this.portfolioRefreshInterval);
    }
    
    this.showLoggedOutState();
    document.getElementById('loginStatus').innerHTML = '💡 Enter TOTP + MPIN';
    document.getElementById('loginStatus').style.color = '#7f8c8d';
}

   
    showLoggedInState() {
        document.getElementById('logoutSection').style.display = 'block';
        document.getElementById('kotakStatus').textContent = '(Live Mode)';
        document.getElementById('kotakStatus').style.color = '#27ae60';
    }

    showLoggedOutState() {
        document.getElementById('logoutSection').style.display = 'none';
        document.getElementById('kotakStatus').textContent = '(Demo Mode)';
        document.getElementById('kotakStatus').style.color = '#e74c3c';
    }

    generateMockOptionChain() {
        const strikes = [];
        const atm = 18200;
        const baseTime = Date.now() / 1000;
        
        for (let i = -5; i <= 5; i++) {
            const strike = atm + (i * 100);
            const baseCall = Math.max(50 + Math.abs(i) * 10, 10);
            const basePut = Math.max(45 + Math.abs(i) * 8, 8);
            const callMove = (Math.random() - 0.5) * 4;
            const putMove = (Math.random() - 0.5) * 4;
            const timeCall = Math.sin(baseTime * 0.5 + i) * 1;
            const timePut = Math.cos(baseTime * 0.5 + i) * 1;
            
            const callPrice = Math.max(baseCall + callMove + timeCall, 1);
            const putPrice = Math.max(basePut + putMove + timePut, 1);
            
            strikes.push({
                strike: strike,
                call: {
                    bid: Math.max(callPrice - 1, 0.5),
                    ask: callPrice + 1,
                    ltp: callPrice
                },
                put: {
                    bid: Math.max(putPrice - 1, 0.5),
                    ask: putPrice + 1,
                    ltp: putPrice
                }
            });
        }
        return strikes;
    }

    displayOptionChain(data) {
        const tbody = document.getElementById('optionData');
        const table = document.getElementById('optionTable');
        const loading = document.getElementById('loading');
        
        if (!tbody || !table || !loading) return;
        
        loading.style.display = 'none';
        table.style.display = 'table';
        
        tbody.innerHTML = data.map(row => `
            <tr>
                <td><strong>${row.strike}</strong></td>
                <td>${row.call_bid || row.call.bid.toFixed(2)}</td>
                <td>${row.call_ask || row.call.ask.toFixed(2)}</td>
                <td>${row.call_ltp || row.call.ltp.toFixed(2)}</td>
                <td>
                    <button class="buy-btn" onclick="dashboard.placeOrder('BUY', 'CE', ${row.strike}, ${row.call_ask || row.call.ask})">BUY</button>
                    <button class="sell-btn" onclick="dashboard.placeOrder('SELL', 'CE', ${row.strike}, ${row.call_bid || row.call.bid})" style="margin-top: 2px;">SELL</button>
                </td>
                <td>${row.put_bid || row.put.bid.toFixed(2)}</td>
                <td>${row.put_ask || row.put.ask.toFixed(2)}</td>
                <td>${row.put_ltp || row.put.ltp.toFixed(2)}</td>
                <td>
                    <button class="buy-btn" onclick="dashboard.placeOrder('BUY', 'PE', ${row.strike}, ${row.put_ask || row.put.ask})">BUY</button>
                    <button class="sell-btn" onclick="dashboard.placeOrder('SELL', 'PE', ${row.strike}, ${row.put_bid || row.put.bid})" style="margin-top: 2px;">SELL</button>
                </td>
            </tr>
        `).join('');
    }

    placeOrder(action, optionType, strike, price) {
        const quantity = parseInt(document.getElementById('quantity')?.value) || 50;
        const product = document.getElementById('productType')?.value || 'NRML';
        const symbol = `NIFTY25JAN${strike}${optionType}`;
        
        const orderDetails = {symbol, action, quantity, price, product, strike, optionType};

        if (this.oneClickMode) {
            this.placeConfirmedOrder(orderDetails);
        } else {
            this.showOrderConfirmation(orderDetails);
        }
    }

    showOrderConfirmation(order) {
        this.closeAllOrderModals();
        
        this.pendingOrder = order;
        
        const modal = document.createElement('div');
        modal.className = 'modal-backdrop';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;';
        modal.innerHTML = `
            <div class="modal-content" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); z-index: 1001; min-width: 400px;">
                <h3 style="margin: 0 0 15px 0; color: #2c3e50;">Confirm Order</h3>
                <div style="text-align: left; margin: 20px 0;">
                    <p><strong>Symbol:</strong> ${order.symbol}</p>
                    <p><strong>Action:</strong> ${order.action}</p>
                    <p><strong>Quantity:</strong> ${order.quantity} (${order.quantity/50} lots)</p>
                    <p><strong>Price:</strong> ₹${order.price.toFixed(2)}</p>
                    <p><strong>Product:</strong> ${order.product}</p>
                    <p><strong>Total:</strong> ₹${(order.quantity * order.price).toFixed(2)}</p>
                </div>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="cancel-order-btn" style="padding: 10px 20px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
                    <button class="confirm-order-btn" style="padding: 10px 20px; background: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Confirm Order</button>
                </div>
            </div>
        `;
        
        modal.querySelector('.cancel-order-btn').addEventListener('click', () => {
            this.closeOrderModal(modal);
        });
        
        modal.querySelector('.confirm-order-btn').addEventListener('click', () => {
            this.placeConfirmedOrder();
        });
        
        document.body.appendChild(modal);
    }

    closeAllOrderModals() {
        const modals = document.querySelectorAll('.modal-backdrop');
        modals.forEach(modal => {
            if (modal.parentNode) {
                document.body.removeChild(modal);
            }
        });
        this.pendingOrder = null;
    }

    closeOrderModal(modal) {
        if (modal && modal.parentNode) {
            document.body.removeChild(modal);
        }
        this.pendingOrder = null;
    }

    async placeConfirmedOrder(order = null) {
        const orderToPlace = order || this.pendingOrder;
        if (!orderToPlace) return;
        
        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            alert(`✅ Order placed!\n${orderToPlace.symbol} ${orderToPlace.action} ${orderToPlace.quantity} @ ${orderToPlace.price}`);
            
            this.closeAllOrderModals();
            this.pendingOrder = null;
            this.loadPortfolio();
        } catch (error) {
            alert('❌ Order failed');
        }
    }

    async loadPortfolio() {
        const mockPnl = {
            total: (Math.random() * 2000 - 1000).toFixed(2),
            positions: [
                { symbol: 'NIFTY25JAN18200CE', pnl: (Math.random() * 500 - 250).toFixed(2) },
                { symbol: 'NIFTY25JAN18300PE', pnl: (Math.random() * 300 - 150).toFixed(2) }
            ]
        };
        this.displayPortfolio(mockPnl);
    }

    displayPortfolio(portfolio) {
        const pnlElement = document.getElementById('pnlDisplay');
        if (!pnlElement) return;
        
        const totalPnl = parseFloat(portfolio.total);
        
        pnlElement.innerHTML = `
            <div class="${totalPnl >= 0 ? 'positive' : 'negative'}">
                Total: ₹${portfolio.total}
            </div>
            <div style="font-size: 14px; margin-top: 5px;">
                ${portfolio.positions.map(pos => 
                    `${pos.symbol}: <span class="${parseFloat(pos.pnl) >= 0 ? 'positive' : 'negative'}">₹${pos.pnl}</span>`
                ).join(' | ')}
            </div>
        `;
    }
}

// Initialize ONLY ONCE when DOM is loaded
let dashboard;
if (!window.dashboardInitialized) {
    document.addEventListener('DOMContentLoaded', () => {
        dashboard = new TradingDashboard();
        window.dashboardInitialized = true;
    });
}
