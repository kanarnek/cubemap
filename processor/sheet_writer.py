import gspread
from google.oauth2.service_account import Credentials
from typing import List, Optional, Dict
from config import GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SHEET_ID
from models import CubemapResult
import json

class SheetWriter:
    """Handles reading and writing metadata to Google Sheets."""

    def __init__(self):
        self.scope = [
            "https://spreadsheets.google.com/feeds",
            "https://www.googleapis.com/auth/drive"
        ]
        
        # Extremely robust check for GOOGLE_SERVICE_ACCOUNT_JSON
        creds_content = (GOOGLE_SERVICE_ACCOUNT_JSON or "").strip()
        
        # Check if it's a JSON string (could be wrapped in quotes by Vercel)
        is_json = creds_content.startswith("{") or (creds_content.startswith('"') and creds_content.endswith('"') and "{" in creds_content)
        
        if is_json:
            if creds_content.startswith('"'):
                creds_content = creds_content[1:-1].replace('\\"', '"')
            info = json.loads(creds_content)
            self.credentials = Credentials.from_service_account_info(info, scopes=self.scope)
        elif creds_content and os.path.exists(creds_content):
            self.credentials = Credentials.from_service_account_file(
                creds_content, scopes=self.scope
            )
        else:
            raise ValueError(
                f"Missing or invalid Google Credentials. Value found: '{creds_content[:20]}...'. "
                "Ensure GOOGLE_SERVICE_ACCOUNT_JSON is set to the ACTUAL JSON CONTENT from your .json file "
                "in the Vercel Environment Variables dashboard."
            )
        self.client = gspread.authorize(self.credentials)
        self.sheet = self.client.open_by_key(GOOGLE_SHEET_ID).worksheet("cubemap_records")

    def check_idempotency(self, project_id: str, plan_id: str, pin_id: str, timeline: str) -> Optional[Dict[str, str]]:
        """
        Checks if a record already exists and is 'done'.
        If found, returns the mapping of face URLs.
        """
        records = self.sheet.get_all_records()
        for row in records:
            if (str(row.get("project_id")) == project_id and
                str(row.get("plan_id")) == plan_id and
                str(row.get("pin_id")) == pin_id and
                str(row.get("timeline")) == timeline and
                str(row.get("status")) == "done"):
                
                return {
                    "front": row.get("front_url"),
                    "back": row.get("back_url"),
                    "left": row.get("left_url"),
                    "right": row.get("right_url"),
                    "top": row.get("top_url"),
                    "bottom": row.get("bottom_url")
                }
        return None

    def record_result(self, result: CubemapResult):
        """Appends a result row to the Google Sheet."""
        row = result.to_sheet_row()
        # We use append_row which is atomic for adding one row
        self.sheet.append_row(row, value_input_option="USER_ENTERED")
