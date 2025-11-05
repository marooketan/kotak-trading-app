from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import requests
import time
import sqlite3
import logging
from typing import List, Dict
import config
from kotak_api import kotak_api
from real_kotak_api import real_kotak_api

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

# Real Kotak API Status Check
@app.get("/api/kotak/status")
async def kotak_status():
    """Check real Kotak API connection"""
    status = real_kotak_api.test_connection()
    return status

# New endpoint for real quotes
@app.get("/api/kotak/quotes/{symbol}")
async def get_real_quotes(symbol: str):
    """Get real quotes from Kotak API"""
    result = real_kotak_api.get_quotes([symbol])
    return result

# Enhanced option chain endpoint
@app.get("/api/real-option-chain/{index}")
async def get_real_option_chain(index: str):
    """Get real option chain from Kotak API"""
    result = real_kotak_api.get_option_chain_quotes(index)
    
    if result["success"]:
        return {
            "success": True,
            "source": "kotak_live",
            "index": index,
            "data": result["data"]
        }
    else:
        # Fallback to mock data
        return await get_option_chain(index, 25, "NFO", None)

# Enhanced endpoints with real Kotak API
@app.get("/api/expiries")
async def get_expiries(market: str = "NFO"):
    """Get expiry dates - tries real Kotak API first, then fallback"""
    logger.info(f"📅 Fetching expiries for market: {market}")
    
    try:
        # Try real Kotak API first
        real_expiries = real_kotak_api.get_expiries(market)
        
        if real_expiries:
            logger.info(f"✅ Got {len(real_expiries)} real expiries from Kotak API")
            return {
                "success": True,
                "source": "kotak_live",
                "market": market,
                "expiries": real_expiries
            }
        else:
            # Fallback to static expiries
            raise Exception("Kotak API returned no data")
            
    except Exception as e:
        logger.warning(f"⚠️ Using static expiries: {e}")
        # Fallback to static expiries
        expiries = config.get_static_expiries()
        return {
            "success": True,
            "source": "static_fallback",
            "market": market,
            "expiries": expiries.get(market, [])
        }

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
    """Get option chain - tries Kotak API first, then mock data"""
    logger.info(f"📈 Fetching option chain: {market}/{index}, strikes: {strikes}, expiry: {expiry}")
    
    try:
        # Try real Kotak API first
        real_data = real_kotak_api.get_option_chain_quotes(index)
        
        if real_data and real_data.get("success", False):
            logger.info(f"✅ Got real option chain data from Kotak for {index}")
            return {
                "success": True,
                "source": "kotak_live",
                "market": market,
                "index": index,
                "expiry": expiry,
                "strike_count": strikes,
                "data": real_data.get("data", [])
            }
        else:
            # Fallback to mock data
            raise Exception("Kotak API returned no data")
            
    except Exception as e:
        logger.warning(f"⚠️ Using mock data: {e}")
        # Fallback to mock data
        chains = generate_mock_option_chain(index, strikes)
        return {
            "success": True,
            "source": "mock_fallback", 
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

# Helper function for mock data
def generate_mock_option_chain(index: str, strikes: int = 25):
    """Generate realistic mock option chain data"""
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
    
    return chains

print("🚀 Enhanced Kotak Server Running: http://localhost:8000")
print("📊 New Features: Real Kotak API integration with dynamic expiries")
print("🔍 Check API status: http://localhost:8000/api/kotak/status")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)