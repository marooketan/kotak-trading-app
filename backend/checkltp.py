# ordertest_final.py
# Place-test script with candidate neosymbols, LTP fallback for BUY_MKT,
# and polling of order book for final status.
#
# WARNING: This WILL place real orders if your session is live.
# Use small LOTS_COUNT (1) for testing.
# Run from backend folder: python ordertest_final.py

import os, json, time, requests, pandas as pd, datetime

CSV_PATH = r"C:\Users\Ketan\Desktop\kotak_master_live.csv"

SYMBOL = "NIFTY25D2328300CE"
LOTS_COUNT = 1
TEST_ACTIONS = [
    ("BUY_MARKET", "B", "MKT"),
    ("SELL_MARKET", "S", "MKT"),
    ("BUY_LIMIT_TEST", "B", "L"),
]

TERMINAL_SUCCESS = {"TRADED", "EXECUTED", "COMPLETED", "FILLED"}
TERMINAL_FAILURE = {"REJECTED", "CANCELLED"}
POLL_ATTEMPTS = 10
POLL_SLEEP_SEC = 0.5

def load_row(symbol):
    df = pd.read_csv(CSV_PATH, dtype=str)
    row = df[df["pTrdSymbol"] == symbol]
    if row.empty:
        raise Exception(f"Symbol {symbol} not found in CSV.")
    return row.iloc[0]

def build_candidates(row):
    candidates = []
    for key in ("pScripRefKey","pCombinedSymbol","pTrdSymbol","pSymbol"):
        if key in row.index and pd.notna(row[key]):
            candidates.append((key, str(row[key])))
    seen=set(); out=[]
    for k,v in candidates:
        if v not in seen:
            out.append((k,v)); seen.add(v)
    return out

def get_session_from_main():
    from main import kotak_api
    user = kotak_api.current_user
    sess = kotak_api.active_sessions.get(user)
    return kotak_api, sess

def try_quotes(base_url, headers, candidate_value):
    url = f"{base_url.rstrip('/')}/script-details/1.0/quotes/neosymbol/{requests.utils.requote_uri(candidate_value)}"
    try:
        r = requests.get(url, headers=headers, timeout=8)
        try: return r.status_code, r.json()
        except: return r.status_code, r.text
    except Exception as e:
        return None, f"request-error: {e}"

def place_via_kotak(kotak_api_obj, final_symbol, transaction_type, quantity_units, product_code, price_str, order_type):
    try:
        return kotak_api_obj.place_order(final_symbol, transaction_type, quantity_units, product_code, price_str, order_type)
    except Exception as e:
        return {"stat":"Not_Ok","emsg":f"Exception: {e}"}

def extract_kotak_error(resp):
    if not isinstance(resp, dict): return None,None
    return resp.get("stCode") or resp.get("status_code"), resp.get("errMsg") or resp.get("emsg") or resp.get("message")

def check_order_status(kotak_api_obj, order_number):
    ob = kotak_api_obj.get_order_book()
    if isinstance(ob, list):
        for o in ob:
            if str(o.get("nOrdNo"))==str(order_number) or str(o.get("order_number"))==str(order_number):
                return o
    elif isinstance(ob, dict) and "orders" in ob:
        for o in ob["orders"]:
            if str(o.get("nOrdNo"))==str(order_number) or str(o.get("order_number"))==str(order_number):
                return o
    return None

def normalize_status(entry):
    if not entry: return ""
    return (entry.get("kotak_status") or entry.get("status") or "").strip().upper()

def poll_order_status(kotak_api_obj, order_number):
    entry=None
    for _ in range(POLL_ATTEMPTS):
        entry=check_order_status(kotak_api_obj, order_number)
        s=normalize_status(entry)
        if s in TERMINAL_SUCCESS or s in TERMINAL_FAILURE:
            return entry
        time.sleep(POLL_SLEEP_SEC)
    return entry

def main():
    print("Loading CSV row for symbol:", SYMBOL)
    row=load_row(SYMBOL)
    candidates=build_candidates(row)
    for k,v in candidates: print("  -",k,"=>",v)

    kotak_api_obj,sess=get_session_from_main()
    try: headers=kotak_api_obj.get_headers()
    except: headers={"accept":"application/json","Sid":sess.get("sid"),"Auth":sess.get("token"),"neo-fin-key":"neotradeapi"}
    base_url=sess.get("base_url")

    lot=None
    for c in ("lLotSize","iLotSize","iLotSize ","lLotSize "):
        if c in row.index and pd.notna(row[c]): lot=int(row[c]); break
    if not lot: lot=1
    actual_quantity=int(LOTS_COUNT)*lot
    print(f"Using lot size={lot}, lots_count={LOTS_COUNT} -> qt={actual_quantity}")

    product_code="NRML"

    for action_name,side,otype in TEST_ACTIONS:
        print("\n=== ACTION:",action_name,"===")
        placed=False
        for field,cand in candidates:
            print(f"Trying candidate {field} -> {cand}")
            scode,qresp=try_quotes(base_url,headers,cand)
            print(" Quote HTTP:",scode)

            resp=place_via_kotak(kotak_api_obj,cand,side,actual_quantity,product_code,str(0 if otype=="MKT" else 1),otype)
            print("Place response:",resp)

            stCode,emsg=extract_kotak_error(resp)
            order_number=resp.get("nOrdNo") or resp.get("order_number")
            if order_number:
                status_entry=poll_order_status(kotak_api_obj,order_number)
                print("Order book status:",json.dumps(status_entry,indent=2))
                final_state=normalize_status(status_entry)
                if final_state in TERMINAL_SUCCESS:
                    print("Final outcome: SUCCESS (exchange accepted).")
                else:
                    print("Final outcome: FAILURE (exchange rejected).")
                placed=True
                break
            else:
                print("Candidate did not work; continuing.")
            time.sleep(0.3)

        if not placed:
            print("No candidates succeeded for action",action_name)

if __name__=="__main__":
    main()
