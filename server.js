import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import mongoose from 'mongoose';

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
    title: { type: String, required: true },
    content: { type: String, required: true },
    color: { type: String, default: "#ffffff" },   // note background color
    pinned: { type: Boolean, default: false },     // pinned note
    archived: { type: Boolean, default: false }    // archived note
}, { timestamps: true });
const Note = mongoose.model('Note', noteSchema);


// Routes
app.get('/', (req, res) => {
    res.send('Welcome to the XNote API');
}   );
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// Register
import multer from 'multer';

// configure multer to save files in uploads/ folder
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// Route: Register user with photo upload
app.post('/api/users/register', upload.single('photo'), async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const photo = req.file ? `/uploads/${req.file.filename}` : null;

        const newUser = new User({ username, email, password, photo });
        await newUser.save();

        res.status(201).json({ message: 'User registered successfully', user: newUser });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
//update user profile with photo upload
app.put('/api/users/profile/:email', upload.single('photo'), async (req, res) => {
    try {
        const { username, password } = req.body;
        const photo = req.file ? `/uploads/${req.file.filename}` : null;
        const updateData = { username, password };
        if (photo) updateData.photo = photo;
        const updatedUser = await User.findOneAndUpdate({ email: req.params.email }, updateData, { new: true });
        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ message: 'Profile updated successfully', user: updatedUser });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }   
});

// Login
app.post('/api/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Exclude password
    const { password: _, ...userWithoutPassword } = user._doc;

    res.json({ message: 'Login successful', user: userWithoutPassword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Profile by Email
app.get('/api/users/profile/:email', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email }).select("-password");
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Construct full photo URL if photo exists
    const photoUrl = user.photo ? `${req.protocol}://${req.get('host')}${user.photo}` : null;

    res.json({
      username: user.username,
      email: user.email,
      photo: photoUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Note
//get all notes
app.get('/api/notes', async (req, res) => {
    try {
        const notes = await Note.find().sort({ createdAt: -1 });
        res.json(notes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

//create a note
app.post('/api/notes', async (req, res) => {
    try {
        const {  title, content,email, color, pinned, archived } = req.body;
        const newNote = new Note({ email, title, content, color, pinned, archived });
        await newNote.save();
        res.status(201).json({ message: 'Note created successfully', note: newNote });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

//update a note
app.put('/api/notes/:id', async (req, res) => {
    try {
        const updatedNote = await Note.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },   // can update color, pinned, archived, etc.
            { new: true }
        );
        if (!updatedNote) return res.status(404).json({ error: 'Note not found' });
        res.json({ message: 'Note updated successfully', note: updatedNote });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

//delete a note
app.delete('/api/notes/:id', async (req, res) => {
    try {
        const deletedNote = await Note.findByIdAndDelete(req.params.id);
        if (!deletedNote) return res.status(404).json({ error: 'Note not found' });
        res.json({ message: 'Note deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
//toggle pin a note
app.patch('/api/notes/:id/pin', async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        if (!note) return res.status(404).json({ error: 'Note not found' });

        note.pinned = !note.pinned;
        await note.save();

        res.json({ message: 'Note pin toggled', note });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
//toggle archive a note
app.patch('/api/notes/:id/archive', async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        if (!note) return res.status(404).json({ error: 'Note not found' });

        note.archived = !note.archived;
        await note.save();

        res.json({ message: 'Note archive toggled', note });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Notes by Email
app.get('/api/notes/:email', async (req, res) => {
  const notes = await Note.find({ email: req.params.email }).sort({ pinned: -1, createdAt: -1 });
  res.json(notes);
});

app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
