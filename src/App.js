import React, { useState } from 'react';
import './App.css';
import PdfUploader from './components/PdfUploader';

function App() {
  const [notifications, setNotifications] = useState([]);

  const addNotification = (message, type = 'info') => {
    const id = Date.now();
    const notification = { id, message, type };
    setNotifications(prev => [...prev, notification]);

    // Auto remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleFilesSelected = (files) => {
    addNotification(`Selected ${files.length} PDF file(s) for upload`, 'info');
  };

  const handleUploadComplete = (files) => {
    addNotification(`Successfully uploaded and processed ${files.length} PDF file(s)!`, 'success');
  };

  const handleError = (errors) => {
    errors.forEach(error => {
      addNotification(`${error.file}: ${error.error}`, 'error');
    });
  };

  return (
    <div>
      <main className="main-content">
        <PdfUploader
          maxFileSize={50 * 1024 * 1024} // 50MB
          multiple={false}
          onFilesSelected={handleFilesSelected}
          onUploadComplete={handleUploadComplete}
          onError={handleError}
        />
      </main>
    </div>
  );
}

export default App;
