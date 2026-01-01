
let lastKnownSpotPrice = 0;
let lastOCLogTime = 0;

const OC_LOG_INTERVAL = 5 * 60 * 1000;

window.showOIATP = false;


class OptionChainManager {
constructor(dashboard, activityManager) {
    this.dashboard = dashboard;
    this.activityManager = activityManager;
    this.hasInitialLoad = false;
    this.initialAtmStrike = null;  // ← CHANGE THIS
    this.lastStrikes = null;
}
    loadExpiries() {
        return this.dashboard.loadExpiries();
    }

    getStrikeInterval(index) {
        if (index.includes('BANKNIFTY') || index.includes('MIDCPNIFTY')) return 100;
         if (index.includes('SENSEX') || index.includes('BANKEX')) return 100;
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
        const t0 = performance.now();
        const now = Date.now();
        if (now - lastOCLogTime > OC_LOG_INTERVAL) {
            console.log('[OC] Start fetch');
        }

        // 1. RACE CONDITION HANDLING
        if (this.isFetching) {
            if (this.fetchController) {
                try {
                    this.fetchController.abort();
                    console.log("🔥 Aborted old request");
                } catch (e) {
                    // Ignore abort errors
                }
            }
            this.isFetching = false;
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

        if (!expiry) {
            console.log("⏳ Waiting for expiry...")
            setTimeout(() => this.loadOptionChain(), 100)
            return
        }

        // 3.5 SHOW LOADING IF HIDDEN
        const optionTable = document.getElementById('optionTable');
        const loadingDiv = document.getElementById('loading');

        if (!optionTable || optionTable.style.display === 'none') {
            if (loadingDiv) loadingDiv.style.display = 'block';
        }

        // ✅ NEW: SMART CHECK (Fixes the Spam!)
        // If the strike count changed since last time, tell the backend ONCE.
        if (this.lastStrikes !== strikes) {
            console.log(`🔄 Strikes changed from ${this.lastStrikes} to ${strikes}. Updating backend...`);
            this.lastStrikes = strikes; 
            await this.updateBackendSelection(); 
        }

        try {
            // 4. FETCH with timeout
            const timeoutController = new AbortController();
            const timeoutId = setTimeout(() => timeoutController.abort(), 5000); 

            const combinedAbortController = new AbortController();

            if (!this.fetchController) {
                this.fetchController = new AbortController();
            }

            this.fetchController.signal.addEventListener('abort', () => {
                combinedAbortController.abort();
            });

            timeoutController.signal.addEventListener('abort', () => {
                combinedAbortController.abort();
            });

            // ✅ READ ONLY (No more spamming POST here)
            const response = await fetch(
                `/api/memory-box/option-chain?index=${index}`,
                { signal: combinedAbortController.signal }
            );

            clearTimeout(timeoutId); 
            const data = await response.json();

            const t1 = performance.now();
            if (now - lastOCLogTime > OC_LOG_INTERVAL) {
                console.log('[OC] Fetch time:', (t1 - t0).toFixed(2), 'ms');
                lastOCLogTime = now;
            }

            // Reset retry counter on SUCCESS only
            this.optionChainRetryCount = 0;

            // 5. CHECK TICKET
            if (this.requestCounter !== currentTicket) return;

            if (data.success) {
                if (now - lastOCLogTime > OC_LOG_INTERVAL) {
                    console.log('[OC] Start render');
                }

                const chainData = data.chain || data.data || [];
                

                const spotPrice = data.spot || (data.index && data.index.price) || 0;

                this.displayOptionChain(chainData, spotPrice, index);

                if (loadingDiv) loadingDiv.style.display = 'none';

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

                if (this.optionChainRetryCount < 2) { 
                    this.optionChainRetryCount++;
                    console.log(`🔄 Option Chain retry attempt ${this.optionChainRetryCount}/2`);

                    if (!optionTable || optionTable.style.display === 'none') {
                        if (loadingDiv) {
                            loadingDiv.innerHTML = `<div class="loading-spinner">📡 Loading Option Chain... Retrying (${this.optionChainRetryCount}/2)</div>`;
                            loadingDiv.style.display = 'block';
                        }
                    }

                    setTimeout(() => {
                        this.loadOptionChain();
                    }, 2000);
                } else {
                    this.optionChainRetryCount = 0; 
                    if (!optionTable || optionTable.style.display === 'none') {
                        if (loadingDiv) {
                            loadingDiv.innerHTML = `<div class="loading-error">🌐 Network error after 3 attempts.</div>`;
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
        const tRenderStart = performance.now();

        const tbody = document.getElementById('optionData');
        const ceBidTh = document.querySelector('#optionTable th:nth-child(2)');
        const ceAskTh = document.querySelector('#optionTable th:nth-child(3)');
        const peBidTh = document.querySelector('#optionTable th:nth-child(7)');
        const peAskTh = document.querySelector('#optionTable th:nth-child(8)');

       const applyOIATPToggle = () => {
    const showOI = window.showOIATP === true;

    // ✅ HEADER CHANGE (ONLY ONCE)
    if (showOI) {
        if (ceBidTh) ceBidTh.textContent = 'Call ATP';
        if (ceAskTh) ceAskTh.textContent = 'Call OI';
        if (peBidTh) peBidTh.textContent = 'Put OI';
        if (peAskTh) peAskTh.textContent = 'Put ATP';
    } else {
        if (ceBidTh) ceBidTh.textContent = 'Call Bid';
        if (ceAskTh) ceAskTh.textContent = 'Call Ask';
        if (peBidTh) peBidTh.textContent = 'Put Bid';
        if (peAskTh) peAskTh.textContent = 'Put Ask';
    }

    // ✅ ROW DATA UPDATE
    data.forEach(row => {
        const ceBid = document.getElementById(`ce-bid-${row.strike}`);
        const ceAsk = document.getElementById(`ce-ask-${row.strike}`);
        const peBid = document.getElementById(`pe-bid-${row.strike}`);
        const peAsk = document.getElementById(`pe-ask-${row.strike}`);

        if (showOI) {
            // CALL
            if (ceBid) ceBid.textContent = row.call.atp ? parseFloat(row.call.atp).toFixed(2) : '-';
            if (ceAsk) ceAsk.textContent = row.call.oi || '-';

            // PUT
            if (peBid) peBid.textContent = row.put.oi || '-';
            if (peAsk) peAsk.textContent = row.put.atp ? parseFloat(row.put.atp).toFixed(2) : '-';
        } else {
            // CALL
            if (ceBid) ceBid.textContent = parseFloat(row.call.bid).toFixed(2);
            if (ceAsk) ceAsk.textContent = parseFloat(row.call.ask).toFixed(2);

            // PUT
            if (peBid) peBid.textContent = parseFloat(row.put.bid).toFixed(2);
            if (peAsk) peAsk.textContent = parseFloat(row.put.ask).toFixed(2);
        }
    });
};



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
        if (el.innerText !== newText) {
            el.innerText = newText;
        }
    }
};

        const existingRows = tbody.querySelectorAll('tr');
        const needRebuild = !this.hasInitialLoad && 
                    (existingRows.length === 0 || 
                     existingRows.length !== data.length ||
                     existingRows[0].id !== `row-${data[0].strike}`);
                            

        const strikeInterval = this.getStrikeInterval(index);


        // Calculate current ATM from spot price
const currentATM = Math.round(spotPrice / strikeInterval) * strikeInterval;

// Use initial ATM if we have it, otherwise use current and save it
if (!this.initialAtmStrike && needRebuild) {
    this.initialAtmStrike = currentATM;
}
const atmStrike = this.initialAtmStrike || currentATM;




        // Save data globally for basket LTP
window.optionChainData = data.map(row => ({
    symbol: row.call.pTrdSymbol || row.put.pTrdSymbol,
    strike: row.strike,
    optionType: 'CE',
    ltp: row.call.ltp,
    oi: row.call.oi,
    atp: row.call.atp,      // ✅ ADD
    change: row.call.change || 0
})).concat(data.map(row => ({
    symbol: row.call.pTrdSymbol || row.put.pTrdSymbol,
    strike: row.strike,
    optionType: 'PE',
    ltp: row.put.ltp,
    oi: row.put.oi,
    atp: row.put.atp,       // ✅ ADD
    change: row.put.change || 0
})));
       // Trigger LTP update for basket ONLY IF BASKET WINDOW IS OPEN
if (typeof updateBasketLTP === 'function' && 
    window.popupManager && 
    window.popupManager.openWindows && 
    window.popupManager.openWindows.has('basketWindow')) {
    setTimeout(updateBasketLTP, 50);
}

// ✅ Save spotPrice to localStorage for later use
try {
    localStorage.setItem('optionChainData', JSON.stringify({
        spotPrice: spotPrice,
        timestamp: Date.now()
    }));
} catch (e) {
    console.error("Failed to save spotPrice to localStorage:", e);
}



        if (needRebuild) {
            tbody.innerHTML = data.map(row => {
                const isATM = row.strike === atmStrike;
const atmStyle = isATM ? 'background-color: #fff9c4;' : '';if (isATM) {
   
}




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
                    <td id="ce-ltp-${row.strike}" class="price-cell" style="font-weight:bold;">${row.call.ltp !== "0.00" ? fmt(row.call.ltp) : "-"}</td>
                    <td id="strike-cell-${row.strike}"><strong>${row.strike}</strong>${isATM ? ' <span style="color:#ffb300;font-weight:bold;">ATM</span>' : ''}</td>
                    <td id="pe-ltp-${row.strike}" class="price-cell" style="font-weight:bold;">${row.put.ltp !== "0.00" ? fmt(row.put.ltp) : "-"}</td>

                    <td id="pe-bid-${row.strike}">${fmt(row.put.bid)}</td>
                    <td id="pe-ask-${row.strike}">${fmt(row.put.ask)}</td>
                    <td>
                        <button class="buy-btn" onclick="dashboard.trackUserActivity(); dashboard.placeOrder('BUY', 'PE', ${row.strike}, 'pe-ask-${row.strike}', '${peSymbol}')">B</button>
                        <button class="sell-btn" onclick="dashboard.trackUserActivity(); dashboard.placeOrder('SELL', 'PE', ${row.strike}, 'pe-bid-${row.strike}', '${peSymbol}')">S</button>
                    </td>
                </tr>`;
            }).join('');
               this.hasInitialLoad = true;
               applyOIATPToggle();

       } else {
    // Use saved data from localStorage
   
   
            data.forEach(row => {
               
                updateCell(`ce-bid-${row.strike}`, row.call.bid);
                updateCell(`ce-ask-${row.strike}`, row.call.ask);
                updateCell(`ce-ltp-${row.strike}`, row.call.ltp);
                updateCell(`pe-bid-${row.strike}`, row.put.bid);
                updateCell(`pe-ask-${row.strike}`, row.put.ask);
                updateCell(`pe-ltp-${row.strike}`, row.put.ltp);
                // === NEW: Send Live Price to Popup ===
                if (window.popupManager) {
                    // Update Call Price
                    if (row.call.pTrdSymbol) {
                        window.popupManager.updateLivePrice(row.call.pTrdSymbol, row.call.ltp);
                    }
                    // Update Put Price
                    if (row.put.pTrdSymbol) {
                        window.popupManager.updateLivePrice(row.put.pTrdSymbol, row.put.ltp);
                    }
                }
               


                const tr = document.getElementById(`row-${row.strike}`);
                if (tr) {
                    

                    tr.className = row.strike < spotPrice ? 'itm' : 'otm';
                
                    const strikeCell = document.getElementById(`strike-cell-${row.strike}`);
                    if (strikeCell) {
                        //const hasATM = strikeCell.innerHTML.includes('ATM');
                        //if (isATM && !hasATM) strikeCell.innerHTML = `<strong>${row.strike}</strong> <span style="color:#ffb300;font-weight:bold;">ATM</span>`;
                        //else if (!isATM && hasATM) strikeCell.innerHTML = `<strong>${row.strike}</strong>`;
                    }
                }
            });
             applyOIATPToggle();
        }
     const tRenderEnd = performance.now();
     const now = Date.now();
     if (now - lastOCLogTime < 1000) {
     console.log('[OC] Render time:', (tRenderEnd - tRenderStart).toFixed(2), 'ms');
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
async updateBackendSelection() {
    const index = document.getElementById('indexSelect')?.value || 'NIFTY';
    const strikes = document.getElementById('strikeCount')?.value || '10';

    try {
        console.log(`📢 Telling Backend: Switch to ${index}`);
        
        // 1. Show loading immediately
        this.showOptionChainLoading(true);
        
        // 2. Tell backend to switch
        await fetch(`/api/dashboard/select-index`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `index=${index}&strikes=${strikes}`
        });
        
        // 3. Wait for backend to start fetching (small delay)
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // 4. Force load option chain NOW (don't wait for next heartbeat)
        await this.loadOptionChain();
        
        // 5. Hide loading (loadOptionChain will hide it on success)
        
    } catch (e) {
        console.error("Failed to update backend selection", e);
        this.showOptionChainLoading(false, true);
    }
}


   async loadExpiries() {
    // ✅ RESET ATM when index changes
    this.initialAtmStrike = null;
    this.hasInitialLoad = false;
    
    const indexSelect = document.getElementById('indexSelect');
    this.updateBackendSelection();
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

document.addEventListener('change', (e) => {
    // Only handle the OI/ATP toggle here
    if (e.target && e.target.id === 'oiAtpToggle') {
        window.showOIATP = e.target.checked;
    }
});

