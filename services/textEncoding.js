/**
 * services/textEncoding.js
 *
 * Small, dependency-free helpers for decoding text files that may have been
 * produced by Excel or another tool using UTF-16 or Latin-1 instead of UTF-8.
 */

/**
 * @typedef {'auto'|'utf8'|'utf16le'|'utf16be'|'latin1'} TextEncoding
 */

/**
 * Normalize user-facing encoding names.
 *
 * @param {string} [encoding]
 * @returns {TextEncoding}
 */
function normalizeEncoding(encoding) {
    switch (String(encoding || 'auto').toLowerCase()) {
        case 'utf-8':
        case 'utf8':
            return 'utf8';
        case 'utf-16':
        case 'utf-16le':
        case 'utf16le':
            return 'utf16le';
        case 'utf-16be':
        case 'utf16be':
            return 'utf16be';
        case 'latin1':
        case 'latin-1':
        case 'iso-8859-1':
            return 'latin1';
        default:
            return 'auto';
    }
}

/**
 * Detect the encoding of a buffer using its BOM (byte-order mark).
 *
 * Returns `utf8` when no BOM is present; callers can still override this with
 * an explicit encoding choice.
 *
 * @param {Buffer} buffer
 * @returns {'utf8'|'utf16le'|'utf16be'}
 */
function detectEncoding(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 2) return 'utf8';

    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return 'utf8';
    }
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf16le';
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf16be';

    return 'utf8';
}

/**
 * Swap UTF-16BE bytes so Node's little-endian decoder can read them.
 *
 * @param {Buffer} buffer
 * @returns {Buffer}
 */
function swapByteOrder(buffer) {
    const copy = Buffer.from(buffer);
    for (let i = 0; i + 1 < copy.length; i += 2) {
        const tmp = copy[i];
        copy[i] = copy[i + 1];
        copy[i + 1] = tmp;
    }
    return copy;
}

/**
 * Decode a file buffer into a string.
 *
 * @param {Buffer} buffer
 * @param {string} [encoding]
 * @returns {{ text: string, encoding: string }}
 */
function decodeBuffer(buffer, encoding) {
    if (!Buffer.isBuffer(buffer)) {
        throw new Error('decodeBuffer expects a Buffer');
    }

    const requested = normalizeEncoding(encoding);
    const effective = requested === 'auto' ? detectEncoding(buffer) : requested;

    let text;
    switch (effective) {
        case 'utf16le': {
            const start = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe ? 2 : 0;
            text = buffer.slice(start).toString('utf16le');
            break;
        }
        case 'utf16be': {
            const start = buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff ? 2 : 0;
            text = swapByteOrder(buffer.slice(start)).toString('utf16le');
            break;
        }
        case 'latin1':
            text = buffer.toString('latin1');
            break;
        case 'utf8':
        default: {
            const start = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
            text = buffer.slice(start).toString('utf8');
            break;
        }
    }

    return { text, encoding: effective };
}

module.exports = {
    normalizeEncoding,
    detectEncoding,
    decodeBuffer,
};
