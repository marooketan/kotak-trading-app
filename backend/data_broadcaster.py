import json
import asyncio


class DataBroadcaster:
    """
    Central broadcaster.
    One data source → many consumers.
    """

    def __init__(self):
        self.dashboard_clients = set()
        self.engine_clients = set()

    # -----------------------------
    # CONNECTION MANAGEMENT
    # -----------------------------
    async def connect_dashboard(self, websocket):
        await websocket.accept()
        self.dashboard_clients.add(websocket)

    async def connect_engine(self, websocket):
        await websocket.accept()
        self.engine_clients.add(websocket)

    def disconnect(self, websocket):
        self.dashboard_clients.discard(websocket)
        self.engine_clients.discard(websocket)

    # -----------------------------
    # BROADCAST
    # -----------------------------
    async def broadcast(self, data: dict):
        """
        Send SAME data to dashboard & engine
        """
        message = json.dumps(data)

        await self._send(self.dashboard_clients, message)
        await self._send(self.engine_clients, message)

    async def _send(self, clients, message):
        dead = set()

        for ws in clients:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)

        for ws in dead:
            clients.discard(ws)
