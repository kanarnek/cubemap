import sys
import os

# Add the root directory to the path so we can import from 'reporter' and 'processor'
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from reporter.app import app

# Vercel looks for 'app' by default in the index.py
# If app is already a Flask instance, this works.
