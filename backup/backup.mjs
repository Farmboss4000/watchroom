// ─────────────────────────────────────────────────────────────────────────
//  Farmboss — global backup & archive
//
//  Backs up EVERYTHING the sites have uploaded:
//
//  1. FILES: walks the entire Firebase Storage bucket (every folder —
//     bills_docs, armory_photos, machinery_maint_docs, automotive receipts,
//     etc.) and mirrors it to  <backup dir>/files/<same path>.
//     Incremental: unchanged files are skipped via a manifest; files later
//     deleted from the site are KEPT locally (archive semantics).
//
//  2. DATA: exports all known Firestore collections as JSON into a dated
//     snapshot folder  <backup dir>/data/YYYY-MM-DD/  so you also have
//     point-in-time copies of the database itself.
//
//  Default backup dir: ~/FarmbossBackups   (override with BACKUP_DIR in .env)
//  Credentials: same .env as the watcher (BILLS_EMAIL / BILLS_PASSWORD).
//
//  Usage:  node backup.mjs           incremental backup
//          node backup.mjs --full    re-download every file
//  Setup + weekly scheduling: see README.md.
// ─────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getStorage, ref as storageRef, listAll, getMetadata, getDownloadURL } from 'firebase/storage';

const firebaseConfig = {
    apiKey: 'AIzaSyB7c4urD9tJO80S7nADItxjwhSYVqlrkEU',
    authDomain: 'watchroom-714a0.firebaseapp.com',
    projectId: 'watchroom-714a0',
    storageBucket: 'watchroom-714a0.firebasestorage.app',
    messagingSenderId: '911514107783',
    appId: '1:911514107783:web:20e8a729fd66577c28dd22',
};

// Firestore collections to snapshot. Unknown/empty ones are skipped
// gracefully — add new names here as new sections appear.
const COLLECTIONS = [
    'bills', 'bills_config',
    'items', 'config', 'gun_trusts',
    'machinery_items', 'machinery_config', 'machinery_value_snapshots',
    'automotive_items',
    'livestock_items', 'livestock_config',
    'realestate_items',
    'knives_items', 'timepieces_items',
    'contacts', 'vendors',
    'estate_documents', 'insurance_policies', 'pharmacy_items',
    'agent_runs', 'agents',
    'recycle_bin', 'settings',
    'quotes', 'one_liners', 'qotd_history',
    'diary_summaries',
];

const FULL = process.argv.includes('--full');
const log  = (...a) => console.log(new Date().toISOString(), ...a);
const warn = (...a) => console.warn(new Date().toISOString(), 'WARN', ...a);

function backupDir() {
    const d = (process.env.BACKUP_DIR || '').trim();
    return d ? d.replace(/^~(?=$|\/)/, os.homedir()) : path.join(os.homedir(), 'FarmbossBackups');
}

async function ensureDir(p) { if (!existsSync(p)) await fs.mkdir(p, { recursive: true }); }

async function loadManifest(p) {
    try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return { files: {} }; }
}

// Recursively list every file in the bucket.
async function walkStorage(storage) {
    const out = [];
    const queue = [storageRef(storage, '/')];
    while (queue.length) {
        const dir = queue.pop();
        const res = await listAll(dir);
        queue.push(...res.prefixes);
        out.push(...res.items);
    }
    return out;
}

async function main() {
    const email    = (process.env.BILLS_EMAIL || '').trim();
    const password =  process.env.BILLS_PASSWORD || '';
    if (!email || !password) {
        console.error('Missing BILLS_EMAIL / BILLS_PASSWORD. Copy .env.example to .env (or reuse the watcher\'s .env values).');
        process.exit(1);
    }

    const dest = backupDir();
    const filesDir = path.join(dest, 'files');
    const manifestPath = path.join(dest, 'backup-manifest.json');
    await ensureDir(filesDir);

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const storage = getStorage(app);
    try {
        await signInWithEmailAndPassword(auth, email, password);
        log(`Signed in as ${email}`);
    } catch (err) {
        console.error('Sign-in failed:', err.message);
        process.exit(1);
    }

    // ── 1) Mirror every uploaded file ──
    log('Listing all files in storage ...');
    const items = await walkStorage(storage);
    log(`${items.length} files in the bucket. Backing up to ${filesDir}`);
    const manifest = FULL ? { files: {} } : await loadManifest(manifestPath);
    let copied = 0, skipped = 0, failed = 0, bytes = 0;

    for (const item of items) {
        const rel = item.fullPath;
        try {
            const meta = await getMetadata(item);
            const known = manifest.files[rel];
            const localPath = path.join(filesDir, rel);
            if (!FULL && known && known.updated === meta.updated && known.size === meta.size && existsSync(localPath)) {
                skipped++;
                continue;
            }
            const url = await getDownloadURL(item);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            await ensureDir(path.dirname(localPath));
            await fs.writeFile(localPath, buf);
            manifest.files[rel] = { size: meta.size, updated: meta.updated, backedUpAt: new Date().toISOString() };
            copied++; bytes += buf.length;
            if (copied % 25 === 0) {
                log(`  ... ${copied} copied so far`);
                await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
            }
        } catch (err) {
            failed++;
            warn(`✗ ${rel}: ${err.message}`);
        }
    }
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    log(`Files: ${copied} copied (${(bytes / 1048576).toFixed(1)} MB), ${skipped} unchanged, ${failed} failed.`);

    // ── 2) Snapshot the database ──
    const day = new Date().toISOString().slice(0, 10);
    const dataDir = path.join(dest, 'data', day);
    await ensureDir(dataDir);
    let collectionsSaved = 0, docsSaved = 0;
    for (const name of COLLECTIONS) {
        try {
            const snap = await getDocs(collection(db, name));
            if (snap.empty) continue;
            const rows = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
            await fs.writeFile(path.join(dataDir, `${name}.json`), JSON.stringify(rows, null, 2));
            collectionsSaved++; docsSaved += rows.length;
        } catch (err) {
            warn(`collection ${name}: ${err.message}`);
        }
    }
    log(`Data: ${collectionsSaved} collections (${docsSaved} records) snapshotted to data/${day}/`);
    log(`Backup complete → ${dest}`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
