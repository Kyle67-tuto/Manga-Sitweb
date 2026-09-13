// =========================================================
// V scans — app.js
// Core execution loop: auth, routing, rendering, admin CRUD
// =========================================================

import {
  auth, db, googleProvider, ADMIN_EMAIL,
  uploadImageToImgbb, uploadMultipleImagesToImgbb,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, addDoc, increment,
  signInWithPopup, signOut, onAuthStateChanged
} from "./db.js";

// ---------------------------------------------------------
// STATE
// ---------------------------------------------------------
const state = {
  user: null,          // Firebase auth user
  profile: null,       // Firestore users/{uid} doc data
  isAdmin: false,
  mangas: [],          // cached manga list with their latest chapters
  bookmarkIds: new Set(),
  activeCategory: "all",
  currentManga: null,
  currentChapters: [],
  currentChapterIndex: -1,
  chapterUnsubscribeComments: null
};

// ---------------------------------------------------------
// DOM SHORTCUTS
// ---------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------

/** Converts a Firestore Timestamp / Date / millis into a relative "x ago" string. */
function timeAgo(input) {
  if (!input) return "just now";
  const date = input.toDate ? input.toDate() : new Date(input);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  const ranges = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60]
  ];

  for (const [label, secondsInUnit] of ranges) {
    const value = Math.floor(seconds / secondsInUnit);
    if (value >= 1) return `${value} ${label}${value > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

function showToast(message, type = "info") {
  const container = $("#toastContainer");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ---------------------------------------------------------
// THEME TOGGLE (persisted in localStorage)
// ---------------------------------------------------------
function initTheme() {
  const saved = localStorage.getItem("vscans-theme");
  if (saved === "light") document.body.classList.add("light-mode");
  $("#themeToggleBtn").addEventListener("click", () => {
    document.body.classList.toggle("light-mode");
    localStorage.setItem("vscans-theme", document.body.classList.contains("light-mode") ? "light" : "dark");
  });
}

// ---------------------------------------------------------
// SIDEBAR
// ---------------------------------------------------------
function initSidebar() {
  const open = () => { $("#sidebar").classList.add("open"); $("#sidebarBackdrop").classList.add("open"); };
  const close = () => { $("#sidebar").classList.remove("open"); $("#sidebarBackdrop").classList.remove("open"); };

  $("#menuToggleBtn").addEventListener("click", open);
  $("#sidebarCloseBtn").addEventListener("click", close);
  $("#sidebarBackdrop").addEventListener("click", close);
  $$(".sidebar-link").forEach((link) => link.addEventListener("click", close));
}

// ---------------------------------------------------------
// SEARCH OVERLAY
// ---------------------------------------------------------
function initSearch() {
  const open = () => { $("#searchOverlay").classList.add("open"); $("#searchInput").focus(); };
  const close = () => $("#searchOverlay").classList.remove("open");

  $("#searchToggleBtn").addEventListener("click", open);
  $("#closeSearchBtn").addEventListener("click", close);

  $("#searchInput").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const resultsEl = $("#searchResults");
    if (!q) { resultsEl.innerHTML = ""; return; }

    const matches = state.mangas.filter((m) => m.title.toLowerCase().includes(q));
    resultsEl.innerHTML = matches.map((m) => `
      <div class="search-result-item" data-manga-id="${m.id}">
        <img src="${m.coverUrl}" alt="${escapeHtml(m.title)}">
        <div>
          <div style="font-weight:700;font-size:13.5px;">${escapeHtml(m.title)}</div>
          <div style="font-size:11px;color:var(--text-faint);">${escapeHtml(m.category)}</div>
        </div>
      </div>
    `).join("") || `<p class="empty-msg">No matches found.</p>`;

    $$(".search-result-item").forEach((item) => {
      item.addEventListener("click", () => {
        close();
        openMangaDetail(item.dataset.mangaId);
      });
    });
  });
}

// ---------------------------------------------------------
// ROUTING (hash-based, simple SPA views)
// ---------------------------------------------------------
const VIEWS = ["homeView", "mangaView", "readerView", "bookmarksView", "profileView", "adminView"];

function showView(viewId) {
  VIEWS.forEach((id) => $(`#${id}`).classList.toggle("hidden", id !== viewId));
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

$$(".back-btn[data-back='home']").forEach((btn) =>
  btn.addEventListener("click", () => { location.hash = "#/"; })
);

function router() {
  const hash = location.hash || "#/";

  if (hash === "#/" || hash === "") {
    showView("homeView");
    renderFeed();
  } else if (hash === "#/bookmarks") {
    showView("bookmarksView");
    renderBookmarks();
  } else if (hash === "#/profile") {
    showView("profileView");
    renderProfile();
  } else if (hash === "#/admin") {
    if (!state.isAdmin) { location.hash = "#/"; return; }
    showView("adminView");
    renderAdminMangaList();
    populateChapterMangaSelect();
  } else if (hash.startsWith("#/manga/")) {
    const id = hash.split("#/manga/")[1];
    showView("mangaView");
    openMangaDetail(id);
  } else if (hash.startsWith("#/reader/")) {
    const [mangaId, chapterId] = hash.split("#/reader/")[1].split("/");
    showView("readerView");
    openReader(mangaId, chapterId);
  } else {
    location.hash = "#/";
  }

  $$(".sidebar-link").forEach((link) => {
    link.classList.toggle("active", hash.startsWith(`#/${link.dataset.route}`) || (link.dataset.route === "home" && (hash === "#/" || hash === "")));
  });
}
window.addEventListener("hashchange", router);

// ---------------------------------------------------------
// AUTH
// ---------------------------------------------------------
function initAuth() {
  $("#googleSignInBtn").addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      showToast("Signed in successfully", "success");
    } catch (err) {
      console.error(err);
      showToast("Sign-in failed. Please try again.", "error");
    }
  });

  $("#signOutBtn").addEventListener("click", async () => {
    await signOut(auth);
    showToast("Signed out", "info");
    location.hash = "#/";
  });

  onAuthStateChanged(auth, async (user) => {
    state.user = user;

    if (user) {
      state.isAdmin = user.email === ADMIN_EMAIL;
      await ensureUserProfile(user);
      await loadBookmarkIds();
      renderSignedInUI();
    } else {
      state.isAdmin = false;
      state.profile = null;
      state.bookmarkIds = new Set();
      renderSignedOutUI();
    }

    router();
  });
}

