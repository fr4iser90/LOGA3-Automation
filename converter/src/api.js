/**
 * api.js
 * Kommunikation nach außen (Support-Anfrage, Mapping-Vorschläge).
 */

/** mailto-URLs: Limit grob 1.5–2k; Body unencoded halten wir darunter. */
const MAILTO_SAFE_CHARS = 1500;

/**
 * Öffnet den System-Mailclient, ohne die LOGA3-Seite zu ersetzen.
 * (mailto: macht selten einen echten Browser-Tab — meist Outlook/Thunderbird/…)
 */
function openMailClient(email, subject, body) {
    const href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    // 1) Verstecktes iframe: navigiert nicht weg von der App
    try {
        let frame = document.getElementById('loga3-mailto-frame');
        if (!frame) {
            frame = document.createElement('iframe');
            frame.id = 'loga3-mailto-frame';
            frame.title = 'mailto';
            frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
            document.body.appendChild(frame);
        }
        frame.src = href;
    } catch {
        // ignore
    }

    // 2) Zusätzlich window.open — falls der Client das besser greift
    try {
        const w = window.open(href, '_blank', 'noopener,noreferrer');
        if (w) {
            try { w.opener = null; } catch { /* ignore */ }
        }
    } catch {
        // ignore
    }
}

/**
 * @param {string} text
 */
async function copyText(text) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fall through
    }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

/**
 * Lädt Maintainer-E-Mail aus converter config (Fallback support@fr4iser.com).
 * @returns {Promise<string>}
 */
export async function loadMaintainerEmail() {
    try {
        const resp = await fetch('/converter/src/config.json');
        if (resp.ok) {
            const data = await resp.json();
            if (data.maintainerEmail) return String(data.maintainerEmail);
        }
    } catch {
        // ignore
    }
    return 'support@fr4iser.com';
}

/**
 * Sendet anonymisiertes Struktur-Feedback an den Maintainer
 */
export function sendStructureFeedback(maintainerEmail, hospital, profession, bereich, missingShiftsText, content) {
    const infoText = `Arbeitgeber: ${hospital}\nBerufsgruppe: ${profession}\nBereich: ${bereich}\n\n`;
    const subject = 'Dienstplan-Feedback [LOGA3]';
    const body = 'Hallo,\n\n'
        + infoText
        + missingShiftsText
        + 'hier ist die anonymisierte Struktur meines Dienstplans:\n\n'
        + '---\n' + content + '\n---';

    openMailClient(maintainerEmail, subject, body);
}

/**
 * Sendet einen Vorschlag für ein neues Schicht-Mapping an den Maintainer
 */
export function sendMappingProposal(maintainerEmail, hospital, profession, bereich, shiftTypes) {
    let mappingText = `Arbeitgeber: ${hospital}\nBerufsgruppe: ${profession}\nBereich: ${bereich}\n\nVORGESCHLAGENE SCHICHTEN:\n`;

    Object.entries(shiftTypes).forEach(([timeRange, value]) => {
        const code = typeof value === 'object' ? value.code : value;
        mappingText += `- ${code}: ${timeRange}\n`;
    });

    const subject = 'Neuer Schicht-Mapping Vorschlag [LOGA3]';
    const body = 'Hallo,\n\nich möchte folgendes Schicht-Mapping für die Datenbank vorschlagen:\n\n'
        + mappingText
        + '\nViele Grüße';

    openMailClient(maintainerEmail, subject, body);
}

/**
 * Kürzt Rohtext so, dass Meta + Sample typischerweise in mailto passen.
 * @param {string} sample
 * @param {number} [maxChars]
 */
