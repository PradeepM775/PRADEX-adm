/**
 * Admin shared helpers – sidebar, logout, nav highlight
 */
function adminLogout() {
    if (typeof Auth !== "undefined") Auth.adminLogout();
    location.href = "login.html";
}

function toggleAdminSidebar() {
    document.getElementById("sidebar")?.classList.toggle("open");
}

/** Optional: mark active nav link by filename */
function highlightAdminNav() {
    const page = (location.pathname.split("/").pop() || "dashboard.html").toLowerCase();
    document.querySelectorAll(".admin-nav a").forEach(a => {
        const href = (a.getAttribute("href") || "").toLowerCase();
        if (href && href !== "#" && page === href) a.classList.add("active");
        else if (href && href !== "#") a.classList.remove("active");
    });
}

document.addEventListener("DOMContentLoaded", () => {
    highlightAdminNav();
    document.querySelectorAll(".admin-nav a").forEach(a => {
        a.addEventListener("click", () => {
            if (window.innerWidth <= 900) {
                document.getElementById("sidebar")?.classList.remove("open");
            }
        });
    });
});

/** Safe CSV download */
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
