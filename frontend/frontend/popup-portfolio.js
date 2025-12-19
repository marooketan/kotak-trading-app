PopupManager.prototype.setupPortfolioWindow = function () {
    const windowElement = document.getElementById('portfolioWindow');
    if (!windowElement) return;
    // Initialize sort state if not exists
    if (!this.currentSort) {
        this.currentSort = { column: null, direction: 'none' };
    }
    
    this.makeDraggable(windowElement);
    this.makeResizable(windowElement);

    windowElement.querySelector('.close-btn').addEventListener('click', () => {
        this.hideWindow('portfolioWindow');
    });

    windowElement.querySelector('.minimize-btn').addEventListener('click', () => {
        this.toggleMinimize(windowElement);
    });

    const refreshBtn = windowElement.querySelector('#portfolioRefreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshPortfolio());
    
    const squareOffBtn = windowElement.querySelector('#squareOffCheckedBtn');
    if (squareOffBtn) squareOffBtn.addEventListener('click', () => this.squareOffSelected());

    const selectAllCheckbox = windowElement.querySelector('#selectAllPositions');
    if (selectAllCheckbox) selectAllCheckbox.addEventListener('change', (e) => this.toggleSelectAllPositions(e.target.checked));
    
    const dayFilter = windowElement.querySelector('#dayWiseFilter');
    if (dayFilter) {
        dayFilter.addEventListener('change', () => this.refreshPortfolio());
    }
    document.querySelectorAll('.portfolio-table .sortable').forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.column;
            const currentSort = header.dataset.sort || 'none';
            
            let newSort = 'asc';
            if (currentSort === 'asc') newSort = 'desc';
            else if (currentSort === 'desc') newSort = 'none';
            else newSort = 'asc';
            
            document.querySelectorAll('.portfolio-table .sortable').forEach(h => {
                h.dataset.sort = 'none';
            });
            
            if (newSort !== 'none') {
                header.dataset.sort = newSort;
            }
            
            this.currentSort = { column, direction: newSort };
            this.refreshPortfolio();
        });
    });
    
    const exactQtyInput = document.getElementById('exactQtyInput');
    const squareOffExactBtn = document.getElementById('squareOffExactBtn');
    
    if (exactQtyInput) {
        exactQtyInput.addEventListener('input', () => this.checkBulkSquareOffStatus());
    }
    
    if (squareOffExactBtn) {
        squareOffExactBtn.addEventListener('click', () => {
            this.squareOffExactQty();
        });
    }
    
    this.windows.set('portfolioWindow', windowElement);
    this.makeColumnsResizable();
    this.makeColumnsDraggable();
};
PopupManager.prototype.refreshPortfolio = async function () {
    // 1. VISUAL FEEDBACK: Clear table & Show Loading
    const tbody = document.getElementById('portfolioTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#34495e; font-weight:bold;">⏳ Refreshing Positions...</td></tr>';
    }

    // 2. FETCH NEW DATA
    this.isPortfolioFetching = true;
    this.lastPortfolioFetchTime = Date.now();

    try {
        // 🔥 NEW: Add timeout to fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const response = await fetch('/api/portfolio', {
            signal: controller.signal  // Connect timeout to fetch
        });
        
        clearTimeout(timeoutId); // Cancel timeout if successful
        
        const result = await response.json();
        
        // 🔥 NEW: Reset retry counter on success
        this.portfolioRetryCount = 0;
        
        if (result.success) {
            this.renderPortfolioTable(result.positions);
        } else {
            this.renderPortfolioTable(null, result.message || 'Failed to load portfolio');
        }
    } catch (error) {
        console.error('Portfolio refresh error:', error);
        
        // 🔥 NEW STEP 3: Auto-retry logic
        if (this.portfolioRetryCount < 2) { // Try max 2 times
            this.portfolioRetryCount++;
            console.log(`🔄 Portfolio retry attempt ${this.portfolioRetryCount}/2`);
            
            // Show retry message
            this.renderPortfolioTable(null, `📡 Connection issue... Retrying (${this.portfolioRetryCount}/2)`);
            
            // Wait 2 seconds then retry
            setTimeout(() => {
                this.refreshPortfolio();
            }, 2000);
        } else {
            // Max retries reached - show final error
            this.portfolioRetryCount = 0; // Reset for next time
            
            if (error.name === 'AbortError') {
                this.renderPortfolioTable(null, '⏱️ Server timeout after 3 attempts. Please check connection.');
            } else {
                this.renderPortfolioTable(null, '🌐 Network error after 3 attempts. Click "Refresh" to try again.');
            }
        }
    } finally {
        this.isPortfolioFetching = false;
    }
};
// === PORTFOLIO LOGIC ===
PopupManager.prototype.refreshPortfolioLTPOnly = async function () {
    if (this.isPortfolioFetching) return;
    this.isPortfolioFetching = true;
    this.lastPortfolioFetchTime = Date.now();

    try {
        const tbody = document.getElementById('portfolioTableBody');
        if (!tbody) return;
        
        const rows = tbody.querySelectorAll('tr[data-symbol]');
        if (rows.length === 0) return;
        
        const symbols = [];
        rows.forEach(row => {
            const symbol = row.dataset.symbol;
            if (symbol) symbols.push(symbol);
        });
        
        if (symbols.length > 0) {
            const response = await fetch(`/api/portfolio-ltp?symbols=${symbols.join(',')}`);
            const result = await response.json();
            if (result.success && result.ltp_data) {
                this.updatePortfolioLTP(result.ltp_data);
            }
        }
    } catch (error) {
    } finally {
        this.isPortfolioFetching = false;
    }
};
PopupManager.prototype.updatePortfolioLTP = function (ltpData) {
    const tbody = document.getElementById('portfolioTableBody');
    if (!tbody) return;
    
    let totalMtmPnl = 0;
    const groupPnls = {}; 

    const rows = tbody.querySelectorAll('tr[data-symbol]');
    
    rows.forEach(row => {
        const qtyCell = row.querySelector('td:nth-child(4)');
        const qty = parseInt(qtyCell?.textContent) || 0;
        if (qty === 0) return; // Skip closed positions
        const symbol = row.dataset.symbol;
        const groupName = row.dataset.group;
        const quote = ltpData[symbol]; // This is now an object {ltp, bid, ask}
        const newLTP = quote ? quote.ltp : 0;
        
        if (groupName && groupPnls[groupName] === undefined) groupPnls[groupName] = 0;
        let rowPnl = 0;
        const pnlCell = row.querySelector('td:nth-child(7)');

        if (newLTP && newLTP > 0) {
            const ltpCell = row.querySelector('td:nth-child(6)');
            const avgPriceCell = row.querySelector('td:nth-child(5)');
            const qtyCell = row.querySelector('td:nth-child(4)');
            
            if (ltpCell && avgPriceCell && qtyCell && pnlCell) {
                const avgPrice = parseFloat(avgPriceCell.textContent) || 0;
                const qty = parseInt(qtyCell.textContent) || 0;
                const oldLTP = parseFloat(ltpCell.textContent) || 0;
                
                ltpCell.textContent = newLTP.toFixed(2);
                if (newLTP !== oldLTP) {
                    ltpCell.style.color = newLTP > oldLTP ? '#27ae60' : '#e74c3c';
                    setTimeout(() => ltpCell.style.color = '', 500);
                }
                
                if (qty > 0) rowPnl = (newLTP - avgPrice) * qty;
                else if (qty < 0) rowPnl = (avgPrice - newLTP) * Math.abs(qty);
                
                pnlCell.textContent = rowPnl.toFixed(2);
                pnlCell.style.color = rowPnl >= 0 ? '#27ae60' : '#e74c3c';
            }
        } else {
            if (pnlCell) rowPnl = parseFloat(pnlCell.textContent) || 0;
        }

        totalMtmPnl += rowPnl;

        if (groupName && row.style.display !== 'none') {
            groupPnls[groupName] += rowPnl;
        }
    });

    const realizedEl = document.getElementById('portfolioRealizedPnl');
    let currentRealized = 0;
    if(realizedEl) currentRealized = parseFloat(realizedEl.textContent.replace('+','')) || 0;
    this.updateSummaryDisplay(totalMtmPnl + currentRealized, totalMtmPnl, currentRealized);

    Object.keys(groupPnls).forEach(groupName => {
        const headerRow = tbody.querySelector(`.group-header[data-group-name="${groupName}"]`);
        if (headerRow) {
            const valSpan = headerRow.querySelector('.group-pnl-val');
            if (valSpan) {
                valSpan.textContent = groupPnls[groupName].toFixed(2);
                valSpan.style.color = groupPnls[groupName] >= 0 ? '#27ae60' : '#e74c3c';
            }
        }
    });
};

