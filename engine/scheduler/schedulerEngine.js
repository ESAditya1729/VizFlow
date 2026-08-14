/**
 * engine/scheduler/schedulerEngine.js
 *
 * Core scheduling engine for VizFlow.
 * Handles cron-based scheduling, job management, and execution.
 * Supports one-time execution, stop/cancel, and watch folders.
 */

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { executeWorkflow } = require('../workflow/workflowEngine');

// Files written by a job into one of its watched folders are ignored for a
// short window after the run. This breaks the create→run→write→create loop
// that would otherwise make a job watching its own output folder run forever.
const RECENTLY_WRITTEN_TTL_MS = 30000;
// New files are only acted on after they have been stable for this long.
const WATCH_DEBOUNCE_MS = 500;

class SchedulerEngine extends EventEmitter {
    constructor() {
        super();
        this.jobs = new Map(); // jobId -> { task, schedule, workflowDef, config }
        this.runningJobs = new Map(); // jobId -> { startTime, status, executionId, cancelled, controller }
        this.history = [];
        this.configPath = null;
        this.configBaseDir = process.cwd();
        this.store = null; // SchedulerStore instance (optional)
        this.isRunning = false;
        this.executionIdCounter = 0;
        this.queue = []; // jobIds waiting because of maxConcurrent
        this.watchedFolders = new Map(); // folder -> { count, watcher, timers }
        this.watchingJobIds = new Set(); // jobIds that registered a folder watch
        this.lockedWatchFolders = new Set(); // folders with a job currently running
        this.recentlyWritten = new Map(); // fullPath -> expiry timestamp
    }

    /**
     * Initialize the scheduler with a config file path
     * @param {string|null} configPath - Absolute path of the config file
     * @param {Object} [options]
     * @param {string} [options.baseDir] - Base directory used to resolve
     *        relative paths when a job does not record its own baseDir
     * @param {SchedulerStore} [options.store] - Optional persistence layer
     * @param {string} [options.migrateFrom] - Legacy config path to migrate
     */
    initialize(configPath, options = {}) {
        this.configPath = configPath;
        this.configBaseDir = options.baseDir || (configPath ? path.dirname(configPath) : process.cwd());
        this.store = options.store || null;

        if (this.store && options.migrateFrom) {
            this.store.load();
            this.store.migrateFrom(options.migrateFrom);
        }

        this.loadJobs();
        this.startWatchdog();
        this.isRunning = true;
        this.emit('initialized', { count: this.jobs.size });
    }

    /**
     * Load jobs from the store (or legacy config file)
     */
    loadJobs() {
        let jobs = [];

        if (this.store) {
            const data = this.store.load();
            jobs = data.jobs || [];
            this.history = Array.isArray(data.history) ? data.history.slice() : [];
        } else {
            try {
                if (this.configPath && fs.existsSync(this.configPath)) {
                    const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                    jobs = config.jobs || [];
                    if (Array.isArray(config.history)) {
                        this.history = config.history.slice();
                    }
                }
            } catch (error) {
                this.emit('error', { message: `Failed to load jobs: ${error.message}` });
            }
        }

        for (const jobConfig of jobs) {
            try {
                // Skip one-time jobs whose run date has already passed — the
                // generated cron would otherwise fire a year later (or never).
                if (jobConfig.runOnce && jobConfig.runAt) {
                    const runAt = new Date(jobConfig.runAt);
                    if (isNaN(runAt.getTime()) || runAt.getTime() <= Date.now()) {
                        continue;
                    }
                }
                this.addJob(jobConfig);
            } catch (error) {
                this.emit('error', {
                    message: `Failed to load job "${jobConfig.name || jobConfig.id || 'unnamed'}": ${error.message}`
                });
            }
        }
    }

