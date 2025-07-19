import React, { useState, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import configurePdfJs from "../utils/pdfConfig";
import "./PdfUploader.css";

// Configure PDF.js worker
configurePdfJs();

const PdfUploader = ({
  maxFileSize = 50 * 1024 * 1024, // 50MB default for PDFs
  multiple = false,
  onFilesSelected,
  onUploadComplete,
  onError,
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [pdfContents, setPdfContents] = useState({});
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState({});
  const [invoiceNo, setInvoiceNo] = useState("");
  const [item, setItem] = useState("");
  const [price, setPrice] = useState("");
  const [autoFilledFields, setAutoFilledFields] = useState({
    invoiceNo: false,
    item: false,
    price: false,
  });
  const fileInputRef = useRef(null);
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  };

  const validateFile = (file) => {
    // Check if it's a PDF
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      return "Only PDF files are allowed";
    }

    // Check file size
    if (file.size > maxFileSize) {
      return `PDF size exceeds ${(maxFileSize / (1024 * 1024)).toFixed(
        1
      )}MB limit`;
    }

    return null;
  };
  const extractTextWithLineBreaks = (textContent) => {
    if (!textContent.items || textContent.items.length === 0) {
      return "";
    }

    // Sort text items by their vertical position (y coordinate) first, then horizontal (x coordinate)
    const sortedItems = textContent.items.sort((a, b) => {
      // Higher y values are at the top in PDF coordinates, so we sort in descending order
      const yDiff = Math.round(b.transform[5] - a.transform[5]);
      if (yDiff !== 0) return yDiff;
      // If on the same line, sort by x coordinate (left to right)
      return a.transform[4] - b.transform[4];
    });

    let result = "";
    let lastY = null;
    let lastX = null;

    // Calculate average height of text items to better determine line breaks
    const heights = sortedItems.map((item) => item.height || 10);
    const avgHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
    const lineThreshold = avgHeight * 0.8; // Use 80% of average height as threshold

    for (let i = 0; i < sortedItems.length; i++) {
      const item = sortedItems[i];
      const currentY = item.transform[5];
      const currentX = item.transform[4];
      const text = item.str;

      if (lastY !== null) {
        const yDiff = Math.abs(lastY - currentY);

        // If the vertical difference is significant, add line break(s)
        if (yDiff > lineThreshold) {
          // For larger gaps, add extra line breaks (paragraph separation)
          if (yDiff > avgHeight * 2) {
            result += "\n\n";
          } else {
            result += "\n";
          }
        }
        // If on the same line but there's a horizontal gap, add appropriate spacing
        else if (lastX !== null) {
          const xDiff = currentX - lastX;
          // Add space if there's a gap and we're not at the start of a line
          if (xDiff > 5 && !result.endsWith(" ") && !result.endsWith("\n")) {
            result += " ";
          }
        }
      }

      // Add the text content, preserving any inherent spacing
      if (text) {
        result += text;
      }

      lastY = currentY;
      lastX = currentX + (item.width || 0);
    }

    // Clean up excessive whitespace while preserving intentional line breaks
    return result
      .replace(/ +/g, " ") // Replace multiple spaces with single space
      .replace(/\n +/g, "\n") // Remove spaces at the beginning of lines
      .replace(/ +\n/g, "\n") // Remove spaces at the end of lines
      .trim();
  };

  // Function to extract form data from PDF text
  const extractFormDataFromPdf = (pdfContent) => {
    if (!pdfContent || !pdfContent.pages) return null;

    // Combine all page text into one string for analysis
    const fullText = pdfContent.pages.map((page) => page.text || "").join("\n");

    const extractedData = {
      invoiceNo: "",
      item: "",
      price: "",
    };

    // Extract Invoice Number (case insensitive)
    const invoicePatterns = [
      /invoice\s*(?:no|number|#)?\s*[:\-]?\s*([a-zA-Z0-9\/\-]+)/i,
      /inv\s*(?:no|number|#)?\s*[:\-]?\s*([a-zA-Z0-9\/\-]+)/i,
      /(?:ref|reference)\s*[:\-]?\s*([a-zA-Z0-9\/\-]+)/i,
      /#\s*([a-zA-Z0-9\/\-]+)/,
    ];

    for (const pattern of invoicePatterns) {
      const match = fullText.match(pattern);
      if (match && match[1] && match[1].length > 2) {
        extractedData.invoiceNo = match[1].toUpperCase().trim();
        break;
      }
    }

    // Extract Item/Description
    const itemPatterns = [
      /(?:description|item|product|service)\s*[:\-]?\s*([^\n\r]+)/i,
      /(?:for|regarding)\s*[:\-]?\s*([^\n\r]+)/i,
      /(?:goods|services)\s*[:\-]?\s*([^\n\r]+)/i,
    ];

    for (const pattern of itemPatterns) {
      const match = fullText.match(pattern);
      if (match && match[1] && match[1].trim().length > 3) {
        extractedData.item = match[1]
          .trim()
          .replace(/[^\w\s.,\-]/g, "") // Remove unwanted special characters
          .substring(0, 100); // Limit length
        break;
      }
    }

    // Extract Price/Amount
    const pricePatterns = [
      /(?:total|amount|price|cost|sum)\s*[:\-]?\s*[$£€¥]?\s*([0-9,]+\.?[0-9]*)/i,
      /[$£€¥]\s*([0-9,]+\.?[0-9]*)/,
      /([0-9,]+\.[0-9]{2})\s*(?:usd|eur|gbp|$|£|€)?/i,
      /(?:pay|payment)\s*[:\-]?\s*[$£€¥]?\s*([0-9,]+\.?[0-9]*)/i,
    ];

    for (const pattern of pricePatterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        const priceValue = match[1].replace(/,/g, ""); // Remove commas
        const numericPrice = parseFloat(priceValue);
        if (!isNaN(numericPrice) && numericPrice > 0) {
          extractedData.price = numericPrice.toFixed(2);
          break;
        }
      }
    }

    return extractedData;
  };

  const extractPdfContent = async (file) => {
    try {
      setIsProcessing((prev) => ({ ...prev, [file.name]: true }));

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      const content = {
        numPages: pdf.numPages,
        pages: [],
        metadata: null,
        images: [],
      };

      // Extract metadata
      try {
        const metadata = await pdf.getMetadata();
        content.metadata = {
          title: metadata.info?.Title || "Unknown",
          author: metadata.info?.Author || "Unknown",
          subject: metadata.info?.Subject || "",
          creator: metadata.info?.Creator || "",
          producer: metadata.info?.Producer || "",
          creationDate: metadata.info?.CreationDate || "",
          modificationDate: metadata.info?.ModDate || "",
        };
      } catch (metaError) {
        console.warn("Could not extract PDF metadata:", metaError);
      }

      // Extract text from each page
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const viewport = page.getViewport({ scale: 1.5 }); // Extract text with preserved line breaks
          const pageText = extractTextWithLineBreaks(textContent);

          // Create canvas for page rendering
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          // Render page to canvas
          await page.render({
            canvasContext: context,
            viewport: viewport,
          }).promise;

          const pageImage = canvas.toDataURL("image/png");

          content.pages.push({
            pageNumber: pageNum,
            text: pageText,
            image: pageImage,
            width: viewport.width,
            height: viewport.height,
          });
        } catch (pageError) {
          console.error(`Error processing page ${pageNum}:`, pageError);
          content.pages.push({
            pageNumber: pageNum,
            text: `Error extracting text from page ${pageNum}`,
            image: null,
            error: pageError.message,
          });
        }
      }

      return content;
    } catch (error) {
      console.error("Error extracting PDF content:", error);
      throw new Error(`Failed to process PDF: ${error.message}`);
    } finally {
      setIsProcessing((prev) => ({ ...prev, [file.name]: false }));
    }
  };

  const handleFiles = async (files) => {
    const fileArray = Array.from(files);
    const validFiles = [];
    const errors = [];

    fileArray.forEach((file) => {
      const error = validateFile(file);
      if (error) {
        errors.push({ file: file.name, error });
      } else {
        validFiles.push(file);
      }
    });

    if (errors.length > 0 && onError) {
      onError(errors);
    }

    if (validFiles.length > 0) {
      if (onFilesSelected) {
        onFilesSelected(validFiles);
      }
      await uploadFiles(validFiles);
    }
  };

  const uploadFiles = async (files) => {
    setIsUploading(true);
    const newProgress = {};

    for (const file of files) {
      newProgress[file.name] = 0;
    }
    setUploadProgress(newProgress);

    try {
      for (const file of files) {
        await simulateFileUpload(file); // Extract PDF content after upload
        try {
          const content = await extractPdfContent(file);
          setPdfContents((prev) => ({ ...prev, [file.name]: content }));
          // Auto-fill form fields based on PDF content
          const extractedData = extractFormDataFromPdf(content);
          if (extractedData) {
            const newAutoFilledFields = {
              invoiceNo: false,
              item: false,
              price: false,
            };

            if (extractedData.invoiceNo && !invoiceNo) {
              setInvoiceNo(extractedData.invoiceNo);
              newAutoFilledFields.invoiceNo = true;
            }
            if (extractedData.item && !item) {
              setItem(extractedData.item);
              newAutoFilledFields.item = true;
            }
            if (extractedData.price && !price) {
              setPrice(extractedData.price);
              newAutoFilledFields.price = true;
            }

            setAutoFilledFields(newAutoFilledFields);
          }
        } catch (error) {
          console.error("Error extracting PDF content:", error);
          if (onError) {
            onError([
              {
                file: file.name,
                error: `PDF processing failed: ${error.message}`,
              },
            ]);
          }
        }
      }

      if (onUploadComplete) {
        onUploadComplete(files);
      }
    } catch (error) {
      if (onError) {
        onError([{ file: "upload", error: error.message }]);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const simulateFileUpload = (file) => {
    return new Promise((resolve) => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
          setUploadProgress((prev) => ({ ...prev, [file.name]: 100 }));
          setUploadedFiles((prev) => [
            ...prev,
            {
              name: file.name,
              size: file.size,
              type: file.type,
              uploadTime: new Date().toISOString(),
            },
          ]);
          resolve();
        } else {
          setUploadProgress((prev) => ({
            ...prev,
            [file.name]: Math.floor(progress),
          }));
        }
      }, 300);
    });
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };
  const removeFile = (fileName) => {
    setUploadedFiles((prev) => prev.filter((file) => file.name !== fileName));
    setUploadProgress((prev) => {
      const newProgress = { ...prev };
      delete newProgress[fileName];
      return newProgress;
    });
    setPdfContents((prev) => {
      const newContents = { ...prev };
      delete newContents[fileName];
      return newContents;
    });
  };
  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="pdf-uploader">
      <div
        className={`upload-area ${dragActive ? "drag-active" : ""} ${
          isUploading ? "uploading" : ""
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={openFileDialog}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple={multiple}
          onChange={handleChange}
          accept=".pdf,application/pdf"
          style={{ display: "none" }}
        />

        <div className="upload-content">
          <div className="upload-icon">📄</div>
          <h3>Drop PDF files here or click to browse</h3>
          <p>
            Supports: PDF files only | Max size:{" "}
            {(maxFileSize / (1024 * 1024)).toFixed(1)}MB{" "}
          </p>
        </div>
      </div>

      {/* Upload Progress Section */}
      {Object.keys(uploadProgress).length > 0 && (
        <div className="upload-progress-section">
          {Object.entries(uploadProgress).map(([fileName, progress]) => (
            <div key={fileName} className="progress-item">
              <div className="progress-info">
                <span className="file-name">{fileName}</span>
                <span className="progress-percent">{progress}%</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {isProcessing[fileName] && (
                <div className="processing-indicator">
                  <span>🔄 Processing PDF content...</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Display PDF content automatically after upload */}
      {uploadedFiles.length > 0 && Object.keys(pdfContents).length > 0 && (
        <div className="pdf-content-display">
          {uploadedFiles.map((file, index) => {
            const content = pdfContents[file.name];
            if (!content) return null;

            return (
              <div key={index} className="pdf-text-container">
                <div className="pdf-file-header">
                  <h5>{file.name}</h5>
                  <div className="pdf-info">
                    {content.numPages} pages • {formatFileSize(file.size)}
                  </div>
                </div>

                <div className="pdf-extracted-text">
                  {content.pages.map((page) => (
                    <div key={page.pageNumber} className="page-text-section">
                      <div className="page-text-header">
                        Page {page.pageNumber}
                      </div>
                      <div className="page-text-content">
                        {page.text || "No text content found on this page"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}{" "}
        </div>
      )}

      
      {/* Form Fields */}
      <div className="form-fields-section">
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="invoiceNo">Invoice No</label>
            <input
              type="text"
              id="invoiceNo"
              value={invoiceNo}
              onChange={(e) => {
                setInvoiceNo(e.target.value);
                setAutoFilledFields((prev) => ({ ...prev, invoiceNo: false }));
              }}
              placeholder="Enter invoice number"
              className="form-input"
            />
          </div>
          <div className="form-field">
            <label htmlFor="item">Item</label>
            <input
              type="text"
              id="item"
              value={item}
              onChange={(e) => {
                setItem(e.target.value);
                setAutoFilledFields((prev) => ({ ...prev, item: false }));
              }}
              placeholder="Enter item description"
              className="form-input"
            />
          </div>
          <div className="form-field">
            <label htmlFor="price">Price</label>
            <input
              type="number"
              id="price"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                setAutoFilledFields((prev) => ({ ...prev, price: false }));
              }}
              placeholder="0.00"
              step="0.01"
              min="0"
              className="form-input"
            />
          </div>{" "}
        </div>
      </div>
      
    </div>
  );
};

export default PdfUploader;
