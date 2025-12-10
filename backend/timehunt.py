import requests
import json

# --- CONFIG FOR KAVITA ---
MOBILE = "+919227132387"
CLIENT_CODE = "X1N35"
ACCESS_TOKEN = "faab5107-d347-4f9f-a585-6fe32ad6c792"
MPIN = "523698"

class KotakTimestampHunter:
    def __init__(self):
        self.session = None

    def get_headers(self):
        if not self.session: return {}
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
        totp = input(f"Enter 6-digit TOTP for {CLIENT_CODE}: ").strip()

        headers = {
            "Authorization": ACCESS_TOKEN,
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/json"
        }

        try:
            # Step 1: TOTP
            r1 = requests.post(
                "https://mis.kotaksecurities.com/login/1.0/tradeApiLogin",
                json={"mobileNumber": MOBILE, "ucc": CLIENT_CODE, "totp": totp},
                headers=headers
            )
            if r1.status_code != 200:
                print(f"❌ TOTP Error: {r1.text}")
                return False

            d1 = r1.json()
            headers.update({"sid": d1["data"]["sid"], "Auth": d1["data"]["token"]})

            # Step 2: MPIN
            r2 = requests.post(
                "https://mis.kotaksecurities.com/login/1.0/tradeApiValidate",
                json={"mpin": MPIN},
                headers=headers
            )
            if r2.status_code != 200:
                print(f"❌ MPIN Error: {r2.text}")
                return False

            d2 = r2.json()
            self.session = {
                "base_url": d2["data"].get("baseUrl", "https://mis.kotaksecurities.com"),
                "token": d2["data"]["token"],
                "sid": d2["data"]["sid"]
            }
            print(f"✅ Login successful. URL: {self.session['base_url']}")
            return True
        except Exception as e:
            print(f"❌ Login Failed: {e}")
            return False

    def hunt_for_timestamp(self):
        print("\n" + "="*60)
        print("🕵️  HUNTING FOR TIMESTAMP FIELD NAME IN ORDER BOOK")
        print("="*60)

        try:
            # --- FIX: CHANGED URL TO '/quick/user/orders' ---
            url = f"{self.session['base_url']}/quick/user/orders"
            
            print(f"📡 Fetching from: {url}")
            r = requests.get(url, headers=self.get_headers())
            
            if r.status_code != 200:
                print(f"❌ API Error: {r.status_code} - {r.text}")
                return

            data = r.json().get("data", [])

            # 2. Check if Empty
            if not data:
                print("⚠️  YOUR ORDER BOOK IS EMPTY!")
                print("   Please place at least one order (even a rejected one) so we can see the data structure.")
                return

            # 3. Analyze the First Order
            first_order = data[0]
            print(f"✅ Found {len(data)} orders. Analyzing the most recent one...\n")
            
            print(f"{'FIELD NAME (The Key)':<25} | {'VALUE (The Data)':<30}")
            print("-" * 60)

            # 4. Loop through every key and highlight time-related ones
            for key, value in first_order.items():
                # Check for keywords like time, date, tm, dt
                is_time_related = any(x in key.lower() for x in ['time', 'date', 'tm', 'dt', 'ord'])
                
                icon = "⏰ " if is_time_related else "   "
                
                # Convert value to string and truncate if too long
                val_str = str(value)
                if len(val_str) > 30: val_str = val_str[:27] + "..."

                print(f"{icon}{key:<22} | {val_str:<30}")

            print("-" * 60)
            print("\n👉 LOOK AT THE ROWS WITH THE ALARM CLOCK (⏰).")
            print("   One of those names is what we need to put in your popup-script.js!")

        except Exception as e:
            print(f"❌ Error: {e}")

def main():
    api = KotakTimestampHunter()
    if api.login():
        api.hunt_for_timestamp()

if __name__ == "__main__":
    main()