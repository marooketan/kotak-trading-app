// === USER & SESSION LOGIC ===
PopupManager.prototype.updateUserDisplay = function () {
    const currentUser = this.getCurrentUser();
    const userName = currentUser.charAt(0).toUpperCase() + currentUser.slice(1);
    const isLiveMode = this.isLiveMode();
    
    this.windows.forEach((window, windowId) => {
        this.addUserToHeader(window, userName, isLiveMode);
    });
};

PopupManager.prototype.getCurrentUser = function () {
    if (window.dashboard && window.dashboard.currentUser) {
        return window.dashboard.currentUser;
    }
    const userSelect = document.getElementById('userSelect');
    if (userSelect && userSelect.value) {
        return userSelect.value;
    }
    return 'ketan';
};

PopupManager.prototype.isLiveMode = function () {
    const kotakStatus = document.getElementById('kotakStatus');
    return true; // Always show "Live"
};

PopupManager.prototype.addUserToHeader = function (windowElement, userName, isLiveMode) {
    const header = windowElement.querySelector('.window-header');
    const existingUserSpan = header.querySelector('.user-display');
    
    const userDisplay = existingUserSpan || document.createElement('span');
    userDisplay.className = 'user-display';
    userDisplay.innerHTML = ` • ${userName} <span class="mode-badge">${isLiveMode ? 'Live' : 'Demo'}</span>`;
    
    if (!existingUserSpan) {
        const title = header.querySelector('.window-title');
        title.appendChild(userDisplay);
    }
};

PopupManager.prototype.fetchSessionStatus = async function () {
    try {
        const response = await fetch('/api/session-status');
        const data = await response.json();
        if (data.authenticated && data.user) {
            if (window.dashboard) window.dashboard.currentUser = data.user;
            const userSelect = document.getElementById('userSelect');
            if (userSelect) userSelect.value = data.user;
        }
    } catch (error) {
        console.error('Failed to fetch session status:', error);
    }
};

// === WINDOW MANAGEMENT ===
PopupManager.prototype.getBrowserHeaderHeight = function () {
    const chromeHeight = window.outerHeight - window.innerHeight;
    const safeMargin = 20;
    return Math.max(chromeHeight, safeMargin);
};

PopupManager.prototype.ensurePopupVisibility = function () {
    const minTop = this.getBrowserHeaderHeight();
    this.windows.forEach((window, windowId) => {
        if (window.style.display === 'block') {
            const rect = window.getBoundingClientRect();
            if (rect.top < minTop) {
                window.style.top = minTop + 'px';
            }
        }
    });
};
