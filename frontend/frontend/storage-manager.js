const originalSetItem = localStorage.setItem;

class StorageManager {
    static MAX_SIZE = 4.5 * 1024 * 1024; // 4.5MB (leave 0.5MB buffer)
    
    // Safe save with size check
    static setItem(key, value) {
        try {
            // 1. Convert to string and check size
            const dataStr = JSON.stringify(value);
            const newSize = dataStr.length;
            
            // 2. Check if adding this would exceed limit
            const currentSize = this.getTotalSize();
            if (currentSize + newSize > this.MAX_SIZE) {
                console.warn(`⚠️ Storage near limit (${currentSize} bytes). Cleaning old data...`);
                this.cleanOldData();
            }
            
            // 3. Save the data
            originalSetItem.call(localStorage, key, dataStr);
            console.log(`💾 Saved ${key} (${newSize} bytes)`);
            
            return true;
        } catch (error) {
            console.error(`❌ Failed to save ${key}:`, error);
            return false;
        }
    }
    
    // Get total localStorage size
    static getTotalSize() {
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);
            total += key.length + value.length;
        }
        return total;
    }
    
    // Clean old window state data
    static cleanOldData() {
        const keysToKeep = ['popupSettings', 'myWatchlist']; // Important data
        const allKeys = [];
        
        // Collect all keys
        for (let i = 0; i < localStorage.length; i++) {
            allKeys.push(localStorage.key(i));
        }
        
        // Find and remove old window state data
        const oldWindowKeys = allKeys.filter(key => 
            key.startsWith('popup_state_') || 
            key.startsWith('col_layout_')
        );
        
        // Remove oldest half
        oldWindowKeys.sort((a, b) => {
            // Sort by last modified (we don't have timestamp, so remove alphabetically)
            return a.localeCompare(b);
        });
        
        const toRemove = oldWindowKeys.slice(0, Math.floor(oldWindowKeys.length / 2));
        toRemove.forEach(key => {
            console.log(`🧹 Cleaning old: ${key}`);
            localStorage.removeItem(key);
        });
        
        return toRemove.length;
    }
    
    // Check and clean if needed (called from localStorage.setItem override)
    static cleanIfNeeded() {
        try {
            const currentSize = JSON.stringify(localStorage).length;
            if (currentSize > this.MAX_SIZE * 0.8) {
                console.log("⚠️ Storage getting full, cleaning old window data...");
                // Simple cleanup: remove oldest window states
                const keys = Object.keys(localStorage);
                const windowKeys = keys.filter(k => k.startsWith('popup_state_'));
                if (windowKeys.length > 5) {
                    // Remove oldest 2 window states
                    windowKeys.slice(0, 2).forEach(key => {
                        localStorage.removeItem(key);
                        console.log(`🧹 Removed old: ${key}`);
                    });
                }
            }
        } catch (e) {
            console.log("⚠️ Cleanup error:", e);
        }
    }
}
