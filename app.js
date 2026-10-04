import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, setDoc, getDoc, updateDoc, getDocs, writeBatch, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

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
let userDocUnsub = null, unsubMsg = null, unsubDmMsg = null, unsubProfilePosts = null;
let isRegistering = false, isInitialLoadDone = false; 
let currentPinnedCount = 0;
let linksEnabledGlobally = true; // Governed by Admin

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
    forceToast: localStorage.getItem('pensup_force_toast') === 'true',
    soundEnabled: localStorage.getItem('pensup_sound') !== 'false'
};

function applySettings() {
    settings.chatBoxLift ? UI.footer.classList.add('mb-12') : UI.footer.classList.remove('mb-12');
    document.getElementById('setting-chatbox-lift').checked = settings.chatBoxLift;
    document.getElementById('setting-force-toast').checked = settings.forceToast;
    document.getElementById('setting-sound-enabled').checked = settings.soundEnabled;
}

function showToastNotification(senderName, text) {
    const toast = document.createElement('div');
    toast.className = "fixed top-16 left-1/2 -translate-x-1/2 bg-yellow-100 text-slate-800 px-5 py-2.5 sketched-border shadow-xl z-[100] animate-pop flex flex-col min-w-[260px] max-w-[90%] pointer-events-none";
    let safeText = text.length > 45 ? escapeHTML(text.substring(0, 45)) + "..." : escapeHTML(text);
    toast.innerHTML = `<span class="text-indigo-600 font-bold text-sm mb-0.5">📝 New note from ${escapeHTML(senderName)}</span><span class="text-xl leading-tight font-semibold">${safeText}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.4s ease'; setTimeout(() => toast.remove(), 400); }, 3500);
}

function notifyUser(senderName, text) {
    if (!settings.forceToast && "Notification" in window && Notification.permission === "granted") {
        try {
            const n = new Notification(`PensUp pro • ${senderName}`, { body: text.length > 60 ? text.substring(0, 60) + "..." : text, icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📝</text></svg>" });
            n.onclick = () => { window.focus(); n.close(); }; return;
        } catch (e) { console.warn("Native notify failed:", e); }
    }
    showToastNotification(senderName, text);
}

const escapeHTML = (str) => str ? String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;") : '';

// Link Parsing Logic
const parseLinks = (safeText) => {
    if (!linksEnabledGlobally) return safeText.replace(/(https?:\/\/[^\s]+)/g, '<span class="italic text-slate-400 bg-slate-100 px-1 rounded">[Link Disabled by Admin]</span>');
    return safeText.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="text-blue-600 underline font-semibold hover:text-blue-800 break-all pointer-events-auto" onclick="event.stopPropagation()">$1</a>');
};

const showError = (msg) => { UI.err.textContent = msg; UI.err.classList.remove('hidden'); setTimeout(() => UI.err.classList.add('hidden'), 4000); };
const setTimeGreeting = () => { const hr = new Date().getHours(); document.getElementById('greeting-text').textContent = hr < 12 ? 'Good Morning!' : hr < 18 ? 'Good Afternoon!' : 'Good Evening!'; };

UI.themeSel.onchange = (e) => document.body.className = `h-screen w-full flex flex-col relative overflow-hidden text-lg select-none ${e.target.value}`;
const currentMonth = new Date().getMonth();
if (currentMonth === 9) { UI.themeSel.value = 'theme-halloween'; UI.themeSel.dispatchEvent(new Event('change')); }
else if (currentMonth === 11) { UI.themeSel.value = 'theme-xmas'; UI.themeSel.dispatchEvent(new Event('change')); }

document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('auth-username').value.trim().toLowerCase().replace(/\s+/g, '');
    const p = document.getElementById('auth-password').value;
    if (u.length < 3 || p.length < 6) return showError("Username min 3 chars, password min 6 chars.");
    document.getElementById('auth-loading').classList.remove('hidden');
    isRegistering = true; 
    try {
        const usernameDoc = await getDoc(doc(db, "usernames", u));
        if (usernameDoc.exists()) { isRegistering = false; document.getElementById('auth-loading').classList.add('hidden'); return showError("Username is already taken."); }
        const cred = await createUserWithEmailAndPassword(auth, `${u}@notebook.local`, p);
        const role = SUPER_ADMINS.includes(u) ? 'super_admin' : 'user';
        await setDoc(doc(db, "usernames", u), { uid: cred.user.uid });
        await setDoc(doc(db, "users", cred.user.uid), { username: u, role: role, suspended: false, emoji: '👤', bio: '' });
        isRegistering = false; syncUserProfile(cred.user);
    } catch (e) { isRegistering = false; document.getElementById('auth-loading').classList.add('hidden'); showError(e.message); }
};

document.getElementById('btn-login').onclick = async () => {
    const u = document.getElementById('auth-username').value.trim().toLowerCase();
    const p = document.getElementById('auth-password').value;
    if(!u || !p) return showError("Please enter credentials.");
    document.getElementById('auth-loading').classList.remove('hidden');
    try { await signInWithEmailAndPassword(auth, `${u}@notebook.local`, p); } 
    catch (e) { document.getElementById('auth-loading').classList.add('hidden'); showError("Invalid username or password."); }
};

document.getElementById('btn-logout-launch').onclick = () => { document.getElementById('auth-loading').classList.remove('hidden'); signOut(auth); };

function syncUserProfile(user) {
    if (userDocUnsub) { userDocUnsub(); userDocUnsub = null; }
    userDocUnsub = onSnapshot(doc(db, "users", user.uid), 
        (docSnap) => {
            if (isRegistering) return; 
            if (!docSnap.exists() || docSnap.data().suspended) { signOut(auth); showError(docSnap.data()?.suspended ? "Account suspended." : "Account missing."); return; }
            userProfile = docSnap.data(); currentUser = user;
            document.getElementById('auth-loading').classList.add('hidden');
            UI.auth.classList.add('hidden'); UI.launch.classList.remove('hidden');
            setTimeGreeting();
            document.getElementById('launch-username').textContent = userProfile.username;
            document.getElementById('btn-open-emoji-picker').textContent = userProfile.emoji || '👤';
            document.getElementById('launch-bio').value = userProfile.bio || '';
            document.getElementById('user-badge').textContent = `${userProfile.emoji || '👤'} My Profile`;
            
            if (['super_admin', 'admin'].includes(userProfile.role)) UI.adminBtn.classList.remove('hidden'); else UI.adminBtn.classList.add('hidden');
            if (userProfile.role === 'super_admin') document.getElementById('btn-edit-board').classList.remove('hidden');
            
            onSnapshot(doc(db, "app_settings", "launch_screen"), (d) => { document.getElementById('launch-board-text').textContent = d.exists() ? d.data().text : "Welcome to the study group!"; });
            onSnapshot(doc(db, "app_settings", "global_settings"), (d) => { 
                linksEnabledGlobally = d.exists() ? (d.data().linksEnabled !== false) : true;
                const linkBtn = document.getElementById('btn-toggle-global-links');
                if(linkBtn) linkBtn.className = linksEnabledGlobally ? "px-3 py-1 font-bold text-white bg-emerald-500 rounded sketched-border" : "px-3 py-1 font-bold text-white bg-rose-500 rounded sketched-border";
                if(linkBtn) linkBtn.textContent = linksEnabledGlobally ? "Links: ON" : "Links: OFF";
            });
        }, 
        (error) => { document.getElementById('auth-loading').classList.add('hidden'); showError("Database error."); }
    );
}

onAuthStateChanged(auth, (user) => {
    if (isRegistering) return; 
    if (user) syncUserProfile(user);
    else {
        currentUser = null; userProfile = null; document.getElementById('auth-loading').classList.add('hidden');
        UI.app.classList.replace('flex', 'hidden'); UI.launch.classList.add('hidden'); UI.auth.classList.remove('hidden');
        document.getElementById('auth-password').value = '';
    }
});

// Emoji Handlers
const emojiModal = document.getElementById('emoji-modal');
const emojiGrid = document.getElementById('emoji-grid');
ALL_EMOJIS.forEach(e => {
    const btn = document.createElement('button'); btn.className = "hover:scale-125 transition-transform p-1 cursor-pointer";
    btn.textContent = e; btn.onclick = () => selectEmoji(e); emojiGrid.appendChild(btn);
});
document.getElementById('btn-open-emoji-picker').onclick = () => emojiModal.classList.remove('hidden');
document.getElementById('emoji-close').onclick = () => emojiModal.classList.add('hidden');
async function selectEmoji(selectedEmoji) {
    if(!selectedEmoji) return;
    document.getElementById('btn-open-emoji-picker').textContent = selectedEmoji;
    userProfile.emoji = selectedEmoji; emojiModal.classList.add('hidden');
    await updateDoc(doc(db, "users", currentUser.uid), { emoji: selectedEmoji });
}
document.getElementById('btn-save-custom-emoji').onclick = () => { const custom = document.getElementById('custom-emoji-input').value.trim(); if (custom) selectEmoji(custom); };

document.getElementById('launch-bio').onblur = async (e) => { userProfile.bio = e.target.value.trim(); await updateDoc(doc(db, "users", currentUser.uid), { bio: userProfile.bio }); };
document.getElementById('btn-edit-board').onclick = async () => { const txt = prompt("New notice board text:"); if(txt !== null) await setDoc(doc(db, "app_settings", "launch_screen"), { text: txt }); };

// Settings Modal
const settingsModal = document.getElementById('settings-modal');
document.getElementById('btn-settings').onclick = () => { applySettings(); settingsModal.classList.remove('hidden'); };
document.getElementById('settings-close').onclick = () => settingsModal.classList.add('hidden');
document.getElementById('btn-save-settings').onclick = () => {
    settings.chatBoxLift = document.getElementById('setting-chatbox-lift').checked;
    settings.forceToast = document.getElementById('setting-force-toast').checked;
    settings.soundEnabled = document.getElementById('setting-sound-enabled').checked;
    localStorage.setItem('pensup_lift', settings.chatBoxLift);
    localStorage.setItem('pensup_force_toast', settings.forceToast);
    localStorage.setItem('pensup_sound', settings.soundEnabled);
    applySettings(); settingsModal.classList.add('hidden');
};

document.getElementById('btn-enter-chat').onclick = () => {
    UI.launch.classList.add('hidden'); UI.app.classList.replace('hidden', 'flex');
    if (!settings.forceToast && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
    applySettings(); loadMessages();
};
document.getElementById('btn-back-launch').onclick = () => { UI.app.classList.replace('flex', 'hidden'); UI.launch.classList.remove('hidden'); if(unsubMsg) unsubMsg(); };
document.getElementById('user-badge').onclick = () => { if(currentUser) showProfile(currentUser.uid); }; // Open own profile

// --- Main Chat Logic ---
function loadMessages() {
    if (unsubMsg) unsubMsg(); isInitialLoadDone = false;
    unsubMsg = onSnapshot(query(collection(db, `rooms/${ROOM_ID}/messages`), orderBy("createdAt", "asc")), 
        (snapshot) => {
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
                    if (change.type === "added" && data.senderId !== currentUser.uid && !data.isDeleted) notifyUser(data.senderName, data.text);
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
        const unpinBtn = userProfile.role === 'super_admin' ? `<button onclick="togglePin('${item.id}', false)" class="text-rose-500 font-bold hover:scale-110 ml-2" title="Unpin Note">✖</button>` : '';
        div.innerHTML = `<div class="flex items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer flex-1" onclick="jumpToMessage('${item.id}')"><span class="font-bold text-indigo-600 shrink-0">${escapeHTML(item.senderName)}:</span><span class="text-slate-700 overflow-hidden text-ellipsis">${parseLinks(escapeHTML(item.text))}</span></div>${unpinBtn}`;
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
    if (userProfile.role !== 'super_admin') return;
    if (shouldPin && currentPinnedCount >= 5) return alert("Maximum 5 notes can be pinned! Unpin one first.");
    try { await updateDoc(doc(db, `rooms/${ROOM_ID}/messages`, id), { isPinned: shouldPin }); } catch (e) { console.error("Pin error:", e); }
};

async function sendMessage(text) {
    if (!currentUser || userProfile.suspended) return;
    try {
        if (settings.soundEnabled) { writeSound.currentTime = 0; writeSound.play().catch(e => console.warn("Audio blocked:", e)); }
        await addDoc(collection(db, `rooms/${ROOM_ID}/messages`), {
            senderId: currentUser.uid, senderName: userProfile.username, senderEmoji: userProfile.emoji || '👤',
            text: text, createdAt: serverTimestamp(), isDeleted: false, isPinned: false
        });
        UI.input.value = ''; updateInput();
    } catch (e) { console.error("Send error:", e); }
}

UI.sendBtn.onclick = () => { if (UI.input.value.trim()) sendMessage(UI.input.value.trim()); };
const updateInput = () => { UI.sendBtn.disabled = !UI.input.value.trim(); UI.input.style.height = 'auto'; UI.input.style.height = Math.min(UI.input.scrollHeight, 120) + 'px'; };
UI.input.addEventListener('input', updateInput);

window.deleteMsg = async (roomId, msgId) => { 
    if(confirm("Rip out this note?")) { await updateDoc(doc(db, `rooms/${roomId}/messages`, msgId), { isDeleted: true, deletedBy: userProfile.username, text: "", isPinned: false }); }
};

// Generic Message Renderer (used by Main Chat & DMs)
function renderMessage(id, data, containerEl, roomStr) {
    const isSelf = data.senderId === currentUser.uid;
    const isSuperAdmin = userProfile.role === 'super_admin';
    const canDelete = isSelf || (roomStr === ROOM_ID && ['super_admin', 'admin'].includes(userProfile.role));
    const timeStr = data.createdAt ? data.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...';
    
    let displayHtml = '';
    let bgClass = isSelf ? 'bg-yellow-100' : 'bg-white';
    
    if (data.isDeleted) {
        displayHtml = `<span class="italic text-slate-500 text-lg opacity-80">✂ Ripped out by ${escapeHTML(data.deletedBy)}</span>`;
        bgClass = 'bg-slate-200/50'; 
    } else {
        displayHtml = parseLinks(escapeHTML(data.text));
    }

    const pinBtn = (roomStr === ROOM_ID && isSuperAdmin && !data.isDeleted) ? `<button onclick="togglePin('${id}', ${!data.isPinned})" class="bg-amber-100 text-amber-800 rounded-full w-6 h-6 text-xs flex items-center justify-center hover:scale-110 sketched-border" title="${data.isPinned ? 'Unpin' : 'Pin'}">📌</button>` : '';
    const delBtn = (canDelete && !data.isDeleted) ? `<button onclick="deleteMsg('${roomStr}', '${id}')" class="bg-rose-200 text-rose-700 rounded-full w-6 h-6 text-xs flex items-center justify-center hover:scale-110 sketched-border" title="Delete">✖</button>` : '';
    const actionControls = (!data.isDeleted && (pinBtn || delBtn)) ? `<div class="absolute -right-2 -top-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">${pinBtn}${delBtn}</div>` : '';
    const pinnedBadge = data.isPinned ? `<span class="text-xs bg-amber-200 text-amber-900 font-bold px-1.5 py-0.5 rounded sketched-border-alt mb-1 inline-block">📌 Pinned</span>` : '';
    const header = !isSelf ? `<div class="flex items-center gap-1 mb-1 cursor-pointer hover:opacity-80" onclick="showProfile('${data.senderId}')"><span class="text-2xl">${escapeHTML(data.senderEmoji || '👤')}</span><span class="text-sm font-bold text-indigo-500 pl-1">${escapeHTML(data.senderName)}</span></div>` : '';

    const wrapper = document.createElement('div');
    wrapper.id = `msg-${id}`; wrapper.className = `group flex flex-col gap-1 max-w-[85%] animate-pop relative transition-all duration-300 ${isSelf ? 'self-end items-end' : 'self-start items-start'}`;
    wrapper.innerHTML = `${header}${pinnedBadge}<div class="${bgClass} text-slate-800 p-2 text-2xl sketched-border relative break-words shadow-sm">${displayHtml} ${actionControls}</div><span class="text-xs font-bold opacity-60 px-1 mt-0.5">${timeStr}</span>`;
    containerEl.appendChild(wrapper);
}


// --- POSTS & PROFILE LOGIC ---
let activeProfileUid = null;
window.showProfile = async (uid) => {
    activeProfileUid = uid;
    const pModal = document.getElementById('profile-modal');
    pModal.classList.remove('hidden'); 
    document.getElementById('p-modal-name').textContent = "Loading...";
    document.getElementById('profile-posts-list').innerHTML = '<div class="text-center text-slate-500 italic mt-4">Loading posts...</div>';
    
    // UI states
    const dmBtn = document.getElementById('p-modal-dm-btn');
    const createBox = document.getElementById('create-post-box');
    
    if(uid === currentUser.uid) {
        dmBtn.classList.add('hidden');
        createBox.classList.remove('hidden');
    } else {
        dmBtn.classList.remove('hidden');
        dmBtn.onclick = () => openDmChat(uid, document.getElementById('p-modal-name').textContent);
        createBox.classList.add('hidden');
    }

    try {
        const snap = await getDoc(doc(db, "users", uid));
        if(snap.exists()) {
            const p = snap.data();
            document.getElementById('p-modal-emoji').textContent = p.emoji || '👤';
            document.getElementById('p-modal-name').textContent = p.username;
            document.getElementById('p-modal-role').textContent = p.role.replace('_', ' ').toUpperCase();
            document.getElementById('p-modal-bio').textContent = p.bio ? `"${p.bio}"` : '"Quiet observer."';
        }
        loadProfilePosts(uid);
    } catch (e) { console.error("Profile fetch error:", e); }
};

document.getElementById('profile-close').onclick = () => {
    document.getElementById('profile-modal').classList.add('hidden');
    if(unsubProfilePosts) { unsubProfilePosts(); unsubProfilePosts = null; }
};

function loadProfilePosts(uid) {
    if(unsubProfilePosts) unsubProfilePosts();
    unsubProfilePosts = onSnapshot(query(collection(db, `users/${uid}/posts`), orderBy("createdAt", "desc")), (snapshot) => {
        const listEl = document.getElementById('profile-posts-list');
        listEl.innerHTML = '';
        if(snapshot.empty) { listEl.innerHTML = '<div class="text-center text-slate-500 italic mt-4">No posts yet.</div>'; return; }
        
        snapshot.forEach(docSnap => {
            const post = docSnap.data();
            const likes = post.likes || []; const dislikes = post.dislikes || [];
            const hasLiked = likes.includes(currentUser.uid); const hasDisliked = dislikes.includes(currentUser.uid);
            
            const div = document.createElement('div');
            div.className = "bg-white p-3 sketched-border-alt flex flex-col gap-2";
            const timeStr = post.createdAt ? post.createdAt.toDate().toLocaleDateString() : '';
            
            div.innerHTML = `
                <div class="text-lg text-slate-800 break-words">${parseLinks(escapeHTML(post.text))}</div>
                <div class="flex justify-between items-center text-sm border-t border-slate-100 pt-2 mt-1">
                    <span class="text-slate-400 font-bold">${timeStr}</span>
                    <div class="flex gap-3">
                        <button onclick="togglePostVote('${uid}', '${docSnap.id}', 'like')" class="${hasLiked ? 'text-indigo-600 scale-110' : 'text-slate-400'} font-bold hover:scale-110 transition-transform">👍 ${likes.length}</button>
                        <button onclick="togglePostVote('${uid}', '${docSnap.id}', 'dislike')" class="${hasDisliked ? 'text-rose-600 scale-110' : 'text-slate-400'} font-bold hover:scale-110 transition-transform">👎 ${dislikes.length}</button>
                    </div>
                </div>
            `;
            listEl.appendChild(div);
        });
    });
}

document.getElementById('btn-publish-post').onclick = async () => {
    const input = document.getElementById('post-input');
    const txt = input.value.trim();
    if(!txt) return;
    try {
        await addDoc(collection(db, `users/${currentUser.uid}/posts`), {
            text: txt, createdAt: serverTimestamp(), likes: [], dislikes: []
        });
        input.value = '';
    } catch(e) { console.error("Post error:", e); }
};

window.togglePostVote = async (postOwnerUid, postId, type) => {
    const postRef = doc(db, `users/${postOwnerUid}/posts`, postId);
    const snap = await getDoc(postRef);
    if(!snap.exists()) return;
    const data = snap.data();
    const uid = currentUser.uid;
    const isLike = type === 'like';
    
    let updates = {};
    if(isLike) {
        if(data.likes?.includes(uid)) updates.likes = arrayRemove(uid); // unlike
        else { updates.likes = arrayUnion(uid); updates.dislikes = arrayRemove(uid); }
    } else {
        if(data.dislikes?.includes(uid)) updates.dislikes = arrayRemove(uid); // undislike
        else { updates.dislikes = arrayUnion(uid); updates.likes = arrayRemove(uid); }
    }
    await updateDoc(postRef, updates);
};


// --- DIRECT MESSAGING LOGIC ---
let activeDmId = null;
let activeDmTargetId = null;

const dmDirModal = document.getElementById('dm-directory-modal');
const dmChatModal = document.getElementById('dm-chat-modal');
const dmInput = document.getElementById('dm-message-input');
const dmSendBtn = document.getElementById('btn-send-dm');

document.getElementById('btn-open-dms').onclick = async () => {
    dmDirModal.classList.remove('hidden');
    const list = document.getElementById('dm-user-list');
    list.innerHTML = 'Loading directory...';
    try {
        const snap = await getDocs(collection(db, "users"));
        list.innerHTML = '';
        snap.forEach(d => {
            if(d.id === currentUser.uid) return;
            const u = d.data();
            const div = document.createElement('div');
            div.className = "flex items-center gap-3 p-2 bg-slate-50 sketched-border cursor-pointer hover:bg-blue-50 transition-colors";
            div.onclick = () => openDmChat(d.id, u.username);
            div.innerHTML = `<span class="text-3xl">${escapeHTML(u.emoji||'👤')}</span> <span class="font-bold text-lg text-slate-800">${escapeHTML(u.username)}</span>`;
            list.appendChild(div);
        });
    } catch(e) { list.innerHTML = 'Error loading directory.'; console.error(e); }
};
document.getElementById('dm-directory-close').onclick = () => dmDirModal.classList.add('hidden');

function openDmChat(targetUid, targetName) {
    document.getElementById('profile-modal').classList.add('hidden'); // close profile if open
    dmDirModal.classList.add('hidden');
    dmChatModal.classList.remove('hidden');
    document.getElementById('dm-chat-title').textContent = `@${targetName}`;
    
    // Sort UIDs to ensure consistent Room ID for both participants
    const uids = [currentUser.uid, targetUid].sort();
    activeDmId = `dm_${uids[0]}_${uids[1]}`;
    activeDmTargetId = targetUid;
    
    loadDmMessages();
}

document.getElementById('btn-close-dm-chat').onclick = () => {
    dmChatModal.classList.add('hidden');
    if(unsubDmMsg) { unsubDmMsg(); unsubDmMsg = null; }
    activeDmId = null;
};

function loadDmMessages() {
    if(unsubDmMsg) unsubDmMsg();
    const container = document.getElementById('dm-messages-container');
    container.innerHTML = '<div class="text-center mt-4">Loading private chat...</div>';
    
    unsubDmMsg = onSnapshot(query(collection(db, `rooms/${activeDmId}/messages`), orderBy("createdAt", "asc")), (snapshot) => {
        container.innerHTML = '';
        if(snapshot.empty) { container.innerHTML = '<div class="text-center text-slate-500 italic mt-10">Start the conversation!</div>'; return; }
        
        snapshot.forEach(docSnap => renderMessage(docSnap.id, docSnap.data(), container, activeDmId));
        container.scrollTo(0, container.scrollHeight);
    });
}

dmSendBtn.onclick = async () => {
    const text = dmInput.value.trim();
    if(!text || !activeDmId || userProfile.suspended) return;
    try {
        if (settings.soundEnabled) { writeSound.currentTime = 0; writeSound.play().catch(e=>e); }
        await addDoc(collection(db, `rooms/${activeDmId}/messages`), {
            senderId: currentUser.uid, senderName: userProfile.username, senderEmoji: userProfile.emoji || '👤',
            text: text, createdAt: serverTimestamp(), isDeleted: false, isPinned: false
        });
        dmInput.value = ''; updateDmInput();
    } catch (e) { console.error("DM Send error:", e); }
};
const updateDmInput = () => { dmSendBtn.disabled = !dmInput.value.trim(); dmInput.style.height = 'auto'; dmInput.style.height = Math.min(dmInput.scrollHeight, 120) + 'px'; };
dmInput.addEventListener('input', updateDmInput);


// --- ADMIN SYSTEM ---
const adminModal = document.getElementById('admin-modal');
UI.adminBtn.onclick = async () => {
    adminModal.classList.remove('hidden');
    const list = document.getElementById('admin-user-list'); list.innerHTML = 'Flipping pages...';
    try {
        const usersSnap = await getDocs(collection(db, "users")); list.innerHTML = '';
        usersSnap.forEach(docSnap => {
            const u = docSnap.data();
            const isTargetSuper = SUPER_ADMINS.includes(u.username);
            const iAmSuper = userProfile.role === 'super_admin';
            if (!iAmSuper && (['super_admin', 'admin'].includes(u.role) || isTargetSuper)) return;
            if (isTargetSuper && !iAmSuper) return; 

            const div = document.createElement('div'); div.className = "flex flex-col gap-2 bg-white p-2 sketched-border mb-1";
            div.innerHTML = `
                <div class="flex justify-between items-center flex-wrap gap-2">
                    <span class="font-bold">${escapeHTML(u.emoji||'👤')} ${escapeHTML(u.username)} ${u.suspended ? '<b class="text-rose-500">(Banned)</b>' : ''}</span>
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
window.toggleSuspend = async (uid, state) => { await updateDoc(doc(db, "users", uid), { suspended: state }); UI.adminBtn.click(); };
window.toggleRole = async (uid, newRole) => { await updateDoc(doc(db, "users", uid), { role: newRole }); UI.adminBtn.click(); };

document.getElementById('btn-toggle-global-links').onclick = async () => {
    if(userProfile.role !== 'super_admin') return alert("Super Admin required.");
    try { await setDoc(doc(db, "app_settings", "global_settings"), { linksEnabled: !linksEnabledGlobally }, { merge: true }); }
    catch(e) { console.error(e); }
};