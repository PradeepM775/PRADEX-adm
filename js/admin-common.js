/**
 * Admin shared helpers – sidebar toggle, logout
 */
function adminLogout() {
    if (typeof Auth !== "undefined") Auth.adminLogout();
    location.href = "login.html";
}

function toggleAdminSidebar() {
    document.getElementById("sidebar")?.classList.toggle("open");
}

document.addEventListener("DOMContentLoaded", () => {
    // Close sidebar on nav click (mobile)
    document.querySelectorAll(".admin-nav a").forEach(a => {
        a.addEventListener("click", () => {
            if (window.innerWidth <= 900) {
                document.getElementById("sidebar")?.classList.remove("open");
            }
        });
    });
});
