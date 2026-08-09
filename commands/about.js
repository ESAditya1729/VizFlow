const vscode = require('vscode');
const pkg = require('../package.json');

/**
 * Shows a webview panel with information about the creator of VizFlow.
 *
 * @returns {() => void}
 */
function aboutCommand() {
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
    const version = pkg.version || '0.0.0';
    const publisher = pkg.publisher || 'IBM';
    const displayName = pkg.displayName || 'VizFlow';

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
            background: linear-gradient(135deg, var(--vscode-editor-background, #1e1e1e), var(--vscode-sideBar-background, #252526));
            color: var(--vscode-editor-foreground, #d4d4d4);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 32px 16px;
        }

        .card {
            width: 100%;
            max-width: 560px;
            background: rgba(37, 37, 38, 0.95);
            border: 1px solid var(--vscode-panel-border, #3c3c3c);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
            backdrop-filter: blur(8px);
        }

        .card-header {
            background: linear-gradient(135deg, #2563eb, #7c3aed 70%, #0f766e);
            color: #fff;
            padding: 28px 32px 24px;
            text-align: center;
        }

        .avatar {
            width: 78px;
            height: 78px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 16px;
            font-size: 32px;
            font-weight: 700;
            letter-spacing: -1px;
            color: #ffffff;
            border: 2px solid rgba(255,255,255,0.35);
        }

        .card-header h1 {
            font-size: 22px;
            font-weight: 700;
            margin-bottom: 6px;
        }

        .card-header .role {
            font-size: 13px;
            opacity: 0.95;
            font-weight: 500;
        }

        .hero-tag {
            display: inline-block;
            margin-top: 12px;
            padding: 6px 12px;
            border-radius: 999px;
            background: rgba(255,255,255,0.16);
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }

        .card-body {
            padding: 24px 32px 18px;
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
            min-width: 90px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--vscode-descriptionForeground, #858585);
            padding-top: 2px;
        }

        .info-value {
            font-size: 14px;
            color: var(--vscode-editor-foreground, #d4d4d4);
        }

        .badge {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
            background: var(--vscode-badge-background, #2563eb);
            color: var(--vscode-badge-foreground, #ffffff);
        }

        .link-row {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 4px;
        }

        .link-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            text-decoration: none;
            padding: 9px 12px;
            border-radius: 10px;
            border: 1px solid var(--vscode-panel-border, #3c3c3c);
            background: var(--vscode-input-background, #2d2d2d);
            color: var(--vscode-editor-foreground, #d4d4d4);
            font-size: 13px;
            font-weight: 600;
            transition: transform 120ms ease, border-color 120ms ease;
        }

        .link-btn:hover {
            transform: translateY(-1px);
            border-color: var(--vscode-textLink-foreground, #3794ff);
        }

        hr {
            border: none;
            border-top: 1px solid var(--vscode-panel-border, #3c3c3c);
            margin: 0;
        }

        .ext-strip {
            padding: 14px 32px 16px;
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px;
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
            <div class="hero-tag">Built with passion for better data workflows</div>
        </div>

        <div class="card-body">
            <div class="info-row">
                <span class="info-label">Company</span>
                <span class="info-value"><span class="badge">IBM</span></span>
            </div>

            <div class="info-row">
                <span class="info-label">Role</span>
                <span class="info-value">Application Developer — Azure Cloud FullStack</span>
            </div>

            <div class="info-row">
                <span class="info-label">Creator of</span>
                <span class="info-value">VizFlow — CSV analysis, transformation, and visualization for VS Code</span>
            </div>

            <div class="info-row">
                <span class="info-label">Connect</span>
                <span class="info-value">
                    <div class="link-row">
                        <a class="link-btn" href="https://github.com/ESAditya1729/VizFlow.git" target="_blank" rel="noopener noreferrer">GitHub</a>
                        <a class="link-btn" href="https://www.linkedin.com/in/aditya-mukherjee-b15428239/" target="_blank" rel="noopener noreferrer">LinkedIn</a>
                    </div>
                </span>
            </div>
        </div>

        <hr />

        <div class="ext-strip">
            <span>Extension: <strong>${displayName}</strong></span>
            <span>Version: <strong>${version}</strong></span>
            <span>Publisher: <strong>${publisher}</strong></span>
        </div>
    </div>
</body>
</html>`;
}

module.exports = aboutCommand;
