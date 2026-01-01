import pandas as pd

# Load CSV
csv_path = r"C:\Users\Ketan\Desktop\kotak_master_live.csv"
df = pd.read_csv(csv_path)

# Clean column names (remove trailing spaces)
df.columns = df.columns.str.strip()

# Filter for NIFTY 26000 CE DEC
matches = df[
    (df['pExchSeg'] == 'nse_fo') &
    (df['pTrdSymbol'].str.contains('NIFTY')) &
    (df['pTrdSymbol'].str.contains('26000')) &
    (df['pTrdSymbol'].str.contains('CE')) &
    (df['pTrdSymbol'].str.contains('DEC'))
]

# Show result
if not matches.empty:
    print("✅ Match found:")
    print(matches[['pSymbol', 'pTrdSymbol', 'pExchSeg']])
else:
    print("❌ No matching option found.")
