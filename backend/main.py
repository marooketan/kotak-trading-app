import os
import logging
from fastapi import FastAPI, Form, Query, Request
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import requests
from datetime import datetime
import pandas as pd
from typing import Dict, List, Optional
import re
import json
import urllib.parse
import time
import uuid

MASTERFILENAME = "kotak_master_live.csv"
MASTERPATH = os.path.join(os.path.expanduser("~"), "Desktop", MASTERFILENAME)

from config import KOTAK_CONFIG

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MY_MPIN = "523698"

class KotakNiftyAPI:
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

    def get_headers(self):
        return {
            "Authorization": self.access_token,
            "Auth": self.session_data["token"],
            "Sid": self.session_data["sid"],
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/json"
        }

    def make_authenticated_request(self, method, url, headers=None, data=None, params=None, max_retries=1):
        if headers is None:
            headers = {}
        headers.update({
            "Auth": self.session_data.get("token", ""),
            "Sid": self.session_data.get("sid", ""),
            "neo-fin-key": "neotradeapi"
        })

        for attempt in range(max_retries + 1):
            if method.lower() == "post":
                response = requests.post(url, headers=headers, data=data)
            elif method.lower() == "get":
                response = requests.get(url, headers=headers, params=params)
            else:
                raise ValueError("Unsupported HTTP method")

            if response.status_code == 401:
                if attempt < max_retries:
                    print("Token expired, please re-login manually for now.")
                    raise Exception("Token expired. Re-login required.")
                else:
                    break
            else:
                return response
            time.sleep(1)
        return response

    def place_order(self, trading_symbol, transaction_type, quantity, product_code="NRML", price="0", order_type="MKT",
                    validity="DAY", am_flag="NO"):
        if not self.session_data["authenticated"]:
            return {"success": False, "message": "Not logged in"}

        order_payload = {
            "am": am_flag,
            "dq": "0",
            "es": "nse_fo",
            "mp": "0",
            "pc": product_code,
            "pf": "N",
            "pr": price,
            "pt": order_type,
            "qt": str(quantity),
            "rt": validity,
            "tp": "0",
            "ts": trading_symbol,
            "tt": transaction_type
        }

        jdata_str = json.dumps(order_payload, separators=(',', ':'))
        data = f"jData={urllib.parse.quote_plus(jdata_str)}"

        url = f"{self.session_data['base_url']}/quick/order/rule/ms/place"
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "accept": "application/json"
        }

        try:
            response = self.make_authenticated_request("post", url, headers=headers, data=data)
        except Exception as ex:
            return {"success": False, "message": f"Authentication error: {str(ex)}"}

        if response.ok:
            res_json = response.json()
            if res_json.get("stat") == "Ok":
                return {"success": True, "order_number": res_json.get("nOrdNo")}
            else:
                return {"success": False, "message": res_json.get("emsg", "Order failed")}
        else:
            return {"success": False, "message": f"HTTP error {response.status_code}: {response.text}"}

    def login(self, totp_code: str) -> Dict:
        try:
            logger.info("🔄 Starting Kotak authentication...")
            login_url = "https://mis.kotaksecurities.com/login/1.0/tradeApiLogin"
            headers = {"Authorization": self.access_token, "neo-fin-key": "neotradeapi", "Content-Type": "application/json"}

            r1 = requests.post(login_url, json={"mobileNumber": self.mobile, "ucc": self.client_code, "totp": totp_code}, headers=headers)
            if r1.status_code != 200: 
                return {"success": False, "message": f"TOTP failed: {r1.text}"}
            d1 = r1.json()
            if "data" not in d1: 
                return {"success": False, "message": "Invalid TOTP response"}

            headers.update({"sid": d1["data"]["sid"], "Auth": d1["data"]["token"]})
            logger.info(f"🔑 Using Hardcoded MPIN: {MY_MPIN}")

            r2 = requests.post("https://mis.kotaksecurities.com/login/1.0/tradeApiValidate", json={"mpin": MY_MPIN}, headers=headers)
            if r2.status_code != 200: 
                return {"success": False, "message": f"MPIN failed: {r2.text}"}

            d2 = r2.json()
            self.session_data.update({
                "base_url": d2["data"].get("baseUrl", self.session_data["base_url"]),
                "token": d2["data"]["token"],
                "sid": d2["data"]["sid"],
                "authenticated": True
            })

            logger.info("✅ Login Successful")
            self.download_master_file()
            return {"success": True, "message": "Login & Sync Complete"}
        except Exception as e:
            logger.error(f"❌ Login error: {e}")
            return {"success": False, "message": str(e)}

    def download_master_file(self):
        logger.info("⬇️ Checking Master File...")
        try:
            url_api = f"{self.session_data['base_url']}/script-details/1.0/masterscrip/file-paths"
            r = requests.get(url_api, headers=self.get_headers())
            data = r.json()
            fno_url = ""
            if "data" in data and "filesPaths" in data["data"]:
                for u in data["data"]["filesPaths"]:
                    if "nse_fo.csv" in u:
                        fno_url = u
                        break
            if fno_url:
                logger.info(f"📥 Downloading: {fno_url}")
                r = requests.get(fno_url)
                if r.status_code == 200:
                    with open(MASTERPATH, "wb") as f:
                        f.write(r.content)
                    logger.info("✅ Master File Updated")
                else:
                    logger.error(f"❌ Download failed: {r.status_code}")
            else:
                logger.warning("⚠️ Could not find NSE_FO URL")
        except Exception as e:
            logger.error(f"❌ Download Exception: {e}")

    def parse_symbol_date(self, sym):
        try:
            sym_str = str(sym)
            w_match = re.search(r'(NIFTY|BANKNIFTY)(\d{2})([1-9OND])(\d{2})', sym_str)
            if w_match:
                index_name, yy, m_char, dd = w_match.groups()
                m_map = {'1':'01','2':'02','3':'03','4':'04','5':'05','6':'06',
                         '7':'07','8':'08','9':'09','O':'10','N':'11','D':'12'}
                return f"{dd}-{m_map.get(m_char)}-20{yy}"
            m_match = re.search(r'(NIFTY|BANKNIFTY)(\d{2})([A-Z]{3})', sym_str)
            if m_match:
                index_name, yy, m_str = m_match.groups()
                return f"Ex-{m_str}-20{yy}"
        except:
            return None
        return None

    def get_nifty_expiries(self) -> List[str]:
        if not os.path.exists(MASTERPATH): return []
        try:
            try: df = pd.read_csv(MASTERPATH)
            except: df = pd.read_csv(MASTERPATH, sep='|')
            df.columns = df.columns.str.strip()
            nifty = df[df['pSymbolName'].astype(str).str.strip() == 'NIFTY'].copy()
            nifty['real_expiry'] = nifty['pTrdSymbol'].apply(self.parse_symbol_date)
            unique_dates = nifty['real_expiry'].dropna().unique()
            def sort_key(d):
                if d.startswith("Ex"): return datetime(2099, 1, 1)
                return datetime.strptime(d, "%d-%m-%Y")
            sorted_dates = sorted(unique_dates, key=sort_key)
            final_list = []
            for d in sorted_dates:
                if not d.startswith("Ex"):
                    dt = datetime.strptime(d, "%d-%m-%Y")
                    final_list.append(dt.strftime('%d-%b-%Y'))
                else:
                    final_list.append(d)
            return final_list
        except Exception as e:
            logger.error(f"Expiry Error: {e}")
            return []

    def get_expiries(self, index: str = "NIFTY") -> List[str]:
        if not os.path.exists(MASTERPATH): return []
        try:
            try: df = pd.read_csv(MASTERPATH)
            except: df = pd.read_csv(MASTERPATH, sep='|')
            df.columns = df.columns.str.strip()
            
            if index == "BANKNIFTY":
                filtered_df = df[df['pSymbolName'].astype(str).str.strip() == 'BANKNIFTY'].copy()
            else:
                filtered_df = df[df['pSymbolName'].astype(str).str.strip() == 'NIFTY'].copy()
                
            filtered_df['real_expiry'] = filtered_df['pTrdSymbol'].apply(self.parse_symbol_date)
            unique_dates = filtered_df['real_expiry'].dropna().unique()
            
            def sort_key(d):
                if d.startswith("Ex"): return datetime(2099, 1, 1)
                return datetime.strptime(d, "%d-%m-%Y")
                
            sorted_dates = sorted(unique_dates, key=sort_key)
            final_list = []
            for d in sorted_dates:
                if not d.startswith("Ex"):
                    dt = datetime.strptime(d, "%d-%m-%Y")
                    final_list.append(dt.strftime('%d-%b-%Y'))
                else:
                    final_list.append(d)
            return final_list
        except Exception as e:
            logger.error(f"Expiry Error for {index}: {e}")
            return []

    def get_nifty_option_chain(self, expiry: str, strike_count: int = 10):
        return self.get_option_chain("NIFTY", expiry, strike_count)
    def get_option_chain(self, index: str, expiry: str, strike_count: int = 10):
        if not self.session_data["authenticated"]:
            return {"success": False, "message": "Please Login First"}
        if not os.path.exists(MASTERPATH):
            return {"success": False, "message": "Master file missing"}
        try:
            # DEBUG: Print what the server received
            print(f"DEBUG: Request - Index: {index}, Expiry: {expiry}, Strikes: '{strike_count}'")

            try: df = pd.read_csv(MASTERPATH)
            except: df = pd.read_csv(MASTERPATH, sep='|')
            df.columns = df.columns.str.strip()
            
            if index == "BANKNIFTY":
                df = df[df['pSymbolName'].astype(str).str.strip() == 'BANKNIFTY']
                spot_symbol = "Nifty Bank"
            else:
                df = df[df['pSymbolName'].astype(str).str.strip() == 'NIFTY']
                spot_symbol = "Nifty 50"
                
            df['real_expiry'] = df['pTrdSymbol'].apply(self.parse_symbol_date)
            target_expiry = expiry
            if "-" in expiry and not expiry.startswith("Ex"):
                dt_obj = datetime.strptime(expiry, "%d-%b-%Y")
                target_expiry = dt_obj.strftime("%d-%m-%Y")
            df = df[df['real_expiry'] == target_expiry]
            
            if df.empty:
                return {"success": False, "message": f"No data found for {index} {expiry}"}
            
            # Fetch Spot Price
            spot_url = f"{self.session_data['base_url']}/script-details/1.0/quotes/neosymbol/nse_cm|{spot_symbol}"
            r_spot = requests.get(spot_url, headers=self.get_headers())
            spot = 0
            if r_spot.status_code == 200:
                d = r_spot.json()
                if isinstance(d, list):
                    spot = float(d[0]['ltp'])
                elif 'data' in d:
                    spot = float(d['data'][0]['ltp'])
            
            # Map tokens
            token_map = {}
            for _, row in df.iterrows():
                try:
                    col = 'dStrikePrice' if 'dStrikePrice' in df.columns else 'dStrikePrice;'
                    strike = int(float(row[col]) / 100)
                    token = str(row['pSymbol']).strip()
                    otype = row['pOptionType']
                    if strike not in token_map:
                        token_map[strike] = {}
                    token_map[strike][otype] = token
                except:
                    continue

            all_strikes = sorted(token_map.keys())
            if not all_strikes: 
                return {"success": False, "message": "No strikes found"}

            # === FIXED: Handle 'all' vs Numbers ===
            req_strikes = str(strike_count).lower().strip()
            
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
                    
                    # LOGIC CHANGE: Removed //2 so "5" means 5 up AND 5 down
                    start = max(0, idx - s_count)
                    end = min(len(all_strikes), idx + s_count + 1)
                    
                    selected_strikes = all_strikes[start:end]
                else:
                    selected_strikes = all_strikes[:s_count]

            # Recalculate ATM for display
            atm_display = min(all_strikes, key=lambda x: abs(x - spot)) if spot > 0 else 0

            # === NEW: Batch Fetching to prevent URL Limit Errors ===
            slugs = []
            for s in selected_strikes:
                if 'CE' in token_map[s]: slugs.append(f"nse_fo|{token_map[s]['CE']}")
                if 'PE' in token_map[s]: slugs.append(f"nse_fo|{token_map[s]['PE']}")

            q_data = {}
            if slugs:
                chunk_size = 50 # Fetch 50 symbols at a time
                for i in range(0, len(slugs), chunk_size):
                    chunk = slugs[i:i + chunk_size]
                    q_url = f"{self.session_data['base_url']}/script-details/1.0/quotes/neosymbol/{','.join(chunk)}"
                    try:
                        q_r = requests.get(q_url, headers=self.get_headers())
                        if q_r.status_code == 200:
                            res = q_r.json()
                            items = res['data'] if isinstance(res, dict) and 'data' in res else res
                            if isinstance(items, list):
                                for item in items:
                                    if isinstance(item, dict):
                                        q_data[item.get('exchange_token')] = item
                    except Exception as e:
                        print(f"DEBUG: Chunk fetch failed: {e}")

            # Build Response
            chain_data = []
            for s in selected_strikes:
                ce_token = token_map[s].get('CE')
                pe_token = token_map[s].get('PE')
                ce = q_data.get(ce_token, {})
                pe = q_data.get(pe_token, {})

                def get_p(d, side): 
                    return d.get('depth', {}).get(side, [{}])[0].get('price', 0) if isinstance(d, dict) else 0
                def get_v(d, k): 
                    return d.get(k, 0) if isinstance(d, dict) else 0

                ce_row = df[(df[col] == s * 100) & (df['pOptionType'] == 'CE')]
                pe_row = df[(df[col] == s * 100) & (df['pOptionType'] == 'PE')]
                ce_symbol = str(ce_row['pTrdSymbol'].values[0]).strip() if not ce_row.empty else None
                pe_symbol = str(pe_row['pTrdSymbol'].values[0]).strip() if not pe_row.empty else None

                chain_data.append({
                    "strike": s,
                    "call": {"bid": get_p(ce, 'buy'), "ask": get_p(ce, 'sell'), "ltp": get_v(ce, 'ltp'), "oi": get_v(ce, 'open_int'), "pTrdSymbol": ce_symbol},
                    "put": {"bid": get_p(pe, 'buy'), "ask": get_p(pe, 'sell'), "ltp": get_v(pe, 'ltp'), "oi": get_v(pe, 'open_int'), "pTrdSymbol": pe_symbol},
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
            logger.error(f"Chain Error for {index}: {e}")
            return {"success": False, "message": str(e)}
   
    def get_order_book(self):
        """Get complete order book with enhanced status mapping and unique IDs"""
        if not self.session_data["authenticated"]:
            return {"success": False, "message": "Not logged in"}

        try:
            url = f"{self.session_data['base_url']}/quick/user/orders"
            headers = self.get_headers()

            response = requests.get(url, headers=headers)
            if response.status_code != 200:
                return {"success": False, "message": f"HTTP error {response.status_code}"}

            res_json = response.json()
            if res_json.get("stat") not in ["Ok", "ok"]:
                return {"success": False, "message": res_json.get("emsg", "Order book failed")}

            orders = res_json.get('data', [])
            enhanced_orders = []

            for order in orders:
                kotak_status = order.get('ordSt', '').upper()
                our_status = self.map_order_status(kotak_status)

                unique_id = str(uuid.uuid4())

                enhanced_order = {
                    "unique_id": unique_id,
                    "order_number": order.get('nOrdNo'),
                    "symbol": order.get('trdSym'),
                    "transaction_type": order.get('trnsTp'),
                    "quantity": order.get('qty'),
                    "price": order.get('prc'),
                    "order_type": order.get('ordTyp'),
                    "product": order.get('prod'),
                    "status": our_status,
                    "kotak_status": kotak_status,
                    "timestamp": order.get('ordTm'),
                    "filled_quantity": order.get('fldQty', 0),
                    "pending_quantity": order.get('pendQty', 0),
                    "exchange": order.get('exSeg', '')
                }
                enhanced_orders.append(enhanced_order)

            return {
                "success": True,
                "orders": enhanced_orders,
                "total_orders": len(enhanced_orders),
                "timestamp": datetime.now().isoformat()
            }

        except Exception as e:
            logger.error(f"Order book error: {e}")
            return {"success": False, "message": str(e)}

    def map_order_status(self, kotak_status: str) -> str:
        """Map Kotak order status to our categories"""
        status_map = {
            'PENDING': ['PENDING', 'OPEN', 'TRANSIT', 'VALIDATION_PENDING'],
            'COMPLETED': ['COMPLETE', 'FILLED', 'EXECUTED', 'FULLY_FILLED'],
            'CANCELLED': ['CANCELLED', 'REJECTED', 'EXPIRED', 'CANCELLED_BY_USER']
        }

        kotak_status_upper = kotak_status.upper()

        for our_status, kotak_statuses in status_map.items():
            if kotak_status_upper in kotak_statuses:
                return our_status

        return 'PENDING'

    def modify_order(self, order_number: str, symbol: str, new_price: float = None, 
                    new_quantity: int = None, new_order_type: str = None, 
                    new_expiry: str = None) -> Dict:
        """Modify an existing order with expiry change support"""
        if not self.session_data["authenticated"]:
            return {"success": False, "message": "Not logged in"}

        try:
            if new_expiry:
                return self._handle_expiry_change(order_number, symbol, new_expiry, new_price, new_quantity, new_order_type)

            url = f"{self.session_data['base_url']}/quick/order/vr/modify"
            headers = {
                "Content-Type": "application/x-www-form-urlencoded",
                "accept": "application/json"
            }

            order_details = self._get_order_details(order_number)
            if not order_details:
                return {"success": False, "message": "Could not fetch order details"}

            modify_data = {
                "tk": order_details.get('token', ''),
                "mp": "0",
                "pc": order_details.get('product', 'NRML'),
                "dd": "NA",
                "dq": "0",
                "vd": "DAY",
                "ts": symbol,
                "tt": order_details.get('transaction_type', 'B'),
                "pr": str(new_price) if new_price else order_details.get('price', '0'),
                "tp": "0",
                "qt": str(new_quantity) if new_quantity else order_details.get('quantity', '0'),
                "no": str(order_number),
                "es": "nse_fo",
                "pt": new_order_type if new_order_type else order_details.get('order_type', 'L')
            }

            jdata_str = json.dumps(modify_data, separators=(',', ':'))
            post_data = f"jData={urllib.parse.quote_plus(jdata_str)}"

            response = requests.post(url, headers={**self.get_headers(), **headers}, data=post_data)

            if response.ok:
                res_json = response.json()
                if res_json.get("stat") == "Ok":
                    return {"success": True, "order_number": res_json.get("nOrdNo")}
                else:
                    return {"success": False, "message": res_json.get("emsg", "Modify failed")}
            else:
                return {"success": False, "message": f"HTTP error {response.status_code}"}

        except Exception as e:
            return {"success": False, "message": f"Modify order error: {str(e)}"}

    def _handle_expiry_change(self, order_number: str, symbol: str, new_expiry: str,
                             new_price: float, new_quantity: int, new_order_type: str) -> Dict:
        """Handle expiry change by cancelling old order and placing new one"""
        try:
            order_details = self._get_order_details(order_number)
            if not order_details:
                return {"success": False, "message": "Could not fetch order details for expiry change"}

            cancel_result = self.cancel_order(order_number)
            if not cancel_result.get("success"):
                return {"success": False, "message": f"Failed to cancel old order: {cancel_result.get('message')}"}

            new_symbol = self._change_symbol_expiry(symbol, new_expiry)
            if not new_symbol:
                return {"success": False, "message": "Could not create new symbol with changed expiry"}

            place_result = self.place_order(
                trading_symbol=new_symbol,
                transaction_type=order_details.get('transaction_type', 'B'),
                quantity=new_quantity if new_quantity else order_details.get('quantity', 0),
                product_code=order_details.get('product', 'NRML'),
                price=str(new_price) if new_price else order_details.get('price', '0'),
                order_type=new_order_type if new_order_type else order_details.get('order_type', 'L'),
                validity="DAY"
            )

            return place_result

        except Exception as e:
            return {"success": False, "message": f"Expiry change error: {str(e)}"}

    def _get_order_details(self, order_number: str) -> Dict:
        """Get details of a specific order"""
        try:
            order_book = self.get_order_book()
            if not order_book.get("success"):
                return None
                
            for order in order_book.get("orders", []):
                if order.get("order_number") == order_number:
                    return order
            return None
        except:
            return None

    def _change_symbol_expiry(self, symbol: str, new_expiry: str) -> str:
        """Change expiry in symbol string"""
        try:
            if "NIFTY" in symbol:
                base = "NIFTY"
            elif "BANKNIFTY" in symbol:
                base = "BANKNIFTY"
            else:
                return None

            strike_match = re.search(r'(\d{5})(CE|PE)$', symbol)
            if strike_match:
                strike = strike_match.group(1)
                option_type = strike_match.group(2)

                dt_obj = datetime.strptime(new_expiry, "%d-%b-%Y")
                expiry_code = dt_obj.strftime("%d%b%Y").upper()

                new_symbol = f"{base}{expiry_code}{strike}{option_type}"
                return new_symbol

            return None
        except:
            return None

    def cancel_order(self, order_number: str) -> Dict:
        """Cancel an order"""
        if not self.session_data["authenticated"]:
            return {"success": False, "message": "Not logged in"}

        try:
            url = f"{self.session_data['base_url']}/quick/order/cancel"
            headers = {
                "Content-Type": "application/x-www-form-urlencoded",
                "accept": "application/json"
            }

            cancel_data = {"am": "NO", "on": str(order_number)}
            jdata_str = json.dumps(cancel_data, separators=(',', ':'))
            post_data = f"jData={urllib.parse.quote_plus(jdata_str)}"

            response = requests.post(url, headers={**self.get_headers(), **headers}, data=post_data)

            if response.ok:
                res_json = response.json()
                if res_json.get("stat") == "Ok":
                    return {"success": True, "message": "Order cancelled successfully"}
                else:
                    return {"success": False, "message": res_json.get("emsg", "Cancel failed")}
            else:
                return {"success": False, "message": f"HTTP error {response.status_code}"}

        except Exception as e:
            return {"success": False, "message": f"Failed to cancel order: {str(e)}"}

kotak_api = KotakNiftyAPI()

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(lifespan=lifespan)

@app.post("/api/login")
async def login_api(totp: str = Form(...), mpin: str = Form(None)): 
    return kotak_api.login(totp)

@app.get("/api/expiries")
async def expiries_api():
    return {"success": True, "expiries": kotak_api.get_nifty_expiries()}

@app.get("/api/expiries-v2")
async def expiries_v2_api(index: str = Query("NIFTY")):
    return {"success": True, "expiries": kotak_api.get_expiries(index)}

@app.get("/api/option-chain")
async def chain_api(expiry: str, strikes: str = "10"): # Changed int to str
    return kotak_api.get_nifty_option_chain(expiry, strikes)

@app.get("/api/option-chain-v2")
async def chain_v2_api(expiry: str, index: str = Query("NIFTY"), strikes: str = "10"): # Changed int to str
    return kotak_api.get_option_chain(index, expiry, strikes)

@app.post("/api/place-order")
async def place_order_api(request: Request):
    try:
        data = await request.json()
        symbol = data.get("symbol")
        transaction_type = data.get("transaction_type")
        quantity = data.get("quantity")
        product_code = data.get("product_code", "NRML")
        price = data.get("price", "0")
        order_type = data.get("order_type", "MKT")
        validity = data.get("validity", "DAY")
        am_flag = data.get("am_flag", "NO")

        if not kotak_api.session_data["authenticated"]:
            return {"success": False, "message": "Not logged in, please login first."}

        result = kotak_api.place_order(
            trading_symbol=symbol,
            transaction_type=transaction_type,
            quantity=quantity,
            product_code=product_code,
            price=price,
            order_type=order_type,
            validity=validity,
            am_flag=am_flag
        )
        return result
    except Exception as e:
        return {"success": False, "message": f"Failed to place order: {str(e)}"}

@app.get("/api/order-status")
async def order_status_api(order_number: str = Query(...)):
    if not kotak_api.session_data["authenticated"]:
        return {"success": False, "message": "Not logged in"}
    return {"success": True, "order_number": order_number, "status": "PENDING"}

@app.post("/api/cancel-order")
async def cancel_order_api(request: Request):
    try:
        data = await request.json()
        order_number = data.get("order_number")

        if not kotak_api.session_data["authenticated"]:
            return {"success": False, "message": "Not logged in"}

        result = kotak_api.cancel_order(order_number)
        return result

    except Exception as e:
        return {"success": False, "message": f"Failed to cancel order: {str(e)}"}

@app.get("/api/status")
async def status_api():
    return {"authenticated": kotak_api.session_data["authenticated"]}

@app.get("/api/auth-status")
async def auth_status_api():
    return {"authenticated": kotak_api.session_data["authenticated"]}

@app.get("/api/index-quotes")
async def index_quotes():
    if not kotak_api.session_data["authenticated"]:
        return {"error": "Not logged in"}
    quotes_query = "nse_cm|Nifty 50,nse_cm|Nifty Bank,bse_cm|SENSEX/ltp"
    response = requests.get(
        f"{kotak_api.session_data['base_url']}/script-details/1.0/quotes/neosymbol/{quotes_query}",
        headers=kotak_api.get_headers()
    )
    if response.status_code != 200:
        return {"error": "Failed to fetch index prices"}
    data = response.json()
    result = []
    for d in data:
        token = d.get("exchange_token") or d.get("display_symbol")
        ltp_raw = d.get("ltp")
        try:
            ltp = f"{float(ltp_raw):.2f}"
        except (TypeError, ValueError):
            ltp = "0.00"
        result.append({"exchange_token": token, "ltp": ltp})
    return result

@app.get("/api/lot-size")
def lot_size(symbol: str = Query(...)):
    df = pd.read_csv(MASTERPATH)
    df.columns = df.columns.str.strip()
    row = df[df['pTrdSymbol'].astype(str).str.strip() == symbol]
    if row.empty:
        return {"success": False, "message": "Symbol not found"}
    lot_size = int(row.iloc[0]['lLotSize'])
    return {"success": True, "lot_size": lot_size}

# NEW ORDER HISTORY ENDPOINTS
@app.get("/api/order-book")
async def order_book_api():
    """Get complete order book with unique IDs and status mapping"""
    result = kotak_api.get_order_book()
    return result

@app.post("/api/modify-order")
async def modify_order_api(request: Request):
    """Modify an existing order"""
    try:
        data = await request.json()
        order_number = data.get("order_number")
        symbol = data.get("symbol")
        new_price = data.get("new_price")
        new_quantity = data.get("new_quantity")
        new_order_type = data.get("new_order_type")
        new_expiry = data.get("new_expiry")

        if not kotak_api.session_data["authenticated"]:
            return {"success": False, "message": "Not logged in"}

        result = kotak_api.modify_order(
            order_number=order_number,
            symbol=symbol,
            new_price=new_price,
            new_quantity=new_quantity,
            new_order_type=new_order_type,
            new_expiry=new_expiry
        )
        return result

    except Exception as e:
        return {"success": False, "message": f"Failed to modify order: {str(e)}"}

frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    logger.info("🚀 Server starting on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)