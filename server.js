const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);

// ─── Socket.IO config optimised for Render.com (free tier) ───────────────────
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e8 // Increase limit to 100MB for videos/images
});

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db.json');

// Enable CORS for all HTTP routes (not just socket)
const corsHandler = cors({
    origin: "*",
    methods: ["GET", "POST"]
});
app.use(corsHandler);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '.')));

// Ping route for diagnostic button
app.get('/ping', (req, res) => {
    res.send('pong ' + new Date().toLocaleTimeString());
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ─── In-memory DB ─────────────────────────────────────────────────────────────
let dbCache = {
    all_users: [], posts: [], notifications: [],
    followers: {}, prods: [], messages: [], work_updates: []
};

try {
    if (fs.existsSync(DB_PATH)) {
        const raw = fs.readFileSync(DB_PATH, 'utf8');
        dbCache = { ...dbCache, ...JSON.parse(raw) };
        console.log('DB loaded successfully');
    }
} catch (e) {
    console.error("Could not load DB:", e.message);
}

// Debounced write to avoid too many disk writes
let writeTimer = null;
const writeDB = () => {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
        try {
            fs.writeFileSync(DB_PATH, JSON.stringify(dbCache, null, 2));
        } catch(e) {
            console.error('DB write error:', e.message);
        }
    }, 300);
};

// ─── Track online users: name → socket.id ────────────────────────────────────
const onlineUsers = {};  // { "UserName": "socket_id" }

function broadcastOnlineUsers() {
    io.emit('online_users', Object.keys(onlineUsers));
}

