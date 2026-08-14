/**
 * engine/scheduler/schedulerStore.js
 *
 * Persistence layer for the VizFlow scheduler.
 *
 * Jobs + execution history live in a single JSON file. In the extension host
 * this file is placed under `context.globalStorageUri` so scheduled jobs
 * survive extension updates and are independent of the (often read-only)
 * extension install folder.
 *
 * Also handles migrating an older config file (e.g. the old
 * `extensionPath/scheduler-config.json`) into the new location.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_VERSION = '2.0.0';

class SchedulerStore {
    /**
     * @param {string|null} configPath - Absolute path of the scheduler config file.
     */
    constructor(configPath) {
        this.configPath = configPath;
        this.data = {
            version: CONFIG_VERSION,
            updatedAt: null,
            jobs: [],
            history: []
        };
    }

    /**
     * Read the config file (if present) into memory.
     * @returns {{version: string, updatedAt: string|null, jobs: Array, history: Array}}
     */
    load() {
        this.data = {
            version: CONFIG_VERSION,
            updatedAt: null,
            jobs: [],
            history: []
        };

        if (!this.configPath || !fs.existsSync(this.configPath)) {
            return this.data;
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            this.data.jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
            this.data.history = Array.isArray(parsed.history) ? parsed.history : [];
            this.data.updatedAt = parsed.updatedAt || null;
        } catch (e) {
            void e;
            this.data.jobs = [];
            this.data.history = [];
        }

        return this.data;
    }

    /**
     * Atomically persist jobs + history.
     * @param {Array} jobs - Already serialized job objects.
     * @param {Array} history - Execution history entries.
     */
    save(jobs, history) {
        if (!this.configPath) return;

        this.data = {
            version: CONFIG_VERSION,
            updatedAt: new Date().toISOString(),
            jobs: Array.isArray(jobs) ? jobs : [],
            history: Array.isArray(history) ? history : []
        };

        const dir = path.dirname(this.configPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Write-then-rename keeps the file from being corrupted by a crash
        // mid-write.
        const tmpPath = `${this.configPath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
        fs.renameSync(tmpPath, this.configPath);
    }

    /**
     * Import jobs from an older config location. Only runs when the new
     * storage is empty, so a fresh global-storage file picks up previously
     * scheduled jobs instead of silently losing them.
     * @param {string|null} oldPath - Absolute path of the legacy config file.
     * @returns {boolean} True when jobs were migrated.
     */
    migrateFrom(oldPath) {
        if (!oldPath || !fs.existsSync(oldPath)) return false;
        if (this.data.jobs.length > 0) return false;

        try {
            const old = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
            if (!Array.isArray(old.jobs) || old.jobs.length === 0) return false;

            this.data.jobs = old.jobs;
            this.data.history = Array.isArray(old.history) ? old.history : [];
            this.save(this.data.jobs, this.data.history);
            return true;
        } catch (e) {
            void e;
            return false;
        }
    }
}

module.exports = {
    SchedulerStore,
    CONFIG_VERSION
};
