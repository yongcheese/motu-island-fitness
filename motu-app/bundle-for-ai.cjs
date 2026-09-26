const fs = require('fs');
const path = require('path');

const EXCLUDE_DIRS = ['node_modules', 'dist', '.next', '.git', 'temp_ai_pack'];
const EXCLUDE_FILES = ['package-lock.json', 'yarn.lock', 'project-source.zip', 'pack-for-ai.cjs', 'pack-for-ai.js', 'README_AI.md', 'project-full-source.md', 'bundle-for-ai.cjs'];
const EXCLUDE_EXTS = ['.mp3', '.wav', '.ogg', '.png', '.jpg', '.jpeg', '.gif', '.glb', '.gltf', '.bin', '.ico', '.woff', '.woff2', '.ttf', '.zip'];

let output = `# Motu 完整原始碼\n\n`;

function processDir(currentPath) {
    const items = fs.readdirSync(currentPath);
    for (const item of items) {
        if (EXCLUDE_DIRS.includes(item) || EXCLUDE_FILES.includes(item)) continue;
        
        const sourceFile = path.join(currentPath, item);
        const stat = fs.statSync(sourceFile);
        
        if (stat.isDirectory()) {
            processDir(sourceFile);
        } else {
            const ext = path.extname(item).toLowerCase();
            if (EXCLUDE_EXTS.includes(ext)) continue;
            
            try {
                const content = fs.readFileSync(sourceFile, 'utf8');
                // Only add files that look like text
                if (content.indexOf('\0') === -1) {
                    const relativePath = path.relative(__dirname, sourceFile).replace(/\\/g, '/');
                    output += `\n\n================================================================\n`;
                    output += `File: ${relativePath}\n`;
                    output += `================================================================\n\n`;
                    output += `\`\`\`${ext.replace('.', '')}\n`;
                    output += content;
                    output += `\n\`\`\`\n`;
                }
            } catch (e) {
                // Ignore read errors
            }
        }
    }
}

console.log('⏳ 正在將所有程式碼合併成單一文件...');
processDir(__dirname);

fs.writeFileSync('project-full-source.md', output, 'utf8');
console.log('✅ project-full-source.md 生成完畢！');
