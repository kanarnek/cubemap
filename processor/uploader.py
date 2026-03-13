import boto3
from botocore.config import Config
from typing import Dict, Optional
import io
import time
from config import R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL

class R2Uploader:
    """Handles uploading files to Cloudflare R2 using an S3-compatible client."""

    def __init__(self):
        self.endpoint_url = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
        self.s3_client = boto3.client(
            service_name="s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            config=Config(signature_version="s3v4"),
        )
        self.bucket_name = R2_BUCKET_NAME
        self.public_url = R2_PUBLIC_URL.rstrip("/")

    def upload_face(self, face_buf: io.BytesIO, key: str, max_retries: int = 3) -> str:
        """
        Uploads a single face buffer to R2.
        Returns the public URL of the uploaded file.
        """
        for attempt in range(max_retries):
            try:
                face_buf.seek(0)
                self.s3_client.upload_fileobj(
                    face_buf,
                    self.bucket_name,
                    key,
                    ExtraArgs={"ContentType": "image/png"}
                )
                return f"{self.public_url}/{key}"
            except Exception as e:
                if attempt == max_retries - 1:
                    raise e
                time.sleep(2 ** attempt)  # Exponential backoff

    def upload_faces(self, faces: Dict[str, io.BytesIO], prefix: str) -> Dict[str, str]:
        """
        Uploads multiple faces with a common prefix.
        prefix should be in format: {project_id}/{plan_id}/{pin_id}/{timeline}/
        """
        urls = {}
        for face_name, buf in faces.items():
            key = f"{prefix.strip('/')}/{face_name}.png"
            urls[face_name] = self.upload_face(buf, key)
        return urls
