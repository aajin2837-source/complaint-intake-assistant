import React, { useState } from 'react';
import ComplaintForm from './components/ComplaintForm';
import AIAssistantSidebar from './components/AIAssistantSidebar';

export default function App() {
  const [formData, setFormData] = useState({
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
  });

  // Bumped every time a new complaint's data is loaded into the form —
  // either by AI extraction or by the "Reset Form" button. ComplaintForm
  // watches this to clear the saved/committed status of a *previous*
  // complaint that might still be lingering in its UI.
  const [formVersion, setFormVersion] = useState(0);

  const handleExtract = (responsePayload) => {
    if (!responsePayload) return;

    // Handle case where backend wraps data in an object like { data: { ... } } or { result: { ... } }
    const extracted = responsePayload.data || responsePayload.result || responsePayload;

    setFormData(prev => ({
      ...prev,
      complaintSource: extracted.complaintSource || extracted.complaint_source || extracted.source || prev.complaintSource,
      customerName: extracted.customerName || extracted.customer_name || extracted.customer || prev.customerName,
      productName: extracted.productName || extracted.product_name || extracted.product || prev.productName,
      productStrength: extracted.productStrength || extracted.product_strength || extracted.strength || prev.productStrength,
      batchNumber: extracted.batchNumber || extracted.batch_number || extracted.batch || prev.batchNumber,
      manufacturingDate: extracted.manufacturingDate || extracted.manufacturing_date || prev.manufacturingDate,
      expiryDate: extracted.expiryDate || extracted.expiry_date || prev.expiryDate,
      quantityAffected: extracted.quantityAffected || extracted.quantity_affected || extracted.quantity || prev.quantityAffected,
      complaintType: extracted.complaintType || extracted.complaint_type || prev.complaintType,
      complaintDate: extracted.complaintDate || extracted.complaint_date || prev.complaintDate,
      description: extracted.description || extracted.complaint_description || extracted.text || prev.description,
      initialSeverity: extracted.initialSeverity || extracted.initial_severity || prev.initialSeverity,
      priority: extracted.priority || prev.priority,
      complaintCategory: extracted.complaintCategory || extracted.complaint_category || prev.complaintCategory,
      suggestedSeverity: extracted.suggestedSeverity || extracted.suggested_severity || prev.suggestedSeverity,
      suggestedNextAction: extracted.suggestedNextAction || extracted.suggested_next_action || prev.suggestedNextAction,
      initialRiskAssessment: extracted.initialRiskAssessment || extracted.initial_risk_assessment || prev.initialRiskAssessment,
    }));

    // New complaint data just landed — clear any leftover "saved" /
    // "committed" status from whatever was in the form before.
    setFormVersion(v => v + 1);
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden font-sans">
      <div className="flex-1 overflow-y-auto p-6">
        <ComplaintForm formData={formData} setFormData={setFormData} formVersion={formVersion} bumpFormVersion={() => setFormVersion(v => v + 1)} />
      </div>
      {/* formData is passed down so the AI assistant always has the real,
          current record (including any manual edits) to send as
          correction context — not a stale shadow copy of its own. */}
      <AIAssistantSidebar formData={formData} onExtract={handleExtract} />
    </div>
  );
}