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
  const [extractedTableData, setExtractedTableData] = useState([]);
  const [editableItems, setEditableItems] = useState([]);
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
    // Clear the input value to allow re-uploading the same file
    e.target.value = "";
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
  }; // Enhanced function to extract table data from PDF text
  const extractTableDataFromPdf = (pdfContent) => {
    if (!pdfContent || !pdfContent.pages) return [];

    // Combine all page text into one string for analysis
    const fullText = pdfContent.pages.map((page) => page.text || "").join("\n");

    const extractedItems = extractTableItems(fullText);
    return extractedItems;
  };
  // Function to extract table items with enhanced table detection
  const extractTableItems = (text) => {
    const items = [];
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    console.log("PDF Text Lines for Table Extraction:", lines.slice(0, 20)); // Debug first 20 lines

    // Strategy 1: Detect table headers and data rows
    let tableStartIndex = -1;
    let tableEndIndex = -1;

    // Look for common table headers
    const headerPatterns = [
      /(?:description|item|product|service).*?(?:qty|quantity).*?(?:price|amount|rate|cost)/i,
      /(?:item|product).*?(?:price|amount|cost)/i,
      /(?:description|service).*?(?:amount|total|price)/i,
      /(?:no|#).*?(?:description|item).*?(?:price|amount)/i,
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Find table header
      if (tableStartIndex === -1) {
        for (const pattern of headerPatterns) {
          if (pattern.test(line)) {
            tableStartIndex = i + 1; // Start after header
            break;
          }
        }
      }

      // Find table end (look for totals, footer content)
      if (tableStartIndex !== -1 && tableEndIndex === -1) {
        if (
          /(?:total|subtotal|tax|vat|grand total|amount due|balance|thank you|terms)/i.test(
            line
          )
        ) {
          tableEndIndex = i;
          break;
        }
      }
    }

    // If we found a table structure, extract data
    if (tableStartIndex !== -1) {
      const tableLines =
        tableEndIndex !== -1
          ? lines.slice(tableStartIndex, tableEndIndex)
          : lines.slice(tableStartIndex);

      for (let i = 0; i < tableLines.length; i++) {
        const line = tableLines[i];

        // Skip empty lines and obvious non-data lines
        if (!line || /^[-=\s]+$/.test(line)) continue;
        // Enhanced patterns for table row detection with improved quantity parsing
        const tableRowPatterns = [
          // Pattern 1: Description [quantity] [unit price] [total]
          /^(.{3,}?)\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9,]+\.?[0-9]*)\s+([0-9,]+\.?[0-9]*)\s*$/,
          // Pattern 2: Description [quantity] [price/total]
          /^(.{3,}?)\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9,]+\.?[0-9]*)\s*$/,
          // Pattern 3: Description with decimal quantity [price]
          /^(.{3,}?)\s+([0-9]*\.?[0-9]+)\s+([0-9,]+\.?[0-9]*)\s*$/,
          // Pattern 4: Item number + Description [quantity] [price]
          /^(\d+\.?\s+.{3,}?)\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9,]+\.?[0-9]*)\s*$/,
          // Pattern 5: Description with quantity units (e.g., "5 each", "2.5 kg")
          /^(.{3,}?)\s+([0-9]+(?:\.[0-9]+)?)\s*(?:each|pcs?|units?|items?|kg|lbs?|hrs?|hours?|days?|boxes?|sets?)?\s+([0-9,]+\.?[0-9]*)\s*$/i,
          // Pattern 6: Description Price (no quantity visible, default to 1)
          /^(.{5,}?)\s+([0-9,]+\.[0-9]{2})\s*$/,
          // Pattern 7: Description - Price or Description : Price
          /^(.{3,}?)\s*[-:]\s*([0-9,]+\.?[0-9]*)\s*$/,
          // Pattern 8: Multiple spaces/tabs separation
          /^(.{3,}?)\s{3,}([0-9,]+\.?[0-9]*)\s*$/,
          // Pattern 9: Tab-separated values
          /^(.{3,}?)\t+([0-9]+(?:\.[0-9]+)?)\t+([0-9,]+\.?[0-9]*)\t*.*$/,
          // Pattern 10: Pipe-separated values
          /^(.{3,}?)\|([0-9]+(?:\.[0-9]+)?)\|([0-9,]+\.?[0-9]*)\|?.*$/,
        ];
        for (const pattern of tableRowPatterns) {
          const match = line.match(pattern);
          if (match) {
            console.log(`Pattern matched for line "${line}":`, match); // Debug pattern matching
            let description, quantity, price;

            // Handle different pattern types based on number of capture groups
            if (match.length === 5) {
              // Pattern with description, quantity, unit price, and total
              description = match[1].trim();
              quantity = parseFloat(match[2]) || 1;
              const unitPrice = parseFloat(match[3].replace(/,/g, ""));
              const totalPrice = parseFloat(match[4].replace(/,/g, ""));

              // Use unit price if available, otherwise use total price
              if (!isNaN(unitPrice) && unitPrice > 0) {
                price = unitPrice;
              } else if (!isNaN(totalPrice) && totalPrice > 0) {
                price = totalPrice / quantity; // Calculate unit price from total
              }
            } else if (match.length === 4) {
              // Pattern with description, quantity, and price
              description = match[1].trim();
              quantity = parseFloat(match[2]) || 1;
              price = parseFloat(match[3].replace(/,/g, ""));
            } else if (match.length === 3) {
              // Pattern with description and price only (no quantity)
              description = match[1].trim();
              quantity = 1;
              price = parseFloat(match[2].replace(/,/g, ""));
            }

            // Validate extracted data
            if (
              description &&
              description.length > 2 &&
              !isNaN(price) &&
              price > 0 &&
              quantity > 0
            ) {
              // Clean up description
              description = description
                .replace(/^\d+\.?\s*/, "") // Remove leading numbers
                .replace(/[^\w\s.,/-]/g, "") // Remove special chars
                .trim();

              // Ensure quantity is reasonable (not a price that was mistaken for quantity)
              if (quantity > 1000) {
                // If quantity seems too high, it might be a price, so default to 1
                quantity = 1;
              }

              // Filter out non-item descriptions
              if (
                !/^(?:total|subtotal|tax|vat|discount|shipping|fee|charge|amount|due|balance|paid)$/i.test(
                  description
                )
              ) {
                items.push({
                  id: items.length + 1,
                  description: description.substring(0, 150),
                  quantity: Math.round(quantity * 100) / 100, // Round to 2 decimal places
                  price: price.toFixed(2),
                });
                break; // Found match, move to next line
              }
            }
          }
        }
      }
    }
    // Strategy 2: Enhanced fallback - look for any price patterns with better quantity detection
    if (items.length === 0) {
      const fallbackPatterns = [
        // Pattern with potential quantity and price
        /^(.+?)\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9,]+\.[0-9]{2})\s*$/gm,
        // Pattern with description and price only
        /^(.+?)\s+([0-9,]+\.[0-9]{2})\s*$/gm,
        // Pattern with dash separator
        /(.+?)\s*[-–—]\s*([0-9]+(?:\.[0-9]+)?)?\s*\$?([0-9,]+\.?[0-9]*)/g,
        // Pattern with colon separator
        /(.+?)\s*[:]\s*([0-9]+(?:\.[0-9]+)?)?\s*\$?([0-9,]+\.?[0-9]*)/g,
        // Pattern for tab-separated data
        /^(.+?)\t+([0-9]+(?:\.[0-9]+)?)\t+([0-9,]+\.?[0-9]*)/gm,
      ];

      for (const pattern of fallbackPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null && items.length < 10) {
          let description, quantity, price;

          if (match.length === 4) {
            // Has description, quantity, and price
            description = match[1].trim();
            quantity = parseFloat(match[2]) || 1;
            price = parseFloat(match[3].replace(/,/g, ""));
          } else if (match.length === 3) {
            // Has description and price only
            description = match[1].trim();
            quantity = 1;
            price = parseFloat(match[2].replace(/,/g, ""));
          }

          // Validate and clean data
          if (
            description &&
            description.length > 3 &&
            !isNaN(price) &&
            price > 0
          ) {
            // Ensure quantity is reasonable
            if (quantity > 1000) {
              quantity = 1;
            }

            if (
              !/^(?:total|subtotal|tax|vat|discount|shipping|fee|amount|due|balance|paid|invoice|date)$/i.test(
                description
              )
            ) {
              items.push({
                id: items.length + 1,
                description: description.substring(0, 150),
                quantity: Math.round(quantity * 100) / 100,
                price: price.toFixed(2),
              });
            }
          }
        }
        if (items.length > 0) break;
      }
    }
    // Strategy 3: Context-aware quantity detection - look for quantity indicators
    if (items.length > 0) {
      // Try to improve quantity detection for already found items
      items.forEach((item) => {
        // Look for quantity indicators in description
        const qtyPatterns = [
          /(\d+(?:\.\d+)?)\s*(?:x|times|each|pcs?|pieces?|units?|items?)/i,
          /(?:qty|quantity|count)[\s:]*(\d+(?:\.\d+)?)/i,
          /(\d+(?:\.\d+)?)\s*(?:kg|lbs?|pounds?|oz|ounces?|g|grams?)/i,
          /(\d+(?:\.\d+)?)\s*(?:hrs?|hours?|days?|weeks?|months?)/i,
          /(\d+(?:\.\d+)?)\s*(?:sets?|boxes?|packs?|bottles?|cans?)/i,
        ];

        for (const pattern of qtyPatterns) {
          const qtyMatch = item.description.match(pattern);
          if (qtyMatch && qtyMatch[1]) {
            const detectedQty = parseFloat(qtyMatch[1]);
            if (detectedQty > 0 && detectedQty <= 1000) {
              item.quantity = Math.round(detectedQty * 100) / 100;
              // Remove quantity from description to clean it up
              item.description = item.description.replace(pattern, "").trim();
              break;
            }
          }
        }
      });
    }

    // Remove duplicates
    const uniqueItems = items.filter(
      (item, index, self) =>
        index ===
        self.findIndex(
          (i) => i.description.toLowerCase() === item.description.toLowerCase()
        )
    );

    return uniqueItems;
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
    // Clear previous data when uploading new files
    setUploadedFiles([]);
    setUploadProgress({});
    setPdfContents({});
    setExtractedTableData([]);
    setEditableItems([]);
    setIsProcessing({});

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
          setPdfContents((prev) => ({ ...prev, [file.name]: content })); // Auto-extract table data and create editable fields
          const extractedItems = extractTableDataFromPdf(content);
          if (extractedItems && extractedItems.length > 0) {
            setExtractedTableData(extractedItems);
            setEditableItems(extractedItems);
          } else {
            // If no items found, create one empty row
            const emptyItem = {
              id: 1,
              description: "",
              quantity: 1,
              price: "",
            };
            setExtractedTableData([]);
            setEditableItems([emptyItem]);
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
  }; // Helper functions for managing editable items
  const addNewRow = () => {
    const newId = Math.max(...editableItems.map((item) => item.id), 0) + 1;
    setEditableItems([
      ...editableItems,
      {
        id: newId,
        description: "",
        quantity: 1,
        price: "",
      },
    ]);
  };

  const removeRow = (id) => {
    if (editableItems.length > 1) {
      setEditableItems(editableItems.filter((item) => item.id !== id));
    }
  };

  const updateItem = (id, field, value) => {
    setEditableItems(
      editableItems.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const calculateTotal = (items) => {
    if (!items || items.length === 0) return 0;
    return items.reduce((total, item) => {
      const price = parseFloat(item.price) || 0;
      const quantity = parseInt(item.quantity) || 1;
      return total + price * quantity;
    }, 0);
  };
  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };
  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  const clearAll = () => {
    setUploadedFiles([]);
    setUploadProgress({});
    setPdfContents({});
    setExtractedTableData([]);
    setEditableItems([]);
    setIsUploading(false);
    setIsProcessing({});
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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
          <h3>
            {uploadedFiles.length > 0
              ? "Upload another PDF"
              : "Drop PDF files here or click to browse"}
          </h3>
          <p>
            Supports: PDF files only | Max size:
            {(maxFileSize / (1024 * 1024)).toFixed(1)}MB
          </p>
          {(uploadedFiles.length > 0 || editableItems.length > 0) && (
            <button
              type="button"
              className="clear-all-btn"
              onClick={(e) => {
                e.stopPropagation();
                clearAll();
              }}
              title="Clear all data and start over"
            >
              🗑️ Clear All
            </button>
          )}
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
          })}
        </div>
      )}
      {/* Editable Table Form - Auto-filled from PDF */}
      {editableItems.length > 0 && (
        <div className="table-form-section">
          <div className="form-header">
            <h4>📋 Extracted Table Data</h4>
            <div className="form-info">
              {extractedTableData.length > 0 && (
                <span className="auto-fill-badge">
                  ✅ {extractedTableData.length} items auto-detected
                </span>
              )}
            </div>
          </div>

          <div className="table-form">
            <div className="table-header">
              <div className="col-number">#</div>
              <div className="col-description">Description</div>
              <div className="col-quantity">Qty</div>
              <div className="col-price">Price</div>
              <div className="col-total">Total</div>
              <div className="col-actions">Actions</div>
            </div>

            <div className="table-rows">
              {editableItems.map((item, index) => (
                <div key={item.id} className="table-row">
                  <div className="col-number">
                    <span className="row-number">{index + 1}</span>
                  </div>

                  <div className="col-description">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) =>
                        updateItem(item.id, "description", e.target.value)
                      }
                      placeholder="Enter item description"
                      className="form-input description-input"
                    />
                  </div>

                  <div className="col-quantity">
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) =>
                        updateItem(item.id, "quantity", e.target.value)
                      }
                      placeholder="1"
                      min="1"
                      className="form-input quantity-input"
                    />
                  </div>

                  <div className="col-price">
                    <input
                      type="number"
                      value={item.price}
                      onChange={(e) =>
                        updateItem(item.id, "price", e.target.value)
                      }
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className="form-input price-input"
                    />
                  </div>

                  <div className="col-total">
                    <span className="total-value">
                      $
                      {(
                        (parseFloat(item.price) || 0) *
                        (parseInt(item.quantity) || 1)
                      ).toFixed(2)}
                    </span>
                  </div>

                  <div className="col-actions">
                    {editableItems.length > 1 && (
                      <button
                        type="button"
                        className="remove-row-btn"
                        onClick={() => removeRow(item.id)}
                        title="Remove row"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="table-footer">
              <div className="add-row-section">
                <button
                  type="button"
                  className="add-row-btn"
                  onClick={addNewRow}
                  title="Add new row"
                >
                  + Add Row
                </button>
              </div>

              <div className="grand-total-section">
                <div className="grand-total-label">Grand Total:</div>
                <div className="grand-total-amount">
                  ${calculateTotal(editableItems).toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {extractedTableData.length === 0 && (
            <div className="no-data-message">
              <p>⚠️ No table data was automatically detected in this PDF.</p>
              <p>You can manually enter the information in the form above.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PdfUploader;
