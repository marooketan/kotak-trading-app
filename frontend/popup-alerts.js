class PopupAlerts {
    constructor() {
        console.log("✅ Popup Alerts Loaded");
        setTimeout(() => this.setupListeners(), 1000);
    }

    setupListeners() {
        const setBtn = document.getElementById('btn-set-alert');
        if (setBtn) {
            setBtn.addEventListener('click', () => this.handleAddClick());
        }
    }

    open() {
        this.openWithData("Select Symbol", "0");
    }

    openWithData(symbol, price) {
    const win = document.getElementById('alertWindow');
    if (!win) return;
    
    win.style.display = 'block';
    
    // Register with popupManager
    if (window.popupManager) {
        window.popupManager.makeDraggable(win);
        window.popupManager.makeResizable(win);
        window.popupManager.openWindows.add('alertWindow');
        
        // Setup close/minimize buttons
        win.querySelector('.close-btn').addEventListener('click', () => {
            window.popupManager.hideWindow('alertWindow');
        });
        win.querySelector('.minimize-btn').addEventListener('click', () => {
            window.popupManager.toggleMinimize(win);
        });
    }

    // Update UI with new HTML structure
    document.getElementById('alert-active-symbol').innerText = symbol;
    document.getElementById('alert-live-ltp').innerText = parseFloat(price).toFixed(2);
    document.getElementById('alert-target-price').value = price;
    
    // Load existing alerts
    this.loadExistingAlerts();
    
    // Focus
    document.getElementById('alert-target-price').focus();
    document.getElementById('alert-target-price').select();
}

    handleAddClick() {
        const symbol = document.getElementById('alert-active-symbol').innerText;
        const condition = document.getElementById('alert-condition').value;
        const targetPrice = document.getElementById('alert-target-price').value;

        if (symbol === "Select Symbol" || !targetPrice) {
            alert("Please select a symbol and enter price!");
            return;
        }

        if (window.alertManager) {
            const newAlert = window.alertManager.addAlert(symbol, targetPrice, condition);
            this.addAlertToTable(newAlert);
        }

        // Success feedback
        const btn = document.getElementById('btn-set-alert');
        const originalText = btn.innerText;
        btn.style.background = '#28a745';
        btn.innerText = 'Saved! ✅';
        setTimeout(() => {
            btn.style.background = '#007acc';
            btn.innerText = originalText;
        }, 1000);
    }

    addAlertToTable(alertObj) {
    const tbody = document.getElementById('alert-list-body');
    if (!tbody) return;

    const row = document.createElement('tr');
    row.id = `alert-row-${alertObj.id}`;
    row.innerHTML = `
        <td style="color: #4da6ff;">${alertObj.symbol}</td>
        <td class="live-alert-ltp" data-symbol="${alertObj.symbol}" style="color: white; font-weight: bold;">Loading...</td>
        <td style="color: ${alertObj.condition === 'GREATER' ? '#28a745' : '#dc3545'}; font-weight:bold;">
            ${alertObj.condition === 'GREATER' ? '>' : '<'}
        </td>
        <td style="color: #ffcc00;">${alertObj.price}</td>
        <td><button onclick="window.popupAlerts.deleteAlert(${alertObj.id})" 
               style="background:none; border:none; cursor:pointer; color: #ff5555; font-size: 16px;">✕</button></td>
    `;
    
    tbody.prepend(row);
}

    deleteAlert(id) {
        const row = document.getElementById(`alert-row-${id}`);
        if (row) row.remove();

        if (window.alertManager) {
            window.alertManager.removeAlert(id);
        }
    }

    loadExistingAlerts() {
        const tbody = document.getElementById('alert-list-body');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (window.alertManager && window.alertManager.alerts) {
            window.alertManager.alerts.forEach(alert => {
                this.addAlertToTable(alert);
            });
        }
    }
}

// Initialize
window.popupAlerts = new PopupAlerts();