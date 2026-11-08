(() => {
      "use strict";
      const API = "https://en.wikipedia.org/w/api.php";
      const $ = (id) => document.getElementById(id);
      const srcInput = $("srcInput"), dstInput = $("dstInput");
      const state = {
        target: "", current: "", hops: 0,
        active: false, won: false, visited: [], requestId: 0,
        suggestions: { src: [], dst: [] }, selected: { src: -1, dst: -1 },
        searchTimers: {}, searchControllers: {}, searchCache: new Map()
      };

      function apiUrl(params) {
        const url = new URL(API);
        Object.entries({ ...params, format: "json", origin: "*" }).forEach(([k, v]) => url.searchParams.set(k, v));
        return url.toString();
      }
      async function api(params, signal) {
        const response = await fetch(apiUrl(params), { signal });
        if (!response.ok) throw new Error(`Wikipedia returned ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error.info || "Wikipedia API error");
        return data;
      }
      function cleanTitle(title) {
        return decodeURIComponent(String(title || "").replace(/_/g, " ")).trim();
      }
      function titleKey(title) {
        return cleanTitle(title).replace(/ /g, "_").toLocaleLowerCase();
      }
      function wikiUrl(title) {
        return "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
      }
      async function randomArticle() {
        const data = await api({ action: "query", list: "random", rnnamespace: 0, rnlimit: 1 });
        return data.query.random[0].title;
      }
      async function fillRandom(which) {
        const input = which === "src" ? srcInput : dstInput;
        const button = which === "src" ? $("randomSrc") : $("randomDst");
        button.disabled = true;
        button.textContent = "…";
        try {
          input.value = await randomArticle();
          hideSuggestions(which);
        } catch (error) {
          $("setupError").textContent = "Couldn't get a random page. Please try again.";
        } finally {
          button.disabled = false;
          button.textContent = "↻";
        }
      }

      function hideSuggestions(which) {
        $(`${which}Suggestions`).classList.remove("open");
        state.suggestions[which] = [];
        state.selected[which] = -1;
      }
      function showSuggestions(which, results) {
        const box = $(`${which}Suggestions`);
        state.suggestions[which] = results;
        state.selected[which] = -1;
        box.replaceChildren();
        if (!results.length) { box.classList.remove("open"); return; }
        results.forEach((item, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "suggestion";
          button.setAttribute("role", "option");
          const title = document.createElement("span");
          title.textContent = item.title;
          button.append(title);
          if (item.description) {
            const desc = document.createElement("small");
            desc.textContent = item.description;
            button.append(desc);
          }
          button.addEventListener("mousedown", (event) => event.preventDefault());
          button.addEventListener("click", () => {
            (which === "src" ? srcInput : dstInput).value = item.title;
            hideSuggestions(which);
          });
          box.append(button);
        });
        box.classList.add("open");
      }
      async function searchPages(which, query) {
        const key = query.trim().toLocaleLowerCase();
        if (key.length < 2) { hideSuggestions(which); return; }
        const cached = state.searchCache.get(key);
        if (cached) { showSuggestions(which, cached); return; }
        const controller = new AbortController();
        state.searchControllers[which] = controller;
        try {
          const data = await api({
            action: "query", generator: "search", gsrsearch: query,
            gsrnamespace: 0, gsrlimit: 8,
            prop: "pageprops", ppprop: "disambiguation|wikibase-shortdesc"
          }, controller.signal);
          const results = Object.values(data.query.pages || {})
            .sort((a, b) => a.index - b.index)
            .filter(page => !Object.prototype.hasOwnProperty.call(page.pageprops || {}, "disambiguation"))
            .map(page => ({
              title: page.title,
              description: page.pageprops?.["wikibase-shortdesc"] || ""
            }));
          if ((which === "src" ? srcInput : dstInput).value.trim() !== query.trim()) return;
          if (state.searchCache.size === 40) state.searchCache.delete(state.searchCache.keys().next().value);
          state.searchCache.set(key, results);
          showSuggestions(which, results);
        } catch (error) { if (error.name !== "AbortError") hideSuggestions(which); }
      }
      function bindAutocomplete(which, input) {
        input.addEventListener("input", () => {
          state.searchControllers[which]?.abort();
          clearTimeout(state.searchTimers[which]);
          const query = input.value;
          state.searchTimers[which] = setTimeout(() => searchPages(which, query), 120);
        });
        input.addEventListener("keydown", (event) => {
          const list = state.suggestions[which];
          if (!list.length) {
            if (event.key === "Enter") { event.preventDefault(); hideSuggestions(which); }
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const delta = event.key === "ArrowDown" ? 1 : -1;
            state.selected[which] = (state.selected[which] + delta + list.length) % list.length;
            [...$(`${which}Suggestions`).children].forEach((el, i) => el.classList.toggle("active", i === state.selected[which]));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const index = state.selected[which] < 0 ? 0 : state.selected[which];
            input.value = list[index].title;
            hideSuggestions(which);
          } else if (event.key === "Escape") hideSuggestions(which);
        });
        input.addEventListener("blur", () => setTimeout(() => hideSuggestions(which), 130));
      }

      async function resolveTitle(raw) {
        const title = raw.trim();
        if (!title) throw new Error("Please choose both a starting page and a destination.");
        const page = await resolveArticle(title);
        if (page.namespace !== 0) throw new Error("Please choose an article from Wikipedia's main namespace.");
        if (page.isDisambiguation) {
          throw new Error(`"${page.title}" is a disambiguation page. Please choose a specific article.`);
        }
        return page.title;
      }
      async function resolveArticle(raw) {
        const data = await api({
          action: "query", titles: raw, redirects: 1,
          prop: "pageprops", ppprop: "disambiguation"
        });
        const page = Object.values(data.query.pages)[0];
        if (!page || page.missing !== undefined) throw new Error(`Couldn't find the Wikipedia page "${raw}".`);
        return {
          title: page.title,
          namespace: page.ns,
          isDisambiguation: Object.prototype.hasOwnProperty.call(page.pageprops || {}, "disambiguation")
        };
      }

      function setLoading(message) {
        $("articleBody").innerHTML = `<div class="loading"><div class="spinner"></div>${message}</div>`;
      }
      function absoluteWikiAsset(value) {
        if (!value) return value;
        const trimmed = value.trim();
        if (/^(data:|blob:|https?:)/i.test(trimmed)) return trimmed;
        try { return new URL(trimmed, "https://en.wikipedia.org/").href; }
        catch (_) { return trimmed; }
      }
      function normalizeSrcset(value) {
        if (!value) return value;
        return value.split(",").map(candidate => {
          const parts = candidate.trim().split(/\s+/);
          if (!parts[0]) return "";
          parts[0] = absoluteWikiAsset(parts[0]);
          return parts.join(" ");
        }).filter(Boolean).join(", ");
      }
      function sanitizeAndPrepare(html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        // Keep <source> elements: Wikipedia can use them inside <picture> for responsive images.
        doc.querySelectorAll("script, style, link, meta, iframe, frame, object, embed, form, input, button, textarea, select, audio, video, track").forEach(el => el.remove());
        doc.querySelectorAll("*").forEach(el => {
          [...el.attributes].forEach(attr => {
            const name = attr.name.toLowerCase();
            if (name.startsWith("on") || name === "srcdoc" || (["href","src","xlink:href","poster"].includes(name) && /^\s*javascript:/i.test(attr.value))) {
              el.removeAttribute(attr.name);
            }
          });
        });
        // Article-internal links are routed through the game. Non-article links open normally.
        doc.querySelectorAll("a[href]").forEach(a => {
          const href = a.getAttribute("href");
          if (!href) return;
          if (href.startsWith("/wiki/")) {
            const raw = href.slice(6).split("#")[0];
            let title = raw;
            try { title = decodeURIComponent(raw).replace(/_/g, " "); } catch (_) {}
            if (!title.includes(":")) {
              a.dataset.wikiTitle = title;
              a.href = "#";
              a.removeAttribute("target");
              a.removeAttribute("rel");
            } else {
              a.href = "https://en.wikipedia.org" + href;
              a.target = "_blank"; a.rel = "noopener noreferrer";
            }
          } else if (href.startsWith("#")) {
            a.href = href;
          } else if (/^https?:\/\//i.test(href)) {
            a.target = "_blank"; a.rel = "noopener noreferrer";
          } else {
            a.removeAttribute("href");
          }
        });
        // The parser may provide responsive or lazy-loaded image attributes. Resolve every
        // candidate against en.wikipedia.org, and promote lazy URLs to real src/srcset values.
        doc.querySelectorAll("img").forEach(img => {
          const lazySrc = img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-original");
          const currentSrc = img.getAttribute("src");
          const isPlaceholder = !currentSrc || /^(data:image\/(?:gif|svg\+xml)|about:blank)/i.test(currentSrc) || /1x1\.png/i.test(currentSrc);
          if (lazySrc && isPlaceholder) img.setAttribute("src", lazySrc);
          const lazySrcset = img.getAttribute("data-srcset") || img.getAttribute("data-lazy-srcset");
          if (lazySrcset && !img.hasAttribute("srcset")) img.setAttribute("srcset", lazySrcset);
          img.loading = "lazy";
          img.decoding = "async";
        });
        doc.querySelectorAll("[src], [srcset]").forEach(el => {
          if (el.hasAttribute("src")) el.setAttribute("src", absoluteWikiAsset(el.getAttribute("src")));
          if (el.hasAttribute("srcset")) el.setAttribute("srcset", normalizeSrcset(el.getAttribute("srcset")));
        });
        return doc.body;
      }

      async function loadArticle(title, isHop) {
        const request = ++state.requestId;
        $("readerMessage").textContent = "Loading " + title + "…";
        try {
          const resolved = await resolveArticle(title);
          if (request !== state.requestId) return;
          if (resolved.isDisambiguation) {
            $("readerMessage").textContent = `"${resolved.title}" is a disambiguation page. Choose a specific article link; no hop was counted.`;
            if (!isHop) throw new Error("Choose a specific article instead of a disambiguation page.");
            return;
          }
          if (!state.current) setLoading("Loading " + resolved.title + "…");
          const data = await api({
            action: "parse", page: resolved.title, prop: "text",
            disableeditsection: 1, disabletoc: 0, formatversion: 2
          });
          if (request !== state.requestId) return;
          const canonical = data.parse.title;
          state.current = canonical;
          if (isHop) {
            state.hops += 1;
            if (!state.visited.some(item => titleKey(item) === titleKey(canonical))) state.visited.push(canonical);
          }
          $("hopCount").textContent = state.hops;
          $("articleTitle").textContent = canonical;
          $("readerMessage").textContent = "";
          $("sourceLink").href = wikiUrl(canonical);
          $("articleBody").replaceChildren(...Array.from(sanitizeAndPrepare(data.parse.text).childNodes));
          renderHistory();
          if (titleKey(canonical) === titleKey(state.target)) winGame();
          $("articleBody").scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (error) {
          if (request !== state.requestId) return;
          if (isHop && state.current) {
            $("readerMessage").textContent = `Couldn't load "${title}"; no hop was counted. Please try another link.`;
            return;
          }
          $("articleBody").innerHTML = `<div class="loading">Couldn't load this article.<br><small>${escapeHtml(error.message)}</small><br><br><button class="secondary" id="retryBtn">Try again</button></div>`;
          $("retryBtn").addEventListener("click", () => loadArticle(title, false));
        }
      }
      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]);
      }
      function renderHistory() {
        const box = $("routeHistory");
        box.replaceChildren();
        const label = document.createElement("span");
        label.textContent = "ROUTE";
        box.append(label);
        state.visited.forEach((title, index) => {
          const arrow = document.createElement("span");
          arrow.className = "arrow"; arrow.textContent = index ? "→" : " ";
          const chip = document.createElement("span");
          chip.className = "chip" + (index === state.visited.length - 1 ? " current" : "");
          chip.textContent = title;
          box.append(arrow, chip);
        });
      }
      function winGame() {
        state.won = true;
        $("winBanner").classList.add("visible");
        $("winText").textContent = `You reached ${state.target} in ${state.hops} ${state.hops === 1 ? "hop" : "hops"}.`;
        $("articleBody").querySelectorAll("a[data-wiki-title]").forEach(a => {
          a.removeAttribute("data-wiki-title");
          a.href = wikiUrl(a.textContent.trim() || state.target);
          a.target = "_blank"; a.rel = "noopener noreferrer";
        });
      }
      async function startGame() {
        $("setupError").textContent = "";
        $("startBtn").disabled = true;
        $("startBtn").textContent = "SETTING UP…";
        try {
          const [source, target] = await Promise.all([resolveTitle(srcInput.value), resolveTitle(dstInput.value)]);
          if (titleKey(source) === titleKey(target)) throw new Error("Choose two different articles — the journey needs somewhere to go!");
          state.target = target; state.current = "";
          state.hops = 0; state.won = false; state.visited = [source]; state.active = true;
          $("setup").style.display = "none";
          $("gamebar").classList.add("visible");
          $("readerWrap").classList.add("visible");
          $("winBanner").classList.remove("visible");
          $("targetName").textContent = target;
          $("hopCount").textContent = "0";
          loadArticle(source, false);
        } catch (error) {
          $("setupError").textContent = error.message || "Something went wrong. Please try again.";
        } finally {
          $("startBtn").disabled = false;
          $("startBtn").textContent = "START";
        }
      }
      function newGame() {
        state.active = false; state.won = false; state.requestId++;
        $("setup").style.display = "";
        $("gamebar").classList.remove("visible");
        $("readerWrap").classList.remove("visible");
        $("winBanner").classList.remove("visible");
        $("setupError").textContent = "";
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      $("randomSrc").addEventListener("click", () => fillRandom("src"));
      $("randomDst").addEventListener("click", () => fillRandom("dst"));
      $("startBtn").addEventListener("click", startGame);
      $("restartBtn").addEventListener("click", newGame);
      bindAutocomplete("src", srcInput);
      bindAutocomplete("dst", dstInput);

      $("articleBody").addEventListener("click", event => {
        const anchor = event.target.closest("a[data-wiki-title]");
        if (!anchor || !state.active || state.won) return;
        event.preventDefault();
        const nextTitle = anchor.dataset.wikiTitle;
        if (!nextTitle || titleKey(nextTitle) === titleKey(state.current)) return;
        loadArticle(nextTitle, true);
      });

      // Start with two independently randomized main-namespace articles.
      Promise.all([randomArticle(), randomArticle()]).then(([source, target]) => {
        srcInput.value = source;
        dstInput.value = titleKey(source) === titleKey(target) ? "Spaghetti Western" : target;
      }).catch(() => {
        srcInput.value = "Abraham Lincoln";
        dstInput.value = "Spaghetti Western";
      });
    })();
