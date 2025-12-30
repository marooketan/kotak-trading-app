import os
import logging
import configparser
import requests
import pandas as pd
from datetime import datetime, date
from NorenRestApiPy.NorenApi import NorenApi


# =========================
# LOGGING SETUP
# =========================
LOG_DIR = "C:/trading_data/logs"
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    filename=f"{LOG_DIR}/shoonya.log",
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)

console = logging.StreamHandler()
console.setLevel(logging.INFO)
logging.getLogger("").addHandler(console)


# =========================
# SHOONYA ADAPTER
# =========================
class ShoonyaAPI:

    MASTER_DIR = "C:/trading_data/masters"
    MASTER_BASE_URL = "https://shoonya.finvasia.com"


    def __init__(self, config_path):
        self.config = configparser.ConfigParser()
        self.config.read(config_path)

        self.api_host = self.config.get("LOGIN", "API_HOST")
        websocket = self.config.get("LOGIN", "WS_HOST")

        self.api = NorenApi(host=self.api_host, websocket=websocket)


        self.session = None
        self.current_user = None

        # Cache masters in memory
        self.master_data = {}

        os.makedirs(self.MASTER_DIR, exist_ok=True)

        logging.info("Shoonya adapter initialized")

    # =========================
    # LOGIN
    # =========================
    def login(self, user_id, otp):
        logging.info("Attempting Shoonya login")

        password = self.config.get("LOGIN", "PASSWORD")
        api_secret = self.config.get("LOGIN", "API_SECRET")
        vendor_code = self.config.get("LOGIN", "VENDOR_CODE")
        imei = self.config.get("LOGIN", "DUMMY_IMEI")

        ret = self.api.login(
            userid=user_id,
            password=password,
            twoFA=otp,
            vendor_code=vendor_code,
            api_secret=api_secret,
            imei=imei,
        )

        if ret and ret.get("stat") == "Ok":
            self.session = ret
            self.current_user = user_id
            logging.info("Shoonya login successful")
            return {"success": True, "message": "Shoonya login successful"}

        logging.error(f"Shoonya login failed: {ret}")
        return {"success": False, "message": ret.get("emsg", "Login failed")}

    # =========================
    # MASTER FILE HANDLING
    # =========================
    def _master_path(self, segment):
        return f"{self.MASTER_DIR}/{segment}.csv"

    def _master_needs_download(self, path):
        if not os.path.exists(path):
            return True

        file_date = date.fromtimestamp(os.path.getmtime(path))
        return file_date != date.today()

    def download_master(self, segment):
        url = f"{self.MASTER_BASE_URL}/{segment}_symbols.txt"


        path = self._master_path(segment)

        logging.info(f"Downloading {segment} master from Shoonya")

        response = requests.get(url, timeout=30)
        response.raise_for_status()

        with open(path, "wb") as f:
            f.write(response.content)

        logging.info(f"{segment} master downloaded and saved to {path}")
        return path

    def load_master(self, segment):
        if segment in self.master_data:
            return self.master_data[segment]

        logging.info(f"Fetching {segment} master via Shoonya API")

        data = self.api.get_scrip_master(exchange=segment)

        if not data:
            raise RuntimeError(f"Failed to fetch {segment} master from Shoonya")

        df = pd.DataFrame(data)

        self.master_data[segment] = df

        logging.info(
            f"{segment} master loaded via API | rows={len(df)} | columns={list(df.columns)}"
        )

        return df

    def get_quotes(self, symbol, segment="NSE"):
        df = self.load_master(segment)

        # Shoonya NSE master uses TradingSymbol + Token
        row = df[df["TradingSymbol"] == symbol]

        if row.empty:
            logging.error(f"Symbol not found in {segment} master: {symbol}")
            return {"success": False, "message": f"Symbol {symbol} not found"}

        token = str(int(row.iloc[0]["Token"]))

        logging.info(f"Fetching quote | {segment} | {symbol} | token={token}")

        data = self.api.get_quotes(exchange=segment, token=token)

        if data and data.get("stat") == "Ok":
            logging.info(f"Quote received | {symbol} | LTP={data.get('lp')}")
            return {"success": True, "data": data}

        logging.error(f"Quote failed | {symbol} | response={data}")
        return {"success": False, "message": data.get("emsg", "Quote fetch failed")}
