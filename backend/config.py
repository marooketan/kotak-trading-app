# KOTAK API CONFIGURATION - SIMPLE VERSION
KOTAK_CONFIG = {
    "access_token": "c80a89d3-1ef2-4a2f-9900-82393343a824",
    "mobile_number": "+919227132381", 
    "client_code": "ZH329"
}

# Market Indices
MARKET_INDICES = {
    "NFO": ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"],
    "BFO": ["SENSEX", "BANKEX"]
}
# Refresh Intervals (in milliseconds)
REFRESH_INTERVALS = {
    "option_chain": 5000,  # 5 seconds for option chain
    "index_prices": 30000,  # 30 seconds for index prices
    "order_status": 10000   # 10 seconds for order status
}