async function ensureUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const newProfile = {
      displayName: user.displayName || "Reader",
      email: user.email,
      photoURL: user.photoURL || "",
      commentCount: 0,
      createdAt: Date.now()
    };
    await setDoc(ref, newProfile);
    state.profile = newProfile;
  } else {
    state.profile = snap.data();
  }
}

async function loadBookmarkIds() {
  if (!state.user) { state.bookmarkIds = new Set(); return; }
  const snap = await getDocs(collection(db, "users", state.user.uid, "bookmarks"));
  state.bookmarkIds = new Set(snap.docs.map((d) => d.id));
}

function renderSignedInUI() {
  const { user, profile, isAdmin } = state;

  $("#headerAvatarImg").src = profile?.photoURL || user.photoURL || "";
  $("#headerAvatarImg").classList.remove("hidden");
  $("#headerAvatarPlaceholder").classList.add("hidden");
  $("#headerAvatarBtn").onclick = () => { location.hash = "#/profile"; };

  const userBlock = $("#sidebarUserBlock");
  userBlock.innerHTML = `
    <div class="sidebar-signed-in">
      <img src="${profile?.photoURL || user.photoURL || ""}" alt="${escapeHtml(profile?.displayName || "")}">
      <div>
        <div class="name">${escapeHtml(profile?.displayName || user.displayName || "Reader")}</div>
        <div class="email">${escapeHtml(user.email || "")}</div>
      </div>
    </div>
  `;

  $("#signOutBtn").classList.remove("hidden");
  $("#adminNavLink").classList.toggle("hidden", !isAdmin);
}

