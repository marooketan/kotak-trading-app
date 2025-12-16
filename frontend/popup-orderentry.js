                  // === ORDER ENTRY LOGIC ===
PopupManager.prototype.setupOrderEntryWindow = function () {
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
};

PopupManager.prototype.openOrderEntry = async function (orderDetails) {
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
};
PopupManager.prototype.setOrderAction = function (action) {
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
};

PopupManager.prototype.toggleLimitPrice = function (priceType) {
     document.getElementById('limitPriceGroup').style.display = priceType === 'LIMIT' ? 'block' : 'none';
};
PopupManager.prototype.getOrderDetailsFromForm = function () {
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
};
PopupManager.prototype.calculateOrderSummary = function () {
    const qty = parseInt(document.getElementById('orderQty').value) || 1;
        const priceType = document.getElementById('priceTypeSelect').value;
        const limitPrice = parseFloat(document.getElementById('limitPrice').value) || 0;
        const currentPrice = parseFloat(document.getElementById('orderEntryWindow').dataset.currentPrice) || 0;
        const totalQty = qty * (window.currentLotSize || 0);
        
        document.getElementById('totalQty').textContent = totalQty;
        const price = priceType === 'MARKET' ? currentPrice : limitPrice;
        document.getElementById('estimatedAmount').textContent = `₹${(totalQty * price).toFixed(2)}`;
};
