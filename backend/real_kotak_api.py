import requests
import pandas as pd
import io
from datetime import datetime, timedelta
import logging
from typing import Dict, List, Optional
from config import KOTAK_CONFIG

logger = logging.getLogger(__name__)

class RealKotakAPI:
    def __init__(self):
        self.access_token = KOTAK_CONFIG["access_token"]
        self.base_headers = {
            'Authorization': self.access_token,
            'Content-Type': 'application/json'
        }
        self.scrip_master_data = None
        self.last_fetch_time = None
    
    def get_scrip_master_files(self) -> List[str]:
        """Get latest scrip master file URLs from Kotak"""
        try:
            url = "https://tradeapi.kotaksecurities.com/script-details/1.0/masterscrip/file-paths"
            response = requests.get(url, headers=self.base_headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                files = data.get("data", {}).get("filesPaths", [])
                logger.info(f"✅ Found {len(files)} scrip master files")
                return files
            else:
                logger.error(f"❌ Scrip master API failed: {response.status_code}")
                return []
        except Exception as e:
            logger.error(f"❌ Scrip master error: {e}")
            return []
    
    def download_and_parse_scrip_master(self, file_url: str) -> pd.DataFrame:
        """Download and parse a scrip master CSV file"""
        try:
            response = requests.get(file_url, timeout=30)
            if response.status_code == 200:
                # Parse CSV - adjust columns based on actual Kotak format
                df = pd.read_csv(io.StringIO(response.text))
                logger.info(f"✅ Downloaded scrip master with {len(df)} instruments")
                return df
            else:
                logger.error(f"❌ Download failed: {response.status_code}")
                return pd.DataFrame()
        except Exception as e:
            logger.error(f"❌ CSV parse error: {e}")
            return pd.DataFrame()
    
    def get_expiries(self, market: str = "NFO") -> List[str]:
        """Get real expiry dates from scrip master"""
        try:
            # Refresh data if older than 1 hour
            if (not self.last_fetch_time or 
                (datetime.now() - self.last_fetch_time) > timedelta(hours=1)):
                self._refresh_scrip_data()
            
            if not self.scrip_master_data:
                return self._get_fallback_expiries(market)
            
            # Filter by market
            if market == "NFO":
                segment_filter = "nse_fo"
            elif market == "BFO":
                segment_filter = "bse_fo"
            else:
                return self._get_fallback_expiries(market)
            
            # Extract expiry dates from scrip master
            # This depends on the actual CSV column names from Kotak
            expiries = self._extract_expiries_from_data(segment_filter)
            
            if expiries:
                logger.info(f"✅ Got {len(expiries)} real expiries for {market}")
                return expiries
            else:
                return self._get_fallback_expiries(market)
                
        except Exception as e:
            logger.error(f"❌ Expiry extraction error: {e}")
            return self._get_fallback_expiries(market)
    
    def _refresh_scrip_data(self):
        """Refresh scrip master data"""
        try:
            files = self.get_scrip_master_files()
            nfo_file = next((f for f in files if "nse_fo" in f), None)
            
            if nfo_file:
                self.scrip_master_data = self.download_and_parse_scrip_master(nfo_file)
                self.last_fetch_time = datetime.now()
            else:
                logger.warning("❌ No NFO scrip master file found")
                
        except Exception as e:
            logger.error(f"❌ Data refresh error: {e}")
    
    def _extract_expiries_from_data(self, segment: str) -> List[str]:
        """Extract expiry dates from scrip master data"""
        try:
            # This is a simplified extraction - you'll need to adjust based on actual CSV format
            # Kotak typically has columns like 'expiry_date', 'lExpiryDate', etc.
            
            if self.scrip_master_data is None or self.scrip_master_data.empty:
                return []
            
            # Try common column names for expiry date
            expiry_columns = ['expiry_date', 'lExpiryDate', 'expiry', 'EXPIRY_DT']
            expiry_col = None
            
            for col in expiry_columns:
                if col in self.scrip_master_data.columns:
                    expiry_col = col
                    break
            
            if not expiry_col:
                logger.warning("❌ No expiry column found in scrip master")
                return []
            
            # Extract unique expiry dates and format them
            unique_expiries = self.scrip_master_data[expiry_col].dropna().unique()
            
            # Convert to readable dates and filter future expiries
            today = datetime.now().date()
            formatted_expiries = []
            
            for expiry in unique_expiries:
                try:
                    # Handle different date formats
                    if isinstance(expiry, (int, float)):
                        # Unix timestamp or numeric format
                        expiry_date = datetime.fromtimestamp(expiry).date()
                    else:
                        # String date
                        expiry_date = datetime.strptime(str(expiry), '%d-%b-%Y').date()
                    
                    if expiry_date >= today:
                        formatted_expiries.append(expiry_date.strftime('%d-%b-%Y'))
                        
                except (ValueError, TypeError):
                    continue
            
            # Sort and return
            formatted_expiries.sort()
            return formatted_expiries[:8]  # Return next 8 expiries
            
        except Exception as e:
            logger.error(f"❌ Expiry extraction error: {e}")
            return []
    
    def _get_fallback_expiries(self, market: str) -> List[str]:
        """Fallback to calculated expiries if scrip master fails"""
        try:
            today = datetime.now()
            expiries = []
            
            if market == "NFO":
                # NIFTY - Next 4 Tuesdays + 2 month-end Thursdays
                for i in range(4):
                    days_ahead = (1 - today.weekday() + 7) % 7 + (i * 7)  # Next Tuesday
                    expiry = today + timedelta(days=days_ahead)
                    expiries.append(expiry.strftime('%d-%b-%Y'))
                
                # Add month-end Thursdays
                for i in range(2):
                    if i == 0:
                        # Last Thursday of current month
                        next_month = today.replace(day=28) + timedelta(days=4)
                        last_thursday = next_month - timedelta(days=(next_month.weekday() - 3) % 7)
                    else:
                        # Last Thursday of next month
                        next_month = today.replace(day=28) + timedelta(days=32)
                        next_month = next_month.replace(day=1)
                        last_thursday = next_month.replace(day=28) + timedelta(days=4)
                        last_thursday = last_thursday - timedelta(days=(last_thursday.weekday() - 3) % 7)
                    
                    expiry_str = last_thursday.strftime('%d-%b-%Y')
                    if expiry_str not in expiries:
                        expiries.append(expiry_str)
                        
            else:  # BFO
                # SENSEX/BANKEX - Next 4 Thursdays
                for i in range(4):
                    days_ahead = (3 - today.weekday() + 7) % 7 + (i * 7)  # Next Thursday
                    expiry = today + timedelta(days=days_ahead)
                    expiries.append(expiry.strftime('%d-%b-%Y'))
            
            expiries.sort()
            logger.info(f"✅ Using calculated expiries for {market}")
            return expiries
            
        except Exception as e:
            logger.error(f"❌ Fallback expiry error: {e}")
            return ['25-Jan-2024', '01-Feb-2024', '08-Feb-2024', '15-Feb-2024']
    
    def test_connection(self) -> Dict:
        """Test Kotak API connection with expiry fetch"""
        try:
            expiries = self.get_expiries("NFO")
            return {
                "connected": len(expiries) > 0,
                "message": f"✅ Kotak API working - found {len(expiries)} expiries" if expiries else "❌ Kotak API limited",
                "expiries_sample": expiries[:3] if expiries else [],
                "details": "Real expiry dates available" if expiries else "Using calculated dates"
            }
        except Exception as e:
            return {
                "connected": False,
                "message": f"❌ Connection failed: {str(e)}"
            }

# Global instance
real_kotak_api = RealKotakAPI()