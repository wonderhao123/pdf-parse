import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
const configurePdfJs = () => {
  if (typeof window !== 'undefined') {
    // Set the worker source to local file
    const localWorkerSrc = '/pdf.worker.min.mjs';
    pdfjsLib.GlobalWorkerOptions.workerSrc = localWorkerSrc;
    
    // Log configuration in development
    if (process.env.NODE_ENV === 'development') {
      console.log('PDF.js worker configured to use local file:', localWorkerSrc);
    }
  }
};

export default configurePdfJs;
