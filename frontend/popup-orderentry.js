                  // === ORDER ENTRY LOGIC ===
PopupManager.prototype.setupOrderEntryWindow = function () {
    const winElement = document.getElementById('orderEntryWindow'); 
    if (!winElement) return;

    this.makeDraggable(winElement);
    this.makeResizable(winElement);
    winElement.querySelector('.close-btn').addEventListener('click', () => this.hideWindow('orderEntryWindow'));
    winElement.querySelector('.minimize-btn').addEventListener('click', () => this.toggleMinimize(winElement));
    
    // Action buttons
    document.getElementById('actionBuy').addEventListener('click', () => { 
        this.setOrderAction('BUY'); 
        this.calculateOrderSummary(); 
    });
    document.getElementById('actionSell').addEventListener('click', () => { 
        this.setOrderAction('SELL'); 
        this.calculateOrderSummary(); 
    });
    
    // Quantity input
    document.getElementById('orderQty').addEventListener('input', () => this.calculateOrderSummary());
    document.getElementById('orderQty').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('submitOrderBtn').click();
        }
    });
    
    // Price type
    document.getElementById('priceTypeSelect').addEventListener('change', (e) => { 
        this.toggleLimitPrice(e.target.value); 
        this.calculateOrderSummary(); 
    });
    document.getElementById('limitPrice').addEventListener('input', () => this.calculateOrderSummary());
    
    // Cancel button
    const cancelBtn = document.getElementById("cancelOrderBtn");
    if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
            this.hideWindow("orderEntryWindow");
        });
    }

    // Submit order button
    const submitOrderBtn = document.getElementById('submitOrderBtn');
    if (submitOrderBtn) {
        submitOrderBtn.addEventListener('click', () => {
            const orderDetails = this.getOrderDetailsFromForm();
            console.log('🍕 Popup submit orderDetails =', orderDetails);

            // === NEW: STOPLOSS VALIDATION LOGIC ===
            const isBuy = orderDetails.action === 'BUY';
            // We use the "snapshot" price from dataset for validation safety
            const ltp = parseFloat(document.getElementById('orderEntryWindow').dataset.currentPrice) || 0;
            const trigger = orderDetails.triggerPrice;
            const price = orderDetails.price;

            // Only run checks if it is a Stoploss order
            if (orderDetails.priceType === 'SL' || orderDetails.priceType === 'SL-M') {
                if (trigger <= 0) {
                    alert('⚠️ Trigger Price must be greater than 0');
                    return; // Stop here
                }

                if (isBuy) {
                    // Rule: BUY Stoploss must be HIGHER than current market price
                    if (trigger <= ltp) {
                        alert(`⚠️ BUY SL Error:\nTrigger Price (${trigger}) must be HIGHER than LTP (${ltp})`);
                        return;
                    }
                    // Rule: Limit Price must be >= Trigger (otherwise it won't fill)
                    if (orderDetails.priceType === 'SL' && price < trigger) {
                        alert(`⚠️ BUY SL Error:\nLimit Price (${price}) must be >= Trigger Price (${trigger})`);
                        return;
                    }
                } else {
                    // Rule: SELL Stoploss must be LOWER than current market price
                    if (trigger >= ltp) {
                        alert(`⚠️ SELL SL Error:\nTrigger Price (${trigger}) must be LOWER than LTP (${ltp})`);
                        return;
                    }
                    // Rule: Limit Price must be <= Trigger
                    if (orderDetails.priceType === 'SL' && price > trigger) {
                        alert(`⚠️ SELL SL Error:\nLimit Price (${price}) must be <= Trigger Price (${trigger})`);
                        return;
                    }
                }
            }
            // === END VALIDATION ===

            const dashboard = window.dashboard || (window.opener ? window.opener.dashboard : null);

            if (dashboard && typeof dashboard.placeConfirmedOrder === 'function') {
                let orderId = null;
                if (window.OrderTracker) {
                    orderId = window.OrderTracker.createOrder(orderDetails);
                    console.log('🍕 Popup created orderId:', orderId);
                }
                dashboard.placeConfirmedOrder(orderDetails, orderId);
                this.hideWindow('orderEntryWindow'); 
            } else {
                console.error("Dashboard missing. window.dashboard is:", window.dashboard);
                alert('❌ Error: Dashboard not found. Please refresh the page.');
            }
        });
    }
    
    // ===== ADD TO BASKET BUTTON =====
    const addToBasketBtn = document.getElementById('addToBasketBtn');
    if (addToBasketBtn) {
        addToBasketBtn.addEventListener('click', () => {
            console.log('🧺 Closing popup after adding to basket');
            this.hideWindow('orderEntryWindow');
        });
    }
    
    // ===== ALERT BUTTON =====
    const alertBtn = document.getElementById('btn-order-to-alert');
    if (alertBtn) {
        alertBtn.addEventListener('click', () => {
            console.log("🔔 Alert button clicked!");
            
            const symbol = document.getElementById('orderSymbol')?.value;
            const price = document.getElementById('orderEntryWindow')?.dataset?.currentPrice || "0";

            console.log("Symbol:", symbol, "Price:", price);
            
            this.hideWindow('orderEntryWindow');

            if (window.popupAlerts && window.popupAlerts.openWithData) {
                window.popupAlerts.openWithData(symbol, price);
            } else {
                console.error("PopupAlerts not available!");
            }
        });
    }
    
    this.windows.set('orderEntryWindow', winElement);
};
PopupManager.prototype.openOrderEntry = async function (orderDetails) {
    // 1. Basic Fields
    document.getElementById('orderSymbol').value = orderDetails.symbol;
    document.getElementById('orderStrike').value = orderDetails.strike;
    document.getElementById('orderOptionType').value = orderDetails.optionType;
    
    const orderEntryWindow = document.getElementById('orderEntryWindow');
    orderEntryWindow.dataset.currentPrice = orderDetails.price; // or LTP

    this.setOrderAction(orderDetails.action || 'BUY');
    
    // 2. Pre-fill Type & Product (Respect incoming data!)
    document.getElementById('orderTypeSelect').value = orderDetails.product || 'NRML';
    const pType = orderDetails.priceType || 'MARKET';
    document.getElementById('priceTypeSelect').value = pType;

    // 3. Handle Visibility of Inputs based on Type
    this.toggleLimitPrice(pType);

    // 4. Pre-fill Prices (Crucial for Editing)
    if (orderDetails.price) document.getElementById('limitPrice').value = orderDetails.price;
    if (orderDetails.triggerPrice) document.getElementById('triggerPrice').value = orderDetails.triggerPrice;

    // 5. Fetch Lot Size & Set Quantity
    document.querySelector('.qty-help').textContent = '🔄 Fetching lot size...';
    document.getElementById('totalQty').textContent = 'Calculating...';

    try {
        const response = await fetch(`/api/lot-size?symbol=${encodeURIComponent(orderDetails.symbol)}`);
        const data = await response.json();
        if (data.success) {
            window.currentLotSize = data.lot_size;
            document.querySelector('.qty-help').textContent = `1 lot = ${window.currentLotSize} units`;
            
            // 6. Set Quantity (Handle case where we saved Lots vs Total Qty)
            // Assuming basket saves "quantity" as LOTS based on dashboard.js logic
            // If orderDetails.quantity is large (e.g. 75), divide by lot size. 
            // If it's small (e.g. 1), treat as lots.
            let lots = orderDetails.quantity || 1;
            
            // Logic check: if quantity > 25 (likely total shares), convert to lots
            if (lots > 25 && window.currentLotSize > 0) {
                 lots = Math.round(lots / window.currentLotSize);
            }
            document.getElementById('orderQty').value = lots;

        } else throw new Error();
    } catch (error) {
        document.querySelector('.qty-help').textContent = '❌ Error';
        // Fallback
        document.getElementById('orderQty').value = orderDetails.quantity || 1;
    }
    
    document.getElementById('submitOrderBtn').disabled = false;
    this.calculateOrderSummary();
    this.showWindow('orderEntryWindow');
    
    // Auto-focus
    setTimeout(() => {
        const qtyInput = document.getElementById('orderQty');
        if (qtyInput) {
            qtyInput.focus();
            qtyInput.select();
        }
    }, 100);
};PopupManager.prototype.setOrderAction = function (action) {
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
    const limitGroup = document.getElementById('limitPriceGroup');
    const triggerGroup = document.getElementById('triggerPriceGroup');
    
    // Show Limit Price for LIMIT and SL
    limitGroup.style.display = ['LIMIT', 'SL'].includes(priceType) ? 'block' : 'none';
    
    // Show Trigger Price for SL and SL-M
    triggerGroup.style.display = ['SL', 'SL-M'].includes(priceType) ? 'block' : 'none';

};

