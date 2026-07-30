// services/output.js
const vscode = require('vscode');

class OutputManager {
    constructor() {
        // Remove the 'markdown' parameter - Output Channels don't support it
        this.channel = vscode.window.createOutputChannel('VizFlow');
        this.isShowing = false;
    }

    clear() {
        this.channel.clear();
        this.isShowing = false;
    }

    /**
     * @param {string} text
     */
    writeLine(text) {
        this.channel.appendLine(text);
    }

    // Helper methods for different formatting styles
    /**
     * @param {string | any[]} text
     */
    writeHeader(text) {
        this.channel.appendLine('');
        this.channel.appendLine('='.repeat(text.length + 10));
        this.channel.appendLine(`  ${text}`);
        this.channel.appendLine('='.repeat(text.length + 10));
        this.channel.appendLine('');
    }

    /**
     * @param {any} text
     */
    writeSubHeader(text) {
        this.channel.appendLine('');
        this.channel.appendLine(`--- ${text} ---`);
        this.channel.appendLine('');
    }

    /**
     * @param {any} label
     * @param {any} value
     */
    writeStats(label, value) {
        this.channel.appendLine(`  • ${label}: ${value}`);
    }

    /**
     * @param {any} text
     */
    writeSuccess(text) {
        this.channel.appendLine(`✅ ${text}`);
    }

    /**
     * @param {any} text
     */
    writeWarning(text) {
        this.channel.appendLine(`⚠️ ${text}`);
    }

    /**
     * @param {any} text
     */
    writeInfo(text) {
        this.channel.appendLine(`ℹ️ ${text}`);
    }

    writeSeparator() {
        this.channel.appendLine('─'.repeat(50));
    }

    show() {
        this.channel.show(true);
        this.isShowing = true;
    }

    dispose() {
        this.channel.dispose();
    }
}

module.exports = new OutputManager();