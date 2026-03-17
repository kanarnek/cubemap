from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
from datetime import datetime, timedelta, timezone
import sys
import os

# Add parent directory to path to import config and modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from processor.sheet_writer import SheetWriter
from main import CubemapPipeline
from models import CubemapJob, cubemap_clean_id_v2

def cubemap_clean_id_v2(val):
    """Normalize IDs to string and remove .0 suffix if present."""
    if val is None: return ""
    s = str(val).strip()
    if s.endswith('.0'):
        return s[:-2]
    return s

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

@app.route('/api/master-data', methods=['GET'])
def get_master_data():
    """Fetches master project and plan data from n8n."""
    try:
        # Assuming URL /webhook/get-master-data is created in n8n
        n8n_url = 'https://ct-automation.builk.com/webhook/get-master-data'
        response = requests.get(n8n_url, timeout=90)
        response.raise_for_status()
        data = response.json()
        
        # In case n8n returns wrapped data like [{ "project_id": ... }] or [{ "json": { ... } }]
        items = []
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and 'project_id' in item:
                    items.append(item)
                elif isinstance(item, dict) and 'json' in item:
                    items.append(item['json'])
                else:
                    items.append(item)
        elif isinstance(data, dict):
             if 'items' in data:
                 items = data['items']
             else:
                 items = [data]
        else:
             items = data

        return jsonify({'success': True, 'data': items})
    except Exception as e:
        print(f"ERROR fetching master data from n8n: {str(e)}")
        return jsonify({'success': False, 'error': f'Failed to fetch master data: {str(e)}'}), 502

def _get_master_items():
    """Internal helper to get master data without returning a Response object."""
    try:
        n8n_url = 'https://ct-automation.builk.com/webhook/get-master-data'
        response = requests.get(n8n_url, timeout=90)
        response.raise_for_status()
        data = response.json()
        
        items = []
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and 'project_id' in item: items.append(item)
                elif isinstance(item, dict) and 'json' in item: items.append(item['json'])
                else: items.append(item)
        elif isinstance(data, dict):
            if 'items' in data: items = data['items']
            else: items = [data]
        else: items = data
        return items
    except:
        return []

@app.route('/api/available-dates', methods=['POST'])
def get_available_dates():
    """Fetches available dates from n8n based on project and plan."""
    try:
        filters = request.json
        req_proj = str(filters.get('project_id', '')).strip()
        req_plan = str(filters.get('plan_id', '')).strip()

        # Assuming URL /webhook/get-available-dates is created in n8n
        n8n_url = 'https://ct-automation.builk.com/webhook/get-available-dates'
        response = requests.post(n8n_url, json=filters, timeout=90)
        response.raise_for_status()
        data = response.json()
        
        # Unwrap data format from n8n
        items = []
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and 'json' in item:
                    items.append(item['json'])
                else:
                    items.append(item)
        elif isinstance(data, dict):
            if 'items' in data:
                items = data['items']
            else:
                items = [data]
        else:
            items = data
            
        dates = []
        for item in items:
            if isinstance(item, dict):
                item_proj = str(item.get('project_id', '')).strip()
                item_plan = str(item.get('plan_id', '')).strip()
                
                # Filter by project and plan if they were selected in the frontend
                match_proj = not req_proj or item_proj == req_proj
                match_plan = not req_plan or item_plan == req_plan
                
                if match_proj and match_plan and 'timeline' in item:
                    raw_tl = str(item['timeline'])
                    # n8n returns dates in UTC (e.g. '2025-12-04T17:00:00.000Z')
                    # But the DB stores dates in Thai timezone (ICT = UTC+7)
                    # We need to convert UTC -> ICT before extracting the date part
                    try:
                        # Try parsing ISO format (with Z or +00:00)
                        clean = raw_tl.replace('Z', '+00:00')
                        dt_utc = datetime.fromisoformat(clean)
                        # Convert to ICT (UTC+7)
                        ict = timezone(timedelta(hours=7))
                        dt_local = dt_utc.astimezone(ict)
                        dates.append(dt_local.strftime('%Y-%m-%d'))
                    except:
                        # Fallback: just take first 10 chars
                        dates.append(raw_tl[:10])
        
        # Deduplicate
        unique_dates = list(set(dates))
        return jsonify({'success': True, 'dates': unique_dates})
    except Exception as e:
        print(f"ERROR fetching available dates from n8n: {str(e)}")
        return jsonify({'success': False, 'error': f'Failed to fetch dates: {str(e)}'}), 502

@app.route('/api/fetch-n8n-jobs', methods=['POST'])
def fetch_n8n_jobs():
    """Proxies the call to n8n and returns the raw jobs list."""
    try:
        filters = request.json
        n8n_url = 'https://ct-automation.builk.com/webhook/n8ngetdata'
        
        response = requests.post(n8n_url, json=filters, timeout=90)
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

        proj_id = cubemap_clean_id_v2(job_info.get('project_id'))
        plan_id = cubemap_clean_id_v2(job_info.get('plan_id'))
        proj_name = str(job_info.get('project', '') or job_info.get('project_name', '')).strip()
        plan_name = str(job_info.get('plan', '') or job_info.get('plan_name', '')).strip()

        # If names are missing, try to look them up from master data
        if not proj_name or not plan_name:
            master = _get_master_items()
            for item in master:
                m_proj_id = cubemap_clean_id_v2(item.get('project_id'))
                m_plan_id = cubemap_clean_id_v2(item.get('plan_id'))
                if m_proj_id == proj_id and m_plan_id == plan_id:
                    if not proj_name: proj_name = str(item.get('project_name') or item.get('project') or '').strip()
                    if not plan_name: plan_name = str(item.get('plan_name') or item.get('plan') or '').strip()
                    break

        job = CubemapJob(
            project_id=proj_id,
            plan_id=plan_id,
            project_name=proj_name,
            plan_name=plan_name,
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

if __name__ == '__main__':
    # Run server single-threaded to avoid gspread/ssl deadlocks
    app.run(host='0.0.0.0', port=8088, debug=False, threaded=False)
