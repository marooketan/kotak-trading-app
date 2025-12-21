import strategy.strategy_config as config

class OITracker:
    def __init__(self):
        # Who is the current champion strike?
        self.top_ce_strike = None
        self.top_pe_strike = None

        # How many times have they been the champion in a row?
        self.ce_stability_count = 0
        self.pe_stability_count = 0

    def find_highest_oi(self, chain_data):
        """
        Loops through the Option Chain and finds the strike with max OI.
        Returns: (best_ce_strike, best_pe_strike)
        """
        max_ce_oi = -1
        max_pe_oi = -1
        best_ce_strike = None
        best_pe_strike = None

        # Helper to force data into a Number
        def safe_int(val):
            try:
                # Convert "100" -> 100 or "1,000" -> 1000
                return int(float(str(val).replace(",", "")))
            except:
                return 0

        for row in chain_data:
            strike = row['strike']
            
            # 1. Check Call (CE) OI
            # We use safe_int() to fix the "Text vs Number" error
            ce_oi = safe_int(row['call'].get('oi', 0))
            
            if ce_oi > max_ce_oi:
                max_ce_oi = ce_oi
                best_ce_strike = strike
            
            # 2. Check Put (PE) OI
            pe_oi = safe_int(row['put'].get('oi', 0))
            
            if pe_oi > max_pe_oi:
                max_pe_oi = pe_oi
                best_pe_strike = strike
        
        return best_ce_strike, best_pe_strike

    def check_stability(self, new_top_ce, new_top_pe):
        """
        Checks if the highest OI strike is stable (unchanged).
        """
        # --- CHECK CALL (CE) ---
        if new_top_ce == self.top_ce_strike:
            self.ce_stability_count += 1
        else:
            self.top_ce_strike = new_top_ce
            self.ce_stability_count = 1

        # --- CHECK PUT (PE) ---
        if new_top_pe == self.top_pe_strike:
            self.pe_stability_count += 1
        else:
            self.top_pe_strike = new_top_pe
            self.pe_stability_count = 1

        is_ce_ready = self.ce_stability_count >= config.OI_STABILITY_REQUIRED
        is_pe_ready = self.pe_stability_count >= config.OI_STABILITY_REQUIRED

        return {
            "ce_strike": self.top_ce_strike,
            "pe_strike": self.top_pe_strike,
            "ce_stable": is_ce_ready,
            "pe_stable": is_pe_ready,
            "ce_count": self.ce_stability_count,
            "pe_count": self.pe_stability_count
        }