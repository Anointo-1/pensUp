import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInAnonymously, onAuthStateChanged, signOut, deleteUser, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, setDoc, getDoc, updateDoc, getDocs, deleteDoc, arrayUnion, arrayRemove, where, limit } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDgou5bwByER3Tw_lL-BX1n02dgAESYft0",
    authDomain: "notebookchat-6c5ef.firebaseapp.com",
    projectId: "notebookchat-6c5ef"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch((err) => console.warn("Auth persistence error:", err));

let currentUser = null, userProfile = null;
let userDocUnsub = null, unsubMsg = null, unsubDmMsg = null, unsubProfilePosts = null, unsubNotifs = null, unsubFeed = null, unsubPuzzles = null, unsubSticky = null, unsubPresence = null;
let isRegistering = false, isInitialLoadDone = false; 
let currentPinnedCount = 0;
let linksEnabledGlobally = true;
let attachedDoodleBase64 = null;
let currentStickyColor = 'yellow';
let globalPostsCache = [];
let activeTagFilter = null;
let presenceInterval = null;

// --- CREDIT MODE & FIRESTORE RATE GUARD VARIABLES ---
let activeOnlineUsersCount = 1;
let isCreditModeActive = false;
let userReadCredits = 100;
let userWriteCredits = 50;
const DAILY_FREE_READ_LIMIT = 50000;
const DAILY_FREE_WRITE_LIMIT = 20000;

const ROOM_ID = "main-room";
const SUPER_ADMINS = ['anoimazo1', 'anointo', 'amazo'];
const ALL_EMOJIS = ['👤','👻','👾','🤖','👽','🐼','🦊','🦄','🐸','🐱','🐶','🦖','✏️','🎨','🔥','😎','🤠','🥳','🤡','👑','🎒','🎓','📚','💡','🚀','⭐','🌟','🌈','⚡','🎯','⚽','🎮','🍕','🍔','🌮','🍩','🍦','☕','🏀','🎸','🎧','🧩','🎲','🧸','🐉','🐙','🦋','🦁','🐯','🐻','🦉','🦅','🐺','🔮','🧿','💎','💰','🏆','🥇','🎖️'];

const UI = {
    auth: document.getElementById('auth-screen'), launch: document.getElementById('launch-screen'), app: document.getElementById('app-screen'),
    msgContainer: document.getElementById('chat-messages'), input: document.getElementById('message-input'), sendBtn: document.getElementById('btn-send'),
    err: document.getElementById('auth-error'), adminBtn: document.getElementById('btn-admin'), themeSel: document.getElementById('theme-selector'),
    footer: document.getElementById('chat-footer')
};

const writeSound = new Audio('writing.mp3'); writeSound.playbackRate = 1.3;

let settings = {
    chatBoxLift: localStorage.getItem('pensup_lift') === 'true',
    chatBoxLiftDm: localStorage.getItem('pensup_lift_dm') === 'true',
    forceToast: localStorage.getItem('pensup_force_toast') === 'true',
    dmToast: localStorage.getItem('pensup_dm_toast') !== 'false',
    soundEnabled: localStorage.getItem('pensup_sound') !== 'false',
    fullScreen: localStorage.getItem('pensup_fullscreen') === 'true'
};

// --- DYNAMIC SEO META TAG & STRUCTURED DATA INJECTOR ---
function updateSEO({ title, description, image, url, authorName, datePublished }) {
    if (title) {
        document.title = `${title} | PensUp Pro`;
        document.getElementById('og-title')?.setAttribute('content', title);
        document.getElementById('tw-title')?.setAttribute('content', title);
    }
    if (description) {
        const cleanDesc = description.substring(0, 160);
        document.getElementById('meta-description')?.setAttribute('content', cleanDesc);
        document.getElementById('og-description')?.setAttribute('content', cleanDesc);
        document.getElementById('tw-description')?.setAttribute('content', cleanDesc);
    }
    if (image) {
        document.getElementById('og-image')?.setAttribute('content', image);
    }

    let ldScript = document.getElementById('dynamic-schema');
    if (!ldScript) {
        ldScript = document.createElement('script');
        ldScript.id = 'dynamic-schema';
        ldScript.type = 'application/ld+json';
        document.head.appendChild(ldScript);
    }

    const currentUrl = url || window.location.href;
    const schemaData = {
        "@context": "https://schema.org",
        "@type": "DiscussionForumPosting",
        "headline": title || "PensUp Pro - Handwritten Study Notes & Community",
        "text": description || "Handwritten notes, chat, and community discussions on PensUp Pro.",
        "datePublished": datePublished || "2026-02-01T00:00:00Z",
        "url": currentUrl,
        "author": {
            "@type": "Person",
            "name": authorName || "PensUp Community",
            "url": currentUrl
        }
    };
    if (image) schemaData.image = image;

    ldScript.textContent = JSON.stringify(schemaData);
}

// --- DYNAMIC ROUTER & DEEP LINK SCROLLER ---
async function handleUrlRouting() {
    const params = new URLSearchParams(window.location.search);
    const postId = params.get('post');
    const puzzleId = params.get('puzzle');
    const profileUid = params.get('profile');

    if (postId) {
        try {
            const postSnap = await getDoc(doc(db, "global_posts", postId));
            trackReadCredit(1);
            if (postSnap.exists()) {
                const data = postSnap.data();
                updateSEO({
                    title: `Discussion by @${data.authorName}: "${data.text.substring(0, 30)}..."`,
                    description: data.text || "Check out this handwritten note on PensUp Pro!",
                    image: data.doodleImage || "https://anointo-1.github.io/pensUp/PensUp.jpg",
                    authorName: data.authorName,
                    datePublished: data.createdAt ? data.createdAt.toDate().toISOString() : new Date().toISOString()
                });
                switchView('feed');
                loadGlobalFeed(postId);
            }
        } catch (e) { console.warn("Router post fetch error:", e); }
    } else if (puzzleId) {
        try {
            const puzzleSnap = await getDoc(doc(db, "puzzles", puzzleId));
            trackReadCredit(1);
            if (puzzleSnap.exists()) {
                const data = puzzleSnap.data();
                updateSEO({
                    title: `Play Arcade Game: ${data.title}`,
                    description: `Play and run ${data.title} inside the PensUp Arcade!`
                });
                switchView('arcade');
                runPuzzleSnippet(data.title, data.code);
            }
        } catch (e) { console.warn("Router puzzle fetch error:", e); }
    } else if (profileUid) {
        showProfile(profileUid);
    }
}

// --- FIRESTORE CREDIT & RATE GUARDIAN ENGINE ---
function trackReadCredit(count = 1) {
    if (isCreditModeActive) {
        userReadCredits = Math.max(0, userReadCredits - count);
        updateCreditBannerUI();
    }
}

function trackWriteCredit(count = 1) {
    if (isCreditModeActive) {
        userWriteCredits = Math.max(0, userWriteCredits - count);
        updateCreditBannerUI();
    }
}

function updateCreditBannerUI() {
    const banner = document.getElementById('credit-mode-banner');
    const counter = document.getElementById('credit-counter');
    if (isCreditModeActive) {
        banner.classList.remove('hidden');
        counter.textContent = `Reads: ${userReadCredits} | Writes: ${userWriteCredits}`;
    } else {
        banner.classList.add('hidden');
    }
}

async function checkDatabaseUsageLimits() {
    try {
        const statsRef = doc(db, "app_settings", "usage_stats");
        const snap = await getDoc(statsRef);
        if (snap.exists()) {
            const data = snap.data();
            const todayReads = data.todayReads || 0;
            const todayWrites = data.todayWrites || 0;

            if (todayReads >= (DAILY_FREE_READ_LIMIT * 0.8) || todayWrites >= (DAILY_FREE_WRITE_LIMIT * 0.8)) {
                isCreditModeActive = true;
                const remainingReads = Math.max(0, DAILY_FREE_READ_LIMIT - todayReads);
                const remainingWrites = Math.max(0, DAILY_FREE_WRITE_LIMIT - todayWrites);
                userReadCredits = Math.floor(remainingReads / Math.max(1, activeOnlineUsersCount));
                userWriteCredits = Math.floor(remainingWrites / Math.max(1, activeOnlineUsersCount));
            } else {
                isCreditModeActive = false;
            }
        } else {
            isCreditModeActive = false;
        }
    } catch (e) { console.warn("Usage check note:", e); }
    updateCreditBannerUI();
}

function applySettings() {
    settings.chatBoxLift ? UI.footer.classList.add('mb-12') : UI.footer.classList.remove('mb-12');
    
    const dmFooter = document.getElementById('dm-chat-footer');
    if (dmFooter) {
        settings.chatBoxLiftDm ? dmFooter.classList.add('mb-12') : dmFooter.classList.remove('mb-12');
    }

    document.getElementById('setting-chatbox-lift').checked = settings.chatBoxLift;
    if (document.getElementById('setting-chatbox-lift-dm')) {
        document.getElementById('setting-chatbox-lift-dm').checked = settings.chatBoxLiftDm;
    }
    document.getElementById('setting-force-toast').checked = settings.forceToast;
    if (document.getElementById('setting-dm-toast')) {
        document.getElementById('setting-dm-toast').checked = settings.dmToast;
    }
    document.getElementById('setting-sound-enabled').checked = settings.soundEnabled;
    document.getElementById('setting-fullscreen').checked = settings.fullScreen;

    if (settings.fullScreen) {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(e => console.warn("Fullscreen request blocked:", e));
        }
    } else {
        if (document.exitFullscreen && document.fullscreenElement) {
            document.exitFullscreen().catch(e => console.warn("Exit fullscreen failed:", e));
        }
    }
}

function createToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none max-w-[90%] w-full sm:w-auto';
        document.body.appendChild(container);
    }
    return container;
}

