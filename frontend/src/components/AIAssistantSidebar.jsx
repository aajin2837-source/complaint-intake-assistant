import React, { useState, useRef } from 'react';

const API_BASE = 'http://localhost:8000';
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.eml'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; 
const SIGNAL_FIELDS = ['productName', 'batchNumber', 'complaintType', 'description', 'customerName'];

const isFormFilled = (data) => {
  if (!data) return false;
  return SIGNAL_FIELDS.some((key) => (data[key] || '').toString().trim().length > 0);
};

const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const FILE_ICONS = { '.pdf': '📕', '.docx': '📘', '.txt': '📄', '.eml': '✉️' };
const fileIconFor = (ext) => FILE_ICONS[ext] || '📎';

export default function AIAssistantSidebar({ formData, onExtract }) {
  const [messages, setMessages] = useState([
    { sender: 'ai', text: 'Upload a complaint document or paste text below. I will automatically extract the details and populate the form for you.' }
  ]);
  const [input, setInput] = useState('');
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileInputRef = useRef(null);

  const pushMessage = (text) => {
    setMessages(prev => [...prev, { sender: 'ai', text }]);
  };

  const pushFileMessage = (file) => {
    setMessages(prev => [
      ...prev,
      { sender: 'user', type: 'file', fileName: file.name, fileSize: file.size, ext: getExtension(file.name) }
    ]);
  };

  const callExtractApi = async (text, { isCorrection = false, currentData = null } = {}) => {
    const body = { text };
    if (isCorrection && currentData) {
      body.mode = 'correction';
      body.current_data = currentData;
    }

    const response = await fetch(`${API_BASE}/api/extract-complaint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = await response.json();

    if (!response.ok) {
      
      const detail = payload?.detail || `Request failed with status ${response.status}`;
      throw new Error(detail);
    }

    return payload;
  };

  const uploadFileForExtraction = (file, onProgress) => {
    return new Promise((resolve, reject) => {
      const formDataObj = new FormData();
      formDataObj.append('file', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/extract-complaint-file`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          
          onProgress(Math.min(90, Math.round((e.loaded / e.total) * 90)));
        }
      };

      xhr.onload = () => {
        let payload;
        try {
          payload = JSON.parse(xhr.responseText);
        } catch {
          reject(new Error('Server returned an invalid response.'));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          resolve(payload);
        } else {
          reject(new Error(payload?.detail || `Request failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error while uploading the file.'));
      xhr.send(formDataObj);
    });
  };

  const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
      reader.readAsText(file);
    });
  };

  
  const getExtension = (name) => {
    const idx = name.lastIndexOf('.');
    return idx === -1 ? '' : name.slice(idx).toLowerCase();
  };

  const handleFile = async (file) => {
    if (!file) return;

    const ext = getExtension(file.name);

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      pushMessage(`"${file.name}" isn't a supported file type. Please upload a PDF, DOCX, TXT, or EML file.`);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      pushMessage(`"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)}MB, which is over the 10MB limit.`);
      return;
    }

    setFileName(file.name);
    setProgress(1);
    pushFileMessage(file);
    pushMessage(`Reading "${file.name}"...`);

    try {
      let extractedData;
      if (ext === '.txt' || ext === '.eml') {
       
        setProgress(35);
        const text = await readFileAsText(file);
        setProgress(70);
        extractedData = await callExtractApi(text);
        setProgress(100);
      } else {
        
        extractedData = await uploadFileForExtraction(file, setProgress);
      }

      console.log('Extracted Data Received:', extractedData);

      if (onExtract) onExtract(extractedData);

      pushMessage(`Successfully extracted complaint data from "${file.name}" and auto-filled your form fields!`);
    } catch (err) {
      console.error(err);
      pushMessage(`Extraction failed: ${err.message}`);
    } finally {
      setTimeout(() => {
        setProgress(0);
        setFileName(null);
      }, 1200);
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];
    handleFile(file);
    e.target.value = ''; 
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handlePasteSubmit = async (e) => {
    e.preventDefault();
    if (!pasteText.trim()) return;

    const text = pasteText;
    setPasteText('');
    setShowPasteBox(false);
    setMessages(prev => [...prev, { sender: 'user', text: text.length > 200 ? `${text.slice(0, 200)}…` : text }]);

    try {
      setProgress(50);
     
      const extractedData = await callExtractApi(text);
      setProgress(100);
      if (onExtract) onExtract(extractedData);
      pushMessage('Successfully extracted complaint data and auto-filled your form fields!');
    } catch (err) {
      console.error(err);
      pushMessage(`Extraction failed: ${err.message}`);
    } finally {
      setTimeout(() => setProgress(0), 1200);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userText = input;
    const newMessages = [...messages, { sender: 'user', text: userText }];
    setMessages(newMessages);
    setInput('');
    const isCorrection = isFormFilled(formData);

    try {
      const extractedData = await callExtractApi(userText, { isCorrection, currentData: formData });

      console.log('Extracted Data Received:', extractedData);

      if (onExtract) {
        onExtract(extractedData);
      }

      setMessages([
        ...newMessages,
        {
          sender: 'ai',
          text: isCorrection
            ? 'Got it — updated the relevant field(s) without touching the rest of the form.'
            : 'Successfully extracted complaint data and auto-filled your form fields!'
        }
      ]);
    } catch (err) {
      console.error(err);
      setMessages([
        ...newMessages,
        { sender: 'ai', text: `Extraction failed: ${err.message}` }
      ]);
    }
  };

  return (
    <div className="w-96 bg-white border-l border-gray-200 flex flex-col h-screen p-4 shadow-sm sticky top-0">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2 text-xs">✨ AI Complaint Intake Assistant</h3>
        <span className="text-[10px] bg-blue-50 text-blue-600 font-semibold px-2 py-0.5 rounded border border-blue-200">BETA</span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={ALLOWED_EXTENSIONS.join(',')}
        onChange={handleFileInputChange}
      />

      <div
        onClick={handleBrowseClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer mb-3 transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 bg-gray-50/50'
        }`}
      >
        <p className="text-xs text-gray-600 mb-1">
          📁 {isDragging ? 'Drop the file to upload' : (
            <>Drag & drop complaint document here or <span className="text-blue-600 font-medium">click to browse</span></>
          )}
        </p>
        {fileName && <p className="text-[10px] text-gray-400 mt-1 truncate">{fileName}</p>}
      </div>

      <div className="text-center mb-3">
        <span className="text-xs text-gray-400">OR</span>
      </div>

      <button
        type="button"
        onClick={() => setShowPasteBox(prev => !prev)}
        className="w-full border border-gray-300 text-gray-700 py-2 rounded-md text-xs font-medium hover:bg-gray-50 mb-3 flex items-center justify-center gap-2"
      >
        📄 {showPasteBox ? 'Cancel Paste' : 'Paste Complaint Text / Email'}
      </button>

      {showPasteBox && (
        <form onSubmit={handlePasteSubmit} className="mb-3">
          <textarea
            className="w-full border border-gray-300 rounded-md p-2 text-xs h-24 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Paste the complaint email or document text here..."
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            autoFocus
          />
          <button
            type="submit"
            disabled={!pasteText.trim()}
            className="mt-2 w-full bg-blue-600 text-white text-xs font-medium py-1.5 rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Extract Details
          </button>
        </form>
      )}

      <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] p-2 rounded-md mb-4">
        ✓ Supported formats: PDF, DOCX, TXT, EML<br/>Max file size: 10MB
      </div>

      {progress > 0 && (
        <div className="mb-4 bg-gray-50 p-3 rounded-md border border-gray-100">
          <div className="flex justify-between text-xs text-gray-600 mb-1">
            <span>EXTRACTION PROGRESS</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
            <div className="bg-blue-600 h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">Analyzing document content and extracting key details...</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-1">
        <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">AI ASSISTANT</h4>
        {messages.map((msg, index) => {
          if (msg.type === 'file') {
            return (
              <div key={index} className="ml-auto max-w-[85%] bg-gray-100 border border-gray-200 rounded-lg p-2.5 flex items-center gap-2">
                <span className="text-lg leading-none shrink-0">{fileIconFor(msg.ext)}</span>
                <div className="min-w-0">
                  <p className="text-xs text-gray-900 font-medium truncate">{msg.fileName}</p>
                  <p className="text-[10px] text-gray-500">{formatFileSize(msg.fileSize)}</p>
                </div>
              </div>
            );
          }
          return (
            <div key={index} className={`p-3 rounded-lg text-xs ${msg.sender === 'ai' ? 'bg-blue-50 text-blue-900 border border-blue-100' : 'bg-gray-100 text-gray-900 self-end'}`}>
              {msg.text}
            </div>
          );
        })}
      </div>

      <form onSubmit={handleSend} className="relative mt-auto">
        <input
          type="text"
          className="w-full border border-gray-300 rounded-md py-2 pl-3 pr-10 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Ask me anything about this complaint..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="absolute right-2 top-2 text-blue-600 hover:text-blue-800">
          ➤
        </button>
      </form>
      <p className="text-[9px] text-gray-400 text-center mt-2">AI responses may contain errors. Please verify information.</p>
    </div>
  );
}