// ---------- moved from popup-script.js ----------
PopupManager.prototype.renderPortfolioTable = function (positions, errorMessage = null) {
    const tbody = document.getElementById('portfolioTableBody');
    const squareOffBtn = document.getElementById('squareOffCheckedBtn');
    const safeFloat = (value) => parseFloat(value) || 0;

    const dayFilter = document.getElementById('dayWiseFilter');
    const showDayOnly = dayFilter ? dayFilter.checked : false;

    let globalTotalPnl = 0;
    let globalMtmPnl = 0;
    let globalRealizedPnl = 0;

    if (!tbody) return;

    if (errorMessage) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: #e74c3c;">${errorMessage}</td></tr>`;
        if (squareOffBtn) squareOffBtn.disabled = true;
        this.updateSummaryDisplay(0, 0, 0);
        return;
    }
    if (!positions || positions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: #7f8c8d;">No open F&O positions.</td></tr>`;
        if (squareOffBtn) squareOffBtn.disabled = true;
        this.updateSummaryDisplay(0, 0, 0);
        return;
    }

    // Helper to parse expiry info (CORRECTED VERSION FROM OLD FILE)
    const parseExpiry = (symbol) => {
        try {
            const weeklyMatch = symbol.match(/[A-Z](\d{2})([1-9OND])(\d{2})\d+/);
            if (weeklyMatch) {
                const y = parseInt(weeklyMatch[1]);
                const mChar = weeklyMatch[2];
                const d = weeklyMatch[3];
                const m_map = {'1':'JAN','2':'FEB','3':'MAR','4':'APR','5':'MAY','6':'JUN','7':'JUL','8':'AUG','9':'SEP','O':'OCT','N':'NOV','D':'DEC'};
                const monthStr = m_map[mChar] || 'UNK';
                return { label: `${d}-${monthStr}-20${y}`, value: (y * 10000) + (Object.keys(m_map).indexOf(mChar) * 100) + parseInt(d) };
            }
            const monthlyMatch = symbol.match(/[A-Z](\d{2})([A-Z]{3})\d+/);
            if (monthlyMatch) {
                const y = parseInt(monthlyMatch[1]);
                const mStr = monthlyMatch[2];
                const months = { 'JAN':1, 'FEB':2, 'MAR':3, 'APR':4, 'MAY':5, 'JUN':6, 'JUL':7, 'AUG':8, 'SEP':9, 'OCT':10, 'NOV':11, 'DEC':12 };
                const mNum = months[mStr] || 99;
                return { label: `Ex-${mStr}-20${y}`, value: (y * 10000) + (mNum * 100) + 99 };
            }
            return { label: 'OTHERS', value: 999999 };
        } catch (error) {
            console.error('❌ parseExpiry failed for symbol:', symbol, error);
            return { label: 'UNKNOWN', value: 999999 };
        }
    };

    // Group positions by instrument group (CORRECTED VERSION FROM OLD FILE)
    const groups = {}; 
    
    positions.forEach(pos => {
        // FIX 3: Check for today's trades filter
        if (showDayOnly && !pos.traded_today) return; 

        // FIX 1: Extract group name from symbol (NOT from API)
        let groupName = 'STOCKS';
        if (pos.symbol.startsWith('NIFTY')) groupName = 'NIFTY';
        else if (pos.symbol.startsWith('BANKNIFTY')) groupName = 'BANKNIFTY';
        else if (pos.symbol.startsWith('FINNIFTY')) groupName = 'FINNIFTY';
        else if (pos.symbol.startsWith('MIDCPNIFTY')) groupName = 'MIDCPNIFTY';
        
        if (!groups[groupName]) groups[groupName] = [];
        
        // FIX 2: Use the corrected parseExpiry function
        pos.expiryInfo = parseExpiry(pos.symbol);
        groups[groupName].push(pos);
        
        // Aggregate totals
        if (pos.net_quantity === 0) {
            // Closed position: treat as realized
            globalRealizedPnl += safeFloat(pos.pnl_realized) || (safeFloat(pos.sell_value) - safeFloat(pos.buy_value));
            globalTotalPnl += safeFloat(pos.pnl_total) || (safeFloat(pos.sell_value) - safeFloat(pos.buy_value));
        } else {
            // Open position
            globalMtmPnl += safeFloat(pos.pnl_unrealized);
            globalRealizedPnl += safeFloat(pos.pnl_realized);
            globalTotalPnl += safeFloat(pos.pnl_total);
        }
    });

    let html = '';
    const sortedKeys = Object.keys(groups).sort();

    if (sortedKeys.length === 0 && showDayOnly) {
        html = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: #7f8c8d;">No active trades found for today.</td></tr>`;
    }

    sortedKeys.forEach(groupName => {
        const groupPositions = groups[groupName];

        // Apply sorting if active (CORRECTED VERSION FROM OLD FILE)
        if (this.currentSort && this.currentSort.direction !== 'none') {
            groupPositions.sort((a, b) => {
                let valA, valB;
                
                switch(this.currentSort.column) {
                    case 'netQty':
                        valA = a.net_quantity;
                        valB = b.net_quantity;
                        break;
                    case 'ltp':
                        valA = safeFloat(a.ltp);
                        valB = safeFloat(b.ltp);
                        break;
                    case 'pnl':
                        // For P&L, need to calculate display value
                        if (a.net_quantity === 0) {
                            valA = safeFloat(a.sell_value) - safeFloat(a.buy_value);
                        } else {
                            valA = safeFloat(a.pnl_unrealized);
                        }
                        if (b.net_quantity === 0) {
                            valB = safeFloat(b.sell_value) - safeFloat(b.buy_value);
                        } else {
                            valB = safeFloat(b.pnl_unrealized);
                        }
                        break;
                    default:
                        return 0;
                }
                
                // Handle null/undefined
                valA = valA || 0;
                valB = valB || 0;
                
                // Apply sort direction
                if (this.currentSort.direction === 'asc') {
                    return valA - valB;
                } else {
                    return valB - valA;
                }
            });
        } else {
            // Default: sort by expiry
            groupPositions.sort((a, b) => a.expiryInfo.value - b.expiryInfo.value);
        }

        // Build expiry dropdown (unique expiry labels)
        const uniqueExpiries = [...new Set(groupPositions.map(p => p.expiryInfo.label))];
        let optionsHtml = `<option value="ALL">All Expiries (Total)</option>`;
        uniqueExpiries.forEach(exp => {
            optionsHtml += `<option value="${exp}">${exp}</option>`;
        });

        // Group P&L calculation
        let groupPnl = groupPositions.reduce((sum, p) => {
            if (p.net_quantity === 0) {
                return sum + (safeFloat(p.sell_value) - safeFloat(p.buy_value));
            } else {
                return sum + safeFloat(p.pnl_unrealized);
            }
        }, 0);
        const pnlColor = groupPnl >= 0 ? '#27ae60' : '#e74c3c';

        html += `
            <tr class="group-header" data-group-name="${groupName}">
                <td colspan="8" style="vertical-align: middle;">
                    <span style="font-size:13px; margin-right: 10px;">▼ ${groupName}</span>
                    <select class="form-select" style="width: auto; padding: 2px 5px; font-size: 11px; height: 24px; border: 1px solid #bdc3c7; cursor:pointer;"
                            onchange="window.popupManager.filterGroup('${groupName}', this.value)">
                        ${optionsHtml}
                    </select>
                    <span class="group-pnl-display">
                        Group P&L: <span class="group-pnl-val" style="color:${pnlColor}">${groupPnl.toFixed(2)}</span>
                    </span>
                </td>
            </tr>
        `;

        groupPositions.forEach(pos => {
            const pnlUnrealized = safeFloat(pos.pnl_unrealized);
            const ltp = safeFloat(pos.ltp);
            const netQty = pos.net_quantity;
            const isClosed = netQty === 0;
            const isLong = netQty > 0;

            // For closed positions: P&L = sell_value - buy_value; else unrealized
            let displayPnl = isClosed ? (safeFloat(pos.sell_value) - safeFloat(pos.buy_value)) : pnlUnrealized;
            const rowPnlColor = displayPnl >= 0 ? '#27ae60' : '#e74c3c';

            const avgPrice = safeFloat(
                pos.avg_price || 
                (pos.net_quantity > 0 ? pos.buy_avg : pos.sell_avg) || 
                pos.buy_avg || 
                pos.sell_avg || 
                pos.buy_price || 
                pos.buy_value || 
                0
            );

            html += `
                <tr data-unique-id="${pos.unique_id || ''}" 
                    data-symbol="${pos.symbol}" 
                    data-group="${groupName}"
                    data-expiry-label="${pos.expiryInfo.label || ''}"
                    ${isClosed ? 'style="opacity: 0.7; background-color: #f8f9fa;"' : ''}>
                   <td>${isClosed ? '' : '<input type="checkbox" class="position-checkbox" data-qty="' + netQty + '" data-symbol="' + (pos.symbol || '') + '">'}</td>

                    <td><strong>${pos.symbol || ''}</strong> ${isClosed ? '<span style="color:#95a5a6; font-size:10px; margin-left:5px;">[CLOSED]</span>' : ''}</td>
                    <td style="color: ${isLong ? '#27ae60' : '#e74c3c'}; font-weight: bold;">${pos.position_type || ''}</td>
                    <td>${netQty}</td>
                    <td>${avgPrice.toFixed ? avgPrice.toFixed(2) : Number(avgPrice).toFixed(2)}</td>
                    <td>${(ltp && ltp.toFixed) ? ltp.toFixed(2) : Number(ltp || 0).toFixed(2)}</td>
                    <td style="color: ${rowPnlColor}; font-weight: bold;">${Number(displayPnl).toFixed(2)}</td>
                    <td>
                        ${isClosed ? 
                            '<span style="color:#95a5a6; font-size:11px;">Closed</span>' : 
                            `<button class="btn-cancel" onclick="window.popupManager.singleSquareOff('${pos.symbol}', ${netQty})">Exit</button>`
                        }
                    </td>
                </tr>
            `;
        });
    });

    tbody.innerHTML = html;
    this.updateSummaryDisplay(globalTotalPnl, globalMtmPnl, globalRealizedPnl);

    // Re-attach checkbox listeners
    tbody.querySelectorAll('.position-checkbox').forEach(cb => {
        cb.addEventListener('change', () => this.checkBulkSquareOffStatus());
    });
    this.checkBulkSquareOffStatus();
};

