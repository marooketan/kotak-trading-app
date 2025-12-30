from shoonya_adapter import ShoonyaAPI
import os

USER_ID = "FA28288"
otp = input("Enter 6-digit OTP from Shoonya app: ")

# Initialize API
api = ShoonyaAPI(config_path="C:/Users/Ketan/Desktop/config.ini")
login_result = api.login(user_id=USER_ID, otp=otp)
print("Login:", login_result)

# Check if NFO file exists
nfo_path = "C:/trading_data/masters/NFO_symbols.txt"
print("NFO file exists:", os.path.exists(nfo_path))

if login_result["success"]:
    # Load NFO master (options)
    df_nfo = api.master_loader.load_master("NFO")
    print("NFO Columns:", list(df_nfo.columns))
    print(df_nfo.head(5))

    # Load NSE master (equities)
    df_nse = api.master_loader.load_master("NSE")
    print("NSE Columns:", list(df_nse.columns))
    print(df_nse.head(3))
    # Get NIFTY option chain from NFO
    nifty_chain = api.master_loader.get_option_chain("NFO", "NIFTY")
    print("NIFTY Option Chain:")
    print(nifty_chain.head(10))

    print("\nFetching live quotes for first 5 NIFTY options:")
    for i, row in nifty_chain.head(5).iterrows():
        tsym = row["TradingSymbol"]
        token = row["Token"]
        quote = api.get_quotes(tsym, segment="NFO")
        ltp = quote["data"]["lp"] if quote["success"] else None
        print(f"{tsym} | {row['OptionType']} | Strike={row['StrikePrice']} | LTP={ltp}")
 
