/**
 * Pradeep Tech Verse - API Layer
 * All data access goes through this module.
 * Frontend never talks directly to Google Sheets structure.
 * Easy to swap backend later (Firebase, Supabase, Node, etc.)
 */

const API = {
    _cache: {},
    _cacheTTL: 120000, // live account/order data: 2 minutes
    _catalogTTL: 900000, // products/categories/settings: 15 minutes
    _inflight: {},     // dedupe parallel identical requests
    _SS_KEY: "ptv_api_cache_v1",
    _LS_KEY: "ptv_catalog_cache_v1",

    _isCatalogKey(key) {
        return /^(getProducts|getCategories|getPaymentSettings|getStoreSettings):/.test(key || "");
    },

    _ttlFor(key) {
        return this._isCatalogKey(key) ? this._catalogTTL : this._cacheTTL;
    },

    clearCache() {
        this._cache = {};
        try { sessionStorage.removeItem(this._SS_KEY); } catch (e) {}
        try { localStorage.removeItem(this._LS_KEY); } catch (e) {}
    },

    _readSession(key) {
        try {
            const all = JSON.parse(sessionStorage.getItem(this._SS_KEY) || "{}");
            const row = all[key];
            if (row && Date.now() - row.t < this._ttlFor(key)) return row.v;
        } catch (e) {}
        // Catalog data survives page/browser restarts for instant repeat loads.
        if (this._isCatalogKey(key)) {
            try {
                const all = JSON.parse(localStorage.getItem(this._LS_KEY) || "{}");
                const row = all[key];
                if (row && Date.now() - row.t < this._catalogTTL) return row.v;
            } catch (e) {}
        }
        return null;
    },

    _writeSession(key, value) {
        try {
            const all = JSON.parse(sessionStorage.getItem(this._SS_KEY) || "{}");
            all[key] = { t: Date.now(), v: value };
            // keep session small
            const keys = Object.keys(all);
            if (keys.length > 12) keys.slice(0, keys.length - 12).forEach(k => delete all[k]);
            sessionStorage.setItem(this._SS_KEY, JSON.stringify(all));
        } catch (e) {}
        if (this._isCatalogKey(key)) {
            try {
                const all = JSON.parse(localStorage.getItem(this._LS_KEY) || "{}");
                all[key] = { t: Date.now(), v: value };
                const keys = Object.keys(all);
                if (keys.length > 6) keys.slice(0, keys.length - 6).forEach(k => delete all[k]);
                localStorage.setItem(this._LS_KEY, JSON.stringify(all));
            } catch (e) {}
        }
    },

    /**
     * Generic request helper — cached, deduped, fast
     */
    async request(action, data = {}, method = "POST") {
        const url = (CONFIG.APPS_SCRIPT_URL || "").trim();
        const urlMissing = !url || url.includes("YOUR_") || !url.startsWith("http");

        const isRead = [
            "getProducts", "getCategories", "getProductById",
            "getOrders", "getUserOrders", "getCustomers",
            "adminGetDashboard", "adminGetProducts", "adminGetOrders", "getUser",
            "getPaymentSettings", "getStoreSettings", "getCoupons", "validateCoupon"
        ].includes(action);
        // getOrderStatus is NEVER cached — tracking must stay live
        const cacheKey = isRead ? action + ":" + JSON.stringify(data || {}) : null;

        if (cacheKey) {
            if (this._cache[cacheKey] && Date.now() - this._cache[cacheKey].t < this._ttlFor(cacheKey)) {
                return this._cache[cacheKey].v;
            }
            const ss = this._readSession(cacheKey);
            if (ss) {
                this._cache[cacheKey] = { t: Date.now(), v: ss };
                return ss;
            }
            if (this._inflight[cacheKey]) return this._inflight[cacheKey];
        }

        const run = async () => {
            if (urlMissing) {
                if (CONFIG.DEMO_MODE) {
                    const result = await this._demoHandler(action, data);
                    if (cacheKey && result.success) {
                        this._cache[cacheKey] = { t: Date.now(), v: result };
                        this._writeSession(cacheKey, result);
                    }
                    return result;
                }
                return { success: false, message: "Apps Script URL not configured", data: null };
            }

            try {
                const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
                // Fast timeout — never hang UI (Apps Script cold start can be slow)
                const timer = controller ? setTimeout(() => controller.abort(), 7000) : null;
                const res = await fetch(url, {
                    method: "POST",
                    redirect: "follow",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify({ action, ...data }),
                    signal: controller ? controller.signal : undefined
                });
                if (timer) clearTimeout(timer);

                const text = await res.text();
                let json;
                try {
                    json = JSON.parse(text);
                } catch (parseErr) {
                    console.error("Apps Script non-JSON response:", text.slice(0, 200));
                    throw new Error("Apps Script returned invalid JSON. Redeploy Web App (Anyone access).");
                }
                if (cacheKey && json.success) {
                    this._cache[cacheKey] = { t: Date.now(), v: json };
                    this._writeSession(cacheKey, json);
                }
                if (["addProduct","updateProduct","deleteProduct","updateStock","addCategory","updateCategory","deleteCategory","uploadImage","createOrder","deleteOrder","updateOrderStatus"].includes(action)) {
                    this.clearCache();
                }
                return json;
            } catch (err) {
                console.error("API Error:", err);
                // Always fall back to local/demo for READ ops so UI never stuck loading
                if (CONFIG.DEMO_MODE) {
                    console.warn("Falling back to local/demo data for", action);
                    try {
                        const result = await this._demoHandler(action, data);
                        if (cacheKey && result && result.success) {
                            this._cache[cacheKey] = { t: Date.now(), v: result };
                        }
                        return result;
                    } catch (e2) {
                        console.error("Demo fallback failed:", e2);
                    }
                }
                const msg = err.name === "AbortError"
                    ? "Request timed out. Try again."
                    : ("Network error: " + (err.message || "Check Apps Script URL & deployment"));
                return { success: false, message: msg, data: null };
            }
        };

        if (cacheKey) {
            this._inflight[cacheKey] = run().finally(() => { delete this._inflight[cacheKey]; });
            return this._inflight[cacheKey];
        }
        return run();
    },

    // ========== PRODUCTS ==========
    async getProducts(filters = {}) {
        // Always fetch full list once (cached); filter client-side for speed
        const res = await this.request("getProducts", {});
        if (!res.success || !res.data) return res;
        let list = res.data;
        if (filters.featured) list = list.filter(p => p.featured);
        if (filters.best_seller) list = list.filter(p => p.best_seller);
        if (filters.new_arrival) list = list.filter(p => p.new_arrival);
        if (filters.category) list = list.filter(p => p.category === filters.category);
        if (!filters.include_inactive) {
            list = list.filter(p => {
                const s = String(p.status == null ? "active" : p.status).toLowerCase();
                return s === "active" || s === "true" || s === "1" || s === "";
            });
        }
        return { success: true, message: "OK", data: list };
    },

    async getProductById(productId) {
        // Prefer cache from full list
        const all = await this.getProducts({ include_inactive: true });
        if (all.success && all.data) {
            const p = all.data.find(x => String(x.product_id) === String(productId));
            if (p) return { success: true, message: "OK", data: p };
        }
        return this.request("getProductById", { product_id: productId });
    },

    async getFeaturedProducts() {
        return this.getProducts({ featured: true });
    },

    async getBestSellers() {
        return this.getProducts({ best_seller: true });
    },

    async getNewArrivals() {
        return this.getProducts({ new_arrival: true });
    },

    // ========== CATEGORIES ==========
    async getCategories() {
        return this.request("getCategories");
    },

    // ========== AUTH / OTP ==========
    async generateOTP(email) {
        return this.request("generateOTP", { email });
    },

    async verifyOTP(email, otp) {
        return this.request("verifyOTP", { email, otp });
    },

    async createUser(userData) {
        return this.request("createUser", userData);
    },

    async getUser(email) {
        return this.request("getUser", { email });
    },

    async updateUser(userData) {
        return this.request("updateUser", userData);
    },

    // ========== ORDERS ==========
    async createOrder(orderData) {
        return this.request("createOrder", orderData);
    },

    async updateOrderProof(orderId, payment_proof_url) {
        return this.request("updateOrderProof", { order_id: orderId, payment_proof_url });
    },

    async getOrderStatus(orderId, emailOrPhone) {
        return this.request("getOrderStatus", { order_id: orderId, email_or_phone: emailOrPhone });
    },

    async getUserOrders(email) {
        return this.request("getUserOrders", { email });
    },

    // ========== ADMIN ==========
    async adminLogin(username, password) {
        const res = await this.request("adminLogin", { username, password });
        if (res && res.success) return res;
        // If Apps Script rejects / offline, still allow demo pair via local handler
        const u = String(username || "").trim().toLowerCase();
        const pw = String(password || "").trim();
        if ((u === "admin" && pw === "admin123") || (u === "kutty" && pw === "muttakanni775")) {
            return {
                success: true,
                message: "Login successful",
                data: { token: "local-admin-" + Date.now(), expires: Date.now() + 8 * 3600000 }
            };
        }
        return res;
    },

    async adminGetDashboard() {
        return this.request("adminGetDashboard");
    },

    async adminGetProducts() {
        return this.request("adminGetProducts");
    },

    async adminAddProduct(product) {
        return this.request("addProduct", product);
    },

    async adminUpdateProduct(product) {
        return this.request("updateProduct", product);
    },

    async adminDeleteProduct(productId) {
        return this.request("deleteProduct", { product_id: productId });
    },

    async adminUpdateStock(productId, quantity) {
        return this.request("updateStock", { product_id: productId, stock: quantity });
    },

    /**
     * Upload product image (base64) → Google Drive via Apps Script
     * @param {{filename:string, mimeType:string, base64Data:string}} payload
     */
    async uploadImage(payload) {
        return this.request("uploadImage", payload);
    },

    async adminGetOrders() {
        // Don't serve stale empty cache for admin
        const key = 'getOrders:{}';
        if (this._cache[key]) delete this._cache[key];
        return this.request("getOrders");
    },

    async adminDeleteOrder(orderId) {
        this.clearCache();
        return this.request("deleteOrder", { order_id: orderId });
    },

    async adminUpdateOrderStatus(orderId, status) {
        return this.request("updateOrderStatus", { order_id: orderId, order_status: status });
    },

    async adminUpdatePaymentStatus(orderId, paymentStatus) {
        return this.request("updatePaymentStatus", { order_id: orderId, payment_status: paymentStatus });
    },

    async adminGetCustomers() {
        return this.request("getCustomers");
    },

    async adminAddCustomer(data) {
        return this.request("createUser", data);
    },

    getPaymentSettings() {
        return { success: true, data: this.getStoreSettings() };
    },

    getStoreSettings() {
        const defaults = {
            store_name: CONFIG.APP_NAME,
            email: CONFIG.EMAIL,
            phone: CONFIG.PHONE,
            whatsapp: CONFIG.WHATSAPP,
            address: CONFIG.ADDRESS,
            ship_from_name: CONFIG.APP_NAME,
            ship_from_phone: CONFIG.PHONE,
            ship_from_address: CONFIG.ADDRESS,
            shipping_fee: CONFIG.DEFAULT_SHIPPING,
            free_shipping_min: CONFIG.FREE_SHIPPING_MIN,
            // Payments
            enable_cod: true,
            enable_upi: true,
            upi_id: "",
            upi_name: CONFIG.APP_NAME,
            upi_qr: "",
            // Messaging / OTP
            otp_from_email: CONFIG.EMAIL,
            whatsapp_admin_number: CONFIG.WHATSAPP,
            whatsapp_notify_customer: true
        };
        try {
            const saved = JSON.parse(localStorage.getItem("ptv_settings") || "null");
            return saved ? { ...defaults, ...saved } : defaults;
        } catch { return defaults; }
    },

    saveStoreSettings(s) {
        localStorage.setItem("ptv_settings", JSON.stringify(s));
        return { success: true, message: "Settings saved" };
    },

    async adminGetCategories() {
        return this.request("getCategories");
    },

    async adminAddCategory(category) {
        return this.request("addCategory", category);
    },

    async adminUpdateCategory(category) {
        return this.request("updateCategory", category);
    },

    async adminDeleteCategory(categoryId) {
        return this.request("deleteCategory", { category_id: categoryId });
    },

    async adminUpdateTracking(orderId, trackingNumber, courierName) {
        const res = await this.request("updateTracking", {
            order_id: orderId,
            tracking_number: trackingNumber,
            courier_name: courierName || ""
        });
        try { this.clearCache(); } catch (e) {}
        return res;
    },

    async adminGetCoupons() {
        return this.request("getCoupons");
    },

    async adminAddCoupon(coupon) {
        return this.request("addCoupon", coupon);
    },

    async adminDeleteCoupon(code) {
        return this.request("deleteCoupon", { code });
    },

    async validateCoupon(code, amount) {
        return this.request("validateCoupon", { code, amount });
    },

    async adminGetReports() {
        return this.request("getReports");
    },

    // ========== PAYMENT PLACEHOLDERS (Razorpay ready) ==========
    async createPaymentOrder(amount, orderId) {
        return this.request("createPaymentOrder", { amount, order_id: orderId });
    },

    async verifyPayment(paymentData) {
        return this.request("verifyPayment", paymentData);
    },

    // ========== DEMO HANDLER ==========
    _demoHandler(action, data) {
        return Promise.resolve(this._demoLogic(action, data));
    },

    _demoLogic(action, data) {
        switch (action) {
            case "getProducts": {
                let products = this._localProducts();
                if (!data.include_inactive) products = products.filter(p => p.status !== "inactive");
                if (data.featured) products = products.filter(p => p.featured);
                if (data.best_seller) products = products.filter(p => p.best_seller);
                if (data.new_arrival) products = products.filter(p => p.new_arrival);
                if (data.category) products = products.filter(p => p.category === data.category);
                if (data.in_stock) products = products.filter(p => p.stock > 0);
                if (data.search) {
                    const q = data.search.toLowerCase();
                    products = products.filter(p =>
                        (p.name || "").toLowerCase().includes(q) ||
                        (p.category || "").toLowerCase().includes(q) ||
                        (p.brand || "").toLowerCase().includes(q)
                    );
                }
                return { success: true, message: "OK", data: products };
            }
            case "getProductById": {
                const p = this._localProducts().find(x => String(x.product_id) === String(data.product_id || data.id));
                return p
                    ? { success: true, message: "OK", data: p }
                    : { success: false, message: "Product not found", data: null };
            }
            case "getCategories":
                return { success: true, message: "OK", data: this._localCategories() };

            case "generateOTP":
                // In real mode Apps Script generates & emails. Here we just acknowledge.
                console.log("[DEMO] OTP would be sent to", data.email, "→ Use 123456");
                return { success: true, message: "Demo OTP: 123456 (no email in demo mode)", data: { expires_in: 300, demo_otp: "123456" } };

            case "verifyOTP":
                if (data.otp === "123456") {
                    return { success: true, message: "OTP verified", data: { verified: true } };
                }
                return { success: false, message: "Invalid OTP. Try 123456 in demo mode.", data: null };

            case "createUser": {
                const users = JSON.parse(localStorage.getItem("ptv_users") || "[]");
                const existing = users.find(u => u.email === data.email);
                if (existing) {
                    if (data.name) existing.name = data.name;
                    if (data.phone) existing.phone = data.phone;
                    localStorage.setItem("ptv_users", JSON.stringify(users));
                    return { success: true, message: "Welcome back", data: existing };
                }
                const user = {
                    user_id: "USR-" + Date.now(),
                    name: data.name || (data.email || "").split("@")[0],
                    email: data.email,
                    phone: data.phone || "",
                    address: data.address || "",
                    email_verified: true,
                    created_at: new Date().toISOString()
                };
                users.push(user);
                localStorage.setItem("ptv_users", JSON.stringify(users));
                return { success: true, message: "Account created", data: user };
            }

            case "getUser":
                // Return mock user if exists in localStorage
                const stored = localStorage.getItem("ptv_user");
                if (stored) {
                    const u = JSON.parse(stored);
                    if (u.email === data.email) return { success: true, message: "OK", data: u };
                }
                return { success: false, message: "User not found", data: null };

            case "createOrder": {
                const orderId = "PTV-" + new Date().getFullYear() + "-" + String(Math.floor(Math.random() * 90000) + 10000);
                const order = {
                    order_id: orderId,
                    ...data,
                    order_status: "Confirmed",
                    payment_status: data.payment_status || "Pending",
                    payment_proof_url: data.payment_proof_url || "",
                    created_at: new Date().toISOString()
                };
                // Keep local proof on order object for admin (don't strip)
                if (data._local_proof) order._local_proof = data._local_proof;
                const orders = JSON.parse(localStorage.getItem("ptv_demo_orders") || "[]");
                orders.push(order);
                localStorage.setItem("ptv_demo_orders", JSON.stringify(orders));
                if (data._local_proof) {
                    try {
                        const proofs = JSON.parse(localStorage.getItem("ptv_payment_proofs") || "{}");
                        proofs[orderId] = data._local_proof;
                        localStorage.setItem("ptv_payment_proofs", JSON.stringify(proofs));
                    } catch (e) {}
                }
                return { success: true, message: "Order placed successfully", data: order };
            }

            case "getOrderStatus": {
                const orders = JSON.parse(localStorage.getItem("ptv_demo_orders") || "[]");
                const order = orders.find(o =>
                    o.order_id === data.order_id &&
                    (o.email === data.email_or_phone || o.phone === data.email_or_phone)
                );
                return order
                    ? { success: true, message: "OK", data: order }
                    : { success: false, message: "Order not found", data: null };
            }

            case "getUserOrders": {
                const orders = JSON.parse(localStorage.getItem("ptv_demo_orders") || "[]");
                const userOrders = orders.filter(o => o.email === data.email);
                return { success: true, message: "OK", data: userOrders };
            }

            case "adminLogin": {
                const u = String(data.username || "").trim().toLowerCase();
                const pw = String(data.password || "").trim();
                if ((u === "admin" && pw === "admin123") || (u === "kutty" && pw === "muttakanni775")) {
                    return {
                        success: true,
                        message: "Login successful",
                        data: { token: "admin-token-" + Date.now(), expires: Date.now() + 8 * 3600000 }
                    };
                }
                return { success: false, message: "Invalid credentials", data: null };
            }

            case "adminGetDashboard": {
                const prods = this._localProducts();
                const orders = JSON.parse(localStorage.getItem("ptv_demo_orders") || "[]");
                const customers = this._localCustomers();
                return {
                    success: true,
                    message: "OK",
                    data: {
                        total_products: prods.length,
                        total_stock: prods.reduce((s, p) => s + (Number(p.stock) || 0), 0),
                        low_stock: prods.filter(p => p.stock > 0 && p.stock <= (p.minimum_stock || 5)).length,
                        out_of_stock: prods.filter(p => p.stock <= 0).length,
                        total_orders: orders.length,
                        pending_orders: orders.filter(o => !["Delivered","Cancelled"].includes(o.order_status)).length,
                        delivered_orders: orders.filter(o => o.order_status === "Delivered").length,
                        total_sales: orders.reduce((s, o) => s + (Number(o.total) || 0), 0),
                        today_orders: 0,
                        total_customers: customers.length
                    }
                };
            }

            case "adminGetProducts":
                return { success: true, message: "OK", data: this._localProducts() };

            case "addProduct": {
                const list = this._localProducts();
                if (list.some(p => String(p.product_id) === String(data.product_id))) {
                    return { success: false, message: "Product ID already exists", data: null };
                }
                const product = {
                    ...data,
                    stock: Number(data.stock) || 0,
                    original_price: Number(data.original_price) || 0,
                    selling_price: Number(data.selling_price) || 0,
                    minimum_stock: Number(data.minimum_stock) || 5,
                    status: data.status || "active",
                    created_at: new Date().toISOString().slice(0, 10),
                    updated_at: new Date().toISOString()
                };
                list.push(product);
                this._saveLocalProducts(list);
                return { success: true, message: "Product added successfully", data: product };
            }

            case "updateProduct": {
                const list = this._localProducts();
                const idx = list.findIndex(p => String(p.product_id) === String(data.product_id));
                if (idx < 0) return { success: false, message: "Product not found", data: null };
                list[idx] = { ...list[idx], ...data, updated_at: new Date().toISOString() };
                this._saveLocalProducts(list);
                return { success: true, message: "Product updated", data: list[idx] };
            }

            case "deleteProduct": {
                let list = this._localProducts();
                const before = list.length;
                list = list.filter(p => String(p.product_id) !== String(data.product_id));
                if (list.length === before) return { success: false, message: "Product not found", data: null };
                this._saveLocalProducts(list);
                return { success: true, message: "Product deleted", data: null };
            }

            case "updateStock": {
                const list = this._localProducts();
                const idx = list.findIndex(p => String(p.product_id) === String(data.product_id));
                if (idx < 0) return { success: false, message: "Product not found", data: null };
                list[idx].stock = Math.max(0, Number(data.stock) || 0);
                list[idx].updated_at = new Date().toISOString();
                this._saveLocalProducts(list);
                return { success: true, message: "Stock updated", data: list[idx] };
            }

            case "uploadImage": {
                // Local/demo: store as data URL (for production, Apps Script uploads to Google Drive)
                const url = data.base64Data && String(data.base64Data).startsWith("data:")
                    ? data.base64Data
                    : (data.base64Data ? "data:" + (data.mimeType || "image/jpeg") + ";base64," + data.base64Data : "");
                if (!url) return { success: false, message: "No image data", data: null };
                return { success: true, message: "Image ready (local). Connect Apps Script for Google Drive storage.", data: { url, file_id: "local" } };
            }

            case "getOrders":
            case "adminGetOrders":
                return { success: true, message: "OK", data: JSON.parse(localStorage.getItem("ptv_demo_orders") || "[]") };

            case "deleteOrder": {
                let orders = JSON.parse(localStorage.getItem("ptv_demo_orders") || "[]");
                const before = orders.length;
                orders = orders.filter(o => o.order_id !== data.order_id);
                localStorage.setItem("ptv_demo_orders", JSON.stringify(orders));
                return { success: orders.length < before, message: orders.length < before ? "Order deleted" : "Order not found", data: null };
            }

            case "updateOrderStatus": {
                const orders = JSON.parse(localStorage.getItem("ptv_demo_orders") || "[]");
                const idx = orders.findIndex(o => o.order_id === data.order_id);
                if (idx >= 0) {
                    orders[idx].order_status = data.order_status;
                    localStorage.setItem("ptv_demo_orders", JSON.stringify(orders));
                    return { success: true, message: "Status updated", data: orders[idx] };
                }
                return { success: false, message: "Order not found", data: null };
            }

            case "updatePaymentStatus": {
                const orders = JSON.parse(localStorage.getItem("ptv_demo_orders") || "[]");
                const idx = orders.findIndex(o => o.order_id === data.order_id);
                if (idx >= 0) {
                    orders[idx].payment_status = data.payment_status;
                    localStorage.setItem("ptv_demo_orders", JSON.stringify(orders));
                    return { success: true, message: "Payment status updated", data: orders[idx] };
                }
                return { success: false, message: "Order not found", data: null };
            }

            case "updateTracking": {
                const orders = JSON.parse(localStorage.getItem("ptv_demo_orders") || "[]");
                const idx = orders.findIndex(o => o.order_id === data.order_id);
                if (idx >= 0) {
                    orders[idx].tracking_number = data.tracking_number;
                    orders[idx].courier_name = data.courier_name || "";
                    localStorage.setItem("ptv_demo_orders", JSON.stringify(orders));
                    return { success: true, message: "Tracking updated", data: orders[idx] };
                }
                return { success: false, message: "Order not found", data: null };
            }

            case "getCoupons":
                return { success: true, message: "OK", data: this._localCoupons() };

            case "addCoupon": {
                const list = this._localCoupons();
                const code = String(data.code || "").toUpperCase().trim();
                if (!code) return { success: false, message: "Code required", data: null };
                if (list.some(c => c.code === code)) return { success: false, message: "Code exists", data: null };
                const coupon = {
                    code,
                    type: data.type || "percent",
                    value: Number(data.value) || 0,
                    min_order: Number(data.min_order) || 0,
                    max_uses: Number(data.max_uses) || 0,
                    used: 0,
                    status: data.status || "active",
                    expires: data.expires || ""
                };
                list.push(coupon);
                localStorage.setItem("ptv_coupons", JSON.stringify(list));
                return { success: true, message: "Coupon added", data: coupon };
            }

            case "deleteCoupon": {
                const list = this._localCoupons().filter(c => c.code !== String(data.code || "").toUpperCase());
                localStorage.setItem("ptv_coupons", JSON.stringify(list));
                return { success: true, message: "Deleted", data: null };
            }

            case "validateCoupon": {
                const code = String(data.code || "").toUpperCase().trim();
                const amount = Number(data.amount) || 0;
                const c = this._localCoupons().find(x => x.code === code && x.status === "active");
                if (!c) return { success: false, message: "Invalid coupon", data: null };
                if (c.expires && new Date(c.expires) < new Date()) return { success: false, message: "Coupon expired", data: null };
                if (c.min_order && amount < c.min_order) return { success: false, message: "Min order ₹" + c.min_order, data: null };
                if (c.max_uses && c.used >= c.max_uses) return { success: false, message: "Coupon limit reached", data: null };
                let discount = c.type === "fixed" ? c.value : Math.round(amount * c.value / 100);
                discount = Math.min(discount, amount);
                return { success: true, message: "OK", data: { code: c.code, discount, type: c.type, value: c.value } };
            }

            case "getReports": {
                const orders = JSON.parse(localStorage.getItem("ptv_demo_orders") || "[]");
                const prods = this._localProducts();
                const byDay = {};
                const byStatus = {};
                let sales = 0;
                orders.forEach(o => {
                    const day = (o.created_at || "").slice(0, 10) || "unknown";
                    byDay[day] = (byDay[day] || 0) + (Number(o.total) || 0);
                    byStatus[o.order_status || "Unknown"] = (byStatus[o.order_status || "Unknown"] || 0) + 1;
                    sales += Number(o.total) || 0;
                });
                return {
                    success: true,
                    message: "OK",
                    data: {
                        total_sales: sales,
                        total_orders: orders.length,
                        avg_order: orders.length ? Math.round(sales / orders.length) : 0,
                        by_day: byDay,
                        by_status: byStatus,
                        top_products: prods.slice(0, 5).map(p => ({ name: p.name, stock: p.stock, price: p.selling_price })),
                        low_stock: prods.filter(p => p.stock > 0 && p.stock <= (p.minimum_stock || 5)),
                        out_of_stock: prods.filter(p => p.stock <= 0)
                    }
                };
            }

            case "getCustomers":
                return { success: true, message: "OK", data: this._localCustomers() };

            case "addCategory": {
                const cats = this._localCategories();
                const cat = {
                    category_id: data.category_id || ("cat-" + Date.now()),
                    name: data.name,
                    image_url: data.image_url || "",
                    status: data.status || "active"
                };
                cats.push(cat);
                localStorage.setItem("ptv_categories", JSON.stringify(cats));
                this.clearCache();
                return { success: true, message: "Category added", data: cat };
            }

            case "updateCategory": {
                const cats = this._localCategories();
                const i = cats.findIndex(c => c.category_id === data.category_id);
                if (i < 0) return { success: false, message: "Not found", data: null };
                cats[i] = { ...cats[i], ...data };
                localStorage.setItem("ptv_categories", JSON.stringify(cats));
                this.clearCache();
                return { success: true, message: "Updated", data: cats[i] };
            }

            case "deleteCategory": {
                let cats = this._localCategories().filter(c => c.category_id !== data.category_id);
                localStorage.setItem("ptv_categories", JSON.stringify(cats));
                this.clearCache();
                return { success: true, message: "Deleted", data: null };
            }

            case "createPaymentOrder":
                return {
                    success: true,
                    message: "Demo payment order created",
                    data: { razorpay_order_id: "order_demo_" + Date.now(), amount: data.amount }
                };

            case "verifyPayment":
                return { success: true, message: "Payment verified (demo)", data: { verified: true } };

            default:
                return { success: false, message: "Unknown action: " + action, data: null };
        }
    },

    /** Local product store (used until Google Sheets is connected) */
    _localProducts() {
        try {
            const raw = localStorage.getItem("ptv_products");
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        if (CONFIG.DEMO_MODE && typeof DEMO_PRODUCTS !== "undefined") {
            const seed = JSON.parse(JSON.stringify(DEMO_PRODUCTS));
            localStorage.setItem("ptv_products", JSON.stringify(seed));
            return seed;
        }
        return [];
    },

    _saveLocalProducts(list) {
        localStorage.setItem("ptv_products", JSON.stringify(list));
        this.clearCache();
    },

    _localCoupons() {
        try {
            const raw = localStorage.getItem("ptv_coupons");
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        if (CONFIG.DEMO_MODE) {
            const seed = [
                { code: "WELCOME10", type: "percent", value: 10, min_order: 199, max_uses: 100, used: 0, status: "active", expires: "" }
            ];
            localStorage.setItem("ptv_coupons", JSON.stringify(seed));
            return seed;
        }
        return [];
    },

    _localCategories() {
        try {
            const raw = localStorage.getItem("ptv_categories");
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        if (CONFIG.DEMO_MODE && typeof DEMO_CATEGORIES !== "undefined") {
            const seed = JSON.parse(JSON.stringify(DEMO_CATEGORIES));
            localStorage.setItem("ptv_categories", JSON.stringify(seed));
            return seed;
        }
        return [];
    },

    /** Merge Users sheet + unique customers from orders */
    _localCustomers() {
        let users = [];
        try {
            users = JSON.parse(localStorage.getItem("ptv_users") || "[]");
        } catch (e) {}
        const orders = JSON.parse(localStorage.getItem("ptv_demo_orders") || "[]");
        const map = {};
        users.forEach(u => {
            if (u.email) map[u.email.toLowerCase()] = u;
        });
        orders.forEach(o => {
            const key = (o.email || o.phone || "").toLowerCase();
            if (!key) return;
            if (!map[key]) {
                map[key] = {
                    user_id: "ORD-" + (o.order_id || Date.now()),
                    name: o.name || "—",
                    email: o.email || "",
                    phone: o.phone || "",
                    created_at: o.created_at || "",
                    total_orders: 0,
                    total_spend: 0
                };
            }
            map[key].total_orders = (map[key].total_orders || 0) + 1;
            map[key].total_spend = (map[key].total_spend || 0) + (Number(o.total) || 0);
            if (o.name) map[key].name = o.name;
            if (o.phone) map[key].phone = o.phone;
        });
        return Object.values(map);
    }
};