function renderSignedOutUI() {
  $("#headerAvatarImg").classList.add("hidden");
  $("#headerAvatarPlaceholder").classList.remove("hidden");
  $("#headerAvatarBtn").onclick = () => {
    $("#sidebar").classList.add("open");
    $("#sidebarBackdrop").classList.add("open");
  };

  $("#sidebarUserBlock").innerHTML = `
    <button class="google-btn" id="googleSignInBtn">
      <i class="fa-brands fa-google"></i><span>Login with Google</span>
    </button>
  `;
  $("#googleSignInBtn").addEventListener("click", async () => {
    try { await signInWithPopup(auth, googleProvider); }
    catch (err) { console.error(err); showToast("Sign-in failed. Please try again.", "error"); }
  });

  $("#signOutBtn").classList.add("hidden");
  $("#adminNavLink").classList.add("hidden");
}

// ---------------------------------------------------------
// DATA LOADING — mangas + their latest 3 chapters
// ---------------------------------------------------------
async function loadAllMangas() {
  const mangaSnap = await getDocs(query(collection(db, "mangas"), orderBy("createdAt", "desc")));
  const mangas = [];

  for (const mangaDoc of mangaSnap.docs) {
    const data = mangaDoc.data();
    const chaptersSnap = await getDocs(
      query(collection(db, "mangas", mangaDoc.id, "chapters"), orderBy("createdAt", "desc"), limit(3))
    );
    const latestChapters = chaptersSnap.docs.map((c) => ({ id: c.id, ...c.data() }));

    mangas.push({ id: mangaDoc.id, ...data, latestChapters });
  }

  state.mangas = mangas;
  return mangas;
}

