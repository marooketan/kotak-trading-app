# KOTAK API CONFIGURATION
import datetime
from typing import List, Dict

# Your Kotak API credentials
KOTAK_CONFIG = {
    "access_token": "c80a89d3-1ef2-4a2f-9900-82393343a824",
    "mobile_number": "+919227132381", 
    "client_code": "ZH329",
    "neo_fin_key": "neotradeapi"
}

# API Configuration
KOTAK_API_BASE_URL = "https://tradeapi.kotaksecurities.com/APIM/1.0"

# Market configuration
MARKET_INDICES = {
    "NFO": ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"],
    "BFO": ["SENSEX", "BANKEX"]
}

# Default settings
DEFAULT_MARKET = "NFO"
DEFAULT_INDEX = "NIFTY"
DEFAULT_STRIKE_COUNT = 25

def get_static_expiries() -> Dict[str, List[str]]:
    """Get static expiry dates as fallback when Kotak API is unavailable"""
    
    # Generate next 4 Thursdays (weekly expiries) and next 2 month-end Thursdays
    today = datetime.datetime.now()
    expiries = []
    
    # Add weekly expiries (next 4 Thursdays)
    for i in range(4):
        days_ahead = (3 - today.weekday() + 7) % 7 + (i * 7)  # Next Thursday + weekly
        expiry = today + datetime.timedelta(days=days_ahead)
        expiries.append(expiry.strftime("%d-%b-%Y"))
    
    # Add monthly expiries (next 2 month-end Thursdays)
    for i in range(2):
        if i == 0:
            # Last Thursday of current month
            next_month = today.replace(day=28) + datetime.timedelta(days=4)
            last_thursday = next_month - datetime.timedelta(days=(next_month.weekday() - 3) % 7)
        else:
            # Last Thursday of next month
            next_month = today.replace(day=28) + datetime.timedelta(days=32)
            next_month = next_month.replace(day=1)
            last_thursday = next_month.replace(day=28) + datetime.timedelta(days=4)
            last_thursday = last_thursday - datetime.timedelta(days=(last_thursday.weekday() - 3) % 7)
        
        expiry_str = last_thursday.strftime("%d-%b-%Y")
        if expiry_str not in expiries:
            expiries.append(expiry_str)
    
    return {
        "NFO": expiries,
        "BFO": expiries[:4]  # BSE typically has fewer expiries
    }