(function () {
  var STORAGE_KEY = "theme";
  var ICONS = { system: "◑", light: "☀", dark: "☾" };
  var LABELS = { system: "Auto", light: "Light", dark: "Dark" };
  var ORDER = ["light", "dark", "system"];

  function getTheme() {
    return localStorage.getItem(STORAGE_KEY) || "system";
  }

  function applyTheme(theme) {
    if (theme === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
    localStorage.setItem(STORAGE_KEY, theme);
    window.dispatchEvent(new CustomEvent("themechange", { detail: theme }));
  }

  // Apply immediately so canvases read correct CSS vars from first paint.
  applyTheme(getTheme());

  document.addEventListener("DOMContentLoaded", function () {
    var nav = document.querySelector("nav");
    if (!nav) return;

    var wrapper = document.createElement("div");
    wrapper.className = "theme-wrapper";

    var btn = document.createElement("button");
    btn.id = "theme-btn";
    btn.className = "theme-btn";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");

    var menu = document.createElement("div");
    menu.className = "theme-menu";
    menu.setAttribute("role", "menu");

    var items = ORDER.map(function (t) {
      var item = document.createElement("button");
      item.className = "theme-menu-item";
      item.setAttribute("role", "menuitem");
      item.dataset.value = t;
      var icon = document.createElement("span");
      icon.className = "theme-menu-icon";
      icon.textContent = ICONS[t];
      item.appendChild(icon);
      item.appendChild(document.createTextNode(LABELS[t]));
      item.addEventListener("click", function (e) {
        e.stopPropagation();
        applyTheme(t);
        refresh();
        closeMenu();
      });
      menu.appendChild(item);
      return item;
    });

    function refresh() {
      var t = getTheme();
      btn.textContent = ICONS[t];
      btn.dataset.theme = t;
      items.forEach(function (item) {
        item.classList.toggle(
          "theme-menu-item--active",
          item.dataset.value === t,
        );
      });
    }

    function openMenu() {
      menu.classList.add("is-open");
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("click", closeMenu);
    }

    function closeMenu() {
      menu.classList.remove("is-open");
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", closeMenu);
    }

    btn.title = "Theme";
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menu.classList.contains("is-open")) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });

    refresh();

    wrapper.appendChild(btn);
    wrapper.appendChild(menu);
    nav.insertBefore(wrapper, nav.firstChild);
  });
})();
