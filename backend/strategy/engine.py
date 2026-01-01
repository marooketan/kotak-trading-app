import time
import sys
import os
import datetime
import strategy.strategy_config as config
from strategy.state import StrategyState
from database.memory_helper import TradeMemory
from strategy.oi_tracker import OITracker
from watchdog.observers import Observer
from market_state import market_state
import importlib
from watchdog.events import FileSystemEventHandler
import json
import threading
from strategy.demo_data import DemoMarket
demo = DemoMarket()
from trade_history import save_trade_to_history


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
        self.entry_retries = {}   # { "CE_26200": retry_count }
        self.active_ce_trades = []
        self.active_pe_trades = []
        self.exited_trades = []  # Stores all closed trades
        self.cooldown_list = {}
        self.last_sl_update_time = time.time()
        self.memory = TradeMemory()
        self.buffer_timers = {}  # format: {"CE_26200": entry_timestamp}
        self.sl_hit_counter = {}  # Track how many times each strike hits SL

    def reload_config(self):
        """Reload config when file changes"""
        try:
            import strategy.strategy_config
            importlib.reload(strategy.strategy_config)
            print(f"🔄 RELOAD DEBUG: PAPER_TRADING = {strategy.strategy_config.PAPER_TRADING}")
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
        print("🔧 DEBUG PAPER_TRADING VALUE:", config.PAPER_TRADING)  # ADD THIS LINE
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
        limit_val = round(sl_price + config.SL_LIMIT_BUFFER, 1)

        self.log_message(f"🛡️ PLACING SL: {symbol} | Trig: {trigger_val} | Limit: {limit_val}")
        
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
    def get_position_qty(self, symbol):
        try:
            positions = self.api.get_positions()
            if not positions or not positions.get("success"):
                return 0

            for pos in positions.get("data", []):
                if pos.get("tradingSymbol") == symbol:
                    try:
                        return int(float(pos.get("netQty", 0)))
                    except:
                        return 0

            return 0
        except Exception as e:
            self.log_message(f"⚠️ Position check failed: {e}")
            return 0
    
    

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

        # === DAILY P&L KILL SWITCH CHECK ===
        total_pnl = 0.0
        for t in (self.active_ce_trades + self.active_pe_trades):
            total_pnl += t.pnl

        if total_pnl <= -config.MAX_DAILY_LOSS:
            self.log_message(f"🛑 MAX DAILY LOSS HIT: ₹{total_pnl}. STOPPING BOT.")
            self.square_off_all()
            self.stop()
            return

        if total_pnl >= config.DAILY_TARGET_PROFIT:
            self.log_message(f"🎯 DAILY TARGET ACHIEVED: ₹{total_pnl}. STOPPING BOT.")
            self.square_off_all()
            self.stop()
            return

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
        # SAFE: Get data from Memory Box instead of Kotak API
            try:
                chain_data = market_state.get_option_chain("NIFTY")
                if chain_data:
                    age = chain_data.get("age", 999)  # Get age
                    if age > 10:  # If data older than 10 seconds
                        self.log_message(f"⚠️ Stale data for active trades ({age:.1f}s)")
                        return  # Skip update
                    chain = chain_data["chain"]
                else:
                    chain = []               


            except Exception as e:
                self.log_message(f"⚠️ Memory Box error: {e}")
                return
    
            

        # === FAST BUFFER TIMER CHECKS (every 2 seconds) ===
        if self.buffer_timers and chain:
            for timer_key in list(self.buffer_timers.keys()):
                try:
                    option_type, strike_str = timer_key.split("_")
                    strike = int(strike_str)
                except:
                    continue

                row = self.get_data_for_strike(chain, strike)
                if not row:
                    continue
                print("🔍 DEBUG ROW KEYS:", row.keys())
                key = "call" if option_type == "CE" else "put"
                try:
                    ltp = float(row[key].get('ltp', 0))
                    atp = float(row[key].get('atp', 0))
                except:
                    continue
                # 🛑 ADD THIS CHECK:
                if ltp <= 0 or atp <= 0:
                    self.log_message(f"⚠️ Bad data for {trade.type} {trade.strike}, skipping update")
                    continue
                max_allowed = atp - (atp * config.MIN_BUFFER_PERCENTAGE)
                min_allowed = atp - (atp * config.MAX_BUFFER_PERCENTAGE)

                if not (min_allowed <= ltp <= max_allowed):
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
            # 🛑 ADD THIS CHECK (NEW CODE):
            if ltp <= 0 or atp <= 0:
                 self.log_message(f"⚠️ Bad data for {trade.type} {trade.strike} (LTP:{ltp}, ATP:{atp}), skipping update")  
                 continue
            # Get correct symbol for the trade type
            if trade.type == "CE":
                symbol = row.get("pTrdSymbol")  # CE symbol
            else:
                # For PE trades, try to get PE symbol
                # Check if 'put' dictionary has a symbol
                put_data = row.get("put", {})
                symbol = put_data.get("symbol") or put_data.get("tradingSymbol")
    
                # If still not found, construct PE symbol
                if not symbol:
                    # Format: NIFTY25DEC26000PE
                    symbol = f"NIFTY25DEC{trade.strike}PE"
         
        

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
        # === SAVE TRADE TO JSON HISTORY (AUTO EXIT) ===
        trade_data = {
            "trade_id": f"{trade.type}_{trade.strike}_{int(trade.entry_time)}",
            "mode": "PAPER" if config.PAPER_TRADING else "LIVE",
            "symbol": "NIFTY",
            "type": trade.type,
            "strike": trade.strike,
            "entry_price": trade.entry_price,
            "exit_price": trade.current_ltp,
            "quantity": trade.quantity,
            "pnl": trade.pnl,
            "entry_time": trade.entry_time,
            "exit_time": int(current_time),
            "date": time.strftime("%Y-%m-%d"),
            "reason": reason
        }

        save_trade_to_history(trade_data)



        self.log_message(f"❌ CLOSING TRADE: {trade.type} {trade.strike} [{reason}]")
        self.exit_broker_trade(trade)
        if trade.type == "CE": self.active_ce_trades.remove(trade)
        else: self.active_pe_trades.remove(trade)
        
        trade_id_to_remove = f"{trade.type}_{trade.strike}_{int(trade.entry_time)}"
        self.memory.remove_trade(trade_id_to_remove)
        # COUNT SL HITS (NEW CODE) - ADD HERE
        if reason == "SL HIT":
            strike = trade.strike
            if strike not in self.sl_hit_counter:
                self.sl_hit_counter[strike] = 1
            else:
                self.sl_hit_counter[strike] += 1
            
            self.log_message(f"📊 Strike {strike} SL hits: {self.sl_hit_counter[strike]}")

        
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
            
            # Use Memory Box directly (like we fixed in manage_active_trades)
            chain_data = market_state.get_option_chain(bot_index)
            if chain_data:
                chain = chain_data["chain"]
            else:
                chain = []
    
            spot_data = market_state.get_nifty_price()
            if spot_data:
                spot = spot_data["price"]
            else:
                spot = 0
    
            timestamp = time.time()  # Current time as timestamp
            

            # 🛑 ADD THIS CHECK (NEW CODE):
            # Check if chain has valid data (not all zeros)
            # Check if chain has valid data (has OI or price)
            valid_strikes = 0
            for row in chain:
                call_oi = float(row.get("call", {}).get("oi", 0))
                put_oi = float(row.get("put", {}).get("oi", 0))
                call_ltp = float(row.get("call", {}).get("ltp", 0))
                put_ltp = float(row.get("put", {}).get("ltp", 0))
    
                # Valid if: has OI OR has price
                if call_oi > 0 or put_oi > 0 or call_ltp > 0 or put_ltp > 0:
                    valid_strikes += 1

            if valid_strikes < 5:  # If less than 5 strikes have valid data
                self.log_message(f"⚠️ Chain quality poor: {valid_strikes}/{len(chain)} valid strikes. Skipping scan.")
    
                # 🔴 DEBUG: Log what's happening
                print(f"\n🔴 PROBLEM DETECTED at {time.strftime('%H:%M:%S')}")
                print(f"   Got {len(chain)} strikes from Memory Box")
                print(f"   But only {valid_strikes} passed validation")
    
                if chain and len(chain) > 0:
                    print(f"\n   Checking first 3 strikes:")
                    for i in range(min(3, len(chain))):
                        row = chain[i]
                        strike = row.get("strike", "N/A")
                        call_oi = float(row.get("call", {}).get("oi", 0))
                        put_oi = float(row.get("put", {}).get("oi", 0))
                        call_ltp = float(row.get("call", {}).get("ltp", 0))
                        put_ltp = float(row.get("put", {}).get("ltp", 0))
            
                        is_valid = call_oi > 0 or put_oi > 0 or call_ltp > 0 or put_ltp > 0
            
                        print(f"   Strike {strike}: " +
                              f"CE OI={call_oi}, PE OI={put_oi}, " +
                              f"CE LTP={call_ltp}, PE LTP={put_ltp}, " +
                              f"Valid? {is_valid}")
                print("-" * 50 + "\n")
    
                return
                
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
        # Do not take same strike again
        active_list = self.active_ce_trades if type == "CE" else self.active_pe_trades
        for t in active_list:
            if t.strike == strike:
                return
        
        # ✅ ADD MAX RETRIES CHECK HERE (NEW CODE)
        max_retries = config.MAX_RETRIES_PER_STRIKE
        if strike in self.sl_hit_counter and self.sl_hit_counter[strike] >= max_retries:
            self.log_message(f"🛑 STOP! Strike {strike} hit SL {self.sl_hit_counter[strike]} times (max:{max_retries}) - Skipping entire day")
            return  # Don't enter trade
                   
    
        row = self.get_data_for_strike(chain, strike)
        if not row:
            return

        key = "call" if type == "CE" else "put"
        try:
            ltp = float(row[key].get("ltp", 0))
            atp = float(row[key].get("atp", 0))
            oi = float(row[key].get("oi", 0))
        except:
            return
        # 🛑 ZERO-DATA SAFETY (CRITICAL)
        if ltp <= 0 or atp <= 0 or oi <= 0:
            self.log_message(f"⏸️ Skipping {type} {strike} due to invalid data (LTP:{ltp}, ATP:{atp}, OI:{oi})")
            return  

        # Resolve symbol
        if type == "CE":
            symbol = row.get("pTrdSymbol")
        else:
            put_data = row.get("put", {})
            symbol = put_data.get("pTrdSymbol")
            if not symbol:
                symbol = f"NIFTY25DEC{strike}PE"

        # Buffer calculation
        max_allowed_price = atp - (atp * config.MIN_BUFFER_PERCENTAGE)
        min_allowed_price = atp - (atp * config.MAX_BUFFER_PERCENTAGE)

        self.log_message(
            f" ➤ {type} {strike} Check: LTP {ltp} vs Buffer {min_allowed_price:.1f}-{max_allowed_price:.1f} | ATP {atp} | OI {oi}"
        )

        # Entry condition
        if not (min_allowed_price <= ltp <= max_allowed_price):
            timer_key = f"{type}_{strike}"
            if timer_key in self.buffer_timers:
                del self.buffer_timers[timer_key]
                self.log_message(f"↔️ {type} {strike} left buffer. Timer cleared.")
            return

        # 60-second buffer timer
        timer_key = f"{type}_{strike}"
        if timer_key not in self.buffer_timers:
            self.buffer_timers[timer_key] = current_time
            self.log_message(f"⏳ {type} {strike} entered buffer. Timer started. Need 60s.")
            return

        time_in_buffer = current_time - self.buffer_timers[timer_key]
        if time_in_buffer < 60:
            self.log_message(f"⏳ {type} {strike} in buffer for {int(time_in_buffer)}/60s")
            return

        # Execute trade
        del self.buffer_timers[timer_key]
        self.log_message(f"🚀 EXECUTION SIGNAL: {type} {strike} @ {ltp} (60s in buffer ✓)")

        # Quantity
        qty = 75
        try:
            if hasattr(self.api, "nfo_master_df") and self.api.nfo_master_df is not None:
                df = self.api.nfo_master_df
                found = df[df["pTrdSymbol"].astype(str).str.strip() == symbol]
                if not found.empty:
                    lot = int(found.iloc[0]["lLotSize"])
                    qty = lot * config.LOTS_MULTIPLIER
                    self.log_message(f"🧮 Quantity: {lot} x {config.LOTS_MULTIPLIER} = {qty}")
        except:
            pass

        # Place SELL order
        order_id = self.execute_broker_entry(symbol, type, qty)
        if not order_id:
            self.log_message(f"❌ Order failed for {type} {strike}")
            return

        self.log_message("✅ Trade confirmed")

        # Place SL
        sl_val = atp + (atp * config.SL_PERCENTAGE)
        initial_sl = round(round(sl_val / 0.05) * 0.05, 2)
        sl_id = self.execute_broker_sl(symbol, type, qty, initial_sl)

        # Create trade object
        new_trade = Trade(
            strike=strike,
            type=type,
            entry_price=ltp,
            sl_price=initial_sl,
            entry_time=current_time,
            order_id=order_id,
            sl_order_id=sl_id
        )
        new_trade.quantity = qty

        self.memory.save_trade({
            "trade_id": f"{type}_{strike}_{int(current_time)}",
            "symbol": symbol,
            "option_type": type,
            "strike": strike,
            "entry_price": ltp,
            "entry_time": datetime.datetime.fromtimestamp(current_time).strftime("%Y-%m-%d %H:%M:%S"),
            "quantity": qty,
            "stoploss": initial_sl,
            "atp_at_entry": atp,
        })

        if type == "CE":
            self.active_ce_trades.append(new_trade)
        else:
            self.active_pe_trades.append(new_trade)

        # Lock strike
        self.cooldown_list[strike] = current_time + config.COOLDOWN_SECONDS

        self.log_message(
            f"✅ Trade Active: {type} {strike} | Qty: {qty} | SL: {initial_sl}"
        )
    