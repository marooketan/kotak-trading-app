import requests
import urllib.parse
import json

# CONFIG
MOBILE = "+919227132381"
CLIENT_CODE = "ZH329"
ACCESS_TOKEN = "c80a89d3-1ef2-4a2f-9900-82393343a824"

# TARGET (Validated from your master file)
TARGET_SYMBOL = "NIFTY25D2326100CE" 

class KotakDebug:
    def __init__(self):
        self.session = None
    
    def login(self):
        print("🔐 Logging in...")
        totp = input("Enter 6-digit TOTP: ").strip()
        mpin = input("Enter 6-digit MPIN: ").strip()
        
        # Headers for Login (JSON)
        headers = {
            "Authorization": ACCESS_TOKEN, 
            "neo-fin-key": "neotradeapi", 
            "Content-Type": "application/json"
        }
        
        try:
            r1 = requests.post("https://mis.kotaksecurities.com/login/1.0/tradeApiLogin", json={"mobileNumber": MOBILE, "ucc": CLIENT_CODE, "totp": totp}, headers=headers)
            if r1.status_code != 200: 
                print("❌ Login Step 1 Failed")
                return False
            
            d1 = r1.json()
            # Save tokens for later
            sid = d1["data"]["sid"]
            token = d1["data"]["token"]
            
            # Update headers for Step 2
            headers["sid"] = sid
            headers["Auth"] = token
            
            r2 = requests.post("https://mis.kotaksecurities.com/login/1.0/tradeApiValidate", json={"mpin": mpin}, headers=headers)
            if r2.status_code != 200: 
                print("❌ Login Step 2 Failed")
                return False
            
            d2 = r2.json()
            
            # STORE SESSION DATA
            self.session = {
                "base_url": d2["data"].get("baseUrl", "https://mis.kotaksecurities.com"),
                "token": d2["data"]["token"],
                "sid": d2["data"]["sid"]
            }
            print("✅ Login successful")
            return True
        except Exception as e: 
            print(f"❌ Login Exception: {e}")
            return False

    def place_order_debug(self, order_type_label, price_type, trigger_price, price):
        print(f"\n🚀 ATTEMPTING: {order_type_label}")
        print(f"   Symbol: {TARGET_SYMBOL} | Type: {price_type} | Trig: {trigger_price}")
        
        url = f"{self.session['base_url']}/quick/order/rule/ms/place"
        
        # === CRITICAL FIX: REBUILD HEADERS FOR ORDER PLACEMENT ===
        # We cannot use the login headers here. We must use Form-Urlencoded.
        headers = {
            "accept": "application/json",
            "Sid": self.session['sid'],
            "Auth": self.session['token'],
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/x-www-form-urlencoded"  # <--- THIS WAS MISSING
        }
        
        order_data = {
            "am": "NO", "dq": "0", "es": "nse_fo", "mp": "0", 
            "pc": "NRML", "pf": "N", "rt": "DAY", "tt": "B",
            "ts": TARGET_SYMBOL,
            "qt": "75",          
            "pt": price_type,        
            "pr": str(price),    
            "tp": str(trigger_price) 
        }
        
        jdata_str = json.dumps(order_data, separators=(',', ':'))
        post_data = f"jData={urllib.parse.quote_plus(jdata_str)}"
        
        try:
            response = requests.post(url, headers=headers, data=post_data)
            
            print(f"   📡 HTTP Status: {response.status_code}")
            
            try:
                res_json = response.json()
                if res_json.get("stat") == "Ok":
                    print(f"   ✅ SUCCESS! Order ID: {res_json.get('nOrdNo')}")
                    return res_json.get('nOrdNo')
                else:
                    print(f"   ❌ FAILED: {res_json.get('emsg', 'Unknown Error')}")
                    print(f"   Full Response: {res_json}")
            except:
                print(f"   ❌ RAW TEXT RESPONSE (ERROR):")
                print(f"   {response.text[:200]}") 
                
        except Exception as e:
            print(f"   ❌ Exception: {e}")
        return None

    def cancel_order(self, order_number):
        if not order_number: return
        print(f"\n❌ Cancelling Order {order_number}...")
        url = f"{self.session['base_url']}/quick/order/cancel"
        
        headers = {
            "accept": "application/json",
            "Sid": self.session['sid'],
            "Auth": self.session['token'],
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        
        cancel_data = {"am": "NO", "on": str(order_number)}
        post_data = f"jData={urllib.parse.quote_plus(json.dumps(cancel_data, separators=(',', ':')))}"
        
        try:
            requests.post(url, headers=headers, data=post_data)
            print("✅ Cancel Request Sent")
        except:
            print("❌ Cancel Failed")

def main():
    api = KotakDebug()
    if api.login():
        # 1. Try Standard Limit (Should work)
        print("\n--- TEST 1: STANDARD LIMIT ORDER ---")
        # Trigger=0, Price=0.05 (Safe limit)
        limit_id = api.place_order_debug("Standard Limit", "L", "0", "0.05")
        if limit_id:
            api.cancel_order(limit_id)
        
        # 2. Try SL Order (Trigger=100, Price=110)
        print("\n--- TEST 2: STOP LIMIT ORDER ---")
        sl_id = api.place_order_debug("Stop Limit", "SL", "100.0", "110.0")
        if sl_id:
            input("\n⏸️ SL Order Placed! Press ENTER to Cancel...")
            api.cancel_order(sl_id)

if __name__ == "__main__":
    main()