const vscode = require('vscode');

/**
 * Shows a webview panel with information about the creator of VizFlow.
 *
 * @param {vscode.ExtensionContext} context
 * @returns {() => void}
 */
function aboutCommand(context) {
    return function () {
        const panel = vscode.window.createWebviewPanel(
            'vizflowAbout',
            'VizFlow: About / Creator',
            vscode.ViewColumn.One,
            { enableScripts: false }
        );

        panel.webview.html = getAboutHtml();
    };
}

function getAboutHtml() {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>VizFlow — About / Creator</title>
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
            font-size: 14px;
            line-height: 1.6;
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-editor-foreground, #d4d4d4);
            display: flex;
            justify-content: center;
            padding: 48px 16px;
        }

        .card {
            width: 100%;
            max-width: 520px;
            background: var(--vscode-sideBar-background, #252526);
            border: 1px solid var(--vscode-panel-border, #3c3c3c);
            border-radius: 8px;
            overflow: hidden;
        }

        /* ── Header band ── */
        .card-header {
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, #ffffff);
            padding: 28px 32px 24px;
            text-align: center;
        }

        .avatar {
            width: 72px;
            height: 72px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.18);
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 16px;
            font-size: 32px;
            font-weight: 700;
            letter-spacing: -1px;
            color: #ffffff;
        }

        .card-header h1 {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 4px;
        }

        .card-header .role {
            font-size: 13px;
            opacity: 0.85;
            font-weight: 400;
        }

        /* ── Body rows ── */
        .card-body {
            padding: 24px 32px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .info-row {
            display: flex;
            align-items: flex-start;
            gap: 12px;
        }

        .info-label {
            min-width: 80px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: var(--vscode-descriptionForeground, #858585);
            padding-top: 2px;
        }

        .info-value {
            font-size: 14px;
            color: var(--vscode-editor-foreground, #d4d4d4);
        }

        .badge {
            display: inline-block;
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            background: var(--vscode-badge-background, #0e639c);
            color: var(--vscode-badge-foreground, #ffffff);
        }

        hr {
            border: none;
            border-top: 1px solid var(--vscode-panel-border, #3c3c3c);
            margin: 0;
        }

        /* ── Extension info strip ── */
        .ext-strip {
            padding: 14px 32px;
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: var(--vscode-descriptionForeground, #858585);
        }

        .ext-strip strong {
            color: var(--vscode-editor-foreground, #d4d4d4);
        }
    </style>
</head>
<body>
    <div class="card">

        <div class="card-header">
            <div class="avatar">AM</div>
            <h1>Aditya Mukherjee</h1>
            <div class="role">Application Developer · Azure Cloud FullStack</div>
        </div>

        <div class="card-body">

            <div class="info-row">
                <span class="info-label">Company</span>
                <span class="info-value">
                    <span class="badge">IBM</span>
                </span>
            </div>

            <div class="info-row">
                <span class="info-label">Role</span>
                <span class="info-value">Application Developer — Azure Cloud FullStack</span>
            </div>

            <div class="info-row">
                <span class="info-label">Creator of</span>
                <span class="info-value">VizFlow — CSV Analysis &amp; Visualization for VS Code</span>
            </div>

        </div>

        <hr />

        <div class="ext-strip">
            <span>Extension: <strong>VizFlow</strong></span>
            <span>Publisher: <strong>IBM</strong></span>
        </div>

    </div>
</body>
</html>`;
}

module.exports = aboutCommand;
