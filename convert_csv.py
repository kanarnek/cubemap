import csv
import json
import os

def convert_csv_to_json(csv_path, json_path):
    jobs = []
    with open(csv_path, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Mapping CSV columns to CubemapJob structure
            # CSV: project_id, plan_id, pin, timeline, url
            # Job: project_id, plan_id, pin_id, timeline, source_path
            job = {
                "project_id": str(row["project_id"]),
                "plan_id": str(row["plan_id"]),
                "pin_id": str(row["pin"]),
                "timeline": str(row["timeline"]),
                "source_path": str(row["url"])
            }
            jobs.append(job)
    
    with open(json_path, mode='w', encoding='utf-8') as f:
        json.dump(jobs, f, indent=2)
    
    print(f"Successfully converted {len(jobs)} rows to {json_path}")

if __name__ == "__main__":
    csv_file = "/Users/kanarnek/Project/cubemap/demo_cubemap202603131127.csv"
    json_file = "/Users/kanarnek/Project/cubemap/jobs.json"
    convert_csv_to_json(csv_file, json_file)
