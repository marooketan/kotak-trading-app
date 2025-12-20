# ordertest_final.py
# Corrected test script to place orders via Kotak quick/order/rule/ms/place
# - Sends qt as lots_count * lot_size (Kotak expects lotwise quantity)
# - Reads kotak_master_live.csv to find symbol token and lot size
# - Reuses your existing session from main.kotak_api
# - Prints full request jData and the response
#
# Save this into your backend folder (where main.py lives) and run:
#   python ordertest_final.py

import json
import requests
import pandas as pd
import sys
import os

CSV_PATH = r"C:\Users\Ketan\Desktop\kotak_master_live.csv"

def get_symbol_info(symbol):
    """
    Look up symbol in kotak_master_live.csv and return token/trading-symbol/lot/exchange.
    Raises Exception if not found.
    """
    if not os.path.exists(CSV_PATH):
        raise FileNotFoundError(f"CSV not found at: {CSV_PATH}")
    df = pd.read_csv(CSV_PATH, dtype=str)
    if "pTrdSymbol" not in df.columns:
        raise Exception("Expected column 'pTrdSymbol' not found in CSV. Columns: " + ", ".join(df.columns))
    row = df[df["pTrdSymbol"] == symbol]
    if row.empty:
        raise Exception(f"Symbol not found in CSV: {symbol}")
    r = row.iloc[0]
    # Some CSV rows may have lLotSize or iLotSize or iLotSize with spaces; try multiple names
    lot_col = None
    for c in ("lLotSize", "iLotSize", "lLotSize ", "iLotSize "):
        if c in r.index and pd.notna(r[c]):
            lot_col = c
            break
    lot = int(r[lot_col]) if lot_col else 1
    exch = r.get("pExchSeg", "nse_fo")
    return {
        "token": r.get("pSymbol", ""),
        "ts": r.get("pTrdSymbol"),
        "lot": lot,
        "exch": exch
    }

def login_via_existing_app():
    """
    Reuse the session info from your running backend. This imports main.kotak_api
    and returns the active session dict: {sid, auth, base_url}
    """
    try:
        # Import the kotak_api object from your backend main.py
        # Make sure you run this script from the backend folder so Python finds main.py
        from main import kotak_api
    except Exception as e:
        raise Exception("Could not import kotak_api from main.py. Run this script from the backend folder and ensure main.py defines kotak_api.") from e

    if not getattr(kotak_api, "current_user", None):
        raise Exception("No current_user in kotak_api. Please login within the app first so active_sessions[current_user] exists.")

    user = kotak_api.current_user
    sess = kotak_api.active_sessions.get(user)
    if not sess:
        raise Exception("No active session found for current_user. Please login in the app first.")
    # Expect sess to have keys 'sid', 'token' (auth), and 'base_url'
    sid = sess.get("sid") or sess.get("session_id") or sess.get("session")
    auth = sess.get("token") or sess.get("auth") or sess.get("Auth")
    base_url = sess.get("base_url") or sess.get("baseUrl") or sess.get("base-url")
    if not all([sid, auth, base_url]):
        raise Exception("Session object missing required keys (sid/auth/base_url). Session contents: " + str(sess))
    return {"sid": sid, "auth": auth, "base_url": base_url}

def place_order(symbol, lots_count, side="B", order_type="MKT", price="0"):
    """
    symbol: trading symbol string from CSV (e.g. 'NIFTY25D2328300CE')
    lots_count: number of lots to buy/sell (1 means 1 lot)
    side: 'B' or 'S'
    order_type: 'MKT' or 'L' etc.
    price: string price (for limits)
    """
    info = get_symbol_info(symbol)
    sess = login_via_existing_app()

    # IMPORTANT: Kotak expects 'qt' as lotwise quantity (actual units),
    # so qt = lots_count * lot_size
    actual_quantity = int(lots_count) * int(info["lot"])

    # Build jData according to Kotak docs. All values as strings.
    jData = {
        "am": "NO",              # After market flag
        "dq": "0",               # disclosed quantity
        "es": info["exch"],      # exchange segment e.g. nse_fo
        "mp": "0",               # market protection
        "pc": "NRML",            # product code (keep NRML or change if needed)
        "pf": "N",               # portfolio flag
        "pr": str(price),        # price
        "pt": order_type,        # order type: MKT / L / SL etc.
        "qt": str(actual_quantity),  # <-- SEND actual lotwise quantity (units)
        "rt": "DAY",             # validity
        "tp": "0",               # trigger price (for SL/CO)
        "ts": info["ts"],        # trading symbol
        "tt": side               # transaction type: B / S
    }

    payload = {"jData": json.dumps(jData)}
    headers = {
        "accept": "application/json",
        "Sid": sess["sid"],
        "Auth": sess["auth"],
        "neo-fin-key": "neotradeapi",
        "Content-Type": "application/x-www-form-urlencoded"
    }
    url = sess["base_url"].rstrip("/") + "/quick/order/rule/ms/place"

    print("\n--- Sending Order ---")
    print("URL:", url)
    print("Headers:", {k: ("[REDACTED]" if k.lower() in ("auth","sid") else v) for k,v in headers.items()})
    print("jData:", json.dumps(jData, indent=2))

    try:
        r = requests.post(url, headers=headers, data=payload, timeout=15)
    except Exception as e:
        print("HTTP request failed:", str(e))
        raise

    print("\n--- Response ---")
    print("Status Code:", r.status_code)
    try:
        print("Body:", r.text)
        return r.json()
    except Exception:
        return {"raw": r.text, "status_code": r.status_code}

if __name__ == "__main__":
    # === EDIT THIS before running if you want ===
    # Choose a symbol from your kotak_master_live.csv
    SYMBOL = "NIFTY25D2328300CE"   # <-- change to a symbol that exists in your CSV
    # lots_count is number of lots (1 lot usually corresponds to 75 or whatever your CSV shows)
    LOTS_COUNT = 1  # set to 1 for testing; it will send qt = LOTS_COUNT * lot_size
    # ===============================

    try:
        print("Using CSV:", CSV_PATH)
        info = get_symbol_info(SYMBOL)
        print("Symbol info:", info)
    except Exception as e:
        print("Failed to get symbol info:", e)
        sys.exit(1)

    try:
        print("\n>>> BUY MARKET test")
        resp = place_order(SYMBOL, lots_count=LOTS_COUNT, side="B", order_type="MKT", price="0")
        print("Result:", resp)
    except Exception as e:
        print("Buy market failed:", str(e))

    try:
        print("\n>>> SELL MARKET test")
        resp = place_order(SYMBOL, lots_count=LOTS_COUNT, side="S", order_type="MKT", price="0")
        print("Result:", resp)
    except Exception as e:
        print("Sell market failed:", str(e))

    try:
        print("\n>>> BUY LIMIT test (price set to '1' as example)")
        resp = place_order(SYMBOL, lots_count=LOTS_COUNT, side="B", order_type="L", price="1")
        print("Result:", resp)
    except Exception as e:
        print("Buy limit failed:", str(e))
