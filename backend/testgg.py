import requests
import json
import getpass
import pandas as pd


class KotakTradingAPI:
    def __init__(self):
        # ---- CONFIG (KEEP AS IS IN YOUR PROJECT) ----
        self.access_token = "c80a89d3-1ef2-4a2f-9900-82393343a824"
        self.mobile = "+919227132381"

        self.ucc = "ZH329"

        self.base_url = None
        self.session_token = None
        self.sid = None

    # ------------------------------------------------
    # LOGIN FLOW (DO NOT TOUCH)
    # ------------------------------------------------
    def login(self):
        print("🔐 Logging in...")
        totp = getpass.getpass("Enter 6-digit TOTP: ")

        url = "https://mis.kotaksecurities.com/login/1.0/tradeApiLogin"
        headers = {
            "Authorization": self.access_token,
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/json"
        }
        payload = {
            "mobileNumber": self.mobile,
            "ucc": self.ucc,
            "totp": totp
        }

        r = requests.post(url, headers=headers, json=payload, timeout=10)
        r.raise_for_status()
        data = r.json()["data"]

        view_token = data["token"]
        view_sid = data["sid"]

        mpin = getpass.getpass("Enter MPIN: ")

        url = "https://mis.kotaksecurities.com/login/1.0/tradeApiValidate"
        headers = {
            "Authorization": self.access_token,
            "neo-fin-key": "neotradeapi",
            "sid": view_sid,
            "Auth": view_token,
            "Content-Type": "application/json"
        }
        payload = {"mpin": mpin}

        r = requests.post(url, headers=headers, json=payload, timeout=10)
        r.raise_for_status()
        data = r.json()["data"]

        self.base_url = data["baseUrl"]
        self.session_token = data["token"]
        self.sid = data["sid"]

        print("✅ Login OK")

    # ------------------------------------------------
    # FETCH ATP FROM QUOTES API (THIS IS THE TEST)
    # ------------------------------------------------
    def fetch_nifty_atp(self):
        print("📡 Fetching NIFTY Quotes (ATP test)...")

        url = (
            f"{self.base_url}"
            "/script-details/1.0/quotes/neosymbol/"
            "nse_fo|NIFTY/all"
        )

        headers = {
            "Authorization": self.access_token,
            "Content-Type": "application/json"
        }

        r = requests.get(url, headers=headers, timeout=10)
        r.raise_for_status()

        data = r.json()
        print("📥 RAW QUOTES RESPONSE:")
        print(json.dumps(data, indent=2))

        if not isinstance(data, list) or len(data) == 0:
            raise Exception("❌ Invalid Quotes response")

        quote = data[0]

        ltp = quote.get("ltp")
        atp = quote.get("atp")
        oi = quote.get("open_interest") or quote.get("oi")

        print("\n📊 PARSED VALUES")
        print(f"LTP : {ltp}")
        print(f"ATP : {atp}")
        print(f"OI  : {oi}")

        if atp is None:
            raise Exception("❌ ATP not found in Quotes response")

        print("\n✅ ATP FETCH SUCCESSFUL")

    # ------------------------------------------------
    def run(self):
        self.login()
        self.fetch_nifty_atp()


def main():
    KotakTradingAPI().run()


if __name__ == "__main__":
    main()
