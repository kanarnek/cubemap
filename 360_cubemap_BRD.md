# Business Requirements Document
## 360° Cube Map Processing Pipeline
### with Cloudflare R2 + Google Sheets
 
| Field | Value |
|---|---|
| Document Type | Business Requirements Document (BRD) |
| Version | 1.0 |
| Date | March 13, 2026 |
| Status | Draft — Awaiting Review |
| Storage | Cloudflare R2 (Object Storage) |
| Metadata Store | Google Sheets via gspread API |
| Processing | Python (NumPy, Pillow) |
 
---
 
## Table of Contents
 
1. [Executive Summary](#1-executive-summary)
2. [Business Context](#2-business-context)
3. [Stakeholders](#3-stakeholders)
4. [System Overview](#4-system-overview)
5. [Google Sheets Schema](#5-google-sheets-schema)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [User Stories & Acceptance Criteria](#8-user-stories--acceptance-criteria)
9. [Module Design](#9-module-design)
10. [Error Handling Strategy](#10-error-handling-strategy)
11. [Cloudflare R2 Setup Requirements](#11-cloudflare-r2-setup-requirements)
12. [Google Sheets Setup Requirements](#12-google-sheets-setup-requirements)
13. [Implementation Phases](#13-implementation-phases)
14. [Risks & Mitigations](#14-risks--mitigations)
15. [Approval & Sign-Off](#15-approval--sign-off)
 
---
 
## 1. Executive Summary
 
This Business Requirements Document defines the requirements for a **360° Cube Map Processing Pipeline**. The system accepts query parameters (Project, Plan, Pin, Timeline) to locate equirectangular panoramic images, converts each image into **six cube-map faces**, uploads the faces to **Cloudflare R2** object storage, and records all public URLs into a **Google Sheet** for downstream consumption.
 
The pipeline is designed to be idempotent, cost-effective (leveraging free-tier and low-cost cloud services), and easily extensible to future reporting capabilities such as PDF comparison reports.
 
---
 
## 2. Business Context
 
### 2.1 Problem Statement
 
Construction site inspection workflows capture hundreds of 360° panoramic images per project. Reviewing these images in equirectangular format is cognitively demanding and impractical for side-by-side timeline comparisons. Stakeholders require individual directional views (front, back, left, right, top, bottom) that are spatially consistent and downloadable as structured assets.
 
### 2.2 Business Objectives
 
- Enable structured, directional viewing of 360° site images without expensive VR hardware.
- Automate cube map extraction to eliminate manual image editing effort.
- Store processed assets in a cost-effective, publicly accessible object store (Cloudflare R2).
- Record all asset URLs in Google Sheets so non-technical stakeholders can access and filter data without a custom UI.
- Provide a foundation for future PDF comparison reports filtered by Plan and Timeline.
 
### 2.3 Scope
 
**In Scope**
- Core pipeline: query → extract → upload → record
- Cloudflare R2 as the primary file storage backend
- Google Sheets as the metadata and URL registry
- Idempotency check (skip already-processed records)
- Error logging per step written back to Google Sheet
 
**Out of Scope**
- PDF report generation (Phase 2)
- Real-time streaming or live camera feeds
- User authentication / access control (Phase 2)
 
---
 
## 3. Stakeholders
 
| Stakeholder | Role | Interest |
|---|---|---|
| Project Manager | Primary User | Runs queries by Project / Plan / Timeline; reviews images in Sheets |
| Site Inspector | Data Producer | Captures 360° images and uploads to source system |
| Engineering Lead | System Owner | Maintains pipeline; approves architecture decisions |
| Finance / Ops | Stakeholder | Monitors Cloudflare R2 usage vs. free-tier limits |
 
---
 
## 4. System Overview
 
### 4.1 High-Level Flow
 
The pipeline executes the following four sequential steps for every valid query:
 
```
┌─────────────────────────────────────────────────────────────┐
│                        INPUT LAYER                          │
│  { project_id, plan_id, pin_id, timeline }                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: FETCH                                              │
│  Query source DB → get image path                           │
│  Validate: aspect ratio 2:1 ±5%                             │
│  Idempotency check → if done already, SKIP                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: EXTRACT                                            │
│  Equirectangular → 6 faces (front/back/left/right/top/bot)  │
│  face_size = source_width ÷ 4  │  bilinear interpolation    │
│  in-memory (BytesIO) — no disk writes                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: UPLOAD → Cloudflare R2                             │
│  Key: {project_id}/{plan_id}/{pin_id}/{timeline}/{face}.png  │
│  Retry 3x with exponential backoff on failure               │
│  Returns 6 public URLs                                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: RECORD → Google Sheets                             │
│  Append row: metadata + 6 face URLs + status + timestamp    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  OUTPUT                                                     │
│  { status, urls: { front, back, left, right, top, bottom } }│
└─────────────────────────────────────────────────────────────┘
```
 
### 4.2 Technology Stack
 
| Component | Technology | Notes |
|---|---|---|
| Image Extraction | Python 3.11+, NumPy, Pillow | Bilinear interpolation; face size = source_width ÷ 4 |
| File Storage | Cloudflare R2 | Free: 10 GB storage, 1M requests/month; no egress fee |
| Metadata Store | Google Sheets + gspread | Free; collaborative; human-readable URL registry |
| R2 Client | boto3 (S3-compatible) | Endpoint: `<account>.r2.cloudflarestorage.com` |
| Sheets Client | gspread + google-auth | Service Account credentials; OAuth 2.0 |
| Pipeline Runner | Python `main.py` | CLI or callable from FastAPI endpoint (Phase 2) |
 
### 4.3 File Path Convention (Cloudflare R2)
 
All cube-map face files are stored under a deterministic path:
 
```
{project_id}/{plan_id}/{pin_id}/{timeline}/{face}.png
```
 
**Example:**
```
proj-01/plan-A/pin-09/2024-Q1/front.png
proj-01/plan-A/pin-09/2024-Q1/back.png
proj-01/plan-A/pin-09/2024-Q1/left.png
proj-01/plan-A/pin-09/2024-Q1/right.png
proj-01/plan-A/pin-09/2024-Q1/top.png
proj-01/plan-A/pin-09/2024-Q1/bottom.png
```
 
---
 
## 5. Google Sheets Schema
 
### 5.1 Sheet: `cubemap_records`
 
One row is appended per processed image. All columns are mandatory except `error_message`, which is populated only on failure.
 
| Column | Type | Description |
|---|---|---|
| `id` | Auto (row) | Row number used as record identifier |
| `project_id` | String | Project identifier from source system |
| `plan_id` | String | Plan / floor plan identifier |
| `pin_id` | String | Pin / camera location identifier |
| `timeline` | String | Inspection period e.g. `2024-Q1` |
| `source_path` | String | Original path of equirectangular image |
| `front_url` | URL | Public Cloudflare R2 URL for front face |
| `back_url` | URL | Public Cloudflare R2 URL for back face |
| `left_url` | URL | Public Cloudflare R2 URL for left face |
| `right_url` | URL | Public Cloudflare R2 URL for right face |
| `top_url` | URL | Public Cloudflare R2 URL for top face |
| `bottom_url` | URL | Public Cloudflare R2 URL for bottom face |
| `status` | Enum | `done` \| `fetch_error` \| `extract_error` \| `upload_error` \| `sheet_error` |
| `error_message` | String | Error detail if status ≠ `done`; else empty |
| `processed_at` | DateTime | ISO 8601 UTC timestamp of pipeline execution |
 
### 5.2 Idempotency Rule
 
Before processing any record, the pipeline queries the Google Sheet for a matching row where `project_id + plan_id + pin_id + timeline` already exist with `status = done`. If found, the record is **skipped** and the existing URLs are returned. This prevents duplicate uploads and redundant API calls.
 
---
 
## 6. Functional Requirements
 
### 6.1 Step 1 — Fetch Image
 
**FR-01 Query by Parameters**
The system shall accept four required parameters: `project_id`, `plan_id`, `pin_id`, `timeline`. It shall query the source database (read-only) and return the file path or URL of the corresponding equirectangular image.
 
**FR-02 Image Validation**
The system shall validate that the retrieved image has an aspect ratio of 2:1 (±5%). If validation fails, the pipeline writes a `fetch_error` record to Google Sheets and terminates gracefully.
 
**FR-03 Idempotency Check**
The system shall check Google Sheets for an existing `done` record matching all four parameters before processing. If found, the pipeline returns the existing URLs without reprocessing.
 
### 6.2 Step 2 — Extract Cube Map
 
**FR-04 Six-Face Extraction**
The system shall produce exactly six faces: `front`, `back`, `left`, `right`, `top`, `bottom`. Each face shall be a square PNG with pixel dimensions equal to `source_width ÷ 4` (e.g. 6080 ÷ 4 = 1520 px).
 
**FR-05 Face Orientation**
All side faces shall be oriented so that the ceiling appears at the top and the floor at the bottom, consistent with normal human viewing perspective. The top and bottom faces shall use the forward direction (+Z) as the up vector.
 
**FR-06 Bilinear Interpolation**
The system shall use bilinear interpolation when sampling the source equirectangular image to ensure smooth, artifact-free output.
 
**FR-07 In-Memory Processing**
Face images shall be processed in memory (BytesIO buffers) without writing intermediate files to disk.
 
### 6.3 Step 3 — Upload to Cloudflare R2
 
**FR-08 Structured Key Naming**
Each face shall be uploaded to R2 using the key pattern `{project_id}/{plan_id}/{pin_id}/{timeline}/{face}.png`. Upload shall overwrite any existing file at the same key.
 
**FR-09 Public URL Generation**
After upload, the system shall construct a public URL for each face using the configured R2 public domain: `https://{public_domain}/{key}`.
 
**FR-10 Retry on Failure**
If an upload fails, the system shall retry up to 3 times with exponential backoff (1s, 2s, 4s). If all retries fail, the pipeline writes an `upload_error` record to Google Sheets and terminates.
 
### 6.4 Step 4 — Record to Google Sheets
 
**FR-11 Atomic Row Append**
The system shall append a single row containing all metadata fields and all six face URLs. Partial rows are not permitted.
 
**FR-12 Status Field**
The `status` column shall be set to `done` upon successful completion, or to the appropriate error enum if a step failed.
 
**FR-13 Timestamp**
The `processed_at` field shall be recorded as an ISO 8601 UTC timestamp at the time of Sheet write.
 
---
 
## 7. Non-Functional Requirements
 
| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Performance | End-to-end pipeline for one image shall complete within 60 seconds on a standard 4-core machine (excluding network latency). |
| NFR-02 | Reliability | The pipeline shall be idempotent: re-running for the same parameters produces the same URLs without duplicating records. |
| NFR-03 | Scalability | The pipeline shall support batch processing of up to 100 images per run. |
| NFR-04 | Cost | Total monthly cloud cost shall remain within Cloudflare R2 free tier (10 GB storage, 1M Class A + 10M Class B ops) and Google Sheets free tier. |
| NFR-05 | Security | R2 credentials and Google Service Account JSON shall never be committed to version control. Use environment variables or `.env` files. |
| NFR-06 | Observability | All pipeline steps shall log start time, duration, success/failure, and error messages to stdout in structured JSON format. |
| NFR-07 | Maintainability | Each step shall be implemented as an independent module with no circular dependencies. |
 
---
 
## 8. User Stories & Acceptance Criteria
 
### US-01 — Run Pipeline by Query
 
> **As a** Project Manager,
> **I want to** run the pipeline by providing Project, Plan, Pin, and Timeline,
> **So that** I get six cube-map face URLs without manually editing images.
 
**Acceptance Criteria:**
- Given valid parameters, the pipeline fetches the correct image from the source system.
- Six PNG faces are produced at the correct resolution (`source_width ÷ 4`).
- Six public R2 URLs are returned and verified as accessible via HTTP 200.
- A row with `status = done` is appended to `cubemap_records`.
- Re-running with the same parameters returns existing URLs without creating a duplicate row.
 
---
 
### US-02 — View Faces in Google Sheet
 
> **As a** Project Manager,
> **I want to** filter the Google Sheet by Plan and Timeline to see all face URLs,
> **So that** I can review site progress without accessing any backend system.
 
**Acceptance Criteria:**
- The `cubemap_records` sheet contains all required columns in the correct order.
- Filtering by `plan_id` and `timeline` returns only matching rows.
- Each URL cell, when opened in a browser, displays the correct cube-map face image.
- Failed records show the `error_message` column populated and `status ≠ done`.
 
---
 
### US-03 — Handle Processing Failures Gracefully
 
> **As an** Engineering Lead,
> **I want to** see error records in the Sheet when a step fails,
> **So that** I can identify and fix issues without losing track of failed jobs.
 
**Acceptance Criteria:**
- A fetch failure writes a row with `status = fetch_error` and the exception message in `error_message`.
- An upload failure triggers 3 retries; if all fail, writes `status = upload_error`.
- A Sheet write failure logs URLs to stdout as a fallback.
- The pipeline never crashes silently; all exceptions are caught and recorded.
 
---
 
### US-04 — Batch Process Multiple Images
 
> **As an** Engineering Lead,
> **I want to** run the pipeline for a list of query parameter sets in one command,
> **So that** all pins for a given Plan and Timeline are processed in one batch.
 
**Acceptance Criteria:**
- The pipeline accepts a list (JSON array or CSV) of `{project_id, plan_id, pin_id, timeline}` objects.
- Each item is processed sequentially; a failure on one item does not stop the batch.
- A summary is printed to stdout: total / success / skipped (idempotent) / failed.
 
---
 
## 9. Module Design
 
### 9.1 Project Structure
 
```
cubemap_pipeline/
├── main.py           ← Orchestrator (entry point)
├── config.py         ← Env vars: R2 keys, Sheet ID
├── models.py         ← Dataclasses: CubemapJob, CubemapResult
├── fetcher.py        ← Step 1: DB query + image download
├── extractor.py      ← Step 2: Equirect → 6 faces
├── uploader.py       ← Step 3: boto3 → Cloudflare R2
├── sheet_writer.py   ← Step 4: gspread → Google Sheets
├── requirements.txt
└── .env              ← Credentials (gitignored)
```
 
### 9.2 Key Dependencies
 
| Package | Version | Purpose |
|---|---|---|
| `numpy` | ≥1.24 | Vectorised spherical reprojection |
| `Pillow` | ≥10.0 | Image I/O and PNG encoding |
| `boto3` | ≥1.34 | S3-compatible client for Cloudflare R2 |
| `gspread` | ≥6.0 | Google Sheets read/write via API v4 |
| `google-auth` | ≥2.0 | OAuth 2.0 service account authentication |
| `python-dotenv` | ≥1.0 | Load `.env` credentials at runtime |
 
### 9.3 `requirements.txt`
 
```
numpy>=1.24
Pillow>=10.0
boto3>=1.34
gspread>=6.0
google-auth>=2.0
python-dotenv>=1.0
```
 
---
 
## 10. Error Handling Strategy
 
| Step | Error Type | Status Written | Recovery Action |
|---|---|---|---|
| Fetch | Image not found in source DB | `fetch_error` | Log to Sheet; skip remaining steps |
| Fetch | Aspect ratio check fails (not 2:1) | `fetch_error` | Log to Sheet; skip remaining steps |
| Extract | Corrupt or unreadable image file | `extract_error` | Log to Sheet; skip upload |
| Upload | R2 connection timeout or auth error | `upload_error` | Retry 3× with backoff; log if all fail |
| Sheet | Google Sheets API quota exceeded | `sheet_error` | Print URLs to stdout as fallback |
 
---
 
## 11. Cloudflare R2 Setup Requirements
 
**Prerequisites:**
- Cloudflare account (free tier: 10 GB storage, 1M requests/month)
- R2 bucket created with **public access enabled**
- R2 API token with **Object Read & Write** permissions
- Public bucket URL noted (format: `https://pub-{hash}.r2.dev`)
 
**Environment Variables:**
 
```env
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret
R2_BUCKET_NAME=cubemap-assets
R2_PUBLIC_URL=https://pub-xxxx.r2.dev
GOOGLE_SERVICE_ACCOUNT_JSON=path/to/service_account.json
GOOGLE_SHEET_ID=your_google_sheet_id
```
 
---
 
## 12. Google Sheets Setup Requirements
 
- Create a Google Cloud project and enable **Google Sheets API** and **Google Drive API**.
- Create a **Service Account** and download the JSON credentials file.
- Share the target Google Sheet with the service account email (**Editor** role).
- Ensure the first row of `cubemap_records` contains the exact column headers defined in Section 5.1.
- The pipeline appends rows starting from row 2.
 
---
 
## 13. Implementation Phases
 
| Phase | Name | Deliverables | Estimate |
|---|---|---|---|
| 1 | Core Pipeline | `extractor.py`, `uploader.py`, `sheet_writer.py`, `main.py` (single-image mode) | 1 week |
| 2 | Batch & Idempotency | Batch mode in `main.py`, idempotency check, structured logging | 3 days |
| 3 | Error Resilience | Retry logic, error status to Sheets, fallback stdout logging | 2 days |
| 4 | PDF Reports *(Future)* | Query Sheets by Plan + Timeline; generate PDF comparison report via WeasyPrint | TBD |
 
---
 
## 14. Risks & Mitigations
 
| Risk | Severity | Mitigation |
|---|---|---|
| Google Sheets API rate limit (60 req/min) | Medium | Batch sheet writes; add 1s delay between rows in large batches |
| R2 free tier exceeded (10 GB) | Low | Monitor via Cloudflare dashboard; compress images if needed |
| Source DB schema changes break `fetcher.py` | Medium | Abstract DB queries behind `fetcher.py`; add schema validation on startup |
| R2 public URL access revoked | Low | Test URL accessibility as part of pipeline health check |
| Large images (>200 MB) cause memory issues | Medium | Resize source image before extraction if width > 12,000 px |
 
---
 
## 15. Approval & Sign-Off
 
By signing below, stakeholders confirm they have reviewed and agreed to the requirements in this BRD.
 
| Role | Name | Signature | Date |
|---|---|---|---|
| Engineering Lead | | | |
| Project Manager | | | |
| Finance / Ops | | | |
 
---
 
*Document Version 1.0 — © 2026 — Internal Use Only*