import { getString } from "./locale";
import { FluentMessageId } from "../../typings/i10n";

// Translate only at the UI boundary; preserve service errors and external diagnostics.
const messages: Record<string, FluentMessageId> = {
  "No AI provider configured.": "error-detail-no-provider",
  "No screening criteria configured for this project.":
    "error-detail-no-criteria",
  "No TA screening criteria configured for this project.":
    "error-detail-no-ta-criteria",
  "Full text has not been confirmed ready for this item yet.":
    "error-detail-fulltext-not-ready",
  "Could not read full text from the PDF attachment.": "error-detail-pdf-read",
  "No Codebook configured for this project.": "error-detail-no-codebook",
  "No confirmed coding records for this variable yet.":
    "error-detail-no-records",
  "Project not found.": "error-detail-project-missing",
  "Project collection not found.": "error-detail-collection-missing",
  "No items in the queue to sample from.": "error-detail-sample-empty",
  "This file doesn't look like a Zotero Evidence screening log CSV.":
    "error-detail-screening-csv",
  "Both reviewers' CSVs must be collected first.":
    "error-detail-reviewers-required",
  "This file doesn't look like a Zotero Evidence archive (manifest.json missing).":
    "error-detail-archive-invalid",
  "Failed to resolve the newly created project's root collection.":
    "error-detail-new-root-missing",
  "Zotero.Translate.Import is not available in this Zotero build.":
    "error-detail-import-unavailable",
  "Could not derive a /models URL from this base URL (expected it to end with /chat/completions).":
    "error-detail-models-url",
  "Unexpected response shape from /models (no data[] array).":
    "error-detail-models-response",
  "AI provider response did not contain choices[0].message.content":
    "error-detail-ai-response",
  "JEV response did not contain a valid answers.decision.choice":
    "error-detail-jev-response",
  "Worker constructor not available on the main window.":
    "error-detail-worker-unavailable",
  "Failed to create structured text": "error-detail-pdf-structure",
  "Failed to open document": "error-detail-pdf-open",
  "DatabaseService not initialized. Call init() first.":
    "error-detail-db-not-ready",
};

export function localizeError(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
  const key = Object.hasOwn(messages, message) ? messages[message] : undefined;
  if (key) return getString(key);
  for (const [pattern, id] of dynamicMessages) {
    const match = pattern.exec(message);
    if (match) return getString(id, { args: { detail: match[1] } });
  }
  return message;
}

const dynamicMessages: [RegExp, FluentMessageId][] = [
  [/^No evidence project found with id (.+)$/s, "error-detail-project-id"],
  [/^Root collection not found for project "(.+)"$/s, "error-detail-root"],
  [
    /^Project collection structure is incomplete for collection (.+)$/s,
    "error-detail-structure",
  ],
  [
    /^Failed to read back newly created project for collection (.+)$/s,
    "error-detail-created",
  ],
  [
    /^No Zotero import translator recognized this file: (.+)$/s,
    "error-detail-translator",
  ],
  [/^Failed to load page (.+)$/s, "error-detail-pdf-page"],
];