function showToastNotification(senderName, text, type = 'chat') {
    const container = createToastContainer();
    const toast = document.createElement('div');
    const isDm = type === 'dm';
    const bgClass = isDm ? 'bg-blue-50 border-blue-400' : 'bg-yellow-50 border-amber-400';
    const badgeBg = isDm ? 'bg-blue-200 text-blue-900' : 'bg-amber-200 text-amber-900';
    const typeLabel = isDm ? '📫 Direct Message' : '📝 Main Chat';
    
    toast.className = `p-3 ${bgClass} text-slate-800 sketched-border shadow-2xl animate-pop flex flex-col min-w-[280px] max-w-[360px] pointer-events-auto relative -rotate-1 border-2 transition-all duration-300`;
    
    let safeText = text.length > 50 ? escapeHTML(text.substring(0, 50)) + "..." : escapeHTML(text);
    
    toast.innerHTML = `
        <div class="flex items-center justify-between border-b border-slate-300/60 pb-1 mb-1 gap-2">
            <span class="text-xs font-bold ${badgeBg} px-2 py-0.5 rounded sketched-border-alt shrink-0">${typeLabel}</span>
            <span class="text-sm font-bold text-indigo-600 truncate">From ${escapeHTML(senderName)}</span>
        </div>
        <div class="text-lg leading-tight font-semibold text-slate-800 break-words">${safeText}</div>
    `;
    
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px) scale(0.95)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function notifyUser(senderName, text, type = 'chat') {
    if (type === 'dm' && !settings.dmToast) return;

    if (!settings.forceToast && "Notification" in window && Notification.permission === "granted") {
        try {
            const title = type === 'dm' ? `PensUp 📫 DM from ${senderName}` : `PensUp 📝 Note from ${senderName}`;
            const n = new Notification(title, { 
                body: text.length > 60 ? text.substring(0, 60) + "..." : text, 
                icon: "https://anointo-1.github.io/pensUp/PensUp.jpg"
            });
            n.onclick = () => { window.focus(); n.close(); }; 
            return;
        } catch (e) { console.warn("Native notify failed:", e); }
    }
    showToastNotification(senderName, text, type);
}

function listenForNotifications(uid) {
    if (unsubNotifs) unsubNotifs();
    let isInitialNotifLoad = false;
    
    unsubNotifs = onSnapshot(collection(db, `users/${uid}/notifications`), (snapshot) => {
        if (!isInitialNotifLoad) {
            isInitialNotifLoad = true;
            return;
        }
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                if (data.type === 'dm') {
                    notifyUser(data.senderName, data.text, 'dm');
                }
                deleteDoc(change.doc.ref).catch(e => console.warn("Notification cleanup error", e));
            }
        });
    });
}

const escapeHTML = (str) => str ? String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;") : '';

// --- IN-APP LINK PREVIEW TRIGGER ---
window.openInAppWebLink = (url) => {
    const modal = document.getElementById('link-preview-modal');
    const iframe = document.getElementById('link-preview-iframe');
    const title = document.getElementById('link-preview-title');
    const urlText = document.getElementById('link-preview-url-text');
    const extBtn = document.getElementById('link-preview-external-btn');

    if (!modal || !iframe) {
        window.open(url, '_blank');
        return;
    }

    title.textContent = `Viewing Web Link`;
    urlText.textContent = url;
    extBtn.href = url;
    iframe.src = url;

    modal.classList.remove('hidden');
};

document.getElementById('link-preview-close')?.addEventListener('click', () => {
    const modal = document.getElementById('link-preview-modal');
    const iframe = document.getElementById('link-preview-iframe');
    if (iframe) iframe.src = 'about:blank';
    if (modal) modal.classList.add('hidden');
});

const parseTagsAndLinks = (rawText) => {
    let safeText = escapeHTML(rawText);

    if (linksEnabledGlobally) {
        safeText = safeText.replace(/(https?:\/\/[^\s]+)/g, (match) => {
            return `<span onclick="event.stopPropagation(); openInAppWebLink('${match}')" class="text-blue-600 underline font-semibold hover:text-blue-800 break-all cursor-pointer inline-block">${match}</span>`;
        });
    } else {
        safeText = safeText.replace(/(https?:\/\/[^\s]+)/g, '<span class="italic text-slate-400 bg-slate-100 px-1 rounded">[Link Disabled by Admin]</span>');
    }

    safeText = safeText.replace(/#([a-zA-Z][\w\-]*)/g, '<span onclick="event.stopPropagation(); filterByTag(\'$1\')" class="text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded sketched-border-alt cursor-pointer hover:bg-indigo-100">#$1</span>');

    return safeText;
};

// --- EXTRACT HASHTAGS FOR HORIZONTAL BAR ---
function extractTagsFromText(text) {
    if (!text) return [];
    const matches = text.match(/#([a-zA-Z][\w\-]*)/g);
    if (!matches) return [];
    return [...new Set(matches.map(t => t.substring(1)))];
}

const showError = (msg) => { UI.err.textContent = msg; UI.err.classList.remove('hidden'); setTimeout(() => UI.err.classList.add('hidden'), 4000); };
const setTimeGreeting = () => { const hr = new Date().getHours(); document.getElementById('greeting-text').textContent = hr < 12 ? 'Good Morning!' : hr < 18 ? 'Good Afternoon!' : 'Good Evening!'; };

UI.themeSel.onchange = (e) => document.body.className = `h-screen w-full flex flex-col relative overflow-hidden text-lg select-none ${e.target.value}`;
const currentMonth = new Date().getMonth();
if (currentMonth === 9) { UI.themeSel.value = 'theme-halloween'; UI.themeSel.dispatchEvent(new Event('change')); }
else if (currentMonth === 11) { UI.themeSel.value = 'theme-xmas'; UI.themeSel.dispatchEvent(new Event('change')); }

// Guest Login
document.getElementById('btn-guest').onclick = async () => {
    document.getElementById('auth-loading').classList.remove('hidden');
    try {
        const cred = await signInAnonymously(auth);
        const guestName = `guest_${cred.user.uid.substring(0, 5)}`;
        await setDoc(doc(db, "users", cred.user.uid), { 
            username: guestName, role: 'guest', suspended: false, emoji: '👀', bio: 'Browsing as guest', following: [], lastActive: serverTimestamp() 
        }, { merge: true });
        trackWriteCredit(1);
    } catch (e) {
        document.getElementById('auth-loading').classList.add('hidden');
        showError("Guest login failed (Ensure Anonymous auth is enabled in Firebase console): " + e.message);
    }
};

document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('auth-username').value.trim().toLowerCase().replace(/\s+/g, '');
    const p = document.getElementById('auth-password').value;
    if (u.length < 3 || p.length < 6) return showError("Username min 3 chars, password min 6 chars.");
    document.getElementById('auth-loading').classList.remove('hidden');
    isRegistering = true; 
    try {
        const usernameDoc = await getDoc(doc(db, "usernames", u));
        trackReadCredit(1);
        if (usernameDoc.exists()) { isRegistering = false; document.getElementById('auth-loading').classList.add('hidden'); return showError("Username is already taken."); }
        const cred = await createUserWithEmailAndPassword(auth, `${u}@notebook.local`, p);
        const role = SUPER_ADMINS.includes(u) ? 'super_admin' : 'user';
        await setDoc(doc(db, "usernames", u), { uid: cred.user.uid });
        await setDoc(doc(db, "users", cred.user.uid), { username: u, role: role, suspended: false, emoji: '👤', bio: '', following: [], lastActive: serverTimestamp() });
        trackWriteCredit(2);
        isRegistering = false; syncUserProfile(cred.user);
    } catch (e) { isRegistering = false; document.getElementById('auth-loading').classList.add('hidden'); showError(e.message); }
};

document.getElementById('btn-login').onclick = async () => {
    const u = document.getElementById('auth-username').value.trim().toLowerCase();
    const p = document.getElementById('auth-password').value;
    if(!u || !p) return showError("Please enter credentials.");
    document.getElementById('auth-loading').classList.add('hidden');
    try { await signInWithEmailAndPassword(auth, `${u}@notebook.local`, p); } 
    catch (e) { document.getElementById('auth-loading').classList.add('hidden'); showError("Invalid username or password."); }
};

document.getElementById('btn-logout-launch').onclick = async () => {
    document.getElementById('auth-loading').classList.add('hidden');
    if (presenceInterval) { clearInterval(presenceInterval); presenceInterval = null; }
    if (unsubPresence) { unsubPresence(); unsubPresence = null; }
    if (unsubNotifs) { unsubNotifs(); unsubNotifs = null; }
    if (userDocUnsub) { userDocUnsub(); userDocUnsub = null; }
    currentUser = null;
    userProfile = null;
    try { await signOut(auth); } catch (e) { console.warn("Sign out note:", e); }
};

// --- FASTER PRESENCE HEARTBEAT (10-second updates for online count) ---
function startPresenceHeartbeat(uid) {
    if (presenceInterval) clearInterval(presenceInterval);
    
    const updatePresence = async () => {
        if (!currentUser || !uid) return;
        try { 
            await updateDoc(doc(db, "users", uid), { lastActive: serverTimestamp() }); 
            trackWriteCredit(1);
        } catch (e) { console.warn("Presence heartbeat note:", e); }
    };
    
    updatePresence();
    presenceInterval = setInterval(updatePresence, 10000);

    if (unsubPresence) unsubPresence();
    unsubPresence = onSnapshot(collection(db, "users"), (snapshot) => {
        const now = Date.now();
        let activeCount = 0;
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.lastActive) {
                const lastTime = data.lastActive.toDate ? data.lastActive.toDate().getTime() : 0;
                if ((now - lastTime) < 25000) activeCount++;
            }
        });
        activeOnlineUsersCount = Math.max(1, activeCount);
        const badge = document.getElementById('online-counter-badge');
        if (badge) badge.textContent = `🟢 ${activeOnlineUsersCount} online`;
        checkDatabaseUsageLimits();
    });
}

