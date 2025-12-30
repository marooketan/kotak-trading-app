# ==========================================
# STRATEGY SETTINGS (The Rulebook)
# ==========================================

# 1. Instrument
SYMBOL = "NIFTY"
EXPIRY_OFFSET = 0 
MARKET_DEBUG = False


# 2. Time Settings (Operating Hours)
# Format: "HH:MM" (24-hour format)
START_TIME = "09:15"
NO_NEW_ENTRY_TIME = "14:00"
SQUARE_OFF_TIME = "15:15"

# 3. Loop Speeds (Seconds)
OI_CHECK_INTERVAL = 60
PRICE_CHECK_INTERVAL = 60
# Stoploss Update: Default 5 minutes (300 sec)
SL_UPDATE_INTERVAL = 300 
MAX_ENTRY_RETRIES = 3
RETRY_DELAY_SECONDS = 2

# 4. Entry Logic (Buffers)
# Min Buffer: Entry only if LTP < (ATP - Min%)
MIN_BUFFER_PERCENTAGE = 0.05  # 5%
# Max Buffer: Entry only if LTP > (ATP - Max%)
MAX_BUFFER_PERCENTAGE = 0.20  # 20%
SL_LIMIT_BUFFER = 5.0
MAX_DAILY_LOSS = 5000
DAILY_TARGET_PROFIT = 10000
MAX_RETRIES_PER_STRIKE = 3 
OI_STABILITY_REQUIRED = 2

# 5. Risk Management (The "Breathing" SL)
# Formula: SL = ATP + (ATP * SL_PERCENTAGE)
# THIS IS THE MISSING VARIABLE CAUSING YOUR ERROR 👇
SL_PERCENTAGE = 0.10

LOTS_MULTIPLIER = 1
# 6. Portfolio Limits
MAX_OPEN_POSITIONS = 2
BOT_TRADED_INDICES = ["NIFTY"]
COOLDOWN_SECONDS = 600
# ===== TRACE FOR PAPER_TRADING CHANGES =====
_paper_trading_value = True

def _get_paper():
    return _paper_trading_value

def _set_paper(new_value):
    global _paper_trading_value
    print(f"🕵️ TRACE: PAPER_TRADING is being changed from {_paper_trading_value} to {new_value}")
    import traceback
    traceback.print_stack()  # This shows WHO is changing it
    _paper_trading_value = new_value

# This makes 'PAPER_TRADING' act like a variable but calls our functions
import sys
sys.modules[__name__].PAPER_TRADING = property(_get_paper, _set_paper)
# ===== END OF TRACE =====
USE_DEMO_DATA = True  # Set to True for demo mode
import json, os

CONFIG_FILE = "last_strategy_config.json"

def save_config():
    data = {
        # EXISTING VARIABLES (keep all current ones)
        "START_TIME": START_TIME,
        "NO_NEW_ENTRY_TIME": NO_NEW_ENTRY_TIME,
        "SQUARE_OFF_TIME": SQUARE_OFF_TIME,
        "MIN_BUFFER_PERCENTAGE": MIN_BUFFER_PERCENTAGE,
        "MAX_BUFFER_PERCENTAGE": MAX_BUFFER_PERCENTAGE,
        "SL_PERCENTAGE": SL_PERCENTAGE,
        "SL_UPDATE_INTERVAL": SL_UPDATE_INTERVAL,
        "MAX_OPEN_POSITIONS": MAX_OPEN_POSITIONS,
        "LOTS_MULTIPLIER": LOTS_MULTIPLIER,
        "PAPER_TRADING": PAPER_TRADING,
        "USE_DEMO_DATA": USE_DEMO_DATA,
        
        "MAX_RETRIES_PER_STRIKE": MAX_RETRIES_PER_STRIKE,
        "COOLDOWN_SECONDS": COOLDOWN_SECONDS,
        "EXPIRY_OFFSET": EXPIRY_OFFSET,
        "OI_STABILITY_REQUIRED": OI_STABILITY_REQUIRED
    }

    with open(CONFIG_FILE, "w") as f:
        json.dump(data, f, indent=2)

# Update load_config() function:
def load_config():
    global START_TIME, NO_NEW_ENTRY_TIME, SQUARE_OFF_TIME
    global MIN_BUFFER_PERCENTAGE, MAX_BUFFER_PERCENTAGE
    global SL_PERCENTAGE, SL_UPDATE_INTERVAL
    global MAX_OPEN_POSITIONS, LOTS_MULTIPLIER
    global PAPER_TRADING, USE_DEMO_DATA
    global COOLDOWN_SECONDS, EXPIRY_OFFSET, OI_STABILITY_REQUIRED  # ADD THIS LINE
    global MAX_RETRIES_PER_STRIKE 
    if not os.path.exists(CONFIG_FILE):
        return

    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)

        # EXISTING VARIABLES (keep all current ones)
        START_TIME = data.get("START_TIME", START_TIME)
        NO_NEW_ENTRY_TIME = data.get("NO_NEW_ENTRY_TIME", NO_NEW_ENTRY_TIME)
        SQUARE_OFF_TIME = data.get("SQUARE_OFF_TIME", SQUARE_OFF_TIME)
        MIN_BUFFER_PERCENTAGE = data.get("MIN_BUFFER_PERCENTAGE", MIN_BUFFER_PERCENTAGE)
        MAX_BUFFER_PERCENTAGE = data.get("MAX_BUFFER_PERCENTAGE", MAX_BUFFER_PERCENTAGE)
        SL_PERCENTAGE = data.get("SL_PERCENTAGE", SL_PERCENTAGE)
        SL_UPDATE_INTERVAL = data.get("SL_UPDATE_INTERVAL", SL_UPDATE_INTERVAL)
        MAX_OPEN_POSITIONS = data.get("MAX_OPEN_POSITIONS", MAX_OPEN_POSITIONS)
        LOTS_MULTIPLIER = data.get("LOTS_MULTIPLIER", LOTS_MULTIPLIER)
        PAPER_TRADING = data.get("PAPER_TRADING", PAPER_TRADING)
        USE_DEMO_DATA = data.get("USE_DEMO_DATA", USE_DEMO_DATA)
        
        MAX_RETRIES_PER_STRIKE = data.get("MAX_RETRIES_PER_STRIKE", MAX_RETRIES_PER_STRIKE)
        COOLDOWN_SECONDS = data.get("COOLDOWN_SECONDS", COOLDOWN_SECONDS)
        EXPIRY_OFFSET = data.get("EXPIRY_OFFSET", EXPIRY_OFFSET)
        OI_STABILITY_REQUIRED = data.get("OI_STABILITY_REQUIRED", OI_STABILITY_REQUIRED)

    except Exception as e:
        print("⚠️ Config load failed, using defaults:", e)
CONFIG_FILE = "last_strategy_config.json"
import os
if os.path.exists(CONFIG_FILE):
    load_config()
