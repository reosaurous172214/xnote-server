// server.js
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import mongoose from 'mongoose';
import multer from 'multer';
import cron from 'node-cron';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
// Middlewares
app.use(cors({
  origin: "https://xnote-ntkq.onrender.com",
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// MongoDB connection
const mongoURI = process.env.MONGO_URI;
mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.log('❌', err));

// Schemas
const userSchema = new mongoose.Schema({
  photo: { type: String },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});
const User = mongoose.model('User', userSchema);

const noteSchema = new mongoose.Schema({
  email: { type: String, required: true },
  title: { type: String, default: "" },
  content: { type: String, default: "" },
  color: { type: String, default: "#ffffff" },
  pinned: { type: Boolean, default: false },
  archived: { type: Boolean, default: false },

  // NEW: Trash / soft delete fields
  deleted: { type: Boolean, default: false },   // soft-deleted flag
  deletedAt: { type: Date, default: null }      // when moved to trash
}, { timestamps: true });
const Note = mongoose.model('Note', noteSchema);

// Multer (file upload)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Routes (existing)
app.get('/', (req, res) => res.send('Welcome to the XNote API'));

app.get('/api/users', async (req, res) => {
  try { const users = await User.find(); res.json(users); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users/register', upload.single('photo'), async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const photo = req.file ? `/uploads/${req.file.filename}` : null;
    const newUser = new User({ username, email, password, photo });
    await newUser.save();
    res.status(201).json({ message: 'User registered successfully', user: newUser });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/users/profile/:email', upload.single('photo'), async (req, res) => {
  try {
    const { username, password } = req.body;
    const photo = req.file ? `/uploads/${req.file.filename}` : null;
    const updateData = { username, password };
    if (photo) updateData.photo = photo;
    const updatedUser = await User.findOneAndUpdate({ email: req.params.email }, updateData, { new: true });
    if (!updatedUser) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid email or password' });
    const { password: _, ...userWithoutPassword } = user._doc;
    res.json({ message: 'Login successful', user: userWithoutPassword });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/profile/:email', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email }).select("-password");
    if (!user) return res.status(404).json({ error: 'User not found' });
    const photoUrl = user.photo ? `${req.protocol}://${req.get('host')}${user.photo}` : null;
    res.json({ username: user.username, email: user.email, photo: photoUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Notes: CRUD & utilities
app.get('/api/notes', async (req, res) => {
  try {
    const notes = await Note.find({ deleted: false }).sort({ createdAt: -1 });
    res.json(notes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/notes/:email', async (req, res) => {
  try {
    // return only non-deleted notes
    const notes = await Note.find({ email: req.params.email, deleted: false })
      .sort({ pinned: -1, createdAt: -1 });
    res.json(notes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/notes', async (req, res) => {
  try {
    const { title, content, email, color, pinned, archived } = req.body;
    const newNote = new Note({ email, title, content, color, pinned, archived });
    await newNote.save();
    res.status(201).json({ message: 'Note created successfully', note: newNote });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/notes/:id', async (req, res) => {
  try {
    const updatedNote = await Note.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    if (!updatedNote) return res.status(404).json({ error: 'Note not found' });
    res.json({ message: 'Note updated successfully', note: updatedNote });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Permanent delete (delete forever)
app.delete('/api/notes/:id', async (req, res) => {
  try {
    const deletedNote = await Note.findByIdAndDelete(req.params.id);
    if (!deletedNote) return res.status(404).json({ error: 'Note not found' });
    res.json({ message: 'Note deleted successfully (permanently)' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Toggle pin
app.patch('/api/notes/:id/pin', async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    note.pinned = !note.pinned;
    await note.save();
    res.json({ message: 'Note pin toggled', note });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Toggle archive
app.patch('/api/notes/:id/archive', async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    note.archived = !note.archived;
    await note.save();
    res.json({ message: 'Note archive toggled', note });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

//
// TRASH (soft delete) endpoints
//

// Soft-delete (move to trash)
app.put('/api/notes/:id/trash', async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    note.deleted = true;
    note.deletedAt = new Date();
    await note.save();
    res.json({ message: 'Note moved to trash', note });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Restore from trash
app.put('/api/notes/:id/restore', async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    note.deleted = false;
    note.deletedAt = null;
    await note.save();
    res.json({ message: 'Note restored from trash', note });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get trashed notes for a user
app.get('/api/notes/trash/:email', async (req, res) => {
  try {
    const notes = await Note.find({ email: req.params.email, deleted: true }).sort({ deletedAt: -1 });
    res.json(notes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auto-purge cron job
const TRASH_RETENTION_DAYS = Number(process.env.TRASH_RETENTION_DAYS) || 7; // default 7 days

// Run once every day at 2:00 AM server time (cron expression)
cron.schedule('0 2 * * *', async () => {
  try {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await Note.deleteMany({ deleted: true, deletedAt: { $lte: cutoff } });
    console.log(`Cron: Permanently removed ${result.deletedCount} trashed notes older than ${TRASH_RETENTION_DAYS} days`);
  } catch (err) {
    console.error('Cron error while purging trashed notes:', err);
  }
});

// For convenience, also log a purge when server starts (non-destructive)
(async function initialPurgeLog() {
  try {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const count = await Note.countDocuments({ deleted: true, deletedAt: { $lte: cutoff } });
    if (count) console.log(`Startup: ${count} trashed notes older than ${TRASH_RETENTION_DAYS} days are eligible for purge.`);
  } catch (err) { /* ignore */ }
})();

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
