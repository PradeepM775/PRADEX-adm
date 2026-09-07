/**
 * Staff roles, permissions, activity + login logs (LocalStorage)
 * Super Admin manages staff. Delete default OFF for non-super unless can_delete.
 */
const StaffStore = {
    STAFF_KEY: "ptv_admin_staff",
    LOG_KEY: "ptv_admin_activity",
    LOGIN_KEY: "ptv_admin_logins",

    ROLES: {
        super_admin: {
            label: "Super Admin",
            pages: ["*"],
            can_delete: true,
            can_manage_staff: true
        },
        orders: {
            label: "Orders",
            pages: ["dashboard.html", "orders.html", "order-detail.html", "customers.html", "reports.html"],
            can_delete: false,
            can_manage_staff: false
        },
        inventory: {
            label: "Inventory",
            pages: ["dashboard.html", "products.html", "add-product.html", "edit-product.html", "inventory.html", "purchasing.html", "categories.html", "coupons.html", "reports.html"],
            can_delete: false,
            can_manage_staff: false
        },
        support: {
            label: "Support",
            pages: ["dashboard.html", "orders.html", "order-detail.html", "customers.html"],
            can_delete: false,
            can_manage_staff: false
        }
    },

    all() {
        try {
            const list = JSON.parse(localStorage.getItem(this.STAFF_KEY) || "[]");
            return Array.isArray(list) ? list : [];
        } catch { return []; }
    },

    saveAll(list) {
        localStorage.setItem(this.STAFF_KEY, JSON.stringify(list));
    },

    getByUsername(username) {
        const u = String(username || "").trim().toLowerCase();
        return this.all().find(s => String(s.username || "").toLowerCase() === u) || null;
    },

    upsert(staff) {
        const list = this.all();
        const id = staff.staff_id || ("STF-" + Date.now());
        const idx = list.findIndex(s => s.staff_id === id || String(s.username).toLowerCase() === String(staff.username || "").toLowerCase());
        const row = {
            staff_id: id,
            name: String(staff.name || "").trim(),
            email: String(staff.email || "").trim(),
            username: String(staff.username || "").trim(),
            password: String(staff.password || "").trim(),
            role: staff.role || "orders",
            active: staff.active !== false,
            can_delete: !!staff.can_delete,
            created_at: staff.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_login: staff.last_login || ""
        };
        if (!row.username || !row.password) return { success: false, message: "Username and password required" };
        if (!this.ROLES[row.role]) return { success: false, message: "Invalid role" };
        if (idx >= 0) {
            // keep password if left blank on edit
            if (!staff.password) row.password = list[idx].password;
            row.created_at = list[idx].created_at;
            list[idx] = row;
        } else {
            if (this.getByUsername(row.username)) return { success: false, message: "Username already exists" };
            list.push(row);
        }
        this.saveAll(list);
        return { success: true, data: row };
    },

    remove(staffId) {
        const list = this.all().filter(s => s.staff_id !== staffId);
        this.saveAll(list);
        return { success: true };
    },

    setLastLogin(username) {
        const list = this.all();
        const u = String(username || "").toLowerCase();
        const s = list.find(x => String(x.username).toLowerCase() === u);
        if (s) {
            s.last_login = new Date().toISOString();
            this.saveAll(list);
        }
    },

    /** Validate staff credentials (not super-admin bootstrap) */
    authenticate(username, password) {
        const s = this.getByUsername(username);
        if (!s) return null;
        if (s.active === false) return { error: "Account disabled" };
        if (String(s.password) !== String(password)) return null;
        return s;
    },

    roleMeta(role) {
        return this.ROLES[role] || this.ROLES.orders;
    },

    canAccessPage(session, page) {
        if (!session) return false;
        const role = session.role || "super_admin";
        if (role === "super_admin") return true;
        const meta = this.roleMeta(role);
        const p = (page || "").toLowerCase();
        return (meta.pages || []).includes(p);
    },

    canDelete(session) {
        if (!session) return false;
        if (session.role === "super_admin") return true;
        return !!session.can_delete;
    },

    canManageStaff(session) {
        if (!session) return false;
        return session.role === "super_admin" || !!session.can_manage_staff;
    },

    // ----- Activity log -----
    log(action, details, session) {
        try {
            const sess = session || (typeof Auth !== "undefined" ? Auth.getAdminSession() : null) || {};
            const entry = {
                id: "LOG-" + Date.now(),
                at: new Date().toISOString(),
                staff: sess.name || sess.username || "admin",
                role: sess.role || "super_admin",
                action: String(action || "").slice(0, 80),
                details: String(details || "").slice(0, 240)
            };
            const list = this.getLogs();
            list.unshift(entry);
            localStorage.setItem(this.LOG_KEY, JSON.stringify(list.slice(0, 250)));
        } catch (e) {}
    },

    getLogs() {
        try {
            const list = JSON.parse(localStorage.getItem(this.LOG_KEY) || "[]");
            return Array.isArray(list) ? list : [];
        } catch { return []; }
    },

    // ----- Login history -----
    logLogin(username, ok, meta) {
        try {
            const entry = {
                id: "LIN-" + Date.now(),
                at: new Date().toISOString(),
                username: String(username || ""),
                success: !!ok,
                role: (meta && meta.role) || "",
                name: (meta && meta.name) || "",
                note: (meta && meta.note) || ""
            };
            const list = this.getLogins();
            list.unshift(entry);
            localStorage.setItem(this.LOGIN_KEY, JSON.stringify(list.slice(0, 150)));
        } catch (e) {}
    },

    getLogins() {
        try {
            const list = JSON.parse(localStorage.getItem(this.LOGIN_KEY) || "[]");
            return Array.isArray(list) ? list : [];
        } catch { return []; }
    }
};

/** Guard current admin page – call after Auth check */
function enforceStaffPageAccess() {
    if (typeof Auth === "undefined" || !Auth.isAdminLoggedIn()) return;
    const session = Auth.getAdminSession();
    const page = (location.pathname.split("/").pop() || "dashboard.html").toLowerCase();
    // staff.html only super admin
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

/** Hide nav links staff cannot open */
function filterAdminNavByRole() {
    if (typeof Auth === "undefined") return;
    const session = Auth.getAdminSession();
    if (!session) return;
    document.querySelectorAll(".admin-nav a[href]").forEach(a => {
        const href = (a.getAttribute("href") || "").toLowerCase();
        if (!href || href === "#") return;
        if (!StaffStore.canAccessPage(session, href)) {
            a.style.display = "none";
        }
    });
    // Staff link: show only for super admin
    document.querySelectorAll(".admin-nav a[href='staff.html']").forEach(a => {
        a.style.display = StaffStore.canManageStaff(session) ? "" : "none";
    });
}