// Filter shown rows by expiry under a group
PopupManager.prototype.filterGroup = function (groupName, expiryLabel) {
    const tbody = document.getElementById('portfolioTableBody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll(`tr[data-group="${groupName}"]`);
    let filteredPnl = 0;

    rows.forEach(row => {
        const rowExpiry = row.dataset.expiryLabel;
        const isVisible = (expiryLabel === 'ALL' || rowExpiry === expiryLabel);
        row.style.display = isVisible ? 'table-row' : 'none';

        if (isVisible) {
            const pnlCell = row.querySelector('td:nth-child(7)');
            if (pnlCell) {
                filteredPnl += parseFloat(pnlCell.textContent) || 0;
            }
        }
    });

    const headerRow = tbody.querySelector(`.group-header[data-group-name="${groupName}"]`);
    if (headerRow) {
        const valSpan = headerRow.querySelector('.group-pnl-val');
        if (valSpan) {
            valSpan.textContent = filteredPnl.toFixed(2);
            valSpan.style.color = filteredPnl >= 0 ? '#27ae60' : '#e74c3c';
        }
    }
};
// ---------- end moved block ----------
// ---------- moved from popup-script.js ----------
PopupManager.prototype.updateSummaryDisplay = function (totalPnl, totalMtmPnl, totalRealizedPnl) {
    const formatPnl = (pnl) => {
        const color = pnl >= 0 ? '#27ae60' : '#e74c3c';
        const sign = pnl >= 0 ? '+' : '';
        return `<span style="color: ${color};">${sign}${pnl.toFixed(2)}</span>`;
    };
    document.getElementById('portfolioTotalPnl').innerHTML = formatPnl(totalPnl);
    document.getElementById('portfolioMtmPnl').innerHTML = formatPnl(totalMtmPnl);
    document.getElementById('portfolioRealizedPnl').innerHTML = formatPnl(totalRealizedPnl);
};

PopupManager.prototype.checkBulkSquareOffStatus = function () {
    const checkedCount = document.querySelectorAll('#portfolioTableBody .position-checkbox:checked').length;
    
    
    const squareOffBtn = document.getElementById('squareOffCheckedBtn');
    squareOffBtn.disabled = checkedCount === 0;
    squareOffBtn.textContent = `❌ Square Off Checked (${checkedCount})`;
    
    // NEW: Also update exact quantity button
    const squareOffExactBtn = document.getElementById('squareOffExactBtn');
    const exactQtyInput = document.getElementById('exactQtyInput');
    
    if (squareOffExactBtn && exactQtyInput) {
        const qtyValue = parseInt(exactQtyInput.value);
        const hasValidQty = !isNaN(qtyValue) && qtyValue > 0;
        
        
        
        squareOffExactBtn.disabled = !(checkedCount > 0 && hasValidQty);
        squareOffExactBtn.textContent = `🎯 Square Off Exact (${checkedCount})`;
        
        
    }
};

PopupManager.prototype.singleSquareOff = async function (symbol, netQuantity) {
    console.log("DEBUG: singleSquareOff called with:", symbol, netQuantity);
    const segment = symbol.includes('SENSEX') || symbol.includes('BANKEX') ? 'BFO' : 'NFO';
    console.log("DEBUG: Calculated segment:", segment, "for symbol:", symbol);
    
    if (!confirm(`Are you sure you want to close ${Math.abs(netQuantity)} units of ${symbol}?`)) return;

    const action = netQuantity > 0 ? 'S' : 'B';
    const quantity = Math.abs(netQuantity);

    try {
        const segment = symbol.includes('SENSEX') || symbol.includes('BANKEX') ? 'BFO' : 'NFO';

        const orderDetails = {
            symbol: symbol,
            transaction_type: action, 
            quantity: quantity,
            product_code: 'NRML',
            price: '0',
            order_type: 'MKT',
            validity: 'DAY',
            am_flag: 'NO',
            segment: segment  // Add this line
        };
        const response = await fetch('/api/place-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderDetails)
        });
        const result = await response.json();
        if (result.success) {
            alert(`✅ Exit Order Placed for ${symbol}. Order No: ${result.order_number}`);
            this.refreshPortfolio();
        } else {
            alert(`❌ Failed to place exit order: ${result.message}`);
        }
    } catch (error) {
        alert('❌ Network error during Square Off.');
    }
};

