/**
 * services/database/connectionManager.js
 *
 * Manages saved external data-source connections (MongoDB, MySQL, PostgreSQL).
 *
 * - Non-secret connection metadata is persisted in VS Code `globalState`
 *   (available across workspaces).
 * - Secrets (password / connection string) live in VS Code `SecretStorage`
 *   (OS keychain) under `vizflow.connection.<id>`.
 *
 * Workflows reference a connection by its friendly `name`; the engine resolves
 * the secret at execution time so `.vizflow` files never contain credentials
 * and stay safe to commit to git.
 */

'use strict';

const STORAGE_KEY = 'vizflow.connections';
const SECRET_PREFIX = 'vizflow.connection.';

const CONNECTION_TYPES = {
    mongodb: { label: 'MongoDB', icon: '🍃' },
    mysql: { label: 'MySQL', icon: '🐬' },
    postgresql: { label: 'PostgreSQL', icon: '🐘' }
};

/**
 * Create a unique connection id.
 * @returns {string}
 */
function generateId() {
    const rand = Math.random().toString(36).slice(2, 10);
    return `conn_${Date.now().toString(36)}_${rand}`;
}

/**
 * Redact a connection object so secrets never leave the manager.
 * @param {Object} profile
 * @returns {Object} Copy without secret fields
 */
function redact(profile) {
    if (!profile || typeof profile !== 'object') return profile;
    const copy = { ...profile };
    delete copy.password;
    delete copy.connectionString;
    return copy;
}

/**
 * Validate a connection profile shape.
 * @param {Object} profile
 * @param {boolean} requireSecret - Whether a password/URI must be present
 * @returns {string|null} Error message or null when valid
 */
function validateProfile(profile, requireSecret = false) {
    if (!profile || typeof profile !== 'object') {
        return 'Connection profile must be an object';
    }
    if (!profile.name || typeof profile.name !== 'string' || !profile.name.trim()) {
        return 'Connection "name" is required';
    }
    if (!CONNECTION_TYPES[profile.type]) {
        return `Unsupported connection type "${profile.type}". Supported: ${Object.keys(CONNECTION_TYPES).join(', ')}`;
    }

    if (profile.connectionString && typeof profile.connectionString === 'string' && profile.connectionString.trim()) {
        return null;
    }

    if (!profile.host || typeof profile.host !== 'string' || !profile.host.trim()) {
        return 'Connection "host" is required';
    }

    if (requireSecret && (!profile.password || typeof profile.password !== 'string')) {
        return `A password is required for ${profile.name}`;
    }

    return null;
}

class ConnectionManager {
    /**
     * @param {Object} deps
     * @param {Object} deps.globalState - VS Code Memento (get/update)
     * @param {Object} deps.secrets - VS Code SecretStorage (get/store/delete)
     */
    constructor(deps) {
        this._globalState = deps.globalState;
        this._secrets = deps.secrets;
    }

    /**
     * Read the raw (secret-free) metadata list from storage.
     * @returns {Array<Object>}
     */
    _readProfiles() {
        const stored = this._globalState.get(STORAGE_KEY, []);
        return Array.isArray(stored) ? stored : [];
    }

    /**
     * Persist the metadata list.
     * @param {Array<Object>} profiles
     * @returns {Promise<void>}
     */
    async _writeProfiles(profiles) {
        await this._globalState.update(STORAGE_KEY, profiles);
    }

    /**
     * Get the stored secret payload for a connection id.
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async _getSecret(id) {
        if (!id) return null;
        try {
            const raw = await this._secrets.get(`${SECRET_PREFIX}${id}`);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    /**
     * Store a secret payload for a connection id.
     * @param {string} id
     * @param {Object} payload
     * @returns {Promise<void>}
     */
    async _setSecret(id, payload) {
        await this._secrets.store(`${SECRET_PREFIX}${id}`, JSON.stringify(payload));
    }

    /**
     * List all saved connections (secrets redacted).
     * @returns {Array<Object>}
     */
    list() {
        return this._readProfiles().map(redact);
    }

    /**
     * Get a connection by id with its secret merged in.
     * @param {string} id
     * @returns {Promise<Object|null>} Full profile or null
     */
    async get(id) {
        const profiles = this._readProfiles();
        const profile = profiles.find((p) => p.id === id);
        if (!profile) return null;
        return this._mergeSecret(profile);
    }

