import json
import os
import asyncio
import websockets
import time


class KotakWebSocketClient:
    """
    Single Kotak WebSocket connection.
    - Reuses existing REST login (session_cache.json)
    - Connects once
    - Subscribes to symbols
    - Yields incoming market data
    """

    def __init__(self, session_file: str):
        self.session_file = session_file
        self.auth_token = None
        self.user_id = None

        self.ws_url = "wss://mis.kotaksecurities.com/websocket"
        self.connection = None
        self.connected = False
        self.reconnect_attempts = 0

    # -------------------------------------------------
    # SESSION
    # -------------------------------------------------
    def load_session(self):
        if not os.path.exists(self.session_file):
            raise FileNotFoundError("session_cache.json not found")

        with open(self.session_file, "r") as f:
            data = json.load(f)

        self.user_id = data.get("current_user")
        sessions = data.get("sessions", {})

        if not self.user_id or self.user_id not in sessions:
            raise ValueError("Invalid session_cache.json: user not found")

        user_session = sessions[self.user_id]

        self.auth_token = user_session.get("token")

        if not self.auth_token:
            raise ValueError("Invalid session_cache.json: token missing")

        return True

    # -------------------------------------------------
    # CONNECT
    # -------------------------------------------------
    async def connect(self):
        if not self.auth_token:
            self.load_session()

        headers = {
            "Authorization": self.auth_token,
            "User-Agent": f"TradingBot/{self.user_id}",
        }

        self.connection = await websockets.connect(
            self.ws_url,
            extra_headers=headers,
            ping_interval=20,
            ping_timeout=10,
        )

        # Authenticate message (Kotak style – minimal safe form)
        auth_msg = {
            "type": "authenticate",
            "userId": self.user_id,
            "token": self.auth_token,
            "timestamp": int(time.time()),
        }

        await self.connection.send(json.dumps(auth_msg))

        # Wait for response
        response = await self.connection.recv()
        data = json.loads(response)

        if data.get("status") != "success":
            raise RuntimeError("WebSocket authentication failed")

        self.connected = True
        self.reconnect_attempts = 0
        return True

    # -------------------------------------------------
    # SUBSCRIBE
    # -------------------------------------------------
    async def subscribe(self, ws_symbols: list):
        """
        ws_symbols example:
        ["nse_fo|65623", "nse_fo|65624"]
        """
        if not self.connected:
            await self.connect()

        sub_msg = {
            "type": "subscribe",
            "symbols": ws_symbols,
            "mode": "full",      # LTP, OI, volume
            "frequency": "realtime",
        }

        await self.connection.send(json.dumps(sub_msg))

    # -------------------------------------------------
    # RECEIVE LOOP
    # -------------------------------------------------
    async def receive(self):
        """
        Async generator:
        for msg in ws.receive():
            ...
        """
        while self.connected:
            try:
                message = await self.connection.recv()
                yield json.loads(message)

            except websockets.exceptions.ConnectionClosed:
                await self._reconnect()

    # -------------------------------------------------
    # RECONNECT
    # -------------------------------------------------
    async def _reconnect(self):
        self.connected = False
        self.reconnect_attempts += 1

        delay = min(5 * self.reconnect_attempts, 60)
        await asyncio.sleep(delay)

        await self.connect()

    # -------------------------------------------------
    # CLOSE
    # -------------------------------------------------
    async def close(self):
        self.connected = False
        if self.connection:
            await self.connection.close()


# -----------------------------------------------------
# SIMPLE SELF-TEST (OPTIONAL)
# -----------------------------------------------------
if __name__ == "__main__":
    async def test():
        ws = KotakWebSocketClient(
            r"C:\Users\Ketan\Desktop\websocketversion\backend\session_cache.json"
        )
        await ws.connect()
        print("✅ WebSocket connected")

        # Do NOT subscribe yet in real trading
        # This is just a connection test
        await ws.close()
        print("✅ WebSocket closed")

    asyncio.run(test())
