import { motion } from "framer-motion";
import {
  FileText,
  AlertTriangle,
  HelpCircle,
  RotateCcw,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.25,
      delayChildren: 0.1,
    },
  },
};

const sectionVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.5,
      ease: "easeOut",
    },
  },
};

const listItemVariants = {
  hidden: { opacity: 0, x: -16 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.35, ease: "easeOut" },
  },
};

const listContainerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.15,
    },
  },
};

/**
 * Normalizes input (string, array, or null) into a clean array of strings.
 */
function normalizeList(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((item) => (typeof item === "string" ? item.trim() : String(item)))
      .filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split("\n")
      .map((line) => line.replace(/^[•\-\*\d+\.)\]]+\s*/, "").trim())
      .filter((line) => {
        if (!line) return false;
        const lower = line.toLowerCase();
        return !["none", "none.", "n/a", "none detected"].includes(lower);
      });
  }
  return [];
}

/**
 * Renders the AI-generated summary, flags, and questions with staggered animations.
 */
export default function Summary({ data, error, onRetry, onReset }) {
  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card mx-auto max-w-2xl p-8"
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100">
            <AlertTriangle className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-700">
            Something Went Wrong
          </h2>
          <p className="text-lg text-slate-500">{error}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button onClick={onRetry} className="btn-primary">
              <RotateCcw className="h-5 w-5" />
              Try Again
            </button>
            <button onClick={onReset} className="btn-secondary">
              Upload New File
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  if (!data) return null;

  const summaryText = data.summary || "No summary available for this report.";
  const flagsList = normalizeList(data.flags);
  const questionsList = normalizeList(data.questions);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="mx-auto max-w-2xl space-y-6"
    >
      {/* Section 1: Plain-Language Summary */}
      <motion.div variants={sectionVariants} className="glass-card p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100">
            <FileText className="h-5 w-5 text-teal-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-700">
            Your Report Summary
          </h2>
        </div>
        <div className="rounded-xl bg-slate-50/80 p-5 border border-slate-200">
          <p className="whitespace-pre-wrap text-lg leading-relaxed text-slate-700">
            {summaryText}
          </p>
        </div>
      </motion.div>

      {/* Section 2: Flagged Items */}
      <motion.div variants={sectionVariants} className="glass-card p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-700">
            Important Findings & Flags
          </h2>
        </div>

        {flagsList.length > 0 ? (
          <>
            <p className="mb-3 text-base text-slate-500">
              These items may need your attention or clarification from your doctor:
            </p>
            <motion.ul
              variants={listContainerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-3"
            >
              {flagsList.map((flag, index) => (
                <motion.li
                  key={index}
                  variants={listItemVariants}
                  className="flex items-start gap-3 rounded-xl bg-amber-50/80 border border-amber-200 p-4"
                >
                  <ChevronRight className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                  <p className="text-lg font-medium text-slate-700">{flag}</p>
                </motion.li>
              ))}
            </motion.ul>
          </>
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-teal-50/80 border border-teal-200 p-4">
            <CheckCircle2 className="h-6 w-6 text-teal-600 flex-shrink-0" />
            <p className="text-lg font-medium text-slate-700">
              No abnormal or out-of-range values detected in this report.
            </p>
          </div>
        )}
      </motion.div>

      {/* Section 3: Questions to Ask Your Doctor */}
      {questionsList.length > 0 && (
        <motion.div variants={sectionVariants} className="glass-card p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
              <HelpCircle className="h-5 w-5 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-700">
              Questions for Your Doctor
            </h2>
          </div>
          <p className="mb-3 text-base text-slate-500">
            Take these questions to your next appointment:
          </p>
          <motion.ol
            variants={listContainerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-3"
          >
            {questionsList.map((question, index) => (
              <motion.li
                key={index}
                variants={listItemVariants}
                className="flex items-start gap-3 rounded-xl bg-blue-50/80 border border-blue-200 p-4"
              >
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-200 text-sm font-bold text-blue-700">
                  {index + 1}
                </span>
                <p className="text-lg text-slate-700">{question}</p>
              </motion.li>
            ))}
          </motion.ol>
        </motion.div>
      )}

      {/* Upload Another Button */}
      <motion.div variants={sectionVariants} className="text-center pt-2">
        <button onClick={onReset} className="btn-secondary">
          <RotateCcw className="h-5 w-5" />
          Upload Another Report
        </button>
      </motion.div>
    </motion.div>
  );
}
