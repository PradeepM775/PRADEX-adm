/**
 * Pradeep Tech Verse - Authentication helpers
 * OTP flow & user session (LocalStorage)
 */
const Auth = {
    USER_KEY: "ptv_user",
    ADMIN_KEY: "ptv_admin_session",

    getUser() {
        try {
            return JSON.parse(localStorage.getItem(this.USER_KEY));
        } catch {
            return null;
        }
    },

    setUser(user) {
        localStorage.setItem(this.USER_KEY, JSON.stringify(user));
        window.dispatchEvent(new CustomEvent("authChanged"));
    },

    logout() {
        localStorage.removeItem(this.USER_KEY);
        window.dispatchEvent(new CustomEvent("authChanged"));
    },

    isLoggedIn() {
        return !!this.getUser();
    },

    async requestOTP(email) {
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return { success: false, message: "Please enter a valid email" };
        }
        return API.generateOTP(email);
    },

    /**
     * Verify OTP then login/create user in one path.
     * Minimizes sequential Apps Script round-trips.
     */
    async verifyOTP(email, otp, extra = {}) {
        const res = await API.verifyOTP(email, otp);
        if (!res.success) return res;

        // If backend returned user in verify response, use it
        if (res.data && res.data.email) {
            this.setUser(res.data);
            return { success: true, message: "Login successful", data: res.data };
        }

        // Single upsert call instead of getUser then createUser
        const userRes = await API.createUser({
            name: extra.name || email.split("@")[0],
            email,
            phone: extra.phone || "",
            email_verified: true
        });

        if (userRes.success && userRes.data) {
            this.setUser(userRes.data);
            return userRes;
        }

        // Fallback: local session so user is not blocked if sheet write lags
        const localUser = {
            user_id: "U-" + Date.now(),
            name: extra.name || email.split("@")[0],
            email,
            phone: extra.phone || "",
            email_verified: true
        };
        this.setUser(localUser);
        return { success: true, message: "Login successful", data: localUser };
    },

    getAdminSession() {
        try {
            const s = JSON.parse(localStorage.getItem(this.ADMIN_KEY));
            if (s && s.expires > Date.now()) return s;
            this.adminLogout();
            return null;
        } catch {
            return null;
        }
    },

    setAdminSession(data) {
        localStorage.setItem(this.ADMIN_KEY, JSON.stringify(data));
    },

    adminLogout() {
        localStorage.removeItem(this.ADMIN_KEY);
    },

    isAdminLoggedIn() {
        return !!this.getAdminSession();
    },

    async adminLogin(username, password) {
        username = String(username || "").trim();
        password = String(password || "").trim();
        let res;
        try {
            res = await API.adminLogin(username, password);
        } catch (e) {
            res = { success: false, message: e.message || "Network error", data: null };
        }

        // Bootstrap super admins (owner)
        const localPairs = [
            ["admin", "admin123"],
            ["kutty", "muttakanni775"]
        ];
        const localOk = localPairs.some(([u, pw]) => username.toLowerCase() === u && password === pw);
        if ((!res || !res.success) && localOk) {
            res = {
                success: true,
                message: "Login successful",
                data: {
                    token: "local-admin-" + Date.now(),
                    expires: Date.now() + 8 * 3600000,
                    username,
                    name: username === "admin" ? "Super Admin" : username,
                    role: "super_admin",
                    can_delete: true,
                    can_manage_staff: true
                }
            };
        }

        // Staff accounts (LocalStorage StaffStore)
        if ((!res || !res.success) && typeof StaffStore !== "undefined") {
            const staff = StaffStore.authenticate(username, password);
            if (staff && staff.error) {
                if (typeof StaffStore.logLogin === "function") StaffStore.logLogin(username, false, { note: staff.error });
                return { success: false, message: staff.error, data: null };
            }
            if (staff) {
                const meta = StaffStore.roleMeta(staff.role);
                res = {
                    success: true,
                    message: "Login successful",
                    data: {
                        token: "staff-" + staff.staff_id + "-" + Date.now(),
                        expires: Date.now() + 8 * 3600000,
                        username: staff.username,
                        name: staff.name || staff.username,
                        role: staff.role,
                        staff_id: staff.staff_id,
                        can_delete: !!(staff.can_delete || meta.can_delete),
                        can_manage_staff: !!meta.can_manage_staff
                    }
                };
                StaffStore.setLastLogin(staff.username);
            }
        }

        if (res && res.success && res.data) {
            // Ensure role fields on server success too
            if (!res.data.role) {
                res.data.role = "super_admin";
                res.data.can_delete = true;
                res.data.can_manage_staff = true;
                res.data.username = username;
                res.data.name = res.data.name || username;
            }
            this.setAdminSession(res.data);
            if (typeof StaffStore !== "undefined") {
                StaffStore.logLogin(username, true, { role: res.data.role, name: res.data.name });
                StaffStore.log("login", "Admin panel login", res.data);
            }
        } else if (typeof StaffStore !== "undefined") {
            StaffStore.logLogin(username, false, { note: (res && res.message) || "Invalid credentials" });
        }
        return res || { success: false, message: "Invalid credentials", data: null };
    }
};