// ─── Socket.IO Events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    // Send full DB state to the newly connected client
    socket.emit('initial_sync', dbCache);

    // ── User goes online ──────────────────────────────────────────────────────
    socket.on('user_online', (userName) => {
        if (userName) {
            onlineUsers[userName.trim()] = socket.id;
            socket.data.userName = userName.trim();
            broadcastOnlineUsers();
        }
    });

    // ── Sync User Profile ─────────────────────────────────────────────────────
    socket.on('sync_user', (userData) => {
        const trimmedName = (userData.name || '').trim();
        userData.name = trimmedName;
        const idx = dbCache.all_users.findIndex(u => (u.name || '').trim() === trimmedName);
        if (idx > -1) dbCache.all_users[idx] = userData;
        else dbCache.all_users.push(userData);
        writeDB();
        io.emit('db_updated', { type: 'users', data: dbCache.all_users });
    });

    // ── Create Post ───────────────────────────────────────────────────────────
    socket.on('create_post', (postData) => {
        console.log('New Post received from:', postData.user);
        dbCache.posts.unshift(postData);
        writeDB();
        io.emit('db_updated', { type: 'posts', data: dbCache.posts });
    });

    // ── Create Product ────────────────────────────────────────────────────────
    socket.on('create_product', (prodData) => {
        dbCache.prods.unshift(prodData);
        writeDB();
        io.emit('db_updated', { type: 'prods', data: dbCache.prods });
    });

    // ── Create Work Update ────────────────────────────────────────────────────
    socket.on('create_work_update', (updateData) => {
        if (!dbCache.work_updates) dbCache.work_updates = [];
        dbCache.work_updates.unshift(updateData);
        writeDB();
        io.emit('db_updated', { type: 'work_updates', data: dbCache.work_updates });
    }); // Closing bracket added here

    // ── Send Notification / Follow Request ────────────────────────────────────
    socket.on('send_notification', (notifData) => {
        const from = (notifData.from || '').trim();
        const to   = (notifData.to   || '').trim();
        if (!from || !to) return;

        // Remove old duplicate
        dbCache.notifications = dbCache.notifications.filter(n =>
            !(n.from.trim() === from && n.to.trim() === to && n.type === notifData.type)
        );
        notifData.from = from;
        notifData.to   = to;
        dbCache.notifications.unshift(notifData);
        writeDB();

        // Broadcast to everyone (all clients update their notification store)
        io.emit('db_updated', { type: 'notifications', data: dbCache.notifications });

        // ALSO send a targeted "ping" to the recipient if they're online
        const recipientSocketId = onlineUsers[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('new_notification', notifData);
        }
    });

    // ── Accept Follow ─────────────────────────────────────────────────────────
    socket.on('accept_follow', ({ notifId, from, to }) => {
        const trimmedFrom = (from || '').trim();
        const trimmedTo   = (to   || '').trim();
        const notif = dbCache.notifications.find(n => n.id === notifId);
        if (notif) notif.status = 'accepted';

        if (!dbCache.followers[trimmedTo]) dbCache.followers[trimmedTo] = [];
        if (!dbCache.followers[trimmedTo].some(f => f.trim() === trimmedFrom)) {
            dbCache.followers[trimmedTo].push(trimmedFrom);
        }
        writeDB();
        io.emit('db_updated', { type: 'notifications', data: dbCache.notifications });
        io.emit('db_updated', { type: 'followers',     data: dbCache.followers });
    });

    // ── Decline / Cancel Follow ───────────────────────────────────────────────
    socket.on('remove_notification', (notifId) => {
        dbCache.notifications = dbCache.notifications.filter(n => n.id !== notifId);
        writeDB();
        io.emit('db_updated', { type: 'notifications', data: dbCache.notifications });
    });

    // ── Unfollow ──────────────────────────────────────────────────────────────
    socket.on('unfollow', ({ target, me }) => {
        const trimmedTarget = (target || '').trim();
        const trimmedMe     = (me     || '').trim();
        if (dbCache.followers[trimmedTarget]) {
            dbCache.followers[trimmedTarget] = dbCache.followers[trimmedTarget].filter(f => f.trim() !== trimmedMe);
        }
        dbCache.notifications = dbCache.notifications.filter(n =>
            !(n.from.trim() === trimmedMe && n.to.trim() === trimmedTarget && n.type === 'follow_request')
        );
        writeDB();
        io.emit('db_updated', { type: 'followers',     data: dbCache.followers });
        io.emit('db_updated', { type: 'notifications', data: dbCache.notifications });
    });

    // ── Toggle Like ───────────────────────────────────────────────────────────
    socket.on('toggle_like', ({ postId, liked, user }) => {
        const post = dbCache.posts.find(p => p.id == postId);
        const trimmedUser = (user || '').trim();
        if (post) {
            if (!Array.isArray(post.likedBy)) post.likedBy = [];
            if (liked) {
                if (!post.likedBy.some(u => u.trim() === trimmedUser)) post.likedBy.push(trimmedUser);
            } else {
                post.likedBy = post.likedBy.filter(u => u.trim() !== trimmedUser);
            }
            post.likes = post.likedBy.length;
            writeDB();
            io.emit('db_updated', { type: 'posts', data: dbCache.posts });
        }
    });

    // ── Add Comment ───────────────────────────────────────────────────────────
    socket.on('add_comment', ({ postId, comment }) => {
        const post = dbCache.posts.find(p => p.id == postId);
        if (post) {
            if (!post.comments) post.comments = [];
            if (comment.user) comment.user = comment.user.trim();
            post.comments.push(comment);
            writeDB();
            io.emit('db_updated', { type: 'posts', data: dbCache.posts });
        }
    });

    // ── Send Direct Message ───────────────────────────────────────────────────
    socket.on('send_message', (msgData) => {
        msgData.from = (msgData.from || '').trim();
        msgData.to   = (msgData.to   || '').trim();
        msgData.time = msgData.time || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        dbCache.messages.push(msgData);
        writeDB();
        console.log('New Message from', msgData.from, 'to', msgData.to);
        // Broadcast to all (every client updates their local store)
        io.emit('db_updated', { type: 'messages', data: dbCache.messages });

        // ALSO direct ping to recipient if online (for instant chat refresh)
        const recipientSocketId = onlineUsers[msgData.to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('incoming_message', msgData);
        }
    });

    // ── Delete Operations ─────────────────────────────────────────────────────
    socket.on('delete_post', (postId) => {
        dbCache.posts = dbCache.posts.filter(p => p.id != postId);
        writeDB();
        io.emit('db_updated', { type: 'posts', data: dbCache.posts });
    });

    socket.on('delete_product', (prodId) => {
        dbCache.prods = dbCache.prods.filter(p => p.id != prodId);
        writeDB();
        io.emit('db_updated', { type: 'prods', data: dbCache.prods });
    });

    socket.on('delete_work_update', (updateId) => {
        dbCache.work_updates = dbCache.work_updates.filter(u => u.id != updateId);
        writeDB();
        io.emit('db_updated', { type: 'work_updates', data: dbCache.work_updates });
    });

    socket.on('delete_user', (userId) => {
        dbCache.all_users = dbCache.all_users.filter(u => u.userId != userId);
        writeDB();
        io.emit('db_updated', { type: 'users', data: dbCache.all_users });
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
        console.log('Disconnected:', socket.id, '| reason:', reason);
        const name = socket.data.userName;
        if (name && onlineUsers[name] === socket.id) {
            delete onlineUsers[name];
            broadcastOnlineUsers();
        }
    });
});

// ─── Keep-alive self-ping for Render free tier (prevents 15-min sleep) ────────
if (process.env.RENDER_EXTERNAL_URL) {
    const https = require('https');
    setInterval(() => {
        const url = process.env.RENDER_EXTERNAL_URL.endsWith('/') 
            ? process.env.RENDER_EXTERNAL_URL + 'ping' 
            : process.env.RENDER_EXTERNAL_URL + '/ping';
        https.get(url, (r) => {
            console.log('Keep-alive ping:', r.statusCode);
        }).on('error', (e) => { console.error('Ping error:', e.message); });
    }, 10 * 60 * 1000); // every 10 minutes (more aggressive)
}

server.listen(PORT, '0.0.0.0', () => {
    console.log('─────────────────────────────────────────────────');
    console.log(`TNPVC Real-Time Server running on port ${PORT}`);
    console.log(`Local: http://localhost:${PORT}/feed.html`);
    console.log('─────────────────────────────────────────────────');
});
