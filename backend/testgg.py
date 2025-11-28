import os
import logging
from fastapi import FastAPI, Form, Query
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import requests
from datetime import datetime
import pandas as pd
from typing import Dict, List
import re

MASTERFILENAME = "kotak_master_live.csv"
MASTERPATH = os.path.join(os.path.expanduser("~"), "Desktop", MASTERFILENAME)

from config import KOTAK_CONFIG

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MY_MPIN = "523698"

import json
import urllib.parse
import requests
import time

###start of block2a#####
class KotakNiftyAPI:
def init(self):
self.access_token = KOTAK_CONFIG["access_token"]
self.mobile = KOTAK_CONFIG["mobile_number"]
self.client_code = KOTAK_CONFIG["client_code"]


    self.session_data = {
        "base_url": "https://mis.kotaksecurities.com",
        "token": None,
        "sid": None,
        "authenticated": False
    }

def get_headers(self):
    return {
        "Authorization": self.access_token,
        "Auth": self.session_data["token"],
        "Sid": self.session_data["sid"],
        "neo-fin-key": "neotradeapi",
        "Content-Type": "application/json"
    }
####end of the block2a#####