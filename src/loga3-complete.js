#!/usr/bin/env node

const path = require('path');
require('dotenv').config({
    path: process.env.LOGA3_PORTABLE_ROOT
        ? path.join(process.env.LOGA3_PORTABLE_ROOT, '.env')
        : path.join(__dirname, '..', '.env'),
});

const Loga3Automation = require('./loga3-automation.js');
const Loga3Workflow = require('./loga3-workflow.js');
const { applySettingsToEnv } = require('./loga3-settings');

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
    }

    async run() {
        try {
            console.log('🚀 Starting complete LOGA3 automation...');

            if (this.targets.length) {
                console.log(`📋 Scheduled months: ${this.targets.map((t) => `${String(t.month).padStart(2, '0')}/${t.year}`).join(' → ')}`);
            } else if (process.env.LOGA3_REQUIRE_TARGETS === '1') {
                throw new Error('Month list missing — please restart GUI and try again');
            }

            console.log('\n📋 Step 1: Performing login...');
            await this.loginAutomation.init();

            const success = await this.loginAutomation.navigateToLogin();
            if (!success) {
                throw new Error('Failed to navigate to login page');
            }

            const config = loadConfig();
            const username = process.env.LOGA3_USERNAME || config.username;
            const password = process.env.LOGA3_PASSWORD || config.password;

            if (!username || !password) {
                throw new Error('Keine Zugangsdaten — in der GUI unter Einstellungen speichern (oder .env / loga3-config.js).');
            }

            const loginSuccess = await this.loginAutomation.performLogin(username, password);

            if (!loginSuccess) {
                await this.loginAutomation.takeScreenshot('complete-login-failed.png');
                throw new Error('Login failed');
            }

            await this.loginAutomation.handle2FA();
            await this.loginAutomation.takeScreenshot('complete-after-login.png');
            console.log('✅ Login completed successfully!');

            console.log('\n📋 Step 2: Starting workflow automation...');
            this.workflowAutomation.browser = this.loginAutomation.browser;
            this.workflowAutomation.page = this.loginAutomation.page;
            this.workflowAutomation.context = this.loginAutomation.context;
            this.workflowAutomation.downloadsDir = this.loginAutomation.downloadsDir || this.workflowAutomation.downloadsDir;
            this.workflowAutomation.applyPageTimeouts();
            console.log(`📁 Downloads destination: ${this.workflowAutomation.downloadsDir}`);
            await this.workflowAutomation.waitForFullNavigation();

            await this.workflowAutomation.clickOpenButton();
            await this.workflowAutomation.logHeaderMonth('After open ("öffnen")');
            await this.workflowAutomation.takeScreenshot('complete-step1-first-open.png');

            const jobs = this.targets.length
                ? this.targets
                : [{ month: null, year: null }];

            for (let index = 0; index < jobs.length; index++) {
                const job = jobs[index];
                const label = job.month && job.year
                    ? `${String(job.month).padStart(2, '0')}/${job.year}`
                    : 'current LOGA3 month';

                console.log(`\n📦 Download ${index + 1}/${jobs.length}: ${label}`);

                const filename = await this.workflowAutomation.runDownloadPipeline(job.month, job.year);
                console.log(`✅ Saved as: ${filename}`);
                if (this.workflowAutomation.lastSavedDownloadPath) {
                    this.savedFiles.push(this.workflowAutomation.lastSavedDownloadPath);
                } else if (filename) {
                    this.savedFiles.push(path.join(this.workflowAutomation.downloadsDir, filename));
                }
                await this.workflowAutomation.takeScreenshot(`complete-download-${index + 1}.png`);
            }

            console.log('\n🎉 Complete automation finished successfully!');

            if (this.exitAfter) {
                await this.cleanup();
                return {
                    ok: true,
                    downloadsDir: this.workflowAutomation.downloadsDir,
                    savedFiles: this.savedFiles,
                };
            }

            console.log('⏸️  Browser will remain open for manual interaction');
            console.log('Press Ctrl+C to close the browser');
            await new Promise(() => {});
            return { ok: true, savedFiles: this.savedFiles };

        } catch (error) {
            console.error('❌ Complete automation failed:', error.message);
            await this.loginAutomation.takeScreenshot('complete-error.png');
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
        console.error('❌ Month list missing (LOGA3_TARGETS / --period). Restart GUI server!');
        process.exit(1);
    }

    const complete = new Loga3Complete({ exitAfter, targets });

    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down...');
        await complete.cleanup();
        process.exit(0);
    });

    complete.run()
        .then((result) => {
            if (!result || !exitAfter) return;
            const dir = result.downloadsDir || getDownloadsDir();
            console.log(`\n📁 PDFs ready for ShiftPlanConverter: ${dir}`);
            if (options.openFolder) openPath(dir);
            if (options.openConverter) openPath(options.converterUrl);
        })
        .catch(console.error);
}

module.exports = Loga3Complete;
