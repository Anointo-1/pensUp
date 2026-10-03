import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, setDoc, getDoc, deleteDoc, updateDoc, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

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
let userDocUnsub = null;
let isRegistering = false; 

const ROOM_ID = "main-room";
const SUPER_ADMINS = ['anoimazo1', 'anointo', 'amazo'];

const ALL_EMOJIS = [
    '👤','👻','👾','🤖','👽','🐼','🦊','🦄','🐸','🐱','🐶','🦖','✏️','🎨','🔥',
    '😎','🤠','🥳','🤡','👑','🎒','🎓','📚','💡','🚀','⭐','🌟','🌈','⚡','🎯',
    '⚽','🎮','🍕','🍔','🌮','🍩','🍦','☕','🏀','🎸','🎧','🧩','🎲','🧸','🐉',
    '🐙','🦋','🦁','🐯','🐻','🦉','🦅','🐺','🔮','🧿','💎','💰','🏆','🥇','🎖️'
];

const UI = {
    auth: document.getElementById('auth-screen'), launch: document.getElementById('launch-screen'), app: document.getElementById('app-screen'),
    msgContainer: document.getElementById('chat-messages'), input: document.getElementById('message-input'), sendBtn: document.getElementById('btn-send'),
    err: document.getElementById('auth-error'), adminBtn: document.getElementById('btn-admin'), themeSel: document.getElementById('theme-selector')
};

const escapeHTML = (str) => str ? String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;") : '';
const showError = (msg) => { UI.err.textContent = msg; UI.err.classList.remove('hidden'); setTimeout(() => UI.err.classList.add('hidden'), 4000); };
const setTimeGreeting = () => {
    const hr = new Date().getHours();
    document.getElementById('greeting-text').textContent = hr < 12 ? 'Good Morning!' : hr < 18 ? 'Good Afternoon!' : 'Good Evening!';
};

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
        if (usernameDoc.exists()) {
            isRegistering = false;
            document.getElementById('auth-loading').classList.add('hidden');
            return showError("Username is already taken.");
        }

        const cred = await createUserWithEmailAndPassword(auth, `${u}@notebook.local`, p);
        const role = SUPER_ADMINS.includes(u) ? 'super_admin' : 'user';

        await setDoc(doc(db, "usernames", u), { uid: cred.user.uid });
        await setDoc(doc(db, "users", cred.user.uid), { username: u, role: role, suspended: false, emoji: '👤', bio: '' });

        isRegistering = false;
        syncUserProfile(cred.user);

    } catch (e) { 
        isRegistering = false;
        document.getElementById('auth-loading').classList.add('hidden'); 
        showError(e.message); 
    }
};

document.getElementById('btn-login').onclick = async () => {
    const u = document.getElementById('auth-username').value.trim().toLowerCase();
    const p = document.getElementById('auth-password').value;
    if(!u || !p) return showError("Please enter credentials.");
    document.getElementById('auth-loading').classList.remove('hidden');
    try { await signInWithEmailAndPassword(auth, `${u}@notebook.local`, p); } 
    catch (e) { document.getElementById('auth-loading').classList.add('hidden'); showError("Invalid username or password."); }
};

document.getElementById('btn-logout-launch').onclick = () => { 
    document.getElementById('auth-loading').classList.remove('hidden'); 
    signOut(auth); 
};

function syncUserProfile(user) {
    if (userDocUnsub) { userDocUnsub(); userDocUnsub = null; }
    userDocUnsub = onSnapshot(doc(db, "users", user.uid), 
        (docSnap) => {
            if (isRegistering) return; 

            if (!docSnap.exists()) {
                signOut(auth);
                showError("Account document not found. Please re-register.");
                return;
            }

            if (docSnap.data().suspended) {
                signOut(auth);
                showError("Your account has been suspended.");
                return;
            }

            userProfile = docSnap.data();
            currentUser = user;
            document.getElementById('auth-loading').classList.add('hidden');
            UI.auth.classList.add('hidden'); UI.launch.classList.remove('hidden');
            setTimeGreeting();
            document.getElementById('launch-username').textContent = userProfile.username;
            document.getElementById('btn-open-emoji-picker').textContent = userProfile.emoji || '👤';
            document.getElementById('launch-bio').value = userProfile.bio || '';
            
            if (['super_admin', 'admin'].includes(userProfile.role)) UI.adminBtn.classList.remove('hidden');
            else UI.adminBtn.classList.add('hidden');
            if (userProfile.role === 'super_admin') document.getElementById('btn-edit-board').classList.remove('hidden');
            
            onSnapshot(doc(db, "app_settings", "launch_screen"), (d) => {
                document.getElementById('launch-board-text').textContent = d.exists() ? d.data().text : "Welcome to the study group!";
            }, (err) => console.warn("Launch board error:", err));
        }, 
        (error) => {
            console.error("Firestore user profile error:", error);
            document.getElementById('auth-loading').classList.add('hidden');
            showError("Database error. Please check rules.");
        }
    );
}