    /**
     * Find a connection by friendly name (case-insensitive), falling back to
     * exact id match. Merges the stored secret.
     * @param {string} nameOrId
     * @returns {Promise<Object|null>}
     */
    async getByName(nameOrId) {
        if (!nameOrId || typeof nameOrId !== 'string') return null;
        const profiles = this._readProfiles();
        const profile = profiles.find(
            (p) => p.name.toLowerCase() === nameOrId.toLowerCase() || p.id === nameOrId
        );
        if (!profile) return null;
        return this._mergeSecret(profile);
    }

    /**
     * Merge stored secret into a profile.
     * @param {Object} profile
     * @returns {Promise<Object>}
     */
    async _mergeSecret(profile) {
        const secret = await this._getSecret(profile.id);
        return {
            ...profile,
            password: secret ? secret.password : undefined,
            connectionString: secret ? secret.connectionString : undefined
        };
    }

    /**
     * Create or update a connection. Persists metadata + secret.
     * @param {Object} profile
     * @returns {Promise<Object>} The saved profile (id assigned when new)
     */
    async save(profile) {
        const error = validateProfile(profile, false);
        if (error) {
            throw new Error(`Invalid connection: ${error}`);
        }

        const profiles = this._readProfiles();

        // Rename / id collision handling: keep the id stable across edits.
        const normalizedName = profile.name.trim();
        if (!profile.id) {
            profile.id = generateId();
        }

        // If no id was provided but a profile with the same name exists, reuse it.
        let target = profile;
        const existingIndex = profiles.findIndex((p) => p.id === profile.id);
        if (existingIndex === -1) {
            const byName = profiles.findIndex(
                (p) => p.name.toLowerCase() === normalizedName.toLowerCase()
            );
            if (byName !== -1) {
                target = { ...profile, id: profiles[byName].id };
                profiles[byName] = redact(target);
            } else {
                profiles.push(redact(target));
            }
        } else {
            profiles[existingIndex] = redact(target);
        }

        await this._writeProfiles(profiles);

        // Preserve an existing secret when the caller did not provide a new
        // password/connection string (e.g. editing host without re-entering it).
        const secret = (await this._getSecret(target.id)) || {};
        if (profile.password !== undefined) secret.password = profile.password;
        if (profile.connectionString !== undefined && profile.connectionString !== '') {
            secret.connectionString = profile.connectionString;
        }
        await this._setSecret(target.id, secret);

        return { ...redact(target), id: target.id };
    }

    /**
     * Delete a connection and its stored secret.
     * @param {string} id
     * @returns {Promise<boolean>} True when deleted
     */
    async delete(id) {
        const profiles = this._readProfiles();
        const index = profiles.findIndex((p) => p.id === id);
        if (index === -1) return false;
        profiles.splice(index, 1);
        await this._writeProfiles(profiles);
        try {
            await this._secrets.delete(`${SECRET_PREFIX}${id}`);
        } catch {
            // Ignore secret deletion errors — metadata removal is authoritative.
        }
        return true;
    }

    /**
     * Test a connection using the matching database driver.
     * @param {Object} profile - Full profile (may include secret fields)
     * @returns {Promise<{ ok: boolean, message?: string, error?: string }>}
     */
    async test(profile) {
        const error = validateProfile(profile, true);
        if (error) {
            return { ok: false, error };
        }
        try {
            if (profile.type === 'mongodb') {
                const { testConnection } = require('./mongoService');
                return await testConnection(profile);
            }
            const { testConnection } = require('./sqlService');
            return await testConnection(profile);
        } catch (err) {
            return { ok: false, error: err.message || String(err) };
        }
    }
}

// ─── Singleton (extension host) ──────────────────────────────────────────────

let _instance = null;

/**
 * Initialize the shared ConnectionManager for the extension host.
 * @param {Object} context - vscode.ExtensionContext
 * @returns {ConnectionManager}
 */
function initConnectionManager(context) {
    _instance = new ConnectionManager({
        globalState: context.globalState,
        secrets: context.secrets
    });
    return _instance;
}

/**
 * Get the shared ConnectionManager (must be initialized first).
 * @returns {ConnectionManager}
 */
function getConnectionManager() {
    if (!_instance) {
        throw new Error('Connection manager is not initialized. Call initConnectionManager(context) from activate().');
    }
    return _instance;
}

/**
 * Test/helper exports for unit tests.
 * @returns {ConnectionManager}
 */
function createConnectionManager(deps) {
    return new ConnectionManager(deps);
}

module.exports = {
    ConnectionManager,
    CONNECTION_TYPES,
    generateId,
    validateProfile,
    redact,
    initConnectionManager,
    getConnectionManager,
    createConnectionManager
};
