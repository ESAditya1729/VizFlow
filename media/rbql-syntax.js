// RBQL Syntax Highlighter for VizFlow
'use strict';

// ── Token definitions ────────────────────────────────────────────────────────
// Order matters: earlier entries win when two patterns could match at the same
// position.  Each entry is [cssClass, regexSource].
// A single master regex is built from these; the alternation ensures the
// longest / highest-priority match always wins.

const RBQL_KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'ASC', 'DESC',
    'LIMIT', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AND',
    'OR', 'NOT', 'IN', 'LIKE', 'IS', 'NULL', 'TRUE', 'FALSE',
    'HAVING', 'UNION', 'ALL', 'DISTINCT', 'AS', 'WITH', 'RECURSIVE'
];

const RBQL_FUNCTIONS = [
    'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'LEN', 'LENGTH',
    'UPPER', 'LOWER', 'TRIM', 'SUBSTR', 'SUBSTRING',
    'REPLACE', 'CONCAT', 'COALESCE', 'CAST',
    'ROUND', 'CEIL', 'FLOOR', 'ABS', 'POW', 'SQRT',
    'NOW', 'DATE', 'TIME', 'YEAR', 'MONTH', 'DAY',
    'STRING_AGG', 'ARRAY_AGG', 'JSON_EXTRACT'
];

// ── Highlighter ──────────────────────────────────────────────────────────────

class RBQLSyntaxHighlighter {
    constructor() {
        // Build one master regex with named-ish groups via alternation.
        // Priority (first branch wins):
        //   1. single-line comment  //…
        //   2. multi-line comment   /*…*/
        //   3. single-quoted string '…'
        //   4. double-quoted string "…"
        //   5. function call        NAME(
        //   6. keyword              SELECT / WHERE / …
        //   7. number               123 / 45.67
        //   8. symbol operator      == != <> >= <= + - * / %

        const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const funcAlt    = RBQL_FUNCTIONS.map(esc).join('|');
        const keywordAlt = RBQL_KEYWORDS.map(esc).join('|');

        // Each branch is wrapped in a capturing group so we can identify which
        // branch matched by checking which group is non-undefined.
        // Group index:  1=line-comment  2=block-comment  3=sq-string
        //               4=dq-string     5=function        6=keyword
        //               7=number        8=operator
        this._master = new RegExp(
            '(//[^\\n]*)' +                          // 1 line comment
            '|(/\\*[\\s\\S]*?\\*/)' +               // 2 block comment
            '|(\'[^\'\\\\]*(?:\\\\.[^\'\\\\]*)*\')' + // 3 single-quoted
            '|("(?:[^"\\\\]|\\\\.)*")' +             // 4 double-quoted
            `|(\\b(?:${funcAlt})\\s*(?=\\())` +      // 5 function name (lookahead for '(')
            `|(\\b(?:${keywordAlt})\\b)` +           // 6 keyword
            '|(\\b\\d+(?:\\.\\d+)?\\b)' +            // 7 number
            '|(==|!=|<>|>=|<=|\\+|-|\\*|/|%)' ,     // 8 symbol operator
            'gi'
        );
    }

    /**
     * Convert raw query text to HTML with syntax-highlighted spans.
     * Uses a single-pass tokeniser — no multi-pass, no stash/restore.
     * @param {string} query
     * @returns {string} safe HTML
     */
    highlight(query) {
        if (!query) return '';

        const CLASS = [
            null,                  // 0 – unused (full match)
            'rbql-comment',        // 1 line comment
            'rbql-comment',        // 2 block comment
            'rbql-string',         // 3 single-quoted
            'rbql-string',         // 4 double-quoted
            'rbql-function',       // 5 function
            'rbql-keyword',        // 6 keyword
            'rbql-number',         // 7 number
            'rbql-operator',       // 8 operator
        ];

        // Reset lastIndex before every use — the regex has the /g flag so it
        // is stateful; resetting here makes highlight() safe to call repeatedly.
        this._master.lastIndex = 0;

        let result = '';
        let lastIndex = 0;

        let match;
        while ((match = this._master.exec(query)) !== null) {
            // Append the unstyled text before this match (HTML-escaped)
            if (match.index > lastIndex) {
                result += this._esc(query.slice(lastIndex, match.index));
            }

            // Find which capturing group fired
            let groupIndex = -1;
            for (let i = 1; i < match.length; i++) {
                if (match[i] !== undefined) { groupIndex = i; break; }
            }

            const cls  = CLASS[groupIndex] || '';
            const text = this._esc(match[0]);

            if (cls) {
                result += `<span class="${cls}">${text}</span>`;
            } else {
                result += text;
            }

            lastIndex = match.index + match[0].length;
        }

        // Append any trailing text
        if (lastIndex < query.length) {
            result += this._esc(query.slice(lastIndex));
        }

        return result;
    }

    /**
     * HTML-escape a plain text string
     * @param {string} text
     */
    _esc(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

// ── Page integration ─────────────────────────────────────────────────────────

const highlighter = new RBQLSyntaxHighlighter();

function initSyntaxHighlighting() {
    const editor = /** @type {HTMLTextAreaElement} */ (document.getElementById('queryEditor'));
    if (!editor) return;

    // Wrap the textarea in a relative-positioned container
    const wrapper = document.createElement('div');
    wrapper.className = 'rbql-editor-wrapper';
    if (!editor.parentNode) return;
    editor.parentNode.insertBefore(wrapper, editor);
    wrapper.appendChild(editor);

    // The highlight overlay sits behind the textarea
    const overlay = document.createElement('div');
    overlay.className = 'rbql-highlight-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(overlay);

    let rafId = null;

    function syncHighlight() {
        // Use requestAnimationFrame to batch DOM updates and prevent
        // layout thrashing that causes cursor flickering.
        if (rafId !== null) return;
        rafId = requestAnimationFrame(function() {
            rafId = null;
            overlay.innerHTML = highlighter.highlight(editor.value);
            overlay.scrollTop  = editor.scrollTop;
            overlay.scrollLeft = editor.scrollLeft;
        });
    }

    editor.addEventListener('input',  syncHighlight);
    editor.addEventListener('scroll', () => {
        overlay.scrollTop  = editor.scrollTop;
        overlay.scrollLeft = editor.scrollLeft;
    });

    // Initial render (immediate, no rAF needed)
    overlay.innerHTML = highlighter.highlight(editor.value);

    // Re-sync when the textarea is resized
    new ResizeObserver(syncHighlight).observe(editor);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSyntaxHighlighting);
} else {
    initSyntaxHighlighting();
}