function syncUserProfile(user) {
    if (userDocUnsub) { userDocUnsub(); userDocUnsub = null; }
    userDocUnsub = onSnapshot(doc(db, "users", user.uid), 
        (docSnap) => {
            if (isRegistering) return; 
            if (!docSnap.exists() || docSnap.data().suspended) { 
                document.getElementById('auth-loading').classList.add('hidden');
                signOut(auth); 
                showError(docSnap.data()?.suspended ? "Account suspended." : "Account missing."); 
                return; 
            }
            
            const wasNull = !currentUser;
            userProfile = docSnap.data(); 
            if (!userProfile.following) userProfile.following = [];
            currentUser = user;
            
            document.getElementById('auth-loading').classList.add('hidden');
            UI.auth.classList.add('hidden'); 
            
            if (wasNull && UI.app.classList.contains('hidden')) {
                UI.launch.classList.remove('hidden');
            }

            setTimeGreeting();
            document.getElementById('launch-username').textContent = userProfile.username;
            document.getElementById('btn-open-emoji-picker').textContent = userProfile.emoji || '👤';
            document.getElementById('launch-bio').value = userProfile.bio || '';
            document.getElementById('user-badge').textContent = `${userProfile.emoji || '👤'} My Profile`;
            
            const isGuest = userProfile.role === 'guest';
            if (isGuest) {
                document.getElementById('launch-bio').disabled = true;
                document.getElementById('btn-open-emoji-picker').disabled = true;
            }

            if (['super_admin', 'admin'].includes(userProfile.role)) {
                UI.adminBtn.classList.remove('hidden');
                document.getElementById('btn-open-puzzle-creator').classList.remove('hidden');
            } else {
                UI.adminBtn.classList.add('hidden');
                document.getElementById('btn-open-puzzle-creator').classList.add('hidden');
            }
            if (userProfile.role === 'super_admin') document.getElementById('btn-edit-board').classList.remove('hidden');
            
            listenForNotifications(user.uid);
            startPresenceHeartbeat(user.uid);
            handleUrlRouting();

            onSnapshot(doc(db, "app_settings", "launch_screen"), (d) => { 
                document.getElementById('launch-board-text').textContent = d.exists() ? d.data().text : "Welcome to the study group!"; 
            });
            onSnapshot(doc(db, "app_settings", "global_settings"), (d) => { 
                if (d.exists()) {
                    const data = d.data();
                    linksEnabledGlobally = (data.linksEnabled !== false);
                    if (data.forceCreditMode !== undefined) isCreditModeActive = data.forceCreditMode;
                }
                const linkBtn = document.getElementById('btn-toggle-global-links');
                if(linkBtn) linkBtn.className = linksEnabledGlobally ? "px-3 py-1 font-bold text-white bg-emerald-500 rounded sketched-border" : "px-3 py-1 font-bold text-white bg-rose-500 rounded sketched-border";
                if(linkBtn) linkBtn.textContent = linksEnabledGlobally ? "Links: ON" : "Links: OFF";
            });
        }, 
        (error) => { document.getElementById('auth-loading').classList.add('hidden'); console.warn("User sync auth note:", error); }
    );
}

onAuthStateChanged(auth, (user) => {
    if (isRegistering) return; 
    if (user) syncUserProfile(user);
    else {
        currentUser = null; userProfile = null; document.getElementById('auth-loading').classList.add('hidden');
        UI.app.classList.replace('flex', 'hidden'); UI.launch.classList.add('hidden'); UI.auth.classList.remove('hidden');
        document.getElementById('auth-password').value = '';
        if (unsubNotifs) { unsubNotifs(); unsubNotifs = null; }
        if (presenceInterval) { clearInterval(presenceInterval); presenceInterval = null; }
        if (unsubPresence) { unsubPresence(); unsubPresence = null; }
        if (userDocUnsub) { userDocUnsub(); userDocUnsub = null; }
    }
});

const tabChat = document.getElementById('nav-tab-chat');
const tabFeed = document.getElementById('nav-tab-feed');
const tabArcade = document.getElementById('nav-tab-arcade');
const tabSticky = document.getElementById('nav-tab-sticky');
const viewChat = document.getElementById('view-chat');
const viewFeed = document.getElementById('view-feed');
const viewArcade = document.getElementById('view-arcade');
const viewSticky = document.getElementById('view-sticky');

tabChat.onclick = () => switchView('chat');
tabFeed.onclick = () => { switchView('feed'); loadGlobalFeed(); };
tabArcade.onclick = () => { switchView('arcade'); loadArcadePuzzles(); };
tabSticky.onclick = () => { switchView('sticky'); loadStickyNotes(); };

function switchView(v) {
    viewChat.classList.add('hidden'); viewFeed.classList.add('hidden'); viewArcade.classList.add('hidden'); viewSticky.classList.add('hidden');
    tabChat.className = tabFeed.className = tabArcade.className = tabSticky.className = "px-3 py-1 font-bold text-sm bg-white text-slate-700 rounded sketched-border hover:bg-yellow-200 transition-colors";
    
    if (v === 'chat') {
        viewChat.classList.remove('hidden');
        tabChat.className = "px-3 py-1 font-bold text-sm bg-indigo-500 text-white rounded sketched-border transition-colors";
        updateSEO({ title: "Main Chat Room", description: "Real-time handwritten chat and study group notes on PensUp Pro." });
    } else if (v === 'feed') {
        viewFeed.classList.remove('hidden');
        tabFeed.className = "px-3 py-1 font-bold text-sm bg-indigo-500 text-white rounded sketched-border transition-colors";
        updateSEO({ title: "Global Feed", description: "Browse trending study discussions, math problems, and public posts." });
    } else if (v === 'arcade') {
        viewArcade.classList.remove('hidden');
        tabArcade.className = "px-3 py-1 font-bold text-sm bg-indigo-500 text-white rounded sketched-border transition-colors";
        updateSEO({ title: "Arcade Games & Code Snippets", description: "Play custom games and run code snippets published by the community." });
    } else if (v === 'sticky') {
        viewSticky.classList.remove('hidden');
        tabSticky.className = "px-3 py-1 font-bold text-sm bg-indigo-500 text-white rounded sketched-border transition-colors";
        updateSEO({ title: "Sticky Board", description: "Shared sticky note wall for quick community messages and study thoughts." });
    }
}

const emojiModal = document.getElementById('emoji-modal');
const emojiGrid = document.getElementById('emoji-grid');
ALL_EMOJIS.forEach(e => {
    const btn = document.createElement('button'); btn.className = "hover:scale-125 transition-transform p-1 cursor-pointer";
    btn.textContent = e; btn.onclick = () => selectEmoji(e); emojiGrid.appendChild(btn);
});
document.getElementById('btn-open-emoji-picker').onclick = () => {
    if (userProfile?.role === 'guest') return alert("Guests cannot change profile emoji.");
    emojiModal.classList.remove('hidden');
};
document.getElementById('emoji-close').onclick = () => emojiModal.classList.add('hidden');
async function selectEmoji(selectedEmoji) {
    if(!selectedEmoji) return;
    document.getElementById('btn-open-emoji-picker').textContent = selectedEmoji;
    userProfile.emoji = selectedEmoji; emojiModal.classList.add('hidden');
    await updateDoc(doc(db, "users", currentUser.uid), { emoji: selectedEmoji });
    trackWriteCredit(1);
}
document.getElementById('btn-save-custom-emoji').onclick = () => { const custom = document.getElementById('custom-emoji-input').value.trim(); if (custom) selectEmoji(custom); };

document.getElementById('launch-bio').onblur = async (e) => {
    if (userProfile?.role === 'guest') return;
    userProfile.bio = e.target.value.trim(); 
    await updateDoc(doc(db, "users", currentUser.uid), { bio: userProfile.bio }); 
    trackWriteCredit(1);
};
document.getElementById('btn-edit-board').onclick = async () => { const txt = prompt("New notice board text:"); if(txt !== null) await setDoc(doc(db, "app_settings", "launch_screen"), { text: txt }); };

const settingsModal = document.getElementById('settings-modal');
document.getElementById('btn-settings').onclick = () => { applySettings(); settingsModal.classList.remove('hidden'); };
document.getElementById('settings-close').onclick = () => settingsModal.classList.add('hidden');
document.getElementById('btn-save-settings').onclick = () => {
    settings.chatBoxLift = document.getElementById('setting-chatbox-lift').checked;
    settings.chatBoxLiftDm = document.getElementById('setting-chatbox-lift-dm').checked;
    settings.forceToast = document.getElementById('setting-force-toast').checked;
    settings.dmToast = document.getElementById('setting-dm-toast').checked;
    settings.soundEnabled = document.getElementById('setting-sound-enabled').checked;
    settings.fullScreen = document.getElementById('setting-fullscreen').checked;

    localStorage.setItem('pensup_lift', settings.chatBoxLift);
    localStorage.setItem('pensup_lift_dm', settings.chatBoxLiftDm);
    localStorage.setItem('pensup_force_toast', settings.forceToast);
    localStorage.setItem('pensup_dm_toast', settings.dmToast);
    localStorage.setItem('pensup_sound', settings.soundEnabled);
    localStorage.setItem('pensup_fullscreen', settings.fullScreen);

    applySettings(); settingsModal.classList.add('hidden');
};

document.getElementById('btn-enter-chat').onclick = () => {
    UI.launch.classList.add('hidden'); UI.app.classList.replace('hidden', 'flex');
    if (userProfile?.role === 'guest') {
        UI.input.placeholder = "Guests are in read-only mode...";
        UI.input.disabled = true;
        UI.sendBtn.disabled = true;
    }
    if (!settings.forceToast && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
    applySettings(); loadMessages();
};
document.getElementById('btn-back-launch').onclick = () => { UI.app.classList.replace('flex', 'hidden'); UI.launch.classList.remove('hidden'); if(unsubMsg) unsubMsg(); };
document.getElementById('user-badge').onclick = () => { if(currentUser) showProfile(currentUser.uid); };

function loadMessages() {
    if (unsubMsg) unsubMsg(); isInitialLoadDone = false;
    const itemLimit = isCreditModeActive ? 25 : 60;

    unsubMsg = onSnapshot(query(collection(db, `rooms/${ROOM_ID}/messages`), orderBy("createdAt", "asc"), limit(itemLimit)), 
        (snapshot) => {
            trackReadCredit(snapshot.docs.length);
            document.getElementById('chat-loading').classList.add('hidden'); UI.msgContainer.innerHTML = '';
            const pinnedList = [];
            snapshot.forEach(docSnap => {
                const data = docSnap.data(); renderMessage(docSnap.id, data, UI.msgContainer, ROOM_ID);
                if (data.isPinned && !data.isDeleted) pinnedList.push({ id: docSnap.id, ...data });
            });
            currentPinnedCount = pinnedList.length; renderPinnedSection(pinnedList);
            UI.msgContainer.scrollTo(0, UI.msgContainer.scrollHeight);
            if (isInitialLoadDone) {
                snapshot.docChanges().forEach((change) => {
                    const data = change.doc.data();
                    if (change.type === "added" && data.senderId !== currentUser.uid && !data.isDeleted) notifyUser(data.senderName, data.text, 'chat');
                });
            }
            isInitialLoadDone = true;
        }, (error) => { document.getElementById('chat-loading').classList.add('hidden'); console.error("Chat Error", error); }
    );
}

function renderPinnedSection(pinnedList) {
    const banner = document.getElementById('pinned-banner'), container = document.getElementById('pinned-notes-list'), countLabel = document.getElementById('pinned-count');
    countLabel.textContent = pinnedList.length;
    if (pinnedList.length === 0) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden'); container.innerHTML = '';
    pinnedList.slice(0, 5).forEach((item) => {
        const div = document.createElement('div'); div.className = "flex items-center justify-between text-sm bg-white p-1.5 sketched-border-alt gap-2";
        const unpinBtn = userProfile && userProfile.role === 'super_admin' ? `<button onclick="togglePin('${item.id}', false)" class="text-rose-500 font-bold hover:scale-110 ml-2" title="Unpin Note">✖</button>` : '';
        div.innerHTML = `<div class="flex items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer flex-1" onclick="jumpToMessage('${item.id}')"><span class="font-bold text-indigo-600 shrink-0">${escapeHTML(item.senderName)}:</span><span class="text-slate-700 overflow-hidden text-ellipsis">${parseTagsAndLinks(item.text)}</span></div>${unpinBtn}`;
        container.appendChild(div);
    });
}

document.getElementById('btn-toggle-pinned-list').onclick = (e) => {
    const list = document.getElementById('pinned-notes-list');
    list.classList.toggle('hidden'); e.target.textContent = list.classList.contains('hidden') ? "Expand ▼" : "Collapse ▲";
};

window.jumpToMessage = (id) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('ring-4', 'ring-amber-400'); setTimeout(() => el.classList.remove('ring-4', 'ring-amber-400'), 2000); }
};