PopupManager.prototype.getOrderDetailsFromForm = function () {
    const symbol = document.getElementById('orderSymbol').value;
    const action = document.getElementById('actionBuy').classList.contains('buy-active') ? 'BUY' : 'SELL';
    const qty = parseInt(document.getElementById('orderQty').value) || 1;
    const priceType = document.getElementById('priceTypeSelect').value;
    
    // Existing Limit Price
    const limitPrice = parseFloat(document.getElementById('limitPrice').value) || 0;
    
    // NEW: Read Trigger Price
    const triggerPrice = parseFloat(document.getElementById('triggerPrice').value) || 0;
    
    const currentPrice = parseFloat(document.getElementById('orderEntryWindow').dataset.currentPrice) || 0;
    const totalQty = qty * (window.currentLotSize || 0);

    // Determine the price to send based on type
    let price = 0;
    if (priceType === 'LIMIT' || priceType === 'SL') {
        price = limitPrice;
    } else if (priceType === 'MARKET') {
        price = 0; 
    }
    // For SL-M, price is 0 (market), but triggerPrice carries the stop value.

    return {
        symbol, 
        action, 
        quantity: totalQty, 
        price, 
        triggerPrice, // Added to the result
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

// NEW: Updates the Live LTP in the popup dynamically
PopupManager.prototype.updateLivePrice = function (symbol, newPrice) {
    const win = document.getElementById('orderEntryWindow');
    // 1. Check if window is open
    if (!win || win.style.display === 'none') return;

    // 2. Check if the incoming price belongs to the symbol currently in the popup
    const currentSymbol = document.getElementById('orderSymbol').value;
    if (currentSymbol !== symbol) return;

    // 3. Update the hidden dataset (Used for Validation logic)
    win.dataset.currentPrice = newPrice;

    // 4. Update the visual display (The Green Badge)
    const display = document.getElementById('popupLiveLtp');
    if (display) {
        display.textContent = `LTP: ${parseFloat(newPrice).toFixed(2)}`;
    }
    
    // 5. If "Market" order is selected, update the Estimated Amount in real-time
    const priceType = document.getElementById('priceTypeSelect').value;
    if (priceType === 'MARKET') {
        this.calculateOrderSummary();
    }
};
