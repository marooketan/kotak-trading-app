import pandas as pd
import requests
import os
import urllib.parse

# CONFIG
MOBILE = "+919227132381"
CLIENT_CODE = "ZH329"
ACCESS_TOKEN = "c80a89d3-1ef2-4a2f-9900-82393343a824"
MASTER_PATH = r"C:\Users\Ketan\Desktop\kotak_master_live.csv"

def login():
    print("🔐 LOGIN PROCESS")
    totp = input("Enter 6-digit TOTP: ").strip()
    mpin = input("Enter 6-digit MPIN: ").strip()
    
    headers = {"Authorization": ACCESS_TOKEN, "neo-fin-key": "neotradeapi", "Content-Type": "application/json"}
    try:
        r1 = requests.post("https://mis.kotaksecurities.com/login/1.0/tradeApiLogin", 
                         json={"mobileNumber": MOBILE, "ucc": CLIENT_CODE, "totp": totp}, headers=headers)
        if r1.status_code != 200: 
            print(f"❌ TOTP Failed: {r1.text}")
            return None
        d1 = r1.json()
        headers.update({"sid": d1["data"]["sid"], "Auth": d1["data"]["token"]})
        r2 = requests.post("https://mis.kotaksecurities.com/login/1.0/tradeApiValidate", 
                         json={"mpin": mpin}, headers=headers)
        if r2.status_code != 200: 
            print(f"❌ MPIN Failed: {r2.text}")
            return None
        d2 = r2.json()
        print("✅ Login Successful!")
        return {
            "base_url": d2["data"].get("baseUrl", "https://mis.kotaksecurities.com"),
            "token": d2["data"]["token"],
            "sid": d2["data"]["sid"],
            "headers": headers
        }
    except Exception as e:
        print(f"❌ Login Error: {e}")
        return None

def fetch_index_prices(session):
    print("\n📈 FETCHING INDEX SPOT PRICES")
    try:
        quotes_query = "nse_cm|Nifty 50,nse_cm|Nifty Bank,bse_cm|SENSEX"
        r = requests.get(
            f"{session['base_url']}/script-details/1.0/quotes/neosymbol/{quotes_query}",
            headers=session['headers']
        )
        if r.status_code != 200:
            print(f"❌ Price Fetch Error: {r.text}")
            return None
        data = r.json()
        spot_prices = {}
        for item in data:
            symbol = item.get("display_symbol")
            ltp = float(item.get("ltp", 0))
            spot_prices[symbol] = ltp
            print(f"{symbol}: Spot = {ltp}")
        return spot_prices
    except Exception as e:
        print(f"❌ Index Fetch Error: {e}")
        return None

def download_file(session):
    print(f"\n⬇️ DOWNLOADING MASTER FILE to {MASTER_PATH}")
    try:
        r = requests.get(f"{session['base_url']}/script-details/1.0/masterscrip/file-paths", headers=session['headers'])
        data = r.json()
        url = ""
        if "data" in data and "filesPaths" in data["data"]:
            for u in data["data"]["filesPaths"]:
                if "nse_fo.csv" in u:
                    url = u
                    break
        if not url:
            print("❌ No URL found")
            return False
        print(f"📥 Downloading: {url}")
        r_file = requests.get(url)
        if r_file.status_code != 200:
            print(f"❌ Server Error: {r_file.status_code}")
            return False
        with open(MASTER_PATH, "wb") as f:
            f.write(r_file.content)
        print("✅ File Saved Successfully.")
        return True
    except Exception as e:
        print(f"❌ Download Error: {e}")
        return False
