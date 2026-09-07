/**
 * Staff roles, permissions — data from Google Sheets via Apps Script
 * LocalStorage only as offline cache fallback
 */
const StaffStore = {
    STAFF_KEY: "ptv_admin_staff_cache",
    LOG_KEY: "ptv_admin_activity_cache",
    LOGIN_KEY: "ptv_admin_logins_cache",

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

    _cacheStaff(list) {
        try { localStorage.setItem(this.STAFF_KEY, JSON.stringify(list || [])); } catch (e) {}
    },
    _readCacheStaff() {
        try {
            const list = JSON.parse(localStorage.getItem(this.STAFF_KEY) || "[]");
            return Array.isArray(list) ? list : [];
        } catch { return []; }
    },

    async fetchAll() {
        try {
            if (typeof API !== "undefined" && API.adminListStaff) {
                const res = await API.adminListStaff();
                if (res && res.success && Array.isArray(res.data)) {
                    this._cacheStaff(res.data);
                    return res.data;
                }
            }
        } catch (e) {}
        return this._readCacheStaff();
    },

    all() {
        return this._readCacheStaff();
    },

    async save(staff) {
        const payload = {
            staff_id: staff.staff_id || "",
            name: String(staff.name || "").trim(),
            email: String(staff.email || "").trim(),
            username: String(staff.username || "").trim(),
            password: String(staff.password || "").trim(),
            role: staff.role || "orders",
            active: staff.active !== false,
            can_delete: !!staff.can_delete
        };
        if (!payload.username) return { success: false, message: "Username required" };
        if (!this.ROLES[payload.role]) return { success: false, message: "Invalid role" };

        try {
            if (typeof API !== "undefined" && API.adminSaveStaff) {
                const res = await API.adminSaveStaff(payload);
                if (res && res.success) {
                    await this.fetchAll();
                    return res;
                }
                if (res && !res.success) return res;
            }
        } catch (e) {
            return { success: false, message: e.message || "Network error" };
        }
        return { success: false, message: "Could not save staff to server" };
    },

    // legacy name used by staff.html
    upsert(staff) {
        return this.save(staff);
    },

    async remove(staffId) {
        try {
            if (typeof API !== "undefined" && API.adminDeleteStaff) {
                const res = await API.adminDeleteStaff(staffId);
                if (res && res.success) {
                    await this.fetchAll();
                    return res;
                }
                return res || { success: false, message: "Delete failed" };
            }
        } catch (e) {
            return { success: false, message: e.message || "Network error" };
        }
        return { success: false, message: "Could not delete staff" };
    },

    roleMeta(role) {
        return this.ROLES[role] || this.ROLES.orders;
    },

    canAccessPage(session, page) {
        if (!session) return false;
        const role = session.role || "super_admin";
        if (role === "super_admin") return true;
        const meta = this.roleMeta(role);
        return (meta.pages || []).includes((page || "").toLowerCase());
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

    async log(action, details, session) {
        const sess = session || (typeof Auth !== "undefined" ? Auth.getAdminSession() : null) || {};
        const payload = {
            staff: sess.name || sess.username || "admin",
            role: sess.role || "super_admin",
            action: String(action || "").slice(0, 80),
            details: String(details || "").slice(0, 240)
        };
        try {
            if (typeof API !== "undefined" && API.adminLogActivity) {
                await API.adminLogActivity(payload);
            }
        } catch (e) {}
        // cache append
        try {
            const list = this.getLogs();
            list.unshift({ id: "LOG-" + Date.now(), at: new Date().toISOString(), ...payload });
            localStorage.setItem(this.LOG_KEY, JSON.stringify(list.slice(0, 100)));
        } catch (e) {}
    },

    getLogs() {
        try {
            const list = JSON.parse(localStorage.getItem(this.LOG_KEY) || "[]");
            return Array.isArray(list) ? list : [];
        } catch { return []; }
    },

    async fetchLogs(limit) {
        try {
            if (typeof API !== "undefined" && API.adminListActivity) {
                const res = await API.adminListActivity(limit || 50);
                if (res && res.success && Array.isArray(res.data)) {
                    localStorage.setItem(this.LOG_KEY, JSON.stringify(res.data.slice(0, 100)));
                    return res.data;
                }
            }
        } catch (e) {}
        return this.getLogs();
    },

    getLogins() {
        try {
            const list = JSON.parse(localStorage.getItem(this.LOGIN_KEY) || "[]");
            return Array.isArray(list) ? list : [];
        } catch { return []; }
    },

    async fetchLogins(limit) {
        try {
            if (typeof API !== "undefined" && API.adminListLogins) {
                const res = await API.adminListLogins(limit || 50);
                if (res && res.success && Array.isArray(res.data)) {
                    localStorage.setItem(this.LOGIN_KEY, JSON.stringify(res.data.slice(0, 100)));
                    return res.data;
                }
            }
        } catch (e) {}
        return this.getLogins();
    },

    // client-side authenticate removed — login goes through GAS adminLogin
    authenticate() { return null; },
    setLastLogin() {},
    logLogin() {}
};

function enforceStaffPageAccess() {
    if (typeof Auth === "undefined" || !Auth.isAdminLoggedIn()) return;
    const session = Auth.getAdminSession();
    const page = (location.pathname.split("/").pop() || "dashboard.html").toLowerCase();
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

function filterAdminNavByRole() {
    if (typeof Auth === "undefined") return;
    const session = Auth.getAdminSession();
    if (!session) return;
    document.querySelectorAll(".admin-nav a[href]").forEach(a => {
        const href = (a.getAttribute("href") || "").toLowerCase();
        if (!href || href === "#") return;
        if (href === "staff.html") {
            a.style.display = StaffStore.canManageStaff(session) ? "" : "none";
            return;
        }
        if (!StaffStore.canAccessPage(session, href)) a.style.display = "none";
        else a.style.display = "";
    });
}
