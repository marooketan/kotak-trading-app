class AlertManager {
    constructor() {
        // Load saved alerts
        const saved = localStorage.getItem('tradingAlerts');
        this.alerts = saved ? JSON.parse(saved) : [];
        this.audio = new Audio('https://codeskulptor-demos.commondatastorage.googleapis.com/pang/pop.mp3');
        console.log("✅ Alert Manager Loaded", this.alerts.length, "alerts");
        
        // Start price monitor
        setInterval(() => this.fetchAlertPrices(), 5000);
    }

    saveAlerts() {
        localStorage.setItem('tradingAlerts', JSON.stringify(this.alerts));
    }

    addAlert(symbol, targetPrice, condition) {
        const alert = {
            id: Date.now(),
            symbol: symbol,
            price: parseFloat(targetPrice),
            condition: condition, // "GREATER" or "LESS"
            active: true
        };
        
        this.alerts.push(alert);
        this.saveAlerts();
        return alert;
    }

    removeAlert(id) {
        this.alerts = this.alerts.filter(a => a.id !== id);
        this.saveAlerts();
    }

   fetchAlertPrices() {
    console.log("🔄 fetchAlertPrices called");
    
    if (this.alerts.length === 0) {
        console.log("No alerts to fetch");
        return;
    }
    
    const symbols = [...new Set(this.alerts.map(alert => alert.symbol))];
    console.log("Alerts symbols:", symbols);
    
    if (symbols.length === 0) return;
    
    const symbolsString = symbols.join(',');
    console.log("Fetching symbols:", symbolsString);
    
    fetch(`/api/portfolio-ltp?symbols=${encodeURIComponent(symbolsString)}`)
        .then(response => response.json())
        .then(data => {
            console.log("API Response:", data);
            
            if (data.success && data.ltp_data) {
                console.log("Got LTP data:", data.ltp_data);
                
                Object.keys(data.ltp_data).forEach(symbol => {
                    const ltp = data.ltp_data[symbol].ltp;
                    console.log(`Symbol: ${symbol}, LTP: ${ltp}`);
                    
                    if (ltp) {
                        this.processPriceUpdate(symbol, ltp);
                    }
                });
            } else {
                console.log("No LTP data in response");
            }
        })
        .catch(error => console.log("Price fetch error:", error));
}

    processPriceUpdate(symbol, ltp) {
    console.log(`📱 Updating ${symbol} = ${ltp}`);
    
    const selector = `.live-alert-ltp[data-symbol="${symbol}"]`;
    console.log("Selector:", selector);
    
    const cells = document.querySelectorAll(selector);
    console.log(`Found ${cells.length} cells`);
    
    cells.forEach((cell, i) => {
        console.log(`Cell ${i}:`, cell);
        console.log("LTP value is:", ltp);
        cell.innerText = ltp.toFixed(2);
        cell.style.color = '#000';  // black
        cell.style.fontWeight = 'bold';
    });

        // Check alerts
        this.alerts.forEach(alert => {
            if (!alert.active || alert.symbol !== symbol) return;

            let triggered = false;
            if (alert.condition === 'GREATER' && ltp >= alert.price) triggered = true;
            if (alert.condition === 'LESS' && ltp <= alert.price) triggered = true;

            if (triggered) {
                this.triggerAlert(alert, ltp);
            }
        });
    }

    triggerAlert(alertData, currentLtp) {
        console.log("🔥 ALERT TRIGGERED!", alertData);
        this.audio.play().catch(e => console.log("Audio error:", e));
        alert(`🔔 PRICE ALERT!\n\n${alertData.symbol}\nTarget: ${alertData.price}\nCurrent: ${currentLtp.toFixed(2)}`);
        
        // Auto-delete
        this.removeAlert(alertData.id);
        if (window.popupAlerts) {
            window.popupAlerts.deleteAlert(alertData.id);
        }
    }
}

window.alertManager = new AlertManager();