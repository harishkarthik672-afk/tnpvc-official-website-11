const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dns = require('dns');

// Custom DNS removed as it could cause issues on some cloud platforms

const app = express();
const server = http.createServer(app);

// ─── Socket.IO config ───────────────────────────────────────────────────────
const io = new Server(server, {
    cors: { 
        origin: ["https://www.tnpvc.co.in", "https://tnpvc.co.in", "https://tnpvc-official-website-11.onrender.com", "http://localhost:3000", "http://127.0.0.1:3000"], 
        methods: ["GET", "POST"], 
        credentials: true 
    },
    maxHttpBufferSize: 5e8,
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db.json');

app.use(cors({ 
    origin: ["https://www.tnpvc.co.in", "https://tnpvc.co.in", "https://tnpvc-official-website-11.onrender.com", "http://localhost:3000", "http://127.0.0.1:3000"], 
    methods: ["GET", "POST"], 
    credentials: true 
}));
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));
app.use(express.static(path.join(__dirname, '.')));

// ─── MongoDB Connection ──────────────────────────────────────────────────────
const MONGO_URI_SRV = "mongodb+srv://harishkarthik672_db_user:m2lvRLHv0wV7yFev@tnpvcofficialwebsite.ikz3lb3.mongodb.net/tnpvc_db?retryWrites=true&w=majority&appName=tnpvcofficialwebsite";
const MONGO_URI_LEGACY = "mongodb://harishkarthik672_db_user:m2lvRLHv0wV7yFev@tnpvcofficialwebsite-shard-00-00.ikz3lb3.mongodb.net:27017,tnpvcofficialwebsite-shard-00-01.ikz3lb3.mongodb.net:27017,tnpvcofficialwebsite-shard-00-02.ikz3lb3.mongodb.net:27017/tnpvc_db?ssl=true&replicaSet=atlas-pptvow-shard-0&authSource=admin&retryWrites=true&w=majority";

let isDbConnected = false;
let dbError = null;
let connectStartTime = null;

async function connectToDb() {
    connectStartTime = new Date();
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || MONGO_URI_SRV;
    const maskedUri = uri.replace(/:([^@]+)@/, ":****@");
    console.log('⏳ Connecting to MongoDB:', maskedUri.substring(0, 30) + '...');
    
    const options = {
        connectTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        serverSelectionTimeoutMS: 30000,
        heartbeatFrequencyMS: 10000
    };

    try {
        await mongoose.connect(uri, options);
        console.log('✅ MongoDB Atlas Connected Successfully');
        isDbConnected = true;
        dbError = null;
        migrateIfNeeded();
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
        dbError = err.message;
        
        // Try Legacy fallback automatically
        if (uri !== MONGO_URI_LEGACY) {
            console.log('🔄 Trying legacy fallback connection...');
            try {
                await mongoose.connect(MONGO_URI_LEGACY, options);
                isDbConnected = true;
                dbError = null;
                migrateIfNeeded();
                return;
            } catch (err2) {
                console.error('❌ Legacy Fallback also failed');
            }
        }
        
        console.log('🔁 Retrying in 5 seconds...');
        setTimeout(connectToDb, 5000);
    }
}

connectToDb();

// ─── Schemas & Models ────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    name: { type: String, index: true },
    email: String,
    avatar: { type: String, default: 'logo.png' },
    shop: String,
    location: String,
    bio: String,
    setupComplete: { type: Boolean, default: false }
}, { timestamps: true });

const postSchema = new mongoose.Schema({
    id: { type: Number, index: true },
    user: { type: String, index: true },
    avatar: String,
    media: [String],
    caption: String,
    likes: { type: Number, default: 0 },
    likedBy: [String],
    comments: [{
        user: String,
        text: String,
        avatar: String,
        time: String,
        createdAt: { type: Date, default: Date.now }
    }],
    time: String
}, { timestamps: true });

