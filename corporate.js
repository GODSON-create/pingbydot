(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const menu = $("#menu-toggle");
  const mobile = $("#mobile-nav");
  if (menu && mobile) {
    menu.addEventListener("click", () => {
      const open = mobile.classList.toggle("open");
      menu.setAttribute("aria-expanded", String(open));
      menu.textContent = open ? "Close" : "Menu";
    });
    mobile.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
      mobile.classList.remove("open"); menu.setAttribute("aria-expanded","false"); menu.textContent="Menu";
    }));
  }
  const year = $("#current-year"); if (year) year.textContent = new Date().getFullYear();
  const reveal = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add("visible"); reveal.unobserve(entry.target); }
  }), {threshold:.08});
  document.querySelectorAll("[data-reveal]").forEach(el => reveal.observe(el));
})();