
import React, { useState } from 'react';
import RiskAssessmentPanel from './RiskAssessmentPanel';

const emptyForm = {
  complaintSource: '',
  customerName: '',
  productName: '',
  productStrength: '',
  batchNumber: '',
  manufacturingDate: '',
  expiryDate: '',
  quantityAffected: '',
  complaintType: '',
  complaintDate: '',
  description: '',
  initialSeverity: 'Medium',
  priority: 'Medium',
  complaintCategory: '',
  suggestedSeverity: '',
  suggestedNextAction: '',
  initialRiskAssessment: '',
};

export default function ComplaintForm({ formData, setFormData, formVersion, bumpFormVersion }) {
  const [savedComplaintId, setSavedComplaintId] = useState(null);
  const [status, setStatus] = useState('Pending Triage');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleReset = () => {
    setFormData(emptyForm);
    setSavedComplaintId(null);
    setStatus('Pending Triage');
    bumpFormVersion();
  };
  React.useEffect(() => {
    setSavedComplaintId(null);
    setStatus('Pending Triage');
  }, [formVersion]);

  const handleSaveComplaint = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('https://complaint-intake-assistant.onrender.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.detail || `Request failed with status ${response.status}`);
      }
      const result = await response.json();
      setSavedComplaintId(result.id);
      setStatus(result.status || 'Pending Triage');
      alert(`Complaint #${result.id} successfully saved and triaged!`);
    } catch (err) {
      console.error("Failed to save complaint:", err);
      alert(`Failed to save complaint: ${err.message}`);
    }
  };

  const handleCommitted = (updated) => {
    setStatus(updated.status);
    setSavedComplaintId(updated.id);
  };

  const handleAutoSaved = (saved) => {
    setSavedComplaintId(saved.id);
    setStatus(saved.status || 'Pending Triage');
  };

  return (
    <div className="max-w-4xl mx-auto bg-white p-8 rounded-lg shadow-sm border border-gray-200">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Log Customer Complaint</h2>
          <p className="text-xs text-gray-500">API & FDF Quality Assurance Module</p>
        </div>
        <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
          status === 'Committed to QMS Ledger'
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-amber-100 text-amber-800'
        }`}>
          {status}
        </span>
      </div>

      <form onSubmit={handleSaveComplaint} className="space-y-4 text-xs">
        <div>
          <h3 className="font-semibold text-gray-700 mb-2 border-b pb-1">1. ORIGIN & CUSTOMER DETAILS</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-600 mb-1">Complaint Source</label>
              <input type="text" name="complaintSource" value={formData.complaintSource} onChange={handleChange} placeholder="e.g. Apollo Pharmacy" className="w-full border rounded p-2" />
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Customer Name</label>
              <input type="text" name="customerName" value={formData.customerName} onChange={handleChange} placeholder="e.g. Apex Pharma Logistics" className="w-full border rounded p-2" />
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-gray-700 mb-2 border-b pb-1">2. PRODUCT & BATCH IDENTIFICATION</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-600 mb-1">Product Name</label>
              <input type="text" name="productName" value={formData.productName} onChange={handleChange} placeholder="e.g. Pantoprazole Tablets" className="w-full border rounded p-2" />
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Product Strength/Grade</label>
              <input type="text" name="productStrength" value={formData.productStrength} onChange={handleChange} placeholder="e.g. 40mg" className="w-full border rounded p-2" />
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Batch/Lot Number</label>
              <input type="text" name="batchNumber" value={formData.batchNumber} onChange={handleChange} placeholder="e.g. PAN-2026-X91" className="w-full border rounded p-2" />
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Manufacturing Date</label>
              <input type="date" name="manufacturingDate" value={formData.manufacturingDate} onChange={handleChange} className="w-full border rounded p-2" />
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Expiry Date</label>
              <input type="date" name="expiryDate" value={formData.expiryDate} onChange={handleChange} className="w-full border rounded p-2" />
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Quantity Affected</label>
              <input type="text" name="quantityAffected" value={formData.quantityAffected} onChange={handleChange} placeholder="e.g. 150 boxes" className="w-full border rounded p-2" />
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-gray-700 mb-2 border-b pb-1">3. COMPLAINT DETAILS</h3>
          <div className="grid grid-cols-2 gap-4 mb-2">
            <div>
              <label className="block text-gray-600 mb-1">Complaint Type</label>
              <input type="text" name="complaintType" value={formData.complaintType} onChange={handleChange} placeholder="e.g. Damaged Packaging" className="w-full border rounded p-2" />
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Complaint Date</label>
              <input type="date" name="complaintDate" value={formData.complaintDate} onChange={handleChange} className="w-full border rounded p-2" />
            </div>
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Detailed Complaint Description</label>
            <textarea rows="4" name="description" value={formData.description} onChange={handleChange} placeholder="Paste text or let AI extract details here..." className="w-full border rounded p-2" />
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-gray-700 mb-2 border-b pb-1">4. INITIAL ASSESSMENT & PRIORITY</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-600 mb-1">Initial Severity</label>
              <select name="initialSeverity" value={formData.initialSeverity} onChange={handleChange} className="w-full border rounded p-2 bg-white">
                <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Priority</label>
              <select name="priority" value={formData.priority} onChange={handleChange} className="w-full border rounded p-2 bg-white">
                <option>Low</option><option>Medium</option><option>High</option><option>Urgent</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center pt-4 border-t">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded font-semibold hover:bg-gray-50 flex items-center gap-2"
          >
            🔄 Reset Form
          </button>

          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700 flex items-center gap-2"
          >
            💾 Save Complaint
          </button>
        </div>
      </form>

      <RiskAssessmentPanel
        key={formVersion}
        formData={formData}
        setFormData={setFormData}
        complaintId={savedComplaintId}
        onCommitted={handleCommitted}
        onSaved={handleAutoSaved}
      />
    </div>
  );
}