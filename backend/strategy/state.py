from enum import Enum

class StrategyState(Enum):
    # 1. Doing nothing, waiting for market open or start command
    IDLE = "IDLE"

    # 2. Scanning the market to find the Highest OI Strike
    SCANNING = "SCANNING"

    # 3. Found a strike, now watching if LTP is below ATP (Entry setup)
    WATCHING_ENTRY = "WATCHING_ENTRY"

    # 4. Signal found! Placing the order now
    PLACING_ORDER = "PLACING_ORDER"

    # 5. Trade is live! We are watching the Stoploss
    IN_TRADE = "IN_TRADE"

    # 6. Trade hit SL or Target. Waiting before next trade.
    COOLDOWN = "COOLDOWN"

    # 7. Max trades reached or manually stopped.
    STOPPED = "STOPPED"