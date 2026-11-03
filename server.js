const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const { DATABASE_URL, ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL || !ADMIN_PASSWORD) {
  console.error('Set DATABASE_URL and ADMIN_PASSWORD environment variables');
  process.exit(1);
}
const SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
});

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(express.static('public'));

// ---------- cookies & admin session ----------
function readCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
function setCookie(req, res, name, value, maxAge) {
  res.append('Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
}
function isAdmin(req) {
  const [exp, sig] = (readCookies(req).adm || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return good.length === got.length && crypto.timingSafeEqual(good, got);
}
const needAdmin = (req, res, next) => (isAdmin(req) ? next() : res.status(401).json({ error: 'Not logged in' }));

// every visitor gets a random anonymous id so one person = one vote per post
app.use((req, res, next) => {
  let v = readCookies(req).vid;
  if (!/^[a-f0-9]{32}$/.test(v || '')) {
    v = crypto.randomBytes(16).toString('hex');
    setCookie(req, res, 'vid', v, 60 * 60 * 24 * 365);
  }
  req.vid = v;
  next();
});

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(500).json({ error: 'Server error' });
});

// ---------- database ----------
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ratings (
      post_id INT REFERENCES posts(id) ON DELETE CASCADE,
      voter TEXT NOT NULL,
      stars INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
      PRIMARY KEY (post_id, voter)
    );`);
}

async function getPosts(vid, id) {
  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.body, p.created_at, p.updated_at,
            COALESCE(ROUND(AVG(r.stars)::numeric, 1), 0)::float AS avg,
            COUNT(r.stars)::int AS votes,
            MAX(CASE WHEN r.voter = $1 THEN r.stars END) AS mine
     FROM posts p LEFT JOIN ratings r ON r.post_id = p.id
     ${id ? 'WHERE p.id = $2' : ''}
     GROUP BY p.id ORDER BY p.created_at DESC`,
    id ? [vid, id] : [vid]);
  return rows;
}

function cleanPost(b) {
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const body = typeof b.body === 'string' ? b.body.trim() : '';
  if (!title || !body || title.length > 200 || body.length > 50000) return null;
  return { title, body };
}

// ---------- public API ----------
app.get('/api/posts', wrap(async (req, res) => res.json(await getPosts(req.vid))));

app.get('/api/posts/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [post] = Number.isInteger(id) ? await getPosts(req.vid, id) : [];
  post ? res.json(post) : res.status(404).json({ error: 'Not found' });
}));

app.post('/api/posts/:id/rate', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const stars = parseInt(req.body.stars, 10);
  if (!Number.isInteger(id) || !(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Bad rating' });
  const exists = await pool.query('SELECT 1 FROM posts WHERE id = $1', [id]);
  if (!exists.rowCount) return res.status(404).json({ error: 'Not found' });
  await pool.query(
    `INSERT INTO ratings (post_id, voter, stars) VALUES ($1, $2, $3)
     ON CONFLICT (post_id, voter) DO UPDATE SET stars = $3`, [id, req.vid, stars]);
  res.json((await getPosts(req.vid, id))[0]);
}));

// ---------- admin API ----------
const attempts = new Map(); // ip -> { n, reset }
app.post('/api/login', (req, res) => {
  const now = Date.now();
  const a = attempts.get(req.ip) || { n: 0, reset: now + 10 * 60 * 1000 };
  if (now > a.reset) { a.n = 0; a.reset = now + 10 * 60 * 1000; }
  if (a.n >= 5) return res.status(429).json({ error: 'Too many attempts, try again in 10 minutes' });
  const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
  if (!crypto.timingSafeEqual(hash(req.body.password || ''), hash(ADMIN_PASSWORD))) {
    a.n++; attempts.set(req.ip, a);
    return res.status(401).json({ error: 'Wrong password' });
  }
  attempts.delete(req.ip);
  const exp = String(now + 7 * 24 * 3600 * 1000);
  setCookie(req, res, 'adm', `${exp}.${sign(exp)}`, 7 * 24 * 3600);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { setCookie(req, res, 'adm', '', 0); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ admin: isAdmin(req) }));

app.post('/api/posts', needAdmin, wrap(async (req, res) => {
  const p = cleanPost(req.body);
  if (!p) return res.status(400).json({ error: 'Title and text are required' });
  const { rows } = await pool.query('INSERT INTO posts (title, body) VALUES ($1, $2) RETURNING id', [p.title, p.body]);
  res.json({ id: rows[0].id });
}));

app.put('/api/posts/:id', needAdmin, wrap(async (req, res) => {
  const p = cleanPost(req.body);
  if (!p) return res.status(400).json({ error: 'Title and text are required' });
  const r = await pool.query('UPDATE posts SET title=$1, body=$2, updated_at=now() WHERE id=$3', [p.title, p.body, req.params.id]);
  r.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
}));

app.delete('/api/posts/:id', needAdmin, wrap(async (req, res) => {
  await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

initDb().then(() => {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('Blog running on port ' + port));
}).catch((e) => { console.error('DB init failed', e); process.exit(1); });
