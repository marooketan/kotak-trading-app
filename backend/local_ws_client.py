import asyncio
import websockets
import json

async def main():
    uri = "ws://localhost:8001/ws/engine"
    print("🔌 Connecting to", uri)

    async with websockets.connect(uri) as websocket:
        while True:
            msg = await websocket.recv()
            data = json.loads(msg)
            print("📩 Received:", data)

asyncio.run(main())
