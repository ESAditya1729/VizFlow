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

class SchedulerEngine extends EventEmitter {
    constructor() {
        super();
        this.jobs = new Map(); // jobId -> { task, schedule, workflowDef, config }
        this.runningJobs = new Map(); // jobId -> { startTime, status, executionId, cancelled }
        this.history = [];
        this.configPath = null;
        this.isRunning = false;
        this.executionIdCounter = 0;
    }

    /**
     * Initialize the scheduler with a config file path
     */
    initialize(configPath) {
        this.configPath = configPath;
        this.loadJobs();
        this.startWatchdog();
        this.isRunning = true;
        this.emit('initialized', { count: this.jobs.size });
    }

    /**
     * Load jobs from config file
     */
    loadJobs() {
        try {
            if (this.configPath && fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf8');
                const config = JSON.parse(data);
                
                if (config.jobs) {
                    for (const jobConfig of config.jobs) {
                        this.addJob(jobConfig);
                    }
                }
            }
        } catch (error) {
            this.emit('error', { message: `Failed to load jobs: ${error.message}` });
        }
    }

    /**
     * Save jobs to config file
     */
    saveJobs() {
        try {
            if (!this.configPath) return;
            
            const config = {
                version: '1.0.0',
                updatedAt: new Date().toISOString(),
                jobs: Array.from(this.jobs.values()).map(job => ({
                    id: job.id,
                    name: job.name,
                    schedule: job.schedule,
                    workflowFile: job.workflowFile,
                    config: job.config,
                    enabled: job.enabled,
                    oneTime: job.oneTime || false,
                    runOnce: job.runOnce || false,
                    runAt: job.runAt || null,
                    createdAt: job.createdAt,
                    updatedAt: job.updatedAt,
                    lastRun: job.lastRun,
                    status: job.status
                }))
            };
            
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
            this.emit('saved', { path: this.configPath });
        } catch (error) {
            this.emit('error', { message: `Failed to save jobs: ${error.message}` });
        }
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
            workflowFile: config.workflowFile,
            workflowDef: config.workflowDef || null,
            oneTime: config.oneTime || false,
            runOnce: config.runOnce || false,
            runAt: config.runAt || null,
            config: {
                watchFolder: config.watchFolder || null,
                notifications: config.notifications || {},
                parameters: config.parameters || {},
                timeout: config.timeout || 3600,
                retryCount: config.retryCount || 3,
                retryDelay: config.retryDelay || 60,
                maxConcurrent: config.maxConcurrent || 1,
                runImmediately: config.runImmediately || false,
                ...config.config
            },
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
            });
            job.task = task;
            job.nextRun = this.getNextRun(job.schedule);
        } else {
            job.task = null;
            job.nextRun = null;
        }
        
        this.jobs.set(jobId, job);
        this.saveJobs();
        
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
        if (updates.config) job.config = { ...job.config, ...updates.config };
        if (updates.enabled !== undefined) job.enabled = updates.enabled;
        if (updates.oneTime !== undefined) job.oneTime = updates.oneTime;
        if (updates.runOnce !== undefined) job.runOnce = updates.runOnce;
        if (updates.runAt !== undefined) job.runAt = updates.runAt;

        job.updatedAt = new Date().toISOString();

        // Reschedule if not immediate
        if (job.schedule && job.schedule !== 'immediate') {
            const task = cron.schedule(job.schedule, () => {
                if (job.enabled && !job.oneTime) {
                    this.executeJob(jobId);
                } else if (job.oneTime) {
                    this.executeJob(jobId).then(() => {
                        this.removeJob(jobId);
                        this.emit('jobCompletedOneTime', { jobId, jobName: job.name });
                    });
                }
            });
            job.task = task;
            job.nextRun = this.getNextRun(job.schedule);
        } else {
            job.task = null;
            job.nextRun = null;
            if (job.schedule === 'immediate') {
                setTimeout(() => this.executeJob(jobId), 500);
            }
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
            setTimeout(() => this.executeJob(jobId), 5000);
            return;
        }

        // Generate execution ID
        const executionId = `exec_${++this.executionIdCounter}_${Date.now()}`;

        // Mark as running
        const startTime = Date.now();
        this.runningJobs.set(jobId, { 
            startTime, 
            status: 'running', 
            executionId,
            cancelled: false
        });
        job.status = 'running';
        job.lastRun = new Date().toISOString();
        
        this.emit('jobStarted', { 
            jobId, 
            jobName: job.name, 
            executionId,
            startTime: job.lastRun
        });

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
                if (job.workflowFile && !workflowDef) {
                    const filePath = path.resolve(job.workflowFile);
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

                // Apply parameters
                if (job.config.parameters) {
                    workflowDef = this.applyParameters(workflowDef, job.config.parameters);
                }

                // Resolve paths
                const resolvePath = (p) => path.resolve(p);

                // Execute workflow
                const result = await executeWorkflow(workflowDef, {
                    resolvePath,
                    onStateChange: (activityId, state, stats, error) => {
                        // Check if cancelled during execution
                        const runningCheck = this.runningJobs.get(jobId);
                        if (runningCheck && runningCheck.cancelled) {
                            throw new Error('Job cancelled by user');
                        }
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
        const running = this.runningJobs.get(jobId);
        if (running && !running.cancelled) {
            const finalStatus = success ? 'completed' : 'failed';
            job.status = finalStatus;
            
            if (!success && !running.cancelled) {
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
            cancelled: running ? running.cancelled : false
        });

        // Keep only last 200 history entries
        if (this.history.length > 200) {
            this.history = this.history.slice(-200);
        }

        this.saveJobs();
        this.emit('jobUpdated', { jobId });
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

        // Create a one-time job
        const oneTimeConfig = {
            name: `${job.name} (One-time)`,
            schedule: `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`,
            workflowFile: job.workflowFile,
            workflowDef: job.workflowDef,
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
     * Apply parameters to workflow
     */
    applyParameters(workflowDef, parameters) {
        const json = JSON.stringify(workflowDef);
        const replaced = json.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
            const value = parameters[key.trim()];
            return value !== undefined ? value : match;
        });
        return JSON.parse(replaced);
    }

    /**
     * Get next run time for a cron schedule
     */
   getNextRun(schedule) {
    try {
        // Simple next run calculation based on current time
        const now = new Date();
        const parts = schedule.split(' ');
        if (parts.length !== 5) return null;
        
        const minute = parts[0] === '*' ? null : parseInt(parts[0]);
        const hour = parts[1] === '*' ? null : parseInt(parts[1]);
        const day = parts[2] === '*' ? null : parseInt(parts[2]);
        const month = parts[3] === '*' ? null : parseInt(parts[3]);
        const dayOfWeek = parts[4] === '*' ? null : parseInt(parts[4]);
        
        // Calculate next run (simplified)
        let next = new Date(now);
        next.setSeconds(0);
        next.setMilliseconds(0);
        
        // Set minute
        if (minute !== null) {
            if (next.getMinutes() >= minute) {
                next.setHours(next.getHours() + 1);
            }
            next.setMinutes(minute);
        }
        
        // Set hour
        if (hour !== null) {
            if (next.getHours() > hour || (next.getHours() === hour && next.getMinutes() > (minute || 0))) {
                next.setDate(next.getDate() + 1);
            }
            next.setHours(hour);
        }
        
        // Set day
        if (day !== null && month !== null) {
            // Specific date
            let targetMonth = month - 1;
            let targetDay = day;
            let currentMonth = next.getMonth();
            let currentYear = next.getFullYear();
            
            if (currentMonth > targetMonth || (currentMonth === targetMonth && next.getDate() > targetDay)) {
                currentYear++;
            }
            next.setFullYear(currentYear);
            next.setMonth(targetMonth);
            next.setDate(targetDay);
        } else if (day !== null) {
            // Every month on specific day
            if (next.getDate() > day) {
                next.setMonth(next.getMonth() + 1);
            }
            next.setDate(day);
        }
        
        // Set month
        if (month !== null) {
            let targetMonth = month - 1;
            if (next.getMonth() > targetMonth || (next.getMonth() === targetMonth && next.getDate() > (day || 1))) {
                next.setFullYear(next.getFullYear() + 1);
            }
            next.setMonth(targetMonth);
        }
        
        // If the calculated time is in the past, add one more cycle
        if (next <= now) {
            if (day !== null && month !== null) {
                // Yearly - add 1 year
                next.setFullYear(next.getFullYear() + 1);
            } else if (day !== null) {
                // Monthly - add 1 month
                next.setMonth(next.getMonth() + 1);
            } else if (hour !== null) {
                // Daily - add 1 day
                next.setDate(next.getDate() + 1);
            } else {
                // Hourly - add 1 hour
                next.setHours(next.getHours() + 1);
            }
        }
        
        return next.toISOString();
    } catch (error) {
        // Fallback: return a time 1 hour from now
        const fallback = new Date(Date.now() + 3600000);
        return fallback.toISOString();
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
     * Watch folder for new files
     */
    startWatchdog() {
        const watchedFolders = new Set();
        
        for (const job of this.jobs.values()) {
            if (job.config.watchFolder && job.enabled) {
                const folder = path.resolve(job.config.watchFolder);
                if (!watchedFolders.has(folder)) {
                    watchedFolders.add(folder);
                    this.watchFolder(folder);
                }
            }
        }
    }

    /**
     * Watch a folder for changes
     */
    watchFolder(folder) {
        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true });
        }

        fs.watch(folder, (eventType, filename) => {
            if (eventType === 'rename' && filename) {
                this.emit('fileChanged', {
                    folder,
                    filename,
                    eventType
                });
                
                // Find jobs watching this folder
                for (const job of this.jobs.values()) {
                    if (job.enabled && job.config.watchFolder) {
                        const watched = path.resolve(job.config.watchFolder);
                        if (watched === folder) {
                            this.emit('fileTriggeredJob', { jobId: job.id, filename });
                            this.executeJob(job.id);
                        }
                    }
                }
            }
        });

        this.emit('folderWatched', { folder });
    }

    /**
     * Get all jobs
     */
    getJobs() {
        return Array.from(this.jobs.values()).map(job => ({
            id: job.id,
            name: job.name,
            schedule: job.schedule,
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
            job.nextRun = this.getNextRun(job.schedule);
        }
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