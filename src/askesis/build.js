
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

    // Versão dos arquivos de tradução, tirada do conteúdo deles.
    //
    // Por que não o hash do bundle: ele é calculado A PARTIR do bundle, e injetá-lo
    // dentro do bundle seria circular. Por que o conteúdo é MELHOR: o endereço só
    // muda quando o texto muda, então um deploy que não mexe em tradução mantém o
    // cache de todo mundo quente.
    //
    // Sem isto, `locales/pt.json` tem nome fixo e o service worker antigo responde
    // com a cópia velha enquanto o bundle novo — que tem hash no nome — já veio da
    // rede. O resultado é código novo lendo texto velho, e cada string nova sai na
    // tela como a própria chave.
    const localeFiles = ['pt', 'en', 'es'].map(l => path.resolve(__dirname, 'locales', `${l}.json`));
    const localeHash = crypto.createHash('sha256');
    for (const f of localeFiles) localeHash.update(await fs.promises.readFile(f));
    const localeVersion = isProd ? localeHash.digest('hex').slice(0, 8) : 'dev';

    // 1. Bundle App (index.tsx -> bundle.[hash].js + bundle.[hash].css em prod)
    let jsBundleName  = 'bundle.js';
    let cssBundleName = 'bundle.css';
    let chunkNames    = [];

    const sharedBuildOptions = {
        bundle: true,
        format: 'esm',
        target: ['es2020'],
        define: {
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
            __LOCALE_VERSION__: JSON.stringify(localeVersion),
            // NUNCA adicionar chaves de API aqui: o define substitui referências no
            // BUNDLE PÚBLICO. A chave do Gemini vive só no servidor (api/analyze).
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
            // CODE SPLITTING: dynamic imports (ex.: data/quotes.ts em render.ts) viram
            // chunks separados, tirando peso do JS crítico de boot.
            splitting: true,
            chunkNames: 'chunk-[hash]',
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
        chunkNames = outputs
            .map(f => path.basename(f))
            .filter(f => /^chunk-[A-Za-z0-9]+\.js$/.test(f));
        console.log(`Content-hashed bundles: ${jsBundleName}, ${cssBundleName}` +
            (chunkNames.length ? ` (+ chunks: ${chunkNames.join(', ')})` : ''));

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
    // Fora do bloco de produção: a dica de preload precisa apontar para o MESMO
    // endereço que o i18n vai pedir, em dev também. Divergir aqui faz o navegador
    // baixar o arquivo duas vezes.
    html = html.replace('__LOCALE_VERSION__', localeVersion);
    {
    }
    await fs.promises.writeFile(path.join(OUT_DIR, 'index.html'), html);

    await copyFile('manifest.json', path.join(OUT_DIR, 'manifest.json'));
    // Push OneSignal: worker registrado em utils.ts com scope '/onesignal/',
    // isolado do sw.js (offline, scope '/'). Também personaliza o lembrete.
    await copyFile('OneSignalSDKWorker.js', path.join(OUT_DIR, 'OneSignalSDKWorker.js'));

    // Processa sw.js: injeta nomes hasheados no CACHE_FILES e o hash de build no
    // CACHE_NAME. O cache versionado garante que o `activate` de cada deploy apague
    // os caches anteriores (sem isso, bundles hasheados antigos acumulam para sempre).
    let swSrc = await fs.promises.readFile(path.resolve(__dirname, 'sw.js'), 'utf-8');
    const buildHash = isProd
        ? (jsBundleName.match(/^bundle-([A-Za-z0-9]+)\.js$/) || [])[1] || String(Date.now())
        : 'dev';
    swSrc = swSrc.replace('__BUILD_HASH__', buildHash).replace(/__LOCALE_VERSION__/g, localeVersion);
    if (isProd) {
        swSrc = swSrc
            .replace("'/bundle.js'",  `'/${jsBundleName}'`)
            .replace("'/bundle.css'", `'/${cssBundleName}'`)
            .replace('/*__EXTRA_PRECACHE__*/', chunkNames.map(c => `'/${c}'`).join(', '));
    }
    await fs.promises.writeFile(path.join(OUT_DIR, 'sw.js'), swSrc);
    
    // Copy Dirs
    await copyDir(path.resolve(__dirname, 'locales'), path.join(OUT_DIR, 'locales'));
    await copyDir(path.resolve(__dirname, 'icons'), path.join(OUT_DIR, 'icons'));
    // boot/error-handler.js: referenciado pelo index.html (watchdog global). Sem esta
    // cópia, a rota catch-all da Vercel devolvia index.html no lugar do módulo e o
    // error handler nunca carregava em produção.
    await copyDir(path.resolve(__dirname, 'boot'), path.join(OUT_DIR, 'boot'));

    // Assets: o diretório assets/ é majoritariamente documentação do README (~22MB de
    // screenshots, GIFs e diagramas). O app em produção usa apenas o logo do export
    // de gráfico — copiar só ele mantém o deploy enxuto.
    await fs.promises.mkdir(path.join(OUT_DIR, 'assets'), { recursive: true });
    await copyFile('assets/header-2.min.svg', path.join(OUT_DIR, 'assets', 'header-2.min.svg'));

    console.log('Build complete.');
}

build().catch((err) => {
    console.error("Build failed:", err);
    process.exit(1);
});