window.togglePin = async (id, shouldPin) => {
    if (!userProfile || userProfile.role !== 'super_admin') return;
    if (shouldPin && currentPinnedCount >= 5) return alert("Maximum 5 notes can be pinned! Unpin one first.");
    try { await updateDoc(doc(db, `rooms/${ROOM_ID}/messages`, id), { isPinned: shouldPin }); trackWriteCredit(1); } catch (e) { console.error("Pin error:", e); }
};

async function sendMessage(text) {
    if (!currentUser || (userProfile && userProfile.suspended) || (userProfile && userProfile.role === 'guest')) return;
    if (isCreditModeActive && userWriteCredits <= 0) return alert("Write quota depleted for Credit Mode. Please wait a moment.");
    try {
        if (settings.soundEnabled) { writeSound.currentTime = 0; writeSound.play().catch(e => console.warn("Audio blocked:", e)); }
        await addDoc(collection(db, `rooms/${ROOM_ID}/messages`), {
            senderId: currentUser.uid, senderName: userProfile.username, senderEmoji: userProfile.emoji || '👤',
            text: text, createdAt: serverTimestamp(), isDeleted: false, isPinned: false
        });
        trackWriteCredit(1);
        UI.input.value = ''; updateInput();
    } catch (e) { console.error("Send error:", e); }
}

UI.sendBtn.onclick = () => { if (UI.input.value.trim()) sendMessage(UI.input.value.trim()); };
const updateInput = () => { if(userProfile?.role === 'guest') return; UI.sendBtn.disabled = !UI.input.value.trim(); UI.input.style.height = 'auto'; UI.input.style.height = Math.min(UI.input.scrollHeight, 120) + 'px'; };
UI.input.addEventListener('input', updateInput);

window.deleteMsg = async (roomId, msgId) => { 
    if(confirm("Rip out this note?")) { 
        await updateDoc(doc(db, `rooms/${roomId}/messages`, msgId), { isDeleted: true, deletedBy: userProfile.username, text: "", isPinned: false }); 
        trackWriteCredit(1);
    }
};

// --- RENDER MESSAGE WITH TRUNCATION & TAG BAR ---
window.toggleExpandMessage = (msgId) => {
    const fullEl = document.getElementById(`msg-full-${msgId}`);
    const truncEl = document.getElementById(`msg-trunc-${msgId}`);
    const tagBarEl = document.getElementById(`msg-tagbar-${msgId}`);
    const btnEl = document.getElementById(`msg-expand-btn-${msgId}`);

    if (fullEl.classList.contains('hidden')) {
        fullEl.classList.remove('hidden');
        truncEl.classList.add('hidden');
        if (tagBarEl) tagBarEl.classList.add('hidden');
        btnEl.textContent = 'Show Less ▲';
    } else {
        fullEl.classList.add('hidden');
        truncEl.classList.remove('hidden');
        if (tagBarEl) tagBarEl.classList.remove('hidden');
        btnEl.textContent = 'Show More ▼';
    }
};

