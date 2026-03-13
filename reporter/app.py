from flask import Flask, jsonify, request
from flask_cors import CORS
import sys
import os

# Add parent directory to path to import config and modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from processor.sheet_writer import SheetWriter

app = Flask(__name__)
CORS(app)  # Enable CORS for the frontend React app

import time

# Simple in-memory cache
CACHE_DURATION = 60 # seconds
cached_records = None
last_fetch_time = 0

@app.route('/api/records', methods=['GET'])
def get_records():
    """Returns all records from the Google Sheet (with caching)."""
    global cached_records, last_fetch_time
    
    try:
        current_time = time.time()
        
        # Return cache if still valid
        if cached_records is not None and (current_time - last_fetch_time) < CACHE_DURATION:
            return jsonify({
                'success': True,
                'total_records': len(cached_records),
                'data': cached_records,
                'cached': True
            })

        # Initialize sheet_service here to avoid cross-thread socket hangs
        sheet_service = SheetWriter()
        
        # Fetch all records
        records = sheet_service.sheet.get_all_records()
        
        # Filter only 'done' records
        done_records = [r for r in records if str(r.get('status')).lower() == 'done']
        
        # Update cache
        cached_records = done_records
        last_fetch_time = current_time
        
        return jsonify({
            'success': True,
            'total_records': len(done_records),
            'data': done_records,
            'cached': False
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    # Run server single-threaded to avoid gspread/ssl deadlocks
    app.run(host='0.0.0.0', port=8088, debug=False, threaded=False)
