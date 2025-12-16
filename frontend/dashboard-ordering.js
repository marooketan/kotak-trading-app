function showOrderLoading(show, message = '') {
    let loadingEl = document.getElementById('orderLoading');
    if (!loadingEl) {
        loadingEl = document.createElement('div');
        loadingEl.id = 'orderLoading';
        loadingEl.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            padding: 10px 15px;
            border-radius: 5px;
            z-index: 10000;
            font-weight: bold;
        `;
        document.body.appendChild(loadingEl);
    }

    if (show) {
        loadingEl.textContent = message;
        loadingEl.style.display = 'block';
    } else {
        if (message) {
            loadingEl.textContent = message;
            loadingEl.style.background = message.includes('✅') ? '#d4edda' : '#f8d7da';
            loadingEl.style.borderColor = message.includes('✅') ? '#c3e6cb' : '#f5c6cb';
            setTimeout(() => loadingEl.style.display = 'none', 3000);
        } else {
            loadingEl.style.display = 'none';
        }
    }
}
function placeOrderWrapper(...args) {
    return window.dashboard.placeOrder(...args);
}
function placeConfirmedOrderWrapper(...args) {
    return window.dashboard.placeConfirmedOrder(...args);
}
