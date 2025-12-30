# test_dec11_expiry.py
import pandas as pd
import requests
import json
from datetime import datetime

BFO_PATH = r"C:\Users\Ketan\Desktop\kotak_bfo_live.csv"
SESSION_FILE = r"C:\Users\Ketan\Desktop\kotak_trading_app\backend\session_cache.json"
USERS_FILE = r"C:\Users\Ketan\Desktop\kotak_trading_app\backend\users.json"

def get_auth():
    """Get authentication headers"""
    with open(SESSION_FILE, 'r') as f:
        session_data = json.load(f)
    
    current_user = session_data["current_user"]
    session = session_data["sessions"][current_user]
    
    with open(USERS_FILE, 'r') as f:
        users = json.load(f)
    
    access_token = users.get(current_user, {}).get("access_token", "")
    
    return {
        "base_url": session["base_url"],
        "headers": {
            "Authorization": access_token,
            "Auth": session["token"],
            "Sid": session["sid"],
            "neo-fin-key": "neotradeapi",
            "Content-Type": "application/json"
        }
    }

def test_dec11_expiry():
    """Test specifically for 11-Dec-2025 expiry"""
    
    print("🔍 TESTING 11-DEC-2025 EXPIRY")
    print("="*60)
    
    # 1. Get auth
    auth = get_auth()
    
    # 2. Get current SENSEX spot
    spot_url = f"{auth['base_url']}/script-details/1.0/quotes/neosymbol/bse_cm|SENSEX"
    response = requests.get(spot_url, headers=auth['headers'], timeout=5)
    
    if response.status_code == 200:
        data = response.json()
        spot_price = float(data[0]['ltp']) if isinstance(data, list) else float(data.get('ltp', 0))
        print(f"📈 Current SENSEX: {spot_price}")
    else:
        spot_price = 85712  # Yesterday's close
        print(f"⚠️ Using approximate spot: {spot_price}")
    
    # 3. Load BFO CSV
    df = pd.read_csv(BFO_PATH)
    sensex_df = df[df['pSymbolName'] == 'SENSEX'].copy()
    
    # 4. Parse expiry dates from BFO (epoch timestamps)
    if 'pExpiryDate' in sensex_df.columns:
        # Convert epoch to date
        sensex_df['expiry_date'] = sensex_df['pExpiryDate'].apply(
            lambda x: datetime.fromtimestamp(int(x)).strftime('%d-%b-%Y') 
            if pd.notnull(x) and str(x).isdigit() else None
        )
    else:
        print("❌ No expiry date column found")
        return
    
    # 5. Find 11-Dec-2025 expiry
    dec11_df = sensex_df[sensex_df['expiry_date'] == '11-Dec-2025'].copy()
    
    if len(dec11_df) == 0:
        print("❌ No instruments found for 11-Dec-2025 expiry")
        # Try alternative date format
        dec11_df = sensex_df[sensex_df['expiry_date'] == '11-Dec-2025 00:00:00'].copy()
    
    print(f"\n📅 Found {len(dec11_df)} instruments for 11-Dec-2025 expiry")
    
    if len(dec11_df) == 0:
        print("⚠️ Trying to find December expiries...")
        dec_df = sensex_df[sensex_df['expiry_date'].str.contains('Dec-2025', na=False)]
        print(f"   Found {len(dec_df)} December 2025 instruments")
        
        # Show unique expiry dates
        unique_expiries = dec_df['expiry_date'].unique()
        print(f"   December expiry dates: {unique_expiries[:5]}")
        
        # Use first December expiry
        if len(dec_df) > 0:
            first_expiry = dec_df['expiry_date'].iloc[0]
            print(f"   Using first December expiry: {first_expiry}")
            dec11_df = dec_df[dec_df['expiry_date'] == first_expiry].copy()
    
    # 6. Identify strike column
    strike_col = 'dStrikePrice' if 'dStrikePrice' in dec11_df.columns else 'dStrikePrice;'
    
    # Convert strikes to proper format
    dec11_df['strike'] = dec11_df[strike_col].apply(
        lambda x: int(float(x) / 100) if pd.notnull(x) else 0
    )
    
    # 7. Filter near strikes (85500-86500)
    near_df = dec11_df[
        (dec11_df['strike'] >= 85500) &
        (dec11_df['strike'] <= 86500)
    ].copy()
    
    print(f"\n🎯 Options near {spot_price} (85500-86500): {len(near_df)}")
    
    if len(near_df) == 0:
        print("⚠️ No near strikes found, showing all strikes:")
        near_df = dec11_df.copy()
    
    # 8. Test CE and PE
    print("\n📊 CALL OPTIONS (CE):")
    print("-"*40)
    
    ce_df = near_df[near_df['pOptionType'] == 'CE'].sort_values('strike')
    
    working_ce = 0
    for idx, row in ce_df.head(5).iterrows():
        symbol = row['pTrdSymbol']
        token = str(row['pSymbol']).strip()
        strike = row['strike']
        
        print(f"\n🔷 {symbol}")
        print(f"   Strike: {strike} (Diff: {strike - spot_price:+.0f})")
        print(f"   Token: {token}")
        
        # Fetch price with bse_fo
        url = f"{auth['base_url']}/script-details/1.0/quotes/neosymbol/bse_fo|{token}"
        response = requests.get(url, headers=auth['headers'], timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict) and 'fault' in data:
                print(f"   ❌ Fault: Invalid neosymbol")
            else:
                # Handle response
                if isinstance(data, list):
                    data = data[0]
                elif isinstance(data, dict) and 'data' in data:
                    if isinstance(data['data'], list):
                        data = data['data'][0]
                    else:
                        data = data['data']
                
                ltp = data.get('ltp', 0)
                print(f"   ✅ LTP: {ltp}")
                
                if float(ltp) > 0:
                    working_ce += 1
                    print(f"   🎯 ACTIVE!")
        else:
            print(f"   ❌ HTTP {response.status_code}")
    
    print("\n📊 PUT OPTIONS (PE):")
    print("-"*40)
    
    pe_df = near_df[near_df['pOptionType'] == 'PE'].sort_values('strike')
    
    working_pe = 0
    for idx, row in pe_df.head(5).iterrows():
        symbol = row['pTrdSymbol']
        token = str(row['pSymbol']).strip()
        strike = row['strike']
        
        print(f"\n🔶 {symbol}")
        print(f"   Strike: {strike} (Diff: {strike - spot_price:+.0f})")
        print(f"   Token: {token}")
        
        # Fetch price with bse_fo
        url = f"{auth['base_url']}/script-details/1.0/quotes/neosymbol/bse_fo|{token}"
        response = requests.get(url, headers=auth['headers'], timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict) and 'fault' in data:
                print(f"   ❌ Fault: Invalid neosymbol")
            else:
                # Handle response
                if isinstance(data, list):
                    data = data[0]
                elif isinstance(data, dict) and 'data' in data:
                    if isinstance(data['data'], list):
                        data = data['data'][0]
                    else:
                        data = data['data']
                
                ltp = data.get('ltp', 0)
                print(f"   ✅ LTP: {ltp}")
                
                if float(ltp) > 0:
                    working_pe += 1
                    print(f"   🎯 ACTIVE!")
        else:
            print(f"   ❌ HTTP {response.status_code}")
    
    # 9. Summary
    print("\n" + "="*60)
    print("FINAL VALIDATION SUMMARY")
    print("="*60)
    
    total_tested = min(len(ce_df), 5) + min(len(pe_df), 5)
    total_working = working_ce + working_pe
    
    print(f"\n📊 Results for 11-Dec-2025 expiry:")
    print(f"   Total tested: {total_tested}")
    print(f"   Working (HTTP 200): {total_working}")
    print(f"   Success rate: {(total_working/total_tested)*100:.1f}%" if total_tested > 0 else "N/A")
    
    if total_working > 0:
        print(f"\n✅ CONCLUSION: bse_fo exchange WORKS for SENSEX!")
        print(f"✅ We can FIX main.py with confidence")
        print(f"\n🔧 Required fixes in main.py:")
        print(f"   1. Spot price: nse_cm → bse_cm for SENSEX")
        print(f"   2. Option quotes: nse_fo → bse_fo for SENSEX")
        print(f"   3. Keep NFO logic unchanged")
    else:
        print(f"\n⚠️ Need to check token validity or wait for market hours")

