let isIndexQuotesActive = false;

// 1. The Variable to hold the Timer (MUST BE HERE)
let indexPriceInterval; 

function updateIndexPricesPopup() {
    const win = document.getElementById('indexPricesWindow');

    // 🛡️ ROBUST CHECK: Check if window is actually visible
    // This stops the fetch if you close the window (even with CSS classes)
    if (!win || window.getComputedStyle(win).display === 'none') {
        console.log("🛑 Index Window Hidden. Stopping background fetch.");
        stopIndexPriceUpdates(); 
        return;
    }

    // Double check flag
    if (!isIndexQuotesActive) return;

    fetch('/api/index-quotes')
        .then(r => r.json())
        .then(data => {
            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (item.name === "NIFTY 50") {
                        const el = document.getElementById('popupNiftyPrice');
                        if (el) el.textContent = item.ltp;
                    }
                    if (item.name === "BANK NIFTY") {
                        const el = document.getElementById('popupBankniftyPrice');
                        if (el) el.textContent = item.ltp;
                    }
                    if (item.name === "FINNIFTY") {
                        const el = document.getElementById('popupFinniftyPrice');
                        if (el) el.textContent = item.ltp;
                    }
                    if (item.name === "MIDCPNIFTY") {
                        const el = document.getElementById('popupMidcpniftyPrice');
                        if (el) el.textContent = item.ltp;
                    }
                    if (item.name === "SENSEX") {
                        const el = document.getElementById('popupSensexPrice');
                        if (el) el.textContent = item.ltp;
                    }
                });
            }
        })
        .catch(error => console.error('Error fetching index prices:', error));
}

function startIndexPriceUpdates() {
    isIndexQuotesActive = true;
    
    // Run once immediately
    updateIndexPricesPopup();
    
    // Start the timer if it's not already running
    if (!indexPriceInterval) {
        indexPriceInterval = setInterval(updateIndexPricesPopup, 500); 
    }
}

function stopIndexPriceUpdates() {
    isIndexQuotesActive = false;

    // Kill the timer using the variable we defined at the top
    if (indexPriceInterval) {
        clearInterval(indexPriceInterval);
        indexPriceInterval = null;
    }
}