# config.py
import os

# === CONFIGURATION ===
MASTERFILENAME = "kotak_master_live.csv"
MASTERPATH = os.path.join(os.path.expanduser("~"), "Desktop", MASTERFILENAME)
BFO_MASTERFILENAME = "kotak_bfo_live.csv"
BFO_MASTERPATH = os.path.join(os.path.expanduser("~"), "Desktop", BFO_MASTERFILENAME)

# === FIX: USE ABSOLUTE PATHS SO SUB-FOLDERS CAN FIND THEM ===
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
USERS_FILE = os.path.join(BASE_DIR, "users.json")
SESSION_FILE = os.path.join(BASE_DIR, "session_cache.json")

MY_MPIN = "523698"