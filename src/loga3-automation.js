#!/usr/bin/env node

const { chromium, firefox } = require('playwright');
const path = require('path');
const fs = require('fs');
const { getDownloadsDir, getLogsDir, resolveHeadless } = require('./loga3-inventory');
const { applySettingsToEnv } = require('./loga3-settings');

require('dotenv').config({
    path: process.env.LOGA3_PORTABLE_ROOT
        ? path.join(process.env.LOGA3_PORTABLE_ROOT, '.env')
        : path.join(__dirname, '..', '.env'),
});
applySettingsToEnv(process.env);

// Optional local config at repo root (gitignored).
let config = {};
try {
    config = require(path.join(__dirname, '..', 'loga3-config.js'));
} catch (error) {
    console.log('ℹ️  No loga3-config.js — using GUI settings / .env / environment variables');
}

/**
 * LOGA3 Login Automation Script
 * Automates login to https://stelisab.pi-asp.de/loga3/#
 */
class Loga3Automation {
    constructor() {
        this.browser = null;
        this.page = null;
        this.baseUrl = config.baseUrl || 'https://stelisab.pi-asp.de/loga3/#';
        this.browserConfig = config.browser || {};
        this.screenshotConfig = config.screenshots || {};
        this.elementTimeout = this.browserConfig.timeout || 60000;
        this.pageLoadTimeout = this.browserConfig.pageLoadTimeout || 90000;
        this.stepDelay = this.browserConfig.sleepBetweenSteps || 5000;
        this.uiDelay = Math.min(this.stepDelay, 1200);
    }

