// ─────────────────────────────────────────────────────────────────────────
//  Farmboss Bills — Paperwork folder watcher
//
//  Watches a local folder (default ~/Desktop/Paperwork) for new bills
//  (PDF / image files), reads each one with Claude, uploads it to Firebase
//  Storage, and creates a bill in the same `bills` collection the Bills web
//  app uses. Processed files move to Paperwork/_processed; failures move to
//  Paperwork/_failed with a .error.txt note.
//
//  Setup and auto-start instructions: see README.md.
// ─────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import chokidar from 'chokidar';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, addDoc, doc, getDoc, runTransaction } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { CATEGORIES, MIME, buildPrompt, normalizeBill, parseJsonObject } from './lib.mjs';

// Same Firebase project as the Farmboss web apps (this config is public by design).
const firebaseConfig = {
    apiKey: 'AIzaSyB7c4urD9tJO80S7nADItxjwhSYVqlrkEU',
    authDomain: 'watchroom-714a0.firebaseapp.com',
    projectId: 'watchroom-714a0',
    storageBucket: 'watchroom-714a0.firebasestorage.app',
    messagingSenderId: '911514107783',
    appId: '1:911514107783:web:20e8a729fd66577c28dd22',
};

const log  = (...a) => console.log(new Date().toISOString(), ...a);
const warn = (...a) => console.warn(new Date().toISOString(), 'WARN', ...a);

function defaultWatchDir() {
    return process.env.WATCH_DIR && process.env.WATCH_DIR.trim()
        ? process.env.WATCH_DIR.trim().replace(/^~(?=$|\/)/, os.homedir())
        : path.join(os.homedir(), 'Desktop', 'Paperwork');
}

// Ask Claude to read the bill. Mirrors bills.html's callClaude/extractBill.
async function extractBill(ai, base64, mimeType, categories) {
    const block = mimeType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
        : { type: 'image',    source: { type: 'base64', media_type: mimeType,          data: base64 } };
    const payload = {
        model: ai.model, max_tokens: 700,
        messages: [{ role: 'user', content: [block, { type: 'text', text: buildPrompt(categories) }] }],
    };
    let res;
    if (ai.proxyUrl) {
        res = await fetch(ai.proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, apiKey: ai.apiKey }) });
    } else {
        res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify(payload),
        });
    }
    if (!res.ok) {
        let msg = `API error ${res.status}`;
        try { msg = (await res.json()).error?.message || msg; } catch {}
        if (/credit balance is too low|insufficient.*credit|billing/i.test(msg)) {
            msg = 'Anthropic account is out of API credits — add credits at console.anthropic.com → Settings → Billing.';
        }
        throw new Error(msg);
    }
    const data = await res.json();
    return parseJsonObject(data.content[0].text);
}

async function ensureDir(dir) { if (!existsSync(dir)) await fs.mkdir(dir, { recursive: true }); }

async function moveFile(fp, destDir, note) {
    await ensureDir(destDir);
    const base = path.basename(fp);
    let dest = path.join(destDir, base);
    if (existsSync(dest)) dest = path.join(destDir, `${Date.now()}_${base}`);
    await fs.rename(fp, dest);
    if (note) await fs.writeFile(`${dest}.error.txt`, note + '\n');
    return dest;
}

