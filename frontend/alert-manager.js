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
            active: true,
            triggered: false // Add this new field
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
        //console.log("🔄 fetchAlertPrices called");
        
        if (this.alerts.length === 0) {
            //console.log("No alerts to fetch");
            return;
        }
        
        const symbols = [...new Set(this.alerts.map(alert => alert.symbol))];
        //console.log("Alerts symbols:", symbols);
        
        if (symbols.length === 0) return;
        
        const symbolsString = symbols.join(',');
        //console.log("Fetching symbols:", symbolsString);
        
        fetch(`/api/portfolio-ltp?symbols=${encodeURIComponent(symbolsString)}`)
            .then(response => response.json())
            .then(data => {
                //console.log("API Response:", data);
                
                if (data.success && data.ltp_data) {
                    //console.log("Got LTP data:", data.ltp_data);
                    
                    Object.keys(data.ltp_data).forEach(symbol => {
                        const ltp = data.ltp_data[symbol].ltp;
                        //console.log(`Symbol: ${symbol}, LTP: ${ltp}`);
                        
                        if (ltp) {
                            this.processPriceUpdate(symbol, ltp);
                        }
                    });
                } else {
                    //console.log("No LTP data in response");
                }
            })
            .catch(error => console.log("Price fetch error:", error));
    }

    processPriceUpdate(symbol, ltp) {
        //console.log(`📱 Updating ${symbol} = ${ltp}`);
        
        const selector = `.live-alert-ltp[data-symbol="${symbol}"]`;
        //console.log("Selector:", selector);
        
        const cells = document.querySelectorAll(selector);
        //console.log(`Found ${cells.length} cells`);
        
        cells.forEach((cell, i) => {
            //console.log(`Cell ${i}:`, cell);
            //console.log("LTP value is:", ltp);
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
    console.log(`🚨 ALERT TRIGGERED: ${alertData.symbol} ${alertData.condition} ${alertData.price}`);
    
    // 🔊 PLAY LOUD BEEP (3 times) - EXACTLY AS BEFORE
    this.audio.volume = 1.0; // Maximum volume
    this.audio.play().catch(e => console.log("Audio error:", e)); // KEEP THE .catch()!

    // Play 2 more times
    setTimeout(() => {
        this.audio.currentTime = 0;
        this.audio.play().catch(e => console.log("Audio error:", e)); // KEEP .catch()!
    }, 300);

    setTimeout(() => {
        this.audio.currentTime = 0;
        this.audio.play().catch(e => console.log("Audio error:", e)); // KEEP .catch()!
    }, 600);
    // 🔔 SHOW POPUP ALERT - ADD THIS LINE HERE
alert(`🔔 PRICE ALERT!\n\n${alertData.symbol}\nTarget: ${alertData.price}\nCurrent: ${currentLtp.toFixed(2)}`);
    // 🔄 MARK AS TRIGGERED (BUT DON'T DELETE)
    alertData.triggered = true;
    alertData.active = false;
    this.saveAlerts();
    
    // UPDATE UI TO SHOW "TRIGGERED" STATUS
    if (window.popupAlerts) {
        const alertRow = document.querySelector(`[data-alert-id="${alertData.id}"]`);
        if (alertRow) {
            // Change row color to indicate triggered
            alertRow.style.backgroundColor = '#ffebee';
            alertRow.style.opacity = '0.7';
            
            // Add "TRIGGERED" badge
            const statusCell = alertRow.querySelector('.alert-status') || 
                              alertRow.insertCell(3);
            statusCell.className = 'alert-status';
            statusCell.textContent = '✅ TRIGGERED';
            statusCell.style.color = 'green';
            statusCell.style.fontWeight = 'bold';
        }
    }
    
    // Optional: Browser notification
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification(`🔔 ${alertData.symbol} Alert`, {
            body: `Target: ${alertData.price} | Current: ${currentLtp.toFixed(2)}`,
            icon: '/favicon.ico'
        });
    }
}
}

window.alertManager = new AlertManager();