/**
 * App-Update-Check gegen GitHub Releases (nur Hinweis + Link, kein stilles Install).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_ROOT = path.join(__dirname, '..');

function getAppVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
        return String(pkg.version || '0.0.0');
    } catch {
        return '0.0.0';
    }
}

function getGithubRepoFromConfig(converterDir) {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(converterDir, 'src', 'config.json'), 'utf8'));
        const repo = cfg.githubRepo || '';
        const m = String(repo).match(/github\.com[/:]([^/]+)\/([^/#]+)/i);
        if (m) return { owner: m[1], repo: m[2].replace(/\.git$/, ''), url: repo };
    } catch {
        // ignore
    }
    return { owner: 'fr4iser90', repo: 'LOGA3-Automation', url: 'https://github.com/fr4iser90/LOGA3-Automation' };
}

function parseSemver(v) {
    const m = String(v || '').replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), raw: `${m[1]}.${m[2]}.${m[3]}` };
}

function cmpSemver(a, b) {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    if (!pa || !pb) return 0;
    if (pa.major !== pb.major) return pa.major - pb.major;
    if (pa.minor !== pb.minor) return pa.minor - pb.minor;
    return pa.patch - pb.patch;
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'LOGA3-Automation',
                Accept: 'application/vnd.github+json',
            },
        }, (res) => {
            if (res.statusCode === 404) {
                resolve(null);
                res.resume();
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`GitHub API ${res.statusCode}`));
                res.resume();
                return;
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
    });
}

/**
 * @param {string} converterDir
 * @returns {Promise<object>}
 */
async function checkForAppUpdate(converterDir) {
    const currentVersion = getAppVersion();
    const { owner, repo, url: githubUrl } = getGithubRepoFromConfig(converterDir);
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const release = await fetchJson(apiUrl);

    if (!release || release.draft || release.prerelease) {
        return {
            currentVersion,
            updateAvailable: false,
            latestVersion: null,
            releaseUrl: `${githubUrl}/releases`,
            releaseNotes: '',
            publishedAt: null,
            assets: [],
            message: 'Kein veröffentlichtes Release gefunden.',
        };
    }

    const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
    const updateAvailable = cmpSemver(latestVersion, currentVersion) > 0;
    const assets = (release.assets || []).map((a) => ({
        name: a.name,
        url: a.browser_download_url,
        size: a.size,
    }));

    return {
        currentVersion,
        updateAvailable,
        latestVersion,
        releaseName: release.name || release.tag_name,
        releaseUrl: release.html_url || `${githubUrl}/releases`,
        releaseNotes: String(release.body || '').trim(),
        publishedAt: release.published_at || null,
        assets,
        message: updateAvailable
            ? `Version ${latestVersion} ist verfügbar (aktuell ${currentVersion}).`
            : `Du bist auf dem neuesten Stand (${currentVersion}).`,
    };
}

module.exports = {
    getAppVersion,
    checkForAppUpdate,
    cmpSemver,
    parseSemver,
};