def find_atm_ce_pe(master_path, spot_price):
    if not os.path.exists(master_path):
        print("❌ Master file not found.")
        return None, None
    try:
        df = pd.read_csv(master_path)
        df.columns = df.columns.str.strip()
        nifty_rows = df[df['pSymbolName'].str.strip() == 'NIFTY']
        
        print("🔍 DEBUG: Checking strike price column...")
        
        # Let's see what's in the strike price column
        strike_samples = nifty_rows['dStrikePrice;'].head(10).tolist()
        print(f"📊 Strike price samples: {strike_samples}")
        
        # Try alternative column names for strike price
        alternative_columns = ['dStrikePrice', 'StrikePrice', 'strike', 'Strike']
        found_strike_col = None
        
        for col in alternative_columns:
            if col in nifty_rows.columns:
                found_strike_col = col
                print(f"✅ Found alternative strike column: {col}")
                break
        
        if found_strike_col:
            strike_col = found_strike_col
        else:
            strike_col = 'dStrikePrice;'
        
        # Extract strike prices from symbol names as fallback
        print("🔍 Extracting strike prices from symbol names...")
        
        ce_symbols = []
        pe_symbols = []
        
        for _, row in nifty_rows.iterrows():
            symbol = str(row['pTrdSymbol']).strip()
            
            # Extract strike price from symbol name (NIFTY25DEC26200CE -> 26200)
            import re
            strike_match = re.search(r'(\d{5})(CE|PE)$', symbol)
            if strike_match:
                strike_price = int(strike_match.group(1))
                option_type = strike_match.group(2)
                
                if option_type == 'CE':
                    ce_symbols.append((strike_price, symbol))
                else:
                    pe_symbols.append((strike_price, symbol))
        
        print(f"📊 Found {len(ce_symbols)} CE options and {len(pe_symbols)} PE options")
        
        if ce_symbols and pe_symbols:
            # Find ATM strikes (closest to spot)
            ce_atm = min(ce_symbols, key=lambda x: abs(x[0] - spot_price))
            pe_atm = min(pe_symbols, key=lambda x: abs(x[0] - spot_price))
            
            print(f"🎯 ATM CE: {ce_atm[1]} (Strike: {ce_atm[0]})")
            print(f"🎯 ATM PE: {pe_atm[1]} (Strike: {pe_atm[0]})")
            
            return ce_atm[1], pe_atm[1]
        else:
            print("❌ Could not extract strike prices from symbols")
            return None, None
        
    except Exception as e:
        print(f"❌ Error parsing master file: {e}")
        import traceback
        traceback.print_exc()
        return None, None
def find_banknifty_expiries(master_path):
    if not os.path.exists(master_path):
        print("❌ Master file not found.")
        return []
    
    try:
        df = pd.read_csv(master_path)
        df.columns = df.columns.str.strip()
        
        # Filter for BANKNIFTY
        banknifty_rows = df[df['pSymbolName'].str.strip() == 'BANKNIFTY']
        
        if banknifty_rows.empty:
            print("❌ No BANKNIFTY symbols found in master file")
            return []
        
        print("🔍 BANKNIFTY Symbols found:")
        print(banknifty_rows[['pTrdSymbol', 'pSymbolName']].head(10))
        
        # Extract expiry dates from symbol names
        expiries = set()
        
        for _, row in banknifty_rows.iterrows():
            symbol = str(row['pTrdSymbol']).strip()
            
            # Pattern for BANKNIFTY symbols: BANKNIFTY25DEC48000CE
            import re
            expiry_match = re.search(r'BANKNIFTY(\d{2})([A-Z]{3})(\d+)', symbol)
            if expiry_match:
                yy, month_char, strike = expiry_match.groups()
                
                # Convert month character to month number
                month_map = {
                    'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
                    'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
                }
                
                if month_char in month_map:
                    month_num = month_map[month_char]
                    expiry_date = f"20{yy}-{month_num}"
                    expiries.add(expiry_date)
        
        # Convert to sorted list
        sorted_expiries = sorted(expiries)
        print(f"\n📅 BANKNIFTY Expiries found: {sorted_expiries}")
        
        return sorted_expiries
        
    except Exception as e:
        print(f"❌ Error finding BANKNIFTY expiries: {e}")
        import traceback
        traceback.print_exc()
        return []
def find_banknifty_atm_options(master_path, spot_price):
    if not os.path.exists(master_path):
        print("❌ Master file not found.")
        return None, None
    
    try:
        df = pd.read_csv(master_path)
        df.columns = df.columns.str.strip()
        
        # Filter for BANKNIFTY
        banknifty_rows = df[df['pSymbolName'].str.strip() == 'BANKNIFTY']
        
        print(f"🔍 Finding BANKNIFTY ATM options for spot: {spot_price}")
        
        # Extract strike prices from symbol names
        ce_symbols = []
        pe_symbols = []
        
        for _, row in banknifty_rows.iterrows():
            symbol = str(row['pTrdSymbol']).strip()
            
            # Pattern for BANKNIFTY symbols: BANKNIFTY25DEC48000CE
            import re
            strike_match = re.search(r'BANKNIFTY\d{2}[A-Z]{3}(\d{5})(CE|PE)', symbol)
            if strike_match:
                strike_price = int(strike_match.group(1))
                option_type = strike_match.group(2)
                
                if option_type == 'CE':
                    ce_symbols.append((strike_price, symbol))
                else:
                    pe_symbols.append((strike_price, symbol))
        
        print(f"📊 Found {len(ce_symbols)} BANKNIFTY CE options and {len(pe_symbols)} BANKNIFTY PE options")
        
        if ce_symbols and pe_symbols:
            # Find ATM strikes (closest to spot)
            ce_atm = min(ce_symbols, key=lambda x: abs(x[0] - spot_price))
            pe_atm = min(pe_symbols, key=lambda x: abs(x[0] - spot_price))
            
            print(f"🏦 BANKNIFTY ATM CE: {ce_atm[1]} (Strike: {ce_atm[0]})")
            print(f"🏦 BANKNIFTY ATM PE: {pe_atm[1]} (Strike: {pe_atm[0]})")
            
            return ce_atm[1], pe_atm[1]
        else:
            print("❌ Could not extract BANKNIFTY strike prices from symbols")
            return None, None
        
    except Exception as e:
        print(f"❌ Error parsing BANKNIFTY options: {e}")
        import traceback
        traceback.print_exc()
        return None, None
