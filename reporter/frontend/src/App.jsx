import React, { useState, useEffect, useMemo, useRef } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import './index.css';

const LoadingModal = ({ isOpen, message, progress }) => {
  if (!isOpen) return null;
  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="spinner-large"></div>
        <h3>{message || 'Processing...'}</h3>
        
        <div className="progress-container">
          <div className="progress-bar-bg">
            <div className="progress-bar-filler" style={{ width: `${percent}%` }}></div>
          </div>
          <div className="progress-text">
            {progress.current} / {progress.total} Pins ({percent}%)
          </div>
        </div>

        <p className="status-text">{progress.status || 'กำลังดึงข้อมูลและประมวลผลรูปภาพ 360 องศา'}</p>
      </div>
    </div>
  );
};

// --- Components ---
const ReportHeader = ({ projectName, planName }) => {
  const currentMonth = format(new Date(), 'MMMM yyyy');
  // For the screenshot look: "1 March 2026 - 31 March 2026"
  // We'll use start and end of current month
  const monthStart = format(startOfMonth(new Date()), 'd MMMM yyyy');
  const monthEnd = format(endOfMonth(new Date()), 'd MMMM yyyy');

  return (
    <div className="report-header">
      <div className="header-left">
        <div className="header-logo-container">
          {/* Using a clear text + style approach for the logo as a reliable fallback */}
          <div className="builk-logo-mock">
            <span className="logo-icon">💠</span>
            <div className="logo-text">
              <span className="logo-main">BUILK</span>
              <span className="logo-sub">CONTECH</span>
            </div>
          </div>
        </div>
        <div className="header-project-info">
          <h1 className="header-title">360 DEMO</h1>
          <h2 className="header-subject">{projectName || 'Project Name'}</h2>
          <p className="header-subtitle">All Collaborators</p>
        </div>
      </div>
      <div className="header-right">
        <h2 className="report-type">Collaboration Report</h2>
        <p className="report-date-range">{monthStart} - {monthEnd}</p>
      </div>
    </div>
  );
};

const FloorPlanViewer = ({ floorPlanUrl, planRecords, pinsForPage, pinPositions, planName }) => {
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [loading, setLoading] = useState(true);

  const handleLoad = (e) => {
    setNaturalSize({
      w: e.target.naturalWidth,
      h: e.target.naturalHeight
    });
    setLoading(false);
  };

  if (!floorPlanUrl) {
    return (
      <div className="floorplan-placeholder">
        <span>Floor Plan Not Available</span>
      </div>
    );
  }

  return (
    <div className="floorplan-container">
      <img 
        src={floorPlanUrl} 
        alt={`Floor Plan: ${planName}`}
        className="floorplan-image" 
        crossOrigin="anonymous"
        onLoad={handleLoad}
      />
      {!loading && naturalSize.w > 0 && planRecords.map((record) => {
        const pId = String(record.pin_id || record.pin || '');
        const pos = pinPositions[pId];
        if (!pos) return null;
        
        const isOnPage = pinsForPage.some(p => String(p.pin_id || p.pin || '') === pId);
        
        // Calculate percentage based on natural dimensions
        const leftPct = (pos.x / naturalSize.w) * 100;
        const topPct = (pos.y / naturalSize.h) * 100;
        
        return (
          <div 
            key={`marker-${pId}-${record.id}`}
            className={`floorplan-marker ${isOnPage ? 'marker-active' : 'marker-dimmed'}`}
            style={{ 
              left: `${leftPct}%`, 
              top: `${topPct}%`
            }}
            title={`Pin: ${pId}`}
          >
            <span className="marker-dot"></span>
            <span className="marker-label">{pId}</span>
          </div>
        );
      })}
    </div>
  );
};

