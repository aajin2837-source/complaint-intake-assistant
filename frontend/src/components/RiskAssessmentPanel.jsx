import React, { useRef, useState, useCallback, useEffect } from 'react';

function SlideToConfirm({ label, confirmedLabel, onConfirm, disabled }) {
  const trackRef = useRef(null);
  const dragXRef = useRef(0); // source of truth, avoids stale-closure bugs
  const [dragX, setDragX] = useState(0); // mirrors dragXRef, just for rendering
  const [dragging, setDragging] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const THUMB_SIZE = 44;
  const CONFIRM_THRESHOLD = 0.7;

  const getMax = () => {
    const track = trackRef.current;
    if (!track) return 1;
    return Math.max(track.getBoundingClientRect().width - THUMB_SIZE, 1);
  };

  const applyPosition = (clientX) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const max = getMax();
    const raw = clientX - rect.left - THUMB_SIZE / 2;
    const clamped = Math.min(Math.max(raw, 0), max);
    dragXRef.current = clamped;
    setDragX(clamped);
  };

  const finishDrag = useCallback(() => {
    const max = getMax();
    const ratio = dragXRef.current / max;
    console.log('[SlideToConfirm] released at ratio', ratio.toFixed(2), 'threshold', CONFIRM_THRESHOLD);

    window.removeEventListener('mousemove', handleMove);
    window.removeEventListener('mouseup', finishDrag);
    window.removeEventListener('touchmove', handleMove);
    window.removeEventListener('touchend', finishDrag);

    setDragging(false);

    if (ratio >= CONFIRM_THRESHOLD) {
      dragXRef.current = max;
      setDragX(max);
      setConfirmed(true);
      onConfirm && onConfirm();
    } else {
      dragXRef.current = 0;
      setDragX(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onConfirm]);

  const handleMove = useCallback((e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    applyPosition(clientX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDrag = (e) => {
    if (disabled || confirmed) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    setDragging(true);
    // Register the initial press position immediately — this is what makes
    // a plain click near the end of the track work, not just a drag.
    applyPosition(clientX);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', finishDrag);
    window.addEventListener('touchmove', handleMove, { passive: true });
    window.addEventListener('touchend', finishDrag);
  };

  // Clean up listeners if the component unmounts mid-drag
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', finishDrag);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', finishDrag);
    };
  }, [handleMove, finishDrag]);

  const maxDrag = getMax();
  const fillPercent = Math.min((dragX / maxDrag) * 100, 100);

  return (
    <div
      ref={trackRef}
      onMouseDown={startDrag}
      onTouchStart={startDrag}
      className={`relative w-full h-12 rounded-full overflow-hidden select-none ${
        confirmed ? 'bg-emerald-600' : 'bg-indigo-950'
      } ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
    >
      <div
        className="absolute inset-y-0 left-0 bg-indigo-600/40 transition-[width]"
        style={{ width: `${fillPercent}%`, transitionDuration: dragging ? '0ms' : '200ms' }}
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-white text-sm font-semibold tracking-wide">
          {confirmed ? confirmedLabel : label}
        </span>
      </div>
      <div
        className={`absolute top-1 left-1 h-10 w-10 rounded-full bg-white shadow-md flex items-center justify-center text-indigo-700 pointer-events-none ${
          disabled || confirmed ? '' : 'cursor-grab'
        }`}
        style={{
          transform: `translateX(${confirmed ? maxDrag : dragX}px)`,
          transition: dragging ? 'none' : 'transform 200ms',
        }}
      >
        {confirmed ? '✓' : '→'}
      </div>
    </div>
  );
}

const SEVERITY_STYLES = {
  Minor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Major: 'bg-amber-50 text-amber-700 border-amber-200',
  Critical: 'bg-red-50 text-red-700 border-red-200',
};

export default function RiskAssessmentPanel({ formData, setFormData, complaintId, onCommitted, onSaved }) {
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleFieldChange = (field) => (e) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleCommit = async () => {
    setCommitting(true);
    setError('');
    setSuccessMessage('');
    try {
      let idToCommit = complaintId;

      // Not saved yet — save it first so the commit button works
      // standalone, without forcing the user back to "Save Complaint".
      if (!idToCommit) {
        console.log('[RiskAssessmentPanel] No complaintId yet, auto-saving first...');
        const saveResponse = await fetch('http://localhost:8000/api/complaints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        if (!saveResponse.ok) {
          const payload = await saveResponse.json().catch(() => ({}));
          throw new Error(payload?.detail || `Save failed with status ${saveResponse.status}`);
        }
        const saved = await saveResponse.json();
        console.log('[RiskAssessmentPanel] Auto-save succeeded:', saved);
        idToCommit = saved.id;
        onSaved && onSaved(saved);
      }

      console.log('[RiskAssessmentPanel] Committing complaint', idToCommit);
      const response = await fetch(
        `http://localhost:8000/api/complaints/${idToCommit}/commit`,
        { method: 'POST' }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.detail || `Request failed with status ${response.status}`);
      }
      const updated = await response.json();
      console.log('[RiskAssessmentPanel] Commit succeeded:', updated);
      onCommitted && onCommitted(updated);
      setSuccessMessage(`Complaint #${updated.id} committed to the QMS ledger.`);
    } catch (err) {
      console.error('[RiskAssessmentPanel] Commit failed:', err);
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  };

  const severity = formData.suggestedSeverity || 'Major';
  const severityClass = SEVERITY_STYLES[severity] || SEVERITY_STYLES.Major;

  return (
    <div className="max-w-4xl mx-auto mt-6">
      <div className="mb-4">
        <label className="block text-xs font-semibold text-gray-700 mb-1">Complaint Category</label>
        <input
          type="text"
          value={formData.complaintCategory || ''}
          onChange={handleFieldChange('complaintCategory')}
          placeholder="e.g. Product Defect - Discoloration"
          className="w-full border rounded-lg p-3 text-sm"
        />
      </div>

      <div className="mb-6">
        <label className="block text-xs font-semibold text-gray-700 mb-1">Complaint Description</label>
        <textarea
          rows="3"
          value={formData.description || ''}
          onChange={handleFieldChange('description')}
          className="w-full border rounded-lg p-3 text-sm"
        />
      </div>

      <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <span className="text-indigo-600">🛡️</span>
          <h3 className="text-sm font-bold text-indigo-900">AI copilot risk assessment</h3>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-indigo-700 mb-1">Severity (Suggested)</label>
            <span className={`inline-block text-sm font-medium px-3 py-2 rounded-md border w-full ${severityClass}`}>
              {severity}
            </span>
          </div>
          <div>
            <label className="block text-xs font-semibold text-indigo-700 mb-1">Suggested Next Action</label>
            <input
              type="text"
              value={formData.suggestedNextAction || ''}
              onChange={handleFieldChange('suggestedNextAction')}
              className="w-full border rounded-md p-2 text-sm bg-white"
            />
          </div>
        </div>

        <div className="mb-2">
          <label className="block text-xs font-semibold text-indigo-700 mb-1">Initial Risk Assessment</label>
          <textarea
            rows="2"
            value={formData.initialRiskAssessment || ''}
            onChange={handleFieldChange('initialRiskAssessment')}
            className="w-full border rounded-md p-2 text-sm bg-white"
          />
        </div>
      </div>

      <div className="mt-6">
        <SlideToConfirm
          label="Commit to QMS Ledger"
          confirmedLabel="Committed to QMS Ledger ✓"
          onConfirm={handleCommit}
          disabled={committing}
        />
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        {successMessage && !error && (
          <p className="text-xs text-emerald-700 font-medium mt-2">✓ {successMessage}</p>
        )}
        {!complaintId && !error && !successMessage && (
          <p className="text-xs text-gray-500 mt-2">
            Sliding will save this complaint and commit it to the QMS ledger in one step.
          </p>
        )}
      </div>
    </div>
  );
}