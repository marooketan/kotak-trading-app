from shoonya_adapter import ShoonyaAPI

USER_ID = "FA28288"
otp = input("Enter 6-digit OTP from Shoonya app: ")

api = ShoonyaAPI(config_path="C:/Users/Ketan/Desktop/config.ini")
login_result = api.login(otp=otp, user_id=USER_ID)
print("Login:", login_result)

if login_result["success"]:
    print("Available API methods:")
    print([m for m in dir(api.api) if "scrip" in m.lower() or "master" in m.lower()])

    symbol = "RELIANCE-EQ"
    segment = "NSE"
    master_path =master_path = "C:/trading_data/NSE_symbols_copy.txt"

    result = api.get_quotes(symbol, segment)

    print(result)
