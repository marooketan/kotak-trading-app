# ==========================================
# STRATEGY SETTINGS (The Rulebook)
# ==========================================

# 1. Instrument
SYMBOL = "NIFTY"
EXPIRY_OFFSET = 0 

# 2. Time Settings (Operating Hours)
# Format: "HH:MM" (24-hour format)
START_TIME = "09:15"
NO_NEW_ENTRY_TIME = "14:00"
SQUARE_OFF_TIME = "15:15"

# 3. Loop Speeds (Seconds)
OI_CHECK_INTERVAL = 60
PRICE_CHECK_INTERVAL = 10
# Stoploss Update: Default 5 minutes (300 sec)
SL_UPDATE_INTERVAL = 300 

# 4. Entry Logic (Buffers)
# Min Buffer: Entry only if LTP < (ATP - Min%)
MIN_BUFFER_PERCENTAGE = 0.05  # 5%
# Max Buffer: Entry only if LTP > (ATP - Max%)
MAX_BUFFER_PERCENTAGE = 0.20  # 20%

OI_STABILITY_REQUIRED = 2

# 5. Risk Management (The "Breathing" SL)
# Formula: SL = ATP + (ATP * SL_PERCENTAGE)
# THIS IS THE MISSING VARIABLE CAUSING YOUR ERROR 👇
SL_PERCENTAGE = 0.10
LOTS_MULTIPLIER = 1
# 6. Portfolio Limits
MAX_OPEN_POSITIONS = 2
COOLDOWN_SECONDS = 900
PAPER_TRADING = True
USE_DEMO_DATA = True  # Set to True for demo mode
import json, os

CONFIG_FILE = "last_strategy_config.json"

def save_config():
    data = {
        # ONLY UI VALUES
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
    }

    with open(CONFIG_FILE, "w") as f:
        json.dump(data, f, indent=2)
def load_config():
    global START_TIME, NO_NEW_ENTRY_TIME, SQUARE_OFF_TIME
    global MIN_BUFFER_PERCENTAGE, MAX_BUFFER_PERCENTAGE
    global SL_PERCENTAGE, SL_UPDATE_INTERVAL
    global MAX_OPEN_POSITIONS, LOTS_MULTIPLIER
    global PAPER_TRADING, USE_DEMO_DATA

    if not os.path.exists(CONFIG_FILE):
        return

    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)

        # ONLY UI-CONTROLLED VALUES
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

    except Exception as e:
        print("⚠️ Config load failed, using defaults:", e)
