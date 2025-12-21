import json
from datetime import datetime
import os

class TradeMemory:
    def __init__(self):
        self.file_path = os.path.join(os.path.dirname(__file__), "trades_memory.json")
        
        # Create file if doesn't exist
        if not os.path.exists(self.file_path):
            self._create_empty_file()
    
    def _create_empty_file(self):
        """Create empty JSON file"""
        empty_data = {
            "active_trades": [],
            "trade_history": [],
            "strategy_settings": {},
            "last_saved": ""
        }
        with open(self.file_path, 'w') as f:
            json.dump(empty_data, f, indent=2)
    
    def save_trade(self, trade_data):
        """Save one trade to memory"""
        # Read current memory
        with open(self.file_path, 'r') as f:
            memory = json.load(f)
        
        # Add new trade to active trades
        memory['active_trades'].append(trade_data)
        memory['last_saved'] = str(datetime.now())
        
        # Save back
        with open(self.file_path, 'w') as f:
            json.dump(memory, f, indent=2)
    
    def get_all_active_trades(self):
        """Get all active trades from memory"""
        with open(self.file_path, 'r') as f:
            memory = json.load(f)
        return memory['active_trades']
    
    def remove_trade(self, trade_id):
        """Remove a trade from active trades"""
        with open(self.file_path, 'r') as f:
            memory = json.load(f)
        
        # Find and remove the trade
        new_active_trades = []
        for trade in memory['active_trades']:
            if trade.get('trade_id') != trade_id:
                new_active_trades.append(trade)
        
        memory['active_trades'] = new_active_trades
        memory['last_saved'] = str(datetime.now())
        
        with open(self.file_path, 'w') as f:
            json.dump(memory, f, indent=2)