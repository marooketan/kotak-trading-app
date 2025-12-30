import os
import logging
import configparser
import requests
import pandas as pd
import zipfile
from datetime import date
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
# MASTER LOADER
# =========================
class ShoonyaMasterLoader:
    BASE_URL = "https://api.shoonya.com"
    MASTER_DIR = "C:/trading_data/masters"

    def __init__(self):
        os.makedirs(self.MASTER_DIR, exist_ok=True)
        self.cache = {}

    def _master_path(self, segment):
        return os.path.join(self.MASTER_DIR, f"{segment}_symbols.txt")

    def _needs_refresh(self, path):
        if not os.path.exists(path):
            return True
        file_date = date.fromtimestamp(os.path.getmtime(path))
        return file_date != date.today()

    def download_master(self, segment):
        zip_file = f"{segment}_symbols.txt.zip"
        url = f"{self.BASE_URL}/{zip_file}"
        logging.info(f"Downloading {segment} master from {url}")

        r = requests.get(url, timeout=30)
        r.raise_for_status()

        zip_path = os.path.join(self.MASTER_DIR, zip_file)
        with open(zip_path, "wb") as f:
            f.write(r.content)

        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(self.MASTER_DIR)
            logging.info(f"Extracted {zip_file}")

        os.remove(zip_path)

    def load_master(self, segment):
        if segment in self.cache:
            return self.cache[segment]

        path = self._master_path(segment)
        if self._needs_refresh(path):
            self.download_master(segment)

        # Try both delimiters: Shoonya masters are usually comma-delimited
        try:
            df = pd.read_csv(path, sep=",")
        except Exception:
            df = pd.read_csv(path, sep="|")

        # Strip whitespace from column names
        df.columns = df.columns.str.strip()

        self.cache[segment] = df
        logging.info(f"{segment} master loaded | rows={len(df)} | columns={list(df.columns)}")
        return df


    def get_token(self, segment, symbol):
        df = self.load_master(segment)

        # Normalize column names
        cols = [c.lower() for c in df.columns]

        if "tradingsymbol" in cols:
            col_name = "TradingSymbol"
        elif "symbol" in cols:
            col_name = "Symbol"
        else:
            raise RuntimeError(f"No symbol column found in {segment} master: {df.columns}")

        row = df[df[col_name] == symbol]
        if row.empty:
            logging.error(f"Symbol {symbol} not found in {segment} master")
            return None

        return str(int(row.iloc[0]["Token"]))
    def get_option_chain(self, segment, underlying, expiry=None):
        """
        Return all option contracts for a given underlying symbol.
        Optionally filter by expiry date.
        """
        df = self.load_master(segment)

        # Filter by underlying symbol
        chain = df[df["Symbol"].str.upper() == underlying.upper()]

        # If expiry is provided, filter further
        if expiry:
            chain = chain[chain["Expiry"] == expiry]

        # Keep only useful columns
        cols = ["TradingSymbol", "Token", "Instrument", "StrikePrice", "OptionType", "Expiry"]
        available_cols = [c for c in cols if c in chain.columns]
        return chain[available_cols]     



# =========================
# SHOONYA ADAPTER
# =========================
class ShoonyaAPI:
    def __init__(self, config_path):
        self.config = configparser.ConfigParser()
        self.config.read(config_path)

        self.api_host = self.config.get("LOGIN", "API_HOST")
        websocket = self.config.get("LOGIN", "WS_HOST")

        self.api = NorenApi(host=self.api_host, websocket=websocket)
        self.session = None
        self.current_user = None

        # Use master loader
        self.master_loader = ShoonyaMasterLoader()

        logging.info("Shoonya adapter initialized")

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

            # 🔎 Auto-check masters (NSE/NFO)
            for seg in ["NSE", "NFO"]:
                try:
                    df = self.master_loader.load_master(seg)
                    print(f"{seg} master ready | rows={len(df)}")
                except Exception as e:
                    print(f"⚠️ Error loading {seg} master: {e}")

            return {"success": True, "message": "Shoonya login successful"}

        logging.error(f"Shoonya login failed: {ret}")
        return {"success": False, "message": ret.get("emsg", "Login failed")}


    
 

    def get_quotes(self, symbol, segment="NSE"):
        token = self.master_loader.get_token(segment, symbol)
        if not token:
            return {"success": False, "message": f"Symbol {symbol} not found"}

        logging.info(f"Fetching quote | {segment} | {symbol} | token={token}")
        data = self.api.get_quotes(exchange=segment, token=token)

        if data and data.get("stat") == "Ok":
            logging.info(f"Quote received | {symbol} | LTP={data.get('lp')}")
            return {"success": True, "data": data}

        logging.error(f"Quote failed | {symbol} | response={data}")
        return {"success": False, "message": data.get("emsg", "Quote fetch failed")}
   

