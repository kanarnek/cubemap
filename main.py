import sys
import json
import logging
from typing import List, Dict, Any
from datetime import datetime

from models import CubemapJob, CubemapResult
from processor.fetcher import ImageFetcher
from processor.extractor import CubemapExtractor
from processor.uploader import R2Uploader
from processor.sheet_writer import SheetWriter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("cubemap_pipeline")

class CubemapPipeline:
    """The orchestrator for the 360° Cube Map Processing Pipeline."""

    def __init__(self):
        self.fetcher = ImageFetcher()
        self.extractor = CubemapExtractor()
        # Lazily initialize Cloud integrations to allow local testing
        self._uploader = None
        self._sheet_writer = None

    @property
    def uploader(self):
        if self._uploader is None:
            self._uploader = R2Uploader()
        return self._uploader

    @property
    def sheet_writer(self):
        if self._sheet_writer is None:
            self._sheet_writer = SheetWriter()
        return self._sheet_writer

    def process_job(self, job: CubemapJob) -> CubemapResult:
        """Runs the 4-step pipeline for a single job."""
        result = CubemapResult(job=job)
        logger.info(f"Starting pipeline for Job: {job.project_id}/{job.plan_id}/{job.pin_id}/{job.timeline}")

        try:
            # STEP 0: Idempotency Check
            logger.info("Step 0: Checking idempotency...")
            try:
                existing_urls = self.sheet_writer.check_idempotency(
                    job.project_id, job.plan_id, job.pin_id, job.timeline
                )
                if existing_urls:
                    logger.info("Found existing record. Skipping processing.")
                    result.face_urls = existing_urls
                    result.status = "done"
                    return result
            except Exception as e:
                logger.warning(f"Idempotency check failed (possibly missing credentials): {str(e)}")

            # STEP 1: Fetch
            logger.info("Step 1: Fetching image...")
            try:
                img = self.fetcher.fetch(job)
            except Exception as e:
                result.status = "fetch_error"
                result.error_message = str(e)
                try: self.sheet_writer.record_result(result)
                except: pass
                return result

            # STEP 2: Extract
            logger.info("Step 2: Extracting faces...")
            try:
                faces = self.extractor.extract_faces(img)
            except Exception as e:
                result.status = "extract_error"
                result.error_message = str(e)
                try: self.sheet_writer.record_result(result)
                except: pass
                return result

            # STEP 3: Upload
            logger.info("Step 3: Uploading to Cloudflare R2...")
            try:
                prefix = f"{job.project_id}/{job.plan_id}/{job.pin_id}/{job.timeline}"
                face_urls = self.uploader.upload_faces(faces, prefix)
                result.face_urls = face_urls
            except Exception as e:
                result.status = "upload_error"
                result.error_message = str(e)
                try: self.sheet_writer.record_result(result)
                except: pass
                return result

            # STEP 4: Record
            logger.info("Step 4: Recording to Google Sheets...")
            try:
                result.status = "done"
                self.sheet_writer.record_result(result)
            except Exception as e:
                logger.error(f"Failed to write to Sheet: {str(e)}")
                logger.info(f"Result URLs: {result.face_urls}")
                result.status = "sheet_error"
                result.error_message = str(e)
                return result

            logger.info("Pipeline completed successfully.")
            return result

        except Exception as e:
            logger.exception("Unexpected error in pipeline")
            result.status = "error"
            result.error_message = f"Unexpected: {str(e)}"
            return result

    def process_batch(self, batch_file: str):
        """Processes multiple jobs from a JSON file."""
        with open(batch_file, 'r') as f:
            jobs_data = json.load(f)
        
        total = len(jobs_data)
        success = 0
        failed = 0
        
        logger.info(f"Starting batch process for {total} jobs")
        
        for data in jobs_data:
            try:
                job = CubemapJob(**data)
                result = self.process_job(job)
                if result.status == "done":
                    success += 1
                else:
                    failed += 1
            except Exception as e:
                logger.error(f"Failed to create job from data {data}: {str(e)}")
                failed += 1
        
        logger.info(f"Batch Summary: Total={total}, Success={success}, Failed={failed}")

def main():
    """CLI Entry point for single job or batch processing."""
    pipeline = CubemapPipeline()
    
    if len(sys.argv) == 2 and sys.argv[1].endswith('.json'):
        # Batch Mode
        pipeline.process_batch(sys.argv[1])
    elif len(sys.argv) == 6:
        # Single Job Mode
        job = CubemapJob(
            project_id=sys.argv[1],
            plan_id=sys.argv[2],
            pin_id=sys.argv[3],
            timeline=sys.argv[4],
            source_path=sys.argv[5]
        )
        pipeline.process_job(job)
    else:
        print("Usage:")
        print("  Single Mode: python -m cubemap.main <proj> <plan> <pin> <timeline> <source_path>")
        print("  Batch Mode:  python -m cubemap.main <batch_file.json>")

if __name__ == "__main__":
    main()

