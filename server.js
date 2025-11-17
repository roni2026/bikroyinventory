// --- Imports ---
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const multer = require('multer');
const csv = require('csv-parser');
const stringSimilarity = require('string-similarity');

// --- Initialization ---
const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_COOKIE_NAME = 'bikroy_auth_token';

// --- ***** NEW *****: Multer Config for Images ---
// Create a persistent directory for images
const imageDir = path.join(__dirname, 'uploads', 'images');
if (!fs.existsSync(imageDir)) {
  fs.mkdirSync(imageDir, { recursive: true });
}

// Config for CSV uploads (temporary)
const csvUpload = multer({ dest: 'uploads/' });

// Config for image uploads (persistent)
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, imageDir);
  },
  filename: (req, file, cb) => {
    // Create a unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const imageUpload = multer({ storage: imageStorage });

// --- Database Connection ---
function getDbConnection() {
  const db = new sqlite3.Database('./inventory.db', (err) => {
    if (err) console.error('DB Connection Error:', err.message);
  });
  return db;
}

// --- Middleware ---
// These are for JSON APIs, but our forms will now use multipart/form-data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname))); // serve HTML/CSS/JS

// --- ***** NEW *****: Serve Uploaded Images ---
app.use('/uploads/images', express.static(imageDir));

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
      secure: false, // Set to true if using HTTPS
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

// ***** MODIFIED: This route now returns { category, has_image } *****
app.get('/api/inventory', (req, res) => {
  try {
    const raw = (req.query.search || '').toLowerCase().trim();
    if (!raw) return res.json([]);

    const normalized = raw.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
    const searchWords = normalized.split(/\s+/).filter(Boolean);
    if (searchWords.length === 0) return res.json([]);

    const db = getDbConnection();
    // New SQL: Group by category and check if *any* item in that category has an image
    const sql = `
      SELECT 
        category, 
        MAX(CASE WHEN image_url IS NOT NULL AND image_url != '' THEN 1 ELSE 0 END) as has_image
      FROM inventory
      GROUP BY category
      ORDER BY category
    `;

    db.all(sql, [], (err, rows) => {
      if (err) {
        console.error('API Error:', err.message);
        db.close();
        return res.status(500).json({ error: err.message });
      }

      const scored = rows.map(r => {
        const parts = r.category.split('>').map(p => p.trim().toLowerCase());
        const searchIn = parts; 
        const targetWords = searchIn.flatMap(part => 
            part.replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/)
        ).filter(Boolean);
        const targetText = searchIn.join(' '); 

        let score = 0;
        let exactMatches = 0;
        let partialMatches = 0;

        searchWords.forEach(word => {
          if (targetWords.includes(word)) {
            exactMatches++;
            score += 10;
          } else if (word.length >= 3 && targetText.includes(word)) {
            partialMatches++;
            score += 1;
          }
        });

        const similarity = stringSimilarity.compareTwoStrings(raw, targetText);
        score += similarity * 5;

        return {
          category: r.category,
          has_image: r.has_image, // Pass this through
          score,
          exactMatches,
          partialMatches,
          similarity
        };
      })
      .filter(c => c.score > 0)
      .sort((a, b) => {
        if (a.exactMatches !== b.exactMatches) return b.exactMatches - a.exactMatches;
        if (a.score !== b.score) return b.score - a.score;
        return b.similarity - a.similarity;
      })
      // Return the full object, not just the category string
      .map(c => ({ category: c.category, has_image: c.has_image }));

      res.json(scored);
      db.close();
    });
  } catch (e) {
    console.error('Search handler error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- ***** NEW *****: Public route to get details for one category ---
app.get('/api/inventory/details', (req, res) => {
  const { category } = req.query;
  if (!category) {
    return res.status(400).json({ message: 'Category required' });
  }

  const db = getDbConnection();
  // Find the *first* item in this category that has an image and comments
  const sql = `
    SELECT image_url, comments 
    FROM inventory 
    WHERE category = ? AND image_url IS NOT NULL AND image_url != ''
    LIMIT 1
  `;

  db.get(sql, [category], (err, row) => {
    if (err) {
      console.error('Details API Error:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(row || { image_url: null, comments: null });
    db.close();
  });
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

// ***** MODIFIED: Now handles multipart/form-data (image + text) *****
app.post('/api/inventory', checkAuth, imageUpload.single('image'), (req, res) => {
  // Data comes from multer's req.body and req.file
  const { name, category, comments } = req.body;
  const imageUrl = req.file ? `/uploads/images/${req.file.filename}` : null;

  const db = getDbConnection();
  const sql = "INSERT INTO inventory (name, category, image_url, comments) VALUES (?, ?, ?, ?)";
  
  db.run(sql, [name, category, imageUrl, comments], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, name, category, imageUrl, comments });
    db.close();
  });
});

// ***** MODIFIED: Now handles multipart/form-data (image + text) *****
app.put('/api/inventory/:id', checkAuth, imageUpload.single('image'), (req, res) => {
  const { name, category, comments, remove_image } = req.body;
  const db = getDbConnection();

  // This logic is more complex:
  // 1. Get the existing item
  db.get("SELECT image_url FROM inventory WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ message: 'Item not found' });

    let imageUrl = row.image_url; // Start with the existing URL

    if (req.file) {
      // 2. If a new image is uploaded, use it.
      imageUrl = `/uploads/images/${req.file.filename}`;
      // (Optional: Delete the old image file `row.image_url` from disk here)
    } else if (remove_image === 'true') {
      // 3. If "remove image" is checked, set to null
      imageUrl = null;
      // (Optional: Delete the old image file `row.image_url` from disk here)
    }
    // 4. If neither, imageUrl just stays as the original `row.image_url`

    const sql = "UPDATE inventory SET name = ?, category = ?, image_url = ?, comments = ? WHERE id = ?";
    db.run(sql, [name, category, imageUrl, comments, req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Update successful' });
      db.close();
    });
  });
});


app.delete('/api/inventory/:id', checkAuth, (req, res) => {
  // (Optional: You should also delete the associated image file from disk here)
  const db = getDbConnection();
  db.run("DELETE FROM inventory WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Delete successful' });
    db.close();
  });
});

// Admin: CSV Upload (Uses csvUpload multer config)
app.post('/api/inventory/upload', checkAuth, csvUpload.single('csvFile'), (req, res) => {
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
        // CSVs don't have images/comments, so we insert NULL
        const stmt = db.prepare("INSERT INTO inventory (name, category, image_url, comments) VALUES (?, ?, NULL, NULL)");
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
    .on('error', (err) => {
      fs.unlinkSync(filePath);
      res.status(500).json({ message: 'Error reading CSV file.' });
      db.close();
    });
});

// --- ***** NEW *****: Stub route for 'Fix Data' button ---
app.post('/api/inventory/fix-data', checkAuth, (req, res) => {
  // This is a placeholder. You would add your data cleaning logic here.
  // For example, finding and removing quotes.
  console.log("Fix Data endpoint called. No logic implemented.");
  res.status(200).json({ message: 'Fix Data routine ran (no changes made).', count: 0 });
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
  console.log(`Admin page:        http://0.0.0.0:${PORT}/inventory_admin.html`);
  console.log(`Public search:     http://0.0.0.0:${PORT}/inventory_search.html`);
});
