// --- Imports ---
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const multer = require('multer');
const csv = require('csv-parser');
const stringSimilarity = require('string-similarity'); // <-- added for fuzzy search

// --- Initialization ---
const app = express();
const PORT = process.env.PORT || 3000; // Render uses dynamic port
const AUTH_COOKIE_NAME = 'bikroy_auth_token';

// --- Database Connection ---
function getDbConnection() {
  const db = new sqlite3.Database('./inventory.db', (err) => {
    if (err) console.error('DB Connection Error:', err.message);
  });
  return db;
}

// --- Multer Config ---
const upload = multer({ dest: 'uploads/' });

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname))); // serve HTML/CSS/JS

// --- Hardcoded User ---
const ADMIN_USER = {
  username: 'bikroy',
  password: 'bikroy2026'
};

// --- Auth Middleware ---
function checkAuth(req, res, next) {
  const token = req.cookies[AUTH_COOKIE_NAME];
  if (token === 'VALID_TOKEN_SECRET') {
    next();
  } else {
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ message: 'Unauthorized' });
    } else {
      res.redirect('/login.html');
    }
  }
}

// ===================================
// === AUTHENTICATION ROUTES ===
// ===================================

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER.username && password === ADMIN_USER.password) {
    res.cookie(AUTH_COOKIE_NAME, 'VALID_TOKEN_SECRET', {
      httpOnly: true,
      secure: false,
      maxAge: 24 * 60 * 60 * 1000
    });
    res.status(200).json({ message: 'Login successful' });
  } else {
    res.status(401).json({ message: 'Invalid username or password' });
  }
});

app.get('/api/check-auth', checkAuth, (req, res) => {
  res.status(200).json({ message: 'Authenticated' });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME);
  res.status(200).json({ message: 'Logged out' });
});

// ===================================
// === PUBLIC SEARCH (Ranked + Fuzzy) ===
// ===================================

app.get('/api/inventory', (req, res) => {
  try {
    const raw = (req.query.search || '').toLowerCase().trim();
    if (!raw) return res.json([]);

    // Normalize input: remove special chars
    const normalized = raw.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
    const searchWords = normalized.split(/\s+/).filter(Boolean);
    if (searchWords.length === 0) return res.json([]);

    const db = getDbConnection();
    const sql = `SELECT DISTINCT category FROM inventory ORDER BY category`;

    db.all(sql, [], (err, rows) => {
      if (err) {
        console.error('API Error:', err.message);
        db.close();
        return res.status(500).json({ error: err.message });
      }

      const scored = rows.map(r => {
        const parts = r.category.split('>').map(p => p.trim().toLowerCase());
        const searchIn = parts.length > 2 ? parts.slice(2) : parts.slice(1);
        const targetText = searchIn.join(' ');

        let score = 0;
        let exactMatches = 0;
        let partialMatches = 0;

        searchWords.forEach(word => {
          if (new RegExp(`\\b${word}\\b`, 'u').test(targetText)) {
            exactMatches++;
            score += 10; // exact match = 10 points
          } else if (word.length >= 3 && targetText.includes(word)) {
            partialMatches++;
            score += 1; // partial match = 1 point
          }
        });

        // Add fuzzy score (0-5) using string-similarity
        const similarity = stringSimilarity.compareTwoStrings(raw, targetText);
        score += similarity * 5; // weight fuzzy less than exact matches

        return {
          category: r.category,
          score,
          exactMatches,
          partialMatches,
          similarity
        };
      })
      .filter(c => c.score > 0)
      .sort((a, b) => {
        // first exact matches, then total score, then fuzzy similarity
        if (a.exactMatches !== b.exactMatches) return b.exactMatches - a.exactMatches;
        if (a.score !== b.score) return b.score - a.score;
        return b.similarity - a.similarity;
      })
      .map(c => c.category);

      res.json(scored);
      db.close();
    });
  } catch (e) {
    console.error('Search handler error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===================================
// === ADMIN ROUTES ===
// ===================================

app.get('/api/inventory/admin', checkAuth, (req, res) => {
  const db = getDbConnection();
  db.all("SELECT * FROM inventory ORDER BY category", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
    db.close();
  });
});

app.get('/api/inventory/:id', checkAuth, (req, res) => {
  const db = getDbConnection();
  db.get("SELECT * FROM inventory WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row);
    db.close();
  });
});

app.post('/api/inventory', checkAuth, (req, res) => {
  const { name, category } = req.body;
  const db = getDbConnection();
  db.run("INSERT INTO inventory (name, category) VALUES (?, ?)", [name, category], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, name, category });
    db.close();
  });
});

app.put('/api/inventory/:id', checkAuth, (req, res) => {
  const { name, category } = req.body;
  const db = getDbConnection();
  db.run("UPDATE inventory SET name = ?, category = ? WHERE id = ?", [name, category, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Update successful' });
    db.close();
  });
});

app.delete('/api/inventory/:id', checkAuth, (req, res) => {
  const db = getDbConnection();
  db.run("DELETE FROM inventory WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Delete successful' });
    db.close();
  });
});

// Admin: CSV Upload
app.post('/api/inventory/upload', checkAuth, upload.single('csvFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

  const results = [];
  const db = getDbConnection();
  const filePath = req.file.path;

  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (data) => {
      if (data.name && data.category) results.push(data);
    })
    .on('end', () => {
      if (results.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ message: 'CSV is empty or invalid.' });
      }

      let addedCount = 0;
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare("INSERT INTO inventory (name, category) VALUES (?, ?)");
        results.forEach(item => {
          const fullCategory = `${item.category} > ${item.name}`;
          stmt.run(item.name, fullCategory, function(err) {
            if (!err) addedCount++;
          });
        });
        stmt.finalize();
        db.run("COMMIT", (err) => {
          fs.unlinkSync(filePath);
          if (err) return res.status(500).json({ message: 'Database transaction failed.' });
          res.status(201).json({ message: `Successfully added ${addedCount} new items.`, count: addedCount });
          db.close();
        });
      });
    })
    .on('error', () => {
      fs.unlinkSync(filePath);
      res.status(500).json({ message: 'Error reading CSV file.' });
      db.close();
    });
});

// ===================================
// === PROTECTED PAGES ===
// ===================================

app.get('/inventory_admin.html', checkAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'inventory_admin.html'));
});

// ===================================
// === SERVER START ===
// ===================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
  console.log(`Admin page:       http://0.0.0.0:${PORT}/inventory_admin.html`);
  console.log(`Public search:    http://0.0.0.0:${PORT}/inventory_search.html`);
});
