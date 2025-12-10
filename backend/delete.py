import pandas as pd

bfo_path = r"C:\Users\Ketan\Desktop\kotak_bfo_live.csv"
df = pd.read_csv(bfo_path)

# Get SENSEX rows
sensex = df[df['pSymbolName'] == 'SENSEX']

print(f"Total SENSEX rows: {len(sensex)}")
print("\nChecking first 5 SENSEX symbols with tokens:")
for i in range(min(5, len(sensex))):
    row = sensex.iloc[i]
    print(f"  Symbol: {row['pTrdSymbol']}")
    print(f"  Token: {row['pSymbol']}")
    print(f"  Type: {row['pOptionType']}")
    print(f"  Strike: {row['dStrikePrice;'] if 'dStrikePrice;' in row else 'N/A'}")
    print()