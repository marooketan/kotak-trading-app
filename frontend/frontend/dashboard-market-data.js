

let isIndexQuotesActive = false;


function updateIndexPricesPopup() {
    if (!isIndexQuotesActive) return;

    fetch('/api/index-quotes')
        .then(r => r.json())
        .then(data => {
            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (item.name === "NIFTY 50") {
                        document.getElementById('popupNiftyPrice').textContent = item.ltp;
                    }
                    if (item.name === "BANK NIFTY") {
                        document.getElementById('popupBankniftyPrice').textContent = item.ltp;
                    }
                    if (item.name === "FINNIFTY") {
                        document.getElementById('popupFinniftyPrice').textContent = item.ltp;
                    }
                    if (item.name === "MIDCPNIFTY") {
                        document.getElementById('popupMidcpniftyPrice').textContent = item.ltp;
                    }
                    if (item.name === "SENSEX") {
                        document.getElementById('popupSensexPrice').textContent = item.ltp;
                    }
                });
            }
        })
        .catch(error => console.error('Error fetching index prices:', error));
}

// ▶ Index price update timer
let indexPriceInterval;

function startIndexPriceUpdates() {
    isIndexQuotesActive = true;
    updateIndexPricesPopup();
    if (!indexPriceInterval) {
        indexPriceInterval = setInterval(updateIndexPricesPopup, 500); // ✅ ADD THIS LINE
    }
}
function stopIndexPriceUpdates() {
    isIndexQuotesActive = false;

    clearInterval(indexPriceInterval);
    indexPriceInterval = null;
}