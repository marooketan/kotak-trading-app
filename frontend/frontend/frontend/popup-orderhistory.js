
PopupManager.prototype.setupOrderHistoryWindow = function () {

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
};
PopupManager.prototype.initializeAdvancedTable = function () {
    const table = document.getElementById('ordersTableBody');
        if (!table) return;
        this.loadColumnPreferences();
        this.makeColumnsDraggable();
        this.makeColumnsResizable();
};
PopupManager.prototype.makeColumnsDraggable = function () {
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
};
PopupManager.prototype.makeColumnsResizable = function () {
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
};

PopupManager.prototype.startColumnResize = function (header, e) {
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
};

PopupManager.prototype.reorderColumns = function (table, fromIndex, toIndex) {
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
   
};

PopupManager.prototype.loadColumnPreferences = function () {
    try {
            const saved = localStorage.getItem('orderHistoryColumns');
            if (saved) {
                const prefs = JSON.parse(saved);
                if (prefs.widths) this.applyColumnWidths(prefs.widths);
            }
        } catch (e) {}
};

PopupManager.prototype.applyColumnWidths = function (widths) {
    const headers = document.querySelectorAll('#orderHistoryWindow .orders-table th');
        headers.forEach((header, index) => {
            if (widths[index]) header.style.width = widths[index];
        });
};

PopupManager.prototype.refreshOrderHistory = async function () {
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
        // FIX: No orders is NOT an error
if (result && result.errMsg === 'No Data') {
    result.success = true;
    result.orders = [];
}

        console.log("📦 Order history result:", result);
        
        if (result.success && Array.isArray(result.orders)) {

            // 🔥 NEW: Reset retry counter on success
            this.ordersRetryCount = 0;
            this.updateOrderHistoryDisplay(result.orders);
      } else if(tbody) {
    // Check if it's empty orders array vs error message
    if (result && result.message === 'No Data') {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: #7f8c8d;">📭 No orders found</td></tr>`;
} else if (result && result.orders === null) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: #7f8c8d;">📭 No orders found</td></tr>`;
} else {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: #e74c3c;">❌ ${result.message || 'Failed to load orders'}</td></tr>`;
}

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
};
PopupManager.prototype.updateOrderHistoryDisplay = function (orders) {
      
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
    // Check if order exists and needs update
    const existingOrder = window.OrderTracker.findOrderByBrokerNumber(order.order_number);
    
    // Only update if order doesn't exist OR has different state
    if (!existingOrder || existingOrder.state !== newState) {
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
}
        });
    }

        
        ordersTableBody.innerHTML = '';
        orders.forEach(order => ordersTableBody.appendChild(this.createOrderRow(order)));
        
        const activeFilter = document.querySelector('.filter-tab.active')?.dataset?.filter || 'all';
        this.filterOrders(activeFilter);
};
PopupManager.prototype.createOrderRow = function (order) {
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
 };

