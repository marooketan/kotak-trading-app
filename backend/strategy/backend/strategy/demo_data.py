import random
from datetime import datetime

class DemoMarket:
    def __init__(self):
        self.spot = 22000
        self.prices = {}
        self.entry_count = 0 
        
    def get_chain(self):
        """Generate fake option chain with REALISTIC DYNAMIC ATP"""
        chain = []
        strikes = [21800, 21900, 22000, 22100, 22200]
        
        for strike in strikes:
            if strike not in self.prices:
                self.prices[strike] = {"CE": 150, "PE": 150}
            
            # Logic to move prices randomly
            if self.entry_count < 2:
                # Force entry buffer zone (80-95)
                self.prices[strike]["CE"] = random.uniform(80, 95)
                self.prices[strike]["PE"] = random.uniform(80, 95)
            else:
                self.prices[strike]["CE"] += random.uniform(-5, 5)
                self.prices[strike]["PE"] += random.uniform(-5, 5)
            
            # Ensure positive prices
            ce_price = max(20, self.prices[strike]["CE"])
            pe_price = max(20, self.prices[strike]["PE"])
            self.prices[strike]["CE"] = ce_price
            self.prices[strike]["PE"] = pe_price
            
            chain.append({
                "strike": strike,
                "call": {
                    "ltp": round(ce_price, 2),
                    # DYNAMIC ATP: LTP +/- 2 rupees (Realistic)
                    "atp": round(ce_price + random.uniform(-2, 2), 2),
                    "oi": random.randint(1000, 5000)
                },
                "put": {
                    "ltp": round(pe_price, 2),
                    # DYNAMIC ATP: LTP +/- 2 rupees
                    "atp": round(pe_price + random.uniform(-2, 2), 2),
                    "oi": random.randint(1000, 5000)
                }
            })
        
        return chain
    
    def increment_entry(self):
        self.entry_count += 1

demo = DemoMarket()