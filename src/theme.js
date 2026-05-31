// Theme menu + reactive theme switching.
//
// The *initial* theme is applied by a tiny inline script in each page's
// <head> (before first paint) to avoid a flash of the wrong theme.
//
// Two things happen here:
//   -  OS color-scheme reactivity. Installed automatically when this module
//      loads.
//   -  The theme-picker menu. Injected into a host element only
//      when a caller explicitly asks for it via mountThemePicker()

const STORAGE_KEY = "theme";
const ICONS = { system: "◑", light: "☀", dark: "☾" };
const LABELS = { system: "Auto", light: "Light", dark: "Dark" };
const ORDER = ["light", "dark", "system"];

function getTheme() {
  return localStorage.getItem(STORAGE_KEY) || "system";
}

// Tell every mounted view the theme changed so they re-read CSS tokens and redraw
export function notifyThemeChange(theme) {
  window.dispatchEvent(new CustomEvent("themechange", { detail: theme }));
}

function applyTheme(theme) {
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  localStorage.setItem(STORAGE_KEY, theme);
  notifyThemeChange(theme);
}

// Follow prefers-color-scheme. Runs on import so no opt-in.
let watchingSystem = false;
function watchSystemTheme() {
  if (watchingSystem || typeof window === "undefined") return;
  watchingSystem = true;
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (getTheme() === "system") notifyThemeChange("system");
    });
}
watchSystemTheme();

let pickerMounted = false;

export function mountThemePicker(target = "nav") {
  if (pickerMounted) return;
  const nav =
    typeof target === "string" ? document.querySelector(target) : target;
  if (!nav) return;
  pickerMounted = true;

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
}
