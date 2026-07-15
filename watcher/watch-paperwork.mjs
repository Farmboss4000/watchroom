// ─────────────────────────────────────────────────────────────────────────
//  Farmboss Bills — Paperwork folder uploader
//
//  Looks at a local folder (default ~/Desktop/Paperwork), figures out which
//  files have NOT been uploaded yet, and uploads only those. Each new bill is
//  read by Claude, its file stored in Firebase Storage, and a record created
//  in the same `bills` collection the Bills web app uses (Unpaid & Unfiled).
//
//  Files are NOT moved. A hidden ledger (.bills-watcher-ledger.json in the
//  watched folder) records which files have already been uploaded — keyed by
//  file *content*, so renaming a file won't cause a duplicate upload.
//
//  Modes:
//    node watch-paperwork.mjs            one-shot: upload new files, then exit
//                                        (this is what the nightly schedule runs)
//    node watch-paperwork.mjs --watch    stay running and upload files as they
//                                        are added
//
//  Setup, nightly scheduling, and auto-start: see README.md.
// ─────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import chokidar from 'chokidar';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, addDoc, doc, getDoc, getDocs, runTransaction } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { CATEGORIES, buildPrompt, normalizeBill, parseJsonObject, classifyFile, shouldArchive } from './lib.mjs';

// Same Firebase project as the Farmboss web apps (this config is public by design).
const firebaseConfig = {
    apiKey: 'AIzaSyB7c4urD9tJO80S7nADItxjwhSYVqlrkEU',
    authDomain: 'watchroom-714a0.firebaseapp.com',
    projectId: 'watchroom-714a0',
    storageBucket: 'watchroom-714a0.firebasestorage.app',
    messagingSenderId: '911514107783',
    appId: '1:911514107783:web:20e8a729fd66577c28dd22',
};

const WATCH_MODE = process.argv.includes('--watch');
const LEDGER_NAME = '.bills-watcher-ledger.json';

const log  = (...a) => console.log(new Date().toISOString(), ...a);
const warn = (...a) => console.warn(new Date().toISOString(), 'WARN', ...a);
const nowIso = () => new Date().toISOString();
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function defaultWatchDir() {
    return process.env.WATCH_DIR && process.env.WATCH_DIR.trim()
        ? process.env.WATCH_DIR.trim().replace(/^~(?=$|\/)/, os.homedir())
        : path.join(os.homedir(), 'Desktop', 'Paperwork');
}

async function loadLedger(p) {
    try {
        const l = JSON.parse(await fs.readFile(p, 'utf8'));
        if (!l.entries) l.entries = {};
        return l;
    } catch { return { entries: {} }; }
}
async function saveLedger(p, l) { await fs.writeFile(p, JSON.stringify(l, null, 2)); }

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

