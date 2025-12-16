class OptionChainManager {
constructor(dashboard, activityManager) {

    this.dashboard = dashboard;
    this.activityManager = activityManager;
}
    loadExpiries() {
        return this.dashboard.loadExpiries();
    }

    getStrikeInterval(index) {
        if (index.includes('BANKNIFTY') || index.includes('MIDCPNIFTY')) return 100;
        return 50;
    }

    scheduleNextUpdate() {
        // dashboard controls timing for now
    }

    heartbeatTick() {
        if (document.hidden) return;
          this.loadOptionChain();
    }

    async loadOptionChain() {

    // 1. RACE CONDITION HANDLING
if (this.isFetching) {
    if (this.fetchController) {
        this.fetchController.abort();
    }
}

// 2. SETUP NEW REQUEST
this.fetchController = new AbortController();
this.isFetching = true;
this.lastFetchTime = Date.now();
this.requestCounter = (this.requestCounter || 0) + 1;
const currentTicket = this.requestCounter;


    

   
    
    // 3. GET VALUES
    const market = document.getElementById('marketType')?.value || 'NFO';
    const index = document.getElementById('indexSelect')?.value || 'NIFTY';
    const expiry = document.getElementById('expirySelect')?.value;
    const strikes = document.getElementById('strikeCount')?.value || '10';

    if (!expiry || expiry === 'Loading...') {
        this.isFetching = false;
        return;
    }

    // === 3.5 FIX: SILENT LOADING ===
    const optionTable = document.getElementById('optionTable');
    const loadingDiv = document.getElementById('loading');
    
    if (!optionTable || optionTable.style.display === 'none') {
        if (loadingDiv) loadingDiv.style.display = 'block';
    }

    try {
        // 4. FETCH with timeout
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), 5000); // 5 second timeout
        
        // Combine abort signals: user cancellation OR timeout
        const combinedAbortController = new AbortController();
        
        // Listen to both abort signals
        if (!this.fetchController) {
    this.fetchController = new AbortController();
}

this.fetchController.signal.addEventListener('abort', () => {
    combinedAbortController.abort();
});


        timeoutController.signal.addEventListener('abort', () => {
            combinedAbortController.abort();
        });
        
        

        
        const recenterFlag = this.activityManager.isUserIdle() ? "true" : "false";

        const response = await fetch(
            `/api/option-chain?index=${index}&expiry=${expiry}&strikes=${strikes}&segment=${market}&recenter=${recenterFlag}`,
            { signal: combinedAbortController.signal }
        );
        
        clearTimeout(timeoutId); // Cancel timeout if successful
        const data = await response.json();

        // 🔥 FIX: Reset retry counter on SUCCESS only
        this.optionChainRetryCount = 0;

        // 5. CHECK TICKET
        if (this.requestCounter !== currentTicket) return;

        if (data.success) {
            this.displayOptionChain(data.data, data.spot, index);


            
            // Hide loading only after success
            if (loadingDiv) loadingDiv.style.display = 'none';
            if (optionTable) optionTable.style.display = 'table';
        } else {
            console.error("Option Chain Error:", data.message);
            if (loadingDiv) {
                loadingDiv.textContent = data.message;
                loadingDiv.style.display = 'block';
            }
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Fetch error:', error);
            
            // 🔥 FIX: Auto-retry logic (counter persists between retries)
            if (this.optionChainRetryCount < 2) { // Try max 2 times
                this.optionChainRetryCount++;
                console.log(`🔄 Option Chain retry attempt ${this.optionChainRetryCount}/2`);
                
                // Show retry message (only if table is not visible)
                if (!optionTable || optionTable.style.display === 'none') {
                    if (loadingDiv) {
                        loadingDiv.innerHTML = `
                            <div class="loading-spinner">
                                📡 Loading Option Chain... Retrying (${this.optionChainRetryCount}/2)
                            </div>
                        `;
                        loadingDiv.style.display = 'block';
                    }
                }
                
                // Wait 2 seconds then retry
                setTimeout(() => {
                    this.loadOptionChain();
                }, 2000);
            } else {
                // Max retries reached - show final error
                this.optionChainRetryCount = 0; // Reset for next time
                
                // Only show error if table is not visible
                if (!optionTable || optionTable.style.display === 'none') {
                    if (loadingDiv) {
                        if (error.name === 'AbortError') {
                            loadingDiv.innerHTML = `
                                <div class="loading-error">
                                    ⏱️ Server timeout after 3 attempts. Click "Refresh" to try again.
                                </div>
                            `;
                        } else {
                            loadingDiv.innerHTML = `
                                <div class="loading-error">
                                    🌐 Network error after 3 attempts. Click "Refresh" to try again.
                                </div>
                            `;
                        }
                        loadingDiv.style.display = 'block';
                    }
                }
            }
        }
    } finally {
        if (this.requestCounter === currentTicket) {
            this.isFetching = false;
            this.scheduleNextUpdate();


        }
    }
}


 displayOptionChain(data, spotPrice, index) {
        const tbody = document.getElementById('optionData');
        const loading = document.getElementById('loading');
        const optionTable = document.getElementById('optionTable');

        if (loading) loading.style.display = 'none';
        if (optionTable) optionTable.style.display = data.length ? '' : 'none';

        if (!tbody || data.length === 0) return;

        const fmt = (n) => parseFloat(n).toFixed(2);

        const updateCell = (id, newVal) => {
            const el = document.getElementById(id);
            if (el) {
                const newText = fmt(newVal);
                const currentText = el.innerText;
                
                if (newText === currentText) return; 

                const oldVal = parseFloat(currentText.replace(/,/g, '')) || 0;
                const val = parseFloat(newVal);
                
                el.innerText = newText;

                if (val !== oldVal) {
                    el.style.color = val > oldVal ? '#27ae60' : '#c0392b';
                    setTimeout(() => { el.style.color = ''; }, 500);
                }
            }
        };

        const existingRows = tbody.querySelectorAll('tr');
        const needRebuild = existingRows.length === 0 || 
                            existingRows.length !== data.length ||
                            existingRows[0].id !== `row-${data[0].strike}`;

        const strikeInterval = this.getStrikeInterval(index);


        const atmStrike = Math.round(spotPrice / strikeInterval) * strikeInterval;
        // Save data globally for basket LTP
window.optionChainData = data.map(row => ({
    symbol: row.call.pTrdSymbol || row.put.pTrdSymbol,
    strike: row.strike,
    optionType: 'CE',
    ltp: row.call.ltp,
    change: row.call.change || 0
})).concat(data.map(row => ({
    symbol: row.call.pTrdSymbol || row.put.pTrdSymbol,
    strike: row.strike,
    optionType: 'PE',
    ltp: row.put.ltp,
    change: row.put.change || 0
})));
       // Trigger LTP update for basket
if (typeof updateBasketLTP === 'function') {
    setTimeout(updateBasketLTP, 50);
} 

        if (needRebuild) {
            tbody.innerHTML = data.map(row => {
                const isATM = row.strike === atmStrike;
                const atmStyle = isATM ? 'background-color: #fff9c4;' : '';
                const ceSymbol = row.call.pTrdSymbol || '';
                const peSymbol = row.put.pTrdSymbol || '';

                return `
                <tr id="row-${row.strike}" class="${row.strike < spotPrice ? 'itm' : 'otm'}" style="${atmStyle}">
                    <td>
                        <button class="buy-btn" onclick="dashboard.trackUserActivity(); dashboard.placeOrder('BUY', 'CE', ${row.strike}, 'ce-ask-${row.strike}', '${ceSymbol}')">B</button>
                        <button class="sell-btn" onclick="dashboard.trackUserActivity(); dashboard.placeOrder('SELL', 'CE', ${row.strike}, 'ce-bid-${row.strike}', '${ceSymbol}')">S</button>
                    </td>
                    <td id="ce-bid-${row.strike}">${fmt(row.call.bid)}</td>
                    <td id="ce-ask-${row.strike}">${fmt(row.call.ask)}</td>
                    <td id="ce-ltp-${row.strike}" class="price-cell" style="font-weight:bold;">${fmt(row.call.ltp)}</td>
                    <td id="strike-cell-${row.strike}"><strong>${row.strike}</strong>${isATM ? ' <span style="color:#ffb300;font-weight:bold;">ATM</span>' : ''}</td>
                    <td id="pe-ltp-${row.strike}" class="price-cell" style="font-weight:bold;">${fmt(row.put.ltp)}</td>
                    <td id="pe-bid-${row.strike}">${fmt(row.put.bid)}</td>
                    <td id="pe-ask-${row.strike}">${fmt(row.put.ask)}</td>
                    <td>
                        <button class="buy-btn" onclick="dashboard.trackUserActivity(); dashboard.placeOrder('BUY', 'PE', ${row.strike}, 'pe-ask-${row.strike}', '${peSymbol}')">B</button>
                        <button class="sell-btn" onclick="dashboard.trackUserActivity(); dashboard.placeOrder('SELL', 'PE', ${row.strike}, 'pe-bid-${row.strike}', '${peSymbol}')">S</button>
                    </td>
                </tr>`;
            }).join('');

        } else {
            data.forEach(row => {
                updateCell(`ce-bid-${row.strike}`, row.call.bid);
                updateCell(`ce-ask-${row.strike}`, row.call.ask);
                updateCell(`ce-ltp-${row.strike}`, row.call.ltp);
                updateCell(`pe-bid-${row.strike}`, row.put.bid);
                updateCell(`pe-ask-${row.strike}`, row.put.ask);
                updateCell(`pe-ltp-${row.strike}`, row.put.ltp);

                const tr = document.getElementById(`row-${row.strike}`);
                if (tr) {
                    const isATM = row.strike === atmStrike;
                    if (isATM) tr.style.backgroundColor = '#fff9c4';
                    else tr.style.backgroundColor = '';

                    tr.className = row.strike < spotPrice ? 'itm' : 'otm';

                    const strikeCell = document.getElementById(`strike-cell-${row.strike}`);
                    if (strikeCell) {
                        const hasATM = strikeCell.innerHTML.includes('ATM');
                        if (isATM && !hasATM) strikeCell.innerHTML = `<strong>${row.strike}</strong> <span style="color:#ffb300;font-weight:bold;">ATM</span>`;
                        else if (!isATM && hasATM) strikeCell.innerHTML = `<strong>${row.strike}</strong>`;
                    }
                }
            });
        }
    }
     showOptionChainLoading(show, isError = false) {
        const loading = document.getElementById('loading');
        const optionTable = document.getElementById('optionTable');
        const tbody = document.getElementById('optionData');

        if (loading) {
            if (show) {
                loading.style.display = 'block';
                loading.innerHTML = '<div class="loading-spinner">⏳ Loading Option Chain...</div>';
            } else if (isError) {
                loading.style.display = 'block';
                loading.innerHTML = '<div class="loading-error">❌ Failed to load data</div>';
            } else {
                loading.style.display = 'none';
            }
        }

        if (optionTable) optionTable.style.display = show ? 'none' : 'table';
        if (tbody && show) tbody.innerHTML = '';
    }
    async loadExpiries() {
        const indexSelect = document.getElementById('indexSelect');
        const expirySelect = document.getElementById('expirySelect');
        
        // 1. Get the current choice (NIFTY or BANKNIFTY)
        const selectedIndex = indexSelect.value; 

        // 2. Show "Loading..." to clear old dates immediately
        expirySelect.innerHTML = '<option>Loading...</option>';

        try {
            // 3. CRITICAL FIX: Ask backend for THIS specific index
           const marketTypeEl = document.getElementById('marketType');
           const segment = marketTypeEl ? marketTypeEl.value : 'NFO';

           const response = await fetch(
               `/api/expiries-v2?index=${encodeURIComponent(selectedIndex)}&segment=${encodeURIComponent(segment)}`

           );


            const data = await response.json();
           if (data.success && Array.isArray(data.expiries) && data.expiries.length > 0) {
        // Show a "Select Expiry" default option
        expirySelect.innerHTML = '<option value="">Select Expiry</option>';

        // Add ALL expiries (same as watchlist)
        data.expiries.forEach(exp => {
            const opt = document.createElement('option');
            opt.value = exp;
            opt.textContent = exp;
            expirySelect.appendChild(opt);
        });

        // Auto-select first real expiry
        if (expirySelect.options.length > 1) {
            expirySelect.selectedIndex = 1;
        }

        

    } else {
        expirySelect.innerHTML = '<option value="">No Dates Found</option>';
    }
 
  
        } catch (error) { 
            console.error('Failed to load expiries:', error);
            expirySelect.innerHTML = '<option>Error</option>';
        }
    }


}

window.OptionChainManager = OptionChainManager;
