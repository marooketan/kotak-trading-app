let watchlistItems = []; 
let watchlistTimer = null; // Timer for live prices

// ▶ Watchlist DOM hookup — moved to its own module

document.addEventListener('DOMContentLoaded', () => {
    const addBtn = document.getElementById('wlAddBtn');
    if (addBtn) addBtn.addEventListener('click', addToWatchlist);
    // Attempt to load saved watchlist (function still in dashboard.js for now)
    if (typeof loadWatchlist === 'function') loadWatchlist();
});
function isWatchlistVisible() {
    // Check if watchlist window is open and visible
    const watchlistWindow = document.getElementById('watchlistWindow');
    return watchlistWindow && watchlistWindow.style.display === 'block';
}
function renderWatchlistTable() {
    const tbody = document.querySelector('#watchlistTable tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    watchlistItems.forEach((item) => {
        const tr = document.createElement('tr');
        tr.id = `wl-row-${item.id}`;
        
        tr.innerHTML = `
            <td>${item.segment}</td>
            <td>${item.index}</td>
            <td>${item.expiry}</td>
            <td style="color: ${item.type === 'CE' ? '#27ae60' : '#c0392b'}; font-weight:bold;">${item.type}</td>
            <td>${item.strike}</td>
            
            <td id="wl-ltp-${item.trdSymbol}" style="font-weight:bold;">-</td>
            
            <td style="text-align:center; min-width: 60px;">
                <div style="display:flex; flex-direction:column; align-items:center;">
                    <span id="wl-buy-${item.trdSymbol}" style="font-size:11px; color:#e67e22; margin-bottom:2px;">-</span>
                    <button class="buy-btn" style="padding: 2px 10px; font-size: 11px; cursor: pointer; background-color: #27ae60; color: white; border: none; border-radius: 3px;" 
                        onclick="dashboard.placeOrder('BUY', '${item.type}', ${item.strike}, 'wl-sell-${item.trdSymbol}', '${item.trdSymbol}', '${item.segment}')">B</button>
                </div>
            </td>

            <td style="text-align:center; min-width: 60px;">
                <div style="display:flex; flex-direction:column; align-items:center;">
                    <span id="wl-sell-${item.trdSymbol}" style="font-size:11px; color:#2980b9; margin-bottom:2px;">-</span>
                    <button class="sell-btn" style="padding: 2px 10px; font-size: 11px; cursor: pointer; background-color: #e74c3c; color: white; border: none; border-radius: 3px;" 
                        onclick="dashboard.placeOrder('SELL', '${item.type}', ${item.strike}, 'wl-buy-${item.trdSymbol}', '${item.trdSymbol}', '${item.segment}')">S</button>
                </div>
           <td style="text-align:center; min-width:60px;">
    <button style="padding:2px 6px; font-size:11px; margin-right:4px;
                   background:#27ae60; color:white; border:none; border-radius:3px; cursor:pointer;"
        title="Add BUY to Basket"
        onclick="dashboard.addToBasket({
            action: 'BUY',
            optionType: '${item.type}',
            strike: ${item.strike},
            price: 0,
            symbol: '${item.trdSymbol}',
            segment: '${item.segment}'
        })">B</button>

    <button style="padding:2px 6px; font-size:11px;
                   background:#e74c3c; color:white; border:none; border-radius:3px; cursor:pointer;"
        title="Add SELL to Basket"
        onclick="dashboard.addToBasket({
            action: 'SELL',
            optionType: '${item.type}',
            strike: ${item.strike},
            price: 0,
            symbol: '${item.trdSymbol}',
            segment: '${item.segment}'
        })">S</button>
</td>




</td>


            <td style="text-align:center;">
                <button onclick="removeFromWatchlist(${item.id})" style="background:none; border:none; cursor:pointer; color:#7f8c8d; font-weight:bold; font-size: 14px;">✖</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}
async function fetchWatchlistPrices() {
    
    if (watchlistItems.length === 0 || document.hidden || !isWatchlistVisible()) return;

    const symbols = watchlistItems.map(item => item.trdSymbol).join(',');

    try {
        const response = await fetch(`/api/portfolio-ltp?symbols=${encodeURIComponent(symbols)}`);
        const data = await response.json();

        if (data.success && data.ltp_data) {
            watchlistItems.forEach(item => {
                const quote = data.ltp_data[item.trdSymbol]; // {ltp, bid, ask}
                
                if (quote && quote.ltp !== undefined) {
                    const ltp = quote.ltp;
                    const bid = quote.bid > 0 ? quote.bid : ltp; // Fallback to LTP if 0
                    const ask = quote.ask > 0 ? quote.ask : ltp; // Fallback to LTP if 0

                    // 1. Update LTP Cell
                    const ltpCell = document.getElementById(`wl-ltp-${item.trdSymbol}`);
                    if (ltpCell) {
                        const oldVal = parseFloat(ltpCell.innerText) || 0;
                        ltpCell.innerText = ltp.toFixed(2);
                        if (ltp > oldVal) ltpCell.style.color = '#27ae60';
                        else if (ltp < oldVal) ltpCell.style.color = '#e74c3c';
                    }
                    
                    // 2. Update Buy Column (Show ASK Price)
                    const buyCell = document.getElementById(`wl-buy-${item.trdSymbol}`);
                    if(buyCell) {
                        buyCell.innerText = ask.toFixed(2);
                        // Optional: Color it slightly differently to show it's Ask
                        buyCell.style.color = '#e67e22'; // Orange tint for Ask
                    }

                    // 3. Update Sell Column (Show BID Price)
                    const sellCell = document.getElementById(`wl-sell-${item.trdSymbol}`);
                    if(sellCell) {
                        sellCell.innerText = bid.toFixed(2);
                        sellCell.style.color = '#2980b9'; // Blue tint for Bid
                    }
                }
            });
        }
    } catch (e) {
        // console.error("Watchlist LTP Error", e); 
    }
}
function loadWatchlist() {
    const saved = localStorage.getItem('myWatchlist');
    if (saved) {
        watchlistItems = JSON.parse(saved);
        renderWatchlistTable();
        startWatchlistLTP(); // Start live updates immediately
    }
}
function addToWatchlist() {
    const seg = document.getElementById('wlSegmentSelect').value;
    const index = document.getElementById('wlIndexSelect').value;
    const expiry = document.getElementById('wlExpirySelect').value;
    const type = document.getElementById('wlOptionTypeSelect').value;
    const strikeSelect = document.getElementById('wlStrikeSelect');
    const strike = strikeSelect.value;

    if (!seg || !index || !expiry || !strike || !type) {
        alert("⚠️ Please select all fields.");
        return;
    }

    const selectedOption = strikeSelect.options[strikeSelect.selectedIndex];
    let token = null;
    let trdSymbol = null; // We need this for Buy/Sell

    if (type === 'CE') {
        token = selectedOption.getAttribute('data-ce-token');
        trdSymbol = selectedOption.getAttribute('data-ce-symbol');
    } else {
        token = selectedOption.getAttribute('data-pe-token');
        trdSymbol = selectedOption.getAttribute('data-pe-symbol');
    }

    if (!token || !trdSymbol) {
        alert("❌ Error: Instrument data missing. Please reload strikes.");
        return;
    }

    // Check for duplicates
    if (watchlistItems.some(item => item.token === token)) {
        alert("⚠️ Item is already in watchlist.");
        return;
    }

    const newItem = {
        id: Date.now(),
        segment: seg,
        index: index,
        expiry: expiry,
        type: type,
        strike: strike,
        token: token,
        trdSymbol: trdSymbol // Saved!
    };

    watchlistItems.push(newItem);
    localStorage.setItem('myWatchlist', JSON.stringify(watchlistItems));
    renderWatchlistTable();
    startWatchlistLTP(); // Restart loop to include new item
}
// === LIVE PRICE UPDATER ===
function startWatchlistLTP() {
    if (watchlistTimer) clearInterval(watchlistTimer);
    if (watchlistItems.length === 0) return;

    // Run immediately
    fetchWatchlistPrices();

    // Loop every 1 second
    watchlistTimer = setInterval(fetchWatchlistPrices, 1000);
}
// 3. Draw the Table Rows (Buttons INSIDE Buy/Sell Columns)
function removeFromWatchlist(id) {
    watchlistItems = watchlistItems.filter(item => item.id !== id);
    localStorage.setItem('myWatchlist', JSON.stringify(watchlistItems));
    renderWatchlistTable();
}
