import time

class MarketState:
    def __init__(self):
        self.index_data = {}
        self.option_chain_data = {}
        
    # 1. Update index price
    def update_index(self, symbol: str, value: float):
        # Never write 0.00
        if value <= 0:
            return
            
        self.index_data[symbol] = {
            "value": value,
            "timestamp": time.time()
        }
        # Keep only critical log (optional, can remove)
        # print(f"📦 MarketState: {symbol} updated to {value}")
    
    # 2. Update option chain
    def update_option_chain(self, index: str, atm_strike: int, chain_data: list):
        """
        chain_data format:
        [
            {
                "strike": 22500,
                "call": {"ltp": 150.0, "atp": 152.0, "oi": 5000},
                "put": {"ltp": 120.0, "atp": 122.0, "oi": 6000}
            },
            ... for ±12 strikes
        ]
        """
        # Validate data before storing
        valid_chain = []
        for strike_data in chain_data:
            call = strike_data.get("call", {})
            put = strike_data.get("put", {})

            call_oi = float(call.get("oi", 0))
            put_oi = float(put.get("oi", 0))
            call_ltp = float(call.get("ltp", 0))
            call_atp = float(call.get("atp", 0))
            put_ltp = float(put.get("ltp", 0))
            put_atp = float(put.get("atp", 0))

            # Skip ONLY if EVERYTHING is zero (including OI)
            if (call_ltp == 0 and call_atp == 0 and call_oi == 0 and
                put_ltp == 0 and put_atp == 0 and put_oi == 0):
                continue
                
            valid_chain.append(strike_data)
        
        # Only update if we have valid data AND chain is not empty
        if valid_chain:
            self.option_chain_data[index] = {
                "atm": atm_strike,
                "chain": valid_chain,
                "timestamp": time.time()
            }
            # Optional: print(f"📦 Memory Box: Updated {index} chain with {len(valid_chain)} strikes")
    
    # 3. Get NIFTY price
    def get_nifty_price(self):
        nifty_data = self.index_data.get("NIFTY")
        if nifty_data:
            return {
                "price": nifty_data["value"],
                "age": time.time() - nifty_data["timestamp"]
            }
        return None
    
    # 4. Get option chain
    def get_option_chain(self, index: str = "NIFTY"):
        chain_data = self.option_chain_data.get(index)
        if chain_data:
            return {
                "atm_strike": chain_data["atm"],
                "chain": chain_data["chain"],
                "age": time.time() - chain_data["timestamp"]
            }
        return None
    
    # 5. Get ALL data for bot
    def get_all_bot_data(self, index: str = "NIFTY"):
        nifty_info = self.get_nifty_price()
        chain_info = self.get_option_chain(index)
        
        return {
            "index": nifty_info,
            "options": chain_info,
            "is_fresh": (
                nifty_info and nifty_info["age"] < 5 and
                chain_info and chain_info["age"] < 5
            )
        }

# SINGLE shared instance
market_state = MarketState()