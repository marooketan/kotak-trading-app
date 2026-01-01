import asyncio
import json
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from data_broadcaster import DataBroadcaster
import uvicorn

app = FastAPI()
broadcaster = DataBroadcaster()

# --------------------------------
# DUMMY DATA PRODUCER
# --------------------------------
async def dummy_market_feed():
    ltp = 22500
    while True:
        ltp += 1
        data = {
            "type": "market_tick",
            "symbol": "NIFTY",
            "ltp": ltp,
            "timestamp": time.time(),
            "source": "dummy"
        }
        await broadcaster.broadcast(data)
        await asyncio.sleep(1)

@app.on_event("startup")
async def startup():
    asyncio.create_task(dummy_market_feed())

# --------------------------------
# WEBSOCKET ENDPOINTS
# --------------------------------
@app.websocket("/ws/dashboard")
async def dashboard_ws(websocket: WebSocket):
    await broadcaster.connect_dashboard(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        broadcaster.disconnect(websocket)

@app.websocket("/ws/engine")
async def engine_ws(websocket: WebSocket):
    await broadcaster.connect_engine(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        broadcaster.disconnect(websocket)

# --------------------------------
# RUN SERVER
# --------------------------------
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
