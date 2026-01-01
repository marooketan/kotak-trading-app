# test_now.py
import time
import requests

print("Testing Memory Box System...")

# 1. Tell dashboard wants SENSEX
print("\n1. Dashboard selecting SENSEX...")
response = requests.post(
    "http://localhost:8000/api/dashboard/select-index",
    data={"index": "SENSEX", "strikes": "15"}
)
print(f"   Response: {response.json()}")

# 2. Wait for fetcher to run (3 cycles)
print("\n2. Waiting for fetcher to run...")
time.sleep(3)

# 3. Check Memory Box
print("\n3. Checking Memory Box...")
response = requests.get("http://localhost:8000/api/memory-box/status")
status = response.json()
print(f"   Indices: {status.get('indices_stored')}")
print(f"   Option chains: {status.get('option_chains_stored')}")

# 4. Get NIFTY
print("\n4. Getting NIFTY (for bot)...")
response = requests.get("http://localhost:8000/api/memory-box/index-price?index=NIFTY")
print(f"   NIFTY: {response.json()}")

# 5. Get SENSEX
print("\n5. Getting SENSEX (for dashboard)...")
response = requests.get("http://localhost:8000/api/memory-box/option-chain?index=SENSEX")
sensex = response.json()
if sensex.get("success"):
    print(f"   ✅ SENSEX data found! {len(sensex['chain'])} strikes")
else:
    print(f"   ❌ {sensex.get('message')}")

print("\n✅ Test complete!")