const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXCLUDE_DIRS = ['node_modules', 'dist', '.next', '.git', 'temp_ai_pack'];
const EXCLUDE_FILES = ['package-lock.json', 'yarn.lock', 'project-source.zip', 'pack-for-ai.js', 'README_AI.md'];
const EXCLUDE_EXTS = ['.mp3', '.wav', '.ogg', '.png', '.jpg', '.jpeg', '.gif', '.glb', '.gltf', '.bin', '.ico', '.woff', '.woff2', '.ttf'];

// 1. 產生目錄樹
function generateTree(dir, prefix = '') {
    let tree = '';
    let items;
    try {
        items = fs.readdirSync(dir).filter(i => !EXCLUDE_DIRS.includes(i) && !EXCLUDE_FILES.includes(i));
    } catch (e) {
        return '';
    }
    
    items.forEach((item, index) => {
        const isLast = index === items.length - 1;
        const itemPath = path.join(dir, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory()) {
            tree += `${prefix}${isLast ? '└── ' : '├── '}${item}/\n`;
            tree += generateTree(itemPath, prefix + (isLast ? '    ' : '│   '));
        } else {
            const ext = path.extname(item).toLowerCase();
            if (!EXCLUDE_EXTS.includes(ext)) {
                tree += `${prefix}${isLast ? '└── ' : '├── '}${item}\n`;
            }
        }
    });
    return tree;
}

// 2. 偵測技術棧
function detectTechStack() {
    let techs = [];
    try {
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['react']) techs.push('React');
        if (deps['vite']) techs.push('Vite');
        if (deps['tailwindcss']) techs.push('Tailwind CSS');
        if (deps['three']) techs.push('Three.js');
        if (deps['@react-three/fiber']) techs.push('React Three Fiber (R3F)');
        if (deps['firebase']) techs.push('Firebase');
        if (deps['typescript']) techs.push('TypeScript');
        if (deps['express']) techs.push('Express');
        if (deps['zustand']) techs.push('Zustand');
    } catch (e) {
        techs.push('Unknown (no package.json found)');
    }
    return techs.join(', ');
}

// 3. 核心檔案說明 (AI 預先解析)
const CORE_DESCRIPTIONS = `
### 核心架構與組件說明
- **src/App.tsx**：應用程式的進入點，負責 Context Provider 包裝與主路由切換。
- **src/components/Three/Scene.tsx**：3D 場景的核心，包含光照、地形、天空和所有 3D 物件的掛載，是 Three.js 世界的總管。
- **src/components/Three/Avatar.tsx**：玩家角色的 3D 模型與動畫邏輯。包含複雜的狀態機（走路、跑步、多種游泳姿態、躺吊床、表情動作等）。
- **src/components/Three/CameraController.tsx**：控制攝影機，支援第一人稱/第三人稱的平滑切換，以及支援建造模式的自由視角。
- **src/lib/AppContext.tsx**：全域狀態管理中心，存放玩家基本資料、裝備、背包內容、視角狀態與 UI 控制。
- **server.ts**：後端 Express 伺服器，負責與 Gemini AI 串接，提供智能商店助手的對話功能。
- **src/lib/playerBus.ts**：輕量級狀態匯流排，用來在 React UI 組件與 3D 渲染迴圈 (useFrame) 之間高頻率傳遞玩家座標，避免觸發 React 重新渲染。
- **src/lib/soundUtils.ts**：負責環境音效處理，例如動態合成游泳的水聲與氣泡聲，完全利用 Web Audio API 生成。
`;

console.log('⏳ 正在生成 README_AI.md ...');
const readmeContent = `# Motu 專案說明文件

## 核心技術棧
${detectTechStack()}

## 專案目錄樹 (已過濾掉影音大檔與編譯結果)
\`\`\`text
${generateTree(__dirname)}
\`\`\`
${CORE_DESCRIPTIONS}
`;

fs.writeFileSync('README_AI.md', readmeContent, 'utf8');
console.log('✅ README_AI.md 生成完畢！');

// 4. 建立暫存資料夾並複製檔案
const tempDir = path.join(__dirname, 'temp_ai_pack');
if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(tempDir);

function copyFiles(currentPath, targetPath) {
    const items = fs.readdirSync(currentPath);
    for (const item of items) {
        if (EXCLUDE_DIRS.includes(item) || EXCLUDE_FILES.includes(item)) continue;
        
        const sourceFile = path.join(currentPath, item);
        const targetFile = path.join(targetPath, item);
        const stat = fs.statSync(sourceFile);
        
        if (stat.isDirectory()) {
            fs.mkdirSync(targetFile, { recursive: true });
            copyFiles(sourceFile, targetFile);
        } else {
            const ext = path.extname(item).toLowerCase();
            if (EXCLUDE_EXTS.includes(ext)) continue;
            fs.copyFileSync(sourceFile, targetFile);
        }
    }
}

console.log('⏳ 正在複製純文字程式碼至暫存區 (排除大型影音檔)...');
copyFiles(__dirname, tempDir);
// 特別補上剛剛生成的 README_AI.md
fs.copyFileSync('README_AI.md', path.join(tempDir, 'README_AI.md'));

// 5. 執行 PowerShell 壓縮指令
console.log('⏳ 正在打包 project-source.zip (可能需要幾秒鐘)...');
try {
    execSync('powershell -Command "Compress-Archive -Path temp_ai_pack\\\\* -DestinationPath project-source.zip -Force"');
    console.log('✅ project-source.zip 打包成功！');
} catch (e) {
    console.error('❌ 打包失敗，請檢查 PowerShell 權限:', e.message);
}

// 6. 清理暫存檔
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('🎉 腳本執行完畢！你現在可以把 project-source.zip 直接餵給 Claude 了！');
