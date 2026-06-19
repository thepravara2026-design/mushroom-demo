/**
 * Kills any process running on port 5000.
 * This ensures the backend can start on its default port.
 */
const { execSync } = require('child_process');

try {
    const result = execSync(
        'for /f "tokens=5" %a in (\'netstat -aon ^| findstr :5000\') do (if not "%a"=="" taskkill /F /PID %a)',
        { stdio: 'pipe', timeout: 5000 }
    );
    console.log('✅ Port 5000 freed successfully');
} catch (e) {
    // No process on port 5000 or already freed — that's fine
    console.log('ℹ️  Port 5000 is free (no process needed to kill)');
}