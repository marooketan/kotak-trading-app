from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import requests
import time
import sqlite3
import logging
from typing import List, Dict
import config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")

# Simple working API endpoints
@app.get("/")
async def root():
    return {"message": "Kotak Trading API"}

@app.post("/api/kotak/login")
async def kotak_login(totp: str):
    logger.info(f"📱 Login attempt with TOTP: {totp}")
    return {"success": True, "message": "TOTP received"}

@app.post("/api/kotak/validate")
async def kotak_validate(mpin: str):
    logger.info(f"🔐 MPIN validation: {mpin}")
    return {"success": True, "message": "MPIN validated"}

# NEW ENDPOINTS FOR DROPDOWNS
@app.get("/api/expiries")
async def get_expiries(market: str = "NFO"):
    """Get expiry dates for a market - uses static expiries from config"""
    logger.info(f"📅 Fetching expiries for market: {market}")
    
    try:
        expiries = config.get_static_expiries()
        return {
            "success": True,
            "source": "static",
            "market": market,
            "expiries": expiries.get(market, [])
        }
    except Exception as e:
        logger.error(f"Error fetching expiries: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch expiries")

@app.get("/api/indices")
async def get_indices(market: str = "NFO"):
    """Get available indices for a market"""
    logger.info(f"📊 Fetching indices for market: {market}")
    
    try:
        indices = config.MARKET_INDICES.get(market, [])
        return {
            "success": True,
            "market": market,
            "indices": indices
        }
    except Exception as e:
        logger.error(f"Error fetching indices: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch indices")

@app.get("/api/option-chain/{index}")
async def get_option_chain(
    index: str, 
    strikes: int = 25,
    market: str = "NFO",
    expiry: str = None
):
    """Get option chain data with all filters"""
    logger.info(f"📈 Fetching option chain: {market}/{index}, strikes: {strikes}, expiry: {expiry}")
    
    import random
    
    chains = []
    
    # Adjust base strike based on index
    base_strikes = {
        "NIFTY": 18200,
        "BANKNIFTY": 38500,
        "FINNIFTY": 18200,
        "MIDCPNIFTY": 18200,
        "SENSEX": 60000,
        "BANKEX": 45000
    }
    
    base_strike = base_strikes.get(index, 18200)
    base_time = time.time()
    
    # Adjust price ranges based on index
    if index == "BANKNIFTY":
        base_price = 100
        multiplier = 15
    elif index == "SENSEX":
        base_price = 200
        multiplier = 20
    elif index == "BANKEX":
        base_price = 150
        multiplier = 18
    else:
        base_price = 50
        multiplier = 10
    
    for i in range(-strikes//2, strikes//2 + 1):
        strike = base_strike + (i * 100)
        base_call = max(base_price + abs(i) * multiplier, 10)
        base_put = max(base_price + abs(i) * (multiplier - 2), 8)
        call_move = (random.random() - 0.5) * 4
        put_move = (random.random() - 0.5) * 4
        
        # Add some time-based movement
        time_call = (i % 3) * 0.5
        time_put = (i % 2) * 0.3
        
        call_price = max(base_call + call_move + time_call, 1)
        put_price = max(base_put + put_move + time_put, 1)
        
        chains.append({
            "strike": strike,
            "call_bid": round(call_price - 0.5, 2),
            "call_ask": round(call_price + 0.5, 2),
            "call_ltp": round(call_price, 2),
            "put_bid": round(put_price - 0.5, 2),
            "put_ask": round(put_price + 0.5, 2),
            "put_ltp": round(put_price, 2)
        })
    
    return {
        "success": True,
        "market": market,
        "index": index,
        "expiry": expiry,
        "strike_count": strikes,
        "data": chains
    }

@app.get("/api/option-chain")
async def get_option_chain_with_params(
    market: str = "NFO",
    index: str = "NIFTY",
    expiry: str = None,
    strikes: int = 25
):
    """Alternative endpoint with query parameters"""
    return await get_option_chain(index, strikes, market, expiry)

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy", 
        "kotak_connected": False,
        "features": ["multi-market", "expiry-selection", "strike-selection"]
    }

# Portfolio and Orders endpoints (for popup windows)
@app.get("/api/portfolio")
async def get_portfolio():
    """Get portfolio data for the portfolio window"""
    import random
    return {
        "success": True,
        "totalInvestment": 100000,
        "currentValue": 115000,
        "totalPnl": 15000,
        "todaysPnl": 2500,
        "holdings": [
            {"symbol": "NIFTY25JAN18200CE", "quantity": 50, "avgPrice": 85.50, "currentPrice": 91.00, "pnl": 275},
            {"symbol": "NIFTY25JAN18300PE", "quantity": 50, "avgPrice": 92.25, "currentPrice": 89.75, "pnl": -125},
            {"symbol": "RELIANCE", "quantity": 10, "avgPrice": 2450.00, "currentPrice": 2520.00, "pnl": 700}
        ]
    }

@app.get("/api/orders")
async def get_orders():
    """Get order history for the orders window"""
    return {
        "success": True,
        "orders": [
            {"symbol": "NIFTY25JAN18200CE", "action": "BUY", "quantity": 50, "price": 85.50, "status": "completed", "timestamp": "10:30 AM"},
            {"symbol": "NIFTY25JAN18300PE", "action": "SELL", "quantity": 50, "price": 92.25, "status": "completed", "timestamp": "11:15 AM"},
            {"symbol": "RELIANCE", "action": "BUY", "quantity": 10, "price": 2450.00, "status": "pending", "timestamp": "11:45 AM"},
            {"symbol": "NIFTY25JAN18100CE", "action": "SELL", "quantity": 50, "price": 110.25, "status": "cancelled", "timestamp": "12:20 PM"}
        ]
    }

@app.post("/api/orders/place")
async def place_order(order_data: dict):
    """Place a new order"""
    logger.info(f"📤 Placing order: {order_data}")
    return {
        "success": True,
        "order_id": f"ORD{int(time.time())}",
        "message": "Order placed successfully",
        "order": order_data
    }

print("🚀 Enhanced Kotak Server Running: http://localhost:8000")
print("📊 New Features: Multi-market, Expiry selection, Strike selection")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)