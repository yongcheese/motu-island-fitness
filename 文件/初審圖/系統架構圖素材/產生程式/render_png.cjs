const sharp = require('sharp'); const fs = require('fs'); const path = require('path');
(async () => {
  const files = fs.readdirSync('elements4').filter(f => f.endsWith('.svg'));
  for (const f of files) {
    const buf = fs.readFileSync(path.join('elements4', f));
    await sharp(buf, { density: 72 * 3 }).png().toFile(path.join('png', f.replace('.svg', '.png')));
  }
  console.log('rendered', files.length);
})();
