import { Auth } from "aws-amplify";
import { API_ENDPOINT } from "./aws-config";

/**
 * Get the current user's JWT ID token for authenticated API calls.
 */
async function getAuthToken() {
  try {
    const session = await Auth.currentSession();
    return session.getIdToken().getJwtToken();
  } catch (err) {
    throw new Error("You must be signed in to perform this action.");
  }
}

/**
 * Request a presigned S3 URL for uploading a medical report.
 *
 * @param {string} filename - Original file name (e.g. "report.pdf")
 * @param {string} contentType - MIME type (e.g. "application/pdf")
 * @param {number} size - File size in bytes
 * @returns {Promise<{uploadUrl: string, reportId: string}>}
 */
export async function getPresignedUrl(filename, contentType, size) {
  try {
    const token = await getAuthToken();

    const response = await fetch(`${API_ENDPOINT}/presign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
      body: JSON.stringify({
        filename,
        contentType,
        content_type: contentType,
        size,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to get upload URL (${response.status}): ${errorBody}`
      );
    }

    const data = await response.json();
    const uploadUrl = data.uploadUrl || data.url;
    let reportId = data.reportId || data.report_id || data.key || "";

    // Clean reportId if it contains prefix path
    if (reportId.startsWith("uploads/")) {
      reportId = reportId.replace(/^uploads\//, "");
      // Also strip extension if it's the file key
      const dotIdx = reportId.lastIndexOf(".");
      if (dotIdx > 0) {
        reportId = reportId.substring(0, dotIdx);
      }
    }

    if (!uploadUrl || !reportId) {
      throw new Error("Invalid response from upload service.");
    }

    return {
      uploadUrl,
      reportId,
    };
  } catch (err) {
    if (err.message.includes("signed in") || err.message.includes("Failed to get")) {
      throw err;
    }
    throw new Error(
      "Could not prepare your upload. Please check your connection and try again."
    );
  }
}

/**
 * Upload a file directly to S3 using the presigned URL.
 *
 * @param {string} url - Presigned S3 PUT URL
 * @param {File} file - The file to upload
 * @param {string} contentType - MIME type
 * @returns {Promise<void>}
 */
export async function uploadToS3(url, file, contentType) {
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
      },
      body: file,
    });

    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }
  } catch (err) {
    if (err.message.includes("status")) {
      throw err;
    }
    throw new Error(
      "Failed to upload your file. Please check your connection and try again."
    );
  }
}

/**
 * Poll the backend for a completed summary.
 * Retries up to maxAttempts, waiting `interval` ms between each attempt.
 *
 * @param {string} reportId - The report ID
 * @param {number} maxAttempts - Maximum polling attempts (default 30 = 90s)
 * @param {number} interval - Milliseconds between polls (default 3000)
 * @returns {Promise<{summary: string, flags: string[], questions: string[]}>}
 */
export async function pollForSummary(
  reportId,
  maxAttempts = 30,
  interval = 3000
) {
  const token = await getAuthToken();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(
        `${API_ENDPOINT}/summary/${encodeURIComponent(reportId)}`,
        {
          method: "GET",
          headers: {
            Authorization: token,
          },
        }
      );

      if (!response.ok) {
        // On 404, the report is still being registered/processed in DynamoDB
        if (response.status === 404 && attempt < maxAttempts) {
          await sleep(interval);
          continue;
        }
        if (attempt < maxAttempts) {
          await sleep(interval);
          continue;
        }
        throw new Error(`Server error (${response.status})`);
      }

      const data = await response.json();
      const status = (data.status || "").toUpperCase();

      if (status === "COMPLETE" || status === "COMPLETED") {
        return {
          summary: data.summary || "",
          flags: Array.isArray(data.flags) ? data.flags : [],
          questions: Array.isArray(data.questions) ? data.questions : [],
        };
      }

      if (status === "ERROR" || status === "FAILED") {
        throw new Error(
          data.error ||
          "Something went wrong while analyzing your report. Please try again."
        );
      }

      // Still PROCESSING -- wait and retry
      if (attempt < maxAttempts) {
        await sleep(interval);
      }
    } catch (err) {
      if (
        err.message.includes("analyzing") ||
        err.message.includes("signed in")
      ) {
        throw err;
      }

      if (attempt >= maxAttempts) {
        throw new Error(
          "It is taking longer than expected to process your report. Please try again in a moment."
        );
      }

      await sleep(interval);
    }
  }

  throw new Error(
    "It is taking longer than expected to process your report. Please try again in a few minutes."
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
