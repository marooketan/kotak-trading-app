import time
import sys
import os

# 1. Help Python find the files in the current folder
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# 2. Initialize the Engine
# CHANGED: We now import from 'strategy.engine' directly
from strategy.engine import StrategyEngine

if __name__ == "__main__":
    print("🚀 Booting up the Strategy Engine...")
    
    # Create the Engine
    bot = StrategyEngine()
    
    try:
        # Start the Engine
        bot.start()
    except KeyboardInterrupt:
        # Allow you to stop it with Ctrl+C
        print("\n🛑 Force Stopping...")
        bot.stop()