from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import sys
import os
from typing import Optional

# Add the current directory to Python path to import local modules
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)

app = FastAPI(title="Kotak Trading API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import your configuration
try:
    import config
    print("✅ Configuration loaded successfully")
    
    # Extract credentials from your config structure
    KOTAK_CONFIG = getattr(config, 'KOTAK_CONFIG', {})
    API_KEY = KOTAK_CONFIG.get("access_token", "default_access_token")
    CONSUMER_SECRET = KOTAK_CONFIG.get("neo_fin_key", "default_consumer_secret") 
    USER_ID = KOTAK_CONFIG.get("client_code", "default_user_id")
    
    # For KotakAPI class, we need ACCESS_TOKEN as well
    ACCESS_TOKEN = KOTAK_CONFIG.get("access_token", "default_access_token")
    
    print(f"📋 Config loaded for user: {USER_ID}")
    
except ImportError as e:
    print(f"❌ Error loading config: {e}")
    # Fallback configuration
    API_KEY = "default_api_key"
    CONSUMER_SECRET = "default_consumer_secret"
    ACCESS_TOKEN = "default_access_token" 
    USER_ID = "default_user_id"

# Initialize API client only if kotak_api exists
kotak_api = None
try:
    from kotak_api import KotakAPI
    kotak_api = KotakAPI(
        api_key=API_KEY,
        consumer_secret=CONSUMER_SECRET,
        access_token=ACCESS_TOKEN,
        user_id=USER_ID
    )
    print("✅ KotakAPI initialized successfully")
except ImportError as e:
    print(f"⚠️ KotakAPI not available: {e}")
except Exception as e:
    print(f"⚠️ KotakAPI initialization failed: {e}")

# =============================================================================
# 1. DEFINE ALL API ROUTES FIRST (THIS IS CRITICAL FOR ROUTE PRIORITY)
# =============================================================================

@app.get("/")
async def root():
    return {"message": "Kotak Neo Trading API - Development Mode"}

@app.get("/api/kotak/status")
async def kotak_status():
    """Check if Kotak API is connected and working"""
    if kotak_api is None:
        return {
            "status": "development",
            "message": "Kotak API not configured - running in development mode",
            "config": {
                "user_id": USER_ID,
                "has_access_token": bool(ACCESS_TOKEN and ACCESS_TOKEN != "default_access_token")
            }
        }
    
    try:
        response = kotak_api.get_limits()
        return {
            "status": "connected",
            "message": "Kotak API is working",
            "data": response
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kotak API error: {str(e)}")

@app.get("/api/expiries")
async def get_expiries():
    """Get available expiry dates"""
    try:
        # Use static expiries from config as fallback
        if hasattr(config, 'get_static_expiries'):
            expiries = config.get_static_expiries()
            return {"expiries": expiries.get("NFO", [])}
        else:
            # Fallback static expiries
            sample_expiries = ["26-Dec-2024", "02-Jan-2025", "09-Jan-2025", "16-Jan-2025"]
            return {"expiries": sample_expiries}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/option-chain")
async def get_option_chain(symbol: str = "NIFTY", expiry: str = None):
    """Get option chain data"""
    try:
        # Use your config's default values
        default_symbol = getattr(config, 'DEFAULT_INDEX', 'NIFTY')
        symbol = symbol or default_symbol
        
        # Return enhanced sample option chain data
        spot_price = 21500.50
        strike_count = getattr(config, 'DEFAULT_STRIKE_COUNT', 10)
        
        # Generate strikes around spot price
        base_strike = int(spot_price / 100) * 100  # Round to nearest 100
        strikes = [base_strike + (i * 100) for i in range(-strike_count//2, strike_count//2 + 1)]
        
        call_options = []
        put_options = []
        
        for strike in strikes:
            # Calculate realistic premiums based on distance from spot
            distance = abs(strike - spot_price)
            if strike <= spot_price:
                call_premium = max(50, distance * 0.1)
                put_premium = max(20, (spot_price - strike) * 0.8)
            else:
                call_premium = max(20, (strike - spot_price) * 0.8)
                put_premium = max(50, distance * 0.1)
            
            call_options.append({
                "strike": strike,
                "oi": max(1000, 10000 - abs(strike - spot_price) * 10),
                "volume": max(100, 1000 - abs(strike - spot_price)),
                "premium": round(call_premium, 2),
                "change": round(call_premium * 0.02, 2)
            })
            
            put_options.append({
                "strike": strike,
                "oi": max(1000, 10000 - abs(strike - spot_price) * 10),
                "volume": max(100, 1000 - abs(strike - spot_price)),
                "premium": round(put_premium, 2),
                "change": round(put_premium * 0.02, 2)
            })
        
        sample_data = {
            "symbol": symbol,
            "expiry": expiry or "26-Dec-2024",
            "timestamp": "2024-12-19 10:00:00",
            "spot_price": spot_price,
            "underlying": f"{symbol} INDEX",
            "call_options": call_options,
            "put_options": put_options
        }
        return sample_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/market/indices")
async def get_market_indices():
    """Get available market indices from config"""
    try:
        if hasattr(config, 'MARKET_INDICES'):
            return {"indices": config.MARKET_INDICES}
        else:
            return {
                "indices": {
                    "NFO": ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"],
                    "BFO": ["SENSEX", "BANKEX"]
                }
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Basic API routes that work without Kotak API
@app.get("/api/instruments")
async def get_instruments(exchange: str = "NSE", segment: str = "EQ"):
    """Get available instruments"""
    if kotak_api is None:
        return {
            "instruments": [
                {"symbol": "RELIANCE", "token": "12345", "lot_size": 1},
                {"symbol": "TCS", "token": "12346", "lot_size": 1},
                {"symbol": "INFY", "token": "12347", "lot_size": 1}
            ],
            "message": "Running in development mode"
        }
    
    try:
        instruments = kotak_api.instrument_master(exchange, segment)
        return {"instruments": instruments}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/limits")
async def get_limits():
    """Get trading limits"""
    if kotak_api is None:
        return {
            "limits": {
                "available_cash": 150000,
                "utilized_margin": 25000,
                "available_margin": 125000
            },
            "message": "Running in development mode"
        }
    
    try:
        limits = kotak_api.get_limits()
        return {"limits": limits}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Development mode routes - return sample data
@app.get("/api/orders")
async def get_orders():
    """Get order book - development version"""
    sample_orders = [
        {
            "order_id": "12345", 
            "symbol": "NIFTY25DEC21400CE", 
            "quantity": 50, 
            "status": "COMPLETED",
            "transaction_type": "BUY",
            "price": 150.25
        },
        {
            "order_id": "12346", 
            "symbol": "BANKNIFTY25DEC48000PE", 
            "quantity": 25, 
            "status": "PENDING",
            "transaction_type": "SELL", 
            "price": 85.50
        }
    ]
    return {"orders": sample_orders, "message": "Development mode"}

@app.get("/api/positions")
async def get_positions():
    """Get current positions - development version"""
    sample_positions = [
        {
            "symbol": "NIFTY25DEC21400CE",
            "quantity": 50,
            "average_price": 150.25,
            "current_price": 145.75,
            "pnl": -225.0
        },
        {
            "symbol": "BANKNIFTY25DEC48000PE", 
            "quantity": 25,
            "average_price": 85.50,
            "current_price": 92.25, 
            "pnl": 168.75
        }
    ]
    return {"positions": sample_positions, "message": "Development mode"}

@app.get("/api/holdings")
async def get_holdings():
    """Get portfolio holdings - development version"""
    sample_holdings = [
        {"symbol": "RELIANCE", "quantity": 25, "average_price": 2420.25, "current_price": 2450.50},
        {"symbol": "INFY", "quantity": 15, "average_price": 1650.50, "current_price": 1675.25}
    ]
    return {"holdings": sample_holdings, "message": "Development mode"}

@app.get("/api/margins")
async def get_margins():
    """Get margin information - development version"""
    sample_margins = {
        "equity": {
            "available": 150000, 
            "utilized": 25000,
            "available_for_trading": 125000
        },
        "derivatives": {
            "available": 200000,
            "utilized": 75000, 
            "available_for_trading": 125000
        }
    }
    return {"margins": sample_margins, "message": "Development mode"}

# =============================================================================
# 2. MOUNT STATIC FILES LAST (as fallback for frontend routes)
# =============================================================================

# Fix the path to frontend - use absolute path
frontend_path = os.path.join(os.path.dirname(current_dir), "frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
    print(f"✅ Frontend mounted from: {frontend_path}")
else:
    print(f"⚠️ Frontend directory not found at {frontend_path}")

if __name__ == "__main__":
    print("🚀 Starting Kotak Trading API Server...")
    print(f"📋 User ID: {USER_ID}")
    print("📊 Development mode - using sample data")
    print("🌐 Server running at: http://localhost:8000")
    print("📚 API documentation at: http://localhost:8000/docs")
    print("💡 Add your real Kotak API credentials in config.py for live data")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )