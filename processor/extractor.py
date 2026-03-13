import numpy as np
from PIL import Image
import io
import math
from typing import Dict, List
from config import FACE_NAMES

class CubemapExtractor:
    """Handles the conversion from equirectangular to cubemap faces."""

    def __init__(self, face_size: int = None):
        self.face_size = face_size

    def extract_faces(self, equirect_image: Image.Image) -> Dict[str, io.BytesIO]:
        """
        Extracts 6 faces from an equirectangular image.
        Returns a dictionary mapping face names to BytesIO buffers containing PNG data.
        """
        width, height = equirect_image.size
        
        # Validate aspect ratio (should be 2:1)
        if abs((width / height) - 2.0) > 0.05:
            raise ValueError(f"Image aspect ratio {width/height:.2f} is not approximately 2:1")

        if self.face_size is None:
            self.face_size = width // 4

        # Convert image to numpy array for faster processing
        img_array = np.asarray(equirect_image)
        faces = {}

        for face_name in FACE_NAMES:
            face_array = self._generate_face(img_array, face_name)
            
            # Convert back to PIL Image
            face_img = Image.fromarray(face_array.astype(np.uint8))
            
            # Save to BytesIO
            buf = io.BytesIO()
            face_img.save(buf, format="PNG")
            buf.seek(0)
            faces[face_name] = buf

        return faces

    def _generate_face(self, img_array: np.ndarray, face_name: str) -> np.ndarray:
        """Generates a single cube face using vectorised numpy operations."""
        h, w, c = img_array.shape
        size = self.face_size

        # Create grid of face coordinates (0 to size-1)
        i, j = np.meshgrid(np.arange(size), np.arange(size), indexing='ij')

        # Normalize to [-1, 1] range
        # Note: We use size-1 to map exactly to the range [-1, 1]
        x = 2.0 * i / (size - 1) - 1.0
        y = 2.0 * j / (size - 1) - 1.0

        # Determine XYZ unit vectors based on face
        # Directions follow standard cubemap conventions
        if face_name == "front":    # +Z
            xyz = np.stack([y, -x, np.ones_like(x)], axis=-1)
        elif face_name == "back":   # -Z
            xyz = np.stack([-y, -x, -np.ones_like(x)], axis=-1)
        elif face_name == "left":   # -X
            xyz = np.stack([-np.ones_like(x), -x, y], axis=-1)
        elif face_name == "right":  # +X
            xyz = np.stack([np.ones_like(x), -x, -y], axis=-1)
        elif face_name == "top":    # +Y
            xyz = np.stack([x, np.ones_like(x), y], axis=-1)
        elif face_name == "bottom": # -Y
            xyz = np.stack([x, -np.ones_like(x), -y], axis=-1)
        else:
            raise ValueError(f"Unknown face: {face_name}")

        # Normalize XYZ to unit vectors
        norm = np.linalg.norm(xyz, axis=-1, keepdims=True)
        xyz /= norm

        # Map XYZ to spherical coordinates (phi, theta)
        # phi is longitude [-pi, pi], theta is latitude [-pi/2, pi/2]
        phi = np.arctan2(xyz[..., 0], xyz[..., 2])
        theta = np.arcsin(xyz[..., 1])

        # Map phi, theta to pixel coordinates in equirectangular image
        # u: [0, 1] -> [0, w-1]
        # v: [0, 1] -> [0, h-1]
        u = (phi + np.pi) / (2 * np.pi) * (w - 1)
        v = (np.pi / 2 - theta) / np.pi * (h - 1)

        # Bilinear interpolation
        u0 = np.floor(u).astype(int)
        u1 = np.clip(u0 + 1, 0, w - 1)
        v0 = np.floor(v).astype(int)
        v1 = np.clip(v0 + 1, 0, h - 1)

        du = u - u0
        dv = v - v0
        
        # Add extra dimension for color channels
        du = du[..., np.newaxis]
        dv = dv[..., np.newaxis]

        # Sample 4 surrounding pixels
        p00 = img_array[v0, u0]
        p01 = img_array[v0, u1]
        p10 = img_array[v1, u0]
        p11 = img_array[v1, u1]

        # Interpolate
        top = p00 * (1 - du) + p01 * du
        bottom = p10 * (1 - du) + p11 * du
        face_array = top * (1 - dv) + bottom * dv

        return face_array
