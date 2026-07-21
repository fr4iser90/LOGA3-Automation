/**
 * ShiftPlan converter core — shared by LOGA3 desktop GUI and (optionally) the website.
 */

export { parseTimeSheet, convertParsedEntriesToCSV } from './convert.js';
export { buildEventDescription } from './eventDescription.js';
export { exportToICS } from './icsGenerator.js';
export {
    extractMonthSummariesFromText,
    saveMonthSummaries,
    renderMonthSummariesFromStorage,
    renderMonthSummaries,
    initOptionalDataPrefs,
    isRichEventDetailsEnabled,
    isMonthSummaryEnabled,
} from './monthSummary.js';
export { ParserInterface } from './parser-interface.js';
export {
    loadHospitalConfig,
    loadMapping,
    loadHospitalParser,
    loadSpecialShiftTypes,
    listHospitals,
    mergeMappingClient,
} from './shiftTypesLoader.js';
export { extractTextFromPdfBuffer } from './pdfText.js';
export { initPDFLoad } from './pdfLoader.js';
export { renderPreview } from './preview.js';
export { initGoogleCalendar, syncToCalendar } from './google.js';
export { sendStructureFeedback, sendMappingProposal, sendSupportRequest, buildSupportReport, downloadSupportReport, loadMaintainerEmail, truncateForMailto } from './api.js';
export { anonymizeDienstplanText, buildSupportParserSample, scorePdfForSupportSample, summarizeEntriesForSupport } from './anonymize.js';
