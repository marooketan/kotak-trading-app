# main.py - COMPLETE FIXED VERSION
import os
import json
import logging
from fastapi import FastAPI, HTTPException, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import requests
from datetime import datetime
import time
import pandas as pd
from typing import Dict, List, Optional

# Import your configuration
from config import KOTAK_CONFIG, MARKET_INDICES

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class FixedKotakAPI:
    def __init__(self):
        self.access_token = KOTAK_CONFIG["access_token"]
        self.mobile = KOTAK_CONFIG["mobile_number"]
        self.client_code = KOTAK_CONFIG["client_code"]
        self.session_data = {
            "base_url": "https://mis.kotaksecurities.com",
            "token": None,
            "sid": None,
            "authenticated": False
        }
    
    def login(self, totp_code: str, mpin: str) -> Dict:
        """Login with TOTP and MPIN - USING OUR WORKING SOLUTION"""
        try:
            logger.info("🔄 Starting Kotak authentication...")
            
            # Step 1: TOTP Login
            login_url = "https://mis.kotaksecurities.com/login/1.0/tradeApiLogin"
            headers = {
                "Authorization": self.access_token,
                "neo-fin-key": "neotradeapi", 
                "Content-Type": "application/json"
            }
            
            login_payload = {
                "mobileNumber": self.mobile,
                "ucc": self.client_code, 
                "totp": totp_code
            }
            
            logger.info("📡 Sending TOTP request...")
            r1 = requests.post(login_url, json=login_payload, headers=headers, timeout=10)
            if r1.status_code != 200:
                logger.error(f"❌ TOTP failed: {r1.status_code} - {r1.text}")
                return {"success": False, "message": f"TOTP login failed: {r1.status_code}"}
                
            login_data = r1.json()
            if "data" not in login_data:
                logger.error(f"❌ TOTP response error: {login_data}")
                return {"success": False, "message": "Invalid TOTP response"}
            
            view_token = login_data["data"]["token"]
            view_sid = login_data["data"]["sid"]
            logger.info("✅ TOTP login successful")
            
            # Step 2: MPIN Validation
            validate_url = "https://mis.kotaksecurities.com/login/1.0/tradeApiValidate"
            validate_headers = headers.copy()
            validate_headers.update({"sid": view_sid, "Auth": view_token})
            
            validate_payload = {"mpin": mpin}
            logger.info("📡 Sending MPIN request...")
            r2 = requests.post(validate_url, json=validate_payload, headers=validate_headers, timeout=10)
            if r2.status_code != 200:
                logger.error(f"❌ MPIN failed: {r2.status_code} - {r2.text}")
                return {"success": False, "message": f"MPIN validation failed: {r2.status_code}"}
            
            validate_data = r2.json()
            if "data" not in validate_data:
                logger.error(f"❌ MPIN response error: {validate_data}")
                return {"success": False, "message": "Invalid MPIN response"}
            
            self.session_data["base_url"] = validate_data["data"].get("baseUrl", self.session_data["base_url"])
            self.session_data["token"] = validate_data["data"]["token"]
            self.session_data["sid"] = validate_data["data"]["sid"]
            self.session_data["authenticated"] = True
            
            logger.info("✅ MPIN validation successful")
            logger.info(f"📋 Session established. Base URL: {self.session_data['base_url']}")
            
            return {
                "success": True, 
                "message": "Authentication successful",
                "user": self.client_code
            }
            
        except Exception as e:
            logger.error(f"❌ Login error: {str(e)}")
            return {"success": False, "message": f"Login failed: {str(e)}"}
    
    def get_headers(self):
        """Get authenticated headers"""
        return {
            "Authorization": self.access_token,
            "Auth": self.session_data["token"],
            "Sid": self.session_data["sid"],
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/json"
        }
    
    def is_authenticated(self):
        """Check if authenticated"""
        return self.session_data["authenticated"]
    
    def get_expiries(self, index: str = "BANKNIFTY") -> List[str]:
        """Get expiry dates from master file"""
        try:
            master_path = r"C:\Users\Ketan\Desktop\kotak_master.csv"
            if not os.path.exists(master_path):
                logger.warning("❌ Master file not found, using fallback expiries")
                return self._get_fallback_expiries()
            
            df = pd.read_csv(master_path)
            df.columns = df.columns.str.strip()
            
            # Filter for the index
            df = df[df['pSymbolName'] == index]
            
            # Extract unique expiry dates
            if 'lExpiryDate' in df.columns:
                # Convert timestamp to date
                df['expiry_date'] = pd.to_datetime(df['lExpiryDate'], unit='s').dt.strftime('%d-%b-%Y')
                expiries = df['expiry_date'].unique().tolist()
            else:
                # Try to extract from trading symbol
                expiries = []
                for symbol in df['pTrdSymbol'].dropna():
                    try:
                        # Extract date part from symbols like "BANKNIFTY25NOV59000CE"
                        if 'NOV' in symbol:
                            expiries.append("25-Nov-2025")
                        elif 'DEC' in symbol:
                            expiries.append("25-Dec-2025")
                    except:
                        continue
                expiries = list(set(expiries))
            
            expiries.sort()
            logger.info(f"✅ Found {len(expiries)} expiries for {index}")
            return expiries[:6]  # Return next 6 expiries
            
        except Exception as e:
            logger.error(f"❌ Expiry fetch error: {e}")
            return self._get_fallback_expiries()
    
    def _get_fallback_expiries(self) -> List[str]:
        """Fallback expiry dates"""
        return [
            "25-Nov-2025", "02-Dec-2025", "09-Dec-2025", 
            "16-Dec-2025", "23-Dec-2025", "30-Dec-2025"
        ]
    
    def get_option_chain(self, index: str, expiry: str, strike_count: int = 10) -> Dict:
        """Get real option chain data - USING OUR WORKING SOLUTION"""
        try:
            if not self.is_authenticated():
                return {"success": False, "message": "Not authenticated"}
            
            # Load master file to get token mappings
            master_path = r"C:\Users\Ketan\Desktop\kotak_master.csv"
            if not os.path.exists(master_path):
                return {"success": False, "message": "Master file not found"}
            
            df = pd.read_csv(master_path)
            df.columns = df.columns.str.strip()
            
            # Extract expiry tag (e.g., "25NOV" from "25-Nov-2025")
            expiry_date = datetime.strptime(expiry, "%d-%b-%Y")
            expiry_tag = expiry_date.strftime("%d%b").upper()
            
            # Filter for index and expiry
            df = df[df['pSymbolName'] == index]
            df = df[df['pTrdSymbol'].str.contains(expiry_tag, na=False)]
            
            # Create token map
            token_map = {}
            for _, row in df.iterrows():
                try:
                    strike_raw = float(row['dStrikePrice'])
                    strike = int(strike_raw / 100)  # Convert to proper strike
                    otype = row['pOptionType']
                    token = str(row['pSymbol']).strip()
                    
                    if strike not in token_map:
                        token_map[strike] = {'CE_token': None, 'PE_token': None}
                    
                    if otype == 'CE':
                        token_map[strike]['CE_token'] = token
                    else:
                        token_map[strike]['PE_token'] = token
                except Exception as e:
                    continue
            
            if not token_map:
                return {"success": False, "message": "No strikes found for given expiry"}
            
            # Get spot price to determine ATM strikes
            spot_symbol = "Nifty Bank" if index == "BANKNIFTY" else "Nifty 50"
            spot_url = f"{self.session_data['base_url']}/script-details/1.0/quotes/neosymbol/nse_cm|{spot_symbol}"
            spot_response = requests.get(spot_url, headers=self.get_headers(), timeout=10)
            
            if spot_response.status_code != 200:
                return {"success": False, "message": "Failed to get spot price"}
            
            spot_data = spot_response.json()
            if not spot_data:
                return {"success": False, "message": "No spot data received"}
            
            spot = float(spot_data[0]['ltp'])
            
            # Select strikes around ATM
            all_strikes = sorted(token_map.keys())
            atm = min(all_strikes, key=lambda x: abs(x - spot))
            atm_index = all_strikes.index(atm)
            
            start_idx = max(0, atm_index - strike_count//2)
            end_idx = min(len(all_strikes), atm_index + strike_count//2 + 1)
            strikes = all_strikes[start_idx:end_idx]
            
            # Fetch quotes for all strikes
            slugs = []
            for s in strikes:
                if s in token_map:
                    if token_map[s]['CE_token']:
                        slugs.append(f"nse_fo|{token_map[s]['CE_token']}")
                    if token_map[s]['PE_token']:
                        slugs.append(f"nse_fo|{token_map[s]['PE_token']}")
            
            quote_data = {}
            if slugs:
                # Fetch in chunks of 50 to avoid URL too long
                chunk_size = 50
                for i in range(0, len(slugs), chunk_size):
                    chunk = slugs[i:i + chunk_size]
                    url = f"{self.session_data['base_url']}/script-details/1.0/quotes/neosymbol/{','.join(chunk)}"
                    response = requests.get(url, headers=self.get_headers(), timeout=10)
                    
                    if response.status_code == 200:
                        data = response.json()
                        for item in data:
                            token = item.get('exchange_token', '')
                            quote_data[token] = item
            
            # Build option chain response
            chain_data = []
            for s in strikes:
                if s not in token_map:
                    continue
                    
                ce_token = token_map[s]['CE_token']
                pe_token = token_map[s]['PE_token']
                
                ce = quote_data.get(ce_token, {}) if ce_token else {}
                pe = quote_data.get(pe_token, {}) if pe_token else {}
                
                chain_data.append({
                    "strike": s,
                    "call": {
                        "bid": ce.get('depth', {}).get('buy', [{}])[0].get('price', 0),
                        "ask": ce.get('depth', {}).get('sell', [{}])[0].get('price', 0),
                        "ltp": ce.get('ltp', 0),
                        "oi": ce.get('open_int', 0),
                        "volume": ce.get('last_volume', 0)
                    },
                    "put": {
                        "bid": pe.get('depth', {}).get('buy', [{}])[0].get('price', 0),
                        "ask": pe.get('depth', {}).get('sell', [{}])[0].get('price', 0),
                        "ltp": pe.get('ltp', 0),
                        "oi": pe.get('open_int', 0),
                        "volume": pe.get('last_volume', 0)
                    }
                })
            
            logger.info(f"✅ Fetched {len(chain_data)} strikes for {index}")
            
            return {
                "success": True,
                "data": chain_data,
                "spot": spot,
                "atm_strike": atm,
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Option chain error: {str(e)}")
            return {"success": False, "message": f"Option chain failed: {str(e)}"}
    
    def place_order(self, order_data: Dict) -> Dict:
        """Place order - PLACEHOLDER (to be implemented)"""
        try:
            # This will be implemented later for actual trading
            return {
                "success": True, 
                "message": "Order placement will be implemented in next phase",
                "order_id": "SIMULATED_ORDER_001"
            }
        except Exception as e:
            return {"success": False, "message": f"Order failed: {str(e)}"}

# Global API instance
kotak_api = FixedKotakAPI()

# Caching
cache = {
    "option_chain": {},
    "expiries": {},
    "last_update": {}
}

CACHE_DURATION = 2  # seconds

def is_cache_valid(key: str) -> bool:
    """Check if cache is still valid"""
    if key not in cache["last_update"]:
        return False
    return (time.time() - cache["last_update"][key]) < CACHE_DURATION

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager"""
    global kotak_api
    logger.info("🚀 Starting Kotak Trading Platform...")
    logger.info(f"📋 User: {KOTAK_CONFIG['client_code']}")
    yield
    logger.info("🛑 Shutting down...")

app = FastAPI(
    title="Kotak Trading Platform",
    description="Web-based Trading Platform with Real Option Chain Data",
    lifespan=lifespan
)

# ==================== API ENDPOINTS ====================

@app.get("/api/status")
async def get_status():
    """Check API status"""
    return {
        "status": "running",
        "authenticated": kotak_api.is_authenticated(),
        "user": KOTAK_CONFIG.get("client_code"),
        "timestamp": datetime.now().isoformat()
    }

@app.post("/api/login")
async def login(totp: str = Form(...), mpin: str = Form(...)):
    """Login endpoint"""
    logger.info(f"🔄 Login attempt for {KOTAK_CONFIG['client_code']}")
    
    result = kotak_api.login(totp, mpin)
    return result

@app.get("/api/indices")
async def get_indices():
    """Get available indices"""
    return {
        "success": True,
        "indices": MARKET_INDICES.get("NFO", [])
    }

@app.get("/api/expiries")
async def get_expiries(index: str = "BANKNIFTY"):
    """Get expiry dates"""
    cache_key = f"expiries_{index}"
    
    if is_cache_valid(cache_key) and cache_key in cache["expiries"]:
        return {
            "success": True, 
            "expiries": cache["expiries"][cache_key],
            "cached": True
        }
    
    expiries = kotak_api.get_expiries(index)
    
    cache["expiries"][cache_key] = expiries
    cache["last_update"][cache_key] = time.time()
    
    return {
        "success": True,
        "expiries": expiries,
        "cached": False
    }

@app.get("/api/option-chain")
async def get_option_chain(index: str, expiry: str, strikes: int = 10):
    """Get option chain data"""
    cache_key = f"chain_{index}_{expiry}_{strikes}"
    
    if is_cache_valid(cache_key) and cache_key in cache["option_chain"]:
        cached_data = cache["option_chain"][cache_key]
        cached_data["cached"] = True
        return cached_data
    
    result = kotak_api.get_option_chain(index, expiry, strikes)
    
    if result["success"]:
        cache["option_chain"][cache_key] = result
        cache["last_update"][cache_key] = time.time()
        result["cached"] = False
    
    return result

@app.post("/api/place-order")
async def place_order(order_data: Dict):
    """Place order endpoint"""
    if not kotak_api.is_authenticated():
        return {"success": False, "message": "Not authenticated"}
    
    result = kotak_api.place_order(order_data)
    return result

@app.get("/api/auth-status")
async def auth_status():
    """Check authentication status"""
    return {
        "authenticated": kotak_api.is_authenticated(),
        "user": KOTAK_CONFIG.get("client_code")
    }

# Mount frontend
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_path):
    logger.info(f"✅ Frontend mounted from: {frontend_path}")
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
else:
    logger.warning(f"⚠️ Frontend path not found: {frontend_path}")

if __name__ == "__main__":
    import uvicorn
    
    logger.info("🌐 Starting Kotak Trading Platform Server...")
    logger.info("📊 Real-time option chain data enabled")
    logger.info("⚡ FastAPI server ready")
    logger.info("📍 http://localhost:8000")
    
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)