// ---------------------------------------------------------
// HOME FEED
// ---------------------------------------------------------
function initCategoryRibbon() {
  $("#categoryRibbon").addEventListener("click", (e) => {
    const chip = e.target.closest(".category-chip");
    if (!chip) return;
    $$(".category-chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.activeCategory = chip.dataset.category;
    renderFeed(false);
  });
}

async function renderFeed(refetch = true) {
  const feedEl = $("#mangaFeed");
  const emptyEl = $("#feedEmptyMsg");

  if (refetch || state.mangas.length === 0) {
    feedEl.innerHTML = `<div class="feed-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading latest chapters...</div>`;
    try {
      await loadAllMangas();
    } catch (err) {
      console.error(err);
      feedEl.innerHTML = `<p class="empty-msg"><i class="fa-solid fa-triangle-exclamation"></i> Couldn't load manga. Please refresh.</p>`;
      return;
    }
  }

  const filtered = state.activeCategory === "all"
    ? state.mangas
    : state.mangas.filter((m) => m.category === state.activeCategory);

  emptyEl.classList.toggle("hidden", filtered.length > 0);
  feedEl.innerHTML = filtered.map(mangaRowTemplate).join("");

  $$(".manga-row").forEach((row) => {
    row.addEventListener("click", () => { location.hash = `#/manga/${row.dataset.mangaId}`; });
  });
}

function mangaRowTemplate(m) {
  const chaptersHtml = (m.latestChapters || []).map((c) => `
    <div class="chapter-mini" data-manga-id="${m.id}" data-chapter-id="${c.id}">
      <i class="fa-solid fa-book-open"></i>
      <span class="ch-name">${escapeHtml(c.name)}</span>
      <span class="ch-time">${timeAgo(c.createdAt)}</span>
    </div>
  `).join("") || `<p style="font-size:12px;color:var(--text-faint);margin:2px 0 0;">No chapters yet</p>`;

  return `
    <article class="manga-row" data-manga-id="${m.id}">
      <div class="manga-row-left">
        <div class="manga-row-title">${escapeHtml(m.title)}</div>
        <div class="manga-row-category">${escapeHtml(m.category)}</div>
        <div class="chapter-mini-list">${chaptersHtml}</div>
      </div>
      <div class="manga-row-right">
        <img class="manga-cover" src="${m.coverUrl}" alt="${escapeHtml(m.title)} cover">
        <span class="status-badge ${m.status?.toLowerCase() === "completed" ? "completed" : "ongoing"}">${escapeHtml(m.status || "Ongoing")}</span>
      </div>
    </article>
  `;
}

// ---------------------------------------------------------
// MANGA DETAIL VIEW
// ---------------------------------------------------------
async function openMangaDetail(mangaId) {
  const container = $("#mangaDetailContent");
  container.innerHTML = `<div class="feed-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading manga...</div>`;

  const mangaRef = doc(db, "mangas", mangaId);
  const mangaSnap = await getDoc(mangaRef);
  if (!mangaSnap.exists()) {
    container.innerHTML = `<p class="empty-msg"><i class="fa-solid fa-box-open"></i> Manga not found.</p>`;
    return;
  }
  const manga = { id: mangaId, ...mangaSnap.data() };
  state.currentManga = manga;

  const chaptersSnap = await getDocs(query(collection(db, "mangas", mangaId, "chapters"), orderBy("createdAt", "desc")));
  const chapters = chaptersSnap.docs.map((c) => ({ id: c.id, ...c.data() }));
  state.currentChapters = chapters;

  const isBookmarked = state.bookmarkIds.has(mangaId);

  container.innerHTML = `
    <div class="manga-detail-header">
      <img class="manga-detail-cover" src="${manga.coverUrl}" alt="${escapeHtml(manga.title)} cover">
      <div class="manga-detail-info">
        <h1 class="manga-detail-title">${escapeHtml(manga.title)}</h1>
        <p class="manga-detail-desc">${escapeHtml(manga.description)}</p>
        <button class="bookmark-btn ${isBookmarked ? "active" : ""}" id="bookmarkBtn">
          <i class="fa-solid fa-bookmark"></i>
          <span>${isBookmarked ? "Bookmarked" : "Bookmark"}</span>
        </button>
      </div>
    </div>
    <h2 class="section-title"><i class="fa-solid fa-list"></i> Chapters</h2>
    <div class="chapter-full-list">
      ${chapters.map((c) => `
        <div class="chapter-full-item" data-chapter-id="${c.id}">
          <i class="fa-solid fa-book-open"></i>
          <span>${escapeHtml(c.name)}</span>
          <span class="free-tag">FREE</span>
          <span class="ch-time">${timeAgo(c.createdAt)}</span>
        </div>
      `).join("") || `<p class="empty-msg">No chapters published yet.</p>`}
    </div>
  `;

  $$(".chapter-full-item").forEach((item) => {
    item.addEventListener("click", () => {
      location.hash = `#/reader/${mangaId}/${item.dataset.chapterId}`;
    });
  });

  $("#bookmarkBtn").addEventListener("click", () => toggleBookmark(manga));
}

async function toggleBookmark(manga) {
  if (!state.user) {
    showToast("Sign in with Google to bookmark manga.", "error");
    $("#sidebar").classList.add("open");
    $("#sidebarBackdrop").classList.add("open");
    return;
  }

  const ref = doc(db, "users", state.user.uid, "bookmarks", manga.id);
  const btn = $("#bookmarkBtn");

  if (state.bookmarkIds.has(manga.id)) {
    await deleteDoc(ref);
    state.bookmarkIds.delete(manga.id);
    btn.classList.remove("active");
    btn.querySelector("span").textContent = "Bookmark";
    showToast("Removed from bookmarks", "info");
  } else {
    await setDoc(ref, { mangaId: manga.id, title: manga.title, coverUrl: manga.coverUrl, addedAt: Date.now() });
    state.bookmarkIds.add(manga.id);
    btn.classList.add("active");
    btn.querySelector("span").textContent = "Bookmarked";
    showToast("Added to bookmarks", "success");
  }
}

// ---------------------------------------------------------
// BOOKMARKS VIEW
// ---------------------------------------------------------
async function renderBookmarks() {
  const feedEl = $("#bookmarksFeed");
  const emptyEl = $("#bookmarksEmptyMsg");

  if (!state.user) {
    feedEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    emptyEl.innerHTML = `<i class="fa-solid fa-circle-user"></i> Sign in with Google to see your bookmarks.`;
    return;
  }

  const snap = await getDocs(collection(db, "users", state.user.uid, "bookmarks"));
  const bookmarks = snap.docs.map((d) => d.data());

  emptyEl.classList.toggle("hidden", bookmarks.length > 0);
  feedEl.innerHTML = bookmarks.map((b) => `
    <article class="manga-row" data-manga-id="${b.mangaId}">
      <div class="manga-row-left">
        <div class="manga-row-title">${escapeHtml(b.title)}</div>
      </div>
      <div class="manga-row-right">
        <img class="manga-cover" src="${b.coverUrl}" alt="${escapeHtml(b.title)} cover">
      </div>
    </article>
  `).join("");

  $$("#bookmarksFeed .manga-row").forEach((row) => {
    row.addEventListener("click", () => { location.hash = `#/manga/${row.dataset.mangaId}`; });
  });
}

// ---------------------------------------------------------
// PROFILE VIEW
// ---------------------------------------------------------
async function renderProfile() {
  if (!state.user) {
    $("#profileContent").classList.add("hidden");
    $("#profileNotSignedIn").classList.remove("hidden");
    return;
  }
  $("#profileNotSignedIn").classList.add("hidden");
  $("#profileContent").classList.remove("hidden");

  $("#profileAvatarImg").src = state.profile.photoURL || state.user.photoURL || "";
  $("#profileDisplayName").textContent = state.profile.displayName || state.user.displayName || "Reader";
  $("#profileEmail").textContent = state.user.email || "";
  $("#profileCommentCount").textContent = state.profile.commentCount || 0;

  const bookmarksSnap = await getDocs(collection(db, "users", state.user.uid, "bookmarks"));
  $("#profileBookmarkCount").textContent = bookmarksSnap.size;
}

function initProfileAvatarUpload() {
  $("#profileAvatarEditBtn").addEventListener("click", () => $("#profileAvatarInput").click());

  $("#profileAvatarInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !state.user) return;

    showToast("Uploading new avatar...", "info");
    try {
      const url = await uploadImageToImgbb(file);
      await updateDoc(doc(db, "users", state.user.uid), { photoURL: url });
      state.profile.photoURL = url;

      $("#profileAvatarImg").src = url;
      $("#headerAvatarImg").src = url;
      const sidebarImg = document.querySelector(".sidebar-signed-in img");
      if (sidebarImg) sidebarImg.src = url;

      showToast("Profile picture updated", "success");
    } catch (err) {
      console.error(err);
      showToast("Avatar upload failed. Try again.", "error");
    }
    e.target.value = "";
  });
}

