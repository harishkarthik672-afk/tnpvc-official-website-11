const mongoose = require('mongoose');
const MONGO_URI = "mongodb://harishkarthik672_db_user:m2lvRLHv0wV7yFev@tnpvcofficialwebsite-shard-00-00.ikz3lb3.mongodb.net:27017,tnpvcofficialwebsite-shard-00-01.ikz3lb3.mongodb.net:27017,tnpvcofficialwebsite-shard-00-02.ikz3lb3.mongodb.net:27017/tnpvc_db?ssl=true&replicaSet=atlas-pptvow-shard-0&authSource=admin&retryWrites=true&w=majority";

console.log('Connecting to MongoDB (Legacy format)...');
mongoose.connect(MONGO_URI)
.then(() => {
    console.log('✅ Connected!');
    process.exit(0);
})
.catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