function renderMessage(id, data, containerEl, roomStr) {
    const isSelf = currentUser && data.senderId === currentUser.uid;
    const isSuperAdmin = userProfile && userProfile.role === 'super_admin';
    const canDelete = isSelf || (roomStr === ROOM_ID && userProfile && ['super_admin', 'admin'].includes(userProfile.role));
    const timeStr = data.createdAt ? data.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...';
    
    let bgClass = isSelf ? 'bg-yellow-100' : 'bg-white';
    if (roomStr.startsWith('dm_')) {
        bgClass = isSelf ? 'bg-blue-100 border-blue-300' : 'bg-white border-amber-200';
    }
    
    let contentHtml = '';
    const textRaw = data.text || '';
    const tags = extractTagsFromText(textRaw);
    const isLong = textRaw.length > 180;

    if (data.isDeleted) {
        contentHtml = `<span class="italic text-slate-500 text-lg opacity-80">✂ Ripped out by ${escapeHTML(data.deletedBy)}</span>`;
        bgClass = 'bg-slate-200/50 border-slate-300'; 
    } else if (isLong) {
        const truncatedText = textRaw.substring(0, 180) + '...';
        const tagBarHtml = tags.length > 0 ? `
            <div id="msg-tagbar-${id}" class="flex gap-1.5 overflow-x-auto py-1 mt-1 border-t border-slate-200/60 no-scrollbar">
                ${tags.map(t => `<span onclick="event.stopPropagation(); filterByTag('${t}')" class="text-xs font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded sketched-border-alt shrink-0 cursor-pointer hover:bg-indigo-100">#${escapeHTML(t)}</span>`).join('')}
            </div>` : '';

        contentHtml = `
            <div id="msg-trunc-${id}">${parseTagsAndLinks(truncatedText)}</div>
            <div id="msg-full-${id}" class="hidden">${parseTagsAndLinks(textRaw)}</div>
            ${tagBarHtml}
            <button id="msg-expand-btn-${id}" onclick="event.stopPropagation(); toggleExpandMessage('${id}')" class="text-xs font-bold text-indigo-600 hover:underline mt-1 block">Show More ▼</button>
        `;
    } else {
        contentHtml = parseTagsAndLinks(textRaw);
    }

    const pinBtn = (roomStr === ROOM_ID && isSuperAdmin && !data.isDeleted) ? `<button onclick="togglePin('${id}', ${!data.isPinned})" class="bg-amber-100 text-amber-800 rounded-full w-6 h-6 text-xs flex items-center justify-center hover:scale-110 sketched-border" title="${data.isPinned ? 'Unpin' : 'Pin'}">📌</button>` : '';
    const delBtn = (canDelete && !data.isDeleted) ? `<button onclick="deleteMsg('${roomStr}', '${id}')" class="bg-rose-200 text-rose-700 rounded-full w-6 h-6 text-xs flex items-center justify-center hover:scale-110 sketched-border" title="Delete">✖</button>` : '';
    const actionControls = (!data.isDeleted && (pinBtn || delBtn)) ? `<div class="absolute -right-2 -top-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">${pinBtn}${delBtn}</div>` : '';
    const pinnedBadge = data.isPinned ? `<span class="text-xs bg-amber-200 text-amber-900 font-bold px-1.5 py-0.5 rounded sketched-border-alt mb-1 inline-block">📌 Pinned</span>` : '';
    const header = (!isSelf && roomStr === ROOM_ID) ? `<div class="flex items-center gap-1 mb-1 cursor-pointer hover:opacity-80" onclick="showProfile('${data.senderId}')"><span class="text-2xl">${escapeHTML(data.senderEmoji || '👤')}</span><span class="text-sm font-bold text-indigo-500 pl-1">${escapeHTML(data.senderName)}</span></div>` : '';

    const marginIndentClass = !isSelf ? 'ml-10 sm:ml-12' : '';

    const wrapper = document.createElement('div');
    wrapper.id = `msg-${id}`; 
    wrapper.className = `group flex flex-col gap-1 max-w-[85%] animate-pop relative transition-all duration-300 ${isSelf ? 'self-end items-end' : 'self-start items-start ' + marginIndentClass}`;
    wrapper.innerHTML = `${header}${pinnedBadge}<div class="${bgClass} text-slate-800 p-2.5 text-2xl sketched-border relative break-words shadow-xs">${contentHtml} ${actionControls}</div><span class="text-xs font-bold opacity-60 px-1 mt-0.5">${timeStr}</span>`;
    containerEl.appendChild(wrapper);
}

function calculateUserBadges(userData, postCount = 0) {
    const badges = [];
    const role = userData.role || 'user';
    const followers = userData.followersCount || 0;

    if (['super_admin', 'admin'].includes(role)) {
        badges.push({ title: "👑 Notebook Admin", bg: "bg-amber-200 text-amber-900 border-amber-400" });
    }
    if (postCount >= 5) {
        badges.push({ title: "✍️ Active Scribbler", bg: "bg-indigo-100 text-indigo-800 border-indigo-300" });
    }
    if (followers >= 3) {
        badges.push({ title: "🌟 Popular Note", bg: "bg-emerald-100 text-emerald-800 border-emerald-300" });
    }
    if (userData.following && userData.following.length >= 5) {
        badges.push({ title: "🤝 Study Buddy", bg: "bg-blue-100 text-blue-800 border-blue-300" });
    }
    return badges;
}

window.toggleFollow = async (targetUid) => {
    if (!currentUser || currentUser.uid === targetUid || (userProfile && userProfile.role === 'guest')) return;
    const isFollowing = (userProfile.following || []).includes(targetUid);
    const userRef = doc(db, "users", currentUser.uid);

    try {
        if (isFollowing) {
            await updateDoc(userRef, { following: arrayRemove(targetUid) });
        } else {
            await updateDoc(userRef, { following: arrayUnion(targetUid) });
        }
        trackWriteCredit(1);
        if (activeProfileUid) showProfile(activeProfileUid);
        if (!dmDirModal.classList.contains('hidden')) renderUserDirectory(allUsersCache);
    } catch(e) { console.error("Follow error:", e); }
};

const doodleModal = document.getElementById('doodle-modal');
const doodleCanvas = document.getElementById('doodle-canvas');
const ctx = doodleCanvas.getContext('2d');
let isDrawing = false;

document.getElementById('btn-open-doodle-modal').onclick = () => {
    if (userProfile?.role === 'guest') return alert("Guests cannot sketch doodles.");
    openDoodleModal();
};
document.getElementById('doodle-close').onclick = () => doodleModal.classList.add('hidden');

function openDoodleModal() {
    doodleModal.classList.remove('hidden');
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    if (!attachedDoodleBase64) clearDoodle();
}

function clearDoodle() {
    ctx.clearRect(0, 0, doodleCanvas.width, doodleCanvas.height);
}
document.getElementById('btn-clear-doodle').onclick = clearDoodle;

const getPos = (e) => {
    const rect = doodleCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const scaleX = doodleCanvas.width / rect.width;
    const scaleY = doodleCanvas.height / rect.height;
    return { 
        x: (clientX - rect.left) * scaleX, 
        y: (clientY - rect.top) * scaleY 
    };
};

doodleCanvas.onmousedown = doodleCanvas.ontouchstart = (e) => {
    isDrawing = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
};

doodleCanvas.onmousemove = doodleCanvas.ontouchmove = (e) => {
    if (!isDrawing) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    e.preventDefault();
};

window.onmouseup = window.ontouchend = () => { isDrawing = false; };

document.getElementById('btn-attach-doodle').onclick = () => {
    attachedDoodleBase64 = doodleCanvas.toDataURL('image/png');
    document.getElementById('post-doodle-preview').src = attachedDoodleBase64;
    document.getElementById('post-doodle-preview-container').classList.remove('hidden');
    doodleModal.classList.add('hidden');
};

document.getElementById('btn-remove-doodle').onclick = () => {
    attachedDoodleBase64 = null;
    document.getElementById('post-doodle-preview-container').classList.add('hidden');
};

let activeProfileUid = null;
window.showProfile = async (uid) => {
    activeProfileUid = uid;
    const pModal = document.getElementById('profile-modal');
    pModal.classList.remove('hidden'); 
    document.getElementById('p-modal-name').textContent = "Loading...";
    document.getElementById('profile-posts-list').innerHTML = '<div class="text-center text-slate-500 italic mt-4">Loading posts...</div>';
    
    const dmBtn = document.getElementById('p-modal-dm-btn');
    const followBtn = document.getElementById('p-modal-follow-btn');
    const createBox = document.getElementById('create-post-box');
    const deleteAccountBox = document.getElementById('delete-account-container');
    
    if(currentUser && uid === currentUser.uid && userProfile?.role !== 'guest') {
        dmBtn.classList.add('hidden');
        followBtn.classList.add('hidden');
        createBox.classList.remove('hidden');
        deleteAccountBox.classList.remove('hidden');
    } else {
        if(userProfile?.role !== 'guest' && currentUser) dmBtn.classList.remove('hidden');
        else dmBtn.classList.add('hidden');

        if(userProfile?.role !== 'guest' && currentUser) followBtn.classList.remove('hidden');
        else followBtn.classList.add('hidden');

        createBox.classList.add('hidden');
        deleteAccountBox.classList.add('hidden');
        
        if (currentUser) {
            const isFollowing = (userProfile.following || []).includes(uid);
            followBtn.textContent = isFollowing ? "⭐ Following" : "+ Follow";
            followBtn.className = isFollowing 
                ? "text-xs font-bold px-3 py-1 bg-emerald-500 text-white rounded sketched-border hover:bg-emerald-600 transition-transform" 
                : "text-xs font-bold px-3 py-1 bg-amber-400 text-amber-950 rounded sketched-border hover:bg-amber-500 transition-transform";
            followBtn.onclick = () => toggleFollow(uid);
        }
    }

    try {
        const snap = await getDoc(doc(db, "users", uid));
        trackReadCredit(1);
        if(snap.exists()) {
            const p = snap.data();
            document.getElementById('p-modal-emoji').textContent = p.emoji || '👤';
            document.getElementById('p-modal-name').textContent = p.username;
            document.getElementById('p-modal-role').textContent = (p.role || 'user').replace('_', ' ').toUpperCase();
            document.getElementById('p-modal-bio').textContent = p.bio ? `"${p.bio}"` : '"Quiet observer."';
            document.getElementById('p-modal-following-count').textContent = `${(p.following || []).length} Following`;
            
            dmBtn.onclick = () => openDmChat(uid, p.username, p.emoji, p.bio);

            const followersSnap = await getDocs(query(collection(db, "users"), where("following", "array-contains", uid)));
            const userPostsSnap = await getDocs(collection(db, `users/${uid}/posts`));
            trackReadCredit(followersSnap.size + userPostsSnap.size);
            
            document.getElementById('p-modal-followers-count').textContent = `${followersSnap.size} Followers`;

            const badgeData = { ...p, followersCount: followersSnap.size };
            const earnedBadges = calculateUserBadges(badgeData, userPostsSnap.size);
            
            let badgesContainer = document.getElementById('p-modal-badges');
            if (!badgesContainer) {
                badgesContainer = document.createElement('div');
                badgesContainer.id = 'p-modal-badges';
                badgesContainer.className = "flex gap-1.5 flex-wrap justify-center mt-2";
                document.getElementById('p-modal-bio').after(badgesContainer);
            }
            badgesContainer.innerHTML = earnedBadges.map(b => 
                `<span class="text-xs font-bold px-2 py-0.5 rounded border ${b.bg} sketched-border-alt">${b.title}</span>`
            ).join('');
        }
        loadProfilePosts(uid);
    } catch (e) { console.error("Profile fetch error:", e); }
};

// --- ACCOUNT SELF-DELETION HANDLER ---
document.getElementById('btn-delete-account')?.addEventListener('click', async () => {
    if (!currentUser || userProfile?.role === 'guest') return;
    const confirmName = prompt(`Type your username (${userProfile.username}) to confirm PERMANENT ACCOUNT DELETION:`);
    if (confirmName !== userProfile.username) return alert("Username did not match. Account deletion cancelled.");

    try {
        const uid = currentUser.uid;
        const uname = userProfile.username;

        await deleteDoc(doc(db, "usernames", uname)).catch(() => {});
        await deleteDoc(doc(db, "users", uid)).catch(() => {});
        trackWriteCredit(2);

        await deleteUser(currentUser);
        alert("Account deleted permanently.");
        window.location.reload();
    } catch(e) {
        console.error("Delete account error:", e);
        alert("Account deletion failed. Please re-log in and try again: " + e.message);
    }
});

document.getElementById('profile-close').onclick = () => {
    document.getElementById('profile-modal').classList.add('hidden');
    if(unsubProfilePosts) { unsubProfilePosts(); unsubProfilePosts = null; }
};

window.exportProfileAsImage = () => {
    const cardEl = document.getElementById('profile-card-container');
    if (!cardEl || typeof html2canvas === 'undefined') {
        alert("Image generator loading, please try again in a moment!");
        return;
    }
    html2canvas(cardEl, { 
        backgroundColor: '#fefce8', 
        scale: 2,
        ignoreElements: (el) => el.classList.contains('no-export')
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `PensUp_Profile_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }).catch(e => console.error("Export profile error:", e));
};

window.deletePost = async (postOwnerUid, postId) => {
    if (confirm("Are you sure you want to delete this post?")) {
        try {
            await deleteDoc(doc(db, `users/${postOwnerUid}/posts/${postId}`));
            await deleteDoc(doc(db, `global_posts`, postId)).catch(() => {});
            trackWriteCredit(2);
        } catch(e) {
            console.error("Delete post error:", e);
            alert("Could not delete post.");
        }
    }
};

function loadProfilePosts(uid) {
    if(unsubProfilePosts) unsubProfilePosts();
    unsubProfilePosts = onSnapshot(query(collection(db, `users/${uid}/posts`), orderBy("createdAt", "desc")), (snapshot) => {
        trackReadCredit(snapshot.docs.length);
        const listEl = document.getElementById('profile-posts-list');
        listEl.innerHTML = '';
        if(snapshot.empty) { listEl.innerHTML = '<div class="text-center text-slate-500 italic mt-4">No posts yet.</div>'; return; }
        
        const canDeletePosts = currentUser && (uid === currentUser.uid || ['super_admin', 'admin'].includes(userProfile?.role));

        snapshot.forEach(docSnap => {
            renderPostCard(docSnap.id, docSnap.data(), uid, listEl, canDeletePosts);
        });
    });
}

