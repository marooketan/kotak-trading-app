import asyncio
import websockets
import json
import time

async def handler(websocket):
    print("✅ Client connected")

    try:
        while True:
            data = {
                "type": "test_tick",
                "symbol": "NIFTY",
                "ltp": 22500 + int(time.time()) % 10,
                "timestamp": time.time()
            }
            await websocket.send(json.dumps(data))
            await asyncio.sleep(1)
    except websockets.exceptions.ConnectionClosed:
        print("❌ Client disconnected")

async def main():
    print("🚀 Local WebSocket Server started at ws://localhost:8765")
    async with websockets.serve(handler, "localhost", 8765):
        await asyncio.Future()  # run forever

asyncio.run(main())
