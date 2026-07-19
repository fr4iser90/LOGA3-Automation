const { MONTH_NAMES } = require('./loga3-inventory');

const MONTH_NAME_TO_NUMBER = Object.fromEntries(
    MONTH_NAMES.map((name, index) => [normalizeMonthToken(name), index + 1])
);

const NUMBER_TO_MONTH_NAME = {
    '01': 'januar', '02': 'februar', '03': 'märz', '04': 'april',
    '05': 'mai', '06': 'juni', '07': 'juli', '08': 'august',
    '09': 'september', '10': 'oktober', '11': 'november', '12': 'dezember',
};

function normalizeMonthToken(value) {
    return String(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ä/g, 'a')
        .replace(/ö/g, 'o')
        .replace(/ü/g, 'u')
        .trim();
}

function toMonthNumber(monthValue) {
    if (/^\d{1,2}$/.test(monthValue)) {
        const month = Number(monthValue);
        return month >= 1 && month <= 12 ? month : null;
    }

    return MONTH_NAME_TO_NUMBER[normalizeMonthToken(monthValue)] || null;
}

function parseAbrechnungsmonat(text, preferred = null) {
    if (!text) return null;

    const candidates = [];
    const addCandidate = (monthValue, yearValue, source, priority) => {
        const month = toMonthNumber(monthValue);
        const year = Number(yearValue);
        if (!month || year < 2000 || year > 2100) return;
        candidates.push({
            month: String(month).padStart(2, '0'),
            year: String(year),
            source,
            priority,
        });
    };

    const labeledPatterns = [
        /Abrechnungsmonat\s*[:\-\s]*(\d{1,2})\s*[\/.\-]\s*(\d{4})/gi,
        /Abrechnungsmonat\s*[:\-\s]*([A-Za-zÄÖÜäöüß]+)\s+(\d{4})/gi,
        /Abrechnungszeitraum\s*[:\-\s]*(\d{1,2})\s*[\/.\-]\s*(\d{4})/gi,
        /Zeitprotokoll[\s\S]{0,120}?(\d{1,2})\s*[\/.\-]\s*(\d{4})/gi,
    ];

    for (const pattern of labeledPatterns) {
        for (const match of text.matchAll(pattern)) {
            addCandidate(match[1], match[2], pattern.source, 1);
        }
    }

    for (const match of text.matchAll(/\b(\d{1,2})\s*[\/.\-]\s*(20\d{2})\b/g)) {
        addCandidate(match[1], match[2], 'generic-period', 3);
    }

    for (const match of text.matchAll(/\b([A-Za-zÄÖÜäöüß]{3,})\s+(20\d{2})\b/g)) {
        addCandidate(match[1], match[2], 'month-name-year', 4);
    }

    if (!candidates.length) return null;

    if (preferred?.month && preferred?.year) {
        const preferredMonth = String(preferred.month).padStart(2, '0');
        const preferredYear = String(preferred.year);
        const preferredMatch = candidates.find(
            (entry) => entry.month === preferredMonth && entry.year === preferredYear
        );
        if (preferredMatch) return preferredMatch;
    }

    candidates.sort((left, right) => left.priority - right.priority);
    return candidates[0];
}

function periodToFilename(month, year) {
    const mm = String(month).padStart(2, '0');
    const monthName = NUMBER_TO_MONTH_NAME[mm] || mm;
    return `${monthName}_${year}`;
}

module.exports = {
    parseAbrechnungsmonat,
    periodToFilename,
};