PopupManager.prototype.formatTime = function (timestamp) {
    if (!timestamp) return 'N/A';
        try {
            return new Date(timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch { return timestamp; }
};

PopupManager.prototype.getSideDisplay = function (transactionType) {
    const side = transactionType === 'B' ? 'BUY' : 'SELL';
        const color = transactionType === 'B' ? '#27ae60' : '#e74c3c';
        return `<span style="color: ${color}; font-weight: bold;">${side}</span>`;
};

PopupManager.prototype.getStatusDisplay = function (status, kotakStatus) {
   const statusConfig = {
            'PENDING': { color: '#f39c12', text: 'PENDING' },
            'COMPLETED': { color: '#27ae60', text: 'COMPLETED' },
            'CANCELLED': { color: '#e74c3c', text: 'CANCELLED' }
        };
        const config = statusConfig[status] || { color: '#95a5a6', text: status };
        return `<span style="color: ${config.color}; font-weight: bold;">${config.text}</span>`;
};

PopupManager.prototype.createActionButtons = function (order) {
     if (order.status === 'PENDING') {
            return `<div class="action-buttons">
                <button class="btn-modify" onclick="window.popupManager.openModifyOrder('${order.unique_id}')" title="Modify">✏️</button>
                <button class="btn-cancel" onclick="window.popupManager.cancelOrder('${order.order_number}')" title="Cancel">❌</button>
            </div>`;
        }
        return `<div class="action-buttons"><span style="color: #95a5a6;">-</span></div>`;
};

PopupManager.prototype.setActiveFilter = function (clickedTab) {
    clickedTab.parentElement.querySelectorAll('.filter-tab').forEach(tab =>      tab.classList.remove('active'));
        clickedTab.classList.add('active');
        this.filterOrders(clickedTab.dataset.filter);
};

PopupManager.prototype.filterOrders = function (filter) {
    const orders = document.querySelectorAll('.order-item');
        let visibleCount = 0;
        orders.forEach(order => {
            const orderStatus = order.dataset.status ? order.dataset.status.toUpperCase() : '';
            const matches = filter === 'all' || orderStatus === filter.toUpperCase();
            order.style.display = matches ? 'table-row' : 'none';
            if (matches) visibleCount++;
        });
        this.updateResultsCount(visibleCount);
};

PopupManager.prototype.updateResultsCount = function (count) {
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
};

PopupManager.prototype.openModifyOrder = async function (uniqueId) {
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
};

PopupManager.prototype.getCellValue = function (row, column) {
    const cell = row.querySelector(`td[data-column="${column}"]`);
        return cell ? cell.textContent.trim() : '';
};

PopupManager.prototype.openModifyOrderPopup = function (orderDetails) {
     let modifyPopup = document.getElementById('modifyOrderPopup');
        if (!modifyPopup) {
            modifyPopup = this.createModifyOrderPopup();
            document.body.appendChild(modifyPopup);
        }
        this.populateModifyForm(orderDetails);
        modifyPopup.style.display = 'block';
};

PopupManager.prototype.createModifyOrderPopup = function () {
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
};

PopupManager.prototype.setupModifyPopupEvents = function (popup) {
     popup.querySelector('#cancelModifyBtn').addEventListener('click', () => popup.style.display = 'none');
        popup.querySelector('#submitModifyBtn').addEventListener('click', () => this.submitModifyOrder());
        ['#modifyPrice', '#modifyQuantity', '#modifyOrderType', '#modifyExpiry'].forEach(s => {
            const el = popup.querySelector(s);
            if(el) {
                el.addEventListener('change', () => this.updateModifyPreview());
                el.addEventListener('input', () => this.updateModifyPreview());
            }
        });
};

PopupManager.prototype.populateModifyForm = function (orderDetails) {
    document.getElementById('modifySymbol').value = orderDetails.symbol;
        document.getElementById('modifyPrice').value = orderDetails.price;
        document.getElementById('modifyQuantity').value = orderDetails.quantity;
        document.getElementById('modifyOrderType').value = orderDetails.order_type === 'MKT' ? 'MKT' : 'L';
        document.getElementById('modifyOrderPopup').dataset.orderDetails = JSON.stringify(orderDetails);
        this.loadExpiriesForModify(orderDetails.symbol);
        this.updateModifyPreview();

};

PopupManager.prototype.loadExpiriesForModify = async function (symbol) {
    const expirySelect = document.getElementById('modifyExpiry');
        if (!expirySelect) return;
        try {
            const index = symbol.includes('BANKNIFTY') ? 'BANKNIFTY' : 'NIFTY';
            const response = await fetch(`/api/expiries-v2?index=${index}`);
            const result = await response.json();
            // FIX: No orders is NOT an error
if (result && result.stat === 'Not_Ok' && result.errMsg === 'No Data') {
    result.success = true;
    result.orders = [];
}

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
};

PopupManager.prototype.updateModifyPreview = function () {
    const popup = document.getElementById('modifyOrderPopup');
        if (!popup) return;
        const orderDetails = JSON.parse(popup.dataset.orderDetails || '{}');
        const newPrice = document.getElementById('modifyPrice').value;
        const newQuantity = document.getElementById('modifyQuantity').value;
        const newOrderType = document.getElementById('modifyOrderType').value;
        const newExpiry = document.getElementById('modifyExpiry').value;

        document.getElementById('currentOrderDetails').textContent = `P: ${orderDetails.price}, Q: ${orderDetails.quantity}`;
        document.getElementById('modifiedOrderDetails').textContent = `P: ${newPrice}, Q: ${newQuantity}, T: ${newOrderType} ${newExpiry ? ', Exp: '+newExpiry : ''}`;

};

PopupManager.prototype.submitModifyOrder = async function () {
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
};

PopupManager.prototype.cancelOrder = async function (orderNumber) {
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
};