export function truncateForMailto(sample, maxChars = 700) {
    const text = String(sample || '').trim();
    if (!text) return '';
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars).trimEnd()}\n… [gekürzt für mailto — 1 PDF-Ausschnitt reicht für Parser]`;
}

/**
 * Baut den Support-Berichtstext (ohne Mail zu öffnen).
 * @param {object} opts
 * @returns {{ subject: string, fullBody: string }}
 */
export function buildSupportReport(opts) {
    const {
        hospitalName,
        groupLabel,
        areaLabel,
        preset = '',
        note = '',
        missingShifts = '',
        anonymizedSample = '',
    } = opts;

    const subject = `Parser/Mapping-Anfrage: ${hospitalName || 'unbekannt'} / ${areaLabel || 'Bereich'} [LOGA3]`;
    // Note/missing nur kurz — Platz für Rohtext
    const noteShort = note && note.length > 120 ? `${note.slice(0, 120)}…` : note;
    const missingShort = missingShifts && missingShifts.length > 200
        ? `${missingShifts.slice(0, 200)}…`
        : missingShifts;
    const sample = truncateForMailto(anonymizedSample, 700);

    const fullBody = [
        'Hallo,',
        '',
        'bitte Parser/Mapping prüfen/ergänzen:',
        '',
        `Arbeitgeber / Einrichtung: ${hospitalName || '—'}`,
        `Berufsgruppe: ${groupLabel || '—'}`,
        `Bereich: ${areaLabel || '—'}`,
        preset ? `Preset: ${preset}` : null,
        noteShort ? `Hinweis: ${noteShort}` : null,
        missingShort ? `Unbekannte Zeiten:\n${missingShort}` : null,
        '',
        sample
            ? `PDF-Rohtext (anonym, Ausschnitt):\n---\n${sample}\n---`
            : '(Kein Rohtext — PDFs fehlen oder Häkchen aus.)',
        '',
        'Viele Grüße',
    ].filter((line) => line != null).join('\n');

    return { subject, fullBody };
}

function supportFilename(hospitalName) {
    const slug = String(hospitalName || 'anfrage')
        .replace(/\s+/g, '-')
        .toLowerCase()
        .replace(/[^a-z0-9\-äöüß]/gi, '');
    return `loga3-support-${slug || 'anfrage'}.txt`;
}

/**
 * Support-Anfrage: Mail in neuem Tab.
 * Bei zu langem Body: Textdatei-Download (+ Clipboard) + kurze Mail mit Anhang-Hinweis.
 *
 * @param {object} opts
 * @param {string} opts.maintainerEmail
 * @returns {Promise<{ mode: 'mailto'|'file', subject: string, fullBody: string, filename?: string }>}
 */
export async function sendSupportRequest(opts) {
    const { maintainerEmail, ...rest } = opts;
    let { subject, fullBody } = buildSupportReport(rest);
    const filename = supportFilename(rest.hospitalName);

    // Falls Meta+Sample trotzdem zu lang: Sample weiter kürzen, bevor Datei-Fallback
    if (fullBody.length > MAILTO_SAFE_CHARS && rest.anonymizedSample) {
        const tighter = truncateForMailto(rest.anonymizedSample, 400);
        ({ subject, fullBody } = buildSupportReport({ ...rest, anonymizedSample: tighter }));
    }

    if (fullBody.length <= MAILTO_SAFE_CHARS) {
        openMailClient(maintainerEmail, subject, fullBody);
        return { mode: 'mailto', subject, fullBody };
    }

    downloadSupportReport(filename, fullBody);
    await copyText(fullBody);

    const shortBody = [
        'Hallo,',
        '',
        `Arbeitgeber: ${rest.hospitalName || '—'}`,
        `Berufsgruppe: ${rest.groupLabel || '—'}`,
        `Bereich: ${rest.areaLabel || '—'}`,
        rest.preset ? `Preset: ${rest.preset}` : null,
        '',
        'Rohtext war unerwartet lang — Datei „' + filename + '“ bitte anhängen.',
        '',
        'Viele Grüße',
    ].filter(Boolean).join('\n');

    openMailClient(maintainerEmail, subject, shortBody);
    return { mode: 'file', subject, fullBody, filename };
}

/**
 * Speichert den Support-Bericht als Textdatei (Fallback ohne Mail-Client).
 * @param {string} filename
 * @param {string} content
 */
export function downloadSupportReport(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'loga3-support-anfrage.txt';
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
