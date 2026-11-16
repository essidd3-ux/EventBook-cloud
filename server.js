
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "eventbook_dev_secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  }
}));

// FICHIERS FRONTEND : ils sont directement à la racine du projet
app.use(express.static(__dirname));

let pool;

async function db() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "eventbook",
      waitForConnections: true,
      connectionLimit: 10
    });
  }
  return pool;
}

const asyncRoute = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      message: "Connectez-vous pour continuer."
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({
      message: "Accès administrateur requis."
    });
  }
  next();
}

// AFFICHER LES EVENEMENTS
app.get("/api/events", asyncRoute(async (req, res) => {
  const p = await db();
  const { q = "", category = "", city = "" } = req.query;

  const [rows] = await p.execute(
    `SELECT e.*, (e.capacity - COALESCE(SUM(CASE WHEN b.status='confirmed' THEN b.quantity ELSE 0 END),0)) AS seats_left
     FROM events e LEFT JOIN bookings b ON b.event_id=e.id
     WHERE e.event_date >= CURDATE()
       AND (?='' OR e.title LIKE CONCAT('%',?,'%') OR e.description LIKE CONCAT('%',?,'%'))
       AND (?='' OR e.category=?)
       AND (?='' OR e.city LIKE CONCAT('%',?,'%'))
     GROUP BY e.id ORDER BY e.event_date ASC`,
    [q, q, q, category, category, city, city]
  );

  res.json(rows);
}));

// DETAIL EVENEMENT
app.get("/api/events/:id", asyncRoute(async (req, res) => {
  const p = await db();

  const [rows] = await p.execute(
    `SELECT e.*, e.capacity-COALESCE((SELECT SUM(quantity) FROM bookings WHERE event_id=e.id AND status='confirmed'),0) seats_left
     FROM events e WHERE e.id=?`,
    [req.params.id]
  );

  if (!rows.length) {
    return res.status(404).json({
      message: "Événement introuvable."
    });
  }

  res.json(rows[0]);
}));

// INSCRIPTION
app.post("/api/register", asyncRoute(async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({
      message: "Remplissez tous les champs. Mot de passe : 6 caractères minimum."
    });
  }

  const p = await db();
  const hash = await bcrypt.hash(password, 10);

  try {
    const [r] = await p.execute(
      "INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",
      [name, email.toLowerCase(), hash]
    );

    req.session.user = {
      id: r.insertId,
      name,
      email: email.toLowerCase(),
      role: "user"
    };

    res.json({ user: req.session.user });

  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Cette adresse e-mail existe déjà."
      });
    }
    throw e;
  }
}));

// CONNEXION
app.post("/api/login", asyncRoute(async (req, res) => {
  const p = await db();

  const [rows] = await p.execute(
    "SELECT * FROM users WHERE email=?",
    [String(req.body.email || "").toLowerCase()]
  );

  if (!rows.length || !await bcrypt.compare(
    req.body.password || "",
    rows[0].password_hash
  )) {
    return res.status(401).json({
      message: "E-mail ou mot de passe incorrect."
    });
  }

  const u = rows[0];

  req.session.user = {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role
  };

  res.json({ user: req.session.user });
}));

// DECONNEXION
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Déconnexion réussie." });
  });
});

// UTILISATEUR CONNECTE
app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

// RESERVATION
app.post("/api/bookings", requireAuth, asyncRoute(async (req, res) => {
  const eventId = Number(req.body.event_id);
  const quantity = Number(req.body.quantity);

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return res.status(400).json({
      message: "Choisissez entre 1 et 10 places."
    });
  }

  const p = await db();
  const conn = await p.getConnection();

  try {
    await conn.beginTransaction();

    const [ev] = await conn.execute(
      "SELECT * FROM events WHERE id=? FOR UPDATE",
      [eventId]
    );

    if (!ev.length) {
      throw new Error("Événement introuvable.");
    }

    const [[count]] = await conn.execute(
      "SELECT COALESCE(SUM(quantity),0) total FROM bookings WHERE event_id=? AND status='confirmed'",
      [eventId]
    );

    if (ev[0].capacity - count.total < quantity) {
      throw new Error("Il ne reste pas assez de places disponibles.");
    }

    const code = "EB-" +
      Date.now().toString(36).toUpperCase() + "-" +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    await conn.execute(
      "INSERT INTO bookings(user_id,event_id,quantity,booking_code) VALUES(?,?,?,?)",
      [req.session.user.id, eventId, quantity, code]
    );

    await conn.commit();

    res.json({
      message: "Réservation confirmée.",
      booking_code: code
    });

  } catch (e) {
    await conn.rollback();
    res.status(400).json({ message: e.message });

  } finally {
    conn.release();
  }
}));

