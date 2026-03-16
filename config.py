import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Project Paths
BASE_DIR = Path(__file__).resolve().parent

# Cloudflare R2 Configuration
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "cubemap-assets")
R2_PUBLIC_URL = os.getenv("R2_PUBLIC_URL")  # e.g., https://pub-xxxx.r2.dev

# Google Sheets Configuration
_svc_acc = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
if _svc_acc and _svc_acc.strip().startswith("{"):
    # It's a raw JSON string (common for Vercel environment variables)
    GOOGLE_SERVICE_ACCOUNT_JSON = _svc_acc
else:
    # It's a path to a file
    GOOGLE_SERVICE_ACCOUNT_JSON = str(BASE_DIR / _svc_acc) if _svc_acc else None
GOOGLE_SHEET_ID = os.getenv("GOOGLE_SHEET_ID")

# Processing Configuration
FACE_NAMES = ["front", "back", "left", "right", "top", "bottom"]
DEFAULT_FACE_SIZE = 1520  # Fallback if source width is unknown, but usually source_width / 4
ALLOWED_ASPECT_RATIO_ERROR = 0.05
