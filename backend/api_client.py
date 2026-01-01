# api_client.py - TOP OF FILE
import os
import logging
import requests
from datetime import datetime
import pandas as pd
from typing import Dict, List
import re
from concurrent.futures import ThreadPoolExecutor
import json
import copy
import threading
import urllib.parse
import time
import uuid

# Import config
from config import MASTERPATH, BFO_MASTERPATH, USERS_FILE, SESSION_FILE, MY_MPIN

logger = logging.getLogger(__name__)


class KotakNiftyAPI:
    def __init__(self):
        self.active_sessions = {} 
        self.current_user = None
        
        # === DUAL CACHE: MEMORY FOR BOTH MARKETS ===
        self.nfo_master_df = None  # Brain 1: NSE
        self.bfo_master_df = None  # Brain 2: BSE
        
        self.lot_cache = {} 
        self.call_count = 0
        self.api_session = requests.Session()
        # === NEW: Create "Fast" Persistent Connection ===
        self.api_session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20)
        self.api_session.mount('https://', adapter)
        self.last_strike_range = {}
        print("📊 Checking what indices are available...")
    # === NEW: LOAD SESSION AND VALIDATE WITH NIFTY CHECK ===
    def load_session_from_disk(self):
        if os.path.exists(SESSION_FILE):
            try:
                with open(SESSION_FILE, 'r') as f:
                    data = json.load(f)
                    
                    # Temp variables
                    temp_sessions = data.get("sessions", {})
                    temp_user = data.get("current_user")

                    # 1. If we have a saved user, let's test the key
                    if temp_user and temp_user in temp_sessions:
                        self.active_sessions = temp_sessions
                        self.current_user = temp_user
                        
                        logger.info(f"🕵️ Testing if session for {self.current_user} is still alive...")

                        # 2. THE TEST: Ask for Nifty 50 price
                        try:
                            base_url = self.active_sessions[self.current_user]["base_url"]
                            # URL to get Nifty 50 Spot Price
                            test_url = f"{base_url}/script-details/1.0/quotes/neosymbol/nse_cm|Nifty 50"
                            
                            response = requests.get(test_url, headers=self.get_headers(), timeout=5)

                            # 3. JUDGMENT: 
                            if response.status_code == 200:
                                logger.info(f"✅ Session is VALID. Nifty Check Passed.")
                            else:
                                # If 401 (Unauthorized) or any other error, we assume session is dead
                                logger.warning(f"❌ Session expired (Status {response.status_code}). Clearing login.")
                                self.active_sessions = {}
                                self.current_user = None
                                self.save_session_to_disk() # Wipe the file
                        
                        except Exception as e:
                            logger.warning(f"⚠️ Network error during check: {e}. Clearing session.")
                            self.active_sessions = {}
                            self.current_user = None
                    else:
                        logger.info("ℹ️ No valid user found in cache.")

            except Exception as e:
                logger.error(f"❌ Failed to load session cache: {e}")
                self.active_sessions = {}
                self.current_user = None

    # === NEW: SAVE SESSION TO FILE ===
    def save_session_to_disk(self):
        try:
            data = {
                "current_user": self.current_user,
                "sessions": self.active_sessions
            }
            with open(SESSION_FILE, 'w') as f:
                json.dump(data, f, indent=4)
            logger.info("💾 Session Saved to Disk")
        except Exception as e:
            logger.error(f"❌ Failed to save session cache: {e}")

    def load_users_from_file(self):
        if not os.path.exists(USERS_FILE):
            logger.error("❌ users.json not found!")
            return {}
        try:
            with open(USERS_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"❌ Error reading users.json: {e}")
            return {}

    def get_headers(self):
        if not self.current_user or self.current_user not in self.active_sessions:
            return {"neo-fin-key": "neotradeapi", "Content-Type": "application/json"}
        
        session = self.active_sessions[self.current_user]
        all_users = self.load_users_from_file()
        access_token = all_users.get(self.current_user, {}).get("access_token", "")

        return {
            "Authorization": access_token,
            "Auth": session.get("token", ""),
            "Sid": session.get("sid", ""),
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/json"
        }
    # === OPTIMIZED: LOADS CSV INTO DUAL MEMORY ===
    def load_master_into_memory(self, segment="NFO"):
        """Load NFO or BFO master CSV into its specific memory slot"""
        master_path = MASTERPATH if segment == "NFO" else BFO_MASTERPATH
        
        if not os.path.exists(master_path):
            logger.error(f"❌ Master file not found for {segment}: {master_path}")
            return
        
        try:
            logger.info(f"⏳ Caching {segment} Master CSV into RAM...")
            
            # Read CSV
            try:
                temp_df = pd.read_csv(master_path)
            except:
                temp_df = pd.read_csv(master_path, sep='|')
            
            # Clean Data
            temp_df.columns = temp_df.columns.str.strip()
            temp_df['pSymbolName'] = temp_df['pSymbolName'].astype(str).str.strip()
            temp_df['pTrdSymbol'] = temp_df['pTrdSymbol'].astype(str).str.strip()
            
            # Parse expiry based on segment
            if segment == "BFO":
                # For BFO: Only process SENSEX/BANKEX
                bse_indices = ['SENSEX', 'BANKEX', 'SENSEX50']
                mask = temp_df['pSymbolName'].isin(bse_indices)
                temp_df['real_expiry'] = None
                
                if mask.any():
                    if 'pExpiryDate' in temp_df.columns:
                        temp_df.loc[mask, 'real_expiry'] = temp_df.loc[mask, 'pExpiryDate'].apply(
                            lambda x: datetime.fromtimestamp(int(x)).strftime('%d-%m-%Y') 
                            if pd.notnull(x) and str(x).isdigit() else None
                        )
                    else:
                        # Fallback for BFO parsing
                        temp_df.loc[mask, 'real_expiry'] = temp_df.loc[mask, 'pTrdSymbol'].apply(
                             lambda x: self.parse_symbol_date(x, "BFO")
                        )
                # SAVE TO BFO SLOT
                self.bfo_master_df = temp_df
                logger.info(f"✅ BFO Master Cached! {len(self.bfo_master_df)} rows.")

            else:
                # NFO Parsing
                temp_df['real_expiry'] = temp_df['pTrdSymbol'].apply(
                    lambda x: self.parse_symbol_date(x, "NFO")
                )
                # SAVE TO NFO SLOT
                self.nfo_master_df = temp_df
                logger.info(f"✅ NFO Master Cached! {len(self.nfo_master_df)} rows.")
            
            # Update Lot Cache (Merge both)
            self.lot_cache.update(dict(zip(temp_df['pTrdSymbol'], temp_df['lLotSize'])))
            
        except Exception as e:
            logger.error(f"❌ Failed to cache {segment} Master CSV: {e}")    
       
    
    def login(self, totp_code: str, user_id: str) -> Dict:
        try:
            users_db = self.load_users_from_file()
            if user_id not in users_db:
                return {"success": False, "message": f"User '{user_id}' not found"}

            creds = users_db[user_id]
            logger.info(f"🔄 Starting Authentication for: {user_id}")

            login_url = "https://mis.kotaksecurities.com/login/1.0/tradeApiLogin"
            headers = {"Authorization": creds["access_token"], "neo-fin-key": "neotradeapi", "Content-Type": "application/json"}

            r1 = requests.post(login_url, json={"mobileNumber": creds["mobile_number"], "ucc": creds["client_code"], "totp": totp_code}, headers=headers)

            if r1.status_code != 200: return {"success": False, "message": f"TOTP failed: {r1.text}"}
            d1 = r1.json()
            if "data" not in d1: return {"success": False, "message": "Invalid TOTP response"}

            headers.update({"sid": d1["data"]["sid"], "Auth": d1["data"]["token"]})
            
            r2 = requests.post("https://mis.kotaksecurities.com/login/1.0/tradeApiValidate", json={"mpin": MY_MPIN}, headers=headers)
            if r2.status_code != 200: return {"success": False, "message": f"MPIN failed: {r2.text}"}

            d2 = r2.json()
            self.active_sessions[user_id] = {
                "base_url": d2["data"].get("baseUrl", "https://mis.kotaksecurities.com"),
                "token": d2["data"]["token"],
                "sid": d2["data"]["sid"],
                "authenticated": True
            }
            self.current_user = user_id
            logger.info(f"✅ Login Successful for {user_id}")
            
            # === NEW: SAVE SESSION AUTOMATICALLY ===
            self.save_session_to_disk()
            
            self.download_master_file("NFO")
            self.download_master_file("BFO") 
            
            return {"success": True, "message": f"Logged in as {user_id}"}
        except Exception as e:
            logger.error(f"❌ Login error: {e}")
            return {"success": False, "message": str(e)}
    # === NEW: LOGOUT FUNCTION (BURNS THE TICKET) ===
    def logout(self):
        # 1. Only logout the current user
        if self.current_user and self.current_user in self.active_sessions:
            # Remove only this user's session
            del self.active_sessions[self.current_user]
            logger.info(f"✅ Logged out user: {self.current_user}")
    
        # 2. Reset current_user
        self.current_user = None
    
        # 3. Update session file (don't delete, just save without this user)
        self.save_session_to_disk()
    
        return {"success": True, "message": "Logged out securely"}
    def switch_user(self, user_id: str):
        if user_id in self.active_sessions:
            self.current_user = user_id
            
            # === NEW: SAVE PREFERENCE ===
            self.save_session_to_disk()
            
            logger.info(f"⚡ Switched active session to {user_id}")
            return {"success": True, "message": f"Switched to {user_id}"}
        else:
            return {"success": False, "message": "User not logged in yet"}
    def download_master_file(self, segment="NFO"):
        """Download NFO or BFO master file"""
        try:
            if not self.current_user:
                return
        
            base_url = self.active_sessions[self.current_user]["base_url"]
            url_api = f"{base_url}/script-details/1.0/masterscrip/file-paths"
            r = requests.get(url_api, headers=self.get_headers())
            data = r.json()
    
            file_url = ""
            target_file = "nse_fo.csv" if segment == "NFO" else "bse_fo.csv"
            master_path = MASTERPATH if segment == "NFO" else BFO_MASTERPATH
    
            if "data" in data and "filesPaths" in data["data"]:
                for u in data["data"]["filesPaths"]:
                    if target_file in u:
                        file_url = u
                        break
    
            if file_url:
                r = requests.get(file_url, timeout=10)  # ← CHANGED: Added timeout
                if r.status_code == 200:
                    with open(master_path, "wb") as f:
                        f.write(r.content)
                    logger.info(f"✅ {segment} Master File Downloaded")
                    # Reload cache
                    self.load_master_into_memory(segment)
            
        except Exception as e:
            logger.error(f"❌ Download FAILED for {segment}: {e}")  # ← CHANGED: Better error
            # Check if old file exists
            if os.path.exists(master_path):
                logger.warning(f"⚠️ Using OLD cached file for {segment}")
                # Try to load old file into memory
                self.load_master_into_memory(segment)


    def parse_symbol_date(self, sym, segment="NFO"):
        """Universal parser for both NFO and BFO symbol formats"""
        try:
            sym_str = str(sym)
            
            # For BFO: Check if it's a SENSEX symbol
            if segment == "BFO" and "SENSEX" in sym_str:
                # Handle BFO SENSEX formats
              
                
                # Pattern 1: SENSEX25NOV92300CE (Monthly)
                pattern1 = r'SENSEX(\d{2})([A-Z]{3})(\d+)([CP]E)'
                match1 = re.match(pattern1, sym_str)
                if match1:
                    yy, month_code, strike, opt_type = match1.groups()
                    month_map = {
                        'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
                        'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
                        'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
                    }
                    month = month_map.get(month_code, '01')
                    return f"Ex-{month_code}-20{yy}"
                
                # Pattern 2: SENSEX25D1178100PE (Weekly D-codes)
                pattern2 = r'SENSEX(\d{2})(D\d)(\d+)([CP]E)'
                match2 = re.match(pattern2, sym_str)
                if match2:
                    yy, d_code, strike, opt_type = match2.groups()
                    return f"Ex-D{d_code[-1]}-DEC-20{yy}"
                
                # Pattern 3: SENSEX5025NOV26100PE (SENSEX50)
                pattern3 = r'SENSEX(\d{4})([A-Z]{3})(\d+)([CP]E)'
                match3 = re.match(pattern3, sym_str)
                if match3:
                    full_year_code, month_code, strike, opt_type = match3.groups()
                    year = "20" + full_year_code[2:] if full_year_code.startswith('50') else "20" + full_year_code[:2]
                    return f"Ex-{month_code}-{year}"
                
                # Futures: SENSEX25NOVFUT
                if 'FUT' in sym_str:
                    return "FUT"
            
            # Original NFO parsing (unchanged)
            w_match = re.search(r'(NIFTY|BANKNIFTY)(\d{2})([1-9OND])(\d{2})', sym_str)
            if w_match:
                index_name, yy, m_char, dd = w_match.groups()
                m_map = {'1':'01','2':'02','3':'03','4':'04','5':'05','6':'06','7':'07','8':'08','9':'09','O':'10','N':'11','D':'12'}
                return f"{dd}-{m_map.get(m_char)}-20{yy}"
            
            m_match = re.search(r'(NIFTY|BANKNIFTY)(\d{2})([A-Z]{3})', sym_str)
            if m_match:
                index_name, yy, m_str = m_match.groups()
                return f"Ex-{m_str}-20{yy}"
                
        except Exception as e:
            logger.error(f"Parse error for {sym}: {e}")
        
        return None    

    def get_expiries(self, index_name: str = "NIFTY", segment: str = "NFO") -> List[str]:
        """Get expiry dates for NFO or BFO using Dual Memory"""
        
        # 1. Select the correct dataframe
        df = None
        if segment == "BFO":
            if self.bfo_master_df is None: self.load_master_into_memory("BFO")
            df = self.bfo_master_df
        else:
            if self.nfo_master_df is None: self.load_master_into_memory("NFO")
            df = self.nfo_master_df

        # If memory is empty, try fallback to disk (Safety Net)

        master_path = BFO_MASTERPATH if segment == "BFO" else MASTERPATH
        if df is None:
           
            if not os.path.exists(master_path): return []
            try:
                df = pd.read_csv(master_path)
                # Quick parse just for expiries if reading raw from disk
                # (This is slow, so we hope memory works)
                if segment == "NFO":
                    df['real_expiry'] = df['pTrdSymbol'].apply(lambda x: self.parse_symbol_date(x, "NFO"))
                # ... BFO parsing skipped for brevity in fallback ...
            except: return []

        try:
            # Filter by index name
            filtered_df = df[df['pSymbolName'] == index_name].copy()
            unique_dates = filtered_df['real_expiry'].dropna().unique()
            
            # Sort dates
            def sort_key(d):
                if d is None:
                    return datetime(2099, 1, 1)

                try:
                    # Handle monthly labels like "Ex-JAN-2026"
                    if isinstance(d, str) and d.startswith("Ex-"):
                        parts = d.split('-')  # ["Ex", "JAN", "2026"]
                        if len(parts) == 3:
                            mon_str = parts[1].upper()
                            year = int(parts[2])
                            month_map = {
                                'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4,
                                'MAY': 5, 'JUN': 6, 'JUL': 7, 'AUG': 8,
                                'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12
                            }
                            month = month_map.get(mon_str, 12)
                            # Use day=31 so monthly comes AFTER all weekly expiries of that month
                            return datetime(year, month, 31)

                    # Normal weekly date: "09-12-2025"
                    return datetime.strptime(d, "%d-%m-%Y")
                except:
                    return datetime(2099, 1, 1)

                    
            sorted_dates = sorted([d for d in unique_dates if d is not None], key=sort_key)
            sorted_dates = list(dict.fromkeys(sorted_dates))   # remove duplicates keep order
 
            # Format for display (DD-Mon-YYYY)
            final_list = []
            for d in sorted_dates:
                if not d.startswith("Ex"):
                    try:
                        dt = datetime.strptime(d, "%d-%m-%Y")
                        final_list.append(dt.strftime('%d-%b-%Y'))
                    except: pass
                else:
                    final_list.append(d)
                    
            return final_list
            
        except Exception as e:
            logger.error(f"Expiry fetch error for {segment}: {e}")
            return []        
    def get_nifty_option_chain(self, expiry: str, strike_count: int = 10):
        return self.get_option_chain("NIFTY", expiry, strike_count)

    def get_option_chain(self, index: str, expiry: str, strikes: str = "10", recenter: bool = True):
        
        self.call_count += 1
        # 1. Determine Segment
        segment = "BFO" if index in ["SENSEX", "BANKEX", "SENSEX50"] else "NFO"
        
        # 2. SELECT BRAIN
        df = None
        if segment == "BFO":
            if self.bfo_master_df is None: self.load_master_into_memory("BFO")
            df = self.bfo_master_df
        else:
            if self.nfo_master_df is None: self.load_master_into_memory("NFO")
            df = self.nfo_master_df
            
        if df is None:
            logger.error(f"❌ {segment} Master DF is NONE. Load failed.")
            return {"success": False, "message": f"Master file missing for {segment}"}

        try:
            current_session = self.active_sessions.get(self.current_user)
            if not current_session: return {"success": False, "message": "Please Login First"}

            # === FIX: Initialize spot variable here ===
            spot = 0
            spot_symbol = ""
            
            # Index Logic
            if index == "BANKNIFTY":
                df_filtered = df[df['pSymbolName'] == 'BANKNIFTY']; spot_symbol = "Nifty Bank"
            elif index == "FINNIFTY":
                df_filtered = df[df['pSymbolName'] == 'FINNIFTY']; spot_symbol = "Nifty Fin Service"
            elif index == "MIDCPNIFTY":
                df_filtered = df[df['pSymbolName'] == 'MIDCPNIFTY']
                spot_symbol = "MIDCPNIFTY-FUT"
                
                # Fetch futures price for MIDCPNIFTY
                try:
                    futures_row = df_filtered[df_filtered['pTrdSymbol'].astype(str).str.contains('FUT')]
                    if not futures_row.empty:
                        futures_token = str(futures_row.iloc[0]['pSymbol']).strip()
                        futures_url = f"{current_session['base_url']}/script-details/1.0/quotes/neosymbol/nse_fo|{futures_token}"
                        
                        r_fut = self.api_session.get(futures_url, headers=self.get_headers(), timeout=2)
                        if r_fut.status_code == 200:
                            data = r_fut.json()
                            if isinstance(data, list) and len(data) > 0:
                                spot = float(data[0].get('ltp', 0))
                            elif isinstance(data, dict) and 'data' in data and data['data']:
                                spot = float(data['data'][0].get('ltp', 0))
                            
                           
                except Exception as e:
                    print(f"⚠️ Could not fetch MIDCPNIFTY futures: {e}")
            elif index == "SENSEX":
                df_filtered = df[df['pSymbolName'] == 'SENSEX']; spot_symbol = "SENSEX"
            elif index == "BANKEX":
                df_filtered = df[df['pSymbolName'] == 'BANKEX']; spot_symbol = "Nifty Bank"
            else:
                df_filtered = df[df['pSymbolName'] == 'NIFTY']; spot_symbol = "Nifty 50"

            # Expiry Logic
            target_expiry = expiry
            if "-" in expiry and not expiry.startswith("Ex"):
                dt_obj = datetime.strptime(expiry, "%d-%b-%Y")
                target_expiry = dt_obj.strftime("%d-%m-%Y")
            
            df_filtered = df_filtered[df_filtered['real_expiry'] == target_expiry]
            
            if df_filtered.empty: 
                return {"success": False, "message": f"No data found for {index} {expiry} (Seg: {segment})"}
            
            # === 1. SPOT PRICE (SKIP FOR MIDCPNIFTY - WE ALREADY HAVE FUTURES) ===
            if index != "MIDCPNIFTY":  # ← FIX: Don't fetch spot for MIDCPNIFTY
                exch_seg = "bse_cm" if segment == "BFO" else "nse_cm"
                spot_url = f"{current_session['base_url']}/script-details/1.0/quotes/neosymbol/{exch_seg}|{spot_symbol}"
                
                try:
                   
                    
                    # Longer timeout for large strike counts
                    timeout_seconds = 4 if int(strikes) > 20 else 3
                    r_spot = self.api_session.get(spot_url, headers=self.get_headers(), timeout=timeout_seconds)


                    spot = 0  # Default
                    if r_spot.status_code == 200:
                        d = r_spot.json()
                        ltp_value = None
        
                        if isinstance(d, list) and len(d) > 0:
                            ltp_value = d[0].get('ltp')
                        elif isinstance(d, dict) and 'data' in d and len(d['data']) > 0:
                            ltp_value = d['data'][0].get('ltp')
        
                        # Handle empty string
                        if ltp_value and str(ltp_value).strip() != "":
                            try:
                                spot = float(ltp_value)
                            except:
                                spot = 0
                except Exception as e:
                    print(f"⚠️ Spot fetch error: {e}")
                    spot = 0
            
            # Token Map Logic
            token_map = {}
            for _, row in df_filtered.iterrows():
                try:
                    col = 'dStrikePrice' if 'dStrikePrice' in df_filtered.columns else 'dStrikePrice;'
                    strike = int(float(row[col]) / 100)
                    token = str(row['pSymbol']).strip()
                    otype = row['pOptionType']
                    if strike not in token_map: token_map[strike] = {}
                    token_map[strike][otype] = token
                except: continue

            all_strikes = sorted(token_map.keys())
            if not all_strikes: return {"success": False, "message": "No strikes found in parsed data"}
            
            # === NEW: CHECK IF WE SHOULD USE LAST RANGE ===
            range_key = f"{index}_{expiry}_{segment}"
            if not recenter and range_key in self.last_strike_range:
                # Use previously selected strikes
                selected_strikes = self.last_strike_range[range_key]
                
            else:
                # Calculate fresh strikes (original logic)
                req_strikes = str(strikes).lower().strip()
                if req_strikes == "all": 
                    selected_strikes = all_strikes
                else:
                    try: 
                        s_count = int(float(req_strikes))
                    except: 
                        s_count = 10 
                    
                    if spot > 0:
                        atm = min(all_strikes, key=lambda x: abs(x - spot))
                        idx = all_strikes.index(atm)
                        start = max(0, idx - s_count)
                        end = min(len(all_strikes), idx + s_count + 1)
                        selected_strikes = all_strikes[start:end]
                    else: 
                        selected_strikes = all_strikes[:s_count]
                
                # Store for next time
                self.last_strike_range[range_key] = selected_strikes
               
            
            atm_display = min(all_strikes, key=lambda x: abs(x - spot)) if spot > 0 else 0
            
            # Prepare Slugs
            slugs = []
            exch_fo = "bse_fo" if segment == "BFO" else "nse_fo"
            
            for s in selected_strikes:
                if 'CE' in token_map[s]: slugs.append(f"{exch_fo}|{token_map[s]['CE']}")
                if 'PE' in token_map[s]: slugs.append(f"{exch_fo}|{token_map[s]['PE']}")

            # === 2. OPTION QUOTES ===
            # === 2. OPTION QUOTES (PARALLEL) ===
            q_data = {}
            if slugs:
                
                chunk_size = 20
                chunks = [slugs[i:i + chunk_size] for i in range(0, len(slugs), chunk_size)]
                
                if len(chunks) > 1:
                   pass
    
                def fetch_chunk(chunk):
                    q_url = f"{current_session['base_url']}/script-details/1.0/quotes/neosymbol/{','.join(chunk)}"
                    try:
                        timeout_seconds = 4 if int(strikes) > 20 else 3
                        q_r = self.api_session.get(q_url, headers=self.get_headers(), timeout=timeout_seconds)

                        

                        if q_r.status_code == 200:
                            res = q_r.json()
                            items = res['data'] if isinstance(res, dict) and 'data' in res else res
                            if isinstance(items, list):
                                return [(item.get('exchange_token'), item) for item in items if isinstance(item, dict)]
                    except:
                        pass
                    return []
    
                # Fetch all chunks in parallel
                with ThreadPoolExecutor(max_workers=5) as executor:
                    results = executor.map(fetch_chunk, chunks)
                    for chunk_results in results:
                        for token, item in chunk_results:
                            q_data[token] = item

            # Build Chain Data
            chain_data = []
            for s in selected_strikes:
                ce_token = token_map[s].get('CE'); pe_token = token_map[s].get('PE')
                ce = q_data.get(ce_token, {}); pe = q_data.get(pe_token, {})

                def get_p(d, side): return d.get('depth', {}).get(side, [{}])[0].get('price', 0) if isinstance(d, dict) else 0
                def get_v(d, k): return d.get(k, 0) if isinstance(d, dict) else 0

                ce_row = df_filtered[(df_filtered[col] == s * 100) & (df_filtered['pOptionType'] == 'CE')]
                pe_row = df_filtered[(df_filtered[col] == s * 100) & (df_filtered['pOptionType'] == 'PE')]
                ce_symbol = str(ce_row['pTrdSymbol'].values[0]) if not ce_row.empty else None
                pe_symbol = str(pe_row['pTrdSymbol'].values[0]) if not pe_row.empty else None
                
                # STORE TOKEN for Watchlist
                ce_ex_token = str(ce_row['pSymbol'].values[0]).strip() if not ce_row.empty else None
                pe_ex_token = str(pe_row['pSymbol'].values[0]).strip() if not pe_row.empty else None
               

                chain_data.append({
                    "strike": s,
                    "call": {
                        "token": ce_ex_token,
                        "bid": get_p(ce, 'buy'),
                        "ask": get_p(ce, 'sell'),
                        "ltp": get_v(ce, 'ltp'),
                        "oi": get_v(ce, 'open_int'),
                        "atp": get_v(ce, 'avg_cost'),
                        "pTrdSymbol": ce_symbol
                    },
                    "put": {
                        "token": pe_ex_token,
                        "bid": get_p(pe, 'buy'),
                        "ask": get_p(pe, 'sell'),
                        "ltp": get_v(pe, 'ltp'),
                        "oi": get_v(pe, 'open_int'),
                        "atp": get_v(pe, 'avg_cost'),
                        "pTrdSymbol": pe_symbol
                    },
                    "pTrdSymbol": ce_symbol or pe_symbol
                })


            return {
                "success": True, 
                "data": chain_data, 
                "spot": spot, 
                "atm_strike": atm_display,
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Chain Error: {e}")
            return {"success": False, "message": str(e)}


    def get_positions(self) -> Dict:
        """Fetch ALL positions with Dual Brain Support (NFO & BFO)"""
        if not self.current_user or self.current_user not in self.active_sessions:
            return {"success": False, "message": "Not logged in"}

        try:
            session = self.active_sessions[self.current_user]
            base_url = session["base_url"]
            
            # 1. FETCH POSITIONS
            url = f"{base_url}/quick/user/positions"
            try:
                response = self.api_session.get(url, headers=self.get_headers(), timeout=5)
            except Exception as e:
                return {"success": False, "message": f"Network Error: {str(e)}"}
            
            if response.status_code != 200:
                return {"success": False, "message": f"HTTP {response.status_code}"}

            res_json = response.json()
            raw_positions = res_json.get("data", []) or []
            processed_positions = []

            # 2. PARSE POSITIONS
            for pos in raw_positions:
                try:
                    ex_seg = str(pos.get("exSeg", "")).lower()
                    trd_sym = pos.get("trdSym")
                    
                    # Quantity Logic
                    cf_buy_qty = int(str(pos.get("cfBuyQty", "0")).strip() or "0")
                    cf_sell_qty = int(str(pos.get("cfSellQty", "0")).strip() or "0")
                    fl_buy_qty = int(str(pos.get("flBuyQty", "0")).strip() or "0")
                    fl_sell_qty = int(str(pos.get("flSellQty", "0")).strip() or "0")
                    
                    # Amount Logic
                    cf_buy_amt = float(str(pos.get("cfBuyAmt", "0")).strip() or "0")
                    cf_sell_amt = float(str(pos.get("cfSellAmt", "0")).strip() or "0")
                    fl_buy_amt = float(str(pos.get("buyAmt", "0")).strip() or "0")
                    fl_sell_amt = float(str(pos.get("sellAmt", "0")).strip() or "0")

                    total_buy_qty = cf_buy_qty + fl_buy_qty
                    total_sell_qty = cf_sell_qty + fl_sell_qty
                    total_buy_amt = cf_buy_amt + fl_buy_amt
                    total_sell_amt = cf_sell_amt + fl_sell_amt

                    net_qty = total_buy_qty - total_sell_qty
                    is_active_today = (fl_buy_qty > 0) or (fl_sell_qty > 0)

                    if ("fo" in ex_seg) and trd_sym and (net_qty != 0 or is_active_today):
                        buy_avg = total_buy_amt / total_buy_qty if total_buy_qty > 0 else 0.0
                        sell_avg = total_sell_amt / total_sell_qty if total_sell_qty > 0 else 0.0
                        

                        processed_positions.append({
                            "unique_id": str(uuid.uuid4()),
                            "symbol": trd_sym,
                            "segment": ex_seg,
                            "net_quantity": net_qty,
                            "buy_avg": round(buy_avg, 4),
                            "sell_avg": round(sell_avg, 4),
                            "buy_value": total_buy_amt,
                            "sell_value": total_sell_amt,
                            "product": pos.get("prod", "NRML"),
                            "position_type": "Long" if net_qty > 0 else "Short",
                            "pnl_realized": float(str(pos.get("rpnl", "0")).strip() or "0"),
                            "pnl_unrealized": 0.0, 
                            "pnl_total": 0.0,
                            "ltp": 0.0,
                            "strike": pos.get("stkPrc", ""),
                            "expiry": pos.get("expDt", ""),
                            "traded_today": is_active_today
                        })
                except: continue

            if not processed_positions:
                return {"success": True, "positions": [], "timestamp": datetime.now().isoformat()}

            # 3. FETCH LIVE PRICES (LTP) - DUAL BRAIN LOGIC
            # Ensure brains are loaded
            if self.nfo_master_df is None: self.load_master_into_memory("NFO")
            if self.bfo_master_df is None: self.load_master_into_memory("BFO")
            
            q_data = {}
            chunk_size = 50
            slugs = []

            # Build slugs by checking both brains
            for pos in processed_positions:
                symbol = pos['symbol']
                found = False
                
                # Try NFO
                if self.nfo_master_df is not None:
                    match = self.nfo_master_df[self.nfo_master_df['pTrdSymbol'] == symbol]
                    if not match.empty:
                        exchange_token = str(match.iloc[0]['pSymbol']).strip()
                        slugs.append(f"nse_fo|{exchange_token}")
                        found = True
                
                # Try BFO (if not in NFO)
                if not found and self.bfo_master_df is not None:
                    match = self.bfo_master_df[self.bfo_master_df['pTrdSymbol'] == symbol]
                    if not match.empty:
                        exchange_token = str(match.iloc[0]['pSymbol']).strip()
                        slugs.append(f"bse_fo|{exchange_token}")
                        found = True
                
                # Fallback
                if not found:
                    slugs.append(f"{pos['segment']}|{symbol}")

            # Fetch quotes
            if slugs:
                for i in range(0, len(slugs), chunk_size):
                    chunk = slugs[i:i + chunk_size]
                    q_url = f"{base_url}/script-details/1.0/quotes/neosymbol/{','.join(chunk)}"
                    try:
                        q_r = self.api_session.get(q_url, headers=self.get_headers(), timeout=2)
                        if q_r.status_code == 200:
                            res = q_r.json()
                            items = res.get("data") if isinstance(res, dict) else res
                            if isinstance(items, list):
                                for item in items:
                                    if isinstance(item, dict):
                                        exchange_token = item.get('exchange_token')
                                        ltp_val = item.get('ltp')
                                        if exchange_token and ltp_val is not None:
                                            q_data[exchange_token] = float(ltp_val)
                    except: pass

            # 4. CALCULATE MTM P&L
            for p in processed_positions:
                # Find Token Again (To match with q_data)
                exchange_token = None
                
                # Check NFO
                if self.nfo_master_df is not None:
                    match = self.nfo_master_df[self.nfo_master_df['pTrdSymbol'] == p['symbol']]
                    if not match.empty: exchange_token = str(match.iloc[0]['pSymbol']).strip()
                
                # Check BFO
                if exchange_token is None and self.bfo_master_df is not None:
                    match = self.bfo_master_df[self.bfo_master_df['pTrdSymbol'] == p['symbol']]
                    if not match.empty: exchange_token = str(match.iloc[0]['pSymbol']).strip()

                # Get LTP
                ltp = q_data.get(exchange_token, 0.0)
                p["ltp"] = ltp

                if ltp > 0:
                    net_qty = p["net_quantity"]
                    if net_qty > 0: pnl_unrealized = (ltp - p["buy_avg"]) * net_qty
                    else: pnl_unrealized = (p["sell_avg"] - ltp) * abs(net_qty)

                    p["pnl_unrealized"] = round(pnl_unrealized, 2)
                    p["pnl_total"] = round(p["pnl_realized"] + p["pnl_unrealized"], 2)
                else:
                    p["pnl_unrealized"] = 0.0
                    p["pnl_total"] = p["pnl_realized"]

            return {"success": True, "positions": processed_positions, "timestamp": datetime.now().isoformat()}

        except Exception as e:
            logger.error(f"Positions Logic Error: {e}")
            return {"success": False, "message": str(e)}

    def get_demo_chain(self):
        """Get demo chain data"""
        try:
            from strategy.demo_data import demo
            chain = demo.get_chain()
            
            # Find highest OI
            highest_ce = max(chain, key=lambda x: x["call"]["oi"])["strike"]
            highest_pe = max(chain, key=lambda x: x["put"]["oi"])["strike"]
            
            return {
                "success": True,
                "data": chain,
                "spot": demo.spot,
                "highest_ce": highest_ce,
                "highest_pe": highest_pe
            }
        except Exception as e:
            return {"success": False, "message": str(e)}
    
    def get_order_book(self):
        if not self.current_user or self.current_user not in self.active_sessions:
            return {"success": False, "message": "Not logged in"}
        try:
            base_url = self.active_sessions[self.current_user]["base_url"]
            url = f"{base_url}/quick/user/orders"
            response = requests.get(url, headers=self.get_headers())
            
            if response.status_code != 200: 
                return {"success": False, "message": f"HTTP error {response.status_code}"}
            
            res_json = response.json()
            status = res_json.get("stat", "").lower()
            if status not in ["ok", "okay", "success"]:
                error_msg = res_json.get("emsg", "Order book failed").lower()
    
                # Check if it's "no orders" vs real error
                if any(phrase in error_msg for phrase in ["no orders", "no data", "empty", "not found"]):
                    return {"success": True, "orders": []}  # ✅ Return empty list, not error!
                else:
                    return {"success": False, "message": res_json.get("emsg", "Order book failed")}

            orders = res_json.get('data', [])
            enhanced_orders = []
            
            for order in orders:
                # 1. FIX: Use 'ordSt' for status (Kotak specific)
                kotak_status = order.get('ordSt', '').upper()
                our_status = self.map_order_status(kotak_status)
                
                # 2. FIX: Use 'nOrdNo' for ID and 'ordDtTm' for Time
                enhanced_orders.append({
                    "unique_id": str(uuid.uuid4()),
                    "order_number": order.get('nOrdNo'),   # <--- The correct ID
                    "symbol": order.get('trdSym'),
                    "transaction_type": order.get('trnsTp'),
                    "quantity": order.get('qty'),
                    "price": order.get('avgPrc') or order.get('prc'),
                    "order_type": order.get('ordTyp'),     # Usually 'ordTyp' or 'prcTp'
                    "product": order.get('prod'),
                    "status": our_status,
                    "kotak_status": kotak_status,
                    "timestamp": order.get('ordDtTm'),     # <--- FIX: This solves the "N/A"
                    "filled_quantity": order.get('fldQty', 0),
                    "pending_quantity": order.get('pendQty', 0),
                    "exchange": order.get('exSeg', '')
                })
            
            # Sort by time (newest first)
            enhanced_orders.sort(key=lambda x: x['timestamp'] or '', reverse=True)
            
            return {"success": True, "orders": enhanced_orders, "timestamp": datetime.now().isoformat()}
        except Exception as e:
            return {"success": False, "message": str(e)}
    def get_position_ltp_only(self, position_symbols):
        """Fetch LTP, BID, and ASK for symbols (Dual Brain Support)"""
        if not self.current_user or self.current_user not in self.active_sessions:
            return {"success": False, "message": "Not logged in"}
        
        if not position_symbols:
            return {"success": True, "ltp_data": {}, "timestamp": datetime.now().isoformat()}
        
        try:
            session = self.active_sessions[self.current_user]
            base_url = session["base_url"]
            
            # Ensure brains are loaded
            if self.nfo_master_df is None: self.load_master_into_memory("NFO")
            if self.bfo_master_df is None: self.load_master_into_memory("BFO")

            slugs = []
            symbol_to_token = {}
            
            # 1. Resolve Symbols to Tokens
            for symbol in position_symbols:
                found = False
                # Try NFO
                if self.nfo_master_df is not None:
                    match = self.nfo_master_df[self.nfo_master_df['pTrdSymbol'] == symbol]
                    if not match.empty:
                        exchange_token = str(match.iloc[0]['pSymbol']).strip()
                        slugs.append(f"nse_fo|{exchange_token}")
                        symbol_to_token[symbol] = exchange_token
                        found = True
                
                # Try BFO
                if not found and self.bfo_master_df is not None:
                    match = self.bfo_master_df[self.bfo_master_df['pTrdSymbol'] == symbol]
                    if not match.empty:
                        exchange_token = str(match.iloc[0]['pSymbol']).strip()
                        slugs.append(f"bse_fo|{exchange_token}")
                        symbol_to_token[symbol] = exchange_token
                        found = True

                # Fallback
                if not found:
                    seg = "bse_fo" if "SENSEX" in symbol or "BANKEX" in symbol else "nse_fo"
                    slugs.append(f"{seg}|{symbol}")
                    symbol_to_token[symbol] = symbol
            
            # 2. Fetch Data
            q_data = {}
            chunk_size = 50
            
            for i in range(0, len(slugs), chunk_size):
                chunk = slugs[i:i + chunk_size]
                q_url = f"{base_url}/script-details/1.0/quotes/neosymbol/{','.join(chunk)}"
                try:
                    q_r = self.api_session.get(q_url, headers=self.get_headers(), timeout=2)
                    if q_r.status_code == 200:
                        res = q_r.json()
                        items = res.get("data") if isinstance(res, dict) else res
                        if isinstance(items, list):
                            for item in items:
                                if isinstance(item, dict):
                                    tk = item.get('exchange_token')
                                    # Extract LTP, Bid, Ask
                                    ltp = float(item.get('ltp', 0))
                                    depth = item.get('depth', {})
                                    bid = float(depth.get('buy', [{}])[0].get('price', 0))
                                    ask = float(depth.get('sell', [{}])[0].get('price', 0))
                                    
                                    if tk:
                                        q_data[tk] = {"ltp": ltp, "bid": bid, "ask": ask}
                except: continue
            
            # 3. Map back to Symbols
            final_data = {}
            for symbol, token in symbol_to_token.items():
                # Return the full object {ltp, bid, ask} or default
                final_data[symbol] = q_data.get(token, {"ltp": 0, "bid": 0, "ask": 0})
            
            return {
                "success": True, 
                "ltp_data": final_data, 
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            return {"success": False, "message": str(e)}
    
    def map_order_status(self, kotak_status: str) -> str:
        status_map = {
            'PENDING': ['PENDING', 'OPEN', 'TRANSIT', 'VALIDATION_PENDING'],
            'COMPLETED': ['COMPLETE', 'FILLED', 'EXECUTED', 'FULLY_FILLED'],
            'CANCELLED': ['CANCELLED', 'REJECTED', 'EXPIRED', 'CANCELLED_BY_USER']
        }
        for our_status, k_statuses in status_map.items():
            if kotak_status.upper() in k_statuses: return our_status
        return 'PENDING'

    def modify_order(self, order_number: str, symbol: str, new_price: float = None, new_quantity: int = None, new_order_type: str = None, new_expiry: str = None, new_trigger_price: float = None) -> Dict:
        if not self.current_user or self.current_user not in self.active_sessions:
            return {"success": False, "message": "Not logged in"}
        
        try:
            # Handle Expiry Change (Cancel + Place New)
            if new_expiry:
                return self._handle_expiry_change(order_number, symbol, new_expiry, new_price, new_quantity, new_order_type)

            base_url = self.active_sessions[self.current_user]["base_url"]
            url = f"{base_url}/quick/order/vr/modify"
            
            # 1. Fetch Order Book to verify ID
            # We use a slightly longer timeout (5s) here to be safe
            order_book = self.get_order_book()
            
            if not order_book.get("success"):
                return {"success": False, "message": f"Order Book Fetch Failed: {order_book.get('message')}"}

            order_details = None
            for order in order_book.get("orders", []):
                # Compare as strings to be safe
                if str(order.get("order_number")) == str(order_number):
                    order_details = order
                    break
            
            if not order_details:
                return {"success": False, "message": f"Order {order_number} not found in Order Book"}

            # 2. Prepare Modify Payload
            modify_data = {
                "tk": "", "mp": "0", 
                "pc": order_details.get('product', 'NRML'), 
                "dd": "NA", "dq": "0", "vd": "DAY",
                "ts": symbol, 
                "tt": order_details.get('transaction_type', 'B'),
                "pr": str(new_price) if new_price else order_details.get('price', '0'),
                "tp": str(new_trigger_price) if new_trigger_price else order_details.get('trigger_price', '0'), 
                "qt": str(new_quantity) if new_quantity else order_details.get('quantity', '0'),
                "no": str(order_number), 
                "es": "nse_fo",
                "pt": new_order_type if new_order_type else order_details.get('order_type', 'L')
            }

            jdata = f"jData={urllib.parse.quote_plus(json.dumps(modify_data, separators=(',', ':')))}"
            headers = {"Content-Type": "application/x-www-form-urlencoded", "accept": "application/json"}
            auth_headers = self.get_headers()
            auth_headers.update(headers)
            
            # 3. Send Request
            response = self.api_session.post(url, headers=auth_headers, data=jdata, timeout=5)
            
            if response.ok:
                res_json = response.json()
                if res_json.get("stat") == "Ok":
                    return {"success": True, "order_number": res_json.get("nOrdNo")}
                return {"success": False, "message": res_json.get("emsg", "Unknown Error")}
            
            return {"success": False, "message": f"HTTP {response.status_code}"}

        except Exception as e:
            logger.error(f"Modify Error: {e}")
            return {"success": False, "message": str(e)}

    def _handle_expiry_change(self, order_number, symbol, new_expiry, new_price, new_quantity, new_order_type):
        cancel_res = self.cancel_order(order_number)
        if not cancel_res.get("success"): return cancel_res
        return {"success": False, "message": "Expiry change requires full symbol map"}
    def place_order(self, trading_symbol, transaction_type, quantity, product_code="NRML", price="0", order_type="MKT", validity="DAY", am_flag="NO", segment="NFO", trigger_price=None):
        from datetime import datetime
        current_time = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        
        # DEBUG 1
        logger.info(f"[{current_time}] 🎯 place_order: Symbol={trading_symbol}, Action={transaction_type}, Qty={quantity}, Segment={segment}, Trig={trigger_price}")
        
        if not self.current_user: 
            logger.info(f"[{current_time}] ❌ ABORTED: Not logged in")
            return {"success": False, "message": "Not logged in"}
        
        # DEBUG 2
        logger.info(f"[{current_time}] ✅ User: {self.current_user}")
        
        if self.current_user not in self.active_sessions:
            logger.info(f"[{current_time}] ❌ No session for: {self.current_user}")
            return {"success": False, "message": "Session expired"}
        
        session = self.active_sessions[self.current_user]
        base_url = session["base_url"]
        
        # DEBUG 3
        logger.info(f"[{current_time}] ✅ Base URL: {base_url}, Token exists: {'token' in session}")
        
        url = f"{base_url}/quick/order/rule/ms/place"
        es_value = "bse_fo" if segment == "BFO" else "nse_fo"

        # === FIX: Use actual trigger_price if provided, else "0" ===
        tp_value = str(trigger_price) if trigger_price and float(trigger_price) > 0 else "0"

        order_payload = {
            "am": am_flag, "dq": "0", "es": es_value, "mp": "0", 
            "pc": product_code, "pf": "N", "pr": str(price), "pt": order_type, 
            "qt": str(quantity), "rt": validity, 
            "tp": tp_value, 
            "ts": trading_symbol, "tt": transaction_type
        }
        
        # DEBUG 4
        logger.info(f"[{current_time}] ✅ Payload: Action={transaction_type}, Qty={quantity}, Trig={tp_value}")
        
        data = f"jData={urllib.parse.quote_plus(json.dumps(order_payload, separators=(',', ':')))}"
        headers = {"Content-Type": "application/x-www-form-urlencoded", "accept": "application/json"}
        
        try:
            auth_headers = self.get_headers()
            auth_headers.update(headers)
            
            # DEBUG headers safely
            header_keys = list(auth_headers.keys())
            safe_headers = {}
            for k, v in auth_headers.items():
                if any(s in k.lower() for s in ['authorization', 'auth', 'sid', 'token']):
                    safe_headers[k] = '***HIDDEN***'
                else:
                    safe_headers[k] = v
            
            logger.info(f"[{current_time}] 🔑 Headers sent: {safe_headers}")
            logger.info(f"[{current_time}] 📤 Sending to Kotak URL: {url}")
            
            response = requests.post(url, headers=auth_headers, data=data, timeout=10)
            
            # DEBUG 6
            logger.info(f"[{current_time}] 📥 Kotak Response: Status={response.status_code}")
            
            if response.ok:
                res_json = response.json()
                
                # DEBUG 7
                logger.info(f"[{current_time}] 🔵 Response: Stat={res_json.get('stat')}, Msg={res_json.get('emsg', 'No message')}")
                
                if res_json.get("stat") == "Ok": 
                    order_num = res_json.get("nOrdNo")
                    logger.info(f"[{current_time}] ✅ ORDER SUCCESS #{order_num}")
                    return {"success": True, "order_number": order_num}
                else: 
                    logger.info(f"[{current_time}] ❌ ORDER FAILED: {res_json}")
                    return {"success": False, "message": res_json.get("emsg")}
            
            # DEBUG 8
            logger.info(f"[{current_time}] ❌ HTTP Error {response.status_code}: {response.text[:200]}")
            return {"success": False, "message": f"HTTP {response.status_code}"}
        
        except Exception as ex: 
            logger.info(f"[{current_time}] 💥 Exception: {ex}")
            import traceback
            logger.info(f"[{current_time}] 💥 Traceback: {traceback.format_exc()}")
            return {"success": False, "message": str(ex)} 
       
       
    def cancel_order(self, order_number: str):
        if not self.current_user: 
            return {"success": False, "message": "Not logged in"}
        
        base_url = self.active_sessions[self.current_user]["base_url"]
        url = f"{base_url}/quick/order/cancel"
        data = f"jData={urllib.parse.quote_plus(json.dumps({'am':'NO','on':str(order_number)}, separators=(',', ':')))}"
        headers = {"Content-Type": "application/x-www-form-urlencoded", "accept": "application/json"}
        
        try:
            auth_headers = self.get_headers()
            auth_headers.update(headers)
            response = requests.post(url, headers=auth_headers, data=data)
            
            if response.ok:
                res_json = response.json()
                if res_json.get("stat") == "Ok": 
                    return {"success": True, "message": "Order cancelled"}
                return {"success": False, "message": res_json.get("emsg")}
            
            return {"success": False, "message": f"HTTP {response.status_code}"}
        
        except Exception as ex: 
            return {"success": False, "message": str(ex)}