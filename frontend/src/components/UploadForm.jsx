import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, AlertCircle } from "lucide-react";
import { getPresignedUrl, uploadToS3, pollForSummary } from "../services/api";

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];

const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * SVG scanning animation: a document icon with a moving scan line.
 */
function ScanningAnimation() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-32 w-24">
        {/* Document body */}
        <svg
          viewBox="0 0 80 110"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-full w-full"
        >
          {/* Page background */}
          <rect
            x="2"
            y="2"
            width="76"
            height="106"
            rx="6"
            fill="#f0fdfa"
            stroke="#0d9488"
            strokeWidth="2.5"
          />
          {/* Folded corner */}
          <path d="M56 2 L76 22 L56 22 Z" fill="#ccfbf1" stroke="#0d9488" strokeWidth="1.5" />
          {/* Text lines */}
          <rect x="14" y="34" width="40" height="4" rx="2" fill="#99f6e4" />
          <rect x="14" y="46" width="52" height="4" rx="2" fill="#99f6e4" />
          <rect x="14" y="58" width="36" height="4" rx="2" fill="#99f6e4" />
          <rect x="14" y="70" width="48" height="4" rx="2" fill="#99f6e4" />
          <rect x="14" y="82" width="28" height="4" rx="2" fill="#99f6e4" />
        </svg>

        {/* Scanning line */}
        <div className="absolute left-0 top-[10%] h-1 w-full animate-scan-line">
          <div className="mx-1 h-full rounded-full bg-gradient-to-r from-transparent via-teal-500 to-transparent shadow-[0_0_12px_rgba(20,184,166,0.6)]" />
        </div>
      </div>

      <div className="text-center">
        <p className="text-xl font-semibold text-teal-600">
          Analyzing your report...
        </p>
        <p className="mt-1 text-base text-slate-500">
          This may take up to a minute
        </p>
      </div>

      {/* Pulsing dots */}
      <div className="flex items-center gap-2">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="h-3 w-3 rounded-full bg-teal-500"
            animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              delay: i * 0.2,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default function UploadForm({ onResult, onError }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [validationError, setValidationError] = useState("");
  const inputRef = useRef(null);

  /**
   * Validate a file against type, extension, and size constraints.
   */
  function validateFile(file) {
    if (!file) return "No file selected.";

    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return "Invalid file type. Please upload a PDF, JPG, or PNG file.";
    }

    if (!ALLOWED_TYPES.includes(file.type) && file.type !== "") {
      return "Invalid file type. Please upload a PDF, JPG, or PNG file.";
    }

    if (file.size > MAX_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      return `File is too large (${sizeMB} MB). Maximum size is 10 MB.`;
    }

    return "";
  }

  function handleFile(file) {
    const error = validateFile(file);
    if (error) {
      setValidationError(error);
      setSelectedFile(null);
      return;
    }
    setValidationError("");
    setSelectedFile(file);
  }

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  function handleInputChange(e) {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  }

  function removeFile() {
    setSelectedFile(null);
    setValidationError("");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  async function handleUpload() {
    if (!selectedFile) return;

    setUploading(true);
    setValidationError("");

    try {
      // Step 1: Get presigned URL
      const contentType = selectedFile.type || "application/octet-stream";
      const { uploadUrl, reportId } = await getPresignedUrl(
        selectedFile.name,
        contentType,
        selectedFile.size
      );

      // Step 2: Upload to S3
      await uploadToS3(uploadUrl, selectedFile, contentType);

      setUploading(false);
      setScanning(true);

      // Step 3: Poll for results
      const result = await pollForSummary(reportId);
      setScanning(false);
      onResult(result);
    } catch (err) {
      setUploading(false);
      setScanning(false);
      onError(err.message || "Something went wrong. Please try again.");
    }
  }

  // While scanning, show the scanning animation
  if (scanning) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-card mx-auto max-w-lg p-8"
      >
        <ScanningAnimation />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-card mx-auto max-w-lg p-8"
    >
      <h2 className="mb-2 text-2xl font-bold text-slate-700">
        Upload Your Medical Report
      </h2>
      <p className="mb-6 text-base text-slate-500">
        Upload a PDF or image of your medical report and we will explain it in plain language.
      </p>

      {/* Dropzone */}
      <motion.div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => !selectedFile && inputRef.current?.click()}
        animate={
          dragActive
            ? { scale: 1.02, borderColor: "#0d9488" }
            : { scale: 1, borderColor: "#cbd5e1" }
        }
        whileHover={!selectedFile ? { scale: 1.01 } : {}}
        whileTap={!selectedFile ? { scale: 0.99 } : {}}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className={`relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 transition-colors ${
          dragActive
            ? "border-teal-500 bg-teal-50/50"
            : selectedFile
            ? "border-teal-400 bg-teal-50/30"
            : "border-slate-300 bg-slate-50/50 hover:border-teal-400 hover:bg-teal-50/30"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleInputChange}
          className="hidden"
        />

        <AnimatePresence mode="wait">
          {selectedFile ? (
            <motion.div
              key="file-selected"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex flex-col items-center gap-3 text-center"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-teal-100">
                <FileText className="h-7 w-7 text-teal-600" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-700">
                  {selectedFile.name}
                </p>
                <p className="text-base text-slate-500">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile();
                }}
                className="flex items-center gap-1 text-base text-red-500 hover:text-red-700"
              >
                <X className="h-4 w-4" />
                Remove
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="drop-prompt"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3 text-center"
            >
              <motion.div
                className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-100"
                animate={
                  dragActive
                    ? { scale: [1, 1.1, 1], rotate: [0, 5, -5, 0] }
                    : {}
                }
                transition={{ duration: 0.5 }}
              >
                <Upload className="h-8 w-8 text-teal-600" />
              </motion.div>
              <div>
                <p className="text-lg font-semibold text-slate-700">
                  {dragActive ? "Drop your file here" : "Drag and drop your file here"}
                </p>
                <p className="mt-1 text-base text-slate-500">
                  or click to browse your files
                </p>
              </div>
              <p className="text-sm text-slate-400">
                PDF, JPG, or PNG -- up to 10 MB
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Validation Error */}
      <AnimatePresence>
        {validationError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 flex items-start gap-2 overflow-hidden rounded-xl bg-red-50 border border-red-200 px-4 py-3"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
            <p className="text-base text-red-700">{validationError}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload Button */}
      <motion.button
        type="button"
        onClick={handleUpload}
        disabled={!selectedFile || uploading}
        className="btn-primary mt-6 w-full"
        whileHover={selectedFile && !uploading ? { scale: 1.02 } : {}}
        whileTap={selectedFile && !uploading ? { scale: 0.98 } : {}}
      >
        {uploading ? (
          <>
            <motion.div
              className="h-5 w-5 rounded-full border-2 border-white border-t-transparent"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            />
            Uploading...
          </>
        ) : (
          <>
            <Upload className="h-5 w-5" />
            Analyze Report
          </>
        )}
      </motion.button>
    </motion.div>
  );
}
