class AlertManager {
    constructor() {
        // Load saved alerts
        const saved = localStorage.getItem('tradingAlerts');
        this.alerts = saved ? JSON.parse(saved) : [];
        // Web Audio API beep generator
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
           // ✅ Request browser notification permission once at startup
        if ("Notification" in window && Notification.permission !== "granted") {
            Notification.requestPermission().then(permission => {
                console.log("🔔 Notification permission:", permission);
            });
        }
        console.log("✅ Alert Manager Loaded", this.alerts.length, "alerts");
        
        // Start price monitor
        setInterval(() => this.fetchAlertPrices(), 1000);
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
        if (this.alerts.length === 0) {
            return;
        }
        
        const symbols = [...new Set(this.alerts.map(alert => alert.symbol))];
        if (symbols.length === 0) return;
        
        const symbolsString = symbols.join(',');
        
        fetch(`/api/portfolio-ltp?symbols=${encodeURIComponent(symbolsString)}`)
            .then(response => response.json())
            .then(data => {
                if (data.success && data.ltp_data) {
                    Object.keys(data.ltp_data).forEach(symbol => {
                        const ltp = data.ltp_data[symbol].ltp;
                        if (ltp) {
                            this.processPriceUpdate(symbol, ltp);
                        }
                    });
                }
            })
            .catch(error => console.log("Price fetch error:", error));
    }

    processPriceUpdate(symbol, ltp) {
        const selector = `.live-alert-ltp[data-symbol="${symbol}"]`;
        const cells = document.querySelectorAll(selector);
        
        cells.forEach((cell) => {
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

    // ✅ New helper for beep
    playBeep(frequency = 1200, duration = 200) {
        const oscillator = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gainNode.gain.value = 1;

        oscillator.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        oscillator.start();
        setTimeout(() => oscillator.stop(), duration);
    }

    triggerAlert(alertData, currentLtp) {
        console.log(`🚨 ALERT TRIGGERED: ${alertData.symbol} ${alertData.condition} ${alertData.price}`);
        
        // 🔊 PLAY LOUD BEEP (3 times)
        this.playBeep(1200, 200);
        setTimeout(() => this.playBeep(1200, 200), 300);
        setTimeout(() => this.playBeep(1200, 200), 600);

        // ✅ Use console + notification instead
console.log(`🔔 PRICE ALERT! ${alertData.symbol} Target: ${alertData.price} Current: ${currentLtp.toFixed(2)}`);

if ("Notification" in window && Notification.permission === "granted") {
    new Notification(`🔔 ${alertData.symbol} Alert`, {
        body: `Target: ${alertData.price} | Current: ${currentLtp.toFixed(2)}`,
        icon: '/favicon.ico'
    });
}

        // 🔄 MARK AS TRIGGERED (BUT DON'T DELETE)
        alertData.triggered = true;
        alertData.active = false;
        this.saveAlerts();
        if (window.popupAlerts) {
    window.popupAlerts.loadExistingAlerts();
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
