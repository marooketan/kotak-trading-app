# ==========================================
# STRATEGY SETTINGS (The Rulebook)
# ==========================================

# 1. Instrument Details
SYMBOL = "NIFTY"
EXPIRY_OFFSET = 0  # 0 = Current Week, 1 = Next Week

# 2. Time Settings (in seconds)
# How often to check Open Interest (Entry Scan)
OI_CHECK_INTERVAL = 180  # 3 minutes

# How often to check Price (Entry Trigger)
PRICE_CHECK_INTERVAL = 60  # 1 minute

# How often to recalculate the "Breathing" Stoploss?
# (You requested: can be 1 min, 2 min, 5 min, etc.)
SL_UPDATE_INTERVAL = 60  # 60 seconds = 1 minute

# 3. Entry Rules
OI_STABILITY_REQUIRED = 2

# 4. Risk Management (The "Breathing" SL)
# SL = Entry Price + (Current ATP * SL_PERCENTAGE)
# Example: 0.10 means 10% of ATP
SL_PERCENTAGE = 0.10

# 5. Portfolio Limits
# How many open trades allowed PER SIDE at the same time?
MAX_OPEN_POSITIONS = 2  # e.g., Max 2 CE and Max 2 PE allowed

# 6. Cooldown Logic
# If SL hits, how many seconds to ban that strike?
# 900 seconds = 15 minutes
COOLDOWN_SECONDS = 900

# 7. Safety Switch
PAPER_TRADING = True