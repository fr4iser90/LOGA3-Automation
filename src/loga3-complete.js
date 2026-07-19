#!/usr/bin/env node

const path = require('path');
require('dotenv').config({
    path: process.env.LOGA3_PORTABLE_ROOT
        ? path.join(process.env.LOGA3_PORTABLE_ROOT, '.env')
        : path.join(__dirname, '..', '.env'),
    quiet: true,
});

const Loga3Automation = require('./loga3-automation.js');
const Loga3Workflow = require('./loga3-workflow.js');
const { applySettingsToEnv } = require('./loga3-settings');
const { t, monthLabel } = require('./loga3-i18n');
const { userT, userErrorT, userError, debugLog } = require('./loga3-log');

applySettingsToEnv(process.env);

function loadConfig() {
    try {
        return require(path.join(__dirname, '..', 'loga3-config.js'));
    } catch {
        return {};
    }
}

/**
 * Complete LOGA3 Automation Script
 * Combines login and workflow automation
 */
class Loga3Complete {
    constructor(options = {}) {
        this.loginAutomation = new Loga3Automation();
        this.workflowAutomation = new Loga3Workflow();
        this.exitAfter = options.exitAfter || false;
        this.targets = options.targets || [];
        this.savedFiles = [];
        this.shuttingDown = false;
    }

    isAbortError(error) {
        if (this.shuttingDown) return true;
        const msg = String(error?.message || error || '');
        return /Target page, context or browser has been closed/i.test(msg)
            || /browser has been closed/i.test(msg)
            || error?.name === 'TargetClosedError';
    }

    async run() {
        try {
            userT('autoStart');

            if (this.targets.length) {
                debugLog(`Scheduled: ${this.targets.map((row) => `${String(row.month).padStart(2, '0')}/${row.year}`).join(' → ')}`);
            } else if (process.env.LOGA3_REQUIRE_TARGETS === '1') {
                throw new Error('Month list missing — please restart GUI and try again');
            }

            userT('autoLogin');
            await this.loginAutomation.init();

            const success = await this.loginAutomation.navigateToLogin();
            if (!success) {
                throw new Error('Failed to navigate to login page');
            }

            const config = loadConfig();
            const username = process.env.LOGA3_USERNAME || config.username;
            const password = process.env.LOGA3_PASSWORD || config.password;

            if (!username || !password) {
                throw new Error(t('autoNoCredentials'));
            }

            const loginSuccess = await this.loginAutomation.performLogin(username, password);

            if (!loginSuccess) {
                await this.loginAutomation.takeScreenshot('complete-login-failed.png');
                throw new Error('Login failed');
            }

            await this.loginAutomation.handle2FA();
            await this.loginAutomation.takeScreenshot('complete-after-login.png');
            userT('autoLoginOk');

            this.workflowAutomation.browser = this.loginAutomation.browser;
            this.workflowAutomation.page = this.loginAutomation.page;
            this.workflowAutomation.context = this.loginAutomation.context;
            this.workflowAutomation.downloadsDir = this.loginAutomation.downloadsDir || this.workflowAutomation.downloadsDir;
            this.workflowAutomation.applyPageTimeouts();
            await this.workflowAutomation.waitForFullNavigation();

            await this.workflowAutomation.clickOpenButton();
            await this.workflowAutomation.logHeaderMonth('After open ("öffnen")');
            await this.workflowAutomation.takeScreenshot('complete-step1-first-open.png');

            const jobs = this.targets.length
                ? this.targets
                : [{ month: null, year: null }];

            for (let index = 0; index < jobs.length; index++) {
                if (this.shuttingDown) break;
                const job = jobs[index];
                const label = job.month && job.year
                    ? `${monthLabel(job.month)} ${job.year}`
                    : 'LOGA3';

                userT('autoMonth', { index: index + 1, total: jobs.length, label });

                try {
                    const filename = await this.workflowAutomation.runDownloadPipeline(job.month, job.year);
                    userT('autoSaved', { filename });
                    if (this.workflowAutomation.lastSavedDownloadPath) {
                        this.savedFiles.push(this.workflowAutomation.lastSavedDownloadPath);
                    } else if (filename) {
                        this.savedFiles.push(path.join(this.workflowAutomation.downloadsDir, filename));
                    }
                    await this.workflowAutomation.takeScreenshot(`complete-download-${index + 1}.png`);
                } catch (error) {
                    if (error.code === 'NO_PLAN' || String(error.message || '').startsWith('NO_PLAN:')) {
                        userT('autoNoPlan', { label });
                        const month = job.month || error.targetMonth;
                        const year = job.year || error.targetYear;
                        await this.workflowAutomation.writeNoPlanMarker(month, year);
                        continue;
                    }
                    throw error;
                }
            }

            if (this.shuttingDown) {
                return { ok: false, cancelled: true, savedFiles: this.savedFiles };
            }

            if (this.exitAfter) {
                await this.cleanup();
                return {
                    ok: true,
                    downloadsDir: this.workflowAutomation.downloadsDir,
                    savedFiles: this.savedFiles,
                };
            }

            debugLog('Browser will remain open for manual interaction (Ctrl+C to close)');
            await new Promise(() => {});
            return { ok: true, savedFiles: this.savedFiles };

        } catch (error) {
            if (this.isAbortError(error)) {
                try { await this.cleanup(); } catch { /* ignore */ }
                process.exit(0);
            }
            userErrorT('autoFailed', { message: error.message });
            try { await this.loginAutomation.takeScreenshot('complete-error.png'); } catch { /* ignore */ }
            process.exit(1);
        }
    }

    async cleanup() {
        if (this.loginAutomation.browser) {
            await this.loginAutomation.cleanup();
        }
    }
}

// Main execution
if (require.main === module) {
    const {
        parseCliOptions,
        applyOutDir,
        openPath,
    } = require('./loga3-cli-args.js');
    const { getDownloadsDir } = require('./loga3-inventory');

    const options = parseCliOptions(process.argv);
    const exitAfter = options.once || process.argv.includes('--once');
    const targets = options.targets;

    if (options.outDir) {
        applyOutDir(options.outDir);
    }

    if (process.env.LOGA3_REQUIRE_TARGETS === '1' && !targets.length) {
        userError('❌ Month list missing (LOGA3_TARGETS / --period). Restart GUI server!');
        process.exit(1);
    }

    const complete = new Loga3Complete({ exitAfter, targets });

    const shutdownJob = async () => {
        if (complete.shuttingDown) return;
        complete.shuttingDown = true;
        try {
            await complete.cleanup();
        } catch {
            // ignore close races while cancelling
        }
        process.exit(0);
    };

    process.on('SIGINT', shutdownJob);
    process.on('SIGTERM', shutdownJob);

    complete.run()
        .then((result) => {
            if (!result || !exitAfter) return;
            if (result.cancelled) return;
            const dir = result.downloadsDir || getDownloadsDir();
            userT('autoFinished', { dir });
            if (options.openFolder) openPath(dir);
            if (options.openConverter) openPath(options.converterUrl);
        })
        .catch(console.error);
}

module.exports = Loga3Complete;