PopupManager.prototype.squareOffSelected = async function () {
    const checkedBoxes = document.querySelectorAll('#portfolioTableBody .position-checkbox:checked');
    if (checkedBoxes.length === 0) return;

    if (!confirm(`Confirm placing market orders to Square Off all ${checkedBoxes.length} selected positions?`)) return;

    let successCount = 0;
    let failedCount = 0;
    
    for (const checkbox of checkedBoxes) {
        const symbol = checkbox.dataset.symbol;
        const netQuantity = parseInt(checkbox.dataset.qty);
        const action = netQuantity > 0 ? 'S' : 'B';
        const quantity = Math.abs(netQuantity);

        const orderDetails = {
            symbol: symbol,
            transaction_type: action,
            quantity: quantity,
            product_code: 'NRML',
            price: '0',
            order_type: 'MKT',
            validity: 'DAY',
            am_flag: 'NO',
            segment: symbol.includes('SENSEX') || symbol.includes('BANKEX') ? 'BFO' : 'NFO'
        };

        try {
            const response = await fetch('/api/place-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderDetails)
            });
            const result = await response.json();
            if (result.success) successCount++;
            else failedCount++;
        } catch (error) {
            failedCount++;
        }
    }
    alert(`✅ Bulk Square Off Complete! Successful: ${successCount}. Failed: ${failedCount}.`);
    this.refreshPortfolio();
};