def quick_bulk_test():
    """Quick test of multiple tokens"""
    
    print("\n" + "="*60)
    print("QUICK BULK TEST")
    print("="*60)
    
    auth = get_auth()
    
    # Known working tokens from previous tests
    working_tokens = [
        "886938",  # SENSEX25DEC85300CE (worked earlier)
        "887128",  # SENSEX25DEC85300PE (worked earlier)
        "1134695", # SENSEX25D1185900PE (worked earlier)
    ]
    
    print(f"Testing {len(working_tokens)} known working tokens...")
    
    success_count = 0
    for token in working_tokens:
        url = f"{auth['base_url']}/script-details/1.0/quotes/neosymbol/bse_fo|{token}"
        response = requests.get(url, headers=auth['headers'], timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict) and 'fault' not in data:
                success_count += 1
                print(f"✅ Token {token}: HTTP 200")
            else:
                print(f"⚠️ Token {token}: Fault response")
        else:
            print(f"❌ Token {token}: HTTP {response.status_code}")
    
    print(f"\n📊 Success: {success_count}/{len(working_tokens)}")
    
    if success_count == len(working_tokens):
        print("🎉 ALL KNOWN TOKENS WORK WITH bse_fo!")

if __name__ == "__main__":
    test_dec11_expiry()
    quick_bulk_test()
    
    print("\n" + "="*60)
    print("READY TO FIX main.py?")
    print("="*60)
    print("\nIf most tests pass, we can apply these 3 fixes:")
    print("1. In get_option_chain(), change spot_url for BSE indices")
    print("2. In get_option_chain(), change slugs from nse_fo to bse_fo for BSE")
    print("3. Test with curl: http://localhost:8000/api/option-chain?index=SENSEX&expiry=11-Dec-2025&strikes=5&segment=BFO")