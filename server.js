const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = 'my_super_secret_key_123';
const dbPath = path.resolve(__dirname, 'football_academy.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error(err.message);
    else {
        console.log('تم الاتصال بقاعدة بيانات SQLite بنجاح.');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, password TEXT, role TEXT)`);
        db.run(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, birth_date TEXT NOT NULL, parent_phone TEXT NOT NULL, relative_relation TEXT, relative_phone TEXT, member_number TEXT, height REAL, weight REAL, allergies TEXT, chronic_diseases TEXT, past_injuries TEXT, current_medications TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS sports (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)`);
        
        // جدول الباقات بعد دمج الحقل الجديد وحذف التكرار العشوائي
        db.run(`CREATE TABLE IF NOT EXISTS packages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            sport_id INTEGER NOT NULL, 
            name TEXT NOT NULL, 
            days TEXT NOT NULL, 
            session_time TEXT NOT NULL, 
            max_subscribers INTEGER DEFAULT 0, 
            FOREIGN KEY(sport_id) REFERENCES sports(id)
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS package_durations (id INTEGER PRIMARY KEY AUTOINCREMENT, package_id INTEGER NOT NULL, months INTEGER NOT NULL, price REAL NOT NULL, is_active INTEGER DEFAULT 0, FOREIGN KEY(package_id) REFERENCES packages(id))`);
        db.run(`CREATE TABLE IF NOT EXISTS subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL, duration_id INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(player_id) REFERENCES players(id), FOREIGN KEY(duration_id) REFERENCES package_durations(id))`);
        
        // 📝 إضافة جدول الحضور والغياب الجديد
        db.run(`CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            package_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL, -- 'present' أو 'absent'
            FOREIGN KEY(player_id) REFERENCES players(id),
            FOREIGN KEY(package_id) REFERENCES packages(id)
        )`);

        // 🚀 زرع حساب المدير الافتراضي مشفراً إذا كان الجدول فارغاً (حل مشكلة الدخول 401)
        db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
            if (row && row.count === 0) {
                const hashedPassword = bcrypt.hashSync('password', 10);
                db.run("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)", ['المدير العام', 'admin@academy.com', hashedPassword, 'admin']);
                console.log('💡 تم إنشاء حساب المدير الافتراضي بنجاح (admin@academy.com).');
            }
        });

        db.get("SELECT COUNT(*) as count FROM sports", (err, row) => {
            if (row && row.count === 0) {
                db.run("INSERT INTO sports (name) VALUES ('كرة القدم')");
                db.run("INSERT INTO sports (name) VALUES ('سباحة')");
                db.run("INSERT INTO sports (name) VALUES ('تايكوندو')");
            }
        });
    });
}

function verifyToken(req, res, next) {
    const bearerHeader = req.headers['authorization'];
    if (typeof bearerHeader !== 'undefined') {
        const bearerToken = bearerHeader.split(' ')[1];
        jwt.verify(bearerToken, JWT_SECRET, (err, authData) => {
            if (err) return res.status(403).json({ message: 'التوكن غير صالح' });
            req.user = authData;
            next();
        });
    } else { res.status(401).json({ message: 'غير مسموح بالدخول' }); }
}

app.get('/api/dashboard/data', verifyToken, (req, res) => {
    res.json({ name: req.user.name, role: req.user.role, secretData: req.user.role === 'admin' ? "🔒 أرباحك 5000$" : "📋 لديك حصتين اليوم" });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ message: 'بيانات الدخول خاطئة' });
        const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token });
    });
});