const notifSchema = new mongoose.Schema({
    id: Number,
    from: String,
    fromAvatar: String,
    to: { type: String, index: true },
    type: String,
    status: { type: String, default: 'pending' },
    time: String
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
    from: { type: String, index: true },
    to: { type: String, index: true },
    text: String,
    time: String
}, { timestamps: true });

const workSchema = new mongoose.Schema({
    id: Number,
    user: String,
    avatar: String,
    given: String,
    address: String,
    time: String
}, { timestamps: true });

const productSchema = new mongoose.Schema({
    id: Number,
    user: String,
    name: String,
    price: String,
    contact: String,
    media: [String]
}, { timestamps: true });

const followerSchema = new mongoose.Schema({
    targetUser: { type: String, unique: true },
    followersList: [String]
});

const User = mongoose.model('User', userSchema);
const Post = mongoose.model('Post', postSchema);
const Notification = mongoose.model('Notification', notifSchema);
const Message = mongoose.model('Message', messageSchema);
const WorkUpdate = mongoose.model('WorkUpdate', workSchema);
const Product = mongoose.model('Product', productSchema);
const Follower = mongoose.model('Follower', followerSchema);

// ─── Migration Logic ────────────────────────────────────────────────────────
async function migrateIfNeeded() {
    try {
        const usersToFix = await User.find({ $or: [{ userId: { $exists: false } }, { userId: null }, { userId: "" }] });
        if (usersToFix.length > 0) {
            console.log(`🔧 Generating IDs for ${usersToFix.length} users...`);
            for (let u of usersToFix) {
                u.userId = "tnpvc#" + Math.floor(10000000 + Math.random() * 90000000).toString();
                await u.save();
            }
        }

        const userCount = await User.countDocuments();
        if (userCount === 0 && fs.existsSync(DB_PATH)) {
            console.log('🔄 Disk db.json detected. Migrating to MongoDB...');
            const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
            
            if (data.all_users?.length) {
                data.all_users.forEach(u => {
                    if (!u.userId) u.userId = "tnpvc#" + Math.floor(10000000 + Math.random() * 90000000).toString();
                });
                await User.insertMany(data.all_users);
            }
            if (data.posts?.length) await Post.insertMany(data.posts);
            if (data.notifications?.length) await Notification.insertMany(data.notifications);
            if (data.messages?.length) await Message.insertMany(data.messages);
            if (data.work_updates?.length) await WorkUpdate.insertMany(data.work_updates);
            if (data.prods?.length) await Product.insertMany(data.prods);
            
            if (data.followers) {
                for (let target of Object.keys(data.followers)) {
                    await Follower.create({ targetUser: target, followersList: data.followers[target] });
                }
            }
            console.log('✅ Migration data moved to MongoDB Atlas');
            fs.renameSync(DB_PATH, DB_PATH + '.migrated');
        }
    } catch (e) {
        console.error('❌ Migration error:', e.message);
    }
}

// ─── Utility to fetch full state ─────────────────────────────────────────────
async function getFullState(userName) {
    if (!isDbConnected) return { all_users: [], posts: [], notifications: [], messages: [], work_updates: [], prods: [], followers: {} };

    try {
        const myName = (userName || "").trim();
        const [all_users, posts, notifications, allMessages, work_updates, prods, followersRaw] = await Promise.all([
            User.find().lean(),
            Post.find().sort({ createdAt: -1 }).limit(30).lean(),
            Notification.find({ to: myName }).sort({ createdAt: -1 }).limit(30).lean(),
            myName ? Message.find({ $or: [{ from: myName }, { to: myName }] }).sort({ createdAt: -1 }).limit(100).lean() : Promise.resolve([]),
            WorkUpdate.find().sort({ createdAt: -1 }).limit(30).lean(),
            Product.find().sort({ createdAt: -1 }).limit(50).lean(),
            Follower.find().lean()
        ]);

        const followers = {};
        followersRaw.forEach(f => { followers[f.targetUser] = f.followersList; });

        return { all_users, posts, notifications, messages: allMessages, work_updates, prods, followers };
    } catch (e) {
        console.error('Error fetching state:', e.message);
        return { all_users: [], posts: [], notifications: [], messages: [], work_updates: [], prods: [], followers: {} };
    }
}

const onlineUsers = new Map(); // Name -> Set(socket.ids)

// ─── Socket.IO Events ────────────────────────────────────────────────────────
io.on('connection', async (socket) => {
    console.log('📡 Client connected:', socket.id);
    // Send public state first
    socket.emit('initial_sync', await getFullState());

    socket.on('user_online', async (userName) => {
        if (userName) {
            const name = userName.trim();
            if (!onlineUsers.has(name)) onlineUsers.set(name, new Set());
            onlineUsers.get(name).add(socket.id);
            socket.data.userName = name;
            
            // Re-sync with private data
            socket.emit('initial_sync', await getFullState(name));
            io.emit('online_users', Array.from(onlineUsers.keys()));
        }
    });

    function sendToUser(name, event, data) {
        const sockets = onlineUsers.get((name || "").trim());
        if (sockets) {
            sockets.forEach(sid => io.to(sid).emit(event, data));
        }
    }

    socket.on('sync_user', async (userData) => {
        const name = (userData.name || '').trim();
        if (!name || !isDbConnected) return;
        try {
            if (!userData.userId) userData.userId = "tnpvc#" + Math.floor(10000000 + Math.random() * 90000000).toString();
            const updatedUser = await User.findOneAndUpdate({ name }, userData, { upsert: true, new: true }).lean();
            io.emit('db_updated', { type: 'users', data: await User.find().lean() });
            socket.emit('user_synced', updatedUser);
        } catch (err) { console.error('Sync user error:', err); }
    });

    socket.on('create_post', async (postData) => {
        try {
            // PROACTIVE BROADCAST: Send to all clients immediately for 'Live' feel
            console.log(`📢 Real-time broadcast for post from ${postData.user}`);
            
            if (isDbConnected) {
                await Post.create(postData);
                const allPosts = await Post.find().sort({ id: -1 }).limit(50).lean();
                io.emit('db_updated', { type: 'posts', data: allPosts });
            } else {
                console.warn('⚠️ DB offline. Emitting instant update only.');
                // Instant update for all connected users
                io.emit('db_updated', { type: 'posts', data: [postData] }); 
                socket.emit('error', 'Post visible but not saved to cloud (DB Offline)');
            }
        } catch (err) { 
            console.error('Socket create_post error:', err);
        }
    });

    socket.on('create_product', async (prodData) => {
        if (isDbConnected) {
            try {
                await Product.create(prodData);
                io.emit('db_updated', { type: 'prods', data: await Product.find().sort({ createdAt: -1 }).limit(50).lean() });
            } catch (err) { console.error('Create product error:', err); }
        }
    });

    socket.on('send_notification', async (notifData) => {
        const from = (notifData.from || '').trim();
        const to = (notifData.to || '').trim();
        if (!from || !to || !isDbConnected) return;
        try {
            await Notification.deleteMany({ from, to, type: 'follow_request' });
            await Notification.create({ ...notifData, from, to });
            // Only send to involved parties? Actually full notifications are often needed for badge updates.
            // But for privacy, we should probably filter. For now, let's keep it but at least target the new_notification.
            if (onlineUsers.has(to)) sendToUser(to, 'new_notification', notifData);
        } catch (err) { console.error('Send notification error:', err); }
    });

    socket.on('accept_follow', async ({ notifId, from, to }) => {
        if (!isDbConnected) return;
        try {
            await Notification.findOneAndUpdate({ id: notifId }, { status: 'accepted' });
            await Follower.findOneAndUpdate({ targetUser: to }, { $addToSet: { followersList: from.trim() } }, { upsert: true });
            io.emit('db_updated', { type: 'notifications', data: await Notification.find().sort({ createdAt: -1 }).limit(30).lean() });
            const followersRaw = await Follower.find().lean();
            const followers = {};
            followersRaw.forEach(f => { followers[f.targetUser] = f.followersList; });
            io.emit('db_updated', { type: 'followers', data: followers });
        } catch (err) { console.error('Accept follow error:', err); }
    });

    socket.on('unfollow', async ({ target, me }) => {
        if (!isDbConnected) return;
        try {
            await Follower.findOneAndUpdate({ targetUser: target }, { $pull: { followersList: me.trim() } });
            await Notification.deleteMany({ from: me, to: target, type: 'follow_request' });
            const followersRaw = await Follower.find().lean();
            const followers = {};
            followersRaw.forEach(f => { followers[f.targetUser] = f.followersList; });
            io.emit('db_updated', { type: 'followers', data: followers });
            io.emit('db_updated', { type: 'notifications', data: await Notification.find().sort({ createdAt: -1 }).limit(30).lean() });
        } catch (err) { console.error('Unfollow error:', err); }
    });

    socket.on('toggle_like', async ({ postId, liked, user }) => {
        if (!isDbConnected) return;
        try {
            const post = await Post.findOne({ id: postId });
            if (post) {
                const u = user.trim();
                if (liked) { if (!post.likedBy.includes(u)) post.likedBy.push(u); }
                else { post.likedBy = post.likedBy.filter(name => name !== u); }
                post.likes = post.likedBy.length;
                await post.save();
                io.emit('post_liked', { postId: post.id, likes: post.likes, likedBy: post.likedBy });
            }
        } catch (err) { console.error('Toggle like error:', err); }
    });

    socket.on('add_comment', async ({ postId, comment }) => {
        if (!isDbConnected) return;
        try {
            const post = await Post.findOne({ id: postId });
            if (post) {
                post.comments.push(comment);
                await post.save();
                io.emit('post_commented', { postId: post.id, comments: post.comments });
            }
        } catch (err) { console.error('Add comment error:', err); }
    });

    socket.on('send_message', async (msgData) => {
        if (isDbConnected) {
            try {
                await Message.create(msgData);
                // Broadcast to sender and receiver only for privacy
                const from = (msgData.from || "").trim();
                const to = (msgData.to || "").trim();
                sendToUser(from, 'incoming_message', msgData);
                if (to !== from) sendToUser(to, 'incoming_message', msgData);
            } catch (err) { console.error('Send message error:', err); }
        }
    });

    socket.on('delete_post', async (id) => {
        if (isDbConnected) {
            try {
                await Post.deleteOne({ id });
                const allPosts = await Post.find().sort({ id: -1 }).limit(50).lean();
                io.emit('db_updated', { type: 'posts', data: allPosts });
            } catch (err) { console.error('Delete post error:', err); }
        }
    });

    socket.on('disconnect', () => {
        const name = socket.data.userName;
        if (name && onlineUsers.has(name)) {
            const sockets = onlineUsers.get(name);
            sockets.delete(socket.id);
            if (sockets.size === 0) {
                onlineUsers.delete(name);
                io.emit('online_users', Array.from(onlineUsers.keys()));
            }
        }
        console.log('📡 Client disconnected:', socket.id);
    });
});

app.get('/ping', (req, res) => {
    res.json({ 
        status: 'ok', 
        db: isDbConnected, 
        error: dbError,
        mongoose: mongoose.connection.readyState,
        startTime: connectStartTime ? connectStartTime.toISOString() : "not_started",
        time: new Date().toISOString() 
    });
});

app.post('/api/upload-post', async (req, res) => {
    try {
        const postData = req.body;
        if (!isDbConnected) {
            return res.status(503).json({ status: 'error', message: 'Database not connected' });
        }
        await Post.create(postData);
        console.log(`✅ Post created via API from ${postData.user}, ID: ${postData.id}`);
        const allPosts = await Post.find().sort({ id: -1 }).limit(50).lean();
        io.emit('db_updated', { type: 'posts', data: allPosts });
        res.status(200).json({ status: 'success' });
    } catch (err) { 
        console.error('API Upload error:', err.message);
        res.status(500).send(err.message); 
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TNPVC Node Server started on port ${PORT}`);
});