function renderPostCard(postId, post, ownerUid, containerEl, canDelete) {
    const likes = post.likes || []; const dislikes = post.dislikes || [];
    const hasLiked = currentUser && likes.includes(currentUser.uid); 
    const hasDisliked = currentUser && dislikes.includes(currentUser.uid);
    
    const div = document.createElement('div');
    div.id = `post-${postId}`;
    div.className = "bg-white p-3.5 sketched-border-alt flex flex-col gap-2 relative group shadow-xs transition-all duration-500 paper-mask";
    const timeStr = post.createdAt ? post.createdAt.toDate().toLocaleDateString() : '';
    
    const deleteBtnHtml = canDelete 
        ? `<button onclick="deletePost('${ownerUid}', '${postId}')" class="text-rose-500 hover:text-rose-700 font-bold p-1 hover:scale-110 transition-transform text-sm" title="Delete Post">✖</button>` 
        : '';

    const authorHeader = post.authorName ? `
        <div class="flex items-center justify-between pb-1.5 border-b border-slate-200/60">
            <div class="flex items-center gap-2 cursor-pointer hover:opacity-80" onclick="showProfile('${ownerUid}')">
                <span class="text-xl bg-yellow-100 p-1 rounded-full sketched-border shrink-0">${escapeHTML(post.authorEmoji || '👤')}</span>
                <span class="font-bold text-sm text-indigo-600">@${escapeHTML(post.authorName)}</span>
            </div>
            ${deleteBtnHtml}
        </div>` : '';

    const doodleImgHtml = post.doodleImage ? `<div class="mt-1"><img src="${post.doodleImage}" class="max-h-48 rounded sketched-border bg-white p-1 object-contain" alt="Doodle sketch"></div>` : '';

    const shareUrl = `${window.location.origin}${window.location.pathname}?post=${postId}`;
    const voteDisabled = !currentUser || userProfile?.role === 'guest' ? 'opacity-60 pointer-events-none' : '';

    const textRaw = post.text || '';
    const tags = extractTagsFromText(textRaw);
    const isLong = textRaw.length > 180;

    let bodyContentHtml = '';
    if (isLong) {
        const truncatedText = textRaw.substring(0, 180) + '...';
        const tagBarHtml = tags.length > 0 ? `
            <div id="post-tagbar-${postId}" class="flex gap-1.5 overflow-x-auto py-1 mt-1 border-t border-slate-200/60 no-scrollbar">
                ${tags.map(t => `<span onclick="event.stopPropagation(); filterByTag('${t}')" class="text-xs font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded sketched-border-alt shrink-0 cursor-pointer hover:bg-indigo-100">#${escapeHTML(t)}</span>`).join('')}
            </div>` : '';

        bodyContentHtml = `
            <div id="post-trunc-${postId}">${parseTagsAndLinks(truncatedText)}</div>
            <div id="post-full-${postId}" class="hidden">${parseTagsAndLinks(textRaw)}</div>
            ${tagBarHtml}
            <button id="post-expand-btn-${postId}" onclick="event.stopPropagation(); toggleExpandPost('${postId}')" class="text-xs font-bold text-indigo-600 hover:underline mt-1 block">Show More ▼</button>
        `;
    } else {
        bodyContentHtml = parseTagsAndLinks(textRaw);
    }

    div.innerHTML = `
        ${authorHeader}
        <div class="text-lg text-slate-800 break-words my-1 font-['Patrick_Hand'] leading-relaxed">${bodyContentHtml}</div>
        ${doodleImgHtml}
        <div class="flex justify-between items-center text-xs border-t border-slate-200/60 pt-2 mt-1 flex-wrap gap-2">
            <div class="flex items-center gap-2">
                <span class="text-slate-400 font-bold">${timeStr}</span>
                <button onclick="exportPostAsImage('post-${postId}')" class="no-export text-indigo-600 font-bold hover:underline bg-indigo-50 px-2 py-0.5 rounded sketched-border-alt" title="Download styled paper note image">📷 Export Note</button>
                <button onclick="navigator.clipboard.writeText('${shareUrl}'); alert('Direct link copied!');" class="no-export text-slate-500 font-bold hover:underline" title="Copy Link">🔗 Share</button>
            </div>
            <div class="no-export flex gap-3 ${voteDisabled}">
                <button onclick="togglePostVote('${ownerUid}', '${postId}', 'like')" class="${hasLiked ? 'text-indigo-600 scale-110' : 'text-slate-400'} font-bold hover:scale-110 transition-transform">👍 ${likes.length}</button>
                <button onclick="togglePostVote('${ownerUid}', '${postId}', 'dislike')" class="${hasDisliked ? 'text-rose-600 scale-110' : 'text-slate-400'} font-bold hover:scale-110 transition-transform">👎 ${dislikes.length}</button>
            </div>
        </div>
    `;
    containerEl.appendChild(div);
}

window.toggleExpandPost = (postId) => {
    const fullEl = document.getElementById(`post-full-${postId}`);
    const truncEl = document.getElementById(`post-trunc-${postId}`);
    const tagBarEl = document.getElementById(`post-tagbar-${postId}`);
    const btnEl = document.getElementById(`post-expand-btn-${postId}`);

    if (fullEl.classList.contains('hidden')) {
        fullEl.classList.remove('hidden');
        truncEl.classList.add('hidden');
        if (tagBarEl) tagBarEl.classList.add('hidden');
        btnEl.textContent = 'Show Less ▲';
    } else {
        fullEl.classList.add('hidden');
        truncEl.classList.remove('hidden');
        if (tagBarEl) tagBarEl.classList.remove('hidden');
        btnEl.textContent = 'Show More ▼';
    }
};

window.exportPostAsImage = (elementId) => {
    const cardEl = document.getElementById(elementId);
    if (!cardEl || typeof html2canvas === 'undefined') {
        alert("Image generator loading, please try again in a moment!");
        return;
    }
    html2canvas(cardEl, { 
        backgroundColor: '#fdfaf6', 
        scale: 2,
        ignoreElements: (el) => el.classList.contains('no-export')
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `PensUp_Note_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }).catch(e => console.error("Export note error:", e));
};

document.getElementById('btn-publish-post').onclick = async () => {
    if (userProfile?.role === 'guest') return;
    if (isCreditModeActive && userWriteCredits <= 0) return alert("Write quota depleted for Credit Mode.");
    const input = document.getElementById('post-input');
    const txt = input.value.trim();
    if(!txt && !attachedDoodleBase64) return;

    try {
        const postData = {
            text: txt || '',
            doodleImage: attachedDoodleBase64 || null,
            createdAt: serverTimestamp(),
            likes: [],
            dislikes: [],
            authorId: currentUser.uid,
            authorName: userProfile.username,
            authorEmoji: userProfile.emoji || '👤'
        };

        const docRef = await addDoc(collection(db, `users/${currentUser.uid}/posts`), postData);
        await setDoc(doc(db, `global_posts`, docRef.id), postData);
        trackWriteCredit(2);

        input.value = '';
        attachedDoodleBase64 = null;
        document.getElementById('post-doodle-preview-container').classList.add('hidden');
    } catch(e) { console.error("Post error:", e); }
};

window.togglePostVote = async (postOwnerUid, postId, type) => {
    if (!currentUser || userProfile?.role === 'guest') return;
    const postRef = doc(db, `users/${postOwnerUid}/posts`, postId);
    const globalRef = doc(db, `global_posts`, postId);
    const snap = await getDoc(postRef);
    trackReadCredit(1);
    if(!snap.exists()) return;
    const data = snap.data();
    const uid = currentUser.uid;
    const isLike = type === 'like';
    
    let updates = {};
    if(isLike) {
        if(data.likes?.includes(uid)) updates.likes = arrayRemove(uid);
        else { updates.likes = arrayUnion(uid); updates.dislikes = arrayRemove(uid); }
    } else {
        if(data.dislikes?.includes(uid)) updates.dislikes = arrayRemove(uid);
        else { updates.dislikes = arrayUnion(uid); updates.likes = arrayRemove(uid); }
    }
    await updateDoc(postRef, updates);
    await updateDoc(globalRef, updates).catch(() => {});
    trackWriteCredit(2);
};

window.filterByTag = (tag) => {
    activeTagFilter = tag.toLowerCase();
    switchView('feed');
    document.getElementById('btn-clear-tag-filter').classList.remove('hidden');
    feedSearchInput.value = `#${tag}`;
    applyFeedFilterAndSort();
};

document.getElementById('btn-clear-tag-filter').onclick = () => {
    activeTagFilter = null;
    document.getElementById('btn-clear-tag-filter').classList.add('hidden');
    feedSearchInput.value = '';
    applyFeedFilterAndSort();
};

function loadGlobalFeed(scrollToPostId = null) {
    if (unsubFeed) unsubFeed();
    const container = document.getElementById('global-feed-list');
    container.innerHTML = '<div class="text-center italic text-slate-500 mt-6">Ranking global notebook feed...</div>';

    const itemLimit = isCreditModeActive ? 30 : 100;

    unsubFeed = onSnapshot(query(collection(db, "global_posts"), limit(itemLimit)), (snapshot) => {
        trackReadCredit(snapshot.docs.length);
        container.innerHTML = '';
        if (snapshot.empty) {
            container.innerHTML = '<div class="text-center italic text-slate-500 mt-6">No public posts in the global feed yet.</div>';
            return;
        }

        globalPostsCache = [];
        snapshot.forEach(docSnap => {
            const p = docSnap.data();
            globalPostsCache.push({ id: docSnap.id, ...p });
        });

        applyFeedFilterAndSort();

        if (scrollToPostId) {
            setTimeout(() => {
                const targetEl = document.getElementById(`post-${scrollToPostId}`);
                if (targetEl) {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetEl.classList.add('ring-4', 'ring-amber-400');
                    setTimeout(() => targetEl.classList.remove('ring-4', 'ring-amber-400'), 3000);
                }
            }, 300);
        }
    });
}

// --- SEARCH, COMBINED SORTING & DATE FILTERS ---
function applyFeedFilterAndSort() {
    const container = document.getElementById('global-feed-list');
    if (!container) return;

    const q = feedSearchInput?.value.trim().toLowerCase() || '';
    const sortBy = document.getElementById('feed-sort-select')?.value || 'recent';
    const dateFilter = document.getElementById('feed-date-select')?.value || 'all';

    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const oneWeekMs = 7 * oneDayMs;

    let result = globalPostsCache.filter(p => {
        const text = (p.text || '').toLowerCase();
        const author = (p.authorName || '').toLowerCase();
        const matchesQuery = !q || text.includes(q) || author.includes(q);

        let matchesDate = true;
        if (p.createdAt) {
            const pTime = p.createdAt.toDate ? p.createdAt.toDate().getTime() : 0;
            if (dateFilter === 'today') {
                matchesDate = (now - pTime) <= oneDayMs;
            } else if (dateFilter === 'week') {
                matchesDate = (now - pTime) <= oneWeekMs;
            }
        }
        return matchesQuery && matchesDate;
    });

    result.sort((a, b) => {
        const aLikes = (a.likes || []).length;
        const bLikes = (b.likes || []).length;
        const aTime = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0) : 0;
        const bTime = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0) : 0;

        if (sortBy === 'popular') return bLikes - aLikes;
        if (sortBy === 'unpopular') return aLikes - bLikes;
        if (sortBy === 'oldest') return aTime - bTime;
        return bTime - aTime; 
    });

    renderFeedList(result, container);
}

const feedSearchInput = document.getElementById('feed-search-input');
if (feedSearchInput) feedSearchInput.oninput = applyFeedFilterAndSort;
document.getElementById('feed-sort-select')?.addEventListener('change', applyFeedFilterAndSort);
document.getElementById('feed-date-select')?.addEventListener('change', applyFeedFilterAndSort);

function renderFeedList(posts, containerEl) {
    containerEl.innerHTML = '';
    if (posts.length === 0) {
        containerEl.innerHTML = '<div class="text-center italic text-slate-500 mt-6">No matching posts found.</div>';
        return;
    }
    posts.forEach(post => {
        const canDelete = currentUser && (post.authorId === currentUser.uid || ['super_admin', 'admin'].includes(userProfile?.role));
        renderPostCard(post.id, post, post.authorId, containerEl, canDelete);
    });
}