app.post('/api/players', verifyToken, (req, res) => {
    const p = req.body;
    const sql = `INSERT INTO players (name, birth_date, parent_phone, relative_relation, relative_phone, member_number, height, weight, allergies, chronic_diseases, past_injuries, current_medications) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [p.name, p.birth_date, p.parent_phone, p.relative_relation, p.relative_phone, p.member_number, p.height, p.weight, p.allergies, p.chronic_diseases, p.past_injuries, p.current_medications], function(err) {
        if (err) return res.status(500).json({ message: 'خطأ أثناء الحفظ' });
        res.json({ message: '✅ تم تسجيل اللاعب بنجاح!' });
    });
});

app.get('/api/players', verifyToken, (req, res) => {
    db.all("SELECT id, name, member_number FROM players ORDER BY id DESC", [], (err, rows) => { res.json(rows); });
});

app.get('/api/sports', verifyToken, (req, res) => {
    db.all("SELECT * FROM sports", [], (err, rows) => { res.json(rows); });
});

// استقبال وحفظ الباقة مع الحد الأقصى للمشتركين
app.post('/api/packages', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'عذراً، هذه الصلاحية خاصة بالمدير العام فقط!' });
    
    const { sport_name, name, days, session_time, durations, max_subscribers } = req.body;

    if (!sport_name || !name || !days || !session_time) {
        return res.status(400).json({ message: 'الرجاء التأكد من إدخال كافة البيانات الأساسية' });
    }

    db.get("SELECT id FROM sports WHERE name = ?", [sport_name.trim()], (err, row) => {
        if (err) return res.status(500).json({ message: 'خطأ في فحص الرياضة' });

        const insertPackageAndDurations = (sportId) => {
            const packageSql = `INSERT INTO packages (sport_id, name, days, session_time, max_subscribers) VALUES (?, ?, ?, ?, ?)`;
            db.run(packageSql, [sportId, name, days, session_time, max_subscribers || 0], function(err) {
                if (err) return res.status(500).json({ message: 'حدث خطأ أثناء حفظ الباقة الأساسية' });

                const packageId = this.lastID;
                const durationSql = `INSERT INTO package_durations (package_id, months, price, is_active) VALUES (?, ?, ?, ?)`;
                const stmt = db.prepare(durationSql);

                durations.forEach(d => {
                    stmt.run(packageId, d.months, d.price || 0, d.is_active ? 1 : 0);
                });

                stmt.finalize((finalizeErr) => {
                    if (finalizeErr) return res.status(500).json({ message: 'خطأ في حفظ أسعار الفترات' });
                    res.json({ message: '✅ تم إنشاء الرياضة والباقة وضبط فترات الأشهر بنجاح للموظفين!' });
                });
            });
        };

        if (row) {
            insertPackageAndDurations(row.id);
        } else {
            db.run("INSERT INTO sports (name) VALUES (?)", [sport_name.trim()], function(err) {
                if (err) return res.status(500).json({ message: 'خطأ في إنشاء الرياضة الجديدة' });
                insertPackageAndDurations(this.lastID);
            });
        }
    });
});

app.get('/api/active-packages', verifyToken, (req, res) => {
    const sql = `
        SELECT pd.id AS duration_id, s.name AS sport_name, p.name AS package_name, pd.months, pd.price
        FROM package_durations pd
        JOIN packages p ON pd.package_id = p.id
        JOIN sports s ON p.sport_id = s.id
        WHERE pd.is_active = 1
        ORDER BY s.name, p.name, pd.months
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ message: 'خطأ في جلب الباقات' });
        res.json(rows);
    });
});

app.post('/api/subscriptions', verifyToken, (req, res) => {
    const { player_id, duration_id, start_date, end_date } = req.body;
    db.run(`INSERT INTO subscriptions (player_id, duration_id, start_date, end_date) VALUES (?, ?, ?, ?)`, [player_id, duration_id, start_date, end_date], function(err) {
        if (err) return res.status(500).json({ message: 'خطأ أثناء حفظ الاشتراك' });
        res.json({ message: '✅ تم تفعيل اشتراك اللاعب بنجاح حسب المدة المحددة الباقة!' });
    });
});


// 🔔 =========================================================
// 🚀 روابط ميزة الحضور والغياب المضافة حديثاً
// 🔔 =========================================================

// 1. جلب قائمة كل الباقات المتاحة مع اسم الرياضة الخاص بها لتسهيل الاختيار في صفحة الحضور
app.get('/api/packages-list', verifyToken, (req, res) => {
    const sql = `
        SELECT p.id, p.name AS package_name, s.name AS sport_name 
        FROM packages p
        JOIN sports s ON p.sport_id = s.id
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ message: 'خطأ في جلب قائمة الباقات' });
        res.json(rows);
    });
});

// 2. جلب اللاعبين المشتركين حالياً في باقة معينة بناءً على كود الباقة
app.get('/api/packages/:id/players', verifyToken, (req, res) => {
    const packageId = req.params.id;
    const sql = `
        SELECT DISTINCT pl.id, pl.name, pl.parent_phone, pl.member_number
        FROM players pl
        JOIN subscriptions sub ON pl.id = sub.player_id
        JOIN package_durations pd ON sub.duration_id = pd.id
        WHERE pd.package_id = ?
    `;
    db.all(sql, [packageId], (err, rows) => {
        if (err) return res.status(500).json({ message: 'خطأ في جلب لاعبي الباقة' });
        res.json(rows);
    });
});

// 3. حفظ كشف الحضور والغياب اليومي (تحديث أو إضافة جماعية)
app.post('/api/attendance', verifyToken, (req, res) => {
    const { package_id, date, attendance_list } = req.body;

    if (!package_id || !date || !attendance_list || attendance_list.length === 0) {
        return res.status(400).json({ message: 'البيانات المرسلة غير مكتملة' });
    }

    db.serialize(() => {
        // حذف التحضير القديم لنفس اليوم ونفس الباقة لتجنب التكرار عند إعادة الحفظ
        db.run(`DELETE FROM attendance WHERE package_id = ? AND date = ?`, [package_id, date]);

        const sql = `INSERT INTO attendance (player_id, package_id, date, status) VALUES (?, ?, ?, ?)`;
        const stmt = db.prepare(sql);

        attendance_list.forEach(item => {
            stmt.run(item.player_id, package_id, date, item.status);
        });

        stmt.finalize((err) => {
            if (err) return res.status(500).json({ message: 'خطأ أثناء حفظ كشف التحضير' });
            res.json({ message: '✅ تم حفظ كشف الحضور والغياب بنجاح!' });
        });
    });
});

app.listen(5000, () => console.log('السيرفر يعمل على بورت 5000'));