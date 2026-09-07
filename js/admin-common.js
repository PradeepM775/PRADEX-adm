/**
 * PRADEX Admin — unified shell (sidebar + topbar user + permissions)
 */

function adminLogout() {
    if (typeof Auth !== "undefined") Auth.adminLogout();
    location.href = "login.html";
}

function toggleAdminSidebar() {
    document.getElementById("sidebar")?.classList.toggle("open");
}

function normalizeAdminSession() {
    if (typeof Auth === "undefined" || !Auth.isAdminLoggedIn()) return null;
    const s = Auth.getAdminSession();
    if (!s) return null;
    if (!s.role) {
        s.role = "super_admin";
        s.can_delete = true;
        s.can_manage_staff = true;
        s.name = s.name || s.username || "Admin";
        s.username = s.username || "admin";
        Auth.setAdminSession(s);
    }
    return s;
}

function getAdminPageName() {
    return (location.pathname.split("/").pop() || "dashboard.html").toLowerCase();
}

function adminSidebarHTML(active) {
    const page = (active || getAdminPageName()).toLowerCase();
    const item = (href, label) => {
        const on = page === href.toLowerCase() ? " active" : "";
        return `<a href="${href}" class="${on.trim()}">${label}</a>`;
    };
    return `
    <div class="logo">
      <span class="logo-icon">P</span>
      <div class="logo-text">
        <strong>PRADEX Admin</strong>
        <span class="logo-sub">Electronics for a Smarter Tomorrow</span>
      </div>
    </div>
    <nav class="admin-nav" id="adminNav">
      ${item("dashboard.html", "Dashboard")}
      ${item("products.html", "Products")}
      ${item("add-product.html", "Add Product")}
      ${item("inventory.html", "Inventory")}
      ${item("orders.html", "Orders")}
      ${item("purchasing.html", "Purchasing")}
      ${item("customers.html", "Customers")}
      ${item("categories.html", "Categories")}
      ${item("coupons.html", "Coupons")}
      ${item("reports.html", "Reports")}
      ${item("finance.html", "Finance")}
      ${item("staff.html", "Staff / Team")}
      ${item("settings.html", "Settings")}
      <a href="#" class="nav-logout" onclick="adminLogout();return false">Logout</a>
    </nav>
    <div class="admin-sidebar-footer">
      <strong>Build · Manage · Grow</strong>
      PRADEX Electronics
    </div>`;
}

function mountAdminSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    sidebar.innerHTML = adminSidebarHTML(getAdminPageName());
}

function ensureAdminTopbar() {
    let topbar = document.querySelector(".admin-topbar");
    if (!topbar) return;

    // Ensure search + user block structure
    if (!topbar.querySelector(".admin-topbar-right")) {
        const right = document.createElement("div");
        right.className = "admin-topbar-right";
        right.innerHTML = `
          <div class="admin-avatar">P</div>
          <div class="admin-user-meta">
            <strong>Admin</strong>
            <span>PRADEX</span>
          </div>`;
        topbar.appendChild(right);
    }
    if (!topbar.querySelector(".admin-sidebar-toggle")) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "admin-sidebar-toggle";
        btn.setAttribute("aria-label", "Menu");
        btn.textContent = "☰";
        btn.onclick = () => document.getElementById("sidebar")?.classList.toggle("open");
        topbar.insertBefore(btn, topbar.firstChild);
    }
}

function updateAdminTopbarUser() {
    const s = normalizeAdminSession();
    if (!s) return;
    const nameEl = document.querySelector(".admin-user-meta strong");
    const roleEl = document.querySelector(".admin-user-meta span");
    if (nameEl) nameEl.textContent = s.name || s.username || "Admin";
    if (roleEl) {
        let label = s.role || "Admin";
        if (typeof StaffStore !== "undefined" && StaffStore.roleMeta) {
            label = StaffStore.roleMeta(s.role).label || label;
        }
        roleEl.textContent = label;
    }
    const av = document.querySelector(".admin-avatar");
    if (av) {
        const n = (s.name || s.username || "A").trim();
        av.textContent = n.charAt(0).toUpperCase();
    }
}

function filterAdminNavByRole() {
    const session = normalizeAdminSession();
    if (!session || typeof StaffStore === "undefined") return;

    document.querySelectorAll(".admin-nav a[href]").forEach(a => {
        const href = (a.getAttribute("href") || "").toLowerCase();
        if (!href || href === "#" || a.classList.contains("nav-logout")) return;

        if (href === "staff.html") {
            a.style.display = StaffStore.canManageStaff(session) ? "" : "none";
            return;
        }
        a.style.display = StaffStore.canAccessPage(session, href) ? "" : "none";
    });
}

function enforceStaffPageAccess() {
    const session = normalizeAdminSession();
    if (!session || typeof StaffStore === "undefined") return;
    const page = getAdminPageName();

    if (page === "staff.html" && !StaffStore.canManageStaff(session)) {
        alert("Access denied — Super Admin only");
        location.href = "dashboard.html";
        return;
    }
    if (!StaffStore.canAccessPage(session, page)) {
        alert("Access denied for your role");
        location.href = "dashboard.html";
    }
}

function requireDeletePermission(actionLabel) {
    const session = normalizeAdminSession();
    if (typeof StaffStore !== "undefined" && !StaffStore.canDelete(session)) {
        if (typeof Utils !== "undefined") Utils.toast("Delete not allowed for your role", "error");
        else alert("Delete not allowed for your role");
        return false;
    }
    if (typeof StaffStore !== "undefined") {
        StaffStore.log("delete_attempt", actionLabel || "Delete action", session);
    }
    return true;
}

function downloadCSV(filename, headers, rows) {
    const lines = [headers.join(",")].concat(
        rows.map(r => headers.map(h => {
            const v = r[h] == null ? "" : String(r[h]);
            return `"${v.replace(/"/g, '""')}"`;
        }).join(","))
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = filename;
    a.click();
}

function highlightAdminNav() {
    const page = getAdminPageName();
    document.querySelectorAll(".admin-nav a").forEach(a => {
        const href = (a.getAttribute("href") || "").toLowerCase();
        if (!href || href === "#") return;
        a.classList.toggle("active", href === page);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    if (!document.body.classList.contains("admin-body")) return;

    normalizeAdminSession();
    mountAdminSidebar();
    ensureAdminTopbar();
    highlightAdminNav();
    updateAdminTopbarUser();
    filterAdminNavByRole();
    enforceStaffPageAccess();

    document.querySelectorAll(".admin-nav a").forEach(a => {
        a.addEventListener("click", () => {
            if (window.innerWidth <= 900) {
                document.getElementById("sidebar")?.classList.remove("open");
            }
        });
    });
});