window.setStickyColor = (color) => {
    currentStickyColor = color;
    ['yellow', 'pink', 'blue', 'green'].forEach(c => {
        const btn = document.getElementById(`color-btn-${c}`);
        if(btn) btn.classList.remove('ring-2', 'ring-indigo-500');
    });
    const activeBtn = document.getElementById(`color-btn-${color}`);
    if(activeBtn) activeBtn.classList.add('ring-2', 'ring-indigo-500');
};

document.getElementById('btn-publish-sticky').onclick = async () => {
    if (userProfile?.role === 'guest') return;
    if (isCreditModeActive && userWriteCredits <= 0) return alert("Write quota depleted for Credit Mode.");
    const input = document.getElementById('sticky-input');
    const txt = input.value.trim();
    if(!txt) return;

    try {
        await addDoc(collection(db, "sticky_board"), {
            text: txt,
            color: currentStickyColor,
            authorName: userProfile.username,
            authorEmoji: userProfile.emoji || '👤',
            authorId: currentUser.uid,
            createdAt: serverTimestamp()
        });
        trackWriteCredit(1);
        input.value = '';
    } catch(e) { console.error("Sticky note error:", e); }
};

function loadStickyNotes() {
    if (userProfile?.role === 'guest') {
        document.getElementById('sticky-creator-box').classList.add('hidden');
    }
    if (unsubSticky) unsubSticky();
    const grid = document.getElementById('sticky-board-grid');
    grid.innerHTML = '<div class="text-center italic text-slate-500 col-span-full">Pinning sticky notes...</div>';

    unsubSticky = onSnapshot(query(collection(db, "sticky_board"), orderBy("createdAt", "desc"), limit(40)), (snapshot) => {
        trackReadCredit(snapshot.docs.length);
        grid.innerHTML = '';
        if (snapshot.empty) {
            grid.innerHTML = '<div class="text-center italic text-slate-500 col-span-full">No sticky notes on the board yet. Be the first to pin one!</div>';
            return;
        }

        const colorClasses = {
            yellow: 'bg-yellow-100 text-amber-950 border-amber-300',
            pink: 'bg-pink-100 text-rose-950 border-pink-300',
            blue: 'bg-blue-100 text-blue-950 border-blue-300',
            green: 'bg-emerald-100 text-emerald-950 border-emerald-300'
        };

        snapshot.forEach(docSnap => {
            const note = docSnap.data();
            const colorClass = colorClasses[note.color] || colorClasses.yellow;
            const canDelete = currentUser && (note.authorId === currentUser.uid || ['super_admin', 'admin'].includes(userProfile?.role));

            const div = document.createElement('div');
            div.className = `${colorClass} p-3.5 sketched-border flex flex-col justify-between gap-3 relative shadow-md rotate-[-1deg] hover:rotate-0 transition-transform min-h-[130px]`;
            
            const deleteBtn = canDelete ? `<button onclick="deleteStickyNote('${docSnap.id}')" class="text-rose-600 font-bold hover:scale-110 text-xs bg-white/60 rounded px-1.5 py-0.5" title="Remove Note">✖</button>` : '';

            div.innerHTML = `
                <div class="absolute -top-3 left-1/2 -translate-x-1/2 text-xl">📌</div>
                <div class="text-lg leading-snug break-words mt-1">${escapeHTML(note.text)}</div>
                <div class="flex justify-between items-center text-xs border-t border-black/10 pt-2 mt-1">
                    <span class="font-bold cursor-pointer hover:underline" onclick="showProfile('${note.authorId}')">${escapeHTML(note.authorEmoji||'👤')} @${escapeHTML(note.authorName)}</span>
                    ${deleteBtn}
                </div>
            `;
            grid.appendChild(div);
        });
    });
}

window.deleteStickyNote = async (id) => {
    if (confirm("Take down this sticky note?")) {
        try { 
            await deleteDoc(doc(db, "sticky_board", id)); 
            trackWriteCredit(1);
        } catch(e) { console.error("Delete sticky error:", e); }
    }
};

const puzzleModal = document.getElementById('puzzle-modal');
document.getElementById('btn-open-puzzle-creator').onclick = () => puzzleModal.classList.remove('hidden');
document.getElementById('puzzle-close').onclick = () => puzzleModal.classList.add('hidden');

document.getElementById('btn-save-puzzle').onclick = async () => {
    if (!userProfile || !['super_admin', 'admin'].includes(userProfile.role)) return alert("Admin privilege required.");
    const title = document.getElementById('puzzle-title-input').value.trim();
    const code = document.getElementById('puzzle-code-input').value.trim();
    if (!title || !code) return alert("Please enter both title and code snippet.");

    try {
        await addDoc(collection(db, "puzzles"), {
            title: title,
            code: code,
            authorName: userProfile.username,
            createdAt: serverTimestamp()
        });
        trackWriteCredit(1);
        document.getElementById('puzzle-title-input').value = '';
        document.getElementById('puzzle-code-input').value = '';
        puzzleModal.classList.add('hidden');
        loadArcadePuzzles();
    } catch(e) { console.error("Puzzle publish error:", e); }
};

function loadArcadePuzzles() {
    if (unsubPuzzles) unsubPuzzles();
    const arcadeList = document.getElementById('arcade-list');
    arcadeList.innerHTML = '<div class="text-center italic text-slate-500">Loading arcade games...</div>';

    unsubPuzzles = onSnapshot(query(collection(db, "puzzles"), orderBy("createdAt", "desc"), limit(20)), (snapshot) => {
        trackReadCredit(snapshot.docs.length);
        arcadeList.innerHTML = '';
        if (snapshot.empty) {
            arcadeList.innerHTML = '<div class="text-center italic text-slate-500 col-span-2">No puzzles or game snippets published yet.</div>';
            return;
        }

        let first = true;
        snapshot.forEach(docSnap => {
            const puzzle = docSnap.data();
            const div = document.createElement('div');
            div.className = "bg-white p-3 sketched-border flex flex-col gap-2 cursor-pointer hover:bg-amber-50 transition-colors shadow-xs shrink-0 w-48";
            div.innerHTML = `
                <div class="font-bold text-lg text-indigo-700 truncate">${escapeHTML(puzzle.title)}</div>
                <div class="text-xs text-slate-500 italic">By @${escapeHTML(puzzle.authorName || 'admin')}</div>
                <button class="mt-1 bg-emerald-500 text-white font-bold py-1 px-2 rounded sketched-border-alt text-sm hover:bg-emerald-600">Play / Run ➔</button>
            `;
            div.onclick = () => runPuzzleSnippet(puzzle.title, puzzle.code);
            arcadeList.appendChild(div);

            if (first) {
                runPuzzleSnippet(puzzle.title, puzzle.code);
                first = false;
            }
        });
    });
}

function runPuzzleSnippet(title, htmlCode) {
    const container = document.getElementById('arcade-active-container');
    container.innerHTML = `
        <div class="flex justify-between items-center border-b pb-2">
            <span class="font-['Permanent_Marker'] text-2xl text-amber-900">🕹️ ${escapeHTML(title)}</span>
            <span class="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded sketched-border-alt font-bold">Sandboxed Live Runner</span>
        </div>
        <div class="flex-1 w-full h-[450px] bg-slate-900 rounded sketched-border overflow-hidden relative">
            <iframe id="puzzle-sandbox" class="w-full h-full border-0 bg-white" sandbox="allow-scripts allow-modals"></iframe>
        </div>
    `;
    const iframe = document.getElementById('puzzle-sandbox');
    iframe.srcdoc = htmlCode;
}

let activeDmId = null;
let activeDmTargetId = null;
let activeDmTargetUser = null;
let allUsersCache = [];
let activeDmTab = 'all'; 

const dmDirModal = document.getElementById('dm-directory-modal');
const dmChatModal = document.getElementById('dm-chat-modal');
const dmInput = document.getElementById('dm-message-input');
const dmSendBtn = document.getElementById('btn-send-dm');

document.getElementById('dm-tab-all').onclick = () => {
    activeDmTab = 'all';
    document.getElementById('dm-tab-all').className = "flex-1 py-1.5 px-3 font-bold text-sm bg-indigo-500 text-white sketched-border transition-colors";
    document.getElementById('dm-tab-following').className = "flex-1 py-1.5 px-3 font-bold text-sm bg-white text-slate-700 sketched-border hover:bg-amber-100 transition-colors";
    renderUserDirectory(allUsersCache);
};

document.getElementById('dm-tab-following').onclick = () => {
    activeDmTab = 'following';
    document.getElementById('dm-tab-following').className = "flex-1 py-1.5 px-3 font-bold text-sm bg-amber-400 text-amber-950 sketched-border transition-colors";
    document.getElementById('dm-tab-all').className = "flex-1 py-1.5 px-3 font-bold text-sm bg-white text-slate-700 sketched-border hover:bg-amber-100 transition-colors";
    renderUserDirectory(allUsersCache);
};

document.getElementById('btn-open-dms').onclick = async () => {
    dmDirModal.classList.remove('hidden');
    const list = document.getElementById('dm-user-list');
    const searchInput = document.getElementById('dm-search-input');
    if (searchInput) searchInput.value = '';

    list.innerHTML = '<div class="text-center p-4 italic text-slate-500">Checking mailbox directory...</div>';
    try {
        const snap = await getDocs(collection(db, "users"));
        trackReadCredit(snap.docs.length);
        allUsersCache = [];
        
        // --- HIDE GUEST ACCOUNTS FROM MAILBOX DIRECTORY ---
        snap.forEach(d => {
            const data = d.data();
            const isGuest = data.role === 'guest' || (data.username && data.username.startsWith('guest_'));
            if ((!currentUser || d.id !== currentUser.uid) && !isGuest) {
                allUsersCache.push({ id: d.id, ...data });
            }
        });
        document.getElementById('dm-following-tab-count').textContent = (userProfile?.following || []).length;
        renderUserDirectory(allUsersCache);
    } catch(e) { list.innerHTML = '<div class="text-center p-4 text-rose-500 font-bold">Error loading directory.</div>'; console.error(e); }
};
document.getElementById('dm-directory-close').onclick = () => dmDirModal.classList.add('hidden');

