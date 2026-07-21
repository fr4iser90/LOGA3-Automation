/**
 * Anonymisiert LOGA3-/Dienstplan-PDF-Text für Support-Anfragen.
 * Ziel: Layout, Zeiten, Codes behalten — Namen, IDs, Kontakte entfernen.
 */

const MAX_SAMPLE_CHARS = 12000;

const STRUCTURAL = /Abrechnung|Zeit|Soll|Ist|AZK|Pause|Dienst|Bereitschaft|Übertrag|Uebertrag|Periode|Seite\s+\d|KO\*|GE\*|URLAUB|URLTV|KRANK|FEIER/i;

/**
 * @param {string} text
 * @param {{ maxChars?: number }} [options]
 * @returns {string}
 */
export function anonymizeDienstplanText(text, { maxChars = MAX_SAMPLE_CHARS } = {}) {
    if (!text || !String(text).trim()) return '';

    let out = String(text).normalize('NFC');

    out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]');
    // Nur klare Telefonmuster (nicht Schichtzeiten wie 06:00 1 70 …)
    out = out.replace(/(?:\+\d{1,3}[\d \t\-()/]{6,}\d)|\b(?:Tel\.?|Fon|Mobil)\s*:?\s*[\d \t\-()/]{6,}\d/gi, '[TEL]');
    out = out.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi, '[IBAN]');
    out = out.replace(
        /\b(?:Personal(?:nummer|nr\.?)|Pers\.?\s*Nr\.?|Mitarbeiter(?:-?Nr\.?)?|MA-Nr\.?)\s*[:=]?\s*\S+/gi,
        '[PERSONAL_ID]'
    );

    const lines = out.split('\n');
    const cleaned = lines.map((line, idx) => anonymizeLine(line, idx));
    let result = cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    if (result.length > maxChars) {
        result = `${result.slice(0, maxChars)}\n\n… [gekürzt auf ${maxChars} Zeichen]`;
    }
    return result;
}

