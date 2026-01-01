import pandas as pd


class TokenMapper:
    def __init__(self):
        self.symbol_to_token = {}
        self.token_to_symbol = {}

    def load_csv(self, csv_path):
        df = pd.read_csv(csv_path)

        for _, row in df.iterrows():
            symbol = str(row["pTrdSymbol"]).strip()
            token = str(row["pSymbol"]).strip()
            exchange = str(row["pExchSeg"]).strip()

            if not symbol or not token or not exchange:
                continue

            self.symbol_to_token[symbol] = {
                "token": token,
                "exchange": exchange
            }

            ws_key = f"{exchange}|{token}"
            self.token_to_symbol[ws_key] = symbol

    def get_ws_symbol(self, trading_symbol):
        data = self.symbol_to_token.get(trading_symbol)
        if not data:
            return None
        return f"{data['exchange']}|{data['token']}"

    def get_trading_symbol(self, ws_symbol):
        return self.token_to_symbol.get(ws_symbol)
