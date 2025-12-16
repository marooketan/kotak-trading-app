class OptionChainUIController {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.setup();
    }
    
    setup() {


 
        // 1. Generic listeners (Market, Expiry, Strikes) -> Just reload the table
        // REMOVED 'indexSelect' from this list!
        ['expirySelect', 'strikeCount'].forEach(id => {
            const el = document.getElementById(id);
           if (el) el.addEventListener('change', () => {
    console.log("🔄 Dropdown changed -> HARD refresh option chain");
    this.dashboard.activityManager.trackUserActivity(); 

    const table = document.getElementById('optionTable');
    const tbody = document.getElementById('optionData');
    const loadingDiv = document.getElementById('loading');

    // Hide old table & clear rows
    if (table) table.style.display = 'none';
    if (tbody) tbody.innerHTML = '';

    // Show loading spinner
    if (loadingDiv) {
        loadingDiv.style.display = 'block';
        loadingDiv.innerHTML = '<div class="loading-spinner">⏳ Refreshing Option Chain...</div>';
    }

    // Now load fresh data
    this.dashboard.optionChain.loadOptionChain();

});

        });

       // 2. Special listener for marketType -> change available indices
const marketTypeEl = document.getElementById('marketType');
const indexSelectEl = document.getElementById('indexSelect');

if (marketTypeEl && indexSelectEl) {
   marketTypeEl.addEventListener('change', () => {
    console.log("🔁 Market type changed -> HARD reset option chain");
    this.dashboard.activityManager.trackUserActivity();
    const table = document.getElementById('optionTable');
    const tbody = document.getElementById('optionData');
    const loadingDiv = document.getElementById('loading');

    if (table) table.style.display = 'none';
    if (tbody) tbody.innerHTML = '';

    if (loadingDiv) {
        loadingDiv.style.display = 'block';
        loadingDiv.innerHTML = '<div class="loading-spinner">⏳ Reloading for new segment...</div>';
    }

    const market = marketTypeEl.value; // "NFO" or "BFO"


        // Clear existing index options
        indexSelectEl.innerHTML = '';

        // Decide which indices to show
        let indices = [];
        if (market === 'BFO') {
            indices = ['SENSEX', 'BANKEX'];
        } else {
            indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
        }

        // Add options to the dropdown
        indices.forEach(idx => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = idx;
            indexSelectEl.appendChild(opt);
                // ✅ NEW: auto-select the first index (NIFTY or SENSEX)
        if (indices.length > 0) {
            indexSelectEl.value = indices[0];
        }

        });
        // Automatically load expiries for the first index
        // 1. Tell backend to switch segment (very important!)
        fetch('/api/switch-segment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `segment=${market}`
       });

       // 2. Load expiries after backend switched
       this.dashboard.optionChain.loadExpiries();


        
        


        // After changing index list, you can later load expiries here
        // (we will handle that in the next step)
    });
}
 
     
        // 2. SPECIAL Listener for Index (NIFTY/BANKNIFTY)
        // When Index changes, we must load NEW EXPIRIES first!
        const indexSelect = document.getElementById('indexSelect');
if (indexSelect) {
    indexSelect.addEventListener('change', () => {
        console.log("🔁 Index changed -> HARD reset option chain");

        const table = document.getElementById('optionTable');
        const tbody = document.getElementById('optionData');
        const loadingDiv = document.getElementById('loading');

        if (table) table.style.display = 'none';
        if (tbody) tbody.innerHTML = '';

        if (loadingDiv) {
            loadingDiv.style.display = 'block';
            loadingDiv.innerHTML = '<div class="loading-spinner">⏳ Reloading for new index...</div>';
        }

        // Load fresh expiries for new index
        this.dashboard.optionChain.loadExpiries();

    });
}
    }
    
}