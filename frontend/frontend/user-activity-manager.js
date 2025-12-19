// user-activity-manager.js
class UserActivityManager {
    constructor() {
        this.lastUserActivity = Date.now();
        this.lastIdleState = false;
    }

    trackUserActivity() {
        const oldTime = this.lastUserActivity;
        this.lastUserActivity = Date.now();
        // (We don't need to return anything here)
    }

    isUserIdle() {
        const IDLE_TIMEOUT = 5000; // 5 seconds
        const timeSinceLastActivity = Date.now() - this.lastUserActivity;
        
        const isIdle = timeSinceLastActivity > IDLE_TIMEOUT;
        
                
        return isIdle;
    }
}