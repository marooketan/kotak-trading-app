class WatchlistManager {
        constructor() {
            this.setup();
    }

    setup() {
// === WATCHLIST LOGIC START ===

        const wlSegment = document.getElementById('wlSegmentSelect');
        const wlIndex = document.getElementById('wlIndexSelect');
        const wlExpiry = document.getElementById('wlExpirySelect');
        const wlOptionType = document.getElementById('wlOptionTypeSelect');
        const wlStrike = document.getElementById('wlStrikeSelect');

        // 1. When Segment (NFO/BFO) Changes -> Fill Index
        if (wlSegment && wlIndex) {
            const fillIndices = () => {
                const currentSeg = wlSegment.value; // Read fresh value
                wlIndex.innerHTML = '<option value="">Select Index</option>';
                const list = currentSeg === 'BFO' ? BFO_INDICES : NFO_INDICES;
                
                list.forEach(name => {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    wlIndex.appendChild(opt);
                });
            };

            // Run once on load, and whenever changed
            fillIndices();
            wlSegment.addEventListener('change', fillIndices);
        }

        // 2. When Index Changes -> Load Expiries
        if (wlIndex && wlExpiry && wlSegment) {
            wlIndex.addEventListener('change', async () => {
                const index = wlIndex.value;
                // STRICT CHECK: Get the value directly from the element
                const segment = document.getElementById('wlSegmentSelect').value; 

                wlExpiry.innerHTML = '<option value="">Loading...</option>';
                wlStrike.innerHTML = '<option value="">Select Strike</option>'; // Clear strikes too

                if (!index) return;

                try {
                    console.log(`🔍 Watchlist: Fetching Expiries for ${index} (${segment})`);
                    const response = await fetch(
                        `/api/expiries-v2?index=${encodeURIComponent(index)}&segment=${encodeURIComponent(segment)}`
                    );
                    const data = await response.json();

                    wlExpiry.innerHTML = '<option value="">Select Expiry</option>';

                    if (data.success && Array.isArray(data.expiries) && data.expiries.length > 0) {
                        data.expiries.forEach(exp => {
                            const opt = document.createElement('option');
                            opt.value = exp;
                            opt.textContent = exp;
                            wlExpiry.appendChild(opt);
                        });

                        // Auto-select first expiry
                        wlExpiry.selectedIndex = 1; 
                        // Force the next step (Loading Strikes) immediately
                        wlExpiry.dispatchEvent(new Event('change'));
                    } else {
                        wlExpiry.innerHTML = '<option value="">No Data</option>';
                    }
                } catch (e) {
                    console.error("Watchlist Expiry Error:", e);
                    wlExpiry.innerHTML = '<option value="">Error</option>';
                }
            });
        }
            // 3. When Expiry Changes -> Load Strikes (UPDATED to save Trading Symbol)
        if (wlExpiry && wlOptionType && wlStrike && wlIndex && wlSegment) {
            wlExpiry.addEventListener('change', async () => {
                const index = wlIndex.value;
                const expiry = wlExpiry.value;
                const segment = document.getElementById('wlSegmentSelect').value;
                
                wlStrike.innerHTML = '<option value="">Loading...</option>';

                if (!index || !expiry || expiry === 'Loading...') return;

                try {
                   const recenterFlag = "true"; // Watchlist always uses fresh data
                   const response = await fetch(
                       `/api/option-chain?index=${encodeURIComponent(index)}&expiry=${encodeURIComponent(expiry)}&strikes=all&segment=${encodeURIComponent(segment)}&recenter=${recenterFlag}`
                   );
                    const data = await response.json();

                    wlStrike.innerHTML = '<option value="">Select Strike</option>';

                    if (data.success && Array.isArray(data.data)) {
                        const strikesSet = new Set();
                        data.data.forEach(row => { if (row && row.strike) strikesSet.add(row.strike); });

                        const sortedStrikes = Array.from(strikesSet).sort((a, b) => a - b);
                        
                        sortedStrikes.forEach(strike => {
                            const opt = document.createElement('option');
                            opt.value = strike;
                            opt.textContent = strike;
                            
                            // FIND THE ROW to get Token AND Trading Symbol
                            const row = data.data.find(r => r.strike === strike);
                            if(row) {
                                // Save Tokens
                                if(row.call) opt.setAttribute('data-ce-token', row.call.token);
                                if(row.put) opt.setAttribute('data-pe-token', row.put.token);

                                // === NEW: Save Trading Symbols (Required for Buy/Sell) ===
                                if(row.call) opt.setAttribute('data-ce-symbol', row.call.pTrdSymbol);
                                if(row.put) opt.setAttribute('data-pe-symbol', row.put.pTrdSymbol);
                            }
                            
                            wlStrike.appendChild(opt);
                        });
                    } else {
                         wlStrike.innerHTML = '<option value="">No Data</option>';
                    }
                } catch (err) {
                    console.error('Watchlist strike load failed:', err);
                    wlStrike.innerHTML = '<option value="">Error</option>';
                }
            });
        }
                // === WATCHLIST LOGIC END ===
     }
}