// ---------------------------------------------------------
// READER VIEW + COMMENTS
// ---------------------------------------------------------
async function openReader(mangaId, chapterId) {
  const readerPages = $("#readerPages");
  readerPages.innerHTML = `<div class="feed-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading pages...</div>`;

  // Ensure we have the manga's chapter list (for prev/next) cached.
  if (!state.currentManga || state.currentManga.id !== mangaId) {
    const mangaSnap = await getDoc(doc(db, "mangas", mangaId));
    state.currentManga = { id: mangaId, ...mangaSnap.data() };
    const chaptersSnap = await getDocs(query(collection(db, "mangas", mangaId, "chapters"), orderBy("createdAt", "asc")));
    state.currentChapters = chaptersSnap.docs.map((c) => ({ id: c.id, ...c.data() }));
  }

  const chapters = state.currentChapters;
  const index = chapters.findIndex((c) => c.id === chapterId);
  state.currentChapterIndex = index;

  const chapterSnap = await getDoc(doc(db, "mangas", mangaId, "chapters", chapterId));
  if (!chapterSnap.exists()) {
    readerPages.innerHTML = `<p class="empty-msg"><i class="fa-solid fa-box-open"></i> Chapter not found.</p>`;
    return;
  }
  const chapter = chapterSnap.data();

  $("#readerChapterTitle").textContent = `${state.currentManga.title} — ${chapter.name}`;
  readerPages.innerHTML = (chapter.pages || []).map((url, i) =>
    `<img src="${url}" alt="Page ${i + 1}" loading="lazy">`
  ).join("");

  $("#prevChapterBtn").disabled = index <= 0;
  $("#nextChapterBtn").disabled = index === -1 || index >= chapters.length - 1;

  $("#prevChapterBtn").onclick = () => {
    if (index > 0) location.hash = `#/reader/${mangaId}/${chapters[index - 1].id}`;
  };
  $("#nextChapterBtn").onclick = () => {
    if (index < chapters.length - 1) location.hash = `#/reader/${mangaId}/${chapters[index + 1].id}`;
  };

  $("#readerBackBtn").onclick = () => { location.hash = `#/manga/${mangaId}`; };

  initCommentForm(mangaId, chapterId);
  await loadComments(mangaId, chapterId);
}

