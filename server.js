// --- server.js ফাইলের নতুন এবং সঠিক কোড ---

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { nanoid } = require('nanoid');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// ---> আগের app.use(cors()); লাইনটির জায়গায় এই নতুন কোডটি বসাও <---

// নির্দিষ্ট ডোমেইনকে অনুমতি দেওয়ার জন্য CORS কনফিগার করা
// ---> আগের app.use(cors({...})); লাইনটির জায়গায় এই নতুন এবং শক্তিশালী কোডটি বসাও <---

// শক্তিশালী এবং নির্দিষ্ট CORS কনফিগারেশন
const corsOptions = {
  origin: 'https://anonymous-cyber-team.github.io',
  methods: ['GET', 'POST'], // কোন কোন মেথড অনুমতিপ্রাপ্ত
  allowedHeaders: ['Content-Type', 'Authorization'] // কোন কোন হেডার অনুমতিপ্রাপ্ত
};

// প্রথমে OPTIONS রিকোয়েস্ট হ্যান্ডেল করা
app.options('*', cors(corsOptions)); // সব রুটের জন্য preflight রিকোয়েস্ট চালু করা

// এরপর সব রিকোয়েস্টের জন্য cors ব্যবহার করা
app.use(cors(corsOptions));

// --- এর পরেই আপনার app.use(express.json()); লাইনটি থাকবে ---
app.use(express.json());

const db = new sqlite3.Database('./urls.db', (err) => {
    if (err) console.error(err.message);
    else console.log('ডাটাবেসের সাথে সফলভাবে সংযোগ হয়েছে।');
});

// টেবিল তৈরি এবং আপডেট করার জন্য ফাংশন
const initializeDatabase = () => {
    // প্রথমে নিশ্চিত করা হচ্ছে যে টেবিলটি আছে
    db.run('CREATE TABLE IF NOT EXISTS urls (id INTEGER PRIMARY KEY, short_code TEXT UNIQUE, long_url TEXT, expires_at TEXT)', (err) => {
        if (err) {
            console.error("টেবিল তৈরি করতে সমস্যা:", err);
            return;
        }

        // ---> এই নতুন কোডটি টেবিল আপডেট করবে <---
        // চেক করা হচ্ছে 'expires_at' কলামটি আছে কিনা
        db.all("PRAGMA table_info(urls)", (err, columns) => {
            if (err) {
                console.error("টেবিলের তথ্য পেতে সমস্যা:", err);
                return;
            }
            const hasExpiresAt = columns.some(col => col.name === 'expires_at');
            // যদি না থাকে, তবেই শুধু যোগ করা হবে
            if (!hasExpiresAt) {
                db.run("ALTER TABLE urls ADD COLUMN expires_at TEXT", (alterErr) => {
                    if (alterErr) console.error("কলাম যোগ করতে সমস্যা:", alterErr);
                    else console.log("expires_at কলাম সফলভাবে যোগ হয়েছে।");
                });
            }
        });
    });
};

// সার্ভার চালু হওয়ার সাথে সাথে ডাটাবেস ইনিশিয়ালাইজ করা
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

            const shortUrl = `https://devil-x.onrender.com/${shortCode}`;
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

app.listen(port, () => console.log(`সার্ভার http://localhost:${port} এ চলছে`));