function anonymizeLine(line, idx) {
    const trimmed = line.trim();
    if (!trimmed) return '';

    if (/Abrechnungsmonat/i.test(trimmed)) return trimmed.replace(/\b\d{6,}\b/g, '[ID]');
    if (/Bereitschaftsdienste/i.test(trimmed)) return trimmed;
    if (/(?:Ü|Ue|U)bertrag|Periode\s*\(|Bereitschaft\s+(zur|in)/i.test(trimmed)) return trimmed;

    if (/^(Name|Mitarbeiter|Person|Anschrift|Straße|Ort|Klinik|Krankenhaus|Station|Kostenstelle)\b/i.test(trimmed)) {
        return '[HEADER_REDACTED]';
    }

    // Frühe Header-Zeilen ohne Zeiten
    if (
        idx < 12
        && !/\d{2}:\d{2}/.test(trimmed)
        && !/Abrechnungsmonat|\d{2}\.\d{2}\.\d{4}/i.test(trimmed)
        && !STRUCTURAL.test(trimmed)
        && /[A-Za-zÄÖÜäöüß]{3,}/.test(trimmed)
    ) {
        return '[HEADER_REDACTED]';
    }

    // Schichtzeile: Tag + Wochentag/Name + Code …
    const shift = trimmed.match(
        /^(\d{2})\s+(\S+)\s+(KO\*|GE\*|URLTV|URLAUB|KRANK|KR|FEIER\w*)(?=\s|$)(.*)$/i
    );
    if (shift) {
        return `${shift[1]} [NAME] ${shift[3]}${shift[4] || ''}`;
    }

    // Bereitschaft mit Datum
    const onCall = trimmed.match(/^(\d{2}\.\d{2}\.\d{4})\s+(.+)$/);
    if (onCall) {
        const times = [...onCall[2].matchAll(/\b\d{2}:\d{2}\b/g)].map((m) => m[0]);
        const rest = onCall[2].replace(/\b\d{2}:\d{2}\b/g, ' ');
        const nums = [...rest.matchAll(/\b\d+(?:[.,]\d+)?\b/g)].map((m) => m[0]).slice(-3);
        return `${onCall[1]} [REDACTED] ${[...times, ...nums].join(' ')}`.trim();
    }

    // Lange Personalnummern, Zeiten unangetastet
    return trimmed.replace(/\b\d{6,}\b/g, '[ID]');
}

/**
 * Baut einen kurzen Support-Ausschnitt mit echten Schichtzeiten (nicht nur Urlaub am Monatsanfang).
 * @param {string} rawText - PDF-Rohtext
 * @param {{ maxChars?: number, fileLabel?: string }} [options]
 * @returns {string}
 */
export function buildSupportParserSample(rawText, { maxChars = 700, fileLabel = '' } = {}) {
    const anon = anonymizeDienstplanText(rawText, { maxChars: 80000 });
    const lines = anon.split('\n').map((l) => l.trim()).filter(Boolean);

    const isVacation = (l) => /URLTV|URLAUB|KRANK|\bKR\b|FEIER/i.test(l);
    const isWorkShift = (l) => /KO\*|GE\*/.test(l) && /\d{2}:\d{2}/.test(l);
    const isTimedDay = (l) => /^\d{2}\b/.test(l) && /\d{2}:\d{2}/.test(l) && !isVacation(l);
    const isHeader = (l) => /Abrechnungsmonat|Zeitabrechnung|Übertrag aus Vormonat|Uebertrag aus Vormonat|Tag\s+von|PEP|Bereitschaftsdienste/i.test(l);
    const isOnCall = (l) => /^\d{2}\.\d{2}\.\d{4}/.test(l) && /\d{2}:\d{2}/.test(l);

    const headers = lines.filter(isHeader).slice(0, 5);
    const work = lines.filter(isWorkShift);
    const timed = lines.filter(isTimedDay);
    const onCall = lines.filter(isOnCall).slice(0, 3);

    const picked = [];
    const pushUnique = (arr, limit) => {
        for (const line of arr) {
            if (picked.length >= limit) break;
            if (!picked.includes(line)) picked.push(line);
        }
    };

    pushUnique(headers, 5);
    pushUnique(work, 14);
    if (work.length < 4) pushUnique(timed, 14);
    pushUnique(onCall, 3);

    // Keine Schichtzeiten → nicht den Urlaubs-Kopf nehmen, sondern Mitte der Datei
    if (work.length === 0 && timed.length === 0) {
        const mid = Math.max(0, Math.floor(lines.length * 0.35));
        const window = lines.slice(mid, mid + 30);
        picked.length = 0;
        pushUnique(headers, 4);
        pushUnique(window, 20);
        picked.push('… (Hinweis: in diesem PDF kaum/keine KO*/GE*-Zeiten gefunden)');
    }

    let body = picked.join('\n');
    if (fileLabel) body = `### ${fileLabel}\n${body}`;
    if (body.length > maxChars) {
        body = `${body.slice(0, maxChars).trimEnd()}\n… [gekürzt]`;
    }
    return body;
}

/**
 * Score: je mehr echte Schichtzeiten, desto besser als Support-Sample.
 * @param {string} rawText
 */
export function scorePdfForSupportSample(rawText) {
    if (!rawText) return 0;
    const ko = (rawText.match(/KO\*/g) || []).length;
    const ge = (rawText.match(/GE\*/g) || []).length;
    const times = (rawText.match(/\b\d{2}:\d{2}\b/g) || []).length;
    return ko * 5 + ge * 5 + Math.min(times, 40);
}

/**
 * Struktur-Stichprobe aus geparsten Einträgen (ohne Personenbezug).
 * @param {Array<object>} entries
 * @param {{ limit?: number }} [options]
 */
export function summarizeEntriesForSupport(entries, { limit = 40 } = {}) {
    if (!entries?.length) return '(keine geparsten Einträge)';
    const lines = entries.slice(0, limit).map((e) => {
        const time = e.allDay ? 'ganztägig' : `${e.start || '?'}-${e.end || '?'}`;
        return `${e.date || '?'} | ${e.type || '?'} | ${time}`;
    });
    if (entries.length > limit) lines.push(`… +${entries.length - limit} weitere`);
    return lines.join('\n');
}
