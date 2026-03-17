from dataclasses import dataclass, field
from typing import Dict, Optional
from datetime import datetime

def clean_id(val):
    """Normalize IDs to string and remove .0 suffix if present."""
    if val is None: return ""
    s = str(val).strip()
    if s.endswith('.0'):
        return s[:-2]
    return s

@dataclass
class CubemapJob:
    """Represents a request to process a 360 image."""
    project_id: str
    plan_id: str
    pin_id: str = ""
    timeline: str = ""
    source_path: str = ""  # Can be a local path or a URL
    project_name: str = ""
    plan_name: str = ""

@dataclass
class CubemapResult:
    """Represents the output of the cubemap processing pipeline."""
    job: CubemapJob
    status: str = "pending"
    face_urls: Dict[str, str] = field(default_factory=dict)
    error_message: Optional[str] = None
    processed_at: datetime = field(default_factory=datetime.utcnow)

    def to_sheet_row(self) -> list:
        """Converts the result to a list of values for Google Sheets."""
        return [
            "=ROW()-1",           # id
            self.job.project_id,  # project_id
            self.job.plan_id,     # plan_id
            self.job.project_name or "", # project
            self.job.plan_name or "",    # plan
            self.job.pin_id,      # pin_id
            self.job.timeline,    # timeline
            self.job.source_path, # source_path
            self.face_urls.get("front", ""),
            self.face_urls.get("back", ""),
            self.face_urls.get("left", ""),
            self.face_urls.get("right", ""),
            self.face_urls.get("top", ""),
            self.face_urls.get("bottom", ""),
            self.status,
            self.error_message or "",
            self.processed_at.isoformat()
        ]
