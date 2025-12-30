from shoonya_adapter import ShoonyaAPI

USER_ID = "FA28288"
otp = input("Enter 6-digit OTP from Shoonya app: ")

api = ShoonyaAPI(config_path="C:/Users/Ketan/Desktop/config.ini")
login_result = api.login(user_id=USER_ID, otp=otp)
print("Login:", login_result)
import os

nfo_path = "C:/trading_data/masters/NFO_symbols.txt"
print("NFO file exists:", os.path.exists(nfo_path))


if login_result["success"]:
    # 🔎 Debug: inspect master file columns
    df_nfo = api.master_loader.load_master("NFO")
    print("Columns:", list(df_nfo.columns))
    print(df_nfo.head(5))

    print("Columns:", list(df.columns))
    print(df.head(3))

    
