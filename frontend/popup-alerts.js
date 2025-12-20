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
    row.setAttribute("data-alert-id", alertObj.id);

    row.innerHTML = `
    <td style="width:30%; color:#4da6ff;">${alertObj.symbol}</td>
    <td class="live-alert-ltp" data-symbol="${alertObj.symbol}" style="width:15%; color:white; font-weight:bold;">Loading...</td>
    <td style="width:10%; color:${alertObj.condition === 'GREATER' ? '#28a745' : '#dc3545'}; font-weight:bold;">
        ${alertObj.condition === 'GREATER' ? '>' : '<'}
    </td>
    <td style="width: 15%; color: black; font-weight: bold; cursor: pointer;" onclick="window.popupAlerts.editTarget(this)" data-price="${alertObj.price}">${alertObj.price}</td>

    <td class="status-cell" style="width:20%; color:white; font-weight:bold;">${alertObj.active ? 'ACTIVE' : 'INACTIVE'}</td>
    <td style="width:10%; text-align:center;">
        <button onclick="window.popupAlerts.deleteAlert(${alertObj.id})"
            style="background:none; border:none; cursor:pointer; color:#ff5555; font-size:16px;">✕</button>
    </td>
`;

console.log('addAlertToTable:', alertObj.id, 'triggered =', alertObj.triggered);

    // ✅ Restore triggered styling if alert was already triggered
    if (alertObj.triggered) {
        row.style.backgroundColor = '#90caf9';
row.style.setProperty('background-color', '#90caf9', 'important');
row.style.opacity = '0.7';


        const statusCell = row.querySelector('.status-cell');
        if (statusCell) {
            statusCell.textContent = '✅ TRIGGERED';
            statusCell.style.color = '#00ff00'; // optional: make badge green
        }
    }

    tbody.prepend(row);
}



    deleteAlert(id) {
        const row = document.getElementById(`alert-row-${id}`);
        if (row) row.remove();

        if (window.alertManager) {
            window.alertManager.removeAlert(id);
        }
    }
    
editTarget(cell) {
    const alertId = cell.closest('tr').dataset.alertId;
    const currentPrice = cell.dataset.price;
    
    const input = document.createElement('input');
    input.type = 'number';
    input.value = currentPrice;
    input.style.width = '100%';
    input.style.background = '#1e1e1e';
    input.style.color = 'white';
    input.style.border = '1px solid #444';
    
    const save = (newPrice) => {
       if (newPrice != currentPrice && window.alertManager) {
    window.alertManager.alerts.find(a => a.id == alertId).price = parseFloat(newPrice);
    window.alertManager.saveAlerts(); // ← ADD THIS
    cell.dataset.price = newPrice;
    cell.textContent = newPrice;
}

    };
    
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();
    
    input.addEventListener('blur', () => save(input.value));
    input.addEventListener('keydown', (e) => {

        if (e.key === 'Enter') {
    input.blur(); // This triggers save
}

    });
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
// === Column Resizer Logic for Alert Table ===
const table = document.getElementById('alertTable');
const cols = table.querySelectorAll('colgroup col');

document.querySelectorAll('#alert-list-body th').forEach((th, index) => {
  const resizer = th.querySelector('.resizer');
  if (!resizer) return;

  resizer.addEventListener('mousedown', function (e) {
    e.preventDefault();
    let startX = e.pageX;
    console.log('Drag started on column', index);

    let startWidth = cols[index].getBoundingClientRect().width;

    function onMouseMove(e) {
      let newWidth = startWidth + (e.pageX - startX);
      cols[index].style.width = newWidth + 'px';
    }

    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
});
