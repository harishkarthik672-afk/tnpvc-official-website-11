const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

// ─── Socket.IO config ───────────────────────────────────────────────────────
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 5e8,
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db.json');

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));
app.use(express.static(path.join(__dirname, '.')));

// ─── MongoDB Connection ──────────────────────────────────────────────────────
const MONGO_URI = "mongodb+srv://harishkarthik672_db_user:m2lvRLHv0wV7yFev@tnpvcofficialwebsite.ikz3lb3.mongodb.net/tnpvc_db?retryWrites=true&w=majority&appName=tnpvcofficialwebsite";

let isDbConnected = false;

mongoose.connect(MONGO_URI, {
    connectTimeoutMS: 30000,
    socketTimeoutMS: 45000,
})
.then(() => {
    console.log('✅ MongoDB Atlas Connected Successfully');
    isDbConnected = true;
    migrateIfNeeded();
})
.catch(err => {
    console.error('❌ MongoDB Connection Error:', err.message);
});

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

// ─── Migration Logic (One-time) ──────────────────────────────────────────────
async function migrateIfNeeded() {
    try {
        const userCount = await User.countDocuments();
        if (userCount === 0 && fs.existsSync(DB_PATH)) {
            console.log('🔄 Disk db.json detected. Migrating to MongoDB...');
            const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
            
            if (data.all_users?.length) await User.insertMany(data.all_users);
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
            // Rename file to prevent double migration
            fs.renameSync(DB_PATH, DB_PATH + '.migrated');
        }
    } catch (e) {
        console.error('❌ Migration error:', e.message);
    }
}

// ─── Utility to fetch full state ─────────────────────────────────────────────
async function getFullState() {
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
        if (!name) return;
        await User.findOneAndUpdate({ name }, userData, { upsert: true });
        io.emit('db_updated', { type: 'users', data: await User.find().lean() });
    });

    socket.on('create_post', async (postData) => {
        await Post.create(postData);
        io.emit('db_updated', { type: 'posts', data: await Post.find().sort({ createdAt: -1 }).limit(100).lean() });
    });

    socket.on('create_product', async (prodData) => {
        await Product.create(prodData);
        io.emit('db_updated', { type: 'prods', data: await Product.find().sort({ createdAt: -1 }).limit(100).lean() });
    });

    socket.on('create_work_update', async (updateData) => {
        await WorkUpdate.create(updateData);
        io.emit('db_updated', { type: 'work_updates', data: await WorkUpdate.find().sort({ createdAt: -1 }).limit(100).lean() });
    });

    socket.on('send_notification', async (notifData) => {
        const from = (notifData.from || '').trim();
        const to = (notifData.to || '').trim();
        if (!from || !to) return;
        await Notification.deleteMany({ from, to, type: 'follow_request' });
        await Notification.create(notifData);
        io.emit('db_updated', { type: 'notifications', data: await Notification.find().sort({ createdAt: -1 }).limit(50).lean() });
        if (onlineUsers[to]) io.to(onlineUsers[to]).emit('new_notification', notifData);
    });

    socket.on('accept_follow', async ({ notifId, from, to }) => {
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
    });

    socket.on('remove_notification', async (notifId) => {
        await Notification.deleteOne({ id: notifId });
        io.emit('db_updated', { type: 'notifications', data: await Notification.find().sort({ createdAt: -1 }).limit(50).lean() });
    });

    socket.on('unfollow', async ({ target, me }) => {
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
    });

    socket.on('toggle_like', async ({ postId, liked, user }) => {
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
    });

    socket.on('add_comment', async ({ postId, comment }) => {
        const post = await Post.findOne({ id: postId });
        if (post) {
            post.comments.push(comment);
            await post.save();
            io.emit('db_updated', { type: 'posts', data: await Post.find().sort({ createdAt: -1 }).limit(100).lean() });
        }
    });

    socket.on('send_message', async (msgData) => {
        await Message.create(msgData);
        io.emit('db_updated', { type: 'messages', data: await Message.find().sort({ createdAt: -1 }).limit(200).lean() });
        if (onlineUsers[msgData.to]) io.to(onlineUsers[msgData.to]).emit('incoming_message', msgData);
    });

    socket.on('delete_post', async (id) => {
        await Post.deleteOne({ id });
        io.emit('db_updated', { type: 'posts', data: await Post.find().sort({ createdAt: -1 }).limit(100).lean() });
    });

    socket.on('delete_product', async (id) => {
        await Product.deleteOne({ id });
        io.emit('db_updated', { type: 'prods', data: await Product.find().sort({ createdAt: -1 }).limit(100).lean() });
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

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TNPVC Node Server started on port ${PORT}`);
});
