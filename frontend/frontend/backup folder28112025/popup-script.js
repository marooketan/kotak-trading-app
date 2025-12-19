class PopupManager {
    constructor() {
        this.windows = new Map();
        this.isInitialized = false;
        this.orderHistoryInterval = null;
    }

    init() {
        if (this.isInitialized) return;

        console.log('Initializing PopupManager...');

        setTimeout(() => {
            this.setupPortfolioWindow();
            this.setupOrderHistoryWindow();
            this.setupOrderEntryWindow();
            this.setupIndexPricesWindow();
            this.setupSettingsWindow();
            this.loadSampleData();
            this.hideAllWindows();
            this.loadSavedSettings();

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
    setupSettingsWindow() {
    const window = document.getElementById('settingsWindow');
    if (!window) {
        console.error('Settings window not found');
        return;
    }
    this.makeDraggable(window);
    this.makeResizable(window);

    // Close button
    window.querySelector('.close-btn').addEventListener('click', () => {
        this.hideWindow('settingsWindow');
    });

    // Minimize button
    window.querySelector('.minimize-btn').addEventListener('click', () => {
        this.toggleMinimize(window);
    });

    // Setup event listeners for settings controls
    this.setupSettingsControls();

    this.windows.set('settingsWindow', window);
 }
    setupSettingsControls() {
    const fontSizeSlider = document.getElementById('fontSizeSlider');
    const fontSizeValue = document.getElementById('fontSizeValue');
    const fontColorPicker = document.getElementById('fontColorPicker');
    const headerColorPicker = document.getElementById('headerColorPicker');
    const applyBtn = document.getElementById('applySettingsBtn');
    const resetBtn = document.getElementById('resetSettingsBtn');

    if (fontSizeSlider && fontSizeValue) {
        // Update value display when slider moves
        fontSizeSlider.addEventListener('input', (e) => {
            fontSizeValue.textContent = e.target.value + 'px';
        });
    }

    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            this.applyCustomStyles();
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            this.resetCustomStyles();
        });
    }

    // Load saved settings when settings window opens
    this.loadSavedSettings();
 }
    applyCustomStyles() {
    const fontSize = document.getElementById('fontSizeSlider').value + 'px';
    const fontColor = document.getElementById('fontColorPicker').value;
    const headerColor = document.getElementById('headerColorPicker').value;

    // Apply to CSS variables
    document.documentElement.style.setProperty('--popup-font-size', fontSize);
    document.documentElement.style.setProperty('--popup-font-color', fontColor);
    document.documentElement.style.setProperty('--popup-header-bg', headerColor);

    // Save to localStorage
    this.saveSettingsToStorage({
        fontSize: fontSize,
        fontColor: fontColor,
        headerColor: headerColor
    });

    alert('✅ Settings applied successfully!');
}
    resetCustomStyles() {
    // Reset to default values
    const defaults = {
        fontSize: '14px',
        fontColor: '#2c3e50',
        headerColor: '#34495e'
    };

    // Apply defaults to CSS variables
    document.documentElement.style.setProperty('--popup-font-size', defaults.fontSize);
    document.documentElement.style.setProperty('--popup-font-color', defaults.fontColor);
    document.documentElement.style.setProperty('--popup-header-bg', defaults.headerColor);

    // Update form controls
    document.getElementById('fontSizeSlider').value = 14;
    document.getElementById('fontSizeValue').textContent = '14px';
    document.getElementById('fontColorPicker').value = defaults.fontColor;
    document.getElementById('headerColorPicker').value = defaults.headerColor;

    // Clear saved settings
    localStorage.removeItem('popupSettings');

    alert('✅ Settings reset to defaults!');
}
    saveSettingsToStorage(settings) {
    try {
        localStorage.setItem('popupSettings', JSON.stringify(settings));
        console.log('✅ Settings saved to localStorage');
    } catch (e) {
        console.error('❌ Failed to save settings:', e);
    }
}

loadSavedSettings() {
    try {
        const saved = localStorage.getItem('popupSettings');
        if (saved) {
            const settings = JSON.parse(saved);
            
            // Apply saved settings to CSS variables
            if (settings.fontSize) {
                document.documentElement.style.setProperty('--popup-font-size', settings.fontSize);
            }
            if (settings.fontColor) {
                document.documentElement.style.setProperty('--popup-font-color', settings.fontColor);
            }
            if (settings.headerColor) {
                document.documentElement.style.setProperty('--popup-header-bg', settings.headerColor);
            }

            // Update form controls
            if (document.getElementById('fontSizeSlider')) {
                const fontSizeNum = parseInt(settings.fontSize) || 14;
                document.getElementById('fontSizeSlider').value = fontSizeNum;
                document.getElementById('fontSizeValue').textContent = settings.fontSize;
                document.getElementById('fontColorPicker').value = settings.fontColor || '#2c3e50';
                document.getElementById('headerColorPicker').value = settings.headerColor || '#34495e';
            }

            console.log('✅ Loaded saved settings');
        }
    } catch (e) {
        console.error('❌ Failed to load settings:', e);
    }
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
            this.stopOrderHistoryUpdates();
        });

        window.querySelector('.minimize-btn').addEventListener('click', () => {
            this.toggleMinimize(window);
        });

        // Filter tabs
        window.querySelectorAll('.filter-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.setActiveFilter(e.target);
            });
        });

        // Refresh button
        const refreshBtn = window.querySelector('.refresh-orders');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.refreshOrderHistory();
            });
        }

        this.windows.set('orderHistoryWindow', window);
        
        // Initialize advanced table
        this.initializeAdvancedTable();
    }

    initializeAdvancedTable() {
        const table = document.getElementById('ordersTableBody');
        if (!table) return;

        // Load saved column preferences
        this.loadColumnPreferences();
        
        // Make columns draggable and resizable
        this.makeColumnsDraggable();
        this.makeColumnsResizable();
    }

    makeColumnsDraggable() {
        const headers = document.querySelectorAll('#orderHistoryWindow .orders-table th');
        headers.forEach(header => {
            header.setAttribute('draggable', true);
            
            header.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', header.cellIndex);
                header.classList.add('dragging');
            });

            header.addEventListener('dragend', () => {
                header.classList.remove('dragging');
            });

            header.addEventListener('dragover', (e) => {
                e.preventDefault();
            });

            header.addEventListener('drop', (e) => {
                e.preventDefault();
                const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                const toIndex = header.cellIndex;
                
                if (fromIndex !== toIndex) {
                    this.reorderColumns(fromIndex, toIndex);
                    this.saveColumnPreferences();
                }
            });
        });
    }

    makeColumnsResizable() {
        const headers = document.querySelectorAll('#orderHistoryWindow .orders-table th');
        headers.forEach(header => {
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            header.appendChild(resizeHandle);

            resizeHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.startColumnResize(header, e);
            });
        });
    }

    startColumnResize(header, e) {
        const startX = e.clientX;
        const startWidth = header.offsetWidth;
        const table = header.closest('table');

        function doResize(e) {
            const newWidth = startWidth + (e.clientX - startX);
            if (newWidth >= 50) { // Minimum width
                header.style.width = newWidth + 'px';
                // Adjust table container if needed
                table.style.width = '100%';
            }
        }

        function stopResize() {
            document.removeEventListener('mousemove', doResize);
            document.removeEventListener('mouseup', stopResize);
            document.body.style.cursor = '';
            // Save column sizes
            window.popupManager.saveColumnPreferences();
        }

        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
        document.body.style.cursor = 'col-resize';
    }

    reorderColumns(fromIndex, toIndex) {
        const table = document.querySelector('#orderHistoryWindow .orders-table');
        const headers = table.querySelectorAll('th');
        const rows = table.querySelectorAll('tbody tr');

        // Reorder headers
        const headersArray = Array.from(headers);
        const movedHeader = headersArray[fromIndex];
        headersArray.splice(fromIndex, 1);
        headersArray.splice(toIndex, 0, movedHeader);

        // Update header row
        const headerRow = table.querySelector('thead tr');
        headerRow.innerHTML = '';
        headersArray.forEach(header => headerRow.appendChild(header));

        // Reorder cell data in each row
        rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            const movedCell = cells[fromIndex];
            cells.splice(fromIndex, 1);
            cells.splice(toIndex, 0, movedCell);
            
            row.innerHTML = '';
            cells.forEach(cell => row.appendChild(cell));
        });

        // Reinitialize drag and drop
        setTimeout(() => {
            this.makeColumnsDraggable();
            this.makeColumnsResizable();
        }, 100);
    }

    loadColumnPreferences() {
        try {
            const saved = localStorage.getItem('orderHistoryColumns');
            if (saved) {
                const prefs = JSON.parse(saved);
                
                // Apply column order
                if (prefs.order && prefs.order.length > 0) {
                    this.applyColumnOrder(prefs.order);
                }
                
                // Apply column widths
                if (prefs.widths) {
                    this.applyColumnWidths(prefs.widths);
                }
            }
        } catch (e) {
            console.error('Error loading column preferences:', e);
        }
    }

    saveColumnPreferences() {
        try {
            const headers = document.querySelectorAll('#orderHistoryWindow .orders-table th');
            const order = Array.from(headers).map(header => header.dataset.column);
            const widths = Array.from(headers).map(header => header.style.width || '');
            
            const prefs = {
                order: order,
                widths: widths,
                timestamp: new Date().toISOString()
            };
            
            localStorage.setItem('orderHistoryColumns', JSON.stringify(prefs));
        } catch (e) {
            console.error('Error saving column preferences:', e);
        }
    }

    applyColumnOrder(columnOrder) {
        // Implementation for applying saved column order
        console.log('Applying column order:', columnOrder);
    }

    applyColumnWidths(widths) {
        const headers = document.querySelectorAll('#orderHistoryWindow .orders-table th');
        headers.forEach((header, index) => {
            if (widths[index]) {
                header.style.width = widths[index];
            }
        });
    }

    async refreshOrderHistory() {
        console.log("🔄 Refreshing order history...");
        
        const ordersTableBody = document.getElementById('ordersTableBody');
        if (!ordersTableBody) return;

        // Show loading state
        ordersTableBody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 20px; color: #7f8c8d;">
                    🔄 Loading orders...
                </td>
            </tr>
        `;

        try {
            const response = await fetch('/api/order-book');
            const result = await response.json();

            if (result.success && result.orders) {
                this.updateOrderHistoryDisplay(result.orders);
            } else {
                ordersTableBody.innerHTML = `
                    <tr>
                        <td colspan="9" style="text-align: center; padding: 20px; color: #e74c3c;">
                            ❌ Failed to load orders: ${result.message || 'Unknown error'}
                        </td>
                    </tr>
                `;
            }
        } catch (error) {
            console.error('Order history fetch error:', error);
            ordersTableBody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 20px; color: #e74c3c;">
                        ❌ Network error loading orders
                    </td>
                </tr>
            `;
        }
    }

    updateOrderHistoryDisplay(orders) {
        const ordersTableBody = document.getElementById('ordersTableBody');
        if (!ordersTableBody) return;

        if (!orders || orders.length === 0) {
            ordersTableBody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 20px; color: #7f8c8d;">
                        No orders found
                    </td>
                </tr>
            `;
            return;
        }

        // Clear existing content
        ordersTableBody.innerHTML = '';

        // Create rows for each order
        orders.forEach(order => {
            const row = this.createOrderRow(order);
            ordersTableBody.appendChild(row);
        });

        // Apply current filter
        const activeFilter = document.querySelector('.filter-tab.active')?.dataset?.filter || 'all';
        this.filterOrders(activeFilter);
    }

    createOrderRow(order) {
        const row = document.createElement('tr');
        row.className = `order-item ${order.status.toLowerCase()}`;
        row.dataset.uniqueId = order.unique_id;
        row.dataset.status = order.status;

        // Format timestamp
        const time = this.formatTime(order.timestamp);
        
        // Determine status color and text
        const statusInfo = this.getStatusInfo(order.status);
        
        // Create cells with proper data attributes for column management
        const cells = [
            { content: time, 'data-column': 'time' },
            { content: order.symbol || 'N/A', 'data-column': 'symbol' },
            { content: this.getSideDisplay(order.transaction_type), 'data-column': 'side' },
            { content: order.quantity || '0', 'data-column': 'quantity' },
            { content: order.price || '0.00', 'data-column': 'price' },
            { content: this.getStatusDisplay(order.status, order.kotak_status), 'data-column': 'status' },
            { content: this.createActionButtons(order), 'data-column': 'actions' }
        ];

        cells.forEach(cellData => {
            const cell = document.createElement('td');
            cell.innerHTML = cellData.content;
            cell.dataset.column = cellData['data-column'];
            row.appendChild(cell);
        });

        return row;
    }

    formatTime(timestamp) {
        if (!timestamp) return 'N/A';
        try {
            const date = new Date(timestamp);
            return date.toLocaleTimeString('en-IN', { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit'
            });
        } catch {
            return timestamp;
        }
    }

    getSideDisplay(transactionType) {
        const side = transactionType === 'B' ? 'BUY' : 'SELL';
        const color = transactionType === 'B' ? '#27ae60' : '#e74c3c';
        return `<span style="color: ${color}; font-weight: bold;">${side}</span>`;
    }

    getStatusDisplay(status, kotakStatus) {
        const statusConfig = {
            'PENDING': { color: '#f39c12', text: 'PENDING' },
            'COMPLETED': { color: '#27ae60', text: 'COMPLETED' },
            'CANCELLED': { color: '#e74c3c', text: 'CANCELLED' }
        };

        const config = statusConfig[status] || { color: '#95a5a6', text: status };
        return `<span style="color: ${config.color}; font-weight: bold;">${config.text}</span>`;
    }

    getStatusInfo(status) {
        const statusMap = {
            'PENDING': { color: '#f39c12', class: 'pending' },
            'COMPLETED': { color: '#27ae60', class: 'completed' },
            'CANCELLED': { color: '#e74c3c', class: 'cancelled' }
        };
        return statusMap[status] || { color: '#95a5a6', class: 'unknown' };
    }

    createActionButtons(order) {
        let buttons = '';
        
        if (order.status === 'PENDING') {
            buttons += `
                <button class="btn-modify" onclick="window.popupManager.openModifyOrder('${order.unique_id}')" 
                        title="Modify Order">✏️</button>
                <button class="btn-cancel" onclick="window.popupManager.cancelOrder('${order.order_number}')" 
                        title="Cancel Order">❌</button>
            `;
        } else {
            buttons += `<span style="color: #95a5a6;">-</span>`;
        }
        
        return `<div class="action-buttons">${buttons}</div>`;
    }

    startOrderHistoryUpdates() {
        // Refresh immediately
        this.refreshOrderHistory();
        
        // Set up periodic updates every 5 seconds
        this.orderHistoryInterval = setInterval(() => {
            this.refreshOrderHistory();
        }, 5000000000);
        
        console.log("✅ Order history real-time updates started");
    }

    stopOrderHistoryUpdates() {
        if (this.orderHistoryInterval) {
            clearInterval(this.orderHistoryInterval);
            this.orderHistoryInterval = null;
            console.log("🛑 Order history real-time updates stopped");
        }
    }

    setActiveFilter(clickedTab) {
        // Update active tab
        clickedTab.parentElement.querySelectorAll('.filter-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        clickedTab.classList.add('active');

        // Apply filter
        const filter = clickedTab.dataset.filter;
        this.filterOrders(filter);
    }
    filterOrders(filter) {
    const orders = document.querySelectorAll('.order-item');
    let visibleCount = 0;

    orders.forEach(order => {
        const orderStatus = order.dataset.status;
        
        if (filter === 'all') {
            order.style.display = 'table-row';
            visibleCount++;
        } else {
            // SAFER: Check if orderStatus exists before calling toUpperCase
            const orderStatusUpper = orderStatus ? orderStatus.toUpperCase() : '';
            const filterUpper = filter ? filter.toUpperCase() : '';
            const matches = orderStatusUpper === filterUpper;
            
            order.style.display = matches ? 'table-row' : 'none';
            if (matches) visibleCount++;
        }
    });

    // Update results count
    this.updateResultsCount(visibleCount);
}    
    updateResultsCount(count) {
        let resultsElement = document.getElementById('orderResultsCount');
        if (!resultsElement) {
            // Create results counter if it doesn't exist
            const filterTabs = document.querySelector('.filter-tabs');
            if (filterTabs) {
                resultsElement = document.createElement('div');
                resultsElement.id = 'orderResultsCount';
                resultsElement.style.cssText = 'margin-left: auto; color: #7f8c8d; font-size: 12px;';
                filterTabs.appendChild(resultsElement);
            }
        }
        
        if (resultsElement) {
            resultsElement.textContent = `${count} orders`;
        }
    }

    async openModifyOrder(uniqueId) {
        console.log("📝 Opening modify order for:", uniqueId);
        
        // Find the order by unique ID
        const orderRow = document.querySelector(`.order-item[data-unique-id="${uniqueId}"]`);
        if (!orderRow) {
            alert('Order not found');
            return;
        }

        // Extract order details from row
        const orderDetails = {
            unique_id: uniqueId,
            order_number: this.getCellValue(orderRow, 'order_number'),
            symbol: this.getCellValue(orderRow, 'symbol'),
            price: this.getCellValue(orderRow, 'price'),
            quantity: this.getCellValue(orderRow, 'quantity'),
            order_type: this.getCellValue(orderRow, 'order_type'),
            transaction_type: this.getCellValue(orderRow, 'side') === 'BUY' ? 'B' : 'S'
        };

        // Open modify order popup
        this.openModifyOrderPopup(orderDetails);
    }

    getCellValue(row, column) {
        const cell = row.querySelector(`td[data-column="${column}"]`);
        return cell ? cell.textContent.trim() : '';
    }

    openModifyOrderPopup(orderDetails) {
        // Create or show modify order popup
        let modifyPopup = document.getElementById('modifyOrderPopup');
        
        if (!modifyPopup) {
            modifyPopup = this.createModifyOrderPopup();
            document.body.appendChild(modifyPopup);
        }
        
        // Populate form with order details
        this.populateModifyForm(orderDetails);
        
        // Show popup
        modifyPopup.style.display = 'block';
    }

    createModifyOrderPopup() {
        const popup = document.createElement('div');
        popup.id = 'modifyOrderPopup';
        popup.className = 'popup-window';
        popup.innerHTML = `
            <div class="window-header">
                <div class="window-title">✏️ Modify Order</div>
                <div class="window-controls">
                    <button class="close-btn" onclick="document.getElementById('modifyOrderPopup').style.display='none'">×</button>
                </div>
            </div>
            <div class="window-content">
                <div class="order-form">
                    <div class="form-group">
                        <label>Symbol</label>
                        <input type="text" id="modifySymbol" readonly class="form-input">
                    </div>
                    
                    <div class="form-row">
                        <div class="form-group">
                            <label>Price</label>
                            <input type="number" id="modifyPrice" step="0.05" class="form-input">
                        </div>
                        <div class="form-group">
                            <label>Quantity</label>
                            <input type="number" id="modifyQuantity" min="1" class="form-input">
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Order Type</label>
                        <select id="modifyOrderType" class="form-select">
                            <option value="L">Limit</option>
                            <option value="MKT">Market</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>Expiry Date</label>
                        <select id="modifyExpiry" class="form-select">
                            <option value="">Loading expiries...</option>
                        </select>
                        <div class="help-text">Changing expiry will cancel current order and place new one</div>
                    </div>

                    <div class="order-summary">
                        <div class="summary-row">
                            <span>Current Order:</span>
                            <span id="currentOrderDetails">-</span>
                        </div>
                        <div class="summary-row">
                            <span>Modified Order:</span>
                            <span id="modifiedOrderDetails">-</span>
                        </div>
                    </div>

                    <div class="form-buttons">
                        <button id="cancelModifyBtn" class="btn-secondary">Cancel</button>
                        <button id="submitModifyBtn" class="btn-primary">Apply Changes</button>
                    </div>
                </div>
            </div>
        `;

        // Add event listeners
        this.setupModifyPopupEvents(popup);
        
        return popup;
    }

    setupModifyPopupEvents(popup) {
        // Cancel button
        popup.querySelector('#cancelModifyBtn').addEventListener('click', () => {
            popup.style.display = 'none';
        });

        // Submit button
        popup.querySelector('#submitModifyBtn').addEventListener('click', () => {
            this.submitModifyOrder();
        });

        // Real-time preview on input changes
        const inputs = ['#modifyPrice', '#modifyQuantity', '#modifyOrderType', '#modifyExpiry'];
        inputs.forEach(selector => {
            const element = popup.querySelector(selector);
            if (element) {
                element.addEventListener('change', () => this.updateModifyPreview());
                element.addEventListener('input', () => this.updateModifyPreview());
            }
        });
    }

    populateModifyForm(orderDetails) {
        document.getElementById('modifySymbol').value = orderDetails.symbol;
        document.getElementById('modifyPrice').value = orderDetails.price;
        document.getElementById('modifyQuantity').value = orderDetails.quantity;
        document.getElementById('modifyOrderType').value = orderDetails.order_type === 'MKT' ? 'MKT' : 'L';

        // Store current order details for reference
        document.getElementById('modifyOrderPopup').dataset.orderDetails = JSON.stringify(orderDetails);

        // Load expiries
        this.loadExpiriesForModify(orderDetails.symbol);

        // Update preview
        this.updateModifyPreview();
    }

    async loadExpiriesForModify(symbol) {
        const expirySelect = document.getElementById('modifyExpiry');
        if (!expirySelect) return;

        try {
            // Extract index from symbol (NIFTY or BANKNIFTY)
            const index = symbol.includes('BANKNIFTY') ? 'BANKNIFTY' : 'NIFTY';
            const response = await fetch(`/api/expiries-v2?index=${index}`);
            const result = await response.json();

            if (result.success) {
                expirySelect.innerHTML = '<option value="">Keep Current Expiry</option>';
                result.expiries.forEach(expiry => {
                    const option = document.createElement('option');
                    option.value = expiry;
                    option.textContent = expiry;
                    expirySelect.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Error loading expiries:', error);
            expirySelect.innerHTML = '<option value="">Error loading expiries</option>';
        }
    }

    updateModifyPreview() {
        const popup = document.getElementById('modifyOrderPopup');
        if (!popup) return;

        const orderDetails = JSON.parse(popup.dataset.orderDetails || '{}');
        const newPrice = document.getElementById('modifyPrice').value;
        const newQuantity = document.getElementById('modifyQuantity').value;
        const newOrderType = document.getElementById('modifyOrderType').value;
        const newExpiry = document.getElementById('modifyExpiry').value;

        // Current order details
        const currentDetails = `Symbol: ${orderDetails.symbol}, Price: ${orderDetails.price}, Qty: ${orderDetails.quantity}, Type: ${orderDetails.order_type}`;
        document.getElementById('currentOrderDetails').textContent = currentDetails;

        // Modified order details
        let modifiedDetails = `Symbol: ${orderDetails.symbol}`;
        if (newPrice && newPrice !== orderDetails.price) modifiedDetails += `, Price: ${newPrice}`;
        if (newQuantity && newQuantity !== orderDetails.quantity) modifiedDetails += `, Qty: ${newQuantity}`;
        if (newOrderType && newOrderType !== orderDetails.order_type) modifiedDetails += `, Type: ${newOrderType}`;
        if (newExpiry) modifiedDetails += `, New Expiry: ${newExpiry}`;

        document.getElementById('modifiedOrderDetails').textContent = modifiedDetails || 'No changes';
    }

    async submitModifyOrder() {
        const popup = document.getElementById('modifyOrderPopup');
        if (!popup) return;

        const orderDetails = JSON.parse(popup.dataset.orderDetails || '{}');
        const newPrice = document.getElementById('modifyPrice').value;
        const newQuantity = document.getElementById('modifyQuantity').value;
        const newOrderType = document.getElementById('modifyOrderType').value;
        const newExpiry = document.getElementById('modifyExpiry').value;

        // Validate changes
        if (!newPrice && !newQuantity && !newOrderType && !newExpiry) {
            alert('No changes made to the order');
            return;
        }

        const modifyData = {
            order_number: orderDetails.order_number,
            symbol: orderDetails.symbol,
            new_price: newPrice || null,
            new_quantity: newQuantity || null,
            new_order_type: newOrderType || null,
            new_expiry: newExpiry || null
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
                // Refresh order history
                this.refreshOrderHistory();
            } else {
                alert(`❌ Failed to modify order: ${result.message}`);
            }
        } catch (error) {
            console.error('Modify order error:', error);
            alert('❌ Network error modifying order');
        }
    }

    async cancelOrder(orderNumber) {
        if (!confirm('Are you sure you want to cancel this order?')) {
            return;
        }

        try {
            const response = await fetch('/api/cancel-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_number: orderNumber })
            });

            const result = await response.json();

            if (result.success) {
                alert('✅ Order cancelled successfully!');
                // Refresh order history
                this.refreshOrderHistory();
            } else {
                alert(`❌ Failed to cancel order: ${result.message}`);
            }
        } catch (error) {
            console.error('Cancel order error:', error);
            alert('❌ Network error cancelling order');
        }
    }

    setupOrderEntryWindow() {
    const window = document.getElementById('orderEntryWindow');
    if (!window) {
        console.error('Order entry window not found');
        return;
    }
    this.makeDraggable(window);
    this.makeResizable(window);

    // Close button
    window.querySelector('.close-btn').addEventListener('click', () => {
        this.hideWindow('orderEntryWindow');
    });

    // Minimize button
    window.querySelector('.minimize-btn').addEventListener('click', () => {
        this.toggleMinimize(window);
    });

    // Buy/Sell buttons
    document.getElementById('actionBuy').addEventListener('click', () => {
        this.setOrderAction('BUY');
        this.calculateOrderSummary();
    });

    document.getElementById('actionSell').addEventListener('click', () => {
        this.setOrderAction('SELL');
        this.calculateOrderSummary();
    });

    // Quantity input
    const orderQtyInput = document.getElementById('orderQty');
    if (orderQtyInput) {
        orderQtyInput.addEventListener('input', (e) => {
            console.log("🔄 Qty input detected:", e.target.value);
            this.calculateOrderSummary();
        });
    }

    // Price type selector
    document.getElementById('priceTypeSelect').addEventListener('change', (e) => {
        this.toggleLimitPrice(e.target.value);
        this.calculateOrderSummary();
    });

    // Limit price input
    document.getElementById('limitPrice').addEventListener('input', () => {
        this.calculateOrderSummary();
    });

    // ✅ FIXED: Add event listener to the EXISTING Place Order button
    const submitOrderBtn = document.getElementById('submitOrderBtn');
    if (submitOrderBtn) {
        submitOrderBtn.addEventListener('click', () => {
            console.log("🔄 Place Order button clicked!");
            const orderDetails = this.getOrderDetailsFromForm();
            console.log("📦 Order details:", orderDetails);
            
            const dashboard = getDashboard();
            if (dashboard && typeof dashboard.placeConfirmedOrder === 'function') {
                console.log("✅ Dashboard found, calling placeConfirmedOrder");
                dashboard.placeConfirmedOrder(orderDetails);
                this.hideWindow('orderEntryWindow');
            } else {
                console.error('❌ Dashboard not found or placeConfirmedOrder not a function');
                alert('❌ Dashboard not initialized. Please refresh the page.');
            }
        });
    } else {
        console.error('❌ Submit Order button not found in HTML');
    }

    this.windows.set('orderEntryWindow', window);
}

    // ✅ UPDATED: Order Entry Method with Dynamic Lot Size
async openOrderEntry(orderDetails) {
    console.log("📝 Opening order entry popup for:", orderDetails);
    
    // Set basic order details first
    document.getElementById('orderSymbol').value = orderDetails.symbol;
    document.getElementById('orderStrike').value = orderDetails.strike;
    document.getElementById('orderOptionType').value = orderDetails.optionType;

    const orderEntryWindow = document.getElementById('orderEntryWindow');
    orderEntryWindow.dataset.currentPrice = orderDetails.price;

    this.setOrderAction(orderDetails.action || 'BUY');
    document.getElementById('orderQty').value = 1; // Default to 1 lot
    document.getElementById('orderTypeSelect').value = orderDetails.product || 'NRML';
    document.getElementById('priceTypeSelect').value = 'MARKET';
    this.toggleLimitPrice('MARKET');

    // Show loading state for lot size
    document.querySelector('.qty-help').textContent = '🔄 Fetching lot size...';
    document.getElementById('totalQty').textContent = 'Calculating...';

    try {
        // Fetch actual lot size from API
        console.log("📡 Fetching lot size for symbol:", orderDetails.symbol);
        const response = await fetch(`/api/lot-size?symbol=${encodeURIComponent(orderDetails.symbol)}`);
        const data = await response.json();
        
        if (data.success) {
            window.currentLotSize = data.lot_size;
            document.querySelector('.qty-help').textContent = `1 lot = ${window.currentLotSize} units`;
            console.log("✅ Lot size fetched:", data.lot_size);
        } else {
            throw new Error(data.message || 'Failed to fetch lot size');
        }
    } catch (error) {
        console.error('❌ Lot size fetch error:', error);
        document.querySelector('.qty-help').textContent = '❌ Cannot fetch lot size - please try again';
        document.getElementById('totalQty').textContent = 'Error';
        // Disable order submission until lot size is known
        document.getElementById('submitOrderBtn').disabled = true;
        document.getElementById('submitOrderBtn').textContent = 'Cannot Place Order';
        return; // Don't proceed without lot size
    }
    

    // Re-enable order button if it was disabled
    document.getElementById('submitOrderBtn').disabled = false;
    document.getElementById('submitOrderBtn').textContent = 'Place Order';

    // Calculate initial summary
    this.calculateOrderSummary();
    
    // Show the popup
    this.showWindow('orderEntryWindow');
}
    
    // ✅ ADDED: Set Order Action
setOrderAction(action) {
    const buyBtn = document.getElementById('actionBuy');
    const sellBtn = document.getElementById('actionSell');
    
    if (action === 'BUY') {
        buyBtn.classList.add('buy-active');
        sellBtn.classList.remove('sell-active');
    } else {
        sellBtn.classList.add('sell-active');
        buyBtn.classList.remove('buy-active');
    }
} 
    // ✅ ADDED: Toggle Limit Price
    toggleLimitPrice(priceType) {
        const limitPriceGroup = document.getElementById('limitPriceGroup');
        if (priceType === 'LIMIT') {
            limitPriceGroup.style.display = 'block';
        } else {
            limitPriceGroup.style.display = 'none';
        }
    }

    getOrderDetailsFromForm() {
        const symbol = document.getElementById('orderSymbol').value;
        const action = document.getElementById('actionBuy').classList.contains('buy-active') ? 'BUY' : 'SELL';
        const qty = parseInt(document.getElementById('orderQty').value) || 1;
        const priceType = document.getElementById('priceTypeSelect').value;
        const limitPrice = parseFloat(document.getElementById('limitPrice').value) || 0;
        const currentPrice = parseFloat(document.getElementById('orderEntryWindow').dataset.currentPrice) || 0;
        
        const totalQty = qty * (window.currentLotSize || 0);
        const price = priceType === 'MARKET' ? currentPrice : limitPrice;

        return {
            symbol: symbol,
            action: action,
            quantity: totalQty,
            price: price,
            product: document.getElementById('orderTypeSelect').value || 'NRML',
            priceType: priceType,
            strike: document.getElementById('orderStrike').value,
            optionType: document.getElementById('orderOptionType').value
        };
    }

    calculateOrderSummary() {
        console.log("🔄 Calculating order summary...");
        
        const qtyInput = document.getElementById('orderQty');
        const qty = parseInt(qtyInput.value) || 1;
        
        const priceType = document.getElementById('priceTypeSelect').value;
        const limitPrice = parseFloat(document.getElementById('limitPrice').value) || 0;
        const currentPrice = parseFloat(document.getElementById('orderEntryWindow').dataset.currentPrice) || 0;

        console.log("📊 Calculation inputs:", { 
            qty, 
            currentLotSize: window.currentLotSize, 
            currentPrice, 
            limitPrice 
        });

        const totalQty = qty * (window.currentLotSize || 0);
        
        document.getElementById('totalQty').textContent = totalQty;
        console.log("✅ Total Quantity:", totalQty);

        let estimatedAmount = 0;
        if (priceType === 'MARKET') {
            estimatedAmount = totalQty * currentPrice;
        } else {
            estimatedAmount = totalQty * limitPrice;
        }

        document.getElementById('estimatedAmount').textContent = `₹${estimatedAmount.toFixed(2)}`;
        console.log("✅ Estimated Amount:", estimatedAmount);
    }

    setupIndexPricesWindow() {
        const window = document.getElementById('indexPricesWindow');
        if (!window) {
            console.error('Index prices window not found');
            return;
        }
        this.makeDraggable(window);
        this.makeResizable(window);

        window.querySelector('.close-btn').addEventListener('click', () => {
            this.hideWindow('indexPricesWindow');
        });

        window.querySelector('.minimize-btn').addEventListener('click', () => {
            this.toggleMinimize(window);
        });

        this.windows.set('indexPricesWindow', window);
    }

    makeDraggable(element) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = element.querySelector('.window-header');
        
        if (header) {
            header.onmousedown = dragMouseDown;
        }

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
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    makeResizable(element) {
        const resizeHandle = element.querySelector('.resize-handle');
        if (!resizeHandle) return;

        resizeHandle.addEventListener('mousedown', initResize);

        function initResize(e) {
            e.preventDefault();
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResize);
        }

        function resize(e) {
            element.style.width = e.clientX - element.offsetLeft + 'px';
            element.style.height = e.clientY - element.offsetTop + 'px';
        }

        function stopResize() {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResize);
        }
    }

    toggleMinimize(element) {
        const content = element.querySelector('.window-content');
        if (content.style.display === 'none') {
            content.style.display = 'block';
        } else {
            content.style.display = 'none';
        }
    }

    hideAllWindows() {
        this.windows.forEach((window, id) => {
            window.style.display = 'none';
        });
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
            
            // Start real-time updates for order history
            if (windowId === 'orderHistoryWindow') {
                this.startOrderHistoryUpdates();
            }
            
            if (windowId === 'indexPricesWindow' && typeof startIndexPriceUpdates === "function") {
                startIndexPriceUpdates();
            }
        }
    }

    hideWindow(windowId) {
        const window = this.windows.get(windowId);
        if (window) {
            window.style.display = 'none';
        }
        
        // Stop real-time updates
        if (windowId === 'orderHistoryWindow') {
            this.stopOrderHistoryUpdates();
        }
        
        if (windowId === 'indexPricesWindow' && typeof stopIndexPriceUpdates === "function") {
            stopIndexPriceUpdates();
        }
    }

    loadSampleData() {
        // Sample data for testing
        console.log("Loading sample data for popups...");
    }
}

// ✅ Global functions to show popups
function showOrderHistoryWindow() {
    ensurePopupManagerReady().then(() => {
        window.popupManager.showWindow('orderHistoryWindow');
    });
}

// ✅ Order Entry function
function openOrderEntry(orderDetails) {
    ensurePopupManagerReady().then(() => {
        if (window.popupManager && typeof window.popupManager.openOrderEntry === 'function') {
            window.popupManager.openOrderEntry(orderDetails);
        } else {
            console.error('PopupManager openOrderEntry not available');
            createFallbackOrderEntry(orderDetails);
        }
    });
}

// ✅ Ensure popup manager is ready
function ensurePopupManagerReady() {
    return new Promise((resolve) => {
        if (window.popupManager && window.popupManager.isInitialized) {
            resolve();
            return;
        }
        
        console.log('🔄 Ensuring PopupManager is ready...');
        
        if (typeof PopupManager !== 'undefined') {
            if (!window.popupManager) {
                window.popupManager = new PopupManager();
                console.log('🔄 Created new PopupManager instance');
            }
            
            if (!window.popupManager.isInitialized) {
                window.popupManager.init();
                console.log('🔄 Initialized PopupManager');
            }
        }

        let attempts = 0;
        const checkReady = () => {
            attempts++;
            if (window.popupManager && window.popupManager.isInitialized) {
                console.log('✅ PopupManager ready');
                resolve();
            } else if (attempts < 10) {
                setTimeout(checkReady, 300);
            } else {
                console.error('❌ PopupManager failed to initialize');
                resolve();
            }
        };
        
        checkReady();
    });
}

// ✅ Fallback order entry
function createFallbackOrderEntry(orderDetails) {
    const basicForm = `
        <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:20px;border:2px solid #3498db;border-radius:8px;z-index:10000;">
            <h3>Place Order</h3>
            <p><strong>Symbol:</strong> ${orderDetails.symbol}</p>
            <p><strong>Action:</strong> ${orderDetails.action}</p>
            <p><strong>Price:</strong> ${orderDetails.price}</p>
            <button onclick="this.parentElement.remove(); dashboard.placeConfirmedOrder(${JSON.stringify(orderDetails).replace(/"/g, '&quot;')})">Confirm Order</button>
            <button onclick="this.parentElement.remove()">Cancel</button>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', basicForm);
}

// ✅ Auto-initialize PopupManager
document.addEventListener('DOMContentLoaded', function() {
    console.log('🔄 DOM loaded, initializing PopupManager...');
    if (!window.popupManager) {
        window.popupManager = new PopupManager();
    }
    if (!window.popupManager.isInitialized) {
        window.popupManager.init();
    }
});
// ✅ Settings Window Functions
function showSettingsWindow() {
    ensurePopupManagerReady().then(() => {
        window.popupManager.showWindow('settingsWindow');
    });
}