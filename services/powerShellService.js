/**
 * services/powerShellService.js
 *
 * PowerShell integration service for VizFlow.
 * Executes PowerShell scripts and commands with proper error handling.
 */

'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Module-level state (lazy initialized) ────────────────────────────────
let _cachedPwshPath = null;
let _cachedIsWindows = null;

/**
 * Safely check if running on Windows
 */
function isWindows() {
    if (_cachedIsWindows === null) {
        try {
            _cachedIsWindows = os.platform() === 'win32';
        } catch (e) {
            _cachedIsWindows = false;
        }
    }
    return _cachedIsWindows;
}

/**
 * Safely get default working directory
 */
function getDefaultWorkingDirectory() {
    try {
        // Try to get current working directory safely
        if (typeof process !== 'undefined' && process.cwd) {
            return process.cwd();
        }
    } catch (e) {
        // Fallback
    }
    return os.homedir() || os.tmpdir() || '.';
}

/**
 * Detect PowerShell installation (cached)
 */
function detectPowerShellPath() {
    if (_cachedPwshPath) {
        return _cachedPwshPath;
    }

    try {
        if (isWindows()) {
            // Try PowerShell Core first, then Windows PowerShell
            const paths = ['pwsh.exe', 'powershell.exe'];
            
            for (const p of paths) {
                try {
                    const result = spawnSync(p, ['-Command', '$PSVersionTable.PSVersion'], {
                        timeout: 5000,
                        stdio: ['ignore', 'pipe', 'pipe'],
                        shell: false
                    });
                    if (result.status === 0) {
                        _cachedPwshPath = p;
                        return _cachedPwshPath;
                    }
                } catch (e) {
                    // Continue
                }
            }
            
            // Try common installation paths
            const commonPaths = [
                'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
                'C:\\Program Files\\PowerShell\\6\\pwsh.exe',
                'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
            ];
            
            for (const p of commonPaths) {
                try {
                    if (fs.existsSync(p)) {
                        _cachedPwshPath = p;
                        return _cachedPwshPath;
                    }
                } catch (e) {
                    // Continue
                }
            }
        } else {
            // On Linux/macOS, use pwsh
            try {
                const result = spawnSync('pwsh', ['-Command', '$PSVersionTable.PSVersion'], {
                    timeout: 5000,
                    stdio: ['ignore', 'pipe', 'pipe']
                });
                if (result.status === 0) {
                    _cachedPwshPath = 'pwsh';
                    return _cachedPwshPath;
                }
            } catch (e) {
                // Not found
            }
        }
    } catch (e) {
        // Fallback
    }
    
    throw new Error('PowerShell not found. Please install PowerShell 7+ or Windows PowerShell.');
}

class PowerShellService {
    constructor(options = {}) {
        this.options = {
            timeout: options.timeout || 60000,
            maxOutputSize: options.maxOutputSize || 10 * 1024 * 1024,
            workingDirectory: options.workingDirectory || getDefaultWorkingDirectory(),
            ...options
        };
        
        // Lazy load PowerShell path
        this._pwshPath = null;
    }

    /**
     * Get PowerShell executable path (lazy loaded)
     */
    get pwshPath() {
        if (!this._pwshPath) {
            this._pwshPath = detectPowerShellPath();
        }
        return this._pwshPath;
    }

    /**
     * Execute a PowerShell command
     */
    async executeCommand(command, options = {}) {
        if (!command || typeof command !== 'string') {
            throw new Error('PowerShell command is required');
        }

        const timeout = options.timeout || this.options.timeout;
        const workingDirectory = options.workingDirectory || this.options.workingDirectory;
        const env = options.env || {};

        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            let timedOut = false;

            // Build PowerShell arguments
            const args = [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                command
            ];

            if (options.arguments && Array.isArray(options.arguments)) {
                args.push(...options.arguments);
            }

            // Ensure working directory exists
            let cwd = workingDirectory;
            try {
                if (!fs.existsSync(cwd)) {
                    cwd = getDefaultWorkingDirectory();
                }
            } catch (e) {
                cwd = getDefaultWorkingDirectory();
            }

            // Get environment variables safely
            let envVars = {};
            try {
                envVars = { ...process.env, ...env };
            } catch (e) {
                envVars = { ...env };
            }

            // Spawn PowerShell process
            const childProcess = spawn(this.pwshPath, args, {
                cwd: cwd,
                env: envVars,
                shell: false,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // Set timeout
            const timeoutId = setTimeout(() => {
                timedOut = true;
                childProcess.kill();
                reject(new Error(`PowerShell command timed out after ${timeout}ms`));
            }, timeout);

            // Collect stdout
            childProcess.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                
                if (stdout.length > this.options.maxOutputSize) {
                    childProcess.kill();
                    reject(new Error(`PowerShell output exceeded maximum size (${this.options.maxOutputSize} bytes)`));
                }
            });

            // Collect stderr
            childProcess.stderr.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
            });

            // Handle process exit
            childProcess.on('close', (exitCode) => {
                clearTimeout(timeoutId);
                if (timedOut) return;
                
                resolve({
                    success: exitCode === 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exitCode
                });
            });

            // Handle process error
            childProcess.on('error', (error) => {
                clearTimeout(timeoutId);
                reject(new Error(`Failed to start PowerShell: ${error.message}`));
            });
        });
    }

    /**
     * Execute a PowerShell script file
     */
    async executeScript(scriptPath, options = {}) {
        if (!scriptPath || typeof scriptPath !== 'string') {
            throw new Error('PowerShell script path is required');
        }

        try {
            await fs.promises.access(scriptPath, fs.constants.R_OK);
        } catch (error) {
            throw new Error(`PowerShell script not found or not readable: ${scriptPath}`);
        }

        let command = `& '${scriptPath}'`;

        if (options.parameterValues && typeof options.parameterValues === 'object') {
            for (const [key, value] of Object.entries(options.parameterValues)) {
                const escapedValue = typeof value === 'string' ? `'${value.replace(/'/g, "''")}'` : String(value);
                command += ` -${key} ${escapedValue}`;
            }
        }

        if (options.parameters && Array.isArray(options.parameters)) {
            for (const param of options.parameters) {
                const escapedParam = typeof param === 'string' ? `'${param.replace(/'/g, "''")}'` : String(param);
                command += ` ${escapedParam}`;
            }
        }

        return this.executeCommand(command, options);
    }

    /**
     * Execute a PowerShell command and parse output as JSON
     */
    async executeCommandAsJson(command, options = {}) {
        const jsonCommand = `${command} | ConvertTo-Json -Compress`;
        const result = await this.executeCommand(jsonCommand, options);
        
        if (!result.success) {
            throw new Error(`PowerShell command failed: ${result.stderr || result.stdout}`);
        }

        try {
            return JSON.parse(result.stdout);
        } catch (error) {
            return result.stdout;
        }
    }

    /**
     * Check if PowerShell is available
     */
    isAvailable() {
        try {
            const result = spawnSync(this.pwshPath, ['-Command', 'exit 0'], {
                timeout: 5000,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            return result.status === 0;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get PowerShell version
     */
    async getVersion() {
        const result = await this.executeCommand('$PSVersionTable.PSVersion.ToString()');
        return result.success ? result.stdout : 'Unknown';
    }
}

module.exports = PowerShellService;