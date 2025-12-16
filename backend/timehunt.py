import requests
import json
import pandas as pd

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

    def check_midcp_futures(self):
        """Check if MIDCPNIFTY futures exist"""
        print("\n🔍 CHECKING MIDCPNIFTY FUTURES")
        print("="*60)
        
        csv_path = r"C:\Users\Ketan\Desktop\kotak_master_live.csv"
        df = pd.read_csv(csv_path)
        
        # Look for MIDCPNIFTY FUTURES
        midcp_rows = df[df['pSymbolName'] == 'MIDCPNIFTY']
        futures = midcp_rows[midcp_rows['pTrdSymbol'].astype(str).str.contains('FUT')]
        
        if not futures.empty:
            print(f"✅ Found {len(futures)} MIDCPNIFTY futures")
            for _, row in futures.head(3).iterrows():
                print(f"  - {row['pTrdSymbol']}")
            
            # Get first futures token
            first_token = str(futures.iloc[0]['pSymbol']).strip()
            print(f"\n📊 Fetching LTP for: {first_token}")
            
            url = f"{self.session['base_url']}/script-details/1.0/quotes/neosymbol/nse_fo|{first_token}"
            r = requests.get(url, headers=self.get_headers(), timeout=3)
            
            if r.status_code == 200:
                data = r.json()
                if isinstance(data, list) and len(data) > 0:
                    print(f"✅ Futures LTP: {data[0].get('ltp', 'N/A')}")
                else:
                    print(f"Response: {data}")
            else:
                print(f"❌ Failed: {r.status_code}")
        else:
            print("❌ No MIDCPNIFTY futures found")

def main():
    api = KotakTimestampHunter()
    if api.login():
        api.check_midcp_futures()

if __name__ == "__main__":
    main()