def fetch_option_prices(session, ce_symbol, pe_symbol, master_path):
    print(f"\n💰 FETCHING OPTION PRICES")
    
    try:
        df = pd.read_csv(master_path)
        df.columns = df.columns.str.strip()
        
        # Get tokens for both options
        ce_row = df[df['pTrdSymbol'].str.strip() == ce_symbol]
        pe_row = df[df['pTrdSymbol'].str.strip() == pe_symbol]
        
        if ce_row.empty or pe_row.empty:
            print("❌ Symbols not found in master file")
            return None, None
        
        ce_token = str(ce_row.iloc[0]['pSymbol']).strip()
        pe_token = str(pe_row.iloc[0]['pSymbol']).strip()
        
        print(f"📦 CE Token: {ce_token}, PE Token: {pe_token}")
        
        # Fetch current prices - use the correct API format
        quotes_query = f"nse_fo|{ce_token},nse_fo|{pe_token}"
        quote_url = f"{session['base_url']}/script-details/1.0/quotes/neosymbol/{quotes_query}"
        quote_response = requests.get(quote_url, headers=session['headers'])
        
        print(f"🔗 API URL: {quote_url}")
        print(f"📡 Response Status: {quote_response.status_code}")
        
        if quote_response.status_code == 200:
            quote_data = quote_response.json()
            print(f"📊 Raw Response: {quote_data}")
            
            ce_price = None
            pe_price = None
            
            for item in quote_data:
                token = str(item.get('exchange_token', '')).strip()
                ltp = float(item.get('ltp', 0))
                
                # Get bid/ask from depth
                depth = item.get('depth', {})
                buy_depth = depth.get('buy', [{}])
                sell_depth = depth.get('sell', [{}])
                
                bid = float(buy_depth[0].get('price', 0)) if buy_depth and buy_depth[0] else 0
                ask = float(sell_depth[0].get('price', 0)) if sell_depth and sell_depth[0] else 0
                
                print(f"🔍 Processing token: {token}, LTP: {ltp}")
                
                if token == ce_token:
                    ce_price = {
                        'symbol': ce_symbol,
                        'ltp': ltp,
                        'bid': bid,
                        'ask': ask
                    }
                    print(f"📈 {ce_symbol}: LTP={ltp}, Bid={bid}, Ask={ask}")
                elif token == pe_token:
                    pe_price = {
                        'symbol': pe_symbol,
                        'ltp': ltp,
                        'bid': bid,
                        'ask': ask
                    }
                    print(f"📈 {pe_symbol}: LTP={ltp}, Bid={bid}, Ask={ask}")
            
            return ce_price, pe_price
        else:
            print(f"❌ Price fetch failed: {quote_response.status_code}")
            print(f"❌ Response text: {quote_response.text}")
            return None, None
            
    except Exception as e:
        print(f"❌ Error fetching option prices: {e}")
        import traceback
        traceback.print_exc()
        return None, None
