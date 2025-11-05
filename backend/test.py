from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles  # ADD THIS
import uvicorn
import config
from kotak_api import kotak_api
from real_kotak_api import real_kotak_api

app = FastAPI()

# ADD THIS LINE (same as main.py)
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")

@app.get("/")
async def root():
    return {"message": "TEST - With static files mount"}

@app.get("/api/test")
async def test_endpoint():
    return {"message": "TEST - API endpoint working"}

if __name__ == "__main__":
    print("🚀 TEST 4 - With static files mount")
    uvicorn.run(app, host="0.0.0.0", port=8001)