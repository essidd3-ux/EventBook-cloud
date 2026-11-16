
const $ = s => document.querySelector(s);

let authMode = "login";
let currentUser = null;

const money = n =>
  Number(n).toLocaleString("fr-TN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }) + " DT";

const dateFmt = d =>
  new Date(d).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

function toast(t) {
  const el = $("#toast");
  el.textContent = t;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2800);
}

async function api(url, opts = {}) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...opts
  });

  const data = await r.json();

  if (!r.ok) {
    throw Error(data.message || "Une erreur est survenue.");
  }

  return data;
}

// Afficher les événements
function eventCard(e) {
  return `
    <article class="event-card">
      <div class="event-image"
        style="background-image:url('${e.image_url || "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=900"}')">
        <span class="event-tag">${e.category}</span>
      </div>

      <div class="event-info">
        <span class="event-date">${dateFmt(e.event_date)}</span>
        <h3>${e.title}</h3>

        <div class="event-meta">
          <span>⌖ ${e.city}</span>
          <span>◷ ${e.venue}</span>
        </div>

        <div class="event-bottom">
          <span class="price">
            ${Number(e.price) === 0 ? "Gratuit" : money(e.price)}
          </span>
          <a class="small-link" href="#" data-event="${e.id}">
            Voir détails →
          </a>
        </div>
      </div>
    </article>
  `;
}

// Charger les événements
async function loadEvents() {
  const params = new URLSearchParams({
    q: $("#search").value,
    category: $("#category").value,
    city: $("#city").value
  });

  try {
    const events = await api("/api/events?" + params);

    $("#eventsGrid").innerHTML = events.length
      ? events.map(eventCard).join("")
      : "<p>Aucun événement trouvé. Essayez d'autres critères.</p>";

    document.querySelectorAll("[data-event]").forEach(a => {
      a.addEventListener("click", e => {
        e.preventDefault();
        showEvent(a.dataset.event);
      });
    });

  } catch (e) {
    $("#eventsGrid").innerHTML =
      "<p>Impossible de charger les événements. Vérifiez la connexion à la base de données.</p>";
  }
}

// Détails d'un événement
async function showEvent(id) {
  try {
    const e = await api("/api/events/" + id);

    $("#eventDetail").innerHTML = `
      <img src="${e.image_url || ""}" alt="">
      <p class="eyebrow">${e.category} · ${dateFmt(e.event_date)}</p>
      <h2>${e.title}</h2>
      <p>${e.description || ""}</p>
      <p class="event-meta">⌖ ${e.city} · ${e.venue}</p>
      <p><b>${money(e.price)}</b> · ${e.seats_left} place(s) disponible(s)</p>

      <label>Nombre de places</label>
      <input id="quantity" type="number" min="1" max="10" value="1">

      <button class="btn btn-gold btn-large full" id="bookBtn">
        Réserver maintenant
      </button>

      <p class="message" id="bookMessage"></p>
    `;

    $("#eventModal").classList.remove("hidden");

    $("#bookBtn").onclick = async () => {
      try {
        const r = await api("/api/bookings", {
          method: "POST",
          body: JSON.stringify({
            event_id: id,
            quantity: Number($("#quantity").value)
          })
        });

        $("#bookMessage").textContent =
          "Réservation confirmée ! Votre code : " + r.booking_code;

        toast("Votre réservation est confirmée.");
        loadEvents();

      } catch (err) {
        $("#bookMessage").textContent = err.message;
      }
    };

  } catch (e) {
    toast(e.message);
  }
}

// Connexion et inscription
function openAuth(mode) {
  authMode = mode;

  $("#authTitle").textContent =
    mode === "login" ? "Connexion" : "Créer un compte";

  $("#authSubmit").textContent =
    mode === "login" ? "Se connecter" : "Créer mon compte";

  $("#nameField").classList.toggle("hidden", mode === "login");

  $("#authSwitch").innerHTML =
    mode === "login"
      ? 'Pas encore de compte ? <a href="#" id="switchAuth">Créer un compte</a>'
      : 'Déjà inscrit ? <a href="#" id="switchAuth">Se connecter</a>';

  $("#authModal").classList.remove("hidden");
  $("#authMessage").textContent = "";

  $("#switchAuth").onclick = e => {
    e.preventDefault();
    openAuth(mode === "login" ? "register" : "login");
  };
}

$("#loginOpen").onclick = () => openAuth("login");
$("#registerOpen").onclick = () => openAuth("register");

$("#modalClose").onclick = () =>
  $("#authModal").classList.add("hidden");

$("#eventClose").onclick = () =>
  $("#eventModal").classList.add("hidden");

// Mettre à jour la navigation
function updateNav() {
  $("#loginOpen").classList.toggle("hidden", !!currentUser);
  $("#registerOpen").classList.toggle("hidden", !!currentUser);
  $("#logoutBtn").classList.toggle("hidden", !currentUser);
}

// Connexion / inscription avec redirection admin
$("#authForm").onsubmit = async e => {
  e.preventDefault();

  const f = new FormData(e.target);
  const body = Object.fromEntries(f);

  try {
    const data = await api("/api/" + authMode, {
      method: "POST",
      body: JSON.stringify(body)
    });

    currentUser = data.user;

    // Redirection automatique de l'administrateur
    if (currentUser.role === "admin") {
      location.href = "/admin.html";
      return;
    }

    updateNav();

    $("#authModal").classList.add("hidden");
    toast("Bienvenue " + currentUser.name + " !");

  } catch (err) {
    $("#authMessage").textContent = err.message;
  }
};

// Déconnexion
$("#logoutBtn").onclick = async () => {
  try {
    await api("/api/logout", { method: "POST" });

    currentUser = null;
    updateNav();

    toast("Vous êtes déconnecté.");

  } catch (err) {
    toast(err.message);
  }
};

// Filtres
["search", "category", "city"].forEach(id => {
  $("#" + id).addEventListener(
    id === "search" ? "input" : "change",
    loadEvents
  );
});

// Vérifier la session au chargement
(async () => {
  try {
    const me = await api("/api/me");

    currentUser = me.user;

    // Si administrateur déjà connecté
    if (currentUser && currentUser.role === "admin") {
      location.href = "/admin.html";
      return;
    }

    updateNav();

  } catch (e) {
    console.log("Utilisateur non connecté.");
  }

  loadEvents();
})();
