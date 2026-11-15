import fs from 'fs';
import path from 'path';

const uploadDir = 'C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded';
const files = fs.readdirSync(uploadDir).filter(f => f.startsWith('media_1793728'));

let html = `<!DOCTYPE html><html><body style="background:#111;color:#eee;font-family:sans-serif;display:flex;flex-wrap:wrap;gap:20px;">`;
for (const f of files) {
  const b64 = fs.readFileSync(path.join(uploadDir, f)).toString('base64');
  const mime = f.endsWith('.png') ? 'image/png' : 'image/jpeg';
  html += `
  <div style="border:1px solid #444;padding:10px;text-align:center;width:220px;">
    <img src="data:${mime};base64,${b64}" style="width:200px;height:200px;object-fit:contain;background:#222;"/>
    <div style="word-break:break-all;font-size:12px;margin-top:5px;">${f}</div>
  </div>`;
}
html += `</body></html>`;
fs.writeFileSync('public/asset_gallery.html', html);
console.log('Saved public/asset_gallery.html with', files.length, 'files');

