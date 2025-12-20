import time
import sys
import os
import strategy.strategy_config as config
from strategy.state import StrategyState
from strategy.oi_tracker import OITracker

# === THE TRADE FILE FOLDER ===
class Trade:
    def __init__(self, strike, type, entry_price, sl_price, entry_time, order_id=None, sl_order_id=None):
        self.strike = strike
        self.type = type  # "CE" or "PE"
        self.entry_price = entry_price
        self.sl_price = sl_price
        self.entry_time = entry_time
        self.pnl = 0.0
        # IDS FOR REAL TRADING
        self.entry_order_id = order_id
        self.sl_order_id = sl_order_id

class StrategyEngine:
    def __init__(self, api_instance):
        print("⚙️ Initializing Portfolio Manager...")
        self.api = api_instance
        self.current_state = StrategyState.IDLE
        self.tracker = OITracker()
        self.is_running = False
        
        self.active_ce_trades = []
        self.active_pe_trades = []
        self.cooldown_list = {}
        self.last_sl_update_time = time.time()

    def start(self):
        print(">>> Strategy Engine STARTED.")
        self.is_running = True
        
        self.api.load_session_from_disk()
        if not self.api.current_user:
            print("⚠️ Engine Stopped: No User Logged In.")
            self.stop()
            return

        try:
            while self.is_running:
                current_time = time.time()
                self.manage_active_trades(current_time)
                self.scan_market(current_time)
                print(f"⏳ Waiting {config.PRICE_CHECK_INTERVAL} seconds...\n")
                time.sleep(config.PRICE_CHECK_INTERVAL)
        except KeyboardInterrupt:
            self.stop()
        except Exception as e:
            print(f"❌ CRITICAL ERROR: {e}")
            self.stop()

    def stop(self):
        print(">>> Strategy Engine STOPPED.")
        self.is_running = False
        self.current_state = StrategyState.STOPPED

    def get_data_for_strike(self, chain_data, strike):
        for row in chain_data:
            if row['strike'] == strike:
                return row
        return None

    # === REAL TRADING HELPERS ===
    def execute_broker_entry(self, symbol, type, quantity):
        """Places the Main Sell Order"""
        if config.PAPER_TRADING:
            return "PAPER_ID_" + str(int(time.time()))
            
        print(f"   💸 SENDING REAL ORDER: SELL {symbol} Qty {quantity}")
        res = self.api.place_order(
            trading_symbol=symbol,
            transaction_type="S",
            quantity=quantity,
            product_code="NRML",
            order_type="MKT"
        )
        if res.get("success"):
            return res.get("order_number")
        else:
            print(f"   ❌ ORDER FAILED: {res.get('message')}")
            return None

    def execute_broker_sl(self, symbol, type, quantity, sl_price):
        """Places the Protection Buy Order (SL-LIMIT)"""
        if config.PAPER_TRADING:
            return "PAPER_SL_ID_" + str(int(time.time()))

        trigger = round(sl_price - 0.5, 1) # Trigger slightly below Limit
        print(f"   🛡️ PLACING HARD STOPLOSS: {symbol} @ {sl_price}")
        
        res = self.api.place_order(
            trading_symbol=symbol,
            transaction_type="B", # Buy to cover
            quantity=quantity,
            product_code="NRML",
            order_type="SL",      # Stoploss Order
            price=str(sl_price),
            trigger_price=str(trigger)
        )
        if res.get("success"):
            return res.get("order_number")
        return None

    def modify_broker_sl(self, order_id, new_price, symbol):
        """Updates the Hard Stoploss Price"""
        if config.PAPER_TRADING:
            print(f"   📝 [Paper] Modifying SL to {new_price}")
            return True
            
        print(f"   🔄 MODIFYING KOTAK ORDER #{order_id} -> {new_price}")
        trigger = round(new_price - 0.5, 1)
        
        # We assume Quantity hasn't changed for now
        res = self.api.modify_order(
            order_number=order_id,
            symbol=symbol,
            new_price=str(new_price),
            new_order_type="SL"
        )
        return res.get("success")

    def exit_broker_trade(self, trade):
        """Exits the trade (Market Buy) and Cancels SL"""
        if config.PAPER_TRADING:
            return

        # 1. Cancel the Pending SL Order first
        if trade.sl_order_id:
            print(f"   🗑️ Cancelling SL Order #{trade.sl_order_id}")
            self.api.cancel_order(trade.sl_order_id)
        
        # 2. Place Market Exit Order (if not already hit by SL)
        # Note: If SL was hit at broker, we don't need this.
        # But if we exit for Target/Time, we need this.
        # For now, we assume SL HIT logic handled by broker, 
        # so this is only for manual/logic exits.
        pass 

    # === PART 1: MANAGING TRADES ===
    def manage_active_trades(self, current_time):
        should_update_sl = (current_time - self.last_sl_update_time) >= config.SL_UPDATE_INTERVAL
        
        if should_update_sl:
            print("🔄 Checking Breathing Stoploss for all trades...")
            self.last_sl_update_time = current_time

        all_trades = self.active_ce_trades + self.active_pe_trades
        if not all_trades: return

        expiries = self.api.get_expiries("NIFTY", "NFO")
        if not expiries: return
        data = self.api.get_option_chain("NIFTY", expiries[config.EXPIRY_OFFSET])
        if not data or not data.get("success"): return
        chain = data.get("data", [])

        for trade in all_trades:
            row = self.get_data_for_strike(chain, trade.strike)
            if not row: continue
            
            # Identify Data
            key = 'call' if trade.type == "CE" else 'put'
            ltp = row[key].get('ltp', 0)
            atp = row[key].get('atp', 0)
            symbol = row.get("pTrdSymbol") # We need the real symbol for orders!

            print(f"   🛡️ MANAGING {trade.type} {trade.strike} | LTP: {ltp} | SL: {trade.sl_price}")

            # 1. CHECK STOPLOSS EXIT
            if ltp > trade.sl_price:
                print(f"   💥 STOPLOSS HIT! {trade.type} {trade.strike} @ {ltp}")
                self.close_trade(trade, "SL HIT", current_time)
                continue 

            # 2. UPDATE BREATHING STOPLOSS
            if should_update_sl:
                potential_new_sl = trade.entry_price + (atp * config.SL_PERCENTAGE)
                potential_new_sl = round(potential_new_sl, 2)

                if potential_new_sl < trade.sl_price:
                    print(f"   📉 Breathing SL Triggered: Tightening from {trade.sl_price} to {potential_new_sl}")
                    
                    # A. Update Memory
                    trade.sl_price = potential_new_sl
                    
                    # B. Update Broker Order
                    if trade.sl_order_id:
                        self.modify_broker_sl(trade.sl_order_id, potential_new_sl, symbol)

    def close_trade(self, trade, reason, current_time):
        print(f"   ❌ CLOSING TRADE: {trade.type} {trade.strike} [{reason}]")
        
        # Execute Exit Logic (Cancel SL, etc.)
        self.exit_broker_trade(trade)
        
        if trade.type == "CE": self.active_ce_trades.remove(trade)
        else: self.active_pe_trades.remove(trade)
            
        unlock_time = current_time + config.COOLDOWN_SECONDS
        self.cooldown_list[trade.strike] = unlock_time
        print(f"   🧊 {trade.strike} is BANNED until {time.ctime(unlock_time)}")

    # === PART 2: FINDING NEW TRADES ===
    def scan_market(self, current_time):
        print(f"🔎 Scanning Market at {time.strftime('%H:%M:%S')}...")
        
        expiries = self.api.get_expiries("NIFTY", "NFO")
        if not expiries: return
        data = self.api.get_option_chain("NIFTY", expiries[config.EXPIRY_OFFSET])
        if not data or not data.get("success"): return
        chain = data.get("data", [])
        spot = data.get("spot", 0)
        print(f"📈 NIFTY Spot: {spot}")

        best_ce, best_pe = self.tracker.find_highest_oi(chain)
        print(f"📊 Highest OI -> CE: {best_ce} | PE: {best_pe}")
        
        report = self.tracker.check_stability(best_ce, best_pe)

        # CHECK CE
        if len(self.active_ce_trades) < config.MAX_OPEN_POSITIONS:
            if best_ce in self.cooldown_list and current_time < self.cooldown_list[best_ce]:
                 print(f"   🧊 CE {best_ce} is in Cooldown. Skipping.")
            elif report['ce_stable']:
                self.check_entry(chain, best_ce, "CE", current_time)
            else:
                print(f"   ⏳ CE {best_ce}: Waiting for stability.")

        # CHECK PE
        if len(self.active_pe_trades) < config.MAX_OPEN_POSITIONS:
            if best_pe in self.cooldown_list and current_time < self.cooldown_list[best_pe]:
                 print(f"   🧊 PE {best_pe} is in Cooldown. Skipping.")
            elif report['pe_stable']:
                self.check_entry(chain, best_pe, "PE", current_time)
            else:
                print(f"   ⏳ PE {best_pe}: Waiting for stability.")

    def check_entry(self, chain, strike, type, current_time):
        active_list = self.active_ce_trades if type == "CE" else self.active_pe_trades
        for t in active_list:
            if t.strike == strike: return

        row = self.get_data_for_strike(chain, strike)
        if not row: return
        
        key = 'call' if type == "CE" else 'put'
        ltp = row[key].get('ltp', 0)
        atp = row[key].get('atp', 0)
        symbol = row.get("pTrdSymbol") # Real Trading Symbol (e.g., NIFTY23DEC...)
        
        print(f"   ➤ {type} {strike} Check: LTP {ltp} vs ATP {atp}")
        
        if ltp < atp:
            print(f"   🚀 EXECUTION: SELLING {type} {strike} NOW!")
            
            # 1. SEND MAIN ORDER
            # We assume 1 Lot (User can add config for Qty later)
            qty = 25 # Standard Nifty Lot (Check this!)
            order_id = self.execute_broker_entry(symbol, type, qty)
            
            if order_id:
                # 2. CALCULATE & PLACE STOPLOSS
                sl_gap = ltp * config.SL_PERCENTAGE
                initial_sl = round(ltp + sl_gap, 2)
                
                # Wait 1 sec for order fill (In real life, we check status)
                time.sleep(1) 
                sl_id = self.execute_broker_sl(symbol, type, qty, initial_sl)

                # 3. RECORD TRADE
                new_trade = Trade(strike, type, ltp, initial_sl, current_time, order_id, sl_id)
                if type == "CE": self.active_ce_trades.append(new_trade)
                else: self.active_pe_trades.append(new_trade)
                
                print(f"   ✅ Trade Recorded. EntryID: {order_id} | SL: {initial_sl}")
        else:
            print(f"   ❌ NO ENTRY: Price too high.")