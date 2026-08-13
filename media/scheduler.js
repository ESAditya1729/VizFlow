/**
 * media/scheduler.js — VizFlow Scheduler UI Logic
 *
 * No inline event handlers (CSP-safe).
 * Uses event delegation on the job list container.
 */

(function () {
    'use strict';

    const vscode = acquireVsCodeApi();

    let jobs = [];
    let history = [];
    let runningJobs = [];

    // ── DOM Refs ────────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);
    const jobList = $('jobList');
    const historyList = $('historyList');
    const addStatus = $('addStatus');

    // ── Stats Bar Refs ──────────────────────────────────────────────────────
    const stats = {
        total: $('totalJobs'),
        running: $('runningJobs'),
        completed: $('completedJobs'),
        failed: $('failedJobs'),
        jobsCount: $('jobsCount'),
        historyCount: $('historyCount')
    };

    // ── Escape helper ───────────────────────────────────────────────────────
    function esc(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Update Stats Bar ────────────────────────────────────────────────────
    function updateStats() {
        if (!stats.total) return;

        const total = jobs.length;
        const running = jobs.filter(j => j.status === 'running' || runningJobs.some(rj => rj.jobId === j.id)).length;
        const completed = jobs.filter(j => j.status === 'completed').length;
        const failed = jobs.filter(j => j.status === 'failed').length;

        stats.total.textContent = total;
        stats.running.textContent = running;
        stats.completed.textContent = completed;
        stats.failed.textContent = failed;

        if (stats.jobsCount) stats.jobsCount.textContent = total;
        if (stats.historyCount) stats.historyCount.textContent = history.length;
    }

    // ── Tab Switching ───────────────────────────────────────────────────────
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const target = $('tab-' + tab.dataset.tab);
            if (target) target.classList.add('active');
        });
    });

    // ── Add Job ─────────────────────────────────────────────────────────────
    $('addJobBtn').addEventListener('click', () => {
        const workflowFile = $('workflowFile').value.trim();
        if (!workflowFile) {
            setStatus('❌ Please select a workflow file', 'error');
            return;
        }

        const job = {
            name: $('jobName').value.trim() || 'Unnamed Job',
            schedule: $('jobSchedule').value.trim() || '0 9 * * *',
            workflowFile,
            retryCount: parseInt($('retryCount').value) || 3,
            retryDelay: parseInt($('retryDelay').value) || 60,
            config: {
                watchFolder: $('watchFolder').value.trim() || null,
                notifications: {
                    email: $('emailNotifications').value.trim() || null
                }
            },
            parameters: {}
        };

        // One-time execution
        const oneTimeDate = $('oneTimeDate').value.trim();
        const oneTimeTime = $('oneTimeTime').value.trim();
        if (oneTimeDate && oneTimeTime) {
            job.runAt = `${oneTimeDate}T${oneTimeTime}:00`;
            job.runOnce = true;
            job.oneTime = true;
        }

        // Run immediately
        if ($('runImmediately').checked) {
            job.runImmediately = true;
            job.schedule = 'immediate';
        }

        const paramsRaw = $('jobParams').value.trim();
        if (paramsRaw) {
            try {
                job.parameters = JSON.parse(paramsRaw);
            } catch (e) {
                setStatus('❌ Invalid JSON parameters', 'error');
                return;
            }
        }

        setStatus('⏳ Scheduling job…', 'info');
        vscode.postMessage({ type: 'addJob', job });
    });

    // ── Browse Workflow ─────────────────────────────────────────────────────
    $('browseWorkflow').addEventListener('click', () => {
        vscode.postMessage({ type: 'pickWorkflow' });
    });

    // ── Clear History ───────────────────────────────────────────────────────
    $('clearHistory').addEventListener('click', () => {
        // confirm() is suppressed in VS Code WebViews — send directly
        vscode.postMessage({ type: 'clearHistory' });
    });

    // ── Refresh History ─────────────────────────────────────────────────────
    const refreshBtn = $('refreshHistory');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'refreshHistory' });
        });
    }


    // ── Event delegation on job list — buttons ──────────────────────────────
    jobList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        const jobCard = btn.closest('[data-job-id]');
        if (!jobCard) return;
        const jobId = jobCard.dataset.jobId;

        switch (btn.dataset.action) {
            case 'runNow':
                vscode.postMessage({ type: 'runNow', jobId });
                break;
            case 'stopJob':
                vscode.postMessage({ type: 'stopJob', jobId });
                break;
            case 'removeJob':
                // confirm() is suppressed in VS Code WebViews — send directly
                vscode.postMessage({ type: 'removeJob', jobId });
                break;
            case 'pauseJob':
                vscode.postMessage({ type: 'pauseJob', jobId });
                break;
            case 'resumeJob':
                vscode.postMessage({ type: 'resumeJob', jobId });
                break;
            case 'scheduleOnce':
                promptScheduleOnce(jobId);
                break;
        }
    });

    // ── Event delegation on job list — toggles ──────────────────────────────
    jobList.addEventListener('change', (e) => {
        const toggle = e.target.closest('input[data-toggle-job]');
        if (!toggle) return;
        const jobId = toggle.dataset.toggleJob;
        vscode.postMessage({ type: 'updateJob', jobId, updates: { enabled: toggle.checked } });
    });

    // ── Render Jobs ──────────────────────────────────────────────────────────
    function renderJobs() {
        if (!jobList) return;

        if (!jobs || jobs.length === 0) {
            jobList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">⏰</div>
                    <div class="empty-state-title">No scheduled jobs</div>
                    <div class="empty-state-sub">Switch to the <strong>Add Job</strong> tab to automate your first workflow.</div>
                </div>`;
            updateStats();
            return;
        }

        jobList.innerHTML = jobs.map(job => {
            const isRunning = runningJobs.some(rj => rj.jobId === job.id);
            const statusClass = isRunning ? 'running' : (job.status || 'idle');
            const statusLabel = isRunning ? 'running' : (job.status || 'idle');
            const fileName = job.workflowFile
                ? job.workflowFile.replace(/\\/g, '/').split('/').pop()
                : 'Embedded';

            // Determine card class based on status
            let cardClass = '';
            if (isRunning) cardClass = 'running';
            else if (job.status === 'failed') cardClass = 'failed';
            else if (job.status === 'completed') cardClass = 'completed';

            return `
                <div class="job-card ${cardClass}" data-job-id="${esc(job.id)}">
                    <div class="job-header">
                        <span class="job-name">
                            <span class="job-icon">${isRunning ? '🔄' : '📋'}</span>
                            ${esc(job.name)}
                            ${job.oneTime ? '<span class="one-time-badge">📅 One-time</span>' : ''}
                        </span>
                        <div class="job-meta-row">
                            <label class="toggle" title="${job.enabled ? 'Disable job' : 'Enable job'}">
                                <input type="checkbox" data-toggle-job="${esc(job.id)}" ${job.enabled ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                            <span class="job-status status-${esc(statusClass)}">${esc(statusLabel)}</span>
                        </div>
                    </div>
                    <div class="job-details">
                        <span>🕐 ${esc(job.schedule)}</span>
                        <span>📁 ${esc(fileName)}</span>
                        <span>📅 Last: ${job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never'}</span>
                        <span>⏳ Next: ${job.nextRun ? new Date(job.nextRun).toLocaleString() : 'N/A'}</span>
                    </div>
                    <div class="job-actions">
                        <button class="btn-sm success" data-action="runNow">▶ Run Now</button>
                        ${isRunning
                    ? `<button class="btn-sm danger" data-action="stopJob">⏹ Stop</button>`
                    : ''}
                        ${job.enabled
                    ? `<button class="btn-sm" data-action="pauseJob">⏸ Pause</button>`
                    : `<button class="btn-sm info" data-action="resumeJob">▶ Resume</button>`}
                        <button class="btn-sm warning" data-action="scheduleOnce">📅 One-time</button>
                        <button class="btn-sm danger" data-action="removeJob">🗑 Remove</button>
                    </div>
                </div>`;
        }).join('');

        updateStats();
    }

    // ── Render History ───────────────────────────────────────────────────────
    function renderHistory() {
        if (!historyList) return;

        if (!history || history.length === 0) {
            historyList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📜</div>
                    <div class="empty-state-sub">No execution history yet.</div>
                </div>`;
            updateStats();
            return;
        }

        historyList.innerHTML = [...history].reverse().map(h => {
            const cls = h.cancelled ? 'cancelled' : (h.status === 'completed' ? 'success' : 'failed');
            const label = h.cancelled ? '⏹ Cancelled' : (h.status === 'completed' ? '✓ Completed' : '✗ Failed');
            const dur = h.duration ? (h.duration / 1000).toFixed(1) + 's' : '—';
            return `<div class="history-item">
                <span>${esc(h.jobName)}</span>
                <span class="history-${cls}">${label}</span>
                <span>${new Date(h.startTime).toLocaleString()}</span>
                <span>${dur}</span>
            </div>`;
        }).join('');

        updateStats();
    }

    // ── Prompt for one-time scheduling ──────────────────────────────────────
    function promptScheduleOnce(jobId) {
        const dateStr = prompt('Date to run (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
        if (!dateStr) return;
        const timeStr = prompt('Time to run (HH:MM, 24-hour):', '09:00');
        if (!timeStr) return;
        vscode.postMessage({ type: 'scheduleOnce', jobId, runAt: `${dateStr}T${timeStr}:00` });
    }

    // ── Status helper ────────────────────────────────────────────────────────
    function setStatus(text, level) {
        const colors = { error: '#c75f8a', success: '#2da680', info: 'var(--vscode-descriptionForeground)' };
        addStatus.innerHTML = `<span style="color:${colors[level] || 'inherit'}">${esc(text)}</span>`;
        addStatus.className = level || '';
    }

    // ── Switch to Add tab and pre-fill workflow path ─────────────────────────
    function prefillWorkflow(filePath) {
        // Switch to Add tab
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const addTab = document.querySelector('.tab[data-tab="add"]');
        if (addTab) addTab.classList.add('active');
        const addContent = $('tab-add');
        if (addContent) addContent.classList.add('active');

        // Fill the workflow file input
        const wfInput = $('workflowFile');
        if (wfInput) wfInput.value = filePath;

        // Auto-populate a job name from the filename
        const nameInput = $('jobName');
        if (nameInput && !nameInput.value.trim()) {
            const base = filePath.replace(/\\/g, '/').split('/').pop().replace(/\.vizflow$/i, '');
            nameInput.value = base || '';
        }
    }

    // ── Message Handler ──────────────────────────────────────────────────────
    window.addEventListener('message', ({ data: msg }) => {
        switch (msg.type) {
            case 'refreshJobs':
                jobs = msg.jobs || [];
                history = msg.history || [];
                runningJobs = msg.runningJobs || [];
                renderJobs();
                renderHistory();
                break;

            case 'refreshHistory':
                // Re-fetch history from backend
                vscode.postMessage({ type: 'getHistory' });
                break;

            case 'jobAddedSuccess':
                setStatus('✅ Job scheduled successfully!', 'success');
                setTimeout(() => {
                    addStatus.innerHTML = '';
                    addStatus.className = '';
                }, 3000);
                // Clear the form
                ['jobName', 'jobSchedule', 'workflowFile', 'watchFolder',
                    'emailNotifications', 'oneTimeDate', 'oneTimeTime', 'jobParams'].forEach(id => {
                        const el = $(id);
                        if (el) el.value = id === 'jobSchedule' ? '0 9 * * *' : '';
                    });
                const runImmediately = $('runImmediately');
                if (runImmediately) runImmediately.checked = false;
                break;

            case 'workflowPicked':
                $('workflowFile').value = msg.filePath;
                break;

            case 'prefillWorkflow':
                prefillWorkflow(msg.filePath);
                break;

            case 'error':
                setStatus(`❌ ${msg.message}`, 'error');
                break;

            case 'jobStarted':
                renderJobs();
                break;

            case 'jobCompleted':
            case 'jobFailed':
            case 'jobCancelled':
                renderJobs();
                renderHistory();
                break;
        }
    });

    // ── Ready ────────────────────────────────────────────────────────────────
    vscode.postMessage({ type: 'ready' });

})();