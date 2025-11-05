class PopupManager {
    constructor() {
        this.windows = new Map();
        this.isInitialized = false;
    }

    init() {
        if (this.isInitialized) return; // GUARD: Only initialize once
        
        console.log('Initializing PopupManager...');
        
        // Wait a bit for DOM to be fully ready
        setTimeout(() => {
            this.setupPortfolioWindow();
            this.setupOrderHistoryWindow();
            this.setupOrderEntryWindow();
            this.loadSampleData();
            this.hideAllWindows();
            
            this.isInitialized = true;
            console.log('PopupManager initialized successfully');
        }, 100);
    }

    setupPortfolioWindow() {
        const window = document.getElementById('portfolioWindow');
        if (!window) {
            console.error('Portfolio window not found');
            return;
        }
        
        this.makeDraggable(window);
        this.makeResizable(window);
        
        window.querySelector('.close-btn').addEventListener('click', () => {
            this.hideWindow('portfolioWindow');
        });
        
        window.querySelector('.minimize-btn').addEventListener('click', () => {
            this.toggleMinimize(window);
        });

        this.windows.set('portfolioWindow', window);
    }

    setupOrderHistoryWindow() {
        const window = document.getElementById('orderHistoryWindow');
        if (!window) {
            console.error('Order history window not found');
            return;
        }
        
        this.makeDraggable(window);
        this.makeResizable(window);
        
        window.querySelector('.close-btn').addEventListener('click', () => {
            this.hideWindow('orderHistoryWindow');
        });
        
        window.querySelector('.minimize-btn').addEventListener('click', () => {
            this.toggleMinimize(window);
        });

        window.querySelectorAll('.filter-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.setActiveFilter(e.target);
            });
        });

        this.windows.set('orderHistoryWindow', window);
    }

    setupOrderEntryWindow() {
        const window = document.getElementById('orderEntryWindow');
        if (!window) {
            console.error('Order entry window not found');
            return;
        }
        
        this.makeDraggable(window);
        this.makeResizable(window);
        
        window.querySelector('.close-btn').addEventListener('click', () => {
            this.hideWindow('orderEntryWindow');
        });
        
        window.querySelector('.minimize-btn').addEventListener('click', () => {
            this.toggleMinimize(window);
        });

        document.getElementById('actionBuy').addEventListener('click', () => {
            this.setOrderAction('BUY');
        });
        
        document.getElementById('actionSell').addEventListener('click', () => {
            this.setOrderAction('SELL');
        });

        document.getElementById('orderQty').addEventListener('input', () => {
            this.calculateOrderSummary();
        });

        document.getElementById('priceTypeSelect').addEventListener('change', (e) => {
            this.toggleLimitPrice(e.target.value);
        });

        document.getElementById('limitPrice').addEventListener('input', () => {
            this.calculateOrderSummary();
        });

        document.getElementById('cancelOrderBtn').addEventListener('click', () => {
            this.hideWindow('orderEntryWindow');
        });

        document.getElementById('submitOrderBtn').addEventListener('click', () => {
            this.submitOrder();
        });

        this.windows.set('orderEntryWindow', window);
    }

    setOrderAction(action) {
        const buyBtn = document.getElementById('actionBuy');
        const sellBtn = document.getElementById('actionSell');
        
        buyBtn.classList.remove('buy-active', 'sell-active');
        sellBtn.classList.remove('buy-active', 'sell-active');
        
        if (action === 'BUY') {
            buyBtn.classList.add('buy-active');
        } else {
            sellBtn.classList.add('sell-active');
        }
    }

    toggleLimitPrice(priceType) {
        const limitPriceGroup = document.getElementById('limitPriceGroup');
        if (priceType === 'LIMIT') {
            limitPriceGroup.style.display = 'block';
        } else {
            limitPriceGroup.style.display = 'none';
        }
        this.calculateOrderSummary();
    }

    calculateOrderSummary() {
        const qty = parseInt(document.getElementById('orderQty').value) || 1;
        const priceType = document.getElementById('priceTypeSelect').value;
        const limitPrice = parseFloat(document.getElementById('limitPrice').value) || 0;
        const currentPrice = parseFloat(document.getElementById('orderEntryWindow').dataset.currentPrice) || 0;
        
        const totalQty = qty * 50;
        document.getElementById('totalQty').textContent = totalQty;
        
        let estimatedAmount = 0;
        if (priceType === 'MARKET') {
            estimatedAmount = totalQty * currentPrice;
        } else {
            estimatedAmount = totalQty * limitPrice;
        }
        
        document.getElementById('estimatedAmount').textContent = `₹${estimatedAmount.toFixed(2)}`;
    }

    submitOrder() {
        const symbol = document.getElementById('orderSymbol').value;
        const action = document.getElementById('actionBuy').classList.contains('buy-active') ? 'BUY' : 'SELL';
        const qty = parseInt(document.getElementById('orderQty').value) || 1;
        const orderType = document.getElementById('orderTypeSelect').value;
        const priceType = document.getElementById('priceTypeSelect').value;
        const limitPrice = parseFloat(document.getElementById('limitPrice').value) || 0;
        const currentPrice = parseFloat(document.getElementById('orderEntryWindow').dataset.currentPrice) || 0;
        
        const totalQty = qty * 50;
        const price = priceType === 'MARKET' ? currentPrice : limitPrice;
        
        const orderDetails = {
            symbol,
            action,
            quantity: totalQty,
            price,
            product: orderType,
            priceType,
            strike: document.getElementById('orderStrike').value,
            optionType: document.getElementById('orderOptionType').value
        };
        
        this.hideWindow('orderEntryWindow');
        
        if (window.dashboard) {
            window.dashboard.placeConfirmedOrder(orderDetails);
        }
    }

    openOrderEntry(orderDetails) {
        document.getElementById('orderSymbol').value = orderDetails.symbol;
        document.getElementById('orderStrike').value = orderDetails.strike;
        document.getElementById('orderOptionType').value = orderDetails.optionType;
        
        const orderEntryWindow = document.getElementById('orderEntryWindow');
        orderEntryWindow.dataset.currentPrice = orderDetails.price;
        
        this.setOrderAction(orderDetails.action || 'BUY');
        document.getElementById('orderQty').value = Math.ceil(orderDetails.quantity / 50);
        document.getElementById('orderTypeSelect').value = 'NRML';
        document.getElementById('priceTypeSelect').value = 'MARKET';
        this.toggleLimitPrice('MARKET');
        
        this.calculateOrderSummary();
        this.showWindow('orderEntryWindow');
    }

    makeDraggable(element) {
        const header = element.querySelector('.window-header');
        if (!header) return;
        
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        
        header.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
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
            
            const newTop = element.offsetTop - pos2;
            const newLeft = element.offsetLeft - pos1;
            
            const maxTop = window.innerHeight - element.offsetHeight;
            const maxLeft = window.innerWidth - element.offsetWidth;
            
            element.style.top = Math.max(0, Math.min(newTop, maxTop)) + "px";
            element.style.left = Math.max(0, Math.min(newLeft, maxLeft)) + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    makeResizable(element) {
        const resizeHandle = element.querySelector('.resize-handle');
        if (!resizeHandle) return;
        
        resizeHandle.addEventListener('mousedown', function(e) {
            e.preventDefault();
            
            const startX = e.clientX;
            const startY = e.clientY;
            const startWidth = parseInt(document.defaultView.getComputedStyle(element).width, 10);
            const startHeight = parseInt(document.defaultView.getComputedStyle(element).height, 10);
            
            function doDrag(e) {
                const newWidth = startWidth + e.clientX - startX;
                const newHeight = startHeight + e.clientY - startY;
                
                element.style.width = Math.max(350, Math.min(newWidth, 1200)) + 'px';
                element.style.height = Math.max(300, Math.min(newHeight, 800)) + 'px';
            }
            
            function stopDrag() {
                document.documentElement.removeEventListener('mousemove', doDrag, false);
                document.documentElement.removeEventListener('mouseup', stopDrag, false);
            }
            
            document.documentElement.addEventListener('mousemove', doDrag, false);
            document.documentElement.addEventListener('mouseup', stopDrag, false);
        });
    }

    toggleMinimize(window) {
        const body = window.querySelector('.window-body');
        const isMinimized = body.style.display === 'none';
        
        body.style.display = isMinimized ? 'block' : 'none';
        window.style.height = isMinimized ? 'auto' : '50px';
    }

    showWindow(windowId) {
        const window = this.windows.get(windowId);
        if (window) {
            window.style.display = 'block';
            
            const rect = window.getBoundingClientRect();
            if (rect.right > window.innerWidth || rect.bottom > window.innerHeight || !window.style.left) {
                window.style.left = '50px';
                window.style.top = '50px';
            }
        }
    }

    hideWindow(windowId) {
        const window = this.windows.get(windowId);
        if (window) {
            window.style.display = 'none';
        }
    }

    hideAllWindows() {
        this.windows.forEach((window, id) => {
            window.style.display = 'none';
        });
    }

    setActiveFilter(clickedTab) {
        clickedTab.parentElement.querySelectorAll('.filter-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        
        clickedTab.classList.add('active');
        
        const filter = clickedTab.dataset.filter;
        this.filterOrders(filter);
    }

    filterOrders(filter) {
        const orders = document.querySelectorAll('.order-item');
        
        orders.forEach(order => {
            if (filter === 'all') {
                order.style.display = 'flex';
            } else {
                const matches = order.classList.contains(filter);
                order.style.display = matches ? 'flex' : 'none';
            }
        });
    }

    loadSampleData() {
        const portfolioData = {
            totalInvestment: 100000,
            currentValue: 115000,
            totalPnl: 15000,
            todaysPnl: 2500,
            holdings: [
                { symbol: 'NIFTY25JAN18200CE', quantity: 50, avgPrice: 85.50, currentPrice: 91.00, pnl: 275 },
                { symbol: 'NIFTY25JAN18300PE', quantity: 50, avgPrice: 92.25, currentPrice: 89.75, pnl: -125 },
                { symbol: 'RELIANCE', quantity: 10, avgPrice: 2450.00, currentPrice: 2520.00, pnl: 700 }
            ]
        };

        const orders = [
            { symbol: 'NIFTY25JAN18200CE', action: 'BUY', quantity: 50, price: 85.50, status: 'completed', timestamp: '10:30 AM' },
            { symbol: 'NIFTY25JAN18300PE', action: 'SELL', quantity: 50, price: 92.25, status: 'completed', timestamp: '11:15 AM' },
            { symbol: 'RELIANCE', action: 'BUY', quantity: 10, price: 2450.00, status: 'pending', timestamp: '11:45 AM' },
            { symbol: 'NIFTY25JAN18100CE', action: 'SELL', quantity: 50, price: 110.25, status: 'cancelled', timestamp: '12:20 PM' }
        ];

        this.updatePortfolioDisplay(portfolioData);
        this.updateOrderHistoryDisplay(orders);
    }

    updatePortfolioDisplay(data) {
        const totalInvestmentEl = document.getElementById('totalInvestment');
        const currentValueEl = document.getElementById('currentValue');
        const totalPnlEl = document.getElementById('totalPnl');
        const todaysPnlEl = document.getElementById('todaysPnl');
        const holdingsList = document.getElementById('holdingsList');

        if (totalInvestmentEl) totalInvestmentEl.textContent = `₹${data.totalInvestment.toLocaleString()}`;
        if (currentValueEl) currentValueEl.textContent = `₹${data.currentValue.toLocaleString()}`;
        
        if (totalPnlEl) {
            totalPnlEl.className = `summary-item pnl ${data.totalPnl >= 0 ? 'positive' : 'negative'}`;
            totalPnlEl.querySelector('span:last-child').textContent = 
                `${data.totalPnl >= 0 ? '+' : ''}₹${Math.abs(data.totalPnl).toLocaleString()}`;
        }
        
        if (todaysPnlEl) {
            todaysPnlEl.className = `summary-item pnl ${data.todaysPnl >= 0 ? 'positive' : 'negative'}`;
            todaysPnlEl.querySelector('span:last-child').textContent = 
                `${data.todaysPnl >= 0 ? '+' : ''}₹${Math.abs(data.todaysPnl).toLocaleString()}`;
        }

        if (holdingsList) {
            holdingsList.innerHTML = data.holdings.map(holding => `
                <div class="holding-item">
                    <div class="stock-info">
                        <strong>${holding.symbol}</strong>
                        <span>Qty: ${holding.quantity}</span>
                    </div>
                    <div class="stock-pnl">
                        <div>₹${holding.currentPrice.toFixed(2)}</div>
                        <div class="${holding.pnl >= 0 ? 'positive' : 'negative'}">
                            ${holding.pnl >= 0 ? '+' : ''}₹${Math.abs(holding.pnl).toFixed(2)}
                        </div>
                    </div>
                </div>
            `).join('');
        }
    }

    updateOrderHistoryDisplay(orders) {
        const ordersList = document.getElementById('ordersList');
        if (ordersList) {
            ordersList.innerHTML = orders.map(order => `
                <div class="order-item ${order.status}">
                    <div class="order-symbol">${order.symbol}</div>
                    <div class="order-details">
                        <span>${order.action} ${order.quantity} @ ₹${order.price}</span>
                        <span class="order-status status-${order.status}">
                            ${order.status.toUpperCase()}
                        </span>
                    </div>
                    <div class="order-details">
                        <span>${order.timestamp}</span>
                        <span>Total: ₹${(order.quantity * order.price).toLocaleString()}</span>
                    </div>
                </div>
            `).join('');
        }
    }
}

// Global functions to show windows
function showPortfolioWindow() {
    if (!window.popupManager) {
        window.popupManager = new PopupManager();
        window.popupManager.init();
    }
    window.popupManager.showWindow('portfolioWindow');
}

function showOrderHistoryWindow() {
    if (!window.popupManager) {
        window.popupManager = new PopupManager();
        window.popupManager.init();
    }
    window.popupManager.showWindow('orderHistoryWindow');
}

function showOrderEntryWindow(orderDetails) {
    if (!window.popupManager) {
        window.popupManager = new PopupManager();
        window.popupManager.init();
    }
    window.popupManager.openOrderEntry(orderDetails);
}

// FIXED: Initialize ONLY ONCE with guard to prevent duplication
if (!window.popupManagerInitialized) {
    document.addEventListener('DOMContentLoaded', () => {
        if (!window.popupManager) {
            window.popupManager = new PopupManager();
            window.popupManager.init();
        }
        window.popupManagerInitialized = true;
    });
}
