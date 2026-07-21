/**
 * Extract plain text from a PDF ArrayBuffer via PDF.js (window.pdfjsLib).
 * Expects pdf.js to be loaded (CDN or bundled) before calling.
 */

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<string>}
 */
export async function extractTextFromPdfBuffer(arrayBuffer) {
    if (typeof window === 'undefined' || !window.pdfjsLib) {
        throw new Error('PDF.js nicht geladen (window.pdfjsLib fehlt).');
    }

    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    let pdfText = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        let pageText = '';
        try {
            const textContent = await page.getTextContent();
            if (textContent.items.length > 0) {
                let lastY = null;
                const line = [];
                const lines = [];
                textContent.items.forEach((item) => {
                    if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
                        lines.push(line.join(' '));
                        line.length = 0;
                    }
                    line.push(item.str);
                    lastY = item.transform[5];
                });
                if (line.length) lines.push(line.join(' '));
                pageText = lines.join('\n');
            }
        } catch (e) {
            console.warn('Fehler bei Extraktion auf Seite', pageNum, e);
        }
        pdfText += (pdfText ? '\n' : '') + pageText;
    }

    return pdfText;
}
