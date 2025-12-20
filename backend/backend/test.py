import pandas as pd
import requests
import os
import urllib.parse
import json
import re

# CONFIG
MOBILE = "+919227132381"
CLIENT_CODE = "ZH329"
ACCESS_TOKEN = "c80a89d3-1ef2-4a2f-9900-82393343a824"
MASTER_PATH = r"C:\Users\Ketan\Desktop\kotak_master_live.csv"

class KotakTradingAPI:
    def __init__(self):
        self.session = None
        self.master_df = None
    
    def login(self):
        """Login to Kotak trading API"""
        print("🔐 Logging in...")
        totp = input("Enter 6-digit TOTP: ").strip()
        mpin = input("Enter 6-digit MPIN: ").strip()
        
        headers = {
            "Authorization": ACCESS_TOKEN, 
            "neo-fin-key": "neotradeapi", 
            "Content-Type": "application/json"
        }
        
        try:
            # TOTP login
            r1 = requests.post(
                "https://mis.kotaksecurities.com/login/1.0/tradeApiLogin",
                json={"mobileNumber": MOBILE, "ucc": CLIENT_CODE, "totp": totp},
                headers=headers
            )
            if r1.status_code != 200:
                print(f"❌ TOTP failed")
                return False
            
            d1 = r1.json()
            headers.update({
                "sid": d1["data"]["sid"],
                "Auth": d1["data"]["token"]
            })
            
            # MPIN validation
            r2 = requests.post(
                "https://mis.kotaksecurities.com/login/1.0/tradeApiValidate",
                json={"mpin": mpin},
                headers=headers
            )
            if r2.status_code != 200:
                print(f"❌ MPIN failed")
                return False
            
            d2 = r2.json()
            self.session = {
                "base_url": d2["data"].get("baseUrl", "https://mis.kotaksecurities.com"),
                "token": d2["data"]["token"],
                "sid": d2["data"]["sid"],
                "headers": headers
            }
            print("✅ Login successful")
            return True
            
        except Exception as e:
            print(f"❌ Login error: {e}")
            return False

    def download_master_file(self):
        """Download the master scrip file"""
        print("⬇️ Downloading master file...")
        try:
            r = requests.get(
                f"{self.session['base_url']}/script-details/1.0/masterscrip/file-paths",
                headers=self.session['headers']
            )
            data = r.json()
            
            url = ""
            if "data" in data and "filesPaths" in data["data"]:
                for u in data["data"]["filesPaths"]:
                    if "nse_fo.csv" in u:
                        url = u
                        break
            
            if not url:
                print("❌ No NSE FO URL found")
                return False
            
            r_file = requests.get(url)
            if r_file.status_code != 200:
                print("❌ Download failed")
                return False
            
            with open(MASTER_PATH, "wb") as f:
                f.write(r_file.content)
            
            # Load into DataFrame
            self.master_df = pd.read_csv(MASTER_PATH)
            self.master_df.columns = self.master_df.columns.str.strip()
            print("✅ Master file downloaded and loaded")
            return True
            
        except Exception as e:
            print(f"❌ Download error: {e}")
            return False

    def find_atm_options(self, spot_price):
        """Find ATM CE and PE options for NIFTY"""
        if self.master_df is None:
            print("❌ Master file not loaded")
            return None, None
        
        nifty_rows = self.master_df[self.master_df['pSymbolName'].str.strip() == 'NIFTY']
        ce_symbols = []
        pe_symbols = []
        
        for _, row in nifty_rows.iterrows():
            symbol = str(row['pTrdSymbol']).strip()
            strike_match = re.search(r'(\d{5})(CE|PE)$', symbol)
            if strike_match:
                strike_price = int(strike_match.group(1))
                option_type = strike_match.group(2)
                
                if option_type == 'CE':
                    ce_symbols.append((strike_price, symbol))
                else:
                    pe_symbols.append((strike_price, symbol))
        
        if ce_symbols and pe_symbols:
            ce_atm = min(ce_symbols, key=lambda x: abs(x[0] - spot_price))
            pe_atm = min(pe_symbols, key=lambda x: abs(x[0] - spot_price))
            print(f"🎯 Found ATM CE: {ce_atm[1]}, PE: {pe_atm[1]}")
            return ce_atm[1], pe_atm[1]
        
        return None, None

    def get_symbol_info(self, symbol):
        """Get token and lot size for a symbol - FIXED to handle int64 serialization"""
        if self.master_df is None:
            return None, 75  # Default lot size
        
        symbol_row = self.master_df[self.master_df['pTrdSymbol'].str.strip() == symbol]
        if not symbol_row.empty:
            # Convert numpy/pandas types to native Python types for JSON serialization
            token = str(symbol_row.iloc[0]['pSymbol'])  # Convert to string to avoid int64
            lot_size = int(symbol_row.iloc[0]['lLotSize'])  # Convert to native int
            return token, lot_size
        
        return None, 75

    def place_order(self, symbol, order_type="B", price=1.0, quantity=75):
        """Place an order"""
        print(f"🚀 Placing {order_type} order for {symbol}...")
        
        token, lot_size = self.get_symbol_info(symbol)
        if quantity == 75:  # Use lot size if quantity not specified
            quantity = lot_size
        
        url = f"{self.session['base_url']}/quick/order/rule/ms/place"
        headers = {
            "accept": "application/json",
            "Sid": self.session['sid'],
            "Auth": self.session['token'],
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        
        order_data = {
            "am": "NO", "dq": "0", "es": "nse_fo", "mp": "0", "pc": "NRML",
            "pf": "N", "pr": str(price), "pt": "L", "qt": str(quantity),
            "rt": "DAY", "tp": "0", "ts": symbol, "tt": order_type
        }
        
        jdata_str = json.dumps(order_data, separators=(',', ':'))
        post_data = f"jData={urllib.parse.quote_plus(jdata_str)}"
        
        try:
            response = requests.post(url, headers=headers, data=post_data)
            if response.status_code == 200:
                res_json = response.json()
                if res_json.get("stat") == "Ok":
                    order_number = res_json.get('nOrdNo')
                    print(f"✅ Order placed: {order_number}")
                    return order_number
                else:
                    print(f"❌ Order failed: {res_json.get('emsg', 'Unknown')}")
            else:
                print(f"❌ HTTP error: {response.status_code}")
        except Exception as e:
            print(f"❌ Order exception: {e}")
        
        return None

    def modify_order(self, order_number, symbol, new_price, new_quantity):
        """Modify an existing order - FIXED JSON serialization"""
        print(f"🔄 Modifying order {order_number}...")
        
        token, _ = self.get_symbol_info(symbol)
        url = f"{self.session['base_url']}/quick/order/vr/modify"
        headers = {
            "accept": "application/json",
            "Sid": self.session['sid'],
            "Auth": self.session['token'],
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        
        # Ensure all values are native Python types for JSON serialization
        modify_data = {
            "tk": token or "", 
            "mp": "0", 
            "pc": "NRML", 
            "dd": "NA", 
            "dq": "0",
            "vd": "DAY", 
            "ts": symbol, 
            "tt": "B", 
            "pr": str(float(new_price)),  # Ensure float then string
            "tp": "0", 
            "qt": str(int(new_quantity)),  # Ensure int then string
            "no": str(order_number),  # Convert to string
            "es": "nse_fo", 
            "pt": "L"
        }
        
        jdata_str = json.dumps(modify_data, separators=(',', ':'))
        post_data = f"jData={urllib.parse.quote_plus(jdata_str)}"
        
        try:
            response = requests.post(url, headers=headers, data=post_data)
            if response.status_code == 200:
                res_json = response.json()
                if res_json.get("stat") == "Ok":
                    new_order_number = res_json.get('nOrdNo')
                    print(f"✅ Order modified: {new_order_number}")
                    return new_order_number
                else:
                    print(f"❌ Modify failed: {res_json.get('emsg', 'Unknown')}")
            else:
                print(f"❌ HTTP error: {response.status_code}")
        except Exception as e:
            print(f"❌ Modify exception: {e}")
        
        return None

    def cancel_order(self, order_number):
        """Cancel an order"""
        print(f"❌ Cancelling order {order_number}...")
        
        url = f"{self.session['base_url']}/quick/order/cancel"
        headers = {
            "accept": "application/json",
            "Sid": self.session['sid'],
            "Auth": self.session['token'],
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        
        cancel_data = {"am": "NO", "on": str(order_number)}  # Convert to string
        jdata_str = json.dumps(cancel_data, separators=(',', ':'))
        post_data = f"jData={urllib.parse.quote_plus(jdata_str)}"
        
        try:
            response = requests.post(url, headers=headers, data=post_data)
            if response.status_code == 200:
                res_json = response.json()
                if res_json.get("stat") == "Ok":
                    print(f"✅ Order cancelled")
                    return True
                else:
                    print(f"❌ Cancel failed: {res_json.get('emsg', 'Unknown')}")
            else:
                print(f"❌ HTTP error: {response.status_code}")
        except Exception as e:
            print(f"❌ Cancel exception: {e}")
        
        return False

    def get_order_book(self):
        """Get order book"""
        print("📋 Fetching order book...")
        
        url = f"{self.session['base_url']}/quick/user/orders"
        headers = {
            "accept": "application/json",
            "Sid": self.session['sid'],
            "Auth": self.session['token'],
            "neo-fin-key": "neotradeapi"
        }
        
        try:
            response = requests.get(url, headers=headers)
            if response.status_code == 200:
                res_json = response.json()
                if res_json.get("stat") == "Ok":
                    orders = res_json.get('data', [])
                    print(f"✅ Found {len(orders)} orders")
                    
                    # Display recent orders
                    if orders:
                        print("\n📝 Recent Orders:")
                        print("-" * 60)
                        for order in orders[:5]:  # Show last 5 orders
                            print(f"Order: {order.get('nOrdNo')} | {order.get('trdSym')} | "
                                  f"{order.get('trnsTp')} | Qty: {order.get('qty')} | "
                                  f"Status: {order.get('ordSt')}")
                        if len(orders) > 5:
                            print(f"... and {len(orders) - 5} more orders")
                        print("-" * 60)
                    
                    return orders
                else:
                    print(f"❌ Order book failed: {res_json.get('emsg', 'Unknown')}")
            else:
                print(f"❌ HTTP error: {response.status_code}")
        except Exception as e:
            print(f"❌ Order book exception: {e}")
        
        return None

    def get_trade_book(self):
        """Get trade book - FIXED to handle lowercase 'ok'"""
        print("💰 Fetching trade book...")
        
        url = f"{self.session['base_url']}/quick/user/trades"
        headers = {
            "accept": "application/json",
            "Sid": self.session['sid'],
            "Auth": self.session['token'],
            "neo-fin-key": "neotradeapi"
        }
        
        try:
            response = requests.get(url, headers=headers)
            if response.status_code == 200:
                res_json = response.json()
                
                # FIX: Check for both "Ok" and "ok"
                stat = res_json.get("stat")
                if stat == "Ok" or stat == "ok":
                    trades = res_json.get('data', [])
                    
                    if trades:
                        print(f"✅ Found {len(trades)} trades")
                        
                        # Display recent trades
                        print("\n💰 Recent Trades:")
                        print("-" * 80)
                        for trade in trades[:5]:  # Show last 5 trades
                            print(f"Trade: {trade.get('nOrdNo')} | {trade.get('trdSym')} | "
                                  f"{trade.get('trnsTp')} | Qty: {trade.get('fldQty', trade.get('qty', 'N/A'))} | "
                                  f"Price: {trade.get('avgPrc')} | Date: {trade.get('flDt')}")
                        if len(trades) > 5:
                            print(f"... and {len(trades) - 5} more trades")
                        print("-" * 80)
                    else:
                        print("ℹ️  No trades found for today")
                    
                    return trades
                else:
                    error_msg = res_json.get('emsg', 'Unknown error')
                    print(f"❌ Trade book failed: {error_msg}")
            else:
                print(f"❌ HTTP error: {response.status_code}")
        except Exception as e:
            print(f"❌ Trade book exception: {e}")
        
        return None

    def get_position_book(self):
        """Get position book - FOCUS ON F&O POSITIONS ONLY"""
        print("📊 Fetching position book (F&O only)...")
        
        url = f"{self.session['base_url']}/quick/user/positions"
        headers = {
            "accept": "application/json",
            "Sid": self.session['sid'],
            "Auth": self.session['token'],
            "neo-fin-key": "neotradeapi"
        }
        
        try:
            response = requests.get(url, headers=headers)
            if response.status_code == 200:
                res_json = response.json()
                
                # Check for both "Ok" and "ok" like trade book
                stat = res_json.get("stat")
                if stat == "Ok" or stat == "ok":
                    all_positions = res_json.get('data', [])
                    
                    # Filter only F&O positions
                    fo_positions = []
                    for position in all_positions:
                        ex_seg = position.get('exSeg', '').lower()
                        # Focus on F&O segments only
                        if 'fo' in ex_seg:  # nse_fo, bse_fo
                            fo_positions.append(position)
                    
                    if fo_positions:
                        print(f"✅ Found {len(fo_positions)} F&O positions")
                        
                        # Display F&O positions - FIXED to show open positions correctly
                        print("\n📊 F&O Positions:")
                        print("=" * 120)
                        print(f"{'Symbol':<20} {'Product':<8} {'Net Qty':<10} {'Buy Qty':<10} {'Sell Qty':<10} {'Buy Amt':<12} {'Sell Amt':<12} {'Status':<10}")
                        print("-" * 120)
                        
                        open_positions = []
                        closed_positions = []
                        
                        for position in fo_positions:
                            symbol = position.get('trdSym', 'N/A')
                            product = position.get('prod', 'N/A')
                            
                            # Get quantities - use filled quantities to determine net position
                            fl_buy_qty = int(position.get('flBuyQty', '0'))
                            fl_sell_qty = int(position.get('flSellQty', '0'))
                            net_qty = fl_buy_qty - fl_sell_qty
                            
                            buy_amt = position.get('buyAmt', '0.00')
                            sell_amt = position.get('sellAmt', '0.00')
                            
                            # Determine status based on NET quantity
                            if net_qty > 0:
                                status = "LONG"
                                open_positions.append(position)
                            elif net_qty < 0:
                                status = "SHORT" 
                                open_positions.append(position)
                            else:
                                status = "CLOSED"
                                closed_positions.append(position)
                            
                            print(f"{symbol:<20} {product:<8} {net_qty:<10} {fl_buy_qty:<10} {fl_sell_qty:<10} {buy_amt:<12} {sell_amt:<12} {status:<10}")
                        
                        print("=" * 120)
                        
                        # Show OPEN positions summary
                        if open_positions:
                            print(f"\n🎯 OPEN POSITIONS: {len(open_positions)} positions")
                            print("=" * 80)
                            for position in open_positions:
                                symbol = position.get('trdSym')
                                fl_buy_qty = int(position.get('flBuyQty', '0'))
                                fl_sell_qty = int(position.get('flSellQty', '0'))
                                net_qty = fl_buy_qty - fl_sell_qty
                                status = "LONG" if net_qty > 0 else "SHORT"
                                
                                print(f"  {symbol}: {status} {abs(net_qty)} lots")
                            print("=" * 80)
                        
                        # Show detailed position info for OPEN positions only
                        if open_positions:
                            print("\n🔍 Detailed OPEN Position Info:")
                            print("-" * 80)
                            for i, position in enumerate(open_positions):
                                symbol = position.get('trdSym')
                                fl_buy_qty = int(position.get('flBuyQty', '0'))
                                fl_sell_qty = int(position.get('flSellQty', '0'))
                                net_qty = fl_buy_qty - fl_sell_qty
                                
                                print(f"Position {i+1}: {symbol}")
                                print(f"  Product: {position.get('prod')}")
                                print(f"  Segment: {position.get('exSeg')}")
                                print(f"  Net Quantity: {net_qty} ({'LONG' if net_qty > 0 else 'SHORT'})")
                                print(f"  Buy Quantity: {fl_buy_qty}")
                                print(f"  Sell Quantity: {fl_sell_qty}")
                                print(f"  Buy Amount: {position.get('buyAmt')}")
                                print(f"  Sell Amount: {position.get('sellAmt')}")
                                if position.get('stkPrc') and position.get('stkPrc') != '0.00':
                                    print(f"  Strike Price: {position.get('stkPrc')}")
                                if position.get('optTp'):
                                    print(f"  Option Type: {position.get('optTp')}")
                                print("-" * 80)
                        
                        # Show closed positions count
                        if closed_positions:
                            print(f"📋 Closed/Historical Positions: {len(closed_positions)}")
                        
                        return open_positions  # Return only open positions
                        
                    else:
                        print("ℹ️  No F&O positions found")
                        
                        # Show summary of what segments we found
                        if all_positions:
                            segments = set()
                            for position in all_positions:
                                segments.add(position.get('exSeg', 'Unknown'))
                            print(f"📋 Available segments: {', '.join(segments)}")
                        
                        return []
                        
                else:
                    error_msg = res_json.get('emsg', 'Unknown error')
                    print(f"❌ Position book failed: {error_msg}")
            else:
                print(f"❌ HTTP error: {response.status_code}")
        except Exception as e:
            print(f"❌ Position book exception: {e}")
        
        return None

    def get_order_history(self, order_number):
        """Get order history for a specific order"""
        print(f"📜 Fetching order history for {order_number}...")
        
        url = f"{self.session['base_url']}/quick/order/history"
        headers = {
            "accept": "application/json",
            "Sid": self.session['sid'],
            "Auth": self.session['token'],
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        
        history_data = {"nOrdNo": str(order_number)}
        jdata_str = json.dumps(history_data, separators=(',', ':'))
        post_data = f"jData={urllib.parse.quote_plus(jdata_str)}"
        
        try:
            response = requests.post(url, headers=headers, data=post_data)
            if response.status_code == 200:
                res_json = response.json()
                if res_json.get("stat") == "Ok":
                    history = res_json.get('data', [])
                    print(f"✅ Found {len(history)} status updates for order {order_number}")
                    return history
                else:
                    print(f"❌ Order history failed: {res_json.get('emsg', 'Unknown')}")
            else:
                print(f"❌ HTTP error: {response.status_code}")
        except Exception as e:
            print(f"❌ Order history exception: {e}")
        
        return None

    def run_complete_test(self):
        """Run complete order management test"""
        print("🧪 Running complete order management test...")
        
        # Login and setup
        if not self.login() or not self.download_master_file():
            return
        
        # Find test symbol
        ce_symbol, pe_symbol = self.find_atm_options(26200)
        if not ce_symbol:
            print("❌ No test symbol found")
            return
        
        print(f"\n🎯 Using symbol for testing: {ce_symbol}")
        
        # Get initial state
        print("\n" + "="*50)
        print("📊 INITIAL STATE")
        print("="*50)
        initial_orders = self.get_order_book()
        initial_trades = self.get_trade_book()
        
        # Get positions
        print("\n" + "="*50)
        print("📊 POSITION BOOK")
        print("="*50)
        initial_positions = self.get_position_book()
        
        # Place order
        print("\n" + "="*50)
        print("🚀 ORDER PLACEMENT")
        print("="*50)
        order_number = self.place_order(ce_symbol, price=0.05, quantity=75)
        if not order_number:
            print("❌ Cannot proceed - order placement failed")
            return
        
        # Get order history
        print("\n" + "="*50)
        print("📜 ORDER HISTORY")
        print("="*50)
        self.get_order_history(order_number)
        
        # Modify order
        print("\n" + "="*50)
        print("🔄 ORDER MODIFICATION")
        print("="*50)
        modified_order = self.modify_order(order_number, ce_symbol, 0.10, 75)
        
        # Cancel order
        print("\n" + "="*50)
        print("❌ ORDER CANCELLATION")
        print("="*50)
        order_to_cancel = modified_order if modified_order else order_number
        cancel_success = self.cancel_order(order_to_cancel)
        
        # Final state
        print("\n" + "="*50)
        print("📊 FINAL STATE")
        print("="*50)
        final_orders = self.get_order_book()
        final_trades = self.get_trade_book()
        
        # Final positions
        print("\n" + "="*50)
        print("📊 FINAL POSITIONS")
        print("="*50)
        final_positions = self.get_position_book()
        
        # Test summary
        print("\n" + "="*50)
        print("🎯 TEST SUMMARY")
        print("="*50)
        print(f"✅ Original Order: {order_number}")
        print(f"✅ Modified Order: {modified_order or 'N/A'}")
        print(f"✅ Cancel Success: {cancel_success}")
        print(f"✅ Orders (before): {len(initial_orders) if initial_orders else 0}")
        print(f"✅ Orders (after): {len(final_orders) if final_orders else 0}")
        print(f"✅ Trades (before): {len(initial_trades) if initial_trades else 0}")
        print(f"✅ Trades (after): {len(final_trades) if final_trades else 0}")
        print(f"✅ F&O Positions (before): {len(initial_positions) if initial_positions else 0}")
        print(f"✅ F&O Positions (after): {len(final_positions) if final_positions else 0}")
        print("🎉 Complete order management test finished!")

def main():
    api = KotakTradingAPI()
    api.run_complete_test()

if __name__ == "__main__":
    main()