    async init() {
        console.log('🚀 Starting LOGA3 automation...');
        
        // Launch browser based on config
        const browserType = this.browserConfig.type || 'chromium';
        const browserEngine = browserType === 'firefox' ? firefox : chromium;
        
        // Browser launch options
        const launchOptions = {
            headless: resolveHeadless(this.browserConfig),
            slowMo: this.browserConfig.slowMo || 1000
        };
        
        // Firefox profile not compatible with Playwright, using Chromium instead
        
        this.browser = await browserEngine.launch(launchOptions);

        // Temp staging only — final saveAs happens in the workflow (one place).
        this.downloadsDir = getDownloadsDir();
        if (!fs.existsSync(this.downloadsDir)) {
            fs.mkdirSync(this.downloadsDir, { recursive: true });
        }
        console.log(`📁 Downloads folder: ${this.downloadsDir}`);

        const context = await this.browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: browserType === 'firefox' 
                ? 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0'
                : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            acceptDownloads: true,
            downloadsPath: this.downloadsDir
        });

        this.context = context;
        this.page = await context.newPage();
        this.page.setDefaultTimeout(this.elementTimeout);
        this.page.setDefaultNavigationTimeout(this.pageLoadTimeout);
    }

    async navigateToLogin() {
        console.log('📡 Navigating to LOGA3 login page...');
        
        try {
            await this.page.goto(this.baseUrl, { 
                waitUntil: 'domcontentloaded',
                timeout: this.pageLoadTimeout 
            });
            
            await this.page.waitForSelector(
                'input[name="Kennung"], input[name="username"], input[type="text"]',
                { timeout: this.elementTimeout }
            );
            await this.page.waitForTimeout(this.uiDelay);
            
            console.log('✅ Successfully loaded LOGA3 login page');
            return true;
        } catch (error) {
            console.error('❌ Failed to navigate to login page:', error.message);
            return false;
        }
    }

    async performLogin(username, password) {
        console.log('🔐 Attempting to login...');
        
        try {
            // Wait for login form to be visible
            await this.page.waitForSelector('input[name="Kennung"], input[name="username"], input[type="text"]', { timeout: this.elementTimeout });
            
            // Find username field (try multiple possible selectors)
            const usernameSelectors = [
                'input[name="Kennung"]',
                'input[name="username"]', 
                'input[type="text"]',
                'input[placeholder*="Kennung"]',
                'input[placeholder*="Benutzername"]'
            ];
            
            let usernameField = null;
            for (const selector of usernameSelectors) {
                try {
                    usernameField = await this.page.$(selector);
                    if (usernameField) break;
                } catch (e) {
                    continue;
                }
            }
            
            if (!usernameField) {
                throw new Error('Username field not found');
            }
            
            // Find password field
            const passwordSelectors = [
                'input[name="Kennwort"]',
                'input[name="password"]',
                'input[type="password"]',
                'input[placeholder*="Kennwort"]',
                'input[placeholder*="Passwort"]'
            ];
            
            let passwordField = null;
            for (const selector of passwordSelectors) {
                try {
                    passwordField = await this.page.$(selector);
                    if (passwordField) break;
                } catch (e) {
                    continue;
                }
            }
            
            if (!passwordField) {
                throw new Error('Password field not found');
            }
            
            // Clear and fill username
            await usernameField.click({ clickCount: 3 });
            await usernameField.fill(username);
            console.log('✅ Username entered');
            
            // Clear and fill password
            await passwordField.click({ clickCount: 3 });
            await passwordField.fill(password);
            console.log('✅ Password entered');
            
            // Try pressing Enter first (faster alternative)
            await passwordField.press('Enter');
            console.log('✅ Enter pressed');
            
            // Wait a moment to see if login worked
            await this.page.waitForTimeout(this.stepDelay);
            const currentUrl = this.page.url();
            if (currentUrl.includes('login') || currentUrl.includes('#')) {
                console.log('🔄 Still on login page, trying button click...');
                
                // Look for login button
                const loginButtonSelectors = [
                    'button[type="submit"]',
                    'input[type="submit"]',
                    'button:has-text("Anmelden")',
                    'input[value*="Anmelden"]',
                    'button:has-text("Login")',
                    'input[value*="Login"]'
                ];
                
                let loginButton = null;
                for (const selector of loginButtonSelectors) {
                    try {
                        loginButton = await this.page.$(selector);
                        if (loginButton) break;
                    } catch (e) {
                        continue;
                    }
                }
                
                if (loginButton) {
                    await loginButton.click();
                    console.log('✅ Login button clicked');
                } else {
                    console.log('⚠️  No login button found, but Enter was pressed');
                }
            }
            
            // Wait for navigation or error messages
            await this.page.waitForTimeout(this.stepDelay);
            const errorMessages = [
                'Die Kennung bzw. das Kennwort ist falsch',
                'Kennung bzw. das Kennwort ist falsch',
                'falsch',
                'error',
                'Fehler'
            ];
            
            const pageContent = await this.page.content();
            const hasError = errorMessages.some(msg => 
                pageContent.toLowerCase().includes(msg.toLowerCase())
            );
            
            if (hasError) {
                console.log('⚠️  Login may have failed - error message detected');
                return false;
            }
            
            console.log('✅ Login attempt completed');
            return true;
            
        } catch (error) {
            console.error('❌ Login failed:', error.message);
            return false;
        }
    }

    async handle2FA() {
        console.log('🔐 Checking for 2FA requirement...');
        
        try {
            // Wait a bit to see if 2FA page loads
            await this.page.waitForTimeout(this.stepDelay);
            const pageContent = await this.page.content();
            const has2FA = pageContent.includes('2-Faktor') || 
                          pageContent.includes('QR-Code') || 
                          pageContent.includes('Authenticator');
            
            if (has2FA) {
                console.log('🔐 2FA detected - manual intervention required');
                console.log('📱 Please complete 2FA manually in the browser');
                
                // Wait for user to complete 2FA (up to 5 minutes)
                console.log('⏳ Waiting for 2FA completion...');
                await this.page.waitForTimeout(300000); // 5 minutes
                
                return true;
            }
            
            return false;
        } catch (error) {
            console.log('ℹ️  No 2FA detected or error occurred:', error.message);
            return false;
        }
    }

    async takeScreenshot(filename = 'loga3-screenshot.png') {
        try {
            if (!this.screenshotConfig.enabled) {
                return;
            }
            
            const screenshotDir = this.screenshotConfig.directory || getLogsDir();
            const screenshotPath = path.join(screenshotDir, filename);
            await this.page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`📸 Screenshot saved: ${screenshotPath}`);
        } catch (error) {
            console.error('❌ Failed to take screenshot:', error.message);
        }
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            console.log('🧹 Browser closed');
        }
    }

    async run() {
        try {
            await this.init();
            
            const success = await this.navigateToLogin();
            if (!success) {
                throw new Error('Failed to navigate to login page');
            }
            
            // Prefer env (.env) over config file so secrets stay out of git
            const username = process.env.LOGA3_USERNAME || config.username;
            const password = process.env.LOGA3_PASSWORD || config.password;

            if (!username || !password) {
                throw new Error('Keine Zugangsdaten — in der GUI unter Einstellungen speichern (oder .env / loga3-config.js).');
            }
            
            const loginSuccess = await this.performLogin(username, password);
            
            if (loginSuccess) {
                await this.handle2FA();
                await this.takeScreenshot('loga3-after-login.png');
                
                console.log('🎉 Login process completed successfully!');
                console.log('⏸️  Browser will remain open for manual interaction');
                
                // Keep browser open for manual interaction
                console.log('Press Ctrl+C to close the browser');
                await new Promise(() => {}); // Keep script running
            } else {
                await this.takeScreenshot('loga3-login-failed.png');
                throw new Error('Login failed');
            }
            
        } catch (error) {
            console.error('❌ Automation failed:', error.message);
            await this.takeScreenshot('loga3-error.png');
            process.exit(1);
        }
    }
}

// Main execution
if (require.main === module) {
    const automation = new Loga3Automation();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down...');
        await automation.cleanup();
        process.exit(0);
    });
    
    automation.run().catch(console.error);
}

module.exports = Loga3Automation;