function initCommentForm(mangaId, chapterId) {
  const gate = $("#commentAuthGate");
  const form = $("#commentForm");

  if (!state.user) {
    gate.classList.remove("hidden");
    form.classList.add("hidden");
    return;
  }
  gate.classList.add("hidden");
  form.classList.remove("hidden");
  $("#commentAvatar").src = state.profile?.photoURL || state.user.photoURL || "";

  form.onsubmit = async (e) => {
    e.preventDefault();
    const input = $("#commentInput");
    const text = input.value.trim();
    if (!text) return;

    try {
      await addDoc(collection(db, "mangas", mangaId, "chapters", chapterId, "comments"), {
        uid: state.user.uid,
        name: state.profile?.displayName || state.user.displayName || "Reader",
        photoURL: state.profile?.photoURL || state.user.photoURL || "",
        text,
        createdAt: Date.now()
      });
      await updateDoc(doc(db, "users", state.user.uid), { commentCount: increment(1) });
      if (state.profile) state.profile.commentCount = (state.profile.commentCount || 0) + 1;

      input.value = "";
      await loadComments(mangaId, chapterId);
    } catch (err) {
      console.error(err);
      showToast("Couldn't post comment. Try again.", "error");
    }
  };
}

async function loadComments(mangaId, chapterId) {
  const listEl = $("#commentsList");
  listEl.innerHTML = `<div class="feed-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading comments...</div>`;

  const snap = await getDocs(
    query(collection(db, "mangas", mangaId, "chapters", chapterId, "comments"), orderBy("createdAt", "desc"))
  );
  const comments = snap.docs.map((d) => d.data());

  listEl.innerHTML = comments.map((c) => `
    <div class="comment-item">
      <img src="${c.photoURL || ""}" alt="${escapeHtml(c.name)}">
      <div class="comment-body">
        <span class="comment-name">${escapeHtml(c.name)}</span>
        <span class="comment-time">${timeAgo(c.createdAt)}</span>
        <p class="comment-text">${escapeHtml(c.text)}</p>
      </div>
    </div>
  `).join("") || `<p class="empty-msg" style="padding:14px;"><i class="fa-solid fa-comment-slash"></i> Be the first to comment.</p>`;
}

