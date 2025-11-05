import requests
import json
import logging
from typing import Dict, List, Optional
from config import KOTAK_CONFIG, KOTAK_API_ENDPOINTS

logger = logging.getLogger(__name__)

class KotakAPI:
    def __init__(self):
        self.access_token = KOTAK_CONFIG["access_token"]
        self.client_code = KOTAK_CONFIG["client_code"]
        self.mobile_number = KOTAK_CONFIG["mobile_number"]
        self.base_headers = {
            'accept': 'application/json',
            'Authorization': f'Bearer {self.access_token}',
            'clientCode': self.client_code,
            'mobileNumber': self.mobile_number
        }
    
    def get_expiries(self, symbol: str = "NIFTY") -> List[str]:
        """Get real expiry dates from Kotak API"""
        try:
            url = KOTAK_API_ENDPOINTS["expiries"]
            params = {"symbol": symbol}
            
            response = requests.get(url, headers=self.base_headers, params=params, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                # Kotak API returns expiries in specific format, adjust as needed
                expiries = data.get("data", {}).get("expiries", [])
                logger.info(f"✅ Got {len(expiries)} real expiries from Kotak")
                return expiries
            else:
                logger.error(f"❌ Kotak expiries API failed: {response.status_code}")
                return []
                
        except Exception as e:
            logger.error(f"❌ Kotak expiries error: {e}")
            return []
    
    def get_option_chain(self, symbol: str, expiry: str, strike_count: int = 25):
        """Get real option chain data from Kotak API"""
        try:
            url = KOTAK_API_ENDPOINTS["option_chain"]
            params = {
                "symbol": symbol,
                "expiry": expiry,
                "strikeCount": strike_count
            }
            
            response = requests.get(url, headers=self.base_headers, params=params, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                logger.info(f"✅ Got real option chain for {symbol}")
                return data
            else:
                logger.error(f"❌ Kotak option chain API failed: {response.status_code}")
                return None
                
        except Exception as e:
            logger.error(f"❌ Kotak option chain error: {e}")
            return None
    
    def place_order(self, order_data: Dict):
        """Place real order through Kotak API"""
        try:
            url = KOTAK_API_ENDPOINTS["place_order"]
            
            response = requests.post(url, headers=self.base_headers, json=order_data, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                logger.info("✅ Order placed successfully via Kotak")
                return data
            else:
                logger.error(f"❌ Kotak order API failed: {response.status_code}")
                return None
                
        except Exception as e:
            logger.error(f"❌ Kotak order error: {e}")
            return None

# Global instance
kotak_api = KotakAPI()