import React, { useState, useEffect, useMemo } from 'react';
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

function App() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });

  // Fetch data
  const fetchRecords = () => {
    setLoading(true);
    fetch('http://localhost:8088/api/records')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setRecords(data.data);
        } else {
          setError(data.error);
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  // Helper str
  const str = (v) => String(v);

  // Compute available filter options based on data
  const projects = useMemo(() => [...new Set(records.map(r => r.project_id))].filter(Boolean), [records]);
  const plans = useMemo(() => {
    return [...new Set(records.filter(r => !selectedProject || str(r.project_id) === selectedProject).map(r => r.plan_id))].filter(Boolean);
  }, [records, selectedProject]);
  const dates = useMemo(() => {
    return [...new Set(records.map(r => {
      // Extract YYYY-MM-DD from '2024-05-14 00:00:00.000'
      const match = String(r.timeline).match(/^(\d{4}-\d{2}-\d{2})/);
      return match ? match[1] : '';
    }))].filter(Boolean);
  }, [records]);

  // State for preview
  const [previewRecords, setPreviewRecords] = useState(null);

  // Derived filtered records grouped by Pin
  const filteredRecords = useMemo(() => {
    console.log("Filtering with:", { selectedProject, selectedPlan, selectedDate });
    const result = records.filter(r => {
      const matchProject = selectedProject 
        ? String(r.project_id || '').trim() === String(selectedProject).trim() 
        : true;
      const matchPlan = selectedPlan 
        ? String(r.plan_id || '').trim() === String(selectedPlan).trim() 
        : true;
      
      const rDateFull = String(r.timeline || '');
      const matchDate = selectedDate 
        ? rDateFull.includes(String(selectedDate))
        : true;
      
      return matchProject && matchPlan && matchDate;
    });
    console.log("Filtered count:", result.length);
    return result;
  }, [records, selectedProject, selectedPlan, selectedDate]);

  // Clear preview when filters change
  useEffect(() => {
    setPreviewRecords(null);
  }, [selectedProject, selectedPlan, selectedDate]);

  // Handle generating preview (Trigger Webhook -> Process Jobs Individually -> Refresh)
  const handleGeneratePreview = async () => {
    setProcessing(true);
    setProgress({ current: 0, total: 0, status: 'Calling n8n...' });
    setError(null);
    setPreviewRecords(null);
    
    try {
      // 1. Fetch Job List from n8n (via local proxy)
      const fetchResponse = await fetch('http://localhost:8088/api/fetch-n8n-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: selectedProject,
          plan_id: selectedPlan,
          date: selectedDate
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

      setProgress({ current: 0, total: jobs.length, status: `Found ${jobs.length} pins. Starting extraction...` });

      // 2. Loop through jobs and process each individually
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const pinLabel = job.pin || job.pin_id || (i + 1);
        
        setProgress(prev => ({ ...prev, status: `Processing Pin: ${pinLabel} (${i + 1}/${jobs.length})` }));

        const res = await fetch('http://localhost:8088/api/process-single-job', {
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
      const res = await fetch('http://localhost:8088/api/records');
      const data = await res.json();
      
      if (data.success) {
        console.log("Fetched records from Google Sheets:", data.data);
        setRecords(data.data);
        const freshFiltered = data.data.filter(r => {
          const rProj = String(r.project_id || '').trim();
          const sProj = String(selectedProject).trim();
          const matchProject = selectedProject ? rProj === sProj : true;
          
          const rPlan = String(r.plan_id || '').trim();
          const sPlan = String(selectedPlan).trim();
          const matchPlan = selectedPlan ? rPlan === sPlan : true;
          
          const rDateFull = String(r.timeline || '');
          const matchDate = selectedDate ? rDateFull.includes(String(selectedDate)) : true;
          
          if (!matchProject || !matchPlan || !matchDate) {
             // Optional: log specific mismatches if needed for first few rows
          }
          
          return matchProject && matchPlan && matchDate;
        });
        
        console.log("Freshly filtered records:", freshFiltered);
        
        if (freshFiltered.length === 0) {
          console.warn("No records matched after refresh. Filters:", { selectedProject, selectedPlan, selectedDate });
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
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="app">
      {/* Header & Controls (Hidden when printing) */}
      <header className="header">
        <h1>📸 CubeMap Site Reporter</h1>
        <div className="controls">
          <div className="form-group">
            <label>Project</label>
            <select className="form-control" value={selectedProject} onChange={e => setSelectedProject(e.target.value)}>
              <option value="">All Projects</option>
              {projects.map(p => <option key={p} value={str(p)}>{str(p)}</option>)}
            </select>
          </div>
          
          <div className="form-group">
            <label>Plan</label>
            <select className="form-control" value={selectedPlan} onChange={e => setSelectedPlan(e.target.value)} disabled={!selectedProject && plans.length === 0}>
              <option value="">All Plans</option>
              {plans.map(p => <option key={p} value={str(p)}>{str(p)}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Date</label>
            <input 
              type="date" 
              className="form-control" 
              value={selectedDate} 
              onChange={e => setSelectedDate(e.target.value)}
            />
          </div>

          <button 
            className={`btn ${processing ? 'btn-loading' : 'btn-secondary'}`} 
            onClick={handleGeneratePreview} 
            disabled={processing || (filteredRecords.length === 0 && !selectedDate)}
          >
            {processing ? (
              <>
                <div className="spinner-small"></div> Processing...
              </>
            ) : (
              <>🔄 Generate Preview & Extract</>
            )}
          </button>

          <button className="btn" onClick={handlePrint} disabled={!previewRecords || previewRecords.length === 0}>
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
            Print Report (A4)
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container">
        {loading && <div className="spinner"></div>}
        
        {error && <div className="empty-state">Error loading data: {error}</div>}

        {!loading && !error && filteredRecords.length === 0 && (
          <div className="empty-state">
            <h3>No records found</h3>
            <p>Please select a different combination of filters.</p>
          </div>
        )}

        {!loading && !error && filteredRecords.length > 0 && !previewRecords && (
          <div className="empty-state">
            <h3>Ready to Generate Preview</h3>
            <p>Click "Generate Preview" to load {filteredRecords.length} pins for printing.</p>
          </div>
        )}

        {previewRecords && previewRecords.length > 0 && (
          <div className="report-container">
            {/* Provide context for the report */}
            <div className="report-header no-print">
              <h2>Previewing Report</h2>
              <div className="report-meta">
                {selectedProject && <span>Project: {selectedProject} | </span>}
                {selectedPlan && <span>Plan: {selectedPlan} | </span>}
                {selectedDate && <span>Date: {selectedDate} | </span>}
                <span>Showing {previewRecords.length} Pins</span>
              </div>
            </div>

            {/* Group records by Plan */}
            {(() => {
              // 1. Group the preview data by Plan
              const recordsByPlan = {};
              previewRecords.forEach(record => {
                const planId = record.plan_id || 'Unknown Plan';
                if (!recordsByPlan[planId]) {
                  recordsByPlan[planId] = [];
                }
                recordsByPlan[planId].push(record);
              });

              // 2. Render each Plan group
              return Object.entries(recordsByPlan).map(([planId, planRecords]) => {
                // Chunk records into groups of 3 for each A4 Page within this Plan
                const pages = Array.from({ length: Math.ceil(planRecords.length / 3) });
                const firstRecord = planRecords[0];

                return (
                  <div key={`plan-group-${planId}`} className="plan-group">
                    {pages.map((_, pageIndex) => {
                      const pinsForPage = planRecords.slice(pageIndex * 3, (pageIndex + 1) * 3);
                      
                      return (
                        <div key={`page-${planId}-${pageIndex}`} className="a4-page">
                          
                          {/* Plan Hierarchy Headline */}
                          <div className="hierarchy-plan-header">
                            <div className="hierarchy-plan-title">
                              <h2>Plan: {planId}</h2>
                              <span>Project: {firstRecord.project_id}</span>
                            </div>
                            <div className="hierarchy-plan-meta">
                              Page {pageIndex + 1} of {pages.length}
                            </div>
                          </div>

                          {/* Mock Floor Plan with Pins */}
                          <div className="mock-floorplan-section">
                            <div className="floorplan-container">
                              <img 
                                src="https://images.unsplash.com/photo-1598928506311-c55ded91a20c?auto=format&fit=crop&q=80&w=1200&h=600" 
                                alt="Floor Plan Mockup" 
                                className="floorplan-image" 
                              />
                              {/* Overlay Pins for this specific page */}
                              {pinsForPage.map((record, idx) => {
                                // Generate a deterministic "random" mock position based on the pin_id string length or char code so it mostly stays the same for a pin
                                const seed = String(record.pin_id).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                                const topPos = 20 + ((seed * 17) % 60); // between 20% and 80%
                                const leftPos = 20 + ((seed * 23) % 60); // between 20% and 80%
                                
                                return (
                                  <div 
                                    key={`marker-${record.pin_id}`} 
                                    className="floorplan-marker"
                                    style={{ top: `${topPos}%`, left: `${leftPos}%` }}
                                    title={`Pin: ${record.pin_id}`}
                                  >
                                    <span className="marker-icon">📍</span>
                                    <span className="marker-label">{record.pin_id}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Render Details for each Pin */}
                          {pinsForPage.map((record, pinIndex) => (
                            <div key={record.id || `${record.project_id}-${record.plan_id}-${record.pin_id}`} className="pin-section">
                              
                              {/* Pin Hierarchy Headline */}
                              <div className="hierarchy-pin-header">
                                <h3>📍 Pin: {record.pin_id}</h3>
                                <span className="pin-date">{record.timeline.substring(0,10)}</span>
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
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
        )}
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
