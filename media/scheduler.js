/**
 * media/scheduler.js — VizFlow Scheduler UI Logic
 *
 * No inline event handlers (CSP-safe). Uses event delegation on
 * the job list container and a friendly, interactive schedule builder
 * that generates cron expressions under the hood.
 */

(function () {
    'use strict';

    const vscode = acquireVsCodeApi();

    let jobs = [];
    let history = [];
    let runningJobs = [];
    let editingJobId = null;
    let onceJobId = null;
    let currentPreset = 'daily';

    // ── DOM Refs ────────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);
    const jobList = $('jobList');
    const historyList = $('historyList');
    const addStatus = $('addStatus');
    const jobSearch = $('jobSearch');
    const dowRow = $('dowRow');
    const presetRow = $('presetRow');

    // ── Stats Bar Refs ──────────────────────────────────────────────────────
    const stats = {
        total: $('totalJobs'),
        running: $('runningJobs'),
        completed: $('completedJobs'),
        failed: $('failedJobs'),
        jobsCount: $('jobsCount'),
        historyCount: $('historyCount')
    };

    // ── Small helpers ───────────────────────────────────────────────────────
    function esc(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    function ordinal(n) {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    function clampInt(val, def, min, max) {
        const n = parseInt(val, 10);
        if (isNaN(n)) return def;
        return Math.min(max, Math.max(min, n));
    }

    function timeOf(input) {
        const v = (input.value || '09:00').split(':');
        return [parseInt(v[0], 10) || 0, parseInt(v[1], 10) || 0];
    }

    // ── Timezone helpers (timezone-aware next-run preview) ─────────────────
    function isValidTimezone(tz) {
        if (!tz) return true;
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: tz });
            return true;
        } catch (err) {
            void err;
            return false;
        }
    }

    function tzParts(date, tz) {
        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
        const o = {};
        fmt.formatToParts(date).forEach(p => {
            if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10);
        });
        return o;
    }

    function tzOffsetMs(date, tz) {
        const utcMs = date.getTime();
        const o = tzParts(date, tz);
        return Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - utcMs;
    }

    function zonedTimeToUtc(year, month, day, hour, minute, tz) {
        const wallUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
        let off = tzOffsetMs(new Date(wallUtc - 6 * 3600 * 1000), tz);
        let utc = wallUtc - off;
        const off2 = tzOffsetMs(new Date(utc), tz);
        if (off2 !== off) utc = wallUtc - off2;
        return new Date(utc);
    }

    // ── Cron parsing (5/6 field, subset used by the builder) ───────────────
    // Returns: Set of matching values, null = wildcard, false = invalid.
    function expandCronField(expr, min, max) {
        expr = String(expr).trim();
        if (expr === '*') return null;
        const out = new Set();
        const parts = expr.split(',');
        for (const part of parts) {
            const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
            if (!m) return false;
            const step = m[3] !== undefined ? parseInt(m[3], 10) : 1;
            if (step < 1) return false;
            let start, end;
            if (m[1] === '*') { start = min; end = max; }
            else {
                start = parseInt(m[1], 10);
                end = m[2] !== undefined ? parseInt(m[2], 10) : start;
            }
            if (start < min || end > max || start > end) return false;
            for (let v = start; v <= end; v += step) {
                out.add(max === 7 && v === 7 ? 0 : v); // dow: 7 === Sunday
            }
        }
        return out;
    }

    function parseCron(expr) {
        const f = String(expr).trim().split(/\s+/);
        if (f.length === 5) return buildFields(f[0], f[1], f[2], f[3], f[4]);
        if (f.length === 6) return buildFields(f[1], f[2], f[3], f[4], f[5]); // drop seconds
        return null;
    }

    function buildFields(min, hour, dom, mon, dow) {
        const fields = [
            expandCronField(min, 0, 59),
            expandCronField(hour, 0, 23),
            expandCronField(dom, 1, 31),
            expandCronField(mon, 1, 12),
            expandCronField(dow, 0, 7)
        ];
        if (fields.some(f => f === false)) return null;
        return { min: fields[0], hour: fields[1], dom: fields[2], mon: fields[3], dow: fields[4] };
    }

    function matchField(value, field) {
        return field === null || field.has(value);
    }

    // ── Next-run calculation (Vixie-style dom/dow OR semantics) ────────────
    function cronNextRun(expr, tz) {
        const c = parseCron(expr);
        if (!c) return null;
        if (tz && !isValidTimezone(tz)) return null;
        const now = new Date();
        const startYear = now.getFullYear();
        for (let year = startYear; year <= startYear + 10; year++) {
            for (let month = 1; month <= 12; month++) {
                if (!matchField(month, c.mon)) continue;
                const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
                for (let day = 1; day <= dim; day++) {
                    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
                    const domOk = matchField(day, c.dom);
                    const dowOk = matchField(dow, c.dow);
                    const dayOk = (c.dom !== null && c.dow !== null) ? (domOk || dowOk) : (domOk && dowOk);
                    if (!dayOk) continue;
                    for (let hour = 0; hour < 24; hour++) {
                        if (!matchField(hour, c.hour)) continue;
                        for (let minute = 0; minute < 60; minute++) {
                            if (!matchField(minute, c.min)) continue;
                            const when = tz
                                ? zonedTimeToUtc(year, month, day, hour, minute, tz)
                                : new Date(year, month - 1, day, hour, minute, 0);
                            if (when.getTime() > now.getTime()) return when;
                        }
                    }
                }
            }
        }
        return null;
    }

    // ── Human-friendly cron description ────────────────────────────────────
    const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    function arithStep(arr) {
        if (!arr || arr.length < 2) return null;
        const s = arr[1] - arr[0];
        if (s < 2) return null;
        return arr.every((v, i) => v === arr[0] + i * s) ? s : null;
    }

    function describeCron(cron) {
        const c = parseCron(cron);
        if (!c) return 'Custom cron expression';

        const mins = c.min === null ? null : [...c.min].sort((a, b) => a - b);
        const hours = c.hour === null ? null : [...c.hour].sort((a, b) => a - b);
        const doms = c.dom === null ? null : [...c.dom].sort((a, b) => a - b);
        const mons = c.mon === null ? null : [...c.mon].sort((a, b) => a - b);
        const dows = c.dow === null ? null : [...c.dow].sort((a, b) => a - b);

        if (mins === null && hours === null) return 'Every minute';

        const timeAt = (h, m) => {
            const period = h >= 12 ? 'PM' : 'AM';
            const hh = ((h + 11) % 12) + 1;
            return `${hh}:${String(m).padStart(2, '0')} ${period}`;
        };

        if (hours === null) {
            const minStep = arithStep(mins);
            if (minStep && mins[0] === 0) return `Every ${minStep} minutes`;
            if (mins.length === 1) return `Every hour at minute ${mins[0]}`;
            if (minStep) return `Every hour at minute ${mins[0]} (every ${minStep} minutes)`;
            return `Every hour at minutes ${mins.join(', ')}`;
        }

        const hourStep = arithStep(hours);
        if (hourStep) {
            const m = mins === null ? 0 : mins[0];
            return `Every ${hourStep} hours at minute ${m}`;
        }

        const h = hours[0];
        const m = mins === null ? 0 : mins[0];
        const time = timeAt(h, m);

        if (hours.length > 1) {
            return `At ${hours.map(hh => timeAt(hh, m)).join(', ')} on matching days`;
        }

        if (mons === null && doms === null && dows === null) return `${time} every day`;

        if (doms && doms.length === 1 && mons === null && dows === null) {
            return `${time} on the ${ordinal(doms[0])} of every month`;
        }

        if (dows && dows.length > 0 && doms === null && mons === null) {
            return `${time} on ${dows.map(d => DOW_SHORT[d]).join(', ')}`;
        }

        if (mons && mons.length === 1) {
            const when = doms && doms.length === 1
                ? `${MONTHS[mons[0] - 1]} ${ordinal(doms[0])}`
                : MONTHS[mons[0] - 1];
            return `${time} on ${when}`;
        }

        let extra = '';
        if (dows && dows.length) extra += ` on ${dows.map(d => DOW_SHORT[d]).join(', ')}`;
        if (doms && doms.length) extra += ` on day ${doms.join(',')}`;
        return `${time}${extra}`;
    }

    // ── Schedule builder ────────────────────────────────────────────────────
    function currentCron() {
        switch (currentPreset) {
            case 'everyMinute': return '* * * * *';
            case 'hourly': {
                const every = clampInt($('schedHourlyEvery').value, 1, 1, 24);
                const min = clampInt($('schedHourlyMinute').value, 0, 0, 59);
                return every > 1 ? `${min} */${every} * * *` : `${min} * * * *`;
            }
            case 'daily': {
                const t = timeOf($('schedDailyTime'));
                return `${t[1]} ${t[0]} * * *`;
            }
            case 'weekly': {
                const days = [...dowRow.querySelectorAll('.dow-chip.active')]
                    .map(chip => chip.dataset.dow);
                if (days.length === 0) return '';
                const t = timeOf($('schedWeeklyTime'));
                return `${t[1]} ${t[0]} * * ${days.join(',')}`;
            }
            case 'monthly': {
                const d = clampInt($('schedMonthlyDay').value, 1, 1, 31);
                const t = timeOf($('schedMonthlyTime'));
                return `${t[1]} ${t[0]} ${d} * *`;
            }
            case 'custom': return $('schedCustomCron').value.trim();
            default: return '';
        }
    }

    function fmtOncePreview(date, time) {
        const when = new Date(`${date}T${time}:00`);
        const label = when.toLocaleString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric',
            year: 'numeric', hour: 'numeric', minute: '2-digit'
        });
        return when > new Date()
            ? `Once on ${label}`
            : 'Once on ' + when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }

    function updatePreview() {
        if (currentPreset === 'once') {
            const date = $('schedOnceDate').value;
            const time = $('schedOnceTime').value;
            if (date && time) {
                $('previewHuman').textContent = fmtOncePreview(date, time);
                $('previewCron').textContent = `${date}T${time}:00`;
                const when = new Date(`${date}T${time}:00`);
                $('previewNext').textContent = when > new Date() ? when.toLocaleString() : 'Already in the past';
                $('previewNext').classList.toggle('error', when <= new Date());
            } else {
                $('previewHuman').textContent = 'Once — pick a date and time';
                $('previewCron').textContent = '—';
                $('previewNext').textContent = '—';
                $('previewNext').classList.remove('error');
            }
            return;
        }

        const cron = currentCron();
        $('previewCron').textContent = cron || '—';
        if (!cron) {
            $('previewHuman').textContent = 'Pick a schedule';
            $('previewNext').textContent = '—';
            $('previewNext').classList.remove('error');
            return;
        }

        const desc = describeCron(cron);
        $('previewHuman').textContent = desc;
        const tz = $('jobTimezone').value.trim() || null;
        const next = cronNextRun(cron, tz);
        $('previewNext').textContent = next ? next.toLocaleString() : '—';
        $('previewNext').classList.toggle('error', !next);
    }

    function setPreset(name) {
        currentPreset = name;
        presetRow.querySelectorAll('.preset-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.preset === name);
        });
        document.querySelectorAll('.preset-panel').forEach(p => {
            p.classList.toggle('hidden', p.dataset.panel !== name);
        });
        updatePreview();
    }

    // ── Schedule builder select population ────────────────────────────────
    (function buildSelects() {
        const every = $('schedHourlyEvery');
        for (let i = 1; i <= 24; i++) {
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = i === 1 ? '1 hour' : `${i} hours`;
            every.appendChild(o);
        }
        every.value = '1';

        const minSel = $('schedHourlyMinute');
        for (let i = 0; i < 60; i++) {
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = pad(i);
            minSel.appendChild(o);
        }
        minSel.value = '0';

        const daySel = $('schedMonthlyDay');
        for (let i = 1; i <= 31; i++) {
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = `${i}${ordinal(i)}`;
            daySel.appendChild(o);
        }
        daySel.value = '1';
    })();

    // ── Builder event wiring ────────────────────────────────────────────────
    presetRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.preset-btn');
        if (!btn) return;
        setPreset(btn.dataset.preset);
    });

    dowRow.addEventListener('click', (e) => {
        const chip = e.target.closest('.dow-chip');
        if (!chip) return;
        chip.classList.toggle('active');
        updatePreview();
    });

    ['schedOnceDate', 'schedOnceTime', 'schedDailyTime', 'schedWeeklyTime',
        'schedMonthlyTime', 'schedHourlyEvery', 'schedHourlyMinute',
        'schedMonthlyDay', 'jobTimezone'].forEach(id => {
            const el = $(id);
            if (el) el.addEventListener('input', updatePreview);
        });

    let customDebounce = null;
    $('schedCustomCron').addEventListener('input', () => {
        clearTimeout(customDebounce);
        customDebounce = setTimeout(updatePreview, 200);
    });

    $('previewCopy').addEventListener('click', () => {
        copyText($('previewCron').textContent);
        const btn = $('previewCopy');
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '⧉'; }, 1200);
    });

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
        } else {
            legacyCopy(text);
        }
    }
    function legacyCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (err) { void err; }
        document.body.removeChild(ta);
    }

    // ── Cron → form (edit mode) ─────────────────────────────────────────────
    function selectDays(dowList) {
        dowRow.querySelectorAll('.dow-chip').forEach(chip => {
            chip.classList.toggle('active', dowList.includes(parseInt(chip.dataset.dow, 10)));
        });
    }

    function applyCronToForm(cron) {
        if (!cron || cron === 'immediate') cron = '0 9 * * *';
        const c = parseCron(cron);
        if (!c || String(cron).trim().split(/\s+/).length === 6) {
            setPreset('custom');
            $('schedCustomCron').value = cron;
            return;
        }

        if (c.min === null && c.hour === null) { setPreset('everyMinute'); return; }

        const hours = c.hour === null ? [] : [...c.hour];
        const mins = c.min === null ? [] : [...c.min].sort((a, b) => a - b);
        const doms = c.dom === null ? null : [...c.dom];
        const mons = c.mon === null ? null : [...c.mon];
        const dows = c.dow === null ? null : [...c.dow];

        if (c.hour === null) {
            setPreset('hourly');
            $('schedHourlyMinute').value = String(mins.length ? mins[0] : 0);
            const step = arithStep(mins);
            $('schedHourlyEvery').value = String(step || 1);
            return;
        }

        if (hours.length === 1 && mins.length === 1) {
            const timeVal = `${pad(hours[0])}:${pad(mins[0])}`;
            if (mons === null && doms === null && dows === null) {
                setPreset('daily');
                $('schedDailyTime').value = timeVal;
                return;
            }
            if (mons === null && doms === null && dows && dows.length) {
                setPreset('weekly');
                $('schedWeeklyTime').value = timeVal;
                selectDays(dows);
                return;
            }
            if (mons === null && dows === null && doms && doms.length === 1) {
                setPreset('monthly');
                $('schedMonthlyDay').value = String(doms[0]);
                $('schedMonthlyTime').value = timeVal;
                return;
            }
        }

        setPreset('custom');
        $('schedCustomCron').value = cron;
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

    // ── Live clock ──────────────────────────────────────────────────────────
    function tickClock() {
        const el = $('liveClock');
        if (el) el.textContent = new Date().toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }
    tickClock();
    setInterval(tickClock, 1000);

    // ── Tab Switching ───────────────────────────────────────────────────────
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    document.querySelectorAll('.stat-card').forEach(card => {
        card.addEventListener('click', () => switchTab(card.dataset.jump));
    });

    function switchTab(name) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const tab = document.querySelector(`.tab[data-tab="${name}"]`);
        if (tab) tab.classList.add('active');
        const content = $('tab-' + name);
        if (content) content.classList.add('active');
    }

    $('addJobQuickBtn').addEventListener('click', () => switchTab('add'));

    // ── Job search filter ───────────────────────────────────────────────────
    jobSearch.addEventListener('input', renderJobs);

    // ── Add / Edit Job ─────────────────────────────────────────────────────
    function parseParams() {
        const raw = $('jobParams').value.trim();
        if (!raw) return {};
        try {
            return JSON.parse(raw);
        } catch (err) {
            void err;
            setStatus('❌ Invalid JSON parameters', 'error');
            return null;
        }
    }

    function submitAddEdit() {
        try {
            handleAddEditSubmit();
        } catch (err) {
            setStatus('❌ ' + err.message, 'error');
        }
    }

    function handleAddEditSubmit() {
        const workflowFile = $('workflowFile').value.trim();
        if (!workflowFile) {
            setStatus('❌ Please select a workflow file', 'error');
            return;
        }

        const name = $('jobName').value.trim() || 'Unnamed Job';
        const timezone = $('jobTimezone').value.trim() || null;

        const config = {
            watchFolder: $('watchFolder').value.trim() || null,
            fileFilter: $('fileFilter').value.trim() || null,
            notifications: {
                email: $('emailNotifications').value.trim() || null,
                webhook: $('webhookNotifications').value.trim() || null
            },
            retryCount: clampInt($('retryCount').value, 3, 0, 10),
            retryDelay: clampInt($('retryDelay').value, 60, 0, 86400)
        };

        const parameters = parseParams();
        if (parameters === null) return;

        // Edit mode — update the existing job in place
        if (editingJobId) {
            if (currentPreset === 'once') {
                const runAt = onceRunAt();
                if (!runAt) return;
                const t = new Date(runAt);
                const updates = {
                    name,
                    schedule: `${t.getMinutes()} ${t.getHours()} ${t.getDate()} ${t.getMonth() + 1} *`,
                    timezone,
                    workflowFile,
                    parameters,
                    config,
                    oneTime: true,
                    runOnce: true,
                    runAt
                };
                setStatus('⏳ Updating job…', 'info');
                vscode.postMessage({ type: 'updateJob', jobId: editingJobId, updates });
                return;
            }

            const cron = currentCron();
            if (!cron || !cronNextRun(cron, timezone)) {
                if (timezone && !isValidTimezone(timezone)) {
                    setStatus(`❌ Invalid timezone: "${timezone}"`, 'error');
                } else {
                    setStatus('❌ Invalid cron expression', 'error');
                }
                return;
            }
            const updates = {
                name,
                schedule: cron,
                timezone,
                workflowFile,
                parameters,
                config,
                oneTime: false,
                runOnce: false,
                runAt: null
            };
            setStatus('⏳ Updating job…', 'info');
            vscode.postMessage({ type: 'updateJob', jobId: editingJobId, updates });
            return;
        }

        const baseJob = {
            name,
            schedule: '',
            timezone,
            workflowFile,
            retryCount: config.retryCount,
            retryDelay: config.retryDelay,
            config,
            parameters
        };

        if (currentPreset === 'once') {
            const runAt = onceRunAt();
            if (!runAt) return;
            baseJob.runAt = runAt;
            baseJob.runOnce = true;
            baseJob.oneTime = true;
        } else {
            const cron = currentCron();
            if (!cron || !cronNextRun(cron, timezone)) {
                if (timezone && !isValidTimezone(timezone)) {
                    setStatus(`❌ Invalid timezone: "${timezone}"`, 'error');
                } else {
                    setStatus('❌ Invalid cron expression', 'error');
                }
                return;
            }
            baseJob.schedule = cron;
            if ($('runImmediately').checked) {
                baseJob.runImmediately = true;
                baseJob.schedule = 'immediate';
            }
        }

        setStatus('⏳ Scheduling job…', 'info');
        vscode.postMessage({ type: 'addJob', job: baseJob });
    }

    $('addJobBtn').addEventListener('click', submitAddEdit);

    function onceRunAt() {
        const date = $('schedOnceDate').value;
        const time = $('schedOnceTime').value;
        if (!date || !time) {
            setStatus('❌ Pick a date and time for the one-time run', 'error');
            return null;
        }
        const runAt = `${date}T${time}:00`;
        if (new Date(runAt) <= new Date()) {
            setStatus('❌ One-time run must be in the future', 'error');
            return null;
        }
        return runAt;
    }

    // ── Cancel Edit ─────────────────────────────────────────────────────────
    $('cancelEditBtn').addEventListener('click', cancelEdit);

    function cancelEdit() {
        editingJobId = null;
        $('editJobId').value = '';
        document.body.classList.remove('editing');
        $('addJobBtn').textContent = '➕ Schedule Job';
        clearForm();
        switchTab('add');
        setStatus('', 'info');
        addStatus.innerHTML = '';
    }

    function clearForm() {
        ['jobName', 'workflowFile', 'watchFolder', 'fileFilter',
            'emailNotifications', 'webhookNotifications', 'jobParams',
            'jobTimezone', 'schedOnceDate', 'schedOnceTime'].forEach(id => {
                const el = $(id);
                if (el) el.value = '';
            });
        $('schedCustomCron').value = '0 9 * * *';
        $('schedDailyTime').value = '09:00';
        $('schedWeeklyTime').value = '09:00';
        $('schedMonthlyTime').value = '09:00';
        $('schedHourlyEvery').value = '1';
        $('schedHourlyMinute').value = '0';
        $('schedMonthlyDay').value = '1';
        $('retryCount').value = '3';
        $('retryDelay').value = '60';
        const runImmediately = $('runImmediately');
        if (runImmediately) runImmediately.checked = false;
        selectDays([]);
        setPreset('daily');
        updateTimezoneHint();
    }

    function fillEditForm(job) {
        editingJobId = job.id;
        $('editJobId').value = job.id;
        document.body.classList.add('editing');
        $('addJobBtn').textContent = '💾 Update Job';

        const cfg = job.config || {};
        $('jobName').value = job.name || '';
        $('jobTimezone').value = job.timezone || '';
        $('workflowFile').value = job.workflowFile || '';
        $('watchFolder').value = cfg.watchFolder || '';
        $('fileFilter').value = cfg.fileFilter || '';
        const notif = cfg.notifications || {};
        $('emailNotifications').value = notif.email || '';
        $('webhookNotifications').value = notif.webhook || '';
        $('retryCount').value = cfg.retryCount ?? 3;
        $('retryDelay').value = cfg.retryDelay ?? 60;
        $('jobParams').value = (cfg.parameters && Object.keys(cfg.parameters).length)
            ? JSON.stringify(cfg.parameters, null, 2)
            : '';
        const runImmediately = $('runImmediately');
        if (runImmediately) runImmediately.checked = false;

        if (job.oneTime && job.runAt) {
            const d = new Date(job.runAt);
            $('schedOnceDate').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            $('schedOnceTime').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
            setPreset('once');
        } else {
            applyCronToForm(job.schedule || '0 9 * * *');
        }
        updateTimezoneHint();
        switchTab('add');
        setStatus('✏️ Editing job — update the fields and save', 'info');
    }

    // ── Timezone hint ───────────────────────────────────────────────────────
    function updateTimezoneHint() {
        const hint = $('tzOffsetHint');
        const tz = $('jobTimezone').value.trim();
        if (!hint) return;
        if (!tz) {
            const off = -new Date().getTimezoneOffset();
            const sign = off < 0 ? '-' : '+';
            const abs = Math.abs(off);
            hint.textContent = `🌍 Local time (UTC${sign}${Math.floor(abs / 60)}:${pad(abs % 60)}) — empty uses this`;
            return;
        }
        try {
            const off = tzOffsetMs(new Date(), tz) / 60000;
            const sign = off < 0 ? '-' : '+';
            const abs = Math.abs(off);
            hint.textContent = `🌍 ${tz} is UTC${sign}${Math.floor(abs / 60)}:${pad(abs % 60)}`;
        } catch (err) {
            void err;
            hint.textContent = '🌍 Unknown IANA timezone — the schedule will use it if valid';
        }
    }

    $('jobTimezone').addEventListener('input', updateTimezoneHint);

    // ── Browse Workflow ─────────────────────────────────────────────────────
    $('browseWorkflow').addEventListener('click', () => {
        vscode.postMessage({ type: 'pickWorkflow' });
    });

    // ── History toolbar ─────────────────────────────────────────────────────
    $('clearHistory').addEventListener('click', () => {
        vscode.postMessage({ type: 'clearHistory' });
    });

    $('refreshHistory').addEventListener('click', () => {
        vscode.postMessage({ type: 'getHistory' });
    });

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
                vscode.postMessage({ type: 'removeJob', jobId });
                break;
            case 'pauseJob':
                vscode.postMessage({ type: 'pauseJob', jobId });
                break;
            case 'resumeJob':
                vscode.postMessage({ type: 'resumeJob', jobId });
                break;
            case 'editJob': {
                const job = jobs.find(j => j.id === jobId);
                if (job) fillEditForm(job);
                break;
            }
            case 'scheduleOnce':
                openOnceModal(jobId);
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
    function describeSchedule(job) {
        if (job.oneTime && job.runAt) return `Once on ${new Date(job.runAt).toLocaleString()}`;
        if (job.schedule === 'immediate') return 'Runs immediately';
        if (job.schedule) {
            const desc = describeCron(job.schedule);
            return desc === 'Custom cron expression' ? job.schedule : desc;
        }
        return '—';
    }

    function renderJobs() {
        if (!jobList) return;

        const q = (jobSearch.value || '').trim().toLowerCase();
        const filtered = jobs.filter(j => {
            if (!q) return true;
            return [j.name, j.workflowFile, j.schedule, j.timezone]
                .some(v => v && String(v).toLowerCase().includes(q));
        });

        if (filtered.length === 0) {
            jobList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">⏰</div>
                    <div class="empty-state-title">${q ? 'No matching jobs' : 'No scheduled jobs'}</div>
                    <div class="empty-state-sub">${q
                    ? 'Try a different search term.'
                    : 'Switch to the <strong>Add Job</strong> tab to automate your first workflow.'}</div>
                </div>`;
            updateStats();
            return;
        }

        jobList.innerHTML = filtered.map(job => {
            const isRunning = runningJobs.some(rj => rj.jobId === job.id);
            const statusClass = isRunning ? 'running' : (job.status || 'idle');
            const statusLabel = isRunning ? 'running' : (job.status || 'idle');
            const fileName = job.workflowFile
                ? job.workflowFile.replace(/\\/g, '/').split('/').pop()
                : 'Embedded';

            let cardClass = '';
            if (isRunning) cardClass = 'running';
            else if (job.status === 'failed') cardClass = 'failed';
            else if (job.status === 'completed') cardClass = 'completed';

            const schedule = describeSchedule(job);
            const tzTag = job.timezone
                ? `<div class="detail"><span class="detail-label">tz:</span><span class="detail-value" title="${esc(job.timezone)}">${esc(job.timezone)}</span></div>`
                : '';

            return `
                <div class="job-card ${cardClass}" data-job-id="${esc(job.id)}">
                    <div class="job-header">
                        <span class="job-name">
                            <span>${isRunning ? '🔄' : '📋'}</span>
                            <span class="name-text" title="${esc(job.name)}">${esc(job.name)}</span>
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
                        <div class="detail" style="grid-column:1/-1;" title="${esc(job.schedule)}"><span class="detail-label">schedule:</span><span class="detail-value">${esc(schedule)}</span></div>
                        <div class="detail"><span class="detail-label">file:</span><span class="detail-value" title="${esc(job.workflowFile)}">${esc(fileName)}</span></div>
                        ${tzTag || '<div class="detail"><span class="detail-label">tz:</span><span class="detail-value">local</span></div>'}
                        <div class="detail"><span class="detail-label">last:</span><span class="detail-value">${job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never'}</span></div>
                        <div class="detail"><span class="detail-label">next:</span><span class="detail-value">${job.nextRun ? new Date(job.nextRun).toLocaleString() : 'N/A'}</span></div>
                    </div>
                    <div class="job-actions">
                        <button class="btn-sm success" data-action="runNow">▶ Run Now</button>
                        ${isRunning
                    ? `<button class="btn-sm danger" data-action="stopJob">⏹ Stop</button>`
                    : ''}
                        ${job.enabled
                    ? `<button class="btn-sm" data-action="pauseJob">⏸ Pause</button>`
                    : `<button class="btn-sm info" data-action="resumeJob">▶ Resume</button>`}
                        <button class="btn-sm" data-action="editJob">✏️ Edit</button>
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
                <span class="history-name" title="${esc(h.jobName)}">${esc(h.jobName)}</span>
                <span class="history-${cls}">${label}</span>
                <span class="history-time">${new Date(h.startTime).toLocaleString()}</span>
                <span class="history-duration">${dur}</span>
            </div>`;
        }).join('');

        updateStats();
    }

    // ── One-time scheduling modal ───────────────────────────────────────────
    const onceModal = $('onceModal');
    const onceStatus = $('onceStatus');

    function openOnceModal(jobId) {
        onceJobId = jobId;
        onceStatus.innerHTML = '';
        const now = new Date(Date.now() + 3600000);
        $('onceDate').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        $('onceTime').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        onceModal.classList.remove('hidden');
        $('onceDate').focus();
    }

    function closeOnceModal() {
        onceModal.classList.add('hidden');
        onceJobId = null;
    }

    $('onceCancel').addEventListener('click', closeOnceModal);
    onceModal.addEventListener('click', (e) => {
        if (e.target === onceModal) closeOnceModal();
    });

    $('onceConfirm').addEventListener('click', () => {
        const dateStr = $('onceDate').value.trim();
        const timeStr = $('onceTime').value.trim();
        if (!dateStr || !timeStr) {
            onceStatus.innerHTML = `<span style="color:var(--error,#c75f8a)">Date and time are required</span>`;
            return;
        }
        const runAt = `${dateStr}T${timeStr}:00`;
        if (new Date(runAt) <= new Date()) {
            onceStatus.innerHTML = `<span style="color:var(--error,#c75f8a)">Must be in the future</span>`;
            return;
        }
        onceStatus.innerHTML = `<span style="color:var(--vscode-descriptionForeground)">Scheduling…</span>`;
        vscode.postMessage({ type: 'scheduleOnce', jobId: onceJobId, runAt });
    });

    // ── Status helper ────────────────────────────────────────────────────────
    function setStatus(text, level) {
        const colors = { error: '#c75f8a', success: '#2da680', info: 'var(--vscode-descriptionForeground)' };
        addStatus.innerHTML = `<span style="color:${colors[level] || 'inherit'}">${esc(text)}</span>`;
        addStatus.className = level || '';
    }

    // ── Switch to Add tab and pre-fill workflow path ─────────────────────────
    function prefillWorkflow(filePath) {
        switchTab('add');
        const wfInput = $('workflowFile');
        if (wfInput) wfInput.value = filePath;
        const nameInput = $('jobName');
        if (nameInput && !editingJobId && !nameInput.value.trim()) {
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
                if (onceJobId) {
                    closeOnceModal();
                }
                if (editingJobId && !jobs.some(j => j.id === editingJobId)) {
                    cancelEdit();
                }
                break;

            case 'refreshHistory':
                vscode.postMessage({ type: 'getHistory' });
                break;

            case 'jobAddedSuccess':
                setStatus('✅ Job scheduled successfully!', 'success');
                setTimeout(() => {
                    addStatus.innerHTML = '';
                    addStatus.className = '';
                }, 3000);
                clearForm();
                break;

            case 'workflowPicked':
                $('workflowFile').value = msg.filePath;
                break;

            case 'prefillWorkflow':
                prefillWorkflow(msg.filePath);
                break;

            case 'error':
                if (onceJobId) {
                    onceStatus.innerHTML = `<span style="color:var(--error,#c75f8a)">${esc(msg.message)}</span>`;
                    break;
                }
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
    setPreset('daily');
    updateTimezoneHint();
    vscode.postMessage({ type: 'ready' });

})();