// MES RESERVATIONS
app.get("/api/my-bookings", requireAuth, asyncRoute(async (req, res) => {
  const p = await db();

  const [rows] = await p.execute(
    `SELECT b.id,b.quantity,b.booking_code,b.status,b.created_at,
    e.title,e.city,e.venue,e.event_date,e.image_url
     FROM bookings b JOIN events e ON e.id=b.event_id
     WHERE b.user_id=? ORDER BY b.created_at DESC`,
    [req.session.user.id]
  );

  res.json(rows);
}));

// ADMIN : LISTE DES EVENEMENTS
app.get("/api/admin/events", requireAdmin, asyncRoute(async (req, res) => {
  const p = await db();
  const [rows] = await p.execute(
    "SELECT * FROM events ORDER BY event_date DESC"
  );

  res.json(rows);
}));

// ADMIN : AJOUTER UN EVENEMENT
app.post("/api/admin/events", requireAdmin, asyncRoute(async (req, res) => {
  const {
    title, description, category, city, venue,
    event_date, price, capacity, image_url
  } = req.body;

  if (!title || !category || !city || !venue ||
      !event_date || Number(price) < 0 || Number(capacity) < 1) {
    return res.status(400).json({
      message: "Vérifiez les champs obligatoires."
    });
  }

  const p = await db();

  const [r] = await p.execute(
    "INSERT INTO events(title,description,category,city,venue,event_date,price,capacity,image_url) VALUES(?,?,?,?,?,?,?,?,?)",
    [
      title, description || "", category, city, venue,
      event_date, price, capacity, image_url || ""
    ]
  );

  res.json({
    id: r.insertId,
    message: "Événement ajouté."
  });
}));

// ADMIN : MODIFIER UN EVENEMENT
app.put("/api/admin/events/:id", requireAdmin, asyncRoute(async (req, res) => {
  const {
    title, description, category, city, venue,
    event_date, price, capacity, image_url
  } = req.body;

  const p = await db();

  await p.execute(
    "UPDATE events SET title=?,description=?,category=?,city=?,venue=?,event_date=?,price=?,capacity=?,image_url=? WHERE id=?",
    [
      title, description || "", category, city, venue,
      event_date, price, capacity, image_url || "", req.params.id
    ]
  );

  res.json({ message: "Événement modifié." });
}));

// ADMIN : SUPPRIMER UN EVENEMENT
app.delete("/api/admin/events/:id", requireAdmin, asyncRoute(async (req, res) => {
  const p = await db();

  await p.execute(
    "DELETE FROM events WHERE id=?",
    [req.params.id]
  );

  res.json({ message: "Événement supprimé." });
}));

// ADMIN : LISTE DES RESERVATIONS
app.get("/api/admin/bookings", requireAdmin, asyncRoute(async (req, res) => {
  const p = await db();

  const [rows] = await p.execute(
    `SELECT b.*,u.name user_name,u.email,e.title event_title
     FROM bookings b
     JOIN users u ON u.id=b.user_id
     JOIN events e ON e.id=b.event_id
     ORDER BY b.created_at DESC`
  );

  res.json(rows);
}));

// GESTION DES ERREURS API
app.use("/api", (err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    message: "Erreur serveur. Vérifiez la base de données."
  });
});

// AFFICHER LE SITE PRINCIPAL
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// AFFICHER LES AUTRES PAGES HTML
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// DEMARRAGE DU SERVEUR
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`EventBook est lancé sur le port ${port}`);
});