// ---------------------------------------------------------
// ADMIN — MANGA LIST / CRUD
// ---------------------------------------------------------
function initAdminTabs() {
  $$(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".admin-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      $("#adminMangaListPanel").classList.toggle("hidden", tab.dataset.adminTab !== "mangaList");
      $("#adminAddMangaPanel").classList.toggle("hidden", tab.dataset.adminTab !== "addManga");
      $("#adminAddChapterPanel").classList.toggle("hidden", tab.dataset.adminTab !== "addChapter");

      if (tab.dataset.adminTab === "addManga") resetMangaForm();
    });
  });
}

async function renderAdminMangaList() {
  const listEl = $("#adminMangaList");
  listEl.innerHTML = `<div class="feed-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>`;

  await loadAllMangas();
  listEl.innerHTML = state.mangas.map((m) => `
    <div class="admin-manga-item" data-manga-id="${m.id}">
      <img src="${m.coverUrl}" alt="${escapeHtml(m.title)}">
      <div class="info">
        <div class="title">${escapeHtml(m.title)}</div>
        <div class="meta">${escapeHtml(m.category)} · ${escapeHtml(m.status || "Ongoing")}</div>
      </div>
      <div class="actions">
        <button class="icon-btn edit-manga-btn" aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn danger delete-manga-btn" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
  `).join("") || `<p class="empty-msg"><i class="fa-solid fa-box-open"></i> No manga yet. Add your first one!</p>`;

  $$(".edit-manga-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".admin-manga-item").dataset.mangaId;
      startEditManga(id);
    });
  });
  $$(".delete-manga-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".admin-manga-item").dataset.mangaId;
      confirmDeleteManga(id);
    });
  });
}

function resetMangaForm() {
  $("#addMangaForm").reset();
  $("#editMangaId").value = "";
  $("#mangaCoverPreview").classList.add("hidden");
  $("#mangaCoverPreview").src = "";
}

function startEditManga(mangaId) {
  const manga = state.mangas.find((m) => m.id === mangaId);
  if (!manga) return;

  $$(".admin-tab").forEach((t) => t.classList.remove("active"));
  document.querySelector('[data-admin-tab="addManga"]').classList.add("active");
  $("#adminMangaListPanel").classList.add("hidden");
  $("#adminAddChapterPanel").classList.add("hidden");
  $("#adminAddMangaPanel").classList.remove("hidden");

  $("#editMangaId").value = mangaId;
  $("#mangaTitleInput").value = manga.title;
  $("#mangaDescInput").value = manga.description;
  $("#mangaCategoryInput").value = manga.category;
  $("#mangaStatusInput").value = manga.status || "Ongoing";
  $("#mangaCoverPreview").src = manga.coverUrl;
  $("#mangaCoverPreview").classList.remove("hidden");
}

async function confirmDeleteManga(mangaId) {
  const manga = state.mangas.find((m) => m.id === mangaId);
  if (!manga) return;
  if (!confirm(`Delete "${manga.title}" and all of its chapters? This cannot be undone.`)) return;

  try {
    const chaptersSnap = await getDocs(collection(db, "mangas", mangaId, "chapters"));
    await Promise.all(chaptersSnap.docs.map((c) => deleteDoc(doc(db, "mangas", mangaId, "chapters", c.id))));
    await deleteDoc(doc(db, "mangas", mangaId));

    showToast("Manga deleted", "success");
    renderAdminMangaList();
    populateChapterMangaSelect();
  } catch (err) {
    console.error(err);
    showToast("Couldn't delete manga.", "error");
  }
}

function initMangaCoverPreview() {
  $("#mangaCoverInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      $("#mangaCoverPreview").src = reader.result;
      $("#mangaCoverPreview").classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  });
}

