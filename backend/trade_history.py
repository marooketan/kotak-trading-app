import json
import time
import os
from datetime import datetime, timedelta

FILE_PATH = "trade_history.json"


def save_trade_to_history(trade_dict):
    """
    trade_dict must be a plain dict with exit details.
    This function is SAFE:
    - Works for PAPER + LIVE
    - Auto-cleans old trades
    - Never raises error to caller
    """
    try:
        if not os.path.exists(FILE_PATH):
            return  # silently skip

        with open(FILE_PATH, "r") as f:
            data = json.load(f)

        retention_days = data.get("retention_days", 3)
        trades = data.get("trades", [])

        now = datetime.now()
        cutoff = now - timedelta(days=retention_days)

        # Keep only recent trades
        cleaned_trades = []
        for t in trades:
            try:
                t_time = datetime.fromtimestamp(t.get("exit_time", 0))
                if t_time >= cutoff:
                    cleaned_trades.append(t)
            except:
                pass

        # Add new trade
        cleaned_trades.append(trade_dict)

        # Save back
        data["trades"] = cleaned_trades

        with open(FILE_PATH, "w") as f:
            json.dump(data, f, indent=2)

    except Exception as e:
        # NEVER break trading for logging
        print(f"⚠️ Trade history save failed: {e}")