PopupManager.prototype.squareOffExactQty = async function () {
    const checkedBoxes = document.querySelectorAll('#portfolioTableBody .position-checkbox:checked');
    const exactQtyInput = document.getElementById('exactQtyInput');
    
    
    
    // ... rest of function
    
    if (checkedBoxes.length === 0 || !exactQtyInput) return;
    
    const exactQty = parseInt(exactQtyInput.value) || 0;
    if (exactQty <= 0) {
        alert('❌ Please enter a valid quantity greater than 0');
        return;
    }
    
    if (!confirm(`Confirm placing market orders to Square Off ${exactQty} quantity from ${checkedBoxes.length} selected positions?`)) return;

    let successCount = 0;
    let failedCount = 0;
    
    for (const checkbox of checkedBoxes) {
        const symbol = checkbox.dataset.symbol;
        const netQuantity = parseInt(checkbox.dataset.qty);
        
        // Determine action based on position type
        const action = netQuantity > 0 ? 'S' : 'B';
        
        // Use the exact quantity entered by user
        const quantity = Math.abs(exactQty);
        
        // For short positions, we need to buy back
        // For long positions, we need to sell
        const orderDetails = {
            symbol: symbol,
            transaction_type: action,
            quantity: quantity,
            product_code: 'NRML',
            price: '0',
            order_type: 'MKT',
            validity: 'DAY',
            am_flag: 'NO',
            segment: symbol.includes('SENSEX') || symbol.includes('BANKEX') ? 'BFO' : 'NFO'
        };              

        try {
            const response = await fetch('/api/place-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderDetails)
            });
            const result = await response.json();
            if (result.success) successCount++;
            else failedCount++;
        } catch (error) {
            failedCount++;
        }
    }
    
    alert(`✅ Exact Quantity Square Off Complete! Successful: ${successCount}. Failed: ${failedCount}.`);
    this.refreshPortfolio();
};
PopupManager.prototype.toggleSelectAllPositions = function (checked) {
    const checkboxes = document.querySelectorAll('#portfolioTableBody .position-checkbox');
    checkboxes.forEach(cb => cb.checked = checked);
    this.checkBulkSquareOffStatus();
};
// ---------- end moved block ----------