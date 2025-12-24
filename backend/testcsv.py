import pandas as pd

path = "C:/Users/Ketan/Desktop/NSE_symbols.txt"

# Try opening the file directly
with open(path, "r", encoding="utf-8", errors="ignore") as f:
    for i in range(5):
        print(f.readline())

# Try loading with pandas
df = pd.read_csv(path)
print(df.head())