async function main() {
    const email    = (process.env.BILLS_EMAIL || '').trim();
    const password =  process.env.BILLS_PASSWORD || '';
    const watchDir = defaultWatchDir();
    const processedDir = path.join(watchDir, '_processed');
    const failedDir    = path.join(watchDir, '_failed');

    if (!email || !password) {
        console.error('Missing BILLS_EMAIL / BILLS_PASSWORD. Copy .env.example to .env and fill them in.');
        process.exit(1);
    }
    await ensureDir(watchDir);

    // ── Firebase sign-in ──
    const app  = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db   = getFirestore(app);
    const storage = getStorage(app);
    try {
        await signInWithEmailAndPassword(auth, email, password);
        log(`Signed in as ${email}`);
    } catch (err) {
        console.error('Sign-in failed:', err.message, '\nCheck BILLS_EMAIL / BILLS_PASSWORD (same as the Bills web login).');
        process.exit(1);
    }

    // ── Load config + AI settings (shared with the web app) ──
    let categories = CATEGORIES;
    try {
        const cfg = await getDocSafe(db, 'bills_config', 'data');
        if (cfg?.categories?.length) categories = cfg.categories;
    } catch (err) { warn('Could not read bills_config:', err.message); }

    const ai = {
        apiKey:   (process.env.ANTHROPIC_API_KEY || '').trim() || (await getDocSafe(db, 'settings', 'apikey'))?.key || '',
        model:    (process.env.ANTHROPIC_MODEL   || '').trim() || (await getDocSafe(db, 'settings', 'model'))?.model || 'claude-sonnet-4-6',
        proxyUrl: (process.env.ANTHROPIC_PROXY_URL || '').trim() || (await getDocSafe(db, 'settings', 'proxy'))?.url || '',
    };
    if (!ai.apiKey) {
        console.error('No Anthropic API key found. Set it in the Bills app (Settings → API key) or put ANTHROPIC_API_KEY in .env.');
        process.exit(1);
    }
    log(`AI model: ${ai.model}${ai.proxyUrl ? ' (via proxy)' : ''}`);

    // ── Allocate a bill id atomically (shared counter with the web app) ──
    async function nextBillId() {
        const cfgRef = doc(db, 'bills_config', 'data');
        return runTransaction(db, async (tx) => {
            const snap = await tx.get(cfgRef);
            const cur = snap.exists() ? (snap.data().nextId || 1) : 1;
            tx.set(cfgRef, { nextId: cur + 1 }, { merge: true });
            return cur;
        });
    }

    async function processFile(fp) {
        const ext = path.extname(fp).toLowerCase();
        const name = path.basename(fp);
        const mimeType = MIME[ext];
        if (!mimeType) {
            warn(`Skipping unsupported file: ${name}`);
            await moveFile(fp, failedDir, `Unsupported file type "${ext}". Supported: ${Object.keys(MIME).join(', ')}`);
            return;
        }
        log(`Reading ${name} ...`);
        try {
            const buf = await fs.readFile(fp);
            const base64 = buf.toString('base64');
            const bill = normalizeBill(await extractBill(ai, base64, mimeType, categories), categories);

            // Upload the original file to Storage.
            const storeName = `bills_docs/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
            const sref = storageRef(storage, storeName);
            await uploadBytes(sref, new Uint8Array(buf), { contentType: mimeType });
            const fileUrl = await getDownloadURL(sref);

            const id = await nextBillId();
            await addDoc(collection(db, 'bills'), {
                id, addedAt: new Date().toISOString(),
                paid: false, filed: false, deleted: false,
                ...bill,
                fileUrl, fileType: mimeType === 'application/pdf' ? 'pdf' : 'image',
                source: 'paperwork-watcher',
            });

            await moveFile(fp, processedDir);
            log(`✓ Added #${id}: ${bill.vendor || '(no vendor)'}${bill.amount ? ' · $' + bill.amount.toFixed(2) : ''} → moved to _processed/`);
        } catch (err) {
            warn(`✗ ${name}: ${err.message}`);
            try { await moveFile(fp, failedDir, err.message); } catch (e) { warn(`could not move ${name} to _failed:`, e.message); }
        }
    }

    // ── Serialize processing so we don't race the id counter or hammer the API ──
    let chain = Promise.resolve();
    const enqueue = (fp) => { chain = chain.then(() => processFile(fp)).catch((e) => warn('unexpected:', e.message)); };

    const watcher = chokidar.watch(watchDir, {
        depth: 0,                    // only the top level of Paperwork; _processed/_failed are subfolders and ignored
        ignoreInitial: false,        // also pick up files already sitting in the folder at startup
        ignored: /(^|[\/\\])\../,    // dotfiles (e.g. .DS_Store)
        awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
    });
    watcher.on('add', enqueue);
    watcher.on('error', (err) => warn('watcher error:', err.message));
    watcher.on('ready', () => log(`Watching ${watchDir} — drop bills in and they'll be added automatically. (Ctrl+C to stop.)`));
}

async function getDocSafe(db, col, id) {
    const snap = await getDoc(doc(db, col, id));
    return snap.exists() ? snap.data() : null;
}

// Only run when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
}
