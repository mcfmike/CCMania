// Bundles the Vite build into one self-contained HTML fragment (inline CSS + JS)
// suitable for publishing as a claude.ai Artifact. Run `npm run build` first.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dist = 'dist';
const out = process.argv[2] ?? join(dist, 'artifact', 'cc-mania.html');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const js = html.match(/<script[^>]+src="\.\/([^"]+\.js)"/)?.[1];
const css = html.match(/<link[^>]+href="\.\/([^"]+\.css)"/)?.[1];
if (!js || !css) throw new Error('Could not find built assets in dist/index.html');
const code = readFileSync(join(dist, js), 'utf8').replaceAll('</script', '<\\/script');
const style = readFileSync(join(dist, css), 'utf8');
const page = `<title>CC Mania</title>
<meta name="description" content="A single-player real-time strategy homage to Command & Conquer">
<style>${style}</style>
<div id="app"></div>
<script type="module">${code}</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`Wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