async function main() {
    const email    = (process.env.BILLS_EMAIL || '').trim();
    const password =  process.env.BILLS_PASSWORD || '';
    const watchDir = defaultWatchDir();
    const ledgerPath = path.join(watchDir, LEDGER_NAME);

    if (!email || !password) {
        console.error('Missing BILLS_EMAIL / BILLS_PASSWORD. Copy .env.example to .env and fill them in.');
        process.exit(1);
    }
    if (!existsSync(watchDir)) await fs.mkdir(watchDir, { recursive: true });

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

    const ledger = await loadLedger(ledgerPath);

    // Allocate a bill id atomically (shared counter with the web app).
    async function nextBillId() {
        const cfgRef = doc(db, 'bills_config', 'data');
        return runTransaction(db, async (tx) => {
            const snap = await tx.get(cfgRef);
            const cur = snap.exists() ? (snap.data().nextId || 1) : 1;
            tx.set(cfgRef, { nextId: cur + 1 }, { merge: true });
            return cur;
        });
    }

    // Upload one already-read file and create its bill. Returns the bill id.
    async function uploadBill(buf, ext, mimeType) {
        const base64 = buf.toString('base64');
        const bill = normalizeBill(await extractBill(ai, base64, mimeType, categories), categories);

        const storeName = `bills_docs/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
        const sref = storageRef(storage, storeName);
        await uploadBytes(sref, new Uint8Array(buf), { contentType: mimeType });
        const fileUrl = await getDownloadURL(sref);

        const id = await nextBillId();
        await addDoc(collection(db, 'bills'), {
            id, addedAt: nowIso(),
            paid: false, filed: false, deleted: false,
            ...bill,
            fileUrl, fileType: mimeType === 'application/pdf' ? 'pdf' : 'image',
            source: 'paperwork-watcher',
        });
        return { id, bill };
    }

    // Look at one file and, if it hasn't been uploaded yet, upload it.
    // Records the result in the ledger (keyed by content hash) so it is never
    // uploaded twice. Returns 'new' | 'skip' | 'unsupported' | 'fail'.
    async function handleFile(fp, hashIndex) {
        const name = path.basename(fp);
        if (name.startsWith('.') || name === LEDGER_NAME) return 'skip';
        const ext = path.extname(name).toLowerCase();
        let buf;
        try { buf = await fs.readFile(fp); } catch (e) { warn(`cannot read ${name}: ${e.message}`); return 'fail'; }
        const hash = sha256(buf);
        if (hashIndex) hashIndex.set(hash, fp);   // remember where this content lives now
        const c = classifyFile(ext, hash, ledger.entries);

        if (c.action === 'skip') return 'skip';
        if (c.action === 'unsupported') {
            warn(`Skipping unsupported file: ${name}`);
            ledger.entries[hash] = { file: name, status: 'unsupported', at: nowIso() };
            await saveLedger(ledgerPath, ledger);
            return 'unsupported';
        }
        log(`Reading ${name} ...`);
        try {
            const { id, bill } = await uploadBill(buf, ext, c.mimeType);
            ledger.entries[hash] = { file: name, status: 'uploaded', billId: id, at: nowIso() };
            await saveLedger(ledgerPath, ledger);
            log(`✓ Added #${id}: ${bill.vendor || '(no vendor)'}${bill.amount ? ' · $' + bill.amount.toFixed(2) : ''}`);
            return 'new';
        } catch (err) {
            // Not recorded in the ledger, so it will be retried on the next run.
            warn(`✗ ${name}: ${err.message}`);
            return 'fail';
        }
    }

    if (WATCH_MODE) {
        // Continuous: process the current backlog, then keep watching.
        const watcher = chokidar.watch(watchDir, {
            depth: 0,
            ignoreInitial: false,
            ignored: /(^|[\/\\])\../,   // dotfiles (incl. the ledger)
            awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
        });
        let chain = Promise.resolve();
        const enqueue = (fp) => { chain = chain.then(() => handleFile(fp)).catch((e) => warn('unexpected:', e.message)); };
        watcher.on('add', enqueue);
        watcher.on('error', (err) => warn('watcher error:', err.message));
        watcher.on('ready', () => log(`Watching ${watchDir} — new files upload automatically. (Ctrl+C to stop.)`));
    } else {
        // One-shot batch: scan the folder, upload everything new, then exit.
        log(`Scanning ${watchDir} for new files ...`);
        const dirents = await fs.readdir(watchDir, { withFileTypes: true });
        const files = dirents.filter((d) => d.isFile() && !d.name.startsWith('.')).map((d) => d.name).sort();
        const tally = { new: 0, skip: 0, unsupported: 0, fail: 0 };
        const hashIndex = new Map();   // content hash -> current path in the folder
        for (const f of files) tally[await handleFile(path.join(watchDir, f), hashIndex)]++;
        log(`Done — ${tally.new} uploaded, ${tally.skip} already uploaded, ${tally.unsupported} unsupported, ${tally.fail} failed.`);

        // Fetch bills once — used for both the PROCESSED sweep and the reminder.
        let billDocs = null;
        try { billDocs = (await getDocs(collection(db, 'bills'))).docs.map(d => d.data()); }
        catch (err) { warn('Could not read bills:', err.message); }

        // Archive: bills marked BOTH Paid and Filed get their source file
        // moved from the Paperwork folder into Paperwork/PROCESSED/.
        if (billDocs) {
            const byId = new Map(billDocs.map(b => [b.id, b]));
            const processedDir = path.join(watchDir, 'PROCESSED');
            let moved = 0;
            for (const [hash, entry] of Object.entries(ledger.entries)) {
                if (!shouldArchive(entry, byId.get(entry.billId))) continue;
                const fp = hashIndex.get(hash);
                if (!fp) continue;   // file not in the folder (renamed away or already moved by hand)
                try {
                    if (!existsSync(processedDir)) await fs.mkdir(processedDir, { recursive: true });
                    let dest = path.join(processedDir, path.basename(fp));
                    if (existsSync(dest)) dest = path.join(processedDir, `${Date.now()}_${path.basename(fp)}`);
                    await fs.rename(fp, dest);
                    entry.processedAt = nowIso();
                    entry.movedTo = path.relative(watchDir, dest);
                    moved++;
                    log(`📦 ${path.basename(fp)} → PROCESSED/ (bill #${entry.billId} paid & filed)`);
                } catch (err) { warn(`could not move ${path.basename(fp)}: ${err.message}`); }
            }
            if (moved) await saveLedger(ledgerPath, ledger);
            log(moved ? `Archived ${moved} paid & filed bill${moved > 1 ? 's' : ''} to PROCESSED/.` : 'No newly paid & filed bills to archive.');
        }

        // Nightly reminder: unpaid bills that are overdue or due within 3 days.
        try {
            if (!billDocs) throw new Error('bills unavailable');
            const today = new Date().toISOString().slice(0, 10);
            const soonCut = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
            const unpaid = billDocs.filter(b => !b.deleted && !b.paid && b.dueDate);
            const overdue = unpaid.filter(b => b.dueDate < today);
            const dueSoon = unpaid.filter(b => b.dueDate >= today && b.dueDate <= soonCut);
            const fmt = (b) => `${b.vendor || '(no vendor)'} $${(Number(b.amount) || 0).toFixed(2)} due ${b.dueDate}`;
            if (overdue.length || dueSoon.length) {
                log(`REMINDER: ${overdue.length} overdue, ${dueSoon.length} due within 3 days:`);
                for (const b of [...overdue, ...dueSoon]) log(`  ⏰ ${fmt(b)}${b.dueDate < today ? ' (OVERDUE)' : ''}`);
            } else {
                log('No bills overdue or due within 3 days.');
            }
        } catch (err) { warn('Could not check due bills:', err.message); }

        process.exit(tally.fail > 0 ? 1 : 0);
    }
}

async function getDocSafe(db, col, id) {
    const snap = await getDoc(doc(db, col, id));
    return snap.exists() ? snap.data() : null;
}

// Only run when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
}
