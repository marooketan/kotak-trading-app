import sys
import os

# 1. Help Python find the 'backend' folder
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from main import kotak_api 
    print("✅ SUCCESS: Connected to 'kotak_api'.")
except ImportError as e:
    print(f"❌ ERROR: Could not import. Reason: {e}")
    sys.exit()

# === THE MAGIC FIX ===
# We load the login session you created in your browser/dashboard
print("🔑 Loading saved session from disk...")
kotak_api.load_session_from_disk()

if not kotak_api.current_user:
    print("⚠️ WARNING: No active session found on disk.")
    print("👉 ACTION REQUIRED: Please Login to your Dashboard (localhost:8000) first, then run this test.")
    sys.exit()
else:
    print(f"👤 Logged in as: {kotak_api.current_user}")

print("\n🔎 Step 1: Fetching Expiry Dates...")
try:
    # Use explicit NIFTY/NFO to be safe
    expiries = kotak_api.get_expiries("NIFTY", "NFO")
    
    if not expiries:
        print("❌ ERROR: No expiry dates found.")
        sys.exit()

    first_expiry = expiries[0]
    print(f"✅ Found Expiry: {first_expiry}")

    print(f"\n🔎 Step 2: Fetching Option Chain for {first_expiry}...")
    data = kotak_api.get_option_chain("NIFTY", first_expiry)
    
    if data and data.get("success") == True:
        chain = data.get("data", [])
        spot = data.get("spot", 0)
        print(f"✅ SUCCESS! Data Received.")
        print(f"📈 NIFTY Spot: {spot}")
        print(f"📊 Strikes: {len(chain)}")
        if len(chain) > 0:
            print(f"📝 First Strike CE LTP: {chain[0]['call']['ltp']}")
    else:
        print(f"❌ ERROR: {data.get('message')}")

except Exception as e:
    print(f"❌ CRITICAL ERROR: {e}")