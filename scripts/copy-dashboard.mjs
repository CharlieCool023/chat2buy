import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');
const source = path.join(root, 'app', 'dist');
const target = path.join(root, 'whatsapp-autopilot', 'dashboard-dist');

if (!fs.existsSync(source)) {
    throw new Error(`Dashboard build not found at ${source}. Run npm --prefix app run build first.`);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true });

console.log(`Copied dashboard build to ${target}`);
