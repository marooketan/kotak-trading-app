import time
import sys
import os
import datetime
import strategy.strategy_config as config
from strategy.state import StrategyState
from database.memory_helper import TradeMemory
from strategy.oi_tracker import OITracker
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import json
import threading
from strategy.demo_data import DemoMarket
demo = DemoMarket()


# === THE TRADE FILE FOLDER ===
class Trade:
    def __init__(self, strike, type, entry_price, sl_price, entry_time, order_id=None, sl_order_id=None):
        self.strike = strike
        self.type = type
        self.entry_price = entry_price
        self.sl_price = sl_price
        self.entry_time = entry_time
        self.pnl = 0.0
        self.current_ltp = entry_price 
        self.entry_order_id = order_id
        self.sl_order_id = sl_order_id
        
        self.quantity = 0 

class ConfigHandler(FileSystemEventHandler):
    def __init__(self, engine):
        self.engine = engine

    def on_modified(self, event):
        if event.src_path.endswith('strategy_config.py'):
            self.engine.reload_config()

class StrategyEngine:
    def __init__(self, api_instance, log_callback=None):
        print("⚙️ Initializing Portfolio Manager...")
        self.api = api_instance
        self.log_func = log_callback
        self.current_state = StrategyState.IDLE
        self.tracker = OITracker()
        self.is_running = False
        
        self.active_ce_trades = []
        self.active_pe_trades = []
        self.exited_trades = []  # Stores all closed trades
        self.cooldown_list = {}
        self.last_sl_update_time = time.time()
        self.memory = TradeMemory()
        self.buffer_timers = {}  # format: {"CE_26200": entry_timestamp}

    def reload_config(self):
        """Reload config when file changes"""
        try:
            import strategy.strategy_config
            importlib.reload(strategy.strategy_config)
            self.log_message("✅ Config reloaded!")
        except Exception as e:
            self.log_message(f"❌ Failed to reload: {e}") 

    def log_message(self, msg):
        """Sends logs to both Console (Black Box) and Dashboard (Web)"""
        if self.log_func:
            self.log_func(msg)
        else:
            timestamp = datetime.datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] {msg}")

    # === TIME HELPERS ===
    def get_current_time_str(self):
        return datetime.datetime.now().strftime("%H:%M")

    def is_time_between(self, start_str, end_str):
        now = datetime.datetime.now().time()
        start = datetime.datetime.strptime(start_str, "%H:%M").time()
        end = datetime.datetime.strptime(end_str, "%H:%M").time()
        return start <= now <= end

    def is_after_time(self, target_time_str):
        now = datetime.datetime.now().time()
        target = datetime.datetime.strptime(target_time_str, "%H:%M").time()
        return now >= target

    def reset_memory(self):
        self.log_message("🧹 CLEARING BRAIN MEMORY...")
        self.active_ce_trades = []
        self.active_pe_trades = []
        self.exited_trades = []  # Clear exited trades on reset
        self.cooldown_list = {}
        self.tracker = OITracker()
        return True

    def start(self):
        self.log_message(">>> Strategy Engine STARTED.")
        self.is_running = True
        
        self.api.load_session_from_disk()
        if not self.api.current_user:
            self.log_message("⚠️ Engine Stopped: No User Logged In.")
            self.stop()
            return

        try:
            scan_counter = 0  # NEW: Counter for slow scanning
            
            while self.is_running:
                current_str = self.get_current_time_str()
                current_time = time.time()
                
                # 1. CHECK SQUARE OFF TIME
                if self.is_after_time(config.SQUARE_OFF_TIME):
                    self.log_message(f"⏰ SQUARE OFF TIME REACHED ({config.SQUARE_OFF_TIME}). Closing All Positions.")
                    self.square_off_all()
                    time.sleep(10) 
                    continue

                # 2. CHECK START TIME
                if not self.is_after_time(config.START_TIME):
                    print(f"⏳ Market Open. Waiting for Start Time: {config.START_TIME} (Current: {current_str})")
                    time.sleep(60)
                    continue

                # 3. FAST LOOP: Manage active trades (every 2 seconds)
                self.manage_active_trades(current_time)
                
                # 4. SLOW LOOP: Scan for new entries (every 60 seconds)
                scan_counter += 2  # Because we sleep 2 seconds below
                if scan_counter >= config.PRICE_CHECK_INTERVAL:
                    if self.is_time_between(config.START_TIME, config.NO_NEW_ENTRY_TIME):
                        self.scan_market(current_time)
                    else:
                        print(f"⛔ No New Entries allowed after {config.NO_NEW_ENTRY_TIME}.")
                    scan_counter = 0  # Reset counter

                # 5. FAST SLEEP (2 seconds instead of 60)
                time.sleep(2)  # CHANGED from config.PRICE_CHECK_INTERVAL to 2

        except KeyboardInterrupt:
            self.stop()
        except Exception as e:
            self.log_message(f"❌ CRITICAL ERROR: {e}")
            self.stop()

    def stop(self):
        self.log_message(">>> Strategy Engine STOPPED.")
        self.is_running = False
        self.current_state = StrategyState.STOPPED

    def get_data_for_strike(self, chain_data, strike):
        for row in chain_data:
            if row['strike'] == strike: return row
        return None

    # === EXECUTION HANDLERS ===
    def execute_broker_entry(self, symbol, type, quantity):
        if config.PAPER_TRADING:
            return "PAPER_ORD_" + str(int(time.time()))
        
        self.log_message(f"💸 SENDING ORDER: SELL {symbol} | Qty: {quantity}")
        res = self.api.place_order(trading_symbol=symbol, transaction_type="S", quantity=quantity, product_code="NRML", order_type="MKT")
        
        if res.get("success"): return res.get("order_number")
        self.log_message(f"❌ REJECTED: {res.get('message')}")
        return None

    def execute_broker_sl(self, symbol, type, quantity, sl_price):
        if config.PAPER_TRADING:
            return "PAPER_SL_" + str(int(time.time()))
        
        trigger_val = sl_price 
        limit_val = round(sl_price + 0.5, 1)
        self.log_message(f"🛡️ PLACING SL: {symbol} | Trig: {trigger_val}")
        
        res = self.api.place_order(trading_symbol=symbol, transaction_type="B", quantity=quantity, product_code="NRML", order_type="SL", price=str(limit_val), trigger_price=str(trigger_val))
        if res.get("success"): return res.get("order_number")
        return None

    def modify_broker_sl(self, order_id, new_price, symbol):
        if config.PAPER_TRADING:
            self.log_message(f"📝 [PAPER] Modified SL {order_id} to {new_price}")
            return True
        
        self.log_message(f"🔄 MODIFYING SL #{order_id} -> {new_price}")
        res = self.api.modify_order(order_number=order_id, symbol=symbol, new_price=str(round(new_price + 0.5, 1)), new_order_type="SL", new_trigger_price=str(new_price))
        return res.get("success")

    def exit_broker_trade(self, trade):
        if not config.PAPER_TRADING and trade.sl_order_id:
            self.log_message(f"🗑️ Cancelling SL Order #{trade.sl_order_id}")
            self.api.cancel_order(trade.sl_order_id)
        pass

    def verify_order_status(self, order_id):
        try:
            order_book = self.api.get_order_book()
            if not order_book.get("success"): return "UNKNOWN"
            data = order_book.get("data", [])
            for order in data:
                if str(order.get("nOrdNo")) == str(order_id):
                    return order.get("ordSt", "UNKNOWN")
            return "NOT_FOUND"
        except: return "ERROR"

    def square_off_all(self):
        all_trades = self.active_ce_trades + self.active_pe_trades
        for trade in all_trades:
            self.log_message(f"🚨 SQUARE OFF: Exiting {trade.strike}...")
            if not config.PAPER_TRADING and trade.sl_order_id:
                self.api.cancel_order(trade.sl_order_id)
        self.reset_memory()

    # === MANAGING TRADES ===
    def manage_active_trades(self, current_time):
        # Read config fresh each time
        import strategy.strategy_config as config
        should_update_sl = (current_time - self.last_sl_update_time) >= config.SL_UPDATE_INTERVAL
        
        if should_update_sl:
            self.last_sl_update_time = current_time

        all_trades = self.active_ce_trades + self.active_pe_trades
        
        if not all_trades: 
            return

        # === DATA SOURCE (DEMO vs LIVE) ===
        if config.USE_DEMO_DATA:
            chain = demo.get_chain()
        else:
            expiries = self.api.get_expiries("NIFTY", "NFO")
            if not expiries: 
                return
            data = self.api.get_option_chain("NIFTY", expiries[config.EXPIRY_OFFSET])
            if not data or not data.get("success"): 
                return
            chain = data.get("data", [])
            if not chain:
                self.log_message("⚠️ Chain is empty, skipping updates")
                return

        # === FAST BUFFER TIMER CHECKS (every 2 seconds) ===
        if self.buffer_timers and chain:
            for timer_key in list(self.buffer_timers.keys()):
                # Parse key: "CE_26200"
                try:
                    option_type, strike_str = timer_key.split("_")
                    strike = int(strike_str)
                except:
                    continue
                
                # Find current price from chain
                row = self.get_data_for_strike(chain, strike)
                if not row:
                    continue
                
                key = "call" if option_type == "CE" else "put"
                try:
                    ltp = float(row[key].get('ltp', 0))
                    atp = float(row[key].get('atp', 0))
                except:
                    continue
                
                # Check buffer
                max_allowed = atp - (atp * config.MIN_BUFFER_PERCENTAGE)
                min_allowed = atp - (atp * config.MAX_BUFFER_PERCENTAGE)
                
                if not (min_allowed <= ltp <= max_allowed):
                    # Price left buffer - CLEAR TIMER
                    del self.buffer_timers[timer_key]
                    self.log_message(f"🔄 {timer_key} left buffer. Timer reset.")

        # === MANAGE EXISTING TRADES ===
        for trade in all_trades:
            row = self.get_data_for_strike(chain, trade.strike)
            if not row: 
                continue
            
            key = 'call' if trade.type == "CE" else 'put'
            try:
                ltp = float(row[key].get('ltp', 0))
                atp = float(row[key].get('atp', 0))
            except: 
                continue
            
            symbol = row.get("pTrdSymbol")
            trade.current_ltp = ltp
            trade.pnl = round((trade.entry_price - ltp) * trade.quantity, 2)
            
            # SL CHECK
            if ltp > trade.sl_price:
                self.log_message(f"💥 STOPLOSS HIT! {trade.type} {trade.strike} @ {ltp}")
                self.close_trade(trade, "SL HIT", current_time)
                continue 

            # BREATHING UPDATE
            if should_update_sl:
                potential_new_sl = atp + (atp * config.SL_PERCENTAGE)
                potential_new_sl = round(potential_new_sl, 2)

                if potential_new_sl < trade.sl_price:
                    self.log_message(f"📉 Tightening SL: {trade.sl_price} -> {potential_new_sl}")
                    trade.sl_price = potential_new_sl
                    if trade.sl_order_id:
                        self.modify_broker_sl(trade.sl_order_id, potential_new_sl, symbol)    

    def close_trade(self, trade, reason, current_time):
        # Save exited trade to memory
        self.exited_trades.append(trade)
        self.log_message(f"❌ CLOSING TRADE: {trade.type} {trade.strike} [{reason}]")
        self.exit_broker_trade(trade)
        if trade.type == "CE": self.active_ce_trades.remove(trade)
        else: self.active_pe_trades.remove(trade)
        
        trade_id_to_remove = f"{trade.type}_{trade.strike}_{int(trade.entry_time)}"
        self.memory.remove_trade(trade_id_to_remove)
        
        unlock_time = current_time + config.COOLDOWN_SECONDS
        self.cooldown_list[trade.strike] = unlock_time
        self.log_message(f"🧊 {trade.strike} is in Cooldown until {time.ctime(unlock_time)}")

    def scan_market(self, current_time):
        import strategy.strategy_config as config
        self.log_message(f"🔎 Scanning Market at {time.strftime('%H:%M:%S')}...")
        
        # REAL MARKET: Get data from SHARED MEMORY (not directly from API)
        try:
            # Call our new API endpoint to get shared NIFTY data
                       # Call our new API endpoint to get shared data for NIFTY
            import requests
            import strategy.strategy_config as config
            
            # Get which index bot trades (should be ["NIFTY"] for now)
            bot_indices = getattr(config, "BOT_TRADED_INDICES", ["NIFTY"])
            bot_index = bot_indices[0] if bot_indices else "NIFTY"
            
            # Get data for the index bot trades
            response = requests.get(
                f"http://localhost:8000/api/bot/market-data?index={bot_index}", 
                timeout=5
            )
            data = response.json()
            
            if not data.get("success"):
                self.log_message(f"❌ Failed to get shared {bot_index} data")
                return
            
            chain = data.get("data", [])
            if not chain:
                self.log_message("⚠️ Shared NIFTY chain is empty")
                return
            
            spot = data.get("spot", 0)
            
             # Log freshness with DETAILS
            timestamp = data.get("timestamp", 0)
            current_time_now = time.time()
            age = current_time_now - timestamp
            
            self.log_message(f"🕒 Data Age: {age:.1f} seconds (fresh if < 5)")
            if data.get("is_fresh"):
                self.log_message("✅ Using FRESH shared NIFTY data")
            else:
                self.log_message("⚠️ Using STALE shared NIFTY data")
                
            # Find highest OI strikes
            best_ce, best_pe = self.tracker.find_highest_oi(chain)
            self.log_message(f"📊 Highest OI -> CE: {best_ce} | PE: {best_pe}")
            
            # Check stability
            report = self.tracker.check_stability(best_ce, best_pe)
            
            # Check CE trades
            if len(self.active_ce_trades) < config.MAX_OPEN_POSITIONS:
                if best_ce in self.cooldown_list and current_time < self.cooldown_list[best_ce]:
                    self.log_message(f"   🧊 CE {best_ce} is in Cooldown.")
                elif report['ce_stable']: 
                    self.log_message(f"🔍 DEBUG: CE {best_ce} is STABLE, calling check_entry")
                    self.check_entry(chain, best_ce, "CE", current_time)
                else: 
                    self.log_message(f"   ⏳ CE {best_ce}: Waiting for stability.")
            else:
                self.log_message(f"🔍 DEBUG: CE MAX REACHED: {len(self.active_ce_trades)}/{config.MAX_OPEN_POSITIONS}")
            
            # Check PE trades  
            if len(self.active_pe_trades) < config.MAX_OPEN_POSITIONS:
                if best_pe in self.cooldown_list and current_time < self.cooldown_list[best_pe]:
                    self.log_message(f"   🧊 PE {best_pe} is in Cooldown.")
                elif report['pe_stable']: 
                    self.check_entry(chain, best_pe, "PE", current_time)
                else: 
                    self.log_message(f"   ⏳ PE {best_pe}: Waiting for stability.")
                    
        except Exception as e:
            self.log_message(f"❌ Error in scan_market: {e}")
            return

      
    def check_entry(self, chain, strike, type, current_time):
        active_list = self.active_ce_trades if type == "CE" else self.active_pe_trades
        for t in active_list:
            if t.strike == strike:
                return

        row = self.get_data_for_strike(chain, strike)
        if not row:
            return

        key = "call" if type == "CE" else "put"
        try:
            ltp = float(row[key].get("ltp", 0))
            atp = float(row[key].get("atp", 0))
            oi = float(row[key].get("oi", 0))
        except ValueError:
            return

        symbol = row.get("pTrdSymbol")

        # Buffer Checks
        max_allowed_price = atp - (atp * config.MIN_BUFFER_PERCENTAGE)
        min_allowed_price = atp - (atp * config.MAX_BUFFER_PERCENTAGE)

        # Log the check details
        self.log_message(
            f" ➤ {type} {strike} Check: LTP {ltp} vs Buffer {min_allowed_price:.1f}-{max_allowed_price:.1f} | ATP {atp} | OI {oi}")

        # Entry condition
        if ltp <= max_allowed_price and ltp >= min_allowed_price:
            # 60-second buffer rule
            timer_key = f"{type}_{strike}"
            
            if timer_key not in self.buffer_timers:
                # First time in buffer - start timer
                self.buffer_timers[timer_key] = current_time
                self.log_message(f"⏳ {type} {strike} entered buffer. Timer started. Need 60s.")
                return  # Wait next check
            
            # Check if 60 seconds passed
            time_in_buffer = current_time - self.buffer_timers[timer_key]
            
            if time_in_buffer < 60:
                self.log_message(f"⏳ {type} {strike} in buffer for {int(time_in_buffer)}/60s")
                return  # Not yet 60 seconds
            
            # 60 seconds completed - TAKE TRADE!
            del self.buffer_timers[timer_key]  # Clear timer
            self.log_message(f"🚀 EXECUTION SIGNAL: {type} {strike} @ {ltp} (60s in buffer ✓)")

            qty = 75
            try:
                if hasattr(self.api, "nfo_master_df") and self.api.nfo_master_df is not None:
                    df = self.api.nfo_master_df
                    found_row = df[df["pTrdSymbol"].astype(str).str.strip() == symbol]
                    if not found_row.empty:
                        raw_lot_size = int(found_row.iloc[0]["lLotSize"])
                        qty = raw_lot_size * config.LOTS_MULTIPLIER
                        self.log_message(
                            f"🧮 Quantity Calc: {raw_lot_size} (Lot) x {config.LOTS_MULTIPLIER} (Mult) = {qty}"
                        )
            except Exception as e:
                self.log_message(f"⚠️ Quantity Error: {e}. Using default 25.")

            order_id = self.execute_broker_entry(symbol, type, qty)

            if order_id:
                if not config.PAPER_TRADING:
                    self.log_message("⏳ Waiting 2s for Broker...")
                    time.sleep(2)
                    status = self.verify_order_status(order_id)
                    if "REJECTED" in status.upper():
                        self.log_message("❌ ORDER REJECTED.")
                        return

                sl_val = atp + (atp * config.SL_PERCENTAGE)
                initial_sl = round(sl_val, 2)

                time.sleep(1)
                sl_id = self.execute_broker_sl(symbol, type, qty, initial_sl)

                new_trade = Trade(strike, type, ltp, initial_sl, current_time, order_id, sl_id)
                new_trade.quantity = qty

                trade_dict = {
                    "trade_id": f"{type}_{strike}_{int(current_time)}",
                    "symbol": symbol,
                    "option_type": type,
                    "strike": strike,
                    "entry_price": ltp,
                    "entry_time": datetime.datetime.fromtimestamp(current_time).strftime(
                        "%Y-%m-%d %H:%M:%S"
                    ),
                    "quantity": qty,
                    "stoploss": initial_sl,
                    "atp_at_entry": atp,
                }
                self.memory.save_trade(trade_dict)

                if type == "CE":
                    self.active_ce_trades.append(new_trade)
                else:
                    self.active_pe_trades.append(new_trade)

                self.log_message(
                    f"✅ Trade Active: {type} {strike} | Qty: {qty} | SL: {initial_sl}"
                )
        else:
            # Price NOT in buffer - clear timer if exists
            timer_key = f"{type}_{strike}"
            if timer_key in self.buffer_timers:
                del self.buffer_timers[timer_key]
                self.log_message(f"↔️ {type} {strike} left buffer. Timer cleared.")
