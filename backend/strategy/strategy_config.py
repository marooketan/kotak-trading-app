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
PRICE_CHECK_INTERVAL = 30
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