// order-tracker.js
class OrderStateMachine {
    constructor() {
        this.orders = new Map();      // orderId -> {state, details, timestamps}
        this.listeners = new Set();   // for UI listeners
        this.pendingOrders = new Set(); // Prevent duplicate clicks
        this.maxPendingTime = 10000;    // 10 seconds timeout
    }

    onChange(listener) {
        this.listeners.add(listener);
    }

    _emitChange(changedOrder = null) {
        const all = this.getAllOrders();
        this.listeners.forEach(fn => {
            try {
                fn(changedOrder, all);
            } catch (e) {
                console.error('OrderTracker listener error:', e);
            }
        });
    }

    getAllOrders() {
        return Array.from(this.orders.values());
    }

    // States: IDLE → PENDING → SENT → CONFIRMED → FILLED/CANCELLED/REJECTED
    createOrder(orderDetails) {
        const orderId = `${orderDetails.symbol}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const order = {
            
            id: orderId,
            details: orderDetails,
            state: 'PENDING',
            timestamps: {
                created: Date.now(),
                pending: Date.now(),   // 👈 start timer for PENDING state
                sent: null,
                confirmed: null,
                completed: null
            },
            retryCount: 0,
            lastError: null
        };

        this.orders.set(orderId, order);
        this.pendingOrders.add(orderId);
        this._emitChange(order); // 👈 add this
    

        // Auto-cleanup if stuck in PENDING
        setTimeout(() => this.checkStuckOrder(orderId), this.maxPendingTime);
        
        return orderId;
    }

updateState(orderId, newState, data = {}) {
    const order = this.orders.get(orderId);
    if (!order) return false;

    const validTransitions = {
        'PENDING': ['SENT', 'CANCELLED', 'REJECTED'],
        'SENT': ['CONFIRMED', 'REJECTED', 'CANCELLED'],
        'CONFIRMED': ['FILLED', 'PARTIALLY_FILLED', 'CANCELLED'],
        'FILLED': [],
        'REJECTED': [],
        'CANCELLED': []
    };

    if (validTransitions[order.state]?.includes(newState)) {

        order.state = newState;
        order.timestamps[newState.toLowerCase()] = Date.now();

        // Copy backend fields into order
        Object.assign(order, data);

        // ID sync patch
        if (data.orderNumber && !order.brokerOrderId) {
            order.brokerOrderId = data.orderNumber;
        }
        if (data.brokerOrderId && !order.orderNumber) {
            order.orderNumber = data.brokerOrderId;
        }

        // Remove from pending if terminal
        if (['FILLED', 'REJECTED', 'CANCELLED'].includes(newState)) {
            this.pendingOrders.delete(orderId);
        }

        // 🔥 NEW LINE — notify Pizza UI of change
        this._emitChange(order);

        console.log(`🔄 Order ${orderId} state: ${order.state}`);
        return true;
    }

    console.warn(`❌ Invalid state transition: ${order.state} → ${newState}`);
    return false;
}

        // 🔍 Find our pizza order using broker order number
        findOrderByBrokerNumber(orderNumber) {
        if (!orderNumber) return null;
        for (const order of this.orders.values()) {
            if (
                String(order.orderNumber) === String(orderNumber) ||
                String(order.brokerOrderId) === String(orderNumber)
            ) {
                return order;
            }
        }
        return null;
    }

    // 🧩 Shortcut: update state using broker order number
    updateStateByBrokerNumber(orderNumber, newState, data = {}) {
        const order = this.findOrderByBrokerNumber(orderNumber);
        if (!order) return false;
        return this.updateState(order.id, newState, data);
    }

    checkStuckOrder(orderId) {
    const order = this.orders.get(orderId);
    if (!order) return;

    const now = Date.now();
    const timeInState = now - order.timestamps[order.state.toLowerCase()];
    
    // === FIX: Only cancel MARKET orders after 5 seconds ===
    if (order.state === 'PENDING' && timeInState > 5000) {
        // Check if this is a MARKET order (orderType should be in details)
        if (order.details.orderType === 'MARKET' || 
            order.details.priceType === 'MARKET' || 
            order.details.price === 0) {
            console.warn(`⚠️ MARKET Order ${orderId} stuck in PENDING for 5s`);
            this.updateState(orderId, 'CANCELLED', {reason: 'Timeout'});
        } else {
            console.log(`ℹ️ LIMIT Order ${orderId} still waiting (ok)`);
        }
    }
    
    if (order.state === 'SENT' && timeInState > 10000) {
        console.warn(`⚠️ Order ${orderId} stuck in SENT for 10s`);
        // Option: Trigger retry or notify user
    }
}
    canPlaceOrder(symbol, action) {
        // Check if same order is already pending
        for (const orderId of this.pendingOrders) {
            const order = this.orders.get(orderId);
            if (order.details.symbol === symbol && 
                order.details.action === action &&
                order.state === 'PENDING') {
                return false;
            }
        }
        

        return true;
    }

    getOrderStatus(orderId) {
        return this.orders.get(orderId);
    }

    getAllActiveOrders() {
        return Array.from(this.orders.values())
            .filter(o => !['FILLED', 'REJECTED', 'CANCELLED'].includes(o.state));
    }
}

// Make it globally available
window.OrderTracker = new OrderStateMachine();