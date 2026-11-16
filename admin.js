
const $ = s => document.querySelector(s);

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Erreur.");
  return data;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;",
    '"':"&quot;", "'":"&#39;"
  })[c]);
}

async function loadDashboard() {
  const [events, bookings] = await Promise.all([
    api("/api/admin/events"),
    api("/api/admin/bookings")
  ]);

  $("#eventCount").textContent = events.length;
  $("#bookingCount").textContent = bookings.length;

  $("#eventsTable").innerHTML = events.map(e => `
    <tr>
      <td>${escapeHTML(e.title)}</td>
      <td>${escapeHTML(e.city)}</td>
      <td>${escapeHTML(new Date(e.event_date).toLocaleDateString("fr-FR"))}</td>
      <td>${escapeHTML(e.price)} DT</td>
      <td><button class="delete-btn" data-delete="${Number(e.id)}">Supprimer</button></td>
    </tr>
  `).join("");

  $("#bookingsTable").innerHTML = bookings.map(b => `
    <tr>
      <td>${escapeHTML(b.user_name)}</td>
      <td>${escapeHTML(b.email)}</td>
      <td>${escapeHTML(b.event_title)}</td>
      <td>${escapeHTML(b.quantity)}</td>
      <td>${escapeHTML(b.status)}</td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-delete]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!confirm("Supprimer cet événement ?")) return;
      try {
        await api("/api/admin/events/" + button.dataset.delete, {
          method: "DELETE"
        });
        await loadDashboard();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

$("#eventForm").addEventListener("submit", async e => {
  e.preventDefault();
  const form = new FormData(e.target);
  const data = Object.fromEntries(form.entries());

  data.price = Number(data.price);
  data.capacity = Number(data.capacity);

  try {
    await api("/api/admin/events", {
      method: "POST",
      body: JSON.stringify(data)
    });
    $("#eventMessage").textContent = "Événement ajouté avec succès.";
    e.target.reset();
    await loadDashboard();
  } catch (error) {
    $("#eventMessage").textContent = error.message;
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.href = "/";
});

(async () => {
  try {
    const me = await api("/api/me");
    if (!me.user || me.user.role !== "admin") {
      location.href = "/";
      return;
    }
    await loadDashboard();
  } catch (error) {
    alert("Accès refusé. Connectez-vous avec un compte administrateur.");
    location.href = "/";
  }
})();
