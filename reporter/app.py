from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import sys
import os

# Add parent directory to path to import config and modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from processor.sheet_writer import SheetWriter
from main import CubemapPipeline
from models import CubemapJob

pipeline = CubemapPipeline()

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

@app.route('/api/fetch-n8n-jobs', methods=['POST'])
def fetch_n8n_jobs():
    """Proxies the call to n8n and returns the raw jobs list."""
    try:
        filters = request.json
        n8n_url = 'https://ct-automation.builk.com/webhook/n8ngetdata'
        
        response = requests.post(n8n_url, json=filters, timeout=30)
        response.raise_for_status()
        jobs_data = response.json()
        print(f"DEBUG: RAW data from n8n: {jobs_data}")
        
        # Super-defensive unwrapping
        jobs_list = []
        if isinstance(jobs_data, list):
            # Case 1: n8n returns a list of items directly
            # But sometimes it's a list containing one object with 'items'
            if len(jobs_data) == 1 and isinstance(jobs_data[0], dict) and 'items' in jobs_data[0]:
                 jobs_list = jobs_data[0]['items']
            else:
                 jobs_list = jobs_data
        elif isinstance(jobs_data, dict):
            # Case 2: n8n returns an object with 'items' or 'json'
            if 'items' in jobs_data:
                jobs_list = jobs_data['items']
            elif 'json' in jobs_data:
                # If json is a list, use it. If it's a single object, wrap it.
                val = jobs_data['json']
                jobs_list = val if isinstance(val, list) else [val]
            else:
                # Case 3: Just a single object
                jobs_list = [jobs_data]
        
        # Final safety check: filter out any objects that don't look like real jobs (e.g., {"success": true})
        jobs_list = [j for j in jobs_list if isinstance(j, dict) and ('pin' in j or 'pin_id' in j or 'url' in j)]
        
        print(f"DEBUG: Final jobs list count: {len(jobs_list)}")
        return jsonify({'success': True, 'jobs': jobs_list})
    except Exception as e:
        print(f"ERROR fetching from n8n: {str(e)}")
        return jsonify({'success': False, 'error': f'Failed to fetch from n8n: {str(e)}'}), 502

@app.route('/api/process-single-job', methods=['POST'])
def process_single_job():
    """Processes a single cubemap job."""
    try:
        job_info = request.json
        print(f"DEBUG: Received job for processing: {job_info}")
        if not job_info:
            return jsonify({'success': False, 'error': 'No job data provided'}), 400

        p_id = str(job_info.get('pin') or job_info.get('pin_id'))
        s_path = str(job_info.get('url') or job_info.get('source_path'))
        
        if not all([job_info.get('project_id'), job_info.get('plan_id'), p_id, job_info.get('timeline'), s_path]):
             return jsonify({'success': False, 'error': 'Missing required fields'}), 400

        job = CubemapJob(
            project_id=str(job_info['project_id']),
            plan_id=str(job_info['plan_id']),
            pin_id=p_id,
            timeline=str(job_info['timeline']),
            source_path=s_path
        )
        
        result = pipeline.process_job(job)
        
        # Invalidate cache
        global cached_records, last_fetch_time
        cached_records = None
        last_fetch_time = 0

        return jsonify({
            'success': True,
            'status': result.status,
            'face_urls': result.face_urls,
            'error_message': result.error_message
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    # Run server single-threaded to avoid gspread/ssl deadlocks
    app.run(host='0.0.0.0', port=8088, debug=False, threaded=False)