onAuthStateChanged(auth, (user) => {
    if (isRegistering) return; 
    if (user) syncUserProfile(user);
    else {
        currentUser = null; userProfile = null;
        document.getElementById('auth-loading').classList.add('hidden');
        UI.app.classList.replace('flex', 'hidden'); UI.launch.classList.add('hidden'); UI.auth.classList.remove('hidden');
        document.getElementById('auth-password').value = '';
    }
});

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
document.getElementById('btn-save-custom-emoji').onclick = () => {
    const custom = document.getElementById('custom-emoji-input').value.trim();
    if (custom) selectEmoji(custom);
};

document.getElementById('launch-bio').onblur = async (e) => {
    userProfile.bio = e.target.value.trim();
    await updateDoc(doc(db, "users", currentUser.uid), { bio: userProfile.bio });
};
document.getElementById('btn-edit-board').onclick = async () => {
    const txt = prompt("New message board text:");
    if(txt !== null) await setDoc(doc(db, "app_settings", "launch_screen"), { text: txt });
};

document.getElementById('btn-enter-chat').onclick = () => {
    UI.launch.classList.add('hidden'); 
    UI.app.classList.replace('hidden', 'flex');
    document.getElementById('user-badge').textContent = `${userProfile.emoji || '👤'} ${userProfile.username}`;
    loadMessages();
};

document.getElementById('btn-back-launch').onclick = () => {
    UI.app.classList.replace('flex', 'hidden'); UI.launch.classList.remove('hidden');
    if(unsubMsg) unsubMsg();
};

let unsubMsg = null;
function loadMessages() {
    if (unsubMsg) unsubMsg();
    unsubMsg = onSnapshot(
        query(collection(db, `rooms/${ROOM_ID}/messages`), orderBy("createdAt", "asc")), 
        (snapshot) => {
            document.getElementById('chat-loading').classList.add('hidden');
            UI.msgContainer.innerHTML = '';
            snapshot.forEach(docSnap => renderMessage(docSnap.id, docSnap.data()));
            UI.msgContainer.scrollTo(0, UI.msgContainer.scrollHeight);
        },
        (error) => {
            console.error("Messages query error:", error);
            document.getElementById('chat-loading').classList.add('hidden');
            alert("Error loading messages. Check browser console.");
        }
    );
}

async function sendMessage(text) {
    if (!currentUser || userProfile.suspended) return;
    try {
        await addDoc(collection(db, `rooms/${ROOM_ID}/messages`), {
            senderId: currentUser.uid, senderName: userProfile.username, senderEmoji: userProfile.emoji || '👤',
            text: text, createdAt: serverTimestamp(), isDeleted: false
        });
        UI.input.value = ''; updateInput();
    } catch (e) { console.error("Send message error:", e); }
}

UI.sendBtn.onclick = () => { if (UI.input.value.trim()) sendMessage(UI.input.value.trim()); };
const updateInput = () => {
    UI.sendBtn.disabled = !UI.input.value.trim();
    UI.input.style.height = 'auto'; 
    UI.input.style.height = Math.min(UI.input.scrollHeight, 120) + 'px';
};
UI.input.addEventListener('input', updateInput);

window.deleteMsg = async (id) => { 
    if(confirm("Rip out this note?")) {
        await updateDoc(doc(db, `rooms/${ROOM_ID}/messages`, id), { isDeleted: true, deletedBy: userProfile.username, text: "" });
    }
};

window.showProfile = async (uid) => {
    const pModal = document.getElementById('profile-modal');
    pModal.classList.remove('hidden'); 
    document.getElementById('p-modal-name').textContent = "Loading...";
    
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if(snap.exists()) {
            const p = snap.data();
            document.getElementById('p-modal-emoji').textContent = p.emoji || '👤';
            document.getElementById('p-modal-name').textContent = p.username;
            document.getElementById('p-modal-role').textContent = p.role.replace('_', ' ').toUpperCase();
            document.getElementById('p-modal-bio').textContent = p.bio ? `"${p.bio}"` : '"Quiet observer."';
        }
    } catch (e) { console.error("Profile view error:", e); }
};
document.getElementById('profile-close').onclick = () => document.getElementById('profile-modal').classList.add('hidden');

