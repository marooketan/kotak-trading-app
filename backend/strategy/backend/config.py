# KOTAK API CONFIGURATION - MULTI-USER
USERS = {
    "ketan": {
        "access_token": "c80a89d3-1ef2-4a2f-9900-82393343a824",
        "mobile_number": "+919227132381", 
        "client_code": "ZH329"
    },
    "kavita": {
        "access_token": "faab5107-d347-4f9f-a585-6fe32ad6c792",
        "mobile_number": "+919227132387", 
        "client_code": "X1N35"
    }
}

# Market Indices
MARKET_INDICES = {
    "NFO": ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"],
    "BFO": ["SENSEX", "BANKEX"]
}

# Refresh Intervals (in milliseconds)
REFRESH_INTERVALS = {
    "option_chain": 5000,
    "index_prices": 30000,
    "order_status": 10000 
}