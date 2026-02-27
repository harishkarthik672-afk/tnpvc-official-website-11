const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'db.json');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Helper to read DB
const readDB = () => JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

// Helper to write DB
const writeDB = (data) => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));

// Get all data
app.get('/api/feed', (req, res) => {
    try {
        const db = readDB();
        res.json(db);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load feed' });
    }
});

// Toggle Like
app.post('/api/like', (req, res) => {
    const { postId, username } = req.body;
    const db = readDB();
    const post = db.posts.find(p => p.id === postId);

    if (post) {
        if (!post.likedBy) post.likedBy = [];
        const index = post.likedBy.indexOf(username);

        if (index === -1) {
            post.likedBy.push(username);
            post.likes++;
        } else {
            post.likedBy.splice(index, 1);
            post.likes--;
        }
        writeDB(db);
        res.json({ success: true, likes: post.likes, liked: index === -1 });
    } else {
        res.status(404).json({ error: 'Post not found' });
    }
});

// Toggle Follow
app.post('/api/follow', (req, res) => {
    const { targetUser, username } = req.body;
    const db = readDB();
    if (!db.users.me.followingList) db.users.me.followingList = [];

    const index = db.users.me.followingList.indexOf(targetUser);
    if (index === -1) {
        db.users.me.followingList.push(targetUser);
        db.users.me.following++;
    } else {
        db.users.me.followingList.splice(index, 1);
        db.users.me.following--;
    }
    writeDB(db);
    res.json({ success: true, following: db.users.me.following, isFollowing: index === -1 });
});

// Create Post
app.post('/api/posts', (req, res) => {
    const { text, username } = req.body;
    const db = readDB();
    const newPost = {
        id: 'post_' + Date.now(),
        user: username,
        avatar: '', // Default avatar
        location: 'Tamil Nadu',
        media: '', // Text-only for now
        caption: text,
        likes: 0,
        time: 'JUST NOW',
        likedBy: []
    };
    db.posts.unshift(newPost);
    writeDB(db);
    res.json(newPost);
});

// Create Status
app.post('/api/status', (req, res) => {
    const { text, username } = req.body;
    const db = readDB();
    if (!db.statuses) db.statuses = [];

    const newStatus = {
        id: 'status_' + Date.now(),
        user: username,
        avatar: 'srinivasan.jpg', // Default for now
        content: text,
        time: Date.now()
    };
    db.statuses.unshift(newStatus);
    writeDB(db);
    res.json(newStatus);
});

app.listen(PORT, () => {
    console.log(`Backend server running at http://localhost:${PORT}`);
});
