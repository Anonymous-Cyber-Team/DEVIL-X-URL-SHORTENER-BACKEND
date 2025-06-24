// --- server.js ফাইলের চূড়ান্ত এবং পরিষ্কার কোড ---

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { nanoid } = require('nanoid');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// শক্তিশালী এবং নির্দিষ্ট CORS কনফিগারেশন
const corsOptions = {
  // '*' মানে যেকোনো ওয়েবসাইটকে অনুমতি দেওয়া, ডিবাগিংয়ের জন্য।
  // কাজ হয়ে গেলে, নিরাপত্তার জন্য এটিকে 'https://anonymous-cyber-team.github.io'-তে পরিবর্তন করে দিও।
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'], // OPTIONS মেথড যোগ করা হয়েছে
  allowedHeaders: ['Content-Type', 'Authorization']
};

// CORS মিডলওয়্যারটি একবারেই সঠিকভাবে ব্যবহার করা
app.use(cors(corsOptions));
app.use(express.json());

// --- ডাটাবেস সেটআপ ---
const db = new sqlite3.Database('./urls.db', (err) => {
    if (err) console.error(err.message);
    else console.log('ডাটাবেসের সাথে সফলভাবে সংযোগ হয়েছে।');
});

// টেবিল তৈরি এবং আপডেট করার ফাংশন
const initializeDatabase = () => {
    db.run('CREATE TABLE IF NOT EXISTS urls (id INTEGER PRIMARY KEY, short_code TEXT UNIQUE, long_url TEXT, expires_at TEXT)', (err) => {
        if (err) return console.error("টেবিল তৈরি করতে সমস্যা:", err);

        db.all("PRAGMA table_info(urls)", (err, columns) => {
            if (err) return console.error("টেবিলের তথ্য পেতে সমস্যা:", err);

            const hasExpiresAt = columns.some(col => col.name === 'expires_at');
            if (!hasExpiresAt) {
                db.run("ALTER TABLE urls ADD COLUMN expires_at TEXT", (alterErr) => {
                    if (alterErr) console.error("কলাম যোগ করতে সমস্যা:", alterErr);
                    else console.log("expires_at কলাম সফলভাবে যোগ হয়েছে।");
                });
            }
        });
    });
};
initializeDatabase();

// --- API রুটগুলো ---
app.post('/api/create', (req, res) => {
    const { longUrl, customName, expiration } = req.body;
    if (!longUrl) return res.status(400).json({ message: 'লম্বা URL প্রয়োজন।' });

    const shortCode = customName || nanoid(6);

    let expires_at = null;
    if (expiration && expiration.value) {
        const now = new Date();
        if (expiration.unit === 'hours' && !isNaN(parseInt(expiration.value, 10))) {
            now.setHours(now.getHours() + parseInt(expiration.value, 10));
            expires_at = now.toISOString();
        } else if (expiration.unit === 'date') {
            expires_at = new Date(expiration.value + "T23:59:59Z").toISOString();
        }
    }

    db.get('SELECT * FROM urls WHERE short_code = ?', [shortCode], (err, row) => {
        if (row) return res.status(400).json({ message: 'এই কাস্টম নামটি ইতিমধ্যে ব্যবহৃত হয়েছে।' });

        db.run('INSERT INTO urls (short_code, long_url, expires_at) VALUES (?, ?, ?)', [shortCode, longUrl, expires_at], function (err) {
            if (err) return res.status(500).json({ message: 'সার্ভারে সমস্যা হয়েছে।' });

            const shortUrl = `https://devil-x.onrender.com/${shortCode}`; // আপনার ছোট করা Render URL
            return res.status(201).json({ shortUrl });
        });
    });
});

app.get('/:shortCode', (req, res) => {
    const { shortCode } = req.params;
    db.get('SELECT long_url, expires_at FROM urls WHERE short_code = ?', [shortCode], (err, row) => {
        if (row) {
            if (row.expires_at && new Date(row.expires_at) < new Date()) {
                db.run('DELETE FROM urls WHERE short_code = ?', [shortCode]);
                return res.status(404).send('দুঃখিত, এই লিঙ্কটির মেয়াদ শেষ হয়ে গেছে।');
            }
            return res.redirect(row.long_url);
        }
        return res.status(404).send('দুঃখিত, এই লিঙ্কটি খুঁজে পাওয়া যায়নি।');
    });
});

// --- স্বয়ংক্রিয় ক্লিনার রুট ---
const CLEANUP_SECRET = process.env.CLEANUP_SECRET || '@Devil-X@';
app.post('/api/cleanup', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${CLEANUP_SECRET}`) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    const now = new Date().toISOString();
    db.run('DELETE FROM urls WHERE expires_at IS NOT NULL AND expires_at < ?', [now], function(err) {
        if (err) return res.status(500).json({ message: 'সার্ভারে সমস্যা হয়েছে।' });
        res.status(200).json({ message: 'ক্লিনআপ সফল', deleted_count: this.changes });
    });
});

// ---> server.js ফাইলে এই নতুন "মাস্টার ক্লিনার" রুটটি যোগ করো <---

// --- মাস্টার ক্লিনার রুট (সাবধানতার সাথে ব্যবহার করবে) ---
// এই রুটটি কল করলে ডাটাবেসের সব লিঙ্ক মুছে যাবে (পার্মানেন্ট সহ)
app.post('/api/cleanup/all', (req, res) => {
    // আমরা একই গোপন কী ব্যবহার করব নিরাপত্তার জন্য
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${CLEANUP_SECRET}`) {
        return res.status(401).json({ message: 'Unauthorized: অ্যাক্সেস ডিনাইড' });
    }

    const sql = 'DELETE FROM urls'; // <-- এই কমান্ডটি টেবিলের সব ডেটা ডিলিট করে

    db.run(sql, function (err) {
        if (err) {
            console.error("মাস্টার ক্লিনআপ করার সময় সমস্যা হয়েছে:", err.message);
            return res.status(500).json({ message: 'সার্ভারে সমস্যা হয়েছে।' });
        }
        console.log(`ডাটাবেস রিসেট করা হয়েছে। ${this.changes} টি লিঙ্ক সফলভাবে মুছে ফেলা হয়েছে।`);
        res.status(200).json({ message: 'সম্পূর্ণ ক্লিনআপ সফল', total_deleted_count: this.changes });
    });
});

// --- এর পরেই আপনার app.listen(...) লাইনটি থাকবে ---

app.listen(port, () => console.log(`সার্ভার http://localhost:${port} এ চলছে`));