# main.py - COMPLETE UPDATED VERSION
import os
import json
import logging
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import pyotp
import requests
from datetime import datetime
from typing import Dict, List
import time

# Import your configuration
from config import KOTAK_CONFIG, KOTAK_API_BASE_URL, KOTAK_API_ENDPOINTS, get_static_expiries, MARKET_INDICES

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class KotakAPI:
    """Kotak Securities API wrapper for authentication and trading"""
    
    def __init__(self, access_token, mobile_number, client_code, neo_fin_key="neotradeapi"):
        self.access_token = access_token
        self.mobile_number = mobile_number
        self.client_code = client_code
        self.neo_fin_key = neo_fin_key
        
        self.session_token = None
        self.session_sid = None
        self.base_url = None
        self.is_authenticated = False
        
        logger.info(f"✅ KotakAPI initialized for client: {client_code}")
    
    def login_with_totp(self, totp_secret):
        """Step 1: Login with TOTP to get view token and session SID"""
        try:
            totp = pyotp.TOTP(totp_secret)
            totp_code = totp.now()
            
            headers = {
                "Authorization": self.access_token,
                "neo-fin-key": self.neo_fin_key,
                "Content-Type": "application/json"
            }
            
            payload = {
                "mobileNumber": self.mobile_number,
                "ucc": self.client_code,
                "totp": totp_code
            }
            
            response = requests.post(
                KOTAK_API_ENDPOINTS["login"],
                headers=headers,
                json=payload,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "success":
                    logger.info("✅ TOTP Login successful")
                    return data.get("data", {})
                else:
                    logger.error(f"❌ Login failed: {data.get('message')}")
                    return None
            else:
                logger.error(f"❌ Login error: {response.status_code} - {response.text}")
                return None
                
        except Exception as e:
            logger.error(f"❌ TOTP Login exception: {str(e)}")
            return None
    
    def validate_mpin(self, view_token, view_sid, mpin):
        """Step 2: Validate MPIN to get session token and trade token"""
        try:
            headers = {
                "Authorization": self.access_token,
                "neo-fin-key": self.neo_fin_key,
                "sid": view_sid,
                "Auth": view_token,
                "Content-Type": "application/json"
            }
            
            payload = {
                "mpin": mpin
            }
            
            response = requests.post(
                KOTAK_API_ENDPOINTS["validate"],
                headers=headers,
                json=payload,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "success":
                    response_data = data.get("data", {})
                    self.session_token = response_data.get("token")
                    self.session_sid = response_data.get("sid")
                    self.base_url = response_data.get("baseUrl")
                    self.is_authenticated = True
                    
                    logger.info("✅ MPIN validation successful")
                    logger.info(f"📋 Session established. Base URL: {self.base_url}")
                    return response_data
                else:
                    logger.error(f"❌ MPIN validation failed: {data.get('message')}")
                    return None
            else:
                logger.error(f"❌ MPIN validation error: {response.status_code}")
                return None
                
        except Exception as e:
            logger.error(f"❌ MPIN validation exception: {str(e)}")
            return None
    
    def get_headers(self):
        """Get standard headers for authenticated API requests"""
        return {
            "Authorization": self.access_token,
            "Auth": self.session_token,
            "Sid": self.session_sid,
            "neo-fin-key": self.neo_fin_key,
            "Content-Type": "application/json"
        }
    
    def check_authentication(self):
        """Check if the API is authenticated"""
        return self.is_authenticated


# Global API instance and caching
kotak_api = None
cache = {
    "option_chain": {},
    "expiries": {},
    "scrip_master": {},
    "last_update": {}
}

CACHE_DURATION = 1  # seconds


def is_cache_valid(key: str) -> bool:
    """Check if cache is still valid"""
    if key not in cache["last_update"]:
        return False
    return (time.time() - cache["last_update"][key]) < CACHE_DURATION


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown"""
    global kotak_api
    
    logger.info("✅ Configuration loaded successfully")
    logger.info(f"📋 Config loaded for user: {KOTAK_CONFIG['client_code']}")
    
    kotak_api = KotakAPI(
        access_token=KOTAK_CONFIG["access_token"],
        mobile_number=KOTAK_CONFIG["mobile_number"],
        client_code=KOTAK_CONFIG["client_code"],
        neo_fin_key=KOTAK_CONFIG.get("neo_fin_key", "neotradeapi")
    )
    logger.info("✅ KotakAPI initialized successfully")
    
    yield
    logger.info("🛑 Shutting down Kotak Trading API Server...")


app = FastAPI(
    title="Kotak Trading API",
    description="Kotak Securities Trading API Wrapper",
    lifespan=lifespan
)

# Mount frontend BEFORE any other routes
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_path):
    logger.info(f"✅ Frontend mounted from: {frontend_path}")
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
else:
    logger.error(f"❌ Frontend path not found: {frontend_path}")


# ==================== API ENDPOINTS ====================

@app.get("/api/status")
async def get_status():
    """Check API status and authentication"""
    global kotak_api
    
    return {
        "status": "running",
        "authenticated": kotak_api.check_authentication() if kotak_api else False,
        "user": KOTAK_CONFIG.get("client_code"),
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/config")
async def get_config():
    """Get configuration (without sensitive data)"""
    return {
        "user": KOTAK_CONFIG.get("client_code"),
        "mobile": KOTAK_CONFIG.get("mobile_number", "****"),
        "api_base_url": KOTAK_API_BASE_URL,
        "expiries": get_static_expiries()
    }


@app.post("/api/login")
async def login(totp_secret: str, mpin: str):
    """Login endpoint for authentication"""
    global kotak_api
    
    if not kotak_api:
        return {"status": "error", "message": "API not initialized"}
    
    # Step 1: Login with TOTP
    view_data = kotak_api.login_with_totp(totp_secret)
    if not view_data:
        return {"status": "error", "message": "TOTP login failed"}
    
    # Step 2: Validate MPIN
    session_data = kotak_api.validate_mpin(
        view_data.get("token"),
        view_data.get("sid"),
        mpin
    )
    
    if session_data:
        logger.info("✅ User successfully authenticated with Kotak")
        return {
            "status": "success",
            "message": "Authentication successful",
            "user": KOTAK_CONFIG.get("client_code"),
            "authenticated": True
        }
    else:
        return {"status": "error", "message": "MPIN validation failed"}


@app.get("/api/indices")
async def get_indices(market: str = "NFO"):
    """Get available indices for market"""
    indices = MARKET_INDICES.get(market, MARKET_INDICES["NFO"])
    return {
        "success": True,
        "indices": indices
    }


@app.get("/api/expiries")
async def get_expiries(market: str = "NFO"):
    """Fetch expiries from Kotak API with caching"""
    global kotak_api, cache
    
    cache_key = f"expiries_{market}"
    
    # Return cached data if valid
    if is_cache_valid(cache_key) and cache_key in cache["expiries"]:
        logger.info(f"📦 Returning cached expiries for {market}")
        return {
            "success": True,
            "expiries": cache["expiries"][cache_key]
        }
    
    if not kotak_api or not kotak_api.is_authenticated:
        logger.warning("⚠️ Not authenticated, using fallback expiries")
        expiries_data = get_static_expiries()
        return {
            "success": True,
            "expiries": expiries_data.get(market, [])
        }
    
    try:
        headers = kotak_api.get_headers()
        
        # Kotak API endpoint for expiries
        url = f"{kotak_api.base_url}/instruments/expirylist?market={market}"
        
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == "success":
                expiries = data.get("data", {}).get("expirylist", [])
                
                # Cache the result
                cache["expiries"][cache_key] = expiries
                cache["last_update"][cache_key] = time.time()
                
                logger.info(f"✅ Fetched {len(expiries)} expiries from Kotak for {market}")
                return {"success": True, "expiries": expiries}
    
    except Exception as e:
        logger.error(f"❌ Failed to fetch expiries: {str(e)}")
    
    # Fallback to static expiries
    logger.warning(f"⚠️ Falling back to static expiries for {market}")
    expiries_data = get_static_expiries()
    return {
        "success": True,
        "expiries": expiries_data.get(market, [])
    }


@app.get("/api/scrip-lookup")
async def scrip_lookup(query: str):
    """Lookup scrip/token from Kotak scrip master"""
    global kotak_api, cache
    
    cache_key = f"scrip_{query}"
    
    # Return cached token if valid
    if is_cache_valid(cache_key) and cache_key in cache["scrip_master"]:
        logger.info(f"📦 Returning cached scrip token for {query}")
        return {
            "success": True,
            "data": cache["scrip_master"][cache_key]
        }
    
    if not kotak_api or not kotak_api.is_authenticated:
        logger.warning("⚠️ Not authenticated, cannot lookup scrip")
        return {"success": False, "message": "Not authenticated"}
    
    try:
        headers = kotak_api.get_headers()
        
        # Kotak API for scrip lookup
        url = f"{kotak_api.base_url}/instruments/search?query={query}"
        
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == "success":
                scrip_data = data.get("data", {})
                
                # Cache the result
                cache["scrip_master"][cache_key] = scrip_data
                cache["last_update"][cache_key] = time.time()
                
                logger.info(f"✅ Found scrip: {query}")
                return {"success": True, "data": scrip_data}
    
    except Exception as e:
        logger.error(f"❌ Failed to lookup scrip: {str(e)}")
    
    return {"success": False, "message": "Scrip not found"}


@app.get("/api/option-chain")
async def get_option_chain(market: str, index: str, expiry: str, strikes: str = "25"):
    """Fetch live option chain from Kotak API with 1-second caching"""
    global kotak_api, cache
    
    cache_key = f"option_chain_{market}_{index}_{expiry}_{strikes}"
    
    # Return cached data if valid (1 second cache)
    if is_cache_valid(cache_key) and cache_key in cache["option_chain"]:
        logger.debug(f"📦 Returning cached option chain: {index}")
        return {
            "success": True,
            "data": cache["option_chain"][cache_key],
            "cached": True,
            "timestamp": datetime.now().isoformat()
        }
    
    if not kotak_api or not kotak_api.is_authenticated:
        logger.warning("⚠️ Not authenticated, cannot fetch option chain")
        return {
            "success": False,
            "message": "Not authenticated with Kotak"
        }
    
    try:
        headers = kotak_api.get_headers()
        
        # Build symbol for Kotak API (e.g., NIFTY25JAN18200CE)
        symbol = f"{index}{expiry.replace('-', '')}@{market}|NIFTY"
        
        # Kotak option chain endpoint
        url = f"{kotak_api.base_url}/option-chain?symbol={symbol}"
        
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == "success":
                chain_data = data.get("data", [])
                
                # Filter by strike count if needed
                if strikes != "all":
                    try:
                        limit = int(strikes)
                        chain_data = chain_data[:limit]
                    except ValueError:
                        pass
                
                # Cache the result
                cache["option_chain"][cache_key] = chain_data
                cache["last_update"][cache_key] = time.time()
                
                logger.info(f"✅ Fetched option chain: {index} ({len(chain_data)} strikes)")
                return {
                    "success": True,
                    "data": chain_data,
                    "cached": False,
                    "timestamp": datetime.now().isoformat()
                }
    
    except Exception as e:
        logger.error(f"❌ Failed to fetch option chain: {str(e)}")
    
    return {
        "success": False,
        "message": "Failed to fetch option chain"
    }


@app.get("/api/quote")
async def get_quote(symbol: str):
    """Get live quote for a symbol"""
    global kotak_api
    
    if not kotak_api or not kotak_api.is_authenticated:
        return {"success": False, "message": "Not authenticated"}
    
    try:
        headers = kotak_api.get_headers()
        
        # Kotak quotes endpoint
        url = f"{kotak_api.base_url}/quotes/{symbol}"
        
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == "success":
                return {
                    "success": True,
                    "data": data.get("data", {}),
                    "timestamp": datetime.now().isoformat()
                }
    
    except Exception as e:
        logger.error(f"❌ Failed to fetch quote: {str(e)}")
    
    return {"success": False, "message": "Failed to fetch quote"}


if __name__ == "__main__":
    import uvicorn
    
    logger.info("🚀 Starting Kotak Trading API Server...")
    logger.info(f"📊 Live mode - fetching real data from Kotak")
    logger.info(f"⚡ Auto-update every 1 second with caching")
    logger.info(f"🌐 Server running at: http://localhost:8000")
    logger.info(f"📚 API documentation at: http://localhost:8000/docs")
    
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
