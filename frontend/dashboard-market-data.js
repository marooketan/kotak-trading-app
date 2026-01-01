/*************************************************
 * DASHBOARD MARKET DATA (INDEX SIDEBAR)
 * SOURCE: MEMORY BOX ONLY
 * SAFE FROM 0.00 POISONING
 *************************************************/

/**
 * Flag to control background polling
 */
let isIndexQuotesActive = false;

/**
 * Timer reference (must be global)
 */
let indexPriceInterval = null;

/**
 * Fetch index prices from Memory Box
 * READ-ONLY, SAFE, NO KOTAK CALLS
 */
function updateIndexPricesPopup() {
    return;

    const win = document.getElementById('indexPricesWindow');

    // 🛡️ Robust visibility check
    if (!win || window.getComputedStyle(win).display === 'none') {
        console.log("🛑 Index Window Hidden. Stopping Memory Box fetch.");
        stopIndexPriceUpdates();
        return;
    }

    if (!isIndexQuotesActive) return;

    fetch('/api/memory-box/status')
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.indices) return;

            const indices = data.indices;

            if (indices["NIFTY"]) {
                const el = document.getElementById('popupNiftyPrice');
                if (el) el.textContent = indices["NIFTY"].value;
            }

            if (indices["BANKNIFTY"]) {
                const el = document.getElementById('popupBankniftyPrice');
                if (el) el.textContent = indices["BANKNIFTY"].value;
            }

            if (indices["FINNIFTY"]) {
                const el = document.getElementById('popupFinniftyPrice');
                if (el) el.textContent = indices["FINNIFTY"].value;
            }

            if (indices["MIDCPNIFTY"]) {
                const el = document.getElementById('popupMidcpniftyPrice');
                if (el) el.textContent = indices["MIDCPNIFTY"].value;
            }

            if (indices["SENSEX"]) {
                const el = document.getElementById('popupSensexPrice');
                if (el) el.textContent = indices["SENSEX"].value;
            }
        })
        .catch(error => {
            console.error("❌ Memory Box status fetch error:", error);
        });
}

/**
 * Start polling index prices (Memory Box)
 */
function startIndexPriceUpdates() {
    isIndexQuotesActive = true;

    // Run once immediately
    updateIndexPricesPopup();

    // Start interval only if not running
    if (!indexPriceInterval) {
        indexPriceInterval = setInterval(updateIndexPricesPopup, 1000);
    }
}

/**
 * Stop polling index prices
 */
function stopIndexPriceUpdates() {
    isIndexQuotesActive = false;

    if (indexPriceInterval) {
        clearInterval(indexPriceInterval);
        indexPriceInterval = null;
    }
}
