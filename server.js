const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = 3000;
const DB_PATH = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.static(__dirname)); // serve all HTML/CSS files from current dir

let dbCache = { all_users: [], posts: [], notifications: [], followers: {}, prods: [], messages: [] };

try {
    if (fs.existsSync(DB_PATH)) {
        const raw = fs.readFileSync(DB_PATH, 'utf8');
        dbCache = { ...dbCache, ...JSON.parse(raw) };
    }
} catch (e) {
    console.error("Could not load DB", e);
}

const writeDB = () => {
    fs.writeFileSync(DB_PATH, JSON.stringify(dbCache, null, 2));
};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Send initial sync
    socket.emit('initial_sync', dbCache);

    // Sync User Profile Setup or Edit
    socket.on('sync_user', (userData) => {
        const trimmedName = (userData.name || '').trim();
        userData.name = trimmedName; // Ensure stored name is trimmed
        const idx = dbCache.all_users.findIndex(u => u.name.trim() === trimmedName);
        if (idx > -1) {
            dbCache.all_users[idx] = userData;
        } else {
            dbCache.all_users.push(userData);
        }
        writeDB();
        io.emit('db_updated', { type: 'users', data: dbCache.all_users });
    });

    // Create Post
    socket.on('create_post', (postData) => {
        dbCache.posts.unshift(postData);
        writeDB();
        io.emit('db_updated', { type: 'posts', data: dbCache.posts });
    });

    // Create Product
    socket.on('create_product', (prodData) => {
        dbCache.prods.unshift(prodData);
        writeDB();
        io.emit('db_updated', { type: 'prods', data: dbCache.prods });
    });

    // Send Notification / Follow Request
    socket.on('send_notification', (notifData) => {
        const from = notifData.from.trim();
        const to = notifData.to.trim();
        // filter out old requests from same user to same target
        dbCache.notifications = dbCache.notifications.filter(n => !(n.from.trim() === from && n.to.trim() === to && n.type === notifData.type));

        // Ensure data being stored is trimmed
        notifData.from = from;
        notifData.to = to;

        dbCache.notifications.unshift(notifData);
        writeDB();
        io.emit('db_updated', { type: 'notifications', data: dbCache.notifications });
    });

    // Accept Follow Request
    socket.on('accept_follow', ({ notifId, from, to }) => {
        const trimmedFrom = from.trim();
        const trimmedTo = to.trim();
        const notif = dbCache.notifications.find(n => n.id === notifId);
        if (notif) notif.status = 'accepted';

        if (!dbCache.followers[trimmedTo]) dbCache.followers[trimmedTo] = [];
        if (!dbCache.followers[trimmedTo].includes(trimmedFrom)) {
            dbCache.followers[trimmedTo].push(trimmedFrom);
        }
        writeDB();
        io.emit('db_updated', { type: 'notifications', data: dbCache.notifications });
        io.emit('db_updated', { type: 'followers', data: dbCache.followers });
    });

    // Decline/Cancel Follow Request
    socket.on('remove_notification', (notifId) => {
        dbCache.notifications = dbCache.notifications.filter(n => n.id !== notifId);
        writeDB();
        io.emit('db_updated', { type: 'notifications', data: dbCache.notifications });
    });

    // Unfollow
    socket.on('unfollow', ({ target, me }) => {
        const trimmedTarget = target.trim();
        const trimmedMe = me.trim();
        if (dbCache.followers[trimmedTarget]) {
            dbCache.followers[trimmedTarget] = dbCache.followers[trimmedTarget].filter(f => f.trim() !== trimmedMe);
            writeDB();
            io.emit('db_updated', { type: 'followers', data: dbCache.followers });
        }
        // Also remove notification pending if any
        dbCache.notifications = dbCache.notifications.filter(n => !(n.from.trim() === trimmedMe && n.to.trim() === trimmedTarget && n.type === 'follow_request'));
        writeDB();
        io.emit('db_updated', { type: 'notifications', data: dbCache.notifications });
    });

    // Toggle Like
    socket.on('toggle_like', ({ postId, liked, user }) => {
        const post = dbCache.posts.find(p => p.id == postId);
        const trimmedUser = (user || '').trim();
        if (post) {
            if (!post.likedBy) post.likedBy = [];
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

    // Add Comment
    socket.on('add_comment', ({ postId, comment }) => {
        const post = dbCache.posts.find(p => p.id == postId);
        if (post) {
            if (!post.comments) post.comments = [];
            if (comment.user) comment.user = comment.user.trim(); // Ensure comment user is trimmed
            post.comments.push(comment);
            writeDB();
            io.emit('db_updated', { type: 'posts', data: dbCache.posts });
        }
    });

    // Send Message
    socket.on('send_message', (msgData) => {
        msgData.from = msgData.from.trim();
        msgData.to = msgData.to.trim();
        dbCache.messages.push(msgData);
        writeDB();
        io.emit('db_updated', { type: 'messages', data: dbCache.messages });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('---------------------------------------------------------');
    console.log(`Real-Time Server Running!`);
    console.log(`Access this via http://localhost:${PORT}/feed.html in your browser`);
    console.log(`Or via your local IP address on another device`);
    console.log('---------------------------------------------------------');
});
