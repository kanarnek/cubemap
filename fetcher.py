from PIL import Image
import requests
import io
import os
from models import CubemapJob

class ImageFetcher:
    """
    Handles fetching equirectangular images.
    Currently supports local paths and public URLs.
    Can be extended to support specific database queries.
    """

    def fetch(self, job: CubemapJob) -> Image.Image:
        """Fetches an image based on the job's source_path."""
        source = job.source_path
        
        try:
            if source.startswith(("http://", "https://")):
                response = requests.get(source, timeout=30)
                response.raise_for_status()
                return Image.open(io.BytesIO(response.content))
            else:
                # Assume local file path
                if not os.path.exists(source):
                    raise FileNotFoundError(f"Source image not found: {source}")
                return Image.open(source)
        except Exception as e:
            raise RuntimeError(f"Failed to fetch image from {source}: {str(e)}")
