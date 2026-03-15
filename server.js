const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dns = require('dns');

// Force using Google DNS for resolve issues with MongoDB SRV records
try {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (e) {
    console.warn('⚠️ Could not set custom DNS servers:', e.message);
}

const app = express();
const server = http.createServer(app);

// ─── Socket.IO config ───────────────────────────────────────────────────────
const io = new Server(server, {
    cors: { 
        origin: ["https://www.tnpvc.co.in", "https://tnpvc.co.in", "http://localhost:3000", "http://127.0.0.1:3000"], 
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
    origin: ["https://www.tnpvc.co.in", "https://tnpvc.co.in", "http://localhost:3000", "http://127.0.0.1:3000"], 
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

async function connectToDb() {
    console.log('⏳ Connecting to MongoDB Atlas...');
    const options = {
        connectTimeoutMS: 60000,
        socketTimeoutMS: 60000,
        serverSelectionTimeoutMS: 60000,
    };

    try {
        await mongoose.connect(MONGO_URI_SRV, options);
        console.log('✅ MongoDB Atlas Connected Successfully (SRV)');
        isDbConnected = true;
        migrateIfNeeded();
    } catch (err) {
        console.warn('⚠️ SRV Connection failed, trying legacy format...', err.message);
        try {
            await mongoose.connect(MONGO_URI_LEGACY, options);
            console.log('✅ MongoDB Atlas Connected Successfully (Legacy)');
            isDbConnected = true;
            migrateIfNeeded();
        } catch (err2) {
            console.error('❌ MongoDB Connection Error:', err2.message);
            if (err2.message.includes('ECONNREFUSED')) {
                console.error('👉 Tip: Check your DNS settings or MongoDB Atlas IP Whitelist.');
            }
        }
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
        // Enforce IDs on all users
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
                // Ensure every migrated user has an ID
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
async function getFullState() {
    if (!isDbConnected) {
        console.warn('⚠️ DB not connected, attempting to serve from db.json fallback...');
        if (fs.existsSync(DB_PATH)) {
            try {
                const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
                return {
                    all_users: data.all_users || [],
                    posts: data.posts || [],
                    notifications: data.notifications || [],
                    messages: data.messages || [],
                    work_updates: data.work_updates || [],
                    prods: data.prods || [],
                    followers: data.followers || {}
                };
            } catch (err) {
                console.error('❌ Error reading db.json fallback:', err.message);
            }
        }
        return { all_users: [], posts: [], notifications: [], messages: [], work_updates: [], prods: [], followers: {} };
    }

    try {
        const [all_users, posts, notifications, messages, work_updates, prods, followersRaw] = await Promise.all([
            User.find().lean(),
            Post.find().sort({ createdAt: -1 }).limit(100).lean(),
            Notification.find().sort({ createdAt: -1 }).limit(50).lean(),
            Message.find().sort({ createdAt: -1 }).limit(200).lean(),
            WorkUpdate.find().sort({ createdAt: -1 }).limit(50).lean(),
            Product.find().sort({ createdAt: -1 }).limit(100).lean(),
            Follower.find().lean()
        ]);

        const followers = {};
        followersRaw.forEach(f => { followers[f.targetUser] = f.followersList; });

        return { all_users, posts, notifications, messages, work_updates, prods, followers };
    } catch (e) {
        console.error('Error fetching state:', e.message);
        return { all_users: [], posts: [], notifications: [], messages: [], work_updates: [], prods: [], followers: {} };
    }
}

const onlineUsers = {}; 

// ─── Socket.IO Events ────────────────────────────────────────────────────────
io.on('connection', async (socket) => {
    console.log('📡 Client connected:', socket.id);
    
    // Send initial sync immediately
    socket.emit('initial_sync', await getFullState());

    socket.on('user_online', (userName) => {
        if (userName) {
            const name = userName.trim();
            onlineUsers[name] = socket.id;
            socket.data.userName = name;
            io.emit('online_users', Object.keys(onlineUsers));
            console.log(`👤 ${name} is online`);
        }
    });

    socket.on('sync_user', async (userData) => {
        const name = (userData.name || '').trim();
        if (!name || !isDbConnected) return;
        try {
            // Ensure userId is present
            if (!userData.userId) {
                userData.userId = "tnpvc#" + Math.floor(10000000 + Math.random() * 90000000).toString();
            }
            await User.findOneAndUpdate({ name }, userData, { upsert: true, new: true });
            io.emit('db_updated', { type: 'users', data: await User.find().lean() });
        } catch (err) { console.error('Sync user error:', err); }
    });

    socket.on('create_post', async (postData) => {
        if (isDbConnected) {
            try {
                await Post.create(postData);
                const allPosts = await Post.find().sort({ createdAt: -1 }).limit(100).lean();
                io.emit('db_updated', { type: 'posts', data: allPosts });
            } catch (err) { console.error('Create post error:', err); }
        } else {
            console.log('📝 Local post broadcast (DB offline)');
            // DO NOT emit just one post, it wipes localStorage. Just ignore if DB is dead.
        }
    });

    socket.on('create_product', async (prodData) => {
        if (isDbConnected) {
            try {
                await Product.create(prodData);
                io.emit('db_updated', { type: 'prods', data: await Product.find().sort({ createdAt: -1 }).limit(100).lean() });
            } catch (err) { console.error('Create product error:', err); }
        }
    });

    socket.on('create_work_update', async (updateData) => {
        if (isDbConnected) {
            try {
                await WorkUpdate.create(updateData);
                io.emit('db_updated', { type: 'work_updates', data: await WorkUpdate.find().sort({ createdAt: -1 }).limit(100).lean() });
            } catch (err) { console.error('Work update error:', err); }
        }
    });

    socket.on('send_notification', async (notifData) => {
        const from = (notifData.from || '').trim();
        const to = (notifData.to || '').trim();
        if (!from || !to) return;
        if (isDbConnected) {
            try {
                await Notification.deleteMany({ from, to, type: 'follow_request' });
                await Notification.create({ ...notifData, from, to });
                io.emit('db_updated', { type: 'notifications', data: await Notification.find().sort({ createdAt: -1 }).limit(50).lean() });
            } catch (err) { console.error('Send notification error:', err); }
        }
        if (onlineUsers[to]) io.to(onlineUsers[to]).emit('new_notification', notifData);
    });

    socket.on('accept_follow', async ({ notifId, from, to }) => {
        if (!isDbConnected) return;
        try {
            await Notification.findOneAndUpdate({ id: notifId }, { status: 'accepted' });
            await Follower.findOneAndUpdate(
                { targetUser: to },
                { $addToSet: { followersList: from.trim() } },
                { upsert: true }
            );
            
            io.emit('db_updated', { type: 'notifications', data: await Notification.find().sort({ createdAt: -1 }).limit(50).lean() });
            const followersRaw = await Follower.find().lean();
            const followers = {};
            followersRaw.forEach(f => { followers[f.targetUser] = f.followersList; });
            io.emit('db_updated', { type: 'followers', data: followers });
        } catch (err) { console.error('Accept follow error:', err); }
    });

    socket.on('remove_notification', async (notifId) => {
        if (isDbConnected) {
            try {
                await Notification.deleteOne({ id: notifId });
                io.emit('db_updated', { type: 'notifications', data: await Notification.find().sort({ createdAt: -1 }).limit(50).lean() });
            } catch (err) { console.error('Remove notification error:', err); }
        }
    });

    socket.on('unfollow', async ({ target, me }) => {
        if (!isDbConnected) return;
        try {
            await Follower.findOneAndUpdate(
                { targetUser: target },
                { $pull: { followersList: me.trim() } }
            );
            await Notification.deleteMany({ from: me, to: target, type: 'follow_request' });
            
            const followersRaw = await Follower.find().lean();
            const followers = {};
            followersRaw.forEach(f => { followers[f.targetUser] = f.followersList; });
            io.emit('db_updated', { type: 'followers', data: followers });
            io.emit('db_updated', { type: 'notifications', data: await Notification.find().sort({ createdAt: -1 }).limit(50).lean() });
        } catch (err) { console.error('Unfollow error:', err); }
    });

    socket.on('toggle_like', async ({ postId, liked, user }) => {
        if (!isDbConnected) return;
        try {
            const post = await Post.findOne({ id: postId });
            if (post) {
                const u = user.trim();
                if (liked) {
                    if (!post.likedBy.includes(u)) post.likedBy.push(u);
                } else {
                    post.likedBy = post.likedBy.filter(name => name !== u);
                }
                post.likes = post.likedBy.length;
                await post.save();
                io.emit('db_updated', { type: 'posts', data: await Post.find().sort({ createdAt: -1 }).limit(100).lean() });
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
                io.emit('db_updated', { type: 'posts', data: await Post.find().sort({ createdAt: -1 }).limit(100).lean() });
            }
        } catch (err) { console.error('Add comment error:', err); }
    });

    socket.on('send_message', async (msgData) => {
        if (isDbConnected) {
            try {
                await Message.create(msgData);
                io.emit('db_updated', { type: 'messages', data: await Message.find().sort({ createdAt: -1 }).limit(200).lean() });
                if (onlineUsers[msgData.to]) io.to(onlineUsers[msgData.to]).emit('incoming_message', msgData);
            } catch (err) { console.error('Send message error:', err); }
        }
    });

    socket.on('delete_post', async (id) => {
        if (isDbConnected) {
            try {
                await Post.deleteOne({ id });
                io.emit('db_updated', { type: 'posts', data: await Post.find().sort({ createdAt: -1 }).limit(100).lean() });
            } catch (err) { console.error('Delete post error:', err); }
        }
    });

    socket.on('delete_product', async (id) => {
        if (isDbConnected) {
            try {
                await Product.deleteOne({ id });
                io.emit('db_updated', { type: 'prods', data: await Product.find().sort({ createdAt: -1 }).limit(100).lean() });
            } catch (err) { console.error('Delete product error:', err); }
        }
    });

    socket.on('delete_user', async (userId) => {
        await User.deleteOne({ userId });
        io.emit('db_updated', { type: 'users', data: await User.find().lean() });
    });

    socket.on('disconnect', () => {
        const name = socket.data.userName;
        if (name && onlineUsers[name] === socket.id) {
            delete onlineUsers[name];
            io.emit('online_users', Object.keys(onlineUsers));
        }
    });
});

app.get('/ping', (req, res) => res.json({ status: 'ok', db: isDbConnected, time: new Date() }));
app.get('/dashboard-page', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

// ─── REST Endpoints for Uploads ─────────────────────────────────────────────
app.post('/api/upload-post', async (req, res) => {
    try {
        const postData = req.body;
        if (isDbConnected) {
            await Post.create(postData);
            const allPosts = await Post.find().sort({ createdAt: -1 }).limit(100).lean();
            io.emit('db_updated', { type: 'posts', data: await Post.find().sort({ createdAt: -1 }).limit(100).lean() });
        } else {
            // Fallback: update db.json locally
            if (fs.existsSync(DB_PATH)) {
                let data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
                data.posts = data.posts || [];
                data.posts.unshift(postData);
                fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
            }
            // io.emit('db_updated', { type: 'posts', data: [postData] }); // Removed to avoid feed wipe
        }
        res.status(200).json({ status: 'success' });
    } catch (err) {
        console.error('REST Upload Error:', err);
        res.status(500).send(err.message);
    }
});

app.post('/api/sync-user', async (req, res) => {
    try {
        const userData = req.body;
        const name = (userData.name || '').trim();
        if (!name) return res.status(400).send('Name required');
        if (isDbConnected) {
            await User.findOneAndUpdate({ name }, userData, { upsert: true });
            io.emit('db_updated', { type: 'users', data: await User.find().lean() });
        }
        res.status(200).json({ status: 'success' });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TNPVC Node Server started on port ${PORT}`);
});
