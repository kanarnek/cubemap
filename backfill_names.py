import sys
import os
import json
import requests

# Add root directory to sys.path
sys.path.append(os.getcwd())

from processor.sheet_writer import SheetWriter
from reporter.app import _get_master_items, clean_id

def migrate():
    print("🚀 Starting Data Migration: Backfilling Project/Plan Names...")
    
    # 1. Initialize SheetWriter and fetch master data
    writer = SheetWriter()
    master = _get_master_items()
    if not master:
        print("❌ Could not fetch master data from n8n. Aborting.")
        return

    # 2. Map IDs to Names for quick lookup
    # Map: (project_id, plan_id) -> (project_name, plan_name)
    name_map = {}
    for item in master:
        p_id = clean_id(item.get('project_id'))
        pl_id = clean_id(item.get('plan_id'))
        p_name = str(item.get('project_name') or item.get('project') or '').strip()
        pl_name = str(item.get('plan_name') or item.get('plan') or '').strip()
        if p_id and pl_id:
            name_map[(p_id, pl_id)] = (p_name, pl_name)

    # 3. Fetch current records from Sheet
    # get_all_values() returns a list of lists (rows)
    all_values = writer.sheet.get_all_values()
    if not all_values:
        print("⚠️ Sheet is empty.")
        return

    header = all_values[0]
    rows = all_values[1:] # Skip header
    
    print(f"📊 Total records found: {len(rows)}")

    updates = [] # List of {range, values} for batch update
    
    # Col indices (1-indexed for gspread)
    # COL 2: project_id, COL 3: plan_id, COL 4: project, COL 5: plan
    
    count = 0
    for i, row in enumerate(rows):
        row_num = i + 2 # +1 for 0-index, +1 for header
        
        # Ensure row has enough columns
        while len(row) < 5:
            row.append("")
            
        p_id = clean_id(row[1])
        pl_id = clean_id(row[2])
        current_p_name = str(row[3]).strip()
        current_pl_name = str(row[4]).strip()

        if not current_p_name or not current_pl_name:
            names = name_map.get((p_id, pl_id))
            if names:
                new_p_name, new_pl_name = names
                # Update the row values
                # Update Column D (4) and E (5)
                # writer.sheet.update(range_name, values)
                # We'll batch these if possible, but for simplicity/safety we can do range updates
                print(f"  Row {row_num}: Backfilling {p_id}/{pl_id} -> {new_p_name}/{new_pl_name}")
                
                # Column 4 corresponds to 'D', Column 5 corresponds to 'E'
                writer.sheet.update(f"D{row_num}:E{row_num}", [[new_p_name, new_pl_name]])
                count += 1

    print(f"✅ Migration Complete. Updated {count} rows.")

if __name__ == "__main__":
    migrate()
