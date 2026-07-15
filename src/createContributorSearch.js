// Renders a search input + dropdown into the given mount element to select a
// contributor.

import { placeDropdown } from "./dropdownPlacement.js";

export function createContributorSearch(mount, Visual, rawContributions) {
  // Build deduplicated contributor index from all raw contributions
  const seen = new Map();
  rawContributions.forEach((row) => {
    if (!seen.has(row.contributor_id)) {
      seen.set(row.contributor_id, row.contributor_name);
    }
  });
  const contributors = Array.from(seen, ([id, name]) => ({ id, name })).sort(
    (a, b) => a.name.localeCompare(b.name),
  );

  const wrapper = document.createElement("div");
  wrapper.className = "ca-search-wrapper";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "ca-search-input";
  input.placeholder = "Search contributor…";
  input.autocomplete = "off";
  input.spellcheck = false;

  const clearBtn = document.createElement("button");
  clearBtn.className = "ca-search-clear";
  clearBtn.type = "button";
  clearBtn.title = "Clear";
  clearBtn.textContent = "×";

  const dropdown = document.createElement("div");
  dropdown.className = "ca-search-dropdown";
  dropdown.setAttribute("role", "listbox");

  wrapper.appendChild(input);
  wrapper.appendChild(clearBtn);
  wrapper.appendChild(dropdown);

  mount.appendChild(wrapper);

  const STORAGE_KEY = "selected-contributor";

  let selectedId = null;
  let isOpen = false;
  let activeIndex = -1; // keyboard-highlighted row index (-1 is none)

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlight(text, query) {
    if (!query) return document.createTextNode(text);
    const re = new RegExp("(" + escapeRegex(query) + ")", "gi");
    const fragment = document.createDocumentFragment();
    text.split(re).forEach((matchedPart, i) => {
      // as we're using split() with a regex with a capture group
      // i=0 is part before match; i=1 is match;  i=2 is part after match
      if (matchedPart === "") return;
      if (i % 2 === 1) {
        const mark = document.createElement("mark");
        mark.textContent = matchedPart;
        fragment.appendChild(mark);
      } else {
        fragment.appendChild(document.createTextNode(matchedPart));
      }
    });
    return fragment;
  }

  function getItems() {
    return Array.from(dropdown.querySelectorAll(".ca-search-dropdown-item"));
  }

  function resetActive() {
    activeIndex = -1;
    getItems().forEach((el) => {
      el.classList.remove("ca-is-active");
    });
  }

  function setActiveIndex(idx) {
    const items = getItems();
    if (items.length === 0) {
      activeIndex = -1;
      return;
    }
    activeIndex = ((idx % items.length) + items.length) % items.length;
    items.forEach((item, i) => {
      item.classList.toggle("ca-is-active", i === activeIndex);
    });
    items[activeIndex].scrollIntoView({ block: "nearest" });
  }

  function openDropdown() {
    dropdown.classList.add("ca-is-open");
    placeDropdown(dropdown);
    isOpen = true;
    document.addEventListener("click", onOutsideClick);
  }

  function closeDropdown() {
    dropdown.classList.remove("ca-is-open");
    isOpen = false;
    resetActive();
    document.removeEventListener("click", onOutsideClick);
  }

  function onOutsideClick(e) {
    if (!wrapper.contains(e.target)) {
      closeDropdown();
    }
  }

  function updateClearBtn() {
    clearBtn.style.display = input.value ? "block" : "none";
  }

  function restoreContributor() {
    const storedId = localStorage.getItem(STORAGE_KEY);
    if (storedId) {
      const match = contributors.find((c) => c.id === storedId);
      if (match) {
        selectContributor(match.id, match.name);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }

  function unselectContributor() {
    selectedId = null;
    input.value = "";
    wrapper.classList.remove("ca-has-selection");
    updateClearBtn();
    closeDropdown();
    localStorage.removeItem(STORAGE_KEY);
    Visual.selectContributor(null);
    input.focus();
  }

  function selectContributor(id, name) {
    selectedId = id;
    input.value = name || "";
    wrapper.classList.toggle("ca-has-selection", !!id);
    updateClearBtn();
    closeDropdown();
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    Visual.selectContributor(id);
  }

  function renderResults(query) {
    dropdown.innerHTML = "";
    resetActive();
    if (!query) {
      closeDropdown();
      return;
    }

    const q = query.toLowerCase();
    const matches = contributors.filter(
      (c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
    );

    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ca-search-no-results";
      empty.textContent = "No contributors found";
      dropdown.appendChild(empty);
      openDropdown();
      return;
    }

    matches.slice(0, 100).forEach((c) => {
      const item = document.createElement("button");
      item.className = "ca-search-dropdown-item";
      item.setAttribute("role", "option");
      item.dataset.id = c.id;
      if (c.id === selectedId) item.classList.add("ca-is-selected");
      item.appendChild(highlight(c.name, query));
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        selectContributor(c.id, c.name);
      });
      dropdown.appendChild(item);
    });

    openDropdown();
  }

  input.addEventListener("input", () => {
    updateClearBtn();
    renderResults(input.value.trim());
  });

  input.addEventListener("focus", () => {
    if (input.value.trim()) renderResults(input.value.trim());
  });

  input.addEventListener("keydown", (e) => {
    const items = getItems();

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen && input.value.trim()) renderResults(input.value.trim());
      setActiveIndex(activeIndex < 0 ? 0 : activeIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen && input.value.trim()) renderResults(input.value.trim());
      setActiveIndex(activeIndex < 0 ? items.length - 1 : activeIndex - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) {
        items[activeIndex].click();
      }
    }
  });

  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    unselectContributor();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) closeDropdown();
  });

  restoreContributor();
}