function initAddMangaForm() {
  $("#addMangaForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const editId = $("#editMangaId").value;
    const title = $("#mangaTitleInput").value.trim();
    const description = $("#mangaDescInput").value.trim();
    const category = $("#mangaCategoryInput").value;
    const status = $("#mangaStatusInput").value;
    const file = $("#mangaCoverInput").files[0];

    if (!title || !description || !category) {
      showToast("Please fill in all required fields.", "error");
      return;
    }
    if (!editId && !file) {
      showToast("Please select a cover image from your gallery.", "error");
      return;
    }

    const progressEl = $("#mangaUploadProgress");
    const submitBtn = $("#addMangaForm button[type='submit']");
    submitBtn.disabled = true;

    try {
      let coverUrl = null;
      if (file) {
        progressEl.classList.remove("hidden");
        coverUrl = await uploadImageToImgbb(file);
        progressEl.classList.add("hidden");
      }

      if (editId) {
        const updates = { title, description, category, status };
        if (coverUrl) updates.coverUrl = coverUrl;
        await updateDoc(doc(db, "mangas", editId), updates);
        showToast("Manga updated", "success");
      } else {
        await addDoc(collection(db, "mangas"), {
          title, description, category, status,
          coverUrl,
          createdAt: Date.now()
        });
        showToast("Manga added", "success");
      }

      resetMangaForm();
      document.querySelector('[data-admin-tab="mangaList"]').click();
      renderAdminMangaList();
      populateChapterMangaSelect();
    } catch (err) {
      console.error(err);
      progressEl.classList.add("hidden");
      showToast("Couldn't save manga. Try again.", "error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------
// ADMIN — ADD CHAPTER
// ---------------------------------------------------------
async function populateChapterMangaSelect() {
  const select = $("#chapterMangaSelect");
  if (state.mangas.length === 0) await loadAllMangas();

  select.innerHTML = state.mangas.map((m) => `<option value="${m.id}">${escapeHtml(m.title)}</option>`).join("")
    || `<option value="">No manga available — add one first</option>`;
}

function initChapterPagesPreview() {
  $("#chapterPagesInput").addEventListener("change", (e) => {
    const files = Array.from(e.target.files);
    const previewEl = $("#chapterPagesPreview");
    previewEl.innerHTML = "";

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = document.createElement("img");
        img.src = reader.result;
        img.alt = file.name;
        previewEl.appendChild(img);
      };
      reader.readAsDataURL(file);
    });
  });
}

function initAddChapterForm() {
  $("#addChapterForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const mangaId = $("#chapterMangaSelect").value;
    const name = $("#chapterNameInput").value.trim();
    const files = Array.from($("#chapterPagesInput").files);

    if (!mangaId) { showToast("Select a manga first.", "error"); return; }
    if (!name) { showToast("Enter a chapter name or number.", "error"); return; }
    if (files.length === 0) { showToast("Select at least one page image.", "error"); return; }

    const progressEl = $("#chapterUploadProgress");
    const progressText = $("#chapterUploadProgressText");
    const submitBtn = $("#addChapterForm button[type='submit']");

    submitBtn.disabled = true;
    progressEl.classList.remove("hidden");
    progressText.textContent = `Uploading 0 / ${files.length} pages...`;

    try {
      const pageUrls = await uploadMultipleImagesToImgbb(files, (done, total) => {
        progressText.textContent = `Uploading ${done} / ${total} pages...`;
      });

      await addDoc(collection(db, "mangas", mangaId, "chapters"), {
        name,
        pages: pageUrls,
        createdAt: Date.now()
      });

      showToast("Chapter published", "success");
      $("#addChapterForm").reset();
      $("#chapterPagesPreview").innerHTML = "";
    } catch (err) {
      console.error(err);
      showToast("Couldn't publish chapter. Try again.", "error");
    } finally {
      progressEl.classList.add("hidden");
      submitBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------
function init() {
  initTheme();
  initSidebar();
  initSearch();
  initCategoryRibbon();
  initAuth();
  initProfileAvatarUpload();
  initAdminTabs();
  initMangaCoverPreview();
  initAddMangaForm();
  initChapterPagesPreview();
  initAddChapterForm();
  router();
}

document.addEventListener("DOMContentLoaded", init);
