# shared_market.py - TOP OF FILE
import threading
import time
import copy
import strategy.strategy_config as config


class SharedMarketData:
    """Shared storage for ANY index bot trades"""
    def __init__(self):
        self.data = {}
        self.lock = threading.Lock()
    
    def update_index_data(self, index_name, chain, spot): 
        """
        Save data for any index (NIFTY, SENSEX, etc.)
        OPTIMIZED: Only stores ATM +/- 20 strikes to save memory/processing.
        """
        with self.lock:
            # Initialize if not exists
            if index_name not in self.data:
                self.data[index_name] = {}
            
            # === OPTIMIZATION: Filter Chain to +/- 20 strikes from ATM ===
            optimized_chain = []
            
            if chain and spot > 0:
                try:
                    # 1. Ensure chain is sorted by strike (usually is, but safety first)
                    # We assume 'chain' is a list of dicts with a "strike" key
                    sorted_chain = sorted(chain, key=lambda x: x["strike"])
                    
                    # 2. Find ATM Index (Strike closest to Spot)
                    closest_item = min(sorted_chain, key=lambda x: abs(x["strike"] - spot))
                    atm_index = sorted_chain.index(closest_item)
                    
                    # 3. Define Range (e.g., +/- 12 strikes)
                    # This gives us a window of ~25 strikes total (plenty for the bot)
                    RANGE = 12
                    start_idx = max(0, atm_index - RANGE)
                    end_idx = min(len(sorted_chain), atm_index + RANGE + 1)
                    
                    # 4. Slice the chain
                    optimized_chain = sorted_chain[start_idx:end_idx]
                   
                except Exception as e:
                    # If any sorting/slicing fails, fallback to full chain
                    print(f"⚠️ Optimization warning for {index_name}: {e}")
                    optimized_chain = chain
            else:
                optimized_chain = chain
            # =============================================================

            # Save the OPTIMIZED data
            self.data[index_name]["chain"] = optimized_chain
            self.data[index_name]["spot"] = spot
            self.data[index_name]["timestamp"] = time.time()
            import strategy.strategy_config as config

            if getattr(config, "MARKET_DEBUG", False):
                print(
                    f"📥 SAVED {index_name} | "
                    f"spot={spot} | "
                    f"chain_len={len(optimized_chain) if optimized_chain else 0} | "
                    f"ts={self.data[index_name]['timestamp']}"
                )


            
            # Find highest OI strikes (Using the optimized chain is usually sufficient)
            if optimized_chain:
                def get_oi_int(x, side):
                    oi_str = x.get(side, {}).get("oi", "0")
                    try:
                        return float(oi_str)
                    except:
                        return 0
                
                try:
                    highest_ce = max(optimized_chain, key=lambda x: get_oi_int(x, "call"))
                    highest_pe = max(optimized_chain, key=lambda x: get_oi_int(x, "put"))
                    self.data[index_name]["highest_ce"] = highest_ce.get("strike", 0)
                    self.data[index_name]["highest_pe"] = highest_pe.get("strike", 0)
                except:
                    self.data[index_name]["highest_ce"] = 0
                    self.data[index_name]["highest_pe"] = 0

                    self.data[index_name]["timestamp"] = time.time()

                    print(
                        f"📥 SAVED {index_name} | "
                        f"spot={spot} | "
                        f"chain_len={len(optimized_chain) if optimized_chain else 0} | "
                        f"ts={self.data[index_name]['timestamp']}"
                    )


    
    def get_index_data(self, index_name): 
        """Get data for specific index"""
        with self.lock:
            if index_name in self.data:
                return copy.deepcopy(self.data[index_name])
            return None
    
    def get_all_bot_indices_data(self):
        """Get ALL indices that bot trades"""
        import strategy.strategy_config as config
        bot_indices = getattr(config, "BOT_TRADED_INDICES", ["NIFTY"])
        
        result = {}
        for idx in bot_indices:
            if idx in self.data:
                result[idx] = self.data[idx].copy()
        
        return result
# Create ONE shared storage for everyone
shared_market = SharedMarketData()