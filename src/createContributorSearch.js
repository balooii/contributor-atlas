// Injects a search input + dropdown into the <nav> to select a contributor.

export function createContributorSearch(nav, Visual, rawContributions) {
  // Build deduplicated contributor index from all raw contributions
  const seen = new Map();
  rawContributions.forEach(function (row) {
    if (!seen.has(row.contributor_id)) {
      seen.set(row.contributor_id, row.contributor_name);
    }
  });
  const contributors = Array.from(seen, function ([id, name]) {
    return { id: id, name: name };
  }).sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });

  // -- DOM --------------------------------------------------
  var wrapper = document.createElement("div");
  wrapper.className = "search-wrapper";

  var input = document.createElement("input");
  input.type = "search";
  input.className = "search-input";
  input.placeholder = "Search contributor…";
  input.autocomplete = "off";
  input.spellcheck = false;

  var clearBtn = document.createElement("button");
  clearBtn.className = "search-clear";
  clearBtn.type = "button";
  clearBtn.title = "Clear";
  clearBtn.textContent = "×";

  var dropdown = document.createElement("div");
  dropdown.className = "search-dropdown";
  dropdown.setAttribute("role", "listbox");

  wrapper.appendChild(input);
  wrapper.appendChild(clearBtn);
  wrapper.appendChild(dropdown);

  var themeWrapper = nav.querySelector(".theme-wrapper");
  if (themeWrapper && themeWrapper.nextSibling) {
    nav.insertBefore(wrapper, themeWrapper.nextSibling);
  } else {
    nav.insertBefore(wrapper, nav.firstChild);
  }

  var STORAGE_KEY = "selected-contributor";

  // -- State ----------------------------------------------------
  var selectedId = null;
  var isOpen = false;
  var activeIndex = -1; // keyboard-highlighted row index (-1 is none)

  // -- Helpers --------------------------------------------------
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlight(text, query) {
    if (!query) return document.createTextNode(text);
    var re = new RegExp("(" + escapeRegex(query) + ")", "gi");
    var fragment = document.createDocumentFragment();
    text.split(re).forEach(function (matchedPart, i) {
      // as we're using split() with a regex with a capture group
      // i=0 is part before match; i=1 is match;  i=2 is part after match
      if (matchedPart === "") return;
      if (i % 2 === 1) {
        var mark = document.createElement("mark");
        mark.textContent = matchedPart;
        fragment.appendChild(mark);
      } else {
        fragment.appendChild(document.createTextNode(matchedPart));
      }
    });
    return fragment;
  }

  function getItems() {
    return Array.from(dropdown.querySelectorAll(".search-dropdown-item"));
  }

  function resetActive() {
    activeIndex = -1;
    getItems().forEach(function (el) {
      el.classList.remove("is-active");
    });
  }

  function setActiveIndex(idx) {
    var items = getItems();
    if (items.length === 0) {
      activeIndex = -1;
      return;
    }
    activeIndex = ((idx % items.length) + items.length) % items.length;
    items.forEach(function (item, i) {
      item.classList.toggle("is-active", i === activeIndex);
    });
    items[activeIndex].scrollIntoView({ block: "nearest" });
  }

  function openDropdown() {
    dropdown.classList.add("is-open");
    isOpen = true;
    document.addEventListener("click", onOutsideClick);
  }

  function closeDropdown() {
    dropdown.classList.remove("is-open");
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
    var storedId = localStorage.getItem(STORAGE_KEY);
    if (storedId) {
      var match = contributors.find(function (c) {
        return c.id === storedId;
      });
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
    wrapper.classList.remove("has-selection");
    updateClearBtn();
    closeDropdown();
    localStorage.removeItem(STORAGE_KEY);
    Visual.selectContributor(null);
    input.focus();
  }

  function selectContributor(id, name) {
    selectedId = id;
    input.value = name || "";
    wrapper.classList.toggle("has-selection", !!id);
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

    var q = query.toLowerCase();
    var matches = contributors.filter(function (c) {
      return c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
    });

    if (matches.length === 0) {
      var empty = document.createElement("div");
      empty.className = "search-no-results";
      empty.textContent = "No contributors found";
      dropdown.appendChild(empty);
      openDropdown();
      return;
    }

    matches.slice(0, 100).forEach(function (c) {
      var item = document.createElement("button");
      item.className = "search-dropdown-item";
      item.setAttribute("role", "option");
      item.dataset.id = c.id;
      if (c.id === selectedId) item.classList.add("is-selected");
      item.appendChild(highlight(c.name, query));
      item.addEventListener("click", function (e) {
        e.stopPropagation();
        selectContributor(c.id, c.name);
      });
      dropdown.appendChild(item);
    });

    openDropdown();
  }

  // -- Events ---------------------------------------------------
  input.addEventListener("input", function () {
    updateClearBtn();
    renderResults(input.value.trim());
  });

  input.addEventListener("focus", function () {
    if (input.value.trim()) renderResults(input.value.trim());
  });

  input.addEventListener("keydown", function (e) {
    var items = getItems();

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

  clearBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    unselectContributor();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) closeDropdown();
  });

  restoreContributor();
}