def place_order(session, symbol, master_path):
    print(f"\n🚀 PLACING TEST ORDER FOR: {symbol}")
    
    # First, get the current market price
    print("📈 Fetching current market price...")
    try:
        # Get the token/symbol code for price check
        df = pd.read_csv(master_path)
        df.columns = df.columns.str.strip()
        symbol_row = df[df['pTrdSymbol'].str.strip() == symbol]
        
        if not symbol_row.empty:
            token = symbol_row.iloc[0]['pSymbol']
            lot_size = int(symbol_row.iloc[0]['lLotSize'])
            print(f"📦 Token: {token}, Lot size: {lot_size}")
            
            # Fetch current price
            quote_url = f"{session['base_url']}/script-details/1.0/quotes/neosymbol/nse_fo|{token}"
            quote_response = requests.get(quote_url, headers=session['headers'])
            
            if quote_response.status_code == 200:
                quote_data = quote_response.json()
                if isinstance(quote_data, list) and len(quote_data) > 0:
                    ltp = float(quote_data[0].get('ltp', 0))
                    bid = float(quote_data[0].get('depth', {}).get('buy', [{}])[0].get('price', 0))
                    ask = float(quote_data[0].get('depth', {}).get('sell', [{}])[0].get('price', 0))
                    
                    print(f"💰 Current LTP: {ltp}, Bid: {bid}, Ask: {ask}")
                    
                    # Use a reasonable limit price (slightly above ask for buy)
                    if ask > 0:
                        limit_price = round(ask + 0.05, 2)  # 5 paisa above ask
                    elif ltp > 0:
                        limit_price = round(ltp + 0.05, 2)  # 5 paisa above LTP
                    else:
                        limit_price = 1.00  # Default minimum
                        
                    print(f"🎯 Using limit price: {limit_price}")
                else:
                    print("❌ No quote data, using default price 1.00")
                    limit_price = 1.00
                    lot_size = 75
            else:
                print("❌ Price fetch failed, using default price 1.00")
                limit_price = 1.00
                lot_size = 75
        else:
            print("❌ Symbol not found in master, using defaults")
            limit_price = 1.00
            lot_size = 75
    except Exception as e:
        print(f"❌ Error getting price: {e}, using defaults")
        limit_price = 1.00
        lot_size = 75
    
    url = f"{session['base_url']}/quick/order/rule/ms/place"
    headers = {
        "accept": "application/json",
        "Sid": session['sid'],
        "Auth": session['token'], 
        "neo-fin-key": "neotradeapi",
        "Content-Type": "application/x-www-form-urlencoded"
    }
    
    order_data = {
        "am": "NO",
        "dq": "0",
        "es": "nse_fo",
        "mp": "0", 
        "pc": "NRML",
        "pf": "N",
        "pr": str(limit_price),  # Use calculated limit price
        "pt": "L",            # LIMIT order instead of MARKET
        "qt": str(lot_size),
        "rt": "DAY",
        "tp": "0",
        "ts": symbol,
        "tt": "B"
    }
    
    print("📦 ORDER PAYLOAD:")
    print(order_data)
    
    import json
    jdata_str = json.dumps(order_data, separators=(',', ':'))
    post_data = f"jData={urllib.parse.quote_plus(jdata_str)}"
    
    print("🔗 SENDING REQUEST...")
    try:
        response = requests.post(url, headers=headers, data=post_data)
        print(f"📡 RESPONSE STATUS: {response.status_code}")
        print(f"📡 RESPONSE TEXT: {response.text}")
        
        if response.status_code == 200:
            res_json = response.json()
            print(f"📊 RESPONSE JSON: {res_json}")
            
            if res_json.get("stat") == "Ok":
                print(f"🎉 🎉 🎉 ORDER PLACED SUCCESSFULLY! Order Number: {res_json.get('nOrdNo')} 🎉 🎉 🎉")
                return res_json.get("nOrdNo")
            else:
                print(f"❌ Order Failed - Stat: {res_json.get('stat')}, Error: {res_json.get('emsg', 'Unknown')}")
        else:
            print(f"❌ HTTP Error: {response.status_code}")
            
    except Exception as e:
        print(f"❌ Exception: {e}")
        import traceback
        traceback.print_exc()
    
    return None
if __name__ == "__main__":
    s = login()
    if s:
        spots = fetch_index_prices(s)
        if spots:
            nifty_spot = spots.get("Nifty 50-IN") or spots.get("Nifty 50")
            banknifty_spot = spots.get("Nifty Bank-IN") or spots.get("Nifty Bank")
            
            if nifty_spot and banknifty_spot:
                print(f"\nNifty spot price: {nifty_spot}")
                print(f"BankNifty spot price: {banknifty_spot}")
                
                if download_file(s):
                    # Test BANKNIFTY expiries
                    print("\n" + "="*50)
                    print("🏦 BANKNIFTY EXPIRY DETECTION")
                    print("="*50)
                    banknifty_expiries = find_banknifty_expiries(MASTER_PATH)
                    
                    # Test BANKNIFTY ATM options
                    print("\n" + "="*50)
                    print("🏦 BANKNIFTY ATM OPTIONS")
                    print("="*50)
                    banknifty_ce, banknifty_pe = find_banknifty_atm_options(MASTER_PATH, banknifty_spot)
                    
                    # Fetch BANKNIFTY option prices
                    if banknifty_ce and banknifty_pe:
                        fetch_option_prices(s, banknifty_ce, banknifty_pe, MASTER_PATH)
                    
                    # Original NIFTY code
                    print("\n" + "="*50)
                    print("📈 NIFTY ATM OPTIONS")
                    print("="*50)
                    ce, pe = find_atm_ce_pe(MASTER_PATH, nifty_spot)
                    if ce and pe:
                        print(f"🎯 NIFTY ATM CE: {ce}")
                        print(f"🎯 NIFTY ATM PE: {pe}")
                        # Fetch NIFTY option prices
                        fetch_option_prices(s, ce, pe, MASTER_PATH)
                    else:
                        print("❌ Could not find NIFTY ATM symbols in master file.")
                else:
                    print("❌ Failed to download master file.")
            else:
                print("❌ Spot prices not found.")