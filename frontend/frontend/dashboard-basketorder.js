// dashboard-basketorder.js
(function () {
  class BasketOrders {
    constructor(storageKey = "basketOrders") {
      this.storageKey = storageKey;
      this.orders = this.load();
    }
    load() {
      const d = localStorage.getItem(this.storageKey);
      return d ? JSON.parse(d) : [];
    }
    save() {
      localStorage.setItem(this.storageKey, JSON.stringify(this.orders));
    }
    add(order) {
      this.orders.push(order);
      this.save();
    }
    clear() {
      this.orders = [];
      this.save();
    }
    async execute(apiUrl = "/api/place-order") {
      const out = [];
      for (const o of this.orders) {
        try {
          const r = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(o),
          });
          out.push({ order: o, ok: r.ok });
        } catch (e) {
          out.push({ order: o, ok: false, err: e.message });
        }
      }
      return out;
    }
    async executeBasket() {
  this.add({ symbol: "NIFTY25JAN18000CE", quantity: 5, selected: true, action: "BUY" });



    // 🔒 1. PREVENT DOUBLE EXECUTION (CHECK)
    if (this.isBasketExecuting) {
        console.warn('Basket execution already in progress');
        return;
    }

    // --- INITIAL CHECKS (BEFORE LOCK IS SET) ---
    const selectedOrders = this.orders.filter(o => o.selected);

    
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
                    priceType: item.price ? 'LIMIT' : 'MARKET',
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
       await this.execute();


    }
}
// --- END of executeBasket() in dashboard.js ---   

}

  

  // Make it global for script-tag usage
  window.basketOrders = new BasketOrders();
})();