function App() {
  const [records, setRecords] = useState([]);
  const [masterData, setMasterData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });

  // Fetch data
  const fetchRecords = async () => {
    setLoading(true);
    try {
      // Fetch both processed records and master data in parallel
      const [recordsRes, masterRes] = await Promise.all([
        fetch('/api/records').then(res => res.json()),
        fetch('/api/master-data').then(res => res.json()).catch(() => ({ success: false }))
      ]);

      if (recordsRes.success) {
        setRecords(recordsRes.data);
      } else {
        setError(recordsRes.error);
      }

      if (masterRes.success && masterRes.data) {
        console.log("Fetched master data:", masterRes.data.length, "items");
        setMasterData(masterRes.data);
      } else {
        console.warn("Master data fetch failed or returned no data");
      }
    } catch (err) {
      console.error("Fetch error:", err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  // Helper str
  const str = (v) => String(v);

  // Compute available filter options based on MASTER DATA (fallback to records if no master data)
  const projects = useMemo(() => {
    if (masterData.length > 0) {
      // Ensure unique project_ids with nice names
      const uniqueProjects = [];
      const seen = new Set();
      masterData.forEach(r => {
        if (r.project_id && !seen.has(r.project_id)) {
          seen.add(r.project_id);
          uniqueProjects.push({ id: r.project_id, name: r.project_name || r.project_id });
        }
      });
      return uniqueProjects;
    }
    return [...new Set(records.map(r => r.project_id))].filter(Boolean).map(id => ({ id, name: id }));
  }, [records, masterData]);

  const plans = useMemo(() => {
    if (masterData.length > 0) {
      const uniquePlans = [];
      const seen = new Set();
      masterData
        .filter(r => !selectedProject || str(r.project_id) === selectedProject)
        .forEach(r => {
          if (r.plan_id && !seen.has(r.plan_id)) {
            seen.add(r.plan_id);
            uniquePlans.push({ id: r.plan_id, name: r.plan_name || r.plan_id });
          }
        });
      return uniquePlans;
    }
    return [...new Set(records.filter(r => !selectedProject || str(r.project_id) === selectedProject).map(r => r.plan_id))].filter(Boolean).map(id => ({ id, name: id }));
  }, [records, masterData, selectedProject]);
  const dates = useMemo(() => {
    return [...new Set(records.map(r => {
      // Extract YYYY-MM-DD from '2024-05-14 00:00:00.000'
      const match = String(r.timeline).match(/^(\d{4}-\d{2}-\d{2})/);
      return match ? match[1] : '';
    }))].filter(Boolean);
  }, [records]);

  const [availableDatesSet, setAvailableDatesSet] = useState(new Set());
  const [loadingDates, setLoadingDates] = useState(false);
  const [calendarOpenDate, setCalendarOpenDate] = useState(new Date());

  // Fetch available dates when project/plan change
  useEffect(() => {
    if (!selectedProject || !selectedPlan) {
      setAvailableDatesSet(new Set());
      setCalendarOpenDate(new Date());
      return;
    }

    setLoadingDates(true);
    fetch('/api/available-dates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: selectedProject,
        plan_id: selectedPlan
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success && data.dates && data.dates.length > 0) {
        setAvailableDatesSet(new Set(data.dates));
        // Auto-navigate calendar to the most recent month with data
        const sortedDates = [...data.dates].sort();
        const latestDate = sortedDates[sortedDates.length - 1];
        setCalendarOpenDate(parseISO(latestDate));
      } else {
        setAvailableDatesSet(new Set());
        setCalendarOpenDate(new Date());
      }
    })
    .catch(err => {
      console.error("Failed to fetch available dates:", err);
      setAvailableDatesSet(new Set());
    })
    .finally(() => setLoadingDates(false));
  }, [selectedProject, selectedPlan]);

  // Helper to normalize IDs (strip commas or formatting)
  const normId = (id) => String(id || '').replace(/,/g, '').trim();

  // Helper Date selection
  const handleDateChange = (date) => {
    if (date) {
      setSelectedDate(format(date, 'yyyy-MM-dd'));
    } else {
      setSelectedDate('');
    }
  };

  // State for preview report
  const [previewRecords, setPreviewRecords] = useState(null);

  // Processed records matching current filters
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const matchProject = !selectedProject || normId(r.project_id) === normId(selectedProject);
      const matchPlan = !selectedPlan || normId(r.plan_id) === normId(selectedPlan);
      
      const rDateFull = String(r.timeline || '');
      // Match both YYYY-MM-DD and DD/MM/YYYY formats
      const matchDate = !selectedDate || 
        rDateFull.includes(selectedDate) || 
        rDateFull.includes(format(parseISO(selectedDate), 'dd/MM/yyyy'));
        
      return matchProject && matchPlan && matchDate;
    });
  }, [records, selectedProject, selectedPlan, selectedDate]);

  // Available pins for the current project/plan (ignoring date, used for generation check)
  const availablePins = useMemo(() => {
    if (!masterData || masterData.length === 0) return [];
    return masterData.filter(m => {
      const matchProject = !selectedProject || normId(m.project_id) === normId(selectedProject);
      const matchPlan = !selectedPlan || normId(m.plan_id) === normId(selectedPlan);
      return matchProject && matchPlan;
    });
  }, [masterData, selectedProject, selectedPlan]);

  // Ref to track if we're in the middle of processing (to prevent useEffect from clearing preview)
  const processingRef = useRef(false);

  // Clear preview when filters change - but NOT while processing
  useEffect(() => {
    if (!processingRef.current) {
      setPreviewRecords(null);
    }
  }, [selectedProject, selectedPlan, selectedDate]);

  // Handle generating preview (Trigger Webhook -> Process Jobs Individually -> Refresh)
  const handleGeneratePreview = async () => {
    processingRef.current = true;
    setProcessing(true);
    setProgress({ current: 0, total: 0, status: 'Calling n8n...' });
    setError(null);
    setPreviewRecords(null);
    
    // Validate required filters
    if (!selectedProject || !selectedPlan || !selectedDate) {
      setError('กรุณาเลือก Project, Plan และ Date ให้ครบก่อนกด Generate');
      setProcessing(false);
      processingRef.current = false;
      return;
    }
    
    // Save current filters to use for matching later
    const savedProject = selectedProject;
    const savedPlan = selectedPlan;
    const savedDate = selectedDate;
    
    try {
      // 1. Fetch Job List from n8n (via local proxy)
      const fetchResponse = await fetch('/api/fetch-n8n-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: savedProject,
          plan_id: savedPlan,
          date: savedDate
        })
      });

      if (!fetchResponse.ok) {
        const errData = await fetchResponse.json();
        throw new Error(errData.error || 'Failed to fetch jobs from automation');
      }
      
      const { jobs } = await fetchResponse.json();
      if (!jobs || jobs.length === 0) {
        throw new Error('No records found in automation database for these filters');
      }

      console.log(`n8n returned ${jobs.length} jobs. Sample:`, jobs[0]);

      // Check if jobs have a different date than requested
      const jobDates = [...new Set(jobs.map(j => {
        const match = String(j.timeline || '').match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : '';
      }))].filter(Boolean);

      if (jobDates.length > 0 && !jobDates.includes(savedDate)) {
        console.warn(`n8n returned data for ${jobDates[0]}, but requested ${savedDate}. Updating selection.`);
        setSelectedDate(jobDates[0]);
      }

      setProgress({ current: 0, total: jobs.length, status: `Found ${jobs.length} pins. Starting extraction...` });

      // 2. Loop through jobs and process each individually
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const pinLabel = job.pin || job.pin_id || (i + 1);
        
        setProgress(prev => ({ ...prev, status: `Processing Pin: ${pinLabel} (${i + 1}/${jobs.length})` }));

        const res = await fetch('/api/process-single-job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(job)
        });

        if (!res.ok) {
          console.error(`Failed to process job ${i}:`, await res.text());
          // We continue with other jobs even if one fails
        }

        setProgress(prev => ({ ...prev, current: i + 1 }));
      }

      setProgress(prev => ({ ...prev, status: 'Finalizing report...' }));

      // 3. Fetch fresh records from Google Sheet
      const res = await fetch('/api/records');
      const data = await res.json();
      
      if (data.success) {
        console.log("Fetched records from Google Sheets:", data.data);
        setRecords(data.data);
        console.log(`Total records from sheet: ${data.data.length}`);
        if (data.data.length > 0) {
          console.log("Last 3 records from sheet:", data.data.slice(-3));
        }

        const lastIdx = data.data.length - 1;
        const freshFiltered = data.data.filter((r, idx) => {
          const rProjId = normId(r.project_id);
          const sProjId = normId(savedProject);
          const rPlanId = normId(r.plan_id);
          const sPlanId = normId(savedPlan);
          
          const matchProjId = !savedProject || rProjId === sProjId;
          const matchPlanId = !savedPlan || rPlanId === sPlanId;
          
          // Fallback name matching
          const sProjObj = projects.find(o => normId(o.id) === sProjId);
          const sPlanObj = plans.find(o => normId(o.id) === sPlanId);
          const sProjName = (sProjObj?.name || '').trim().toLowerCase();
          const sPlanName = (sPlanObj?.name || '').trim().toLowerCase();
          const rProjName = (r.project || '').trim().toLowerCase();
          const rPlanName = (r.plan || '').trim().toLowerCase();
          
          const matchProjName = sProjName && rProjName && (rProjName.includes(sProjName) || sProjName.includes(rProjName));
          const matchPlanName = sPlanName && rPlanName && (rPlanName.includes(sPlanName) || sPlanName.includes(rPlanName));
          
          const matchProject = matchProjId || matchProjName;
          const matchPlan = matchPlanId || matchPlanName;
          
          const rDateFull = String(r.timeline || '');
          // Use current state date because we might have updated it to match n8n
          const activeDate = jobDates[0] || savedDate;
          const sDateISO = String(activeDate);
          let sDateTH = '';
          try { sDateTH = format(parseISO(activeDate), 'dd/MM/yyyy'); } catch(e) {}
          
          const matchDate = !activeDate || 
            rDateFull.includes(sDateISO) || 
            (sDateTH && rDateFull.includes(sDateTH));
          
          const isMatch = matchProject && matchPlan && matchDate;
          
          // Log for first 5 AND last 5 records
          if (idx < 5 || idx > lastIdx - 5 || isMatch) {
             console.log(`[Row ${idx}] ID:${r.id} | Proj:${rProjId}==${sProjId}(${matchProjId}) "${rProjName}" vs "${sProjName}"(${matchProjName}) | Plan:${rPlanId}==${sPlanId}(${matchPlanId}) "${rPlanName}" vs "${sPlanName}"(${matchPlanName}) | Date:${rDateFull} matching ${sDateISO}|${sDateTH} (${matchDate}) -> Match:${isMatch}`);
          }
          
          return isMatch;
        });
        
        console.log("Freshly filtered records:", freshFiltered.length);
        
        if (freshFiltered.length === 0) {
          console.warn("No records matched after refresh. Filters:", { savedProject, savedPlan, savedDate });
          if (data.data.length > 0) {
            console.log("Sample record from sheet:", data.data[0]);
          }
        }
        setPreviewRecords(freshFiltered);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      console.error(err);
      setError("Workflow Error: " + err.message);
    } finally {
      setProcessing(false);
      processingRef.current = false;
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="app-layout">
      {/* Sidebar - Controls (Hidden when printing) */}
      <aside className="sidebar no-print">
        <div className="sidebar-header">
          <h1>📸 CubeMap</h1>
          <p>Site Reporter</p>
        </div>

        <div className="sidebar-content">
          <div className="form-group">
            <label>Project</label>
            <select className="form-control" value={selectedProject} onChange={e => {
              setSelectedProject(e.target.value);
              setSelectedPlan(''); // Reset plan when project changes
            }}>
              <option value="">All Projects</option>
              {projects.map(p => <option key={p.id} value={str(p.id)}>{str(p.name)}</option>)}
            </select>
          </div>
          
          <div className="form-group">
            <label>Plan</label>
            <select className="form-control" value={selectedPlan} onChange={e => setSelectedPlan(e.target.value)} disabled={!selectedProject && plans.length === 0}>
              <option value="">All Plans</option>
              {plans.map(p => <option key={p.id} value={str(p.id)}>{str(p.name)}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Date {loadingDates && <span style={{fontSize:'11px',color:'#999'}}>⏳</span>}</label>
            <DatePicker
              selected={selectedDate ? parseISO(selectedDate) : null}
              onChange={handleDateChange}
              openToDate={calendarOpenDate}
              dateFormat="dd/MM/yyyy"
              placeholderText={availableDatesSet.size > 0 ? `${availableDatesSet.size} dates available` : 'Select a date'}
              className="form-control"
              isClearable
              renderDayContents={(day, date) => {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                const dateStr = `${y}-${m}-${d}`;
                const hasData = availableDatesSet.has(dateStr);
                return (
                  <div style={{ position: 'relative' }}>
                    {day}
                    {hasData && (
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '0px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          width: '6px',
                          height: '6px',
                          backgroundColor: '#e74c3c',
                          borderRadius: '50%',
                          boxShadow: '0 0 3px rgba(231,76,60,0.6)',
                        }}
                      />
                    )}
                  </div>
                );
              }}
            />
          </div>

          <div className="sidebar-actions">
            <button 
              className={`btn ${processing ? 'btn-loading' : 'btn-secondary'}`} 
              onClick={handleGeneratePreview} 
              disabled={processing || !selectedProject || !selectedPlan || !selectedDate}
              title={!selectedProject || !selectedPlan || !selectedDate ? 'กรุณาเลือก Project, Plan และ Date ให้ครบ' : ''}
            >
              {processing ? (
                <>
                  <div className="spinner-small"></div> Processing...
                </>
              ) : (
                <>🔄 Generate Preview & Extract</>
              )}
            </button>

            <button className="btn btn-primary" onClick={handlePrint} disabled={!previewRecords || previewRecords.length === 0}>
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
              Print Report (A4)
            </button>
          </div>
        </div>
      </aside>

      {/* Main Preview Area */}
      <main className="preview-area">
        {loading && <div className="spinner-container"><div className="spinner"></div></div>}
        
        {error && <div className="empty-state">Error loading data: {error}</div>}

        {/* Empty State / Ready State */}
        {!loading && !error && filteredRecords.length === 0 && !previewRecords && (
          <div className="empty-state">
            {availablePins.length > 0 ? (
              <>
                <h3>Ready to Generate Preview</h3>
                <p>Selected Project, Plan and Date have {availablePins.length} pins available.</p>
                <p style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Click "Generate Preview" to start extraction.</p>
              </>
            ) : (
              <>
                <h3>No records found</h3>
                <p>Please select a different combination of filters or check if pins are configured for this plan.</p>
              </>
            )}
          </div>
        )}

        {!loading && !error && filteredRecords.length > 0 && !previewRecords && (
          <div className="empty-state">
            <h3>Ready to View Report</h3>
            <p>Found {filteredRecords.length} processed pins for this timeline.</p>
            <p style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>Click "Generate Preview" to refresh and view the latest images.</p>
          </div>
        )}

        {/* Previews Result Handling */}
        {previewRecords && previewRecords.length === 0 && (
          <div className="empty-state">
            <h3 style={{ color: '#e74c3c' }}>Generation Complete - No Data Matched</h3>
            <p>The extraction process finished, but no new records matching these criteria were found in the sheet.</p>
            <p style={{ marginTop: '0.8rem', fontSize: '0.8rem', opacity: 0.8 }}>
              Try checking the "Timeline" column in your Google Sheet for formatting issues.
            </p>
          </div>
        )}

        {previewRecords && previewRecords.length > 0 && (() => {
          // Build lookup maps from master data
          const planImageMap = {}; // plan_id -> plan_image_url
          const planNameMap = {};  // plan_id -> plan_name
          const projectNameMap = {}; // project_id -> project_name
          const pinPosMap = {};    // plan_id -> { pos_number -> { pos_x, pos_y } }
          
          masterData.forEach(item => {
            const pid = normId(item.plan_id);
            if (item.plan_image_url) planImageMap[pid] = item.plan_image_url;
            if (item.plan_name) planNameMap[pid] = item.plan_name;
            if (item.project_name) projectNameMap[normId(item.project_id)] = item.project_name;
            if (item.pos_x && item.pos_y && item.pos_number) {
              if (!pinPosMap[pid]) pinPosMap[pid] = {};
              pinPosMap[pid][String(item.pos_number)] = {
                x: parseFloat(item.pos_x),
                y: parseFloat(item.pos_y)
              };
            }
          });

          // Group preview records by plan
          const recordsByPlan = {};
          previewRecords.forEach(record => {
            const planId = String(record.plan_id || 'Unknown');
            if (!recordsByPlan[planId]) recordsByPlan[planId] = [];
            recordsByPlan[planId].push(record);
          });
          // Sort pins numerically within each plan (1, 2, 3... not 1, 10, 11...)
          Object.values(recordsByPlan).forEach(arr => {
            arr.sort((a, b) => {
              const pinA = parseInt(String(a.pin_id || a.pin || '0'), 10) || 0;
              const pinB = parseInt(String(b.pin_id || b.pin || '0'), 10) || 0;
              return pinA - pinB;
            });
          });

          return (
            <div className="report-container">
              {Object.entries(recordsByPlan).map(([planId, planRecords]) => {
                const pages = Array.from({ length: Math.ceil(planRecords.length / 3) });
                const floorPlanUrl = planImageMap[planId];
                const planName = planNameMap[planId] || planId;
                const projName = projectNameMap[String(planRecords[0]?.project_id)] || planRecords[0]?.project_id;
                const pinPositions = pinPosMap[planId] || {};

                return (
                  <div key={`plan-group-${planId}`} className="plan-group">
                    {pages.map((_, pageIndex) => {
                      const pinsForPage = planRecords.slice(pageIndex * 3, (pageIndex + 1) * 3);
                      
                      return (
                        <div key={`page-${planId}-${pageIndex}`} className="a4-page">
                          
                          <ReportHeader 
                            projectName={projName} 
                            planName={planName}
                          />

                          {/* Real Floor Plan with Pin Markers (Dynamic Pixel Mapping) */}
                          <div className="floorplan-scaler no-print">
                            <FloorPlanViewer 
                              floorPlanUrl={floorPlanUrl}
                              planRecords={planRecords}
                              pinsForPage={pinsForPage}
                              pinPositions={pinPositions}
                              planName={planName}
                            />
                          </div>

                          {/* Pin Details */}
                          {pinsForPage.map((record) => {
                            const posNum = String(record.pin_id || record.pin || '');
                            return (
                              <div key={`pin-${posNum}-${record.plan_id}`} className="pin-section">
                                <div className="hierarchy-pin-header">
                                  <h3>📍 Pin: {posNum}</h3>
                                  <span className="pin-date">{String(record.timeline || '').substring(0,10)}</span>
                                </div>
                                
                                <div className="faces-row">
                                  {['front', 'left', 'back', 'right', 'top', 'bottom'].map(face => (
                                    <div key={face} className="face-card">
                                      <div className="face-header">{face} View</div>
                                      <div className="face-image-container">
                                        <img 
                                          src={record[`${face}_url`]} 
                                          alt={`${face} view`} 
                                          className="face-image"
                                          loading="lazy"
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </main>

      <LoadingModal 
        isOpen={processing} 
        message="กำลังประมวลผลรูปภาพ..." 
        progress={progress}
      />
    </div>
  );
}

export default App;