function renderMessage(id, data) {
    const isSelf = data.senderId === currentUser.uid;
    const canDelete = isSelf || ['super_admin', 'admin'].includes(userProfile.role);
    const timeStr = data.createdAt ? data.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...';
    
    let safeText = escapeHTML(data.text);
    let bgClass = isSelf ? 'bg-yellow-100' : 'bg-white';
    if (data.isDeleted) {
        safeText = `<span class="italic text-slate-500 text-lg opacity-80">✂️ Ripped out by ${escapeHTML(data.deletedBy)}</span>`;
        bgClass = 'bg-slate-200/50'; 
    }

    const delBtn = (canDelete && !data.isDeleted) ? `<button onclick="deleteMsg('${id}')" class="absolute -right-2 -top-2 bg-rose-200 text-rose-700 rounded-full w-6 h-6 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity sketched-border">✖</button>` : '';
    const header = !isSelf ? `
        <div class="flex items-center gap-1 mb-1 cursor-pointer hover:opacity-80" onclick="showProfile('${data.senderId}')">
            <span class="text-2xl">${escapeHTML(data.senderEmoji || '👤')}</span>
            <span class="text-sm font-bold text-indigo-500 pl-1" style="color: currentColor; opacity: 0.8">${escapeHTML(data.senderName)}</span>
        </div>` : '';

    const wrapper = document.createElement('div');
    wrapper.className = `group flex flex-col gap-1 max-w-[85%] animate-pop relative ${isSelf ? 'self-end items-end' : 'self-start items-start'}`;
    wrapper.innerHTML = `
        ${header}
        <div class="${bgClass} text-slate-800 p-2 text-2xl sketched-border relative break-words shadow-sm">${safeText} ${delBtn}</div>
        <span class="text-xs font-bold opacity-60 px-1 mt-0.5">${timeStr}</span>`;
    UI.msgContainer.appendChild(wrapper);
}

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

            const div = document.createElement('div'); div.className = "flex flex-col gap-2 bg-slate-50 p-3 sketched-border";
            div.innerHTML = `
                <div class="flex justify-between items-center flex-wrap gap-2">
                    <span class="font-bold text-lg">${escapeHTML(u.emoji||'👤')} ${escapeHTML(u.username)} 
                        ${u.suspended ? '<b class="text-rose-500">(Banned)</b>' : ''}
                    </span>
                    <div class="flex gap-1 text-sm font-bold">
                        ${!isTargetSuper ? `<button onclick="toggleSuspend('${docSnap.id}',${!u.suspended})" class="bg-amber-400 text-white px-2 py-1 sketched-border hover:bg-amber-500">${u.suspended ? 'Unban' : 'Ban'}</button>` : ''}
                        ${(iAmSuper && !isTargetSuper) ? `<button onclick="toggleRole('${docSnap.id}', '${u.role === 'admin' ? 'user' : 'admin'}')" class="bg-indigo-400 text-white px-2 py-1 sketched-border hover:bg-indigo-500">${u.role === 'admin' ? 'Demote' : 'Make Admin'}</button>` : ''}
                    </div>
                </div>`;
            list.appendChild(div);
        });
    } catch (e) {
        console.error("Admin fetch error:", e);
        list.innerHTML = `<span class="text-rose-600 font-bold">Failed to load user list. Permission denied.</span>`;
    }
};

document.getElementById('admin-close').onclick = () => adminModal.classList.add('hidden');
window.toggleSuspend = async (uid, state) => { await updateDoc(doc(db, "users", uid), { suspended: state }); UI.adminBtn.click(); };
window.toggleRole = async (uid, newRole) => { await updateDoc(doc(db, "users", uid), { role: newRole }); UI.adminBtn.click(); };

// ==========================================
// DEV CONSOLE FUNCTIONS (WIPE UTILITIES)
// ==========================================

window.clearChat = async () => {
    console.log("Starting chat wipe...");
    try {
        const messagesQuery = await getDocs(collection(db, `rooms/${ROOM_ID}/messages`));
        const batch = writeBatch(db);
        let count = 0;
        messagesQuery.forEach((docSnap) => {
            batch.delete(docSnap.ref);
            count++;
        });
        await batch.commit();
        console.log(`Successfully wiped ${count} messages.`);
    } catch (e) {
        console.error("Failed to clear chat. Missing permissions?", e);
    }
};

/*window.clearUser = async () => {
    console.log("Starting users wipe...");
    try {
        const batch = writeBatch(db);
        const usersQuery = await getDocs(collection(db, "users"));
        let countU = 0;
        usersQuery.forEach((docSnap) => {
            // Avoid deleting active super admin account during wipe
            const data = docSnap.data();
            if (!SUPER_ADMINS.includes(data.username)) {
                batch.delete(docSnap.ref);
                countU++;
            }
        });
        
        const usernameQuery = await getDocs(collection(db, "usernames"));
        let countUn = 0;
        usernameQuery.forEach((docSnap) => {
            if (!SUPER_ADMINS.includes(docSnap.id)) {
                batch.delete(docSnap.ref);
                countUn++;
            }
        });

        await batch.commit();
        console.log(`Successfully wiped ${countU} users and ${countUn} registry entries.`);
    } catch (e) {
        console.error("Failed to clear users. Missing permissions?", e);
    }
};

window.clearAllData = async (password) => {
    if (password !== "shomer") {
        console.error("ACCESS DENIED: Invalid password.");
        return;
    }
    console.log("Password accepted. Initiating total system wipe...");
    await window.clearChat();
    await window.clearUser();
    console.log("Total system wipe complete.");
};*/