# main.py
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

# Import your configuration
from config import KOTAK_CONFIG, KOTAK_API_BASE_URL, KOTAK_API_ENDPOINTS, get_static_expiries

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class KotakAPI:
    """Kotak Securities API wrapper for authentication and trading"""
    
    def __init__(self, access_token, mobile_number, client_code, neo_fin_key="neotradeapi"):
        """
        Initialize Kotak API with correct parameters (NO api_key argument)
        """
        self.access_token = access_token
        self.mobile_number = mobile_number
        self.client_code = client_code
        self.neo_fin_key = neo_fin_key
        
        # Session tokens (to be obtained after login)
        self.session_token = None
        self.session_sid = None
        self.base_url = None
        self.is_authenticated = False
        
        logger.info(f"✅ KotakAPI initialized for client: {client_code}")
    
    def login_with_totp(self, totp_secret):
        """
        Step 1: Login with TOTP to get view token and session SID
        """
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
                json=payload
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
        """
        Step 2: Validate MPIN to get session token and trade token
        """
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
                json=payload
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


# Global API instance
kotak_api = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown"""
    # Startup
    global kotak_api
    
    logger.info("✅ Configuration loaded successfully")
    logger.info(f"📋 Config loaded for user: {KOTAK_CONFIG['client_code']}")
    
    # Initialize KotakAPI with correct parameters
    kotak_api = KotakAPI(
        access_token=KOTAK_CONFIG["access_token"],
        mobile_number=KOTAK_CONFIG["mobile_number"],
        client_code=KOTAK_CONFIG["client_code"],
        neo_fin_key=KOTAK_CONFIG.get("neo_fin_key", "neotradeapi")
    )
    logger.info("✅ KotakAPI initialized successfully")
    
    yield
    # Shutdown
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


# API Routes (define BEFORE mounting static files if possible)
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
    """
    Login endpoint for authentication
    """
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
        return {
            "status": "success",
            "message": "Authentication successful",
            "user": KOTAK_CONFIG.get("client_code")
        }
    else:
        return {"status": "error", "message": "MPIN validation failed"}


if __name__ == "__main__":
    import uvicorn
    
    logger.info("🚀 Starting Kotak Trading API Server...")
    logger.info(f"📊 Development mode - using static data fallback")
    logger.info(f"🌐 Server running at: http://localhost:8000")
    logger.info(f"📚 API documentation at: http://localhost:8000/docs")
    logger.info(f"💡 Add your real Kotak API credentials in config.py for live data")
    
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