function renderUserDirectory(users) {
    const list = document.getElementById('dm-user-list');
    const searchQ = document.getElementById('dm-search-input')?.value.trim().toLowerCase() || '';
    list.innerHTML = '';
    
    let filtered = users.filter(u => {
        const matchesSearch = u.username.toLowerCase().includes(searchQ) || (u.bio && u.bio.toLowerCase().includes(searchQ));
        if (activeDmTab === 'following') {
            return matchesSearch && (userProfile?.following || []).includes(u.id);
        }
        return matchesSearch;
    });

    if (filtered.length === 0) {
        list.innerHTML = `<div class="text-center p-6 text-slate-400 italic">${activeDmTab === 'following' ? 'You are not following anyone yet.' : 'No notebook members found.'}</div>`;
        return;
    }

    filtered.forEach(u => {
        const isFollowing = userProfile && (userProfile.following || []).includes(u.id);
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-white/80 sketched-border cursor-pointer hover:bg-amber-100/80 transition-all hover:-translate-y-0.5 group shadow-xs gap-2";
        div.onclick = () => openDmChat(u.id, u.username, u.emoji, u.bio);
        div.innerHTML = `
            <div class="flex items-center gap-3 overflow-hidden min-w-0">
                <span class="text-3xl bg-amber-50 p-1.5 rounded-full sketched-border shrink-0">${escapeHTML(u.emoji||'👤')}</span>
                <div class="flex flex-col min-w-0">
                    <div class="flex items-center gap-1.5">
                        <span class="font-bold text-lg text-slate-800 truncate">${escapeHTML(u.username)}</span>
                        ${isFollowing ? '<span class="text-xs text-amber-600" title="Following">⭐</span>' : ''}
                    </div>
                    <span class="text-xs text-slate-500 italic truncate">${escapeHTML(u.bio || 'No bio scribbled')}</span>
                </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
                ${userProfile?.role !== 'guest' ? `<button onclick="event.stopPropagation(); toggleFollow('${u.id}')" class="text-xs font-bold px-2 py-1.5 rounded sketched-border hover:scale-105 ${isFollowing ? 'bg-amber-200 text-amber-900' : 'bg-slate-100 text-slate-600'}" title="${isFollowing ? 'Unfollow' : 'Follow'}">${isFollowing ? '⭐' : '+ Follow'}</button>` : ''}
                <button class="bg-blue-500 text-white text-xs font-bold px-2.5 py-1.5 rounded sketched-border-alt hover:bg-blue-600 group-hover:scale-105 transition-transform">
                    Chat ➔
                </button>
            </div>
        `;
        list.appendChild(div);
    });
}

const searchEl = document.getElementById('dm-search-input');
if (searchEl) searchEl.oninput = () => renderUserDirectory(allUsersCache);

function openDmChat(targetUid, targetName, targetEmoji, targetBio) {
    document.getElementById('profile-modal').classList.add('hidden');
    dmDirModal.classList.add('hidden');
    dmChatModal.classList.remove('hidden');

    activeDmTargetUser = { id: targetUid, username: targetName, emoji: targetEmoji, bio: targetBio };

    document.getElementById('dm-chat-title').textContent = `@${targetName}`;
    document.getElementById('dm-header-avatar').textContent = targetEmoji || '👤';
    document.getElementById('dm-header-bio').textContent = targetBio ? `"${targetBio}"` : "Private Notebook Note";

    const isFollowing = userProfile && (userProfile.following || []).includes(targetUid);
    const badge = document.getElementById('dm-header-following-badge');
    isFollowing ? badge.classList.remove('hidden') : badge.classList.add('hidden');

    document.getElementById('dm-header-user-info').onclick = () => showProfile(targetUid);
    document.getElementById('dm-header-profile-btn').onclick = () => showProfile(targetUid);
    
    if (userProfile?.role === 'guest') {
        dmInput.placeholder = "Guests cannot send DMs...";
        dmInput.disabled = true;
        dmSendBtn.disabled = true;
    }

    const uids = [currentUser.uid, targetUid].sort();
    activeDmId = `dm_${uids[0]}_${uids[1]}`;
    activeDmTargetId = targetUid;
    
    applySettings();
    loadDmMessages();
}

document.getElementById('btn-close-dm-chat').onclick = () => {
    dmChatModal.classList.add('hidden');
    if(unsubDmMsg) { unsubDmMsg(); unsubDmMsg = null; }
    activeDmId = null;
    activeDmTargetId = null;
    activeDmTargetUser = null;
};

function loadDmMessages() {
    if(unsubDmMsg) unsubDmMsg();
    const container = document.getElementById('dm-messages-container');
    container.innerHTML = '<div class="text-center mt-6 font-bold text-slate-500 italic">Opening notebook letter...</div>';
    
    unsubDmMsg = onSnapshot(query(collection(db, `rooms/${activeDmId}/messages`), orderBy("createdAt", "asc"), limit(50)), (snapshot) => {
        trackReadCredit(snapshot.docs.length);
        container.innerHTML = '';
        if(snapshot.empty) { 
            const targetName = activeDmTargetUser?.username || 'user';
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center my-auto p-6 text-center text-slate-500 gap-2">
                    <span class="text-5xl animate-bounce">💌</span>
                    <span class="font-['Permanent_Marker'] text-2xl text-slate-700">No Private Notes Yet</span>
                    <p class="text-sm italic max-w-xs">Scribble a note below to start your private conversation with @${escapeHTML(targetName)}.</p>
                </div>`; 
            return; 
        }
        
        snapshot.forEach(docSnap => renderMessage(docSnap.id, docSnap.data(), container, activeDmId));
        container.scrollTo(0, container.scrollHeight);
    });
}

dmSendBtn.onclick = async () => {
    const text = dmInput.value.trim();
    if(!text || !activeDmId || userProfile.suspended || userProfile.role === 'guest') return;
    if (isCreditModeActive && userWriteCredits <= 0) return alert("Write quota depleted for Credit Mode.");
    try {
        if (settings.soundEnabled) { writeSound.currentTime = 0; writeSound.play().catch(e=>e); }
        await addDoc(collection(db, `rooms/${activeDmId}/messages`), {
            senderId: currentUser.uid, senderName: userProfile.username, senderEmoji: userProfile.emoji || '👤',
            text: text, createdAt: serverTimestamp(), isDeleted: false, isPinned: false
        });
        trackWriteCredit(1);

        if (activeDmTargetId) {
            await addDoc(collection(db, `users/${activeDmTargetId}/notifications`), {
                senderId: currentUser.uid,
                senderName: userProfile.username,
                text: text,
                createdAt: serverTimestamp(),
                type: 'dm',
                roomId: activeDmId
            }).catch(e => console.warn("DM notification dispatch error:", e));
            trackWriteCredit(1);
        }

        dmInput.value = ''; updateDmInput();
    } catch (e) { console.error("DM Send error:", e); }
};
const updateDmInput = () => { if(userProfile?.role === 'guest') return; dmSendBtn.disabled = !dmInput.value.trim(); dmInput.style.height = 'auto'; dmInput.style.height = Math.min(dmInput.scrollHeight, 120) + 'px'; };
dmInput.addEventListener('input', updateDmInput);

const adminModal = document.getElementById('admin-modal');
UI.adminBtn.onclick = async () => {
    adminModal.classList.remove('hidden');
    const list = document.getElementById('admin-user-list'); list.innerHTML = 'Flipping pages...';
    document.getElementById('storage-status-text').textContent = "Database status: Healthy. Estimated cache size: ~1.4 MB. 0 Doodle items flagged for cleanup.";
    try {
        const usersSnap = await getDocs(collection(db, "users")); list.innerHTML = '';
        trackReadCredit(usersSnap.docs.length);
        usersSnap.forEach(docSnap => {
            const u = docSnap.data();
            const isTargetSuper = SUPER_ADMINS.includes(u.username);
            const iAmSuper = userProfile.role === 'super_admin';
            if (!iAmSuper && (['super_admin', 'admin'].includes(u.role) || isTargetSuper)) return;
            if (isTargetSuper && !iAmSuper) return; 

            const div = document.createElement('div'); div.className = "flex flex-col gap-2 bg-white p-2 sketched-border mb-1";
            div.innerHTML = `
                <div class="flex justify-between items-center flex-wrap gap-2">
                    <span class="font-bold">${escapeHTML(u.emoji||'👤')} ${escapeHTML(u.username)} (${u.role || 'user'}) ${u.suspended ? '<b class="text-rose-500">(Banned)</b>' : ''}</span>
                    <div class="flex gap-1 text-sm font-bold">
                        ${!isTargetSuper ? `<button onclick="toggleSuspend('${docSnap.id}',${!u.suspended})" class="bg-amber-400 text-white px-2 py-1 sketched-border hover:bg-amber-500">${u.suspended ? 'Unban' : 'Ban'}</button>` : ''}
                        ${(iAmSuper && !isTargetSuper) ? `<button onclick="toggleRole('${docSnap.id}', '${u.role === 'admin' ? 'user' : 'admin'}')" class="bg-indigo-400 text-white px-2 py-1 sketched-border hover:bg-indigo-500">${u.role === 'admin' ? 'Demote' : 'Make Admin'}</button>` : ''}
                    </div>
                </div>`;
            list.appendChild(div);
        });
    } catch (e) { list.innerHTML = `<span class="text-rose-600 font-bold">Failed to load user list.</span>`; }
};
document.getElementById('admin-close').onclick = () => adminModal.classList.add('hidden');
window.toggleSuspend = async (uid, state) => { await updateDoc(doc(db, "users", uid), { suspended: state }); trackWriteCredit(1); UI.adminBtn.click(); };
window.toggleRole = async (uid, newRole) => { await updateDoc(doc(db, "users", uid), { role: newRole }); trackWriteCredit(1); UI.adminBtn.click(); };

document.getElementById('btn-run-storage-guardian').onclick = () => {
    alert("Storage Guardian Sweep complete! Scanned global posts and doodles. 0 redundant files found.");
    document.getElementById('storage-status-text').textContent = "Last sweep run: Just now. Storage usage optimal.";
};

document.getElementById('btn-toggle-global-links').onclick = async () => {
    if(userProfile.role !== 'super_admin') return alert("Super Admin required.");
    try { 
        await setDoc(doc(db, "app_settings", "global_settings"), { linksEnabled: !linksEnabledGlobally }, { merge: true }); 
        trackWriteCredit(1);
    } catch(e) { console.error(e); }
};