import os
import logging
from fastapi import FastAPI, Form, Query, Request, WebSocket
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import requests
from datetime import datetime
import pandas as pd
from typing import Dict, List, Optional
import re
import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import copy
from trade_history import save_trade_to_history

import threading
from strategy.engine import StrategyEngine
import strategy.strategy_config as config
import random
import strategy.strategy_config as config
config.load_config()
from api_client import KotakNiftyAPI
import urllib.parse
import time
import uuid
from config import MASTERPATH, BFO_MASTERPATH, USERS_FILE, SESSION_FILE, MY_MPIN
from shared_market import shared_market
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)




# ======================================================
# 1. INITIALIZE API & ENGINE (MUST BE FIRST)
# ======================================================
kotak_api = KotakNiftyAPI()
# Initialize cache on startup (Load BOTH to be ready)
kotak_api.load_master_into_memory("NFO")
kotak_api.load_master_into_memory("BFO")

# Create the Engine
bot_engine = StrategyEngine(kotak_api)
bot_thread = None

def run_engine_in_background():
    """Helper to run the loop without freezing the server"""
    bot_engine.start()

# ======================================================
# 2. LOGGING SYSTEM (Must be defined before app starts)
# ======================================================
LOG_BUFFER = []

def add_system_log(message):
    """Helper to save logs for the dashboard"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    LOG_BUFFER.append({"time": timestamp, "msg": message})
    # Keep only last 50 logs to save memory
    if len(LOG_BUFFER) > 50:
        LOG_BUFFER.pop(0)
    # Also print to black console so you don't lose it
    print(f"[{timestamp}] {message}")

# ======================================================
# 3. LIFESPAN (Connects Brain to Mouth on Startup)
# ======================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    # === STARTUP LOGIC (Runs once when server starts) ===
    # 1. Connect the Logger (Hand over the microphone)
    bot_engine.log_func = add_system_log
    print("✅ LOGGER CONNECTED: Engine -> Dashboard")
    
    # 2. Force load config
    import strategy.strategy_config as config
    print(f"📊 Current Mode: {'DEMO' if config.USE_DEMO_DATA else 'LIVE'}")
    
    yield  # <--- The Server runs while pausing here
    
    # === SHUTDOWN LOGIC (Runs when you Ctrl+C) ===
    print("🛑 Server Shutting Down...")

# ======================================================
# 4. CREATE APP (Now 'lifespan' is defined, so this works!)
# ======================================================
app = FastAPI(lifespan=lifespan)

# ======================================================
# 5. API ROUTES (Now 'app' is defined, so these work!)
# ======================================================

# === NEW: API TO FETCH LOGS ===
@app.get("/api/logs")
def get_logs():
    return {"logs": LOG_BUFFER}

# ... (The rest of your code, starting with @app.get("/api/users"), follows here) ...
   


# === PASTE THIS INTO main.py (Replacing the old API routes) ===
@app.get("/api/users")
def get_users_list():
    users = kotak_api.load_users_from_file()
    return {"success": True, "users": list(users.keys())}

# === ADD THIS NEW ENDPOINT ===
@app.get("/api/available-indices")
def available_indices(segment: str = Query("NFO")):
    """Get available indices for NFO or BFO segment"""
    safe_segment = segment.upper().strip()
    
    # Default indices for NFO
    if safe_segment == "NFO":
        return {
            "success": True,
            "segment": "NFO",
            "indices": ["NIFTY", "BANKNIFTY"]
        }
    
    # For BFO, check the CSV file
    elif safe_segment == "BFO":
        bfo_path = BFO_MASTERPATH
        if os.path.exists(bfo_path):
            try:
                df = pd.read_csv(bfo_path)
                # Get unique BSE indices (SENSEX, BANKEX, SENSEX50)
                bse_indices = []
                for idx in ['SENSEX', 'BANKEX', 'SENSEX50']:
                    if idx in df['pSymbolName'].values:
                        bse_indices.append(idx)
                
                # If no specific indices found, return at least SENSEX
                if not bse_indices:
                    bse_indices = ["SENSEX"]
                
                return {
                    "success": True,
                    "segment": "BFO",
                    "indices": bse_indices
                }
            except:
                return {
                    "success": True,
                    "segment": "BFO",
                    "indices": ["SENSEX"]
                }
        else:
            # File doesn't exist, return default
            return {
                "success": True,
                "segment": "BFO",
                "indices": ["SENSEX"]
            }
    
    # Invalid segment
    else:
        return {
            "success": False,
            "message": "Invalid segment. Use 'NFO' or 'BFO'"
        }

@app.post("/api/login")
def login_api(totp: str = Form(...), user_id: str = Form(...)): 
    return kotak_api.login(totp, user_id)
@app.post("/api/logout")
def logout_api():
    return kotak_api.logout()

@app.post("/api/switch-user")
def switch_user_api(user_id: str = Form(...)):
    return kotak_api.switch_user(user_id)
@app.post("/api/switch-user")
def switch_user_api(user_id: str = Form(...)):
    return kotak_api.switch_user(user_id)

# === ADD THIS NEW ENDPOINT ===
@app.post("/api/switch-segment")
def switch_segment_api(segment: str = Form(...)):
    """Switch between NFO and BFO segments"""
    valid_segments = ["NFO", "BFO"]
    safe_segment = segment.upper().strip()
    
    if safe_segment not in valid_segments:
        return {"success": False, "message": f"Invalid segment. Use: {valid_segments}"}
    
    # Load appropriate master file
    kotak_api.load_master_into_memory(safe_segment)
    
    return {"success": True, "message": f"Switched to {safe_segment} segment"}


@app.get("/api/session-status")
def session_status_api():
    if kotak_api.current_user and kotak_api.current_user in kotak_api.active_sessions:
        return {"authenticated": True, "user": kotak_api.current_user}
    return {"authenticated": False, "user": None}
# === UPDATED ENDPOINTS (Supports NIFTY & BANKNIFTY) ===
@app.get("/api/expiries")
def expiries_api():
    # Backward compatibility: Default to NIFTY and NFO
    return {"success": True, "expiries": kotak_api.get_expiries("NIFTY", "NFO")}

@app.get("/api/expiries-v2")
def expiries_v2_api(index: str = Query("NIFTY"), segment: str = Query("NFO")):
    """
    Dynamic Expiry: Pass index and segment.
    NFO: 'NIFTY' or 'BANKNIFTY'
    BFO: 'SENSEX' or 'BANKEX'
    """
    # Clean the input
    safe_index = index.upper().strip()
    safe_segment = segment.upper().strip()
    
    # Validate segment
    if safe_segment not in ["NFO", "BFO"]:
        safe_segment = "NFO"
    
    return {"success": True, "expiries": kotak_api.get_expiries(safe_index, safe_segment)}
# === UPDATED: OPTION CHAIN ENDPOINT (Handles NIFTY & BANKNIFTY) ===
# === UPDATED: OPTION CHAIN ENDPOINT ===
@app.get("/api/option-chain")
def chain_api(expiry: str, strikes: str = "10", index: str = "NIFTY", segment: str = "NFO", market: str = None):
    
    # Clean the input
    safe_index = index.upper().strip()
    
    # Use market if provided, otherwise segment
    if market:
        safe_segment = market.upper().strip()
    else:
        safe_segment = segment.upper().strip()
    
    if safe_segment not in ["NFO", "BFO"]:
        safe_segment = "NFO"
    
    # Get data from Kotak API
    result = kotak_api.get_option_chain(safe_index, expiry, strikes)
    
    # 🔥 CRITICAL FIX: Save data EVERY TIME, but print log rarely
    if result.get("success"):
        try:
            import strategy.strategy_config as config
            bot_indices = getattr(config, "BOT_TRADED_INDICES", ["NIFTY"])
            
            # 1. ALWAYS SAVE THE DATA (100% of the time)
            shared_market.update_index_data(
                index_name=safe_index,
                chain=result.get("data", []),
                spot=result.get("spot", 0)
            )

            # Log only once every 60 seconds
            now = time.time()
            last_log = getattr(shared_market, "last_log_time", 0)

            if now - last_log > 60:
                print(f"🔄 SHARED SAVE: Saving {safe_index} data for bot")
                shared_market.last_log_time = now
 
                
        except Exception as e:
            print(f"⚠️ Error saving {safe_index} data: {e}")
    
    return result


@app.get("/api/portfolio")
def portfolio_api():
    return kotak_api.get_positions()
# ======================================================
# STRATEGY API ROUTES (The Waiter)
# ======================================================
# === REPLACEMENT FOR get_strategy_status ===
@app.get("/api/strategy/status")
def get_strategy_status():
    ce_trades = []
    for t in bot_engine.active_ce_trades:
        ce_trades.append({
            "strike": t.strike, 
            "type": "CE", 
            "entry": t.entry_price, 
            "sl": t.sl_price, 
            "pnl": t.pnl, 
            "ltp": t.current_ltp,
            "entry_time": int(t.entry_time),
            "quantity": t.quantity  # <--- ADDED THIS LINE
        })
        
    pe_trades = []
    for t in bot_engine.active_pe_trades:
        pe_trades.append({
            "strike": t.strike, 
            "type": "PE", 
            "entry": t.entry_price, 
            "sl": t.sl_price, 
            "pnl": t.pnl, 
            "ltp": t.current_ltp,
            "entry_time": int(t.entry_time),
            "quantity": t.quantity  # <--- ADDED THIS LINE
        })

    return {
        "running": bot_engine.is_running,
        "state": bot_engine.current_state.value,
        "ce_trades": ce_trades,
        "pe_trades": pe_trades,
        "config": {"sl_percentage": config.SL_PERCENTAGE}
    }
@app.post("/api/trades/{trade_id}/exit")
def exit_single_trade(trade_id: str):
    """Exit one specific trade"""
    try:
        # Use the GLOBAL bot_engine
        all_trades = bot_engine.active_ce_trades + bot_engine.active_pe_trades
        
        for trade in all_trades:
            # Create matching trade_id
            current_trade_id = f"{trade.type}_{trade.strike}_{int(trade.entry_time)}"
            
            if current_trade_id == trade_id:
                print(f"🚨 MANUAL EXIT REQUESTED for {trade.type} {trade.strike}")
                
                # ✅ CRITICAL FIX: CANCEL SL ORDER FIRST
                if not config.PAPER_TRADING and trade.sl_order_id:
                    print(f"   🗑️ Cancelling SL Order #{trade.sl_order_id}")
                    kotak_api.cancel_order(trade.sl_order_id)
                
                # Add cooldown for this strike (same as SL hit)
                unlock_time = time.time() + config.COOLDOWN_SECONDS
                bot_engine.cooldown_list[trade.strike] = unlock_time
                print(f"   🧊 {trade.strike} is BANNED until {time.ctime(unlock_time)}")
                
                # Remove from active trades
                if trade.type == "CE":
                    bot_engine.active_ce_trades.remove(trade)
                else:
                    bot_engine.active_pe_trades.remove(trade)
                bot_engine.exited_trades.append(trade)
                # === SAVE TRADE TO JSON HISTORY ===
                trade_data = {
                    "trade_id": trade_id,
                    "mode": "PAPER" if config.PAPER_TRADING else "LIVE",
                    "symbol": "NIFTY",
                    "type": trade.type,
                    "strike": trade.strike,
                    "entry_price": trade.entry_price,
                    "exit_price": trade.current_ltp,
                    "quantity": trade.quantity,
                    "pnl": trade.pnl,
                    "entry_time": trade.entry_time,
                    "exit_time": int(time.time()),
                    "date": time.strftime("%Y-%m-%d")
                }

                save_trade_to_history(trade_data)

               
 
                # Remove from memory
                bot_engine.memory.remove_trade(trade_id)
                
                return {"success": True, "message": f"Trade {trade_id} exited"}
        
        return {"success": False, "message": "Trade not found"}
    except Exception as e:
        print(f"❌ Error in exit_single_trade: {e}")
        return {"success": False, "message": str(e)}


@app.post("/api/strategy/start")
def start_strategy():
    global bot_thread
    if bot_engine.is_running: return {"success": False, "message": "Already running"}
    bot_thread = threading.Thread(target=run_engine_in_background)
    bot_thread.daemon = True
    bot_thread.start()
    return {"success": True, "message": "Strategy Started"}

@app.post("/api/strategy/stop")
def stop_strategy():
    bot_engine.stop()
    return {"success": True, "message": "Stop Signal Sent"}

# === NEW: RESET BUTTON ===
@app.post("/api/strategy/reset")
def reset_strategy():
    bot_engine.reset_memory()
    return {"success": True, "message": "🧠 Brain Wiped Clean!"}

@app.post("/api/strategy/update-config")
async def update_config(request: Request):
    data = await request.json()
    
    # ✅ STORE OLD VALUES BEFORE CHANGING
    old_values = {
        "SL_PERCENTAGE": config.SL_PERCENTAGE,
        "MAX_OPEN_POSITIONS": config.MAX_OPEN_POSITIONS,
        "PAPER_TRADING": config.PAPER_TRADING,
        "MAX_DAILY_LOSS": config.MAX_DAILY_LOSS,
        "DAILY_TARGET_PROFIT": config.DAILY_TARGET_PROFIT,
        "COOLDOWN_SECONDS": config.COOLDOWN_SECONDS,
        "EXPIRY_OFFSET": config.EXPIRY_OFFSET,
        "START_TIME": config.START_TIME,
        "NO_NEW_ENTRY_TIME": config.NO_NEW_ENTRY_TIME,
        "SQUARE_OFF_TIME": config.SQUARE_OFF_TIME,
        "MIN_BUFFER_PERCENTAGE": config.MIN_BUFFER_PERCENTAGE,
        "MAX_BUFFER_PERCENTAGE": config.MAX_BUFFER_PERCENTAGE,
        "SL_LIMIT_BUFFER": config.SL_LIMIT_BUFFER,
        "USE_DEMO_DATA": config.USE_DEMO_DATA,
        "SL_UPDATE_INTERVAL": config.SL_UPDATE_INTERVAL,
        "LOTS_MULTIPLIER": config.LOTS_MULTIPLIER
    }
    
    changes = []  # Will store what changed
    
    # 1. Update Simple Settings with CHANGE TRACKING
    if "sl_percentage" in data:
        new_value = float(data["sl_percentage"]) / 100.0
        if new_value != config.SL_PERCENTAGE:
            changes.append(f"SL: {config.SL_PERCENTAGE*100}% → {new_value*100}%")
        config.SL_PERCENTAGE = new_value

    if "max_trades" in data:
        new_value = int(data["max_trades"])
        if new_value != config.MAX_OPEN_POSITIONS:
            changes.append(f"Max Trades: {config.MAX_OPEN_POSITIONS} → {new_value}")
        config.MAX_OPEN_POSITIONS = new_value

    if "paper_mode" in data:
        mode_value = data["paper_mode"]
        if isinstance(mode_value, str):
            new_value = (mode_value.upper() == "PAPER")
        else:
            new_value = bool(mode_value)
        if new_value != config.PAPER_TRADING:
            changes.append(f"Mode: {'PAPER' if config.PAPER_TRADING else 'REAL'} → {'PAPER' if new_value else 'REAL'}")
        config.PAPER_TRADING = new_value

    # ✅ DAILY P&L LIMITS
    if "max_daily_loss" in data:
        new_value = float(data["max_daily_loss"])
        if new_value != config.MAX_DAILY_LOSS:
            changes.append(f"Max Daily Loss: ₹{config.MAX_DAILY_LOSS} → ₹{new_value}")
        config.MAX_DAILY_LOSS = new_value

    if "daily_target_profit" in data:
        new_value = float(data["daily_target_profit"])
        if new_value != config.DAILY_TARGET_PROFIT:
            changes.append(f"Daily Target: ₹{config.DAILY_TARGET_PROFIT} → ₹{new_value}")
        config.DAILY_TARGET_PROFIT = new_value
        
    if "cooldown_seconds" in data:
        new_value = int(data["cooldown_seconds"])
        if new_value != config.COOLDOWN_SECONDS:
            changes.append(f"Cooldown: {config.COOLDOWN_SECONDS}s → {new_value}s")
        config.COOLDOWN_SECONDS = new_value
        
    if "expiry_offset" in data:
        new_value = int(data["expiry_offset"])
        if new_value != config.EXPIRY_OFFSET:
            changes.append(f"Expiry Offset: {config.EXPIRY_OFFSET} → {new_value}")
        config.EXPIRY_OFFSET = new_value

    # 2. Update Time Settings
    if "start_time" in data:
        new_value = data["start_time"]
        if new_value != config.START_TIME:
            changes.append(f"Start Time: {config.START_TIME} → {new_value}")
        config.START_TIME = new_value
        
    if "end_time" in data:
        new_value = data["end_time"]
        if new_value != config.NO_NEW_ENTRY_TIME:
            changes.append(f"End Time: {config.NO_NEW_ENTRY_TIME} → {new_value}")
        config.NO_NEW_ENTRY_TIME = new_value
        
    if "exit_time" in data:
        new_value = data["exit_time"]
        if new_value != config.SQUARE_OFF_TIME:
            changes.append(f"Exit Time: {config.SQUARE_OFF_TIME} → {new_value}")
        config.SQUARE_OFF_TIME = new_value
    
    # 3. Update Buffer Settings
    if "min_buffer" in data:
        new_value = float(data["min_buffer"]) / 100.0
        if new_value != config.MIN_BUFFER_PERCENTAGE:
            changes.append(f"Min Buffer: {config.MIN_BUFFER_PERCENTAGE*100}% → {new_value*100}%")
        config.MIN_BUFFER_PERCENTAGE = new_value
        
    if "max_buffer" in data:
        new_value = float(data["max_buffer"]) / 100.0
        if new_value != config.MAX_BUFFER_PERCENTAGE:
            changes.append(f"Max Buffer: {config.MAX_BUFFER_PERCENTAGE*100}% → {new_value*100}%")
        config.MAX_BUFFER_PERCENTAGE = new_value
        
    if "sl_limit_buffer" in data:
        new_value = float(data["sl_limit_buffer"])
        if new_value != config.SL_LIMIT_BUFFER:
            changes.append(f"SL Buffer: {config.SL_LIMIT_BUFFER} → {new_value}")
        config.SL_LIMIT_BUFFER = new_value

    # 4. Other Settings
    if "use_demo_data" in data:
        new_value = bool(data["use_demo_data"])
        if new_value != config.USE_DEMO_DATA:
            changes.append(f"Demo Data: {config.USE_DEMO_DATA} → {new_value}")
        config.USE_DEMO_DATA = new_value
        
    if "sl_interval" in data:
        new_value = int(data["sl_interval"]) * 60
        if new_value != config.SL_UPDATE_INTERVAL:
            changes.append(f"SL Interval: {config.SL_UPDATE_INTERVAL//60}m → {new_value//60}m")
        config.SL_UPDATE_INTERVAL = new_value
        
    if "lots_multiplier" in data:
        new_value = int(data["lots_multiplier"])
        if new_value != config.LOTS_MULTIPLIER:
            changes.append(f"Lot Multiplier: x{config.LOTS_MULTIPLIER} → x{new_value}")
        config.LOTS_MULTIPLIER = new_value

    # ✅ SMART LOGGING: Only show changes
    if changes:
        print(f"\n✅ CONFIG UPDATED - CHANGES:")
        for change in changes:
            print(f"   ➤ {change}")
        print("-" * 40)
    else:
        print("\n⚠️ CONFIG: No changes detected")
    
    config.save_config()
    return {"success": True, "message": "Config Updated"}

@app.get("/api/order-book")
def order_book_api():
    return kotak_api.get_order_book()

# === NEW: SMART PORTFOLIO LTP UPDATE ===
@app.get("/api/portfolio-ltp")
def portfolio_ltp_api(symbols: str = Query("")):
    """Smart refresh: returns ONLY LTP for comma-separated symbols"""
    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]
    return kotak_api.get_position_ltp_only(symbol_list)

# --- CRITICAL FIX: Removed 'async' here ---
@app.get("/api/index-quotes")
def index_quotes():
    if not kotak_api.current_user: return {"error": "Not logged in"}
    
    try:
        base_url = kotak_api.active_sessions[kotak_api.current_user]["base_url"]
        
        # Get spot prices for all indices
        quotes_query = "nse_cm|Nifty 50,nse_cm|Nifty Bank,nse_cm|Nifty Fin Service,bse_cm|SENSEX"
        response = requests.get(f"{base_url}/script-details/1.0/quotes/neosymbol/{quotes_query}", headers=kotak_api.get_headers())
        
        result = []
        if response.status_code == 200:
            data = response.json()
            quotes_list = data if isinstance(data, list) else data.get('data', [])
            
            for d in quotes_list:
                if isinstance(d, dict):
                    token = d.get("exchange_token") or d.get("display_symbol")
                    ltp = float(d.get('ltp', 0))
                    
                    # Map to display names
                    display_name = ""
                    if "Nifty 50" in str(token): display_name = "NIFTY 50"
                    elif "Nifty Bank" in str(token): display_name = "BANK NIFTY"
                    elif "Nifty Fin Service" in str(token): display_name = "FINNIFTY"
                    elif "SENSEX" in str(token): display_name = "SENSEX"
                    
                    if display_name:
                        result.append({"name": display_name, "ltp": f"{ltp:.2f}"})
        
        # Try to get MIDCPNIFTY futures price
        try:
            # Load CSV to find futures token
            import pandas as pd
            csv_path = r"C:\Users\Ketan\Desktop\kotak_master_live.csv"
            if os.path.exists(csv_path):
                df = pd.read_csv(csv_path)
                midcp_futures = df[(df['pSymbolName'] == 'MIDCPNIFTY') & 
                                   (df['pTrdSymbol'].astype(str).str.contains('FUT'))]
                
                if not midcp_futures.empty:
                    futures_token = str(midcp_futures.iloc[0]['pSymbol']).strip()
                    futures_url = f"{base_url}/script-details/1.0/quotes/neosymbol/nse_fo|{futures_token}"
                    futures_response = requests.get(futures_url, headers=kotak_api.get_headers(), timeout=2)
                    
                    if futures_response.status_code == 200:
                        futures_data = futures_response.json()
                        ltp = 0
                        if isinstance(futures_data, list) and len(futures_data) > 0:
                            ltp = float(futures_data[0].get('ltp', 0))
                        elif isinstance(futures_data, dict) and 'data' in futures_data:
                            ltp = float(futures_data['data'][0].get('ltp', 0))
                        
                        result.append({"name": "MIDCPNIFTY", "ltp": f"{ltp:.2f}"})
        except:
            pass  # Skip if can't get futures price
            
        return result
        
    except Exception as e:
        logger.error(f"Index quotes error: {e}")
        return []
# Keep this one ASYNC (Place Order)
@app.post("/api/place-order")
async def place_order_api(request: Request):
    data = await request.json()

    segment = data.get("segment", "NFO")  # default NFO if not sent
    symbol = data.get("symbol", "") or ""

    # 👇 NEW: force BFO for SENSEX / BANKEX
    if symbol.startswith("SENSEX") or symbol.startswith("BANKEX"):
        segment = "BFO"

    return kotak_api.place_order(
        data.get("symbol"),
        data.get("transaction_type"),
        data.get("quantity"),
        data.get("product_code", "NRML"),
        data.get("price", "0"),
        data.get("order_type", "MKT"),
        segment=segment,
        trigger_price=data.get("trigger_price")  # <--- NEW ARGUMENT ADDED
    )
# Keep this one ASYNC (Cancel Order)
@app.post("/api/cancel-order")
async def cancel_order_api(request: Request):
    data = await request.json()
    return kotak_api.cancel_order(data.get("order_number"))

# Keep this one ASYNC (Modify Order)
@app.post("/api/modify-order")
async def modify_order_api(request: Request):
    data = await request.json()
    return kotak_api.modify_order(
        data.get("order_number"), 
        data.get("symbol"), 
        data.get("new_price"), 
        data.get("new_quantity"), 
        data.get("new_order_type"), 
        data.get("new_expiry"),
        data.get("new_trigger_price") # <--- NEW ARGUMENT ADDED
    )
# === FAST LOT SIZE LOOKUP (FROM DICT CACHE) ===
@app.get("/api/lot-size")
def lot_size(symbol: str = Query(...), segment: str = Query("NFO")):
    """Instant Lot Size Lookup using Dictionary with segment support"""
    
    # Try cache first (if cache was loaded for this segment)
    if symbol in kotak_api.lot_cache:
        return {"success": True, "lot_size": int(kotak_api.lot_cache[symbol])}
    
    # Determine which master file to check
    master_path = MASTERPATH if segment == "NFO" else BFO_MASTERPATH
    
    if not os.path.exists(master_path):
        return {"success": True, "lot_size": 1}
    
    try:
        try:
            df = pd.read_csv(master_path)
        except:
            df = pd.read_csv(master_path, sep='|')
        
        df.columns = df.columns.str.strip()
        row = df[df['pTrdSymbol'].astype(str).str.strip() == symbol]
        
        if row.empty:
            return {"success": True, "lot_size": 1}
        
        return {"success": True, "lot_size": int(row.iloc[0]['lLotSize'])}
    except:
        return {"success": True, "lot_size": 1}
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
# DEMO MODE API
@app.post("/api/demo/move-prices")
def move_demo_prices():
    """Move demo prices randomly"""
    from strategy.demo_data import demo
    
    # Move spot
    demo.spot += random.randint(-50, 50)
    
    # Get new chain
    chain = demo.get_chain()
    
    # Find highest OI CE and PE
    highest_ce = max(chain, key=lambda x: x["call"]["oi"])
    highest_pe = max(chain, key=lambda x: x["put"]["oi"])
    
    return {
        "success": True,
        "data": chain,
        "spot": demo.spot,
        "highest_ce": highest_ce["strike"],
        "highest_pe": highest_pe["strike"],
        "message": "Prices moved!"
    }

# ======================================================
# NEW API: BOT GETS MARKET DATA FOR ANY INDEX
# ======================================================
@app.get("/api/bot/market-data")
def get_bot_market_data(index: str = "NIFTY"):
    """Bot gets data for any index from shared storage"""
    # Clean the index name
    safe_index = index.upper().strip()
    
    # Get data from shared storage
    data = shared_market.get_index_data(safe_index)
    
    if data is None:
        return {
            "success": False,
            "message": f"No data found for {safe_index}. Dashboard may not be fetching this index."
        }
    
    # Check freshness (less than 5 seconds old)
    is_fresh = (time.time() - data.get("timestamp", 0)) < 5
    
    return {
        "success": True,
        "index": safe_index,
        "data": data.get("chain", []),
        "spot": data.get("spot", 0),
        "highest_ce": data.get("highest_ce", 0),
        "highest_pe": data.get("highest_pe", 0),
        "timestamp": data.get("timestamp", 0),
        "is_fresh": is_fresh,
        "message": f"✅ Fresh {safe_index} data" if is_fresh else f"⚠️ {safe_index} data may be stale"
    }
@app.get("/api/strategy/config")
def get_strategy_config():
    return {
        "success": True,
        "config": {
            "start_time": config.START_TIME,
            "no_new_entry_time": config.NO_NEW_ENTRY_TIME,
            "square_off_time": config.SQUARE_OFF_TIME,
            "min_buffer": config.MIN_BUFFER_PERCENTAGE * 100,
            "max_buffer": config.MAX_BUFFER_PERCENTAGE * 100,
            "sl_percentage": config.SL_PERCENTAGE,
            "sl_limit_buffer": config.SL_LIMIT_BUFFER,
            "max_daily_loss": config.MAX_DAILY_LOSS,
            "daily_target_profit": config.DAILY_TARGET_PROFIT,

            "sl_interval": config.SL_UPDATE_INTERVAL // 60,
            "max_trades": config.MAX_OPEN_POSITIONS,
            "lots_multiplier": config.LOTS_MULTIPLIER,
            "paper_trading": config.PAPER_TRADING,
            "use_demo_data": config.USE_DEMO_DATA,
            "cooldown_seconds": config.COOLDOWN_SECONDS,
            "expiry_offset": config.EXPIRY_OFFSET

        }
    }

# ======================================================
# NEW API: DASHBOARD GETS BOT'S TRADING CONFIG
# ======================================================
@app.get("/api/bot/config/indices")
def get_bot_trading_indices():
    """Dashboard calls this to know which indices bot trades"""
    import strategy.strategy_config as config
    
    # Get the list from config (default to ["NIFTY"] if not set)
    indices = getattr(config, "BOT_TRADED_INDICES", ["NIFTY"])
    
    return {
        "success": True,
        "bot_traded_indices": indices,
        "message": f"Bot trades {len(indices)} indices: {', '.join(indices)}"
    }


@app.get("/api/trade-history")
def get_trade_history():
    """
    READ-ONLY trade history for dashboard
    Returns last N days of PAPER + LIVE trades
    """
    file_path = "trade_history.json"

    if not os.path.exists(file_path):
        return {
            "success": True,
            "trades": [],
            "message": "No trade history file found"
        }

    try:
        with open(file_path, "r") as f:
            data = json.load(f)

        trades = data.get("trades", [])

        # Sort latest first (newest on top)
        trades_sorted = sorted(
            trades,
            key=lambda x: x.get("exit_time", 0),
            reverse=True
        )

        return {
            "success": True,
            "trades": trades_sorted,
            "retention_days": data.get("retention_days", 0),
            "count": len(trades_sorted)
        }

    except Exception as e:
        return {
            "success": False,
            "message": f"Failed to read trade history: {e}"
        }


@app.get("/api/exited_trades")
def get_exited_trades():
    exited_list = []
    total_pnl = 0

    if hasattr(bot_engine, 'exited_trades') and bot_engine.exited_trades:
        for trade in bot_engine.exited_trades:
            exited_list.append({
                "type": trade.type,
                "strike": trade.strike,
                "entry_price": trade.entry_price,
                "exit_price": trade.current_ltp,
                "pnl": trade.pnl,
                "quantity": trade.quantity,
                "entry_time": datetime.fromtimestamp(trade.entry_time).strftime("%H:%M:%S"),  # <-- FIXED
                "exit_time": datetime.now().strftime("%H:%M:%S")
            })
            total_pnl += trade.pnl

    return {
        "exited_trades": exited_list,
        "total_pnl": round(total_pnl, 2)
    }
if os.path.exists(frontend_path): app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
if __name__ == "__main__":
    import uvicorn
    
    logger.info("🚀 Server starting on http://localhost:8000")
    
    # Turn OFF access logs (the spam), keep error logs
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=8000,
        access_log=False  # ← THIS STOPS THE SPAM!
    )