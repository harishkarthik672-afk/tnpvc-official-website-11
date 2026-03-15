const mongoose = require('mongoose');
const MONGO_URI = "mongodb+srv://harishkarthik672_db_user:m2lvRLHv0wV7yFev@tnpvcofficialwebsite.ikz3lb3.mongodb.net/tnpvc_db?retryWrites=true&w=majority&appName=tnpvcofficialwebsite";

console.log('Connecting to MongoDB...');
mongoose.connect(MONGO_URI)
.then(() => {
    console.log('✅ Connected!');
    process.exit(0);
})
.catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