    /**
     * Persist all jobs + history to the store (or legacy config file)
     */
    saveJobs() {
        try {
            const jobs = Array.from(this.jobs.values()).map(job => this.serializeJob(job));

            if (this.store) {
                this.store.save(jobs, this.history);
            } else if (this.configPath) {
                const config = {
                    version: '2.0.0',
                    updatedAt: new Date().toISOString(),
                    jobs,
                    history: this.history
                };
                const dir = path.dirname(this.configPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
            }
            this.emit('saved', { path: this.configPath });
        } catch (error) {
            this.emit('error', { message: `Failed to save jobs: ${error.message}` });
        }
    }

    /**
     * Produce the persistable representation of a job
     */
    serializeJob(job) {
        return {
            id: job.id,
            name: job.name,
            schedule: job.schedule,
            timezone: job.timezone || null,
            workflowFile: job.workflowFile,
            workflowDef: job.workflowDef || null,
            baseDir: job.baseDir || null,
            enabled: job.enabled,
            oneTime: job.oneTime || false,
            runOnce: job.runOnce || false,
            runAt: job.runAt || null,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            lastRun: job.lastRun,
            nextRun: job.nextRun || null,
            status: job.status,
            config: job.config || {}
        };
    }

    /**
     * Add a new scheduled job with enhanced options
     */
    addJob(config) {
        const jobId = config.id || `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Handle one-time execution
        if (config.runOnce && config.runAt) {
            const runAt = new Date(config.runAt);
            if (isNaN(runAt.getTime())) {
                throw new Error(`Invalid runAt date: ${config.runAt}`);
            }
            if (runAt.getTime() <= Date.now()) {
                throw new Error(`runAt date must be in the future: ${config.runAt}`);
            }
            
            // Calculate cron for one-time execution
            const minutes = runAt.getMinutes();
            const hours = runAt.getHours();
            const day = runAt.getDate();
            const month = runAt.getMonth() + 1;
            const dayOfWeek = '*';
            
            config.schedule = `${minutes} ${hours} ${day} ${month} ${dayOfWeek}`;
            config.oneTime = true;
        }

        // Validate cron expression (skip for immediate execution)
        if (config.schedule && config.schedule !== 'immediate') {
            if (!cron.validate(config.schedule)) {
                throw new Error(`Invalid cron expression: ${config.schedule}`);
            }
        }

        // Create job object
        const job = {
            id: jobId,
            name: config.name || 'Unnamed Job',
            schedule: config.schedule || 'immediate',
            timezone: config.timezone || null,
            workflowFile: config.workflowFile,
            workflowDef: config.workflowDef || null,
            baseDir: config.baseDir || this.configBaseDir,
            oneTime: config.oneTime || false,
            runOnce: config.runOnce || false,
            runAt: config.runAt || null,
            config: {
                watchFolder: config.watchFolder || null,
                fileFilter: config.fileFilter || null,
                notifications: config.notifications || {},
                parameters: config.parameters || {},
                timeout: config.timeout || 3600,
                retryCount: config.retryCount ?? 3,
                retryDelay: config.retryDelay ?? 60,
                maxConcurrent: config.maxConcurrent || 1,
                runImmediately: config.runImmediately || false,
                ...config.config
            },
            configBaseDir: this.configBaseDir,
            enabled: config.enabled !== false,
            createdAt: config.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastRun: null,
            nextRun: null,
            status: 'idle'
        };

        // Run immediately if requested
        if (config.runImmediately || config.schedule === 'immediate') {
            setTimeout(() => {
                this.executeJob(jobId);
            }, 500);
        }

        // Schedule the job (skip if immediate or one-time already passed)
        if (config.schedule && config.schedule !== 'immediate') {
            const cronOptions = job.timezone ? { timezone: job.timezone } : {};
            const task = cron.schedule(job.schedule, () => {
                if (job.enabled && !job.oneTime) {
                    this.executeJob(jobId);
                } else if (job.oneTime) {
                    // Execute one-time job and then remove it
                    this.executeJob(jobId).then(() => {
                        this.removeJob(jobId);
                        this.emit('jobCompletedOneTime', { jobId, jobName: job.name });
                    });
                }
            }, cronOptions);
            job.task = task;
            job.nextRun = this.getNextRun(job.schedule, job.timezone);
        } else {
            job.task = null;
            job.nextRun = null;
        }
        
        this.jobs.set(jobId, job);
        this.saveJobs();
        this.maybeWatchFolder(job);
        
        this.emit('jobAdded', job);
        return job;
    }

    /**
     * Remove a scheduled job
     */
    removeJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        if (job.task) {
            job.task.stop();
        }

        this.jobs.delete(jobId);

        // Remove from the pending queue if it was queued
        const queueIndex = this.queue.indexOf(jobId);
        if (queueIndex >= 0) {
            this.queue.splice(queueIndex, 1);
        }

        this.unwatchFolderForJob(job);
        this.saveJobs();
        
        this.emit('jobRemoved', { jobId });
        return true;
    }

    /**
     * Update an existing job
     */
    updateJob(jobId, updates) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        const oldWatchFolder = job.config && job.config.watchFolder;

        // Stop existing task
        if (job.task) {
            job.task.stop();
        }

        // Update properties
        if (updates.schedule) {
            if (updates.schedule !== 'immediate' && !cron.validate(updates.schedule)) {
                throw new Error(`Invalid cron expression: ${updates.schedule}`);
            }
            job.schedule = updates.schedule;
        }

        if (updates.name) job.name = updates.name;
        if (updates.workflowFile) job.workflowFile = updates.workflowFile;
        if (updates.workflowDef) job.workflowDef = updates.workflowDef;
        if (updates.timezone !== undefined) job.timezone = updates.timezone || null;
        if (updates.config) job.config = { ...job.config, ...updates.config };
        if (updates.parameters !== undefined) job.config.parameters = updates.parameters || {};
        if (updates.enabled !== undefined) job.enabled = updates.enabled;
        if (updates.oneTime !== undefined) job.oneTime = updates.oneTime;
        if (updates.runOnce !== undefined) job.runOnce = updates.runOnce;
        if (updates.runAt !== undefined) job.runAt = updates.runAt;

        job.updatedAt = new Date().toISOString();

        // Reschedule if not immediate
        if (job.schedule && job.schedule !== 'immediate') {
            const cronOptions = job.timezone ? { timezone: job.timezone } : {};
            const task = cron.schedule(job.schedule, () => {
                if (job.enabled && !job.oneTime) {
                    this.executeJob(jobId);
                } else if (job.oneTime) {
                    this.executeJob(jobId).then(() => {
                        this.removeJob(jobId);
                        this.emit('jobCompletedOneTime', { jobId, jobName: job.name });
                    });
                }
            }, cronOptions);
            job.task = task;
            job.nextRun = this.getNextRun(job.schedule, job.timezone);
        } else {
            job.task = null;
            job.nextRun = null;
            if (job.schedule === 'immediate') {
                setTimeout(() => this.executeJob(jobId), 500);
            }
        }

        // Re-register the folder watcher when the folder, filter or enabled
        // state changed
        const newWatchFolder = job.config && job.config.watchFolder;
        if (oldWatchFolder !== newWatchFolder || updates.enabled !== undefined) {
            this.unwatchFolderForJob(job, oldWatchFolder);
            this.maybeWatchFolder(job);
        }

        this.saveJobs();
        this.emit('jobUpdated', job);
        return job;
    }

    /**
     * Execute a job with cancellation support
     */
    async executeJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            this.emit('error', { message: `Job ${jobId} not found` });
            return;
        }

        // Check if job is already running
        if (this.runningJobs.has(jobId)) {
            const running = this.runningJobs.get(jobId);
            if (running.status === 'running') {
                this.emit('jobSkipped', { 
                    jobId, 
                    message: 'Job already running' 
                });
                return;
            }
        }

        // Check concurrent limit
        if (this.runningJobs.size >= job.config.maxConcurrent) {
            this.emit('jobQueued', { 
                jobId, 
                message: 'Max concurrent jobs reached, queued' 
            });
            if (!this.queue.includes(jobId)) {
                this.queue.push(jobId);
            }
            return;
        }

        // Generate execution ID
        const executionId = `exec_${++this.executionIdCounter}_${Date.now()}`;

        // Abort controller enables real cancellation + job timeout enforcement
        const controller = new AbortController();
        const timeoutSeconds = job.config.timeout || 0;
        let timeoutHandle = null;
        if (timeoutSeconds > 0) {
            timeoutHandle = setTimeout(() => {
                const entry = this.runningJobs.get(jobId);
                if (entry) {
                    entry.timedOut = true;
                    entry.timeoutReason = `Job timed out after ${timeoutSeconds}s`;
                }
                controller.abort(new Error(`Job timed out after ${timeoutSeconds}s`));
            }, timeoutSeconds * 1000);
        }

        // Mark as running
        const startTime = Date.now();
        this.runningJobs.set(jobId, { 
            startTime, 
            status: 'running', 
            executionId,
            cancelled: false,
            timedOut: false,
            controller
        });
        job.status = 'running';
        job.lastRun = new Date().toISOString();
        
        this.emit('jobStarted', { 
            jobId, 
            jobName: job.name, 
            executionId,
            startTime: job.lastRun
        });

        // Lock the job's watch folder while it runs so files the job writes
        // into it cannot re-trigger it (infinite loop protection). The lock is
        // released and the folder re-checked after the run.
        const watchFolder = job.config.watchFolder ? this.resolveFolderPath(job) : null;
        if (watchFolder) {
            this.lockedWatchFolders.add(watchFolder);
        }
        const jobStartMs = Date.now();

        let retryCount = 0;
        let success = false;
        let lastError = null;

        while (retryCount <= job.config.retryCount && !success) {
            // Check if cancelled
            const running = this.runningJobs.get(jobId);
            if (running && running.cancelled) {
                this.emit('jobCancelled', { 
                    jobId, 
                    jobName: job.name,
                    executionId
                });
                break;
            }

            try {
                // Load workflow definition
                let workflowDef = job.workflowDef;

                // Resolve paths relative to the job's recorded base
                // directory (the workspace where it was created)
                const baseDir = job.baseDir || job.configBaseDir || this.configBaseDir || process.cwd();
                const resolvePath = (p) => path.isAbsolute(p) ? p : path.resolve(baseDir, p);

                if (job.workflowFile && !workflowDef) {
                    const filePath = path.isAbsolute(job.workflowFile)
                        ? job.workflowFile
                        : path.resolve(baseDir, job.workflowFile);
                    if (fs.existsSync(filePath)) {
                        const content = fs.readFileSync(filePath, 'utf8');
                        workflowDef = JSON.parse(content);
                    } else {
                        throw new Error(`Workflow file not found: ${filePath}`);
                    }
                }

                if (!workflowDef) {
                    throw new Error('No workflow definition available');
                }

                // Build initial variables: built-ins (mirroring the Workflow
                // Builder) plus the job's declared parameters. The engine
                // interpolates {{var}} in activity configs from these.
                const now = new Date();
                const initialVariables = {
                    workflowName: (workflowDef && workflowDef.name) || job.name || 'workflow',
                    timestamp: now.toISOString(),
                    workspaceRoot: baseDir,
                    date: now.toISOString().split('T')[0],
                    time: now.toISOString().split('T')[1].split('.')[0],
                    year: now.getFullYear().toString(),
                    month: String(now.getMonth() + 1).padStart(2, '0'),
                    day: String(now.getDate()).padStart(2, '0'),
                    hour: String(now.getHours()).padStart(2, '0'),
                    minute: String(now.getMinutes()).padStart(2, '0'),
                    second: String(now.getSeconds()).padStart(2, '0')
                };
                Object.assign(initialVariables, job.config.parameters || {});

                // Execute workflow
                const result = await executeWorkflow(workflowDef, {
                    resolvePath,
                    initialVariables,
                    signal: controller.signal,
                    onStateChange: (activityId, state, stats, error) => {
                        // The engine already aborts via controller.signal, so
                        // this callback must never throw — a throw here would
                        // surface as a confusing activity error instead of a
                        // clean cancellation.
                        this.emit('jobActivityState', {
                            jobId,
                            executionId,
                            activityId,
                            state,
                            stats,
                            error
                        });
                    }
                });

                // Check again if cancelled
                const runningCheck = this.runningJobs.get(jobId);
                if (runningCheck && runningCheck.cancelled) {
                    throw new Error('Job cancelled by user');
                }
                if (runningCheck && runningCheck.timedOut) {
                    throw new Error('Job timed out');
                }

                if (result.success) {
                    success = true;
                    job.status = 'completed';
                    
                    // Send success notification
                    if (job.config.notifications.onSuccess) {
                        this.sendNotification(job, result);
                    }

                    this.emit('jobCompleted', {
                        jobId,
                        jobName: job.name,
                        executionId,
                        duration: Date.now() - startTime,
                        results: result.results,
                        variables: result.variables
                    });
                } else {
                    throw new Error(result.error || 'Workflow execution failed');
                }
            } catch (error) {
                // Check if cancellation
                if (error.message === 'Job cancelled by user') {
                    this.emit('jobCancelled', {
                        jobId,
                        jobName: job.name,
                        executionId,
                        duration: Date.now() - startTime
                    });
                    break;
                }

                // Check if timed out
                if (error.message === 'Job timed out') {
                    const timedOutEntry = this.runningJobs.get(jobId);
                    const timeoutReason = (timedOutEntry && timedOutEntry.timeoutReason) || 'Job timed out';
                    this.emit('jobTimedOut', {
                        jobId,
                        jobName: job.name,
                        executionId,
                        duration: Date.now() - startTime,
                        error: timeoutReason
                    });
                    break;
                }

                lastError = error;
                retryCount++;
                
                if (retryCount <= job.config.retryCount) {
                    this.emit('jobRetry', {
                        jobId,
                        executionId,
                        attempt: retryCount,
                        maxRetries: job.config.retryCount,
                        error: error.message
                    });
                    
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, job.config.retryDelay * 1000));
                }
            }
        }

        // Clean up
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }

        const running = this.runningJobs.get(jobId);
        const cancelledOrTimedOut = running && (running.cancelled || running.timedOut);
        if (running && !cancelledOrTimedOut) {
            const finalStatus = success ? 'completed' : 'failed';
            job.status = finalStatus;
            
            if (!success && !cancelledOrTimedOut) {
                // Send failure notification
                if (job.config.notifications.onFailure) {
                    this.sendNotification(job, null, lastError);
                }

                this.emit('jobFailed', {
                    jobId,
                    jobName: job.name,
                    executionId,
                    duration: Date.now() - startTime,
                    error: lastError ? lastError.message : 'Unknown error',
                    retryCount: retryCount
                });
            }
        }

        this.runningJobs.delete(jobId);

        // Release the watch-folder lock, mark files the job wrote while it ran
        // (so they cannot immediately re-trigger it), then re-check the folder
        // for inputs that arrived during the run.
        if (watchFolder) {
            this.lockedWatchFolders.delete(watchFolder);
            this.markFilesWrittenDuringRun(watchFolder, jobStartMs - 2000);
            this.recheckFolder(watchFolder);
        }

        // Store history
        this.history.push({
            jobId,
            jobName: job.name,
            executionId,
            startTime: new Date(startTime).toISOString(),
            endTime: new Date().toISOString(),
            duration: Date.now() - startTime,
            status: job.status,
            error: lastError ? lastError.message : null,
            cancelled: cancelledOrTimedOut,
            timedOut: running ? running.timedOut : false
        });

        // Keep only last 200 history entries
        if (this.history.length > 200) {
            this.history = this.history.slice(-200);
        }

        // Refresh the displayed next-run time now that this execution is over
        if (job.enabled && !job.oneTime) {
            job.nextRun = this.getNextRun(job.schedule, job.timezone);
        }

        this.saveJobs();
        this.emit('jobUpdated', { jobId });

        // Process the next queued job, if any
        if (this.queue.length > 0) {
            const nextJobId = this.queue.shift();
            setTimeout(() => this.executeJob(nextJobId), 100);
        }
    }

    /**
     * Stop/cancel a running job
     */
    stopJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        const running = this.runningJobs.get(jobId);
        if (!running || running.status !== 'running') {
            throw new Error(`Job ${jobId} is not running`);
        }

        running.cancelled = true;
        if (running.controller) {
            running.controller.abort(new Error('Job cancelled by user'));
        }
        this.emit('jobStopping', { jobId, jobName: job.name });
        return true;
    }

    /**
     * Run a job at a specific time (one-time)
     */
    scheduleOnce(jobId, runAt) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }

        const date = new Date(runAt);
        if (isNaN(date.getTime())) {
            throw new Error(`Invalid date: ${runAt}`);
        }
        if (date.getTime() <= Date.now()) {
            throw new Error(`runAt must be in the future: ${runAt}`);
        }

        // Create a one-time job
        const oneTimeConfig = {
            name: `${job.name} (One-time)`,
            schedule: `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`,
            workflowFile: job.workflowFile,
            workflowDef: job.workflowDef,
            baseDir: job.baseDir || job.configBaseDir || this.configBaseDir,
            timezone: job.timezone || null,
            oneTime: true,
            runOnce: true,
            runAt: runAt,
            config: job.config,
            notifications: job.config.notifications,
            parameters: job.config.parameters
        };

        return this.addJob(oneTimeConfig);
    }

    /**
     * Get running jobs
     */
    getRunningJobs() {
        const running = [];
        for (const [jobId, info] of this.runningJobs) {
            const job = this.jobs.get(jobId);
            if (job) {
                running.push({
                    jobId,
                    jobName: job.name,
                    startTime: info.startTime,
                    executionId: info.executionId,
                    status: info.status,
                    cancelled: info.cancelled
                });
            }
        }
        return running;
    }

    /**
     * Get next run time for a cron schedule
     */
    getNextRun(schedule, timezone = null) {
        try {
            // Let node-cron compute the next run so the answer always
            // matches what the actual scheduler will fire
            const options = timezone ? { scheduled: false, timezone } : { scheduled: false };
            const task = cron.schedule(schedule, () => {}, options);
            const next = task.getNextRun();
            task.stop();
            return next ? next.toISOString() : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Send notification
     */
    sendNotification(job, result, error = null) {
        const { notifications } = job.config;
        
        if (notifications.email) {
            this.emit('notification', {
                type: 'email',
                jobId: job.id,
                jobName: job.name,
                to: notifications.email,
                subject: `VizFlow Job: ${job.name} - ${error ? 'Failed' : 'Completed'}`,
                body: this.buildNotificationBody(job, result, error)
            });
        }

        if (notifications.webhook) {
            this.emit('notification', {
                type: 'webhook',
                jobId: job.id,
                url: notifications.webhook,
                payload: {
                    jobName: job.name,
                    status: error ? 'failed' : 'completed',
                    timestamp: new Date().toISOString(),
                    error: error ? error.message : null,
                    results: result ? result.results : null
                }
            });
        }

        if (notifications.console) {
            console.log(`[VizFlow Job] ${job.name}: ${error ? '❌ Failed' : '✅ Completed'}`);
        }
    }

    /**
     * Build notification email body
     */
    buildNotificationBody(job, result, error) {
        const lines = [];
        lines.push(`Job: ${job.name}`);
        lines.push(`Status: ${error ? '❌ Failed' : '✅ Completed'}`);
        lines.push(`Time: ${new Date().toISOString()}`);
        
        if (error) {
            lines.push(`Error: ${error.message}`);
        } else if (result && result.results) {
            lines.push('Results:');
            for (const [key, value] of Object.entries(result.results)) {
                lines.push(`  ${key}: ${JSON.stringify(value)}`);
            }
        }
        
        return lines.join('\n');
    }

    /**
     * Watch folders for all enabled jobs with a watchFolder config.
     */
    startWatchdog() {
        for (const job of this.jobs.values()) {
            this.maybeWatchFolder(job);
        }
    }

    /**
     * Resolve a job's watch folder to an absolute path.
     */
    resolveFolderPath(job) {
        const raw = job.config.watchFolder;
        if (!raw) return null;
        const base = job.baseDir || job.configBaseDir || this.configBaseDir || process.cwd();
        return path.isAbsolute(raw) ? raw : path.resolve(base, raw);
    }

    /**
     * Register a watcher for a job's watch folder. Watchers are reference
     * counted so multiple jobs can share one `fs.watch` handle, and the
     * handle is closed when the last job using the folder is removed.
     */
    maybeWatchFolder(job) {
        if (!job || !job.config || !job.config.watchFolder || !job.enabled) return;
        if (this.watchingJobIds.has(job.id)) return;

        const folder = this.resolveFolderPath(job);
        if (!folder) return;
        this.watchingJobIds.add(job.id);

        const entry = this.watchedFolders.get(folder);
        if (entry) {
            entry.count++;
            return;
        }

        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true });
        }

        const watcher = fs.watch(folder, (eventType, filename) => {
            this.handleFileChange(folder, eventType, filename);
        });

        this.watchedFolders.set(folder, { count: 1, watcher, timers: new Map() });
        this.emit('folderWatched', { folder });
    }

    /**
     * Release a job's reference on a watch folder, closing the watcher when
     * no jobs use it anymore.
     * @param {Object} job
     * @param {string|null} [folderOverride] - Folder to release when the job's
     *        current config already points somewhere else.
     */
    unwatchFolderForJob(job, folderOverride = null) {
        if (!job || !job.config) return;
        const raw = folderOverride !== null ? folderOverride : job.config.watchFolder;
        if (!raw) return;
        if (!this.watchingJobIds.has(job.id)) return;
        this.watchingJobIds.delete(job.id);

        const base = job.baseDir || job.configBaseDir || this.configBaseDir || process.cwd();
        const folder = path.isAbsolute(raw) ? raw : path.resolve(base, raw);
        const entry = this.watchedFolders.get(folder);
        if (!entry) return;

        entry.count--;
        if (entry.count <= 0) {
            for (const t of entry.timers.values()) {
                clearTimeout(t);
            }
            entry.timers.clear();
            entry.watcher.close();
            this.watchedFolders.delete(folder);
        }
    }

    /**
     * Debounced handler for a single fs.watch event.
     */
    handleFileChange(folder, eventType, filename) {
        if (eventType !== 'rename' || !filename) return;

        const entry = this.watchedFolders.get(folder);
        const key = String(filename);

        if (entry) {
            if (entry.timers.has(key)) {
                clearTimeout(entry.timers.get(key));
            }
            entry.timers.set(key, setTimeout(() => {
                entry.timers.delete(key);
                this.triggerFolderJobs(folder, filename);
            }, WATCH_DEBOUNCE_MS));
        } else {
            this.triggerFolderJobs(folder, filename);
        }
    }

    /**
     * Fire all matching jobs for a new file in a watched folder.
     */
    triggerFolderJobs(folder, filename) {
        this.pruneRecentlyWritten();
        const fullPath = path.join(folder, filename);

        // Only creations count — a rename/delete has no file left to process
        if (!fs.existsSync(fullPath)) return;

        // Skip files the job itself wrote (loop prevention)
        if (this.isRecentlyWritten(fullPath)) return;

        // Skip while a job is running on this folder; the post-run recheck
        // picks up files that arrived during the run.
        if (this.lockedWatchFolders.has(folder)) return;

        let matched = false;
        for (const job of this.jobs.values()) {
            if (!job.enabled || !job.config.watchFolder) continue;
            if (this.resolveFolderPath(job) !== folder) continue;

            // Optional filter (e.g. "*.csv", "*Payment*.xlsx") must match
            if (job.config.fileFilter && !this.matchesFilter(filename, job.config.fileFilter)) {
                continue;
            }

            matched = true;
            this.emit('fileTriggeredJob', { jobId: job.id, filename });
            this.executeJob(job.id);
        }

        if (matched) {
            this.emit('fileChanged', { folder, filename, eventType: 'rename' });
        }
    }

    /**
     * After a job on a folder finishes, look for files that are not outputs of
     * the run and trigger matching jobs for them (files that arrived while the
     * folder was locked).
     */
    recheckFolder(folder) {
        if (!fs.existsSync(folder)) return;
        let files;
        try {
            files = fs.readdirSync(folder);
        } catch (e) {
            void e;
            return;
        }

        for (const filename of files) {
            const fullPath = path.join(folder, filename);
            try {
                if (!fs.statSync(fullPath).isFile()) continue;
            } catch (e) {
                void e;
                continue;
            }
            if (this.isRecentlyWritten(fullPath)) continue;
            this.triggerFolderJobs(folder, filename);
        }
    }

    /**
     * Mark every file in a folder that was modified during a job run as
     * recently written, so it cannot immediately re-trigger the job.
     */
    markFilesWrittenDuringRun(folder, sinceMs) {
        if (!fs.existsSync(folder)) return;
        let files;
        try {
            files = fs.readdirSync(folder);
        } catch (e) {
            void e;
            return;
        }

        for (const filename of files) {
            const fullPath = path.join(folder, filename);
            try {
                const st = fs.statSync(fullPath);
                if (st.isFile() && st.mtimeMs >= sinceMs) {
                    this.recentlyWritten.set(fullPath, Date.now() + RECENTLY_WRITTEN_TTL_MS);
                }
            } catch (e) {
                void e;
                // ignore files that vanished mid-scan
            }
        }
        this.pruneRecentlyWritten();
    }

    isRecentlyWritten(fullPath) {
        this.pruneRecentlyWritten();
        return this.recentlyWritten.has(fullPath);
    }

    pruneRecentlyWritten() {
        const now = Date.now();
        for (const [p, expiry] of this.recentlyWritten) {
            if (expiry <= now) {
                this.recentlyWritten.delete(p);
            }
        }
    }

    /**
     * Match a filename against a glob-ish filter (supports `*`, `?` and
     * comma-separated alternatives).
     */
    matchesFilter(filename, filter) {
        if (!filter) return true;
        const parts = String(filter).split(',').map(p => p.trim()).filter(Boolean);
        if (parts.length === 0) return true;
        return parts.some(pattern => this.globMatch(filename, pattern));
    }

    globMatch(name, pattern) {
        const escaped = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        try {
            return new RegExp(`^${escaped}$`, 'i').test(name);
        } catch (e) {
            void e;
            return false;
        }
    }

    /**
     * Get all jobs
     */
    getJobs() {
        return Array.from(this.jobs.values()).map(job => ({
            id: job.id,
            name: job.name,
            schedule: job.schedule,
            timezone: job.timezone || null,
            workflowFile: job.workflowFile,
            enabled: job.enabled,
            status: job.status,
            lastRun: job.lastRun,
            nextRun: job.nextRun,
            oneTime: job.oneTime || false,
            runOnce: job.runOnce || false,
            runAt: job.runAt || null,
            config: job.config
        }));
    }

    /**
     * Get job by ID
     */
    getJob(jobId) {
        return this.jobs.get(jobId) || null;
    }

    /**
     * Get job history
     */
    getHistory(jobId = null) {
        if (jobId) {
            return this.history.filter(h => h.jobId === jobId);
        }
        return this.history;
    }

    /**
     * Clear job history
     */
    clearHistory() {
        this.history = [];
        this.emit('historyCleared');
    }

    /**
     * Stop the scheduler
     */
    stop() {
        this.isRunning = false;
        for (const job of this.jobs.values()) {
            if (job.task) {
                job.task.stop();
            }
        }
        for (const [, entry] of this.watchedFolders) {
            for (const t of entry.timers.values()) {
                clearTimeout(t);
            }
            entry.timers.clear();
            entry.watcher.close();
        }
        this.watchedFolders.clear();
        this.watchingJobIds.clear();
        this.emit('stopped');
    }

    /**
     * Start the scheduler
     */
    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            for (const job of this.jobs.values()) {
                if (job.task) {
                    job.task.start();
                }
            }
            this.startWatchdog();
            this.emit('started');
        }
    }

    /**
     * Pause a specific job
     */
    pauseJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }
        job.enabled = false;
        job.nextRun = null;
        this.unwatchFolderForJob(job);
        this.saveJobs();
        this.emit('jobPaused', { jobId });
        return job;
    }

    /**
     * Resume a specific job
     */
    resumeJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }
        job.enabled = true;
        if (job.schedule && job.schedule !== 'immediate') {
            job.nextRun = this.getNextRun(job.schedule, job.timezone);
        }
        this.maybeWatchFolder(job);
        this.saveJobs();
        this.emit('jobResumed', { jobId });
        return job;
    }

    /**
     * Run a job immediately
     */
    runNow(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }
        this.executeJob(jobId);
        return job;
    }
}

// Create singleton instance
let instance = null;

function getScheduler() {
    if (!instance) {
        instance = new SchedulerEngine();
    }
    return instance;
}

module.exports = {
    SchedulerEngine,
    getScheduler
};