import pandas as pd

CSV_PATH = r"C:\Users\Ketan\Desktop\kotak_master_live.csv"
df = pd.read_csv(CSV_PATH)

filtered = df[
    (df["pExchSeg"] == "nse_fo") &
    (df["pInstType"] == "OPTIDX") &
    (df["pSymbolName"] == "NIFTY") &
    (df["pOptionType"] == "PE") &
    (df["dStrikePrice;"] == 2600000.0)
]

print("Total matches:", len(filtered))

if not filtered.empty:
    print(filtered[["pTrdSymbol", "dStrikePrice;", "pExpiryDate", "pScripRefKey"]])
