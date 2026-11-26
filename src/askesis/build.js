
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';
// Use absolute path for output directory to avoid CWD ambiguity
const OUT_DIR = path.resolve(__dirname, 'dist');

async function copyDir(src, dest) {
    if (!fs.existsSync(src)) return;
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (let entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else {
            await fs.promises.copyFile(srcPath, destPath);
        }
    }
}

async function build() {
    console.log(`Building for ${isProd ? 'production' : 'development'}...`);
    console.log(`Output Directory: ${OUT_DIR}`);

    // Ensure output dir exists
    if (fs.existsSync(OUT_DIR)) {
        await fs.promises.rm(OUT_DIR, { recursive: true, force: true });
    }
    await fs.promises.mkdir(OUT_DIR, { recursive: true });

    // 1. Bundle App (index.tsx -> bundle.[hash].js + bundle.[hash].css em prod)
    let jsBundleName  = 'bundle.js';
    let cssBundleName = 'bundle.css';

    const sharedBuildOptions = {
        bundle: true,
        format: 'esm',
        target: ['es2020'],
        define: {
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
            'process.env.API_KEY': JSON.stringify(process.env.API_KEY || process.env.GEMINI_API_KEY || ''),
        },
        loader: {
            '.svg': 'text',
            '.png': 'file',
            '.jpg': 'file',
            '.gif': 'file',
        },
        logLevel: 'info',
    };

    if (isProd) {
        // CONTENT HASHING: filenames imutáveis permitem CacheFirst no Service Worker.
        // Qualquer mudança de código gera um hash novo → URL nova → browser/SW tratam como arquivo novo.
        const buildResult = await esbuild.build({
            ...sharedBuildOptions,
            entryPoints: { bundle: 'index.tsx' }, // chave 'bundle' → saída 'bundle-[hash].js'
            outdir: OUT_DIR,
            entryNames: '[name]-[hash]',
            minify: true,
            sourcemap: false,
            metafile: true,
        });

        const outputs = Object.keys(buildResult.metafile.outputs);
        const jsOut   = outputs.find(f => path.basename(f).match(/^bundle-[A-Za-z0-9]+\.js$/));
        const cssOut  = outputs.find(f => path.basename(f).match(/^bundle-[A-Za-z0-9]+\.css$/));

        if (!jsOut || !cssOut) {
            console.error('Error: Could not find hashed bundle outputs. Available:', outputs);
            process.exit(1);
        }

        jsBundleName  = path.basename(jsOut);
        cssBundleName = path.basename(cssOut);
        console.log(`Content-hashed bundles: ${jsBundleName}, ${cssBundleName}`);

    } else {
        // Desenvolvimento: nomes fixos + watch mode (sem overhead de hash em dev)
        const ctx = await esbuild.context({
            ...sharedBuildOptions,
            entryPoints: ['index.tsx'],
            outfile: path.join(OUT_DIR, 'bundle.js'),
            minify: false,
            sourcemap: true,
        });
        await ctx.watch();
    }

    // 2. Bundle Worker (services/sync.worker.ts -> sync-worker.js)
    await esbuild.build({
        entryPoints: ['services/sync.worker.ts'],
        bundle: true,
        outfile: path.join(OUT_DIR, 'sync-worker.js'),
        minify: isProd,
        format: 'esm',
        target: ['es2020'],
    });

    // 3. Copy Static Assets
    const copyFile = async (src, dest) => {
        const sourcePath = path.resolve(__dirname, src);
        if (fs.existsSync(sourcePath)) {
            await fs.promises.copyFile(sourcePath, dest);
        } else {
            console.warn(`Warning: Asset ${src} not found.`);
        }
    };

    // Processa index.html: valida contrato do source, depois injeta nomes hasheados em prod.
    const indexHtmlPath = path.resolve(__dirname, 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
        console.error("Error: index.html not found.");
        process.exit(1);
    }
    let html = await fs.promises.readFile(indexHtmlPath, 'utf-8');
    if (!html.includes('bundle.js')) {
        console.error('Error: index.html must reference bundle.js (source contract).');
        process.exit(1);
    }
    if (isProd) {
        // Substitui os placeholders do source pelos nomes com content hash.
        // Captura href="bundle.css", src="bundle.js", link rel="modulepreload" etc.
        html = html
            .replace(/"bundle\.css"/g, `"${cssBundleName}"`)
            .replace(/"bundle\.js"/g,  `"${jsBundleName}"`);
    }
    await fs.promises.writeFile(path.join(OUT_DIR, 'index.html'), html);

    await copyFile('manifest.json', path.join(OUT_DIR, 'manifest.json'));

    // Processa sw.js: injeta nomes hasheados no CACHE_FILES do fallback em prod.
    let swSrc = await fs.promises.readFile(path.resolve(__dirname, 'sw.js'), 'utf-8');
    if (isProd) {
        swSrc = swSrc
            .replace("'/bundle.js'",  `'/${jsBundleName}'`)
            .replace("'/bundle.css'", `'/${cssBundleName}'`);
    }
    await fs.promises.writeFile(path.join(OUT_DIR, 'sw.js'), swSrc);
    
    // Copy Dirs
    await copyDir(path.resolve(__dirname, 'locales'), path.join(OUT_DIR, 'locales'));
    await copyDir(path.resolve(__dirname, 'icons'), path.join(OUT_DIR, 'icons'));
    await copyDir(path.resolve(__dirname, 'assets'), path.join(OUT_DIR, 'assets')); 

    console.log('Build complete.');
}

build().catch((err) => {
    console.error("Build failed:", err);
    process.exit(1);
});
