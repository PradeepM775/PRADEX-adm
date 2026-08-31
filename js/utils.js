/**
 * Pradeep Tech Verse - Utilities
 */
const Utils = {
    formatPrice(amount) {
        return CONFIG.CURRENCY_SYMBOL + Number(amount).toLocaleString("en-IN");
    },

    discountPercent(original, selling) {
        if (!original || original <= selling) return 0;
        return Math.round(((original - selling) / original) * 100);
    },

    stockLabel(stock, min = 5) {
        if (stock <= 0) return { text: "Out of Stock", class: "out-of-stock" };
        if (stock <= min) return { text: "Low Stock", class: "low-stock" };
        return { text: "In Stock", class: "in-stock" };
    },

    qs(sel, ctx = document) {
        return ctx.querySelector(sel);
    },

    qsa(sel, ctx = document) {
        return [...ctx.querySelectorAll(sel)];
    },

    getParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    },

    toast(message, type = "info") {
        let container = document.getElementById("toast-container");
        if (!container) {
            container = document.createElement("div");
            container.id = "toast-container";
            document.body.appendChild(container);
        }
        const el = document.createElement("div");
        el.className = `toast toast-${type}`;
        el.innerHTML = `<span>${message}</span>`;
        container.appendChild(el);
        requestAnimationFrame(() => el.classList.add("show"));
        setTimeout(() => {
            el.classList.remove("show");
            setTimeout(() => el.remove(), 300);
        }, 3200);
    },

    showLoader(target) {
        if (!target) return;
        target.innerHTML = `<div class="loader-wrap"><div class="spinner"></div><p>Loading...</p></div>`;
    },

    skeletonCards(count = 4) {
        return Array(count).fill(0).map(() => `
            <div class="product-card skeleton">
                <div class="skeleton-img"></div>
                <div class="skeleton-line"></div>
                <div class="skeleton-line short"></div>
            </div>
        `).join("");
    },

    debounce(fn, delay = 300) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), delay);
        };
    },

    /**
     * Convert any Google Drive link / file id into an <img>-friendly URL.
     * uc?export=view often fails in browsers — prefer thumbnail + lh3.
     */
    imageUrl(url, size = 800) {
        if (!url || typeof url !== "string") return "";
        const u = url.trim();
        if (!u) return "";
        // Already data URL or normal https image
        if (u.startsWith("data:")) return u;
        if (u.includes("googleusercontent.com") || u.includes("thumbnail?id=")) return u;
        // Extract Drive file ID from common URL shapes
        let id = null;
        let m = u.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
        if (m) id = m[1];
        if (!id) {
            m = u.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
            if (m) id = m[1];
        }
        if (!id && /^[a-zA-Z0-9_-]{25,}$/.test(u)) id = u;
        if (id) {
            // thumbnail works reliably for public "Anyone with link" files
            return "https://drive.google.com/thumbnail?id=" + id + "&sz=w" + size;
        }
        // Non-Drive URL — use as-is
        if (u.startsWith("http")) return u;
        return u;
    },

    /** Placeholder when image fails to load */
    placeholderImage(text) {
        const t = encodeURIComponent((text || "Product").slice(0, 18));
        return "https://placehold.co/400x400/1a1a2e/00d4ff?text=" + t;
    }
};


/**
 * Compress image file for upload (max edge 1200px, JPEG ~0.75 quality).
 * Returns Promise<dataURL string>
 */
Utils.compressImage = function(file, maxEdge = 1200, quality = 0.75) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type || !file.type.startsWith("image/")) {
            reject(new Error("Not an image"));
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Read failed"));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error("Image load failed"));
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > maxEdge || h > maxEdge) {
                    if (w > h) { h = Math.round(h * maxEdge / w); w = maxEdge; }
                    else { w = Math.round(w * maxEdge / h); h = maxEdge; }
                }
                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, w, h);
                const mime = "image/jpeg";
                resolve(canvas.toDataURL(mime, quality));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
};
