// --- Imports ---
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const multer = require('multer');
const csv = require('csv-parser');

// --- Initialization ---
const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_COOKIE_NAME = 'bikroy_auth_token';

// --- Database Connection & Auto-Migration ---
function getDbConnection() {
  return new sqlite3.Database('./inventory.db', (err) => {
    if (err) console.error('DB Connection Error:', err.message);
  });
}

// Initialize and upgrade database if needed
function initializeDatabase() {
  const db = getDbConnection();
  
  db.run(`CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    imageurl TEXT,
    comment TEXT
  )`, (err) => {
    if (err) {
      console.error("Error creating table:", err);
    } else {
      // Auto-add columns if they are missing (Migration)
      db.all("PRAGMA table_info(inventory)", (err, columns) => {
        if (err) return;
        const columnNames = columns.map(c => c.name);
        
        if (!columnNames.includes('imageurl')) {
          console.log("Migrating: Adding imageurl column");
          db.run("ALTER TABLE inventory ADD COLUMN imageurl TEXT");
        }
        if (!columnNames.includes('comment')) {
          console.log("Migrating: Adding comment column");
          db.run("ALTER TABLE inventory ADD COLUMN comment TEXT");
        }
      });
    }
  });
  db.close();
}

initializeDatabase();

// --- Multer Config ---
const upload = multer({ dest: 'uploads/' });

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

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
// === AUTH ROUTES ===
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
// === PUBLIC SEARCH (STRICT) ===
// ===================================

app.get('/api/inventory', (req, res) => {
  try {
    const raw = (req.query.search || '').toLowerCase().trim();
    if (!raw) return res.json([]);

    const searchTerms = raw.split(/\s+/).filter(Boolean);
    if (searchTerms.length === 0) return res.json([]);

    const db = getDbConnection();
    // Updated to fetch imageurl and comment
    const sql = `SELECT name, category, imageurl, comment FROM inventory`;

    db.all(sql, [], (err, rows) => {
      if (err) {
        console.error('API Error:', err.message);
        db.close();
        return res.status(500).json({ error: err.message });
      }

      // STRICT FILTERING
      const results = rows.filter(r => {
        const name = (r.name || '').toLowerCase();
        const category = (r.category || '').toLowerCase();
        const combined = `${name} ${category}`;
        // Check if ALL search words are present in the combined string
        return searchTerms.every(term => combined.includes(term));
      })
      .map(r => ({
        category: `${r.category} > ${r.name}` + (r.imageurl ? " 📷" : ""),
        imageurl: r.imageurl,
        comment: r.comment
      }));

      // Sort alphabetically
      results.sort((a, b) => a.category.localeCompare(b.category));

      res.json(results);
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
  // CHANGED: Accept imageurl and comment
  const { name, category, imageurl, comment } = req.body;
  const db = getDbConnection();
  const sql = "INSERT INTO inventory (name, category, imageurl, comment) VALUES (?, ?, ?, ?)";
  
  db.run(sql, [name, category, imageurl || null, comment || null], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, ...req.body });
    db.close();
  });
});

app.put('/api/inventory/:id', checkAuth, (req, res) => {
  // CHANGED: Accept imageurl and comment
  const { name, category, imageurl, comment } = req.body;
  const db = getDbConnection();
  const sql = "UPDATE inventory SET name = ?, category = ?, imageurl = ?, comment = ? WHERE id = ?";
  
  db.run(sql, [name, category, imageurl || null, comment || null, req.params.id], function(err) {
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

app.post('/api/inventory/fix-data', checkAuth, (req, res) => {
  const db = getDbConnection();
  db.all("SELECT id, category, name FROM inventory", [], (err, rows) => {
    if (err) { db.close(); return res.status(500).json({ error: err.message }); }

    let cleanedCount = 0;
    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      const stmt = db.prepare("UPDATE inventory SET category = ?, name = ? WHERE id = ?");

      rows.forEach(row => {
        if (!row.category) return;
        let parts = row.category.split('>').map(part => part.trim()).filter(p => p.length > 0);
        
        // Logic to prevent "Name > Name" duplication
        const itemName = row.name ? row.name.trim() : '';
        if (parts.length > 0 && itemName) {
            const lastPart = parts[parts.length - 1].toLowerCase();
            if (lastPart === itemName.toLowerCase()) parts.pop();
        }

        const newCategory = parts.join(' > ');
        if (newCategory !== row.category || itemName !== row.name) {
          stmt.run(newCategory, itemName, row.id);
          cleanedCount++;
        }
      });

      stmt.finalize();
      db.run("COMMIT", (err) => {
        if (err) { db.close(); return res.status(500).json({ message: 'Transaction failed.' }); }
        res.status(200).json({ message: `Cleaned ${cleanedCount} items.`, count: cleanedCount });
        db.close();
      });
    });
  });
});

app.post('/api/inventory/upload', checkAuth, upload.single('csvFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

  const results = [];
  const filePath = req.file.path;

  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (data) => {
      // Supports optional imageurl and comment in CSV too
      if (data.name && data.category) results.push(data);
    })
    .on('end', () => {
      if (results.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ message: 'CSV is empty or invalid.' });
      }

      const db = getDbConnection();
      let addedCount = 0;
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare("INSERT INTO inventory (name, category, imageurl, comment) VALUES (?, ?, ?, ?)");
        results.forEach(item => {
            // Map CSV headers to DB columns
            stmt.run(item.name, item.category, item.imageurl || null, item.comment || null, (err) => {
                if (!err) addedCount++;
            });
        });
        stmt.finalize();
        db.run("COMMIT", (err) => {
          fs.unlinkSync(filePath);
          if (err) return res.status(500).json({ message: 'Database transaction failed.' });
          res.status(201).json({ message: `Added ${addedCount} items.`, count: addedCount });
          db.close();
        });
      });
    })
    .on('error', () => {
      fs.unlinkSync(filePath);
      res.status(500).json({ message: 'Error reading CSV.' });
    });
});

app.get('/inventory_admin.html', checkAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'inventory_admin.html'));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});

