import requests
import pandas as pd

# --- CONFIG FOR KETAN ---
MOBILE = "+919227132381"
CLIENT_CODE = "ZH329"
ACCESS_TOKEN = "c80a89d3-1ef2-4a2f-9900-82393343a824"
MPIN = "523698"
MASTER_PATH = r"C:\Users\Ketan\Desktop\kotak_master_live.csv"

class KotakTradingAPI:
    def __init__(self):
        self.session = None
        self.master_df = None

    def get_headers(self):
        if not self.session:
            return {}
        return {
            "Authorization": ACCESS_TOKEN,
            "Auth": self.session.get("token", ""),
            "Sid": self.session.get("sid", ""),
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/x-www-form-urlencoded",
            "accept": "application/json"
        }

    def login(self):
        print("🔐 Logging in...")
        print(f"USER: Ketan ({CLIENT_CODE})")
        totp = input("Enter 6-digit TOTP: ").strip()

        headers = {
            "Authorization": ACCESS_TOKEN,
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/json"
        }

        try:
            # Step 1: TOTP authentication
            r1 = requests.post(
                "https://mis.kotaksecurities.com/login/1.0/tradeApiLogin",
                json={"mobileNumber": MOBILE, "ucc": CLIENT_CODE, "totp": totp},
                headers=headers
            )
            if r1.status_code != 200:
                print(f"❌ TOTP failed: {r1.text}")
                return False

            d1 = r1.json()
            headers.update({
                "sid": d1["data"]["sid"],
                "Auth": d1["data"]["token"]
            })

            # Step 2: MPIN validation
            r2 = requests.post(
                "https://mis.kotaksecurities.com/login/1.0/tradeApiValidate",
                json={"mpin": MPIN},
                headers=headers
            )
            if r2.status_code != 200:
                print(f"❌ MPIN failed: {r2.text}")
                return False

            d2 = r2.json()
            self.session = {
                "base_url": d2["data"].get("baseUrl", "https://mis.kotaksecurities.com"),
                "token": d2["data"]["token"],
                "sid": d2["data"]["sid"],
                "headers": headers
            }
            print(f"✅ Login successful. Base URL: {self.session['base_url']}")
            return True

        except Exception as e:
            print(f"❌ Login error: {e}")
            return False

    def load_master_file(self):
        """Load kotak_master_live.csv for token lookups"""
        try:
            self.master_df = pd.read_csv(MASTER_PATH)
            print(f"📂 Master file loaded: {len(self.master_df)} rows")
            print("📑 Master file columns:", list(self.master_df.columns))
            return True
        except Exception as e:
            print(f"❌ Error loading master file: {e}")
            return False

    def get_holdings(self):
        """Fetch equity holdings (and ETFs)"""
        print("\n📊 Fetching Equity Holdings...")
        total_equity_pnl = 0.0
        try:
            url = f"{self.session['base_url']}/portfolio/v1/holdings"
            r = requests.get(url, headers=self.get_headers())
            if r.status_code != 200:
                print(f"❌ Holdings API error: {r.status_code} {r.text}")
                return None, 0.0
            data = r.json().get("data", [])
            if not data:
                print("ℹ️ No holdings found.")
                return [], 0.0
            for h in data:
                pnl = float(h.get('unrealisedGainLoss', 0))
                total_equity_pnl += pnl
                print(f"HOLDING: {h.get('symbol', ''):<12} | QTY: {h.get('quantity', 0):<6} | "
                      f"AVG: {h.get('averagePrice', 0):<10} | LTP: {h.get('closingPrice', 0):<10} | "
                      f"UNREALIZED P&L: {pnl:<10}")
            return data, total_equity_pnl
        except Exception as e:
            print(f"❌ Holdings fetch error: {e}")
            return None, 0.0

    def test_new_holdings_api(self):
        """Test the NEW portfolio/v1/holdings API with full response"""
        print("\n🧪 TESTING NEW HOLDINGS API...")
        try:
            url = f"{self.session['base_url']}/portfolio/v1/holdings"
            r = requests.get(url, headers=self.get_headers())
            
            print(f"📡 URL: {url}")
            print(f"📊 Status: {r.status_code}")
            
            if r.status_code != 200:
                print(f"❌ API Error: {r.text}")
                return None
            
            data = r.json()
            print(f"📦 Response type: {type(data)}")
            
            # Print first position to see structure
            if data.get("data") and len(data["data"]) > 0:
                first_item = data["data"][0]
                print("\n📋 FIRST POSITION STRUCTURE:")
                for key, value in first_item.items():
                    print(f"  {key}: {value}")
                
                # Check if it has averagePrice
                if 'averagePrice' in first_item:
                    print(f"\n✅ FOUND averagePrice: {first_item['averagePrice']}")
                else:
                    print(f"\n❌ NO averagePrice field found!")
                    
            return data
            
        except Exception as e:
            print(f"❌ Test error: {e}")
            import traceback
            traceback.print_exc()
            return None

    def get_fo_positions(self):
        """Fetch F&O positions with LTP + MTM using master file tokens"""
        print("\n📊 Fetching F&O Positions...")
        total_fo_mtm = 0.0
        try:
            url = f"{self.session['base_url']}/quick/user/positions"
            r = requests.get(url, headers=self.get_headers())
            if r.status_code != 200:
                print(f"❌ F&O API error: {r.status_code} {r.text}")
                return None, 0.0
            res_json = r.json()
            if res_json.get("stat") not in ["Ok", "ok"]:
                print(f"❌ Positions Error: {res_json.get('emsg', 'Unknown API Error')}")
                return None, 0.0
            positions = res_json.get("data", [])
            if not positions:
                print("ℹ️ No open F&O positions found.")
                return [], 0.0

            # Lookup tokens from master file
            tokens = []
            token_map = {}
            for p in positions:
                sym = p.get("trdSym", "")
                match = self.master_df[self.master_df["pTrdSymbol"] == sym]
                if not match.empty:
                    tok = str(match.iloc[0]["pScripRefKey"])

                    tokens.append(tok)
                    token_map[sym] = tok

            # Fetch LTPs using tokens
            ltp_map = {}
            if tokens:
                q_url = f"{self.session['base_url']}/script-details/1.0/quotes/{','.join(tokens)}"
                q_r = requests.get(q_url, headers=self.get_headers())
                if q_r.status_code == 200:
                    q_data = q_r.json().get("data", [])
                    for item in q_data:
                        ltp_map[item.get("token")] = float(item.get("ltp", 0))

            # Print positions with LTP + MTM
            for p in positions:
                sym = p.get("trdSym", "")
                tok = token_map.get(sym, "")
                qty_buy = int(p.get("cfBuyQty", "0"))
                qty_sell = int(p.get("cfSellQty", "0"))
                net_qty = qty_buy - qty_sell
                ltp = ltp_map.get(tok, 0.0)

                buy_amt = float(p.get("cfBuyAmt", "0"))
                sell_amt = float(p.get("cfSellAmt", "0"))
                pnl_unrealized = round((sell_amt - buy_amt) + (net_qty * ltp), 2)
                total_fo_mtm += pnl_unrealized

                print(f"POSITION: {sym:<20} | NET QTY: {net_qty:<5} | LTP: {ltp:<10} | "
                      f"STRIKE: {p.get('stkPrc', ''):<10} | EXPIRY: {p.get('expDt', ''):<12} | "
                      f"MTM: {pnl_unrealized:<10}")

            return positions, total_fo_mtm
        except Exception as e:
            print(f"❌ F&O fetch error: {e}")
            return None, 0.0
    def debug_old_positions_api(self):
        """Debug the old positions API to see raw response"""
        print("\n🐛 DEBUGGING OLD POSITIONS API...")
        try:
            url = f"{self.session['base_url']}/quick/user/positions"
            r = requests.get(url, headers=self.get_headers())
            
            print(f"📡 URL: {url}")
            print(f"📊 Status: {r.status_code}")
            print(f"📏 Content Length: {len(r.text)} chars")
            
            # Print first 500 chars to see what it returns
            print("\n📄 RESPONSE (first 500 chars):")
            print(r.text[:500])
            
            # Try to parse as JSON
            try:
                data = r.json()
                print("✅ Successfully parsed as JSON")
                return data
            except:
                print("❌ NOT valid JSON - might be HTML or empty")
                return None
                
        except Exception as e:
            print(f"❌ Debug error: {e}")
            return None 
    def debug_position_details(self):
        """Debug EXACT position data structure"""
        print("\n🔍 DEBUGGING POSITION DETAILS...")
        try:
            url = f"{self.session['base_url']}/quick/user/positions"
            r = requests.get(url, headers=self.get_headers())
            
            data = r.json()
            positions = data.get("data", [])
            
            for p in positions:
                print(f"\n📊 POSITION: {p.get('trdSym')}")
                print("ALL FIELDS:")
                for key, value in p.items():
                    print(f"  {key}: {value}")
                
                # Calculate average if possible
                fl_sell_qty = int(p.get("flSellQty", "0") or "0")
                sell_amt = float(p.get("sellAmt", "0") or "0")
                
                if fl_sell_qty > 0 and sell_amt > 0:
                    avg_price = sell_amt / fl_sell_qty
                    print(f"  💡 CALCULATED AVG SELL PRICE: {avg_price:.2f}")
                    
        except Exception as e:
            print(f"❌ Debug error: {e}")       
    def run_complete_test(self):
        print("="*50)
        print("🧪 RUNNING COMBINED HOLDINGS + F&O TEST (Ketan)")
        print("="*50)

        if not self.login():
            return

        if not self.load_master_file():
            return

        # TEST NEW API FIRST
        holdings_data = self.test_new_holdings_api()
        
        # DEBUG OLD API
        old_data = self.debug_old_positions_api()
        
        # Then run existing tests
        holdings, eq_pnl = self.get_holdings()           

def main():
    api = KotakTradingAPI()
    api.run_complete_test()

if __name__ == "__main__":
    main()