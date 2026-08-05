const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_123';
const PORT = process.env.PORT || 5000;

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'football_academy',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
    connectionLimit: 1,
    waitForConnections: true,
    decimalNumbers: true,
    charset: 'utf8mb4'
});

// واجهة مبسطة تحاكي طريقة عمل SQLite لتقليل التعديلات على بقية الكود
const db = {
    all(sql, params, callback) {
        if (typeof params === 'function') { callback = params; params = []; }
        if (!callback) callback = () => {};
        pool.query(sql, params, (err, rows) => {
            if (err) return callback(err);
            callback(null, rows);
        });
    },
    get(sql, params, callback) {
        if (typeof params === 'function') { callback = params; params = []; }
        if (!callback) callback = () => {};
        pool.query(sql, params, (err, rows) => {
            if (err) return callback(err);
            callback(null, rows[0]);
        });
    },
    run(sql, params, callback) {
        if (typeof params === 'function') { callback = params; params = []; }
        if (!callback) callback = () => {};
        pool.query(sql, params, (err, result) => {
            if (err) return callback(err);
            callback.call({ lastID: result.insertId, changes: result.affectedRows }, null);
        });
    },
    serialize(fn) { fn(); },
    prepare(sql) {
        let chain = Promise.resolve();
        return {
            run: (...args) => {
                chain = chain.then(() => new Promise((resolve, reject) => {
                    pool.query(sql, args, (err) => err ? reject(err) : resolve());
                }));
            },
            finalize: (cb) => {
                chain.then(() => cb && cb(null)).catch((err) => cb && cb(err));
            }
        };
    }
};

pool.query('SELECT 1', (err) => {
    if (err) {
        console.error('فشل الاتصال بقاعدة بيانات MySQL:', err.message);
        process.exit(1);
    }
    console.log('تم الاتصال بقاعدة بيانات MySQL بنجاح.');
    initializeDatabase();
});

function ensureColumn(table, column, definition) {
    db.all("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", [table, column], (err, rows) => {
        if (err) { console.error('فحص أعمدة الجدول فشل:', err.message); return; }
        if (!rows || rows.length === 0) {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${definition}`, (alterErr) => {
                if (alterErr) console.error(`إضافة العمود ${column} إلى جدول ${table} فشلت:`, alterErr.message);
            });
        }
    });
}

function initializeDatabase() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTO_INCREMENT, name VARCHAR(191), email VARCHAR(191) UNIQUE, password TEXT, role VARCHAR(50), branch_id INTEGER, permissions TEXT)`, [], (err) => { if (err) console.error(err.message); });
        db.run(`CREATE TABLE IF NOT EXISTS branches (
            id INTEGER PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(191) UNIQUE NOT NULL,
            city VARCHAR(191) NOT NULL,
            address TEXT,
            phone TEXT,
            manager TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`, [], (err) => { if (err) console.error(err.message); });
        db.run(`CREATE TABLE IF NOT EXISTS sports (id INTEGER PRIMARY KEY AUTO_INCREMENT, name VARCHAR(191) UNIQUE NOT NULL)`, [], (err) => { if (err) console.error(err.message); });
        db.run(`CREATE TABLE IF NOT EXISTS packages (
            id INTEGER PRIMARY KEY AUTO_INCREMENT,
            sport_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            days TEXT NOT NULL,
            session_time TEXT NOT NULL,
            max_subscribers INTEGER DEFAULT 0,
            coach_id INTEGER,
            branch_id INTEGER,
            FOREIGN KEY(sport_id) REFERENCES sports(id)
        )`, [], (err) => { if (err) console.error(err.message); });
        db.run(`CREATE TABLE IF NOT EXISTS package_durations (id INTEGER PRIMARY KEY AUTO_INCREMENT, package_id INTEGER NOT NULL, months INTEGER NOT NULL, price REAL NOT NULL, is_active INTEGER DEFAULT 0, FOREIGN KEY(package_id) REFERENCES packages(id))`, [], (err) => { if (err) console.error(err.message); });
        db.run(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTO_INCREMENT, name TEXT NOT NULL, birth_date TEXT NOT NULL, parent_phone TEXT NOT NULL, relative_relation TEXT, relative_phone TEXT, member_number TEXT, height REAL, weight REAL, allergies TEXT, chronic_diseases TEXT, past_injuries TEXT, current_medications TEXT, branch_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, [], (err) => { if (err) console.error(err.message); });
        db.run(`CREATE TABLE IF NOT EXISTS subscriptions (id INTEGER PRIMARY KEY AUTO_INCREMENT, player_id INTEGER NOT NULL, duration_id INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(player_id) REFERENCES players(id), FOREIGN KEY(duration_id) REFERENCES package_durations(id))`, [], (err) => { if (err) console.error(err.message); });
        db.run(`CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTO_INCREMENT, player_id INTEGER NOT NULL, package_id INTEGER NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL, FOREIGN KEY(player_id) REFERENCES players(id), FOREIGN KEY(package_id) REFERENCES packages(id))`, [], (err) => { if (err) console.error(err.message); });
        db.run(`CREATE TABLE IF NOT EXISTS refunds (id INTEGER PRIMARY KEY AUTO_INCREMENT, player_id INTEGER NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL, reason TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(player_id) REFERENCES players(id))`, [], (err) => { if (err) console.error(err.message); });
        db.run(`CREATE TABLE IF NOT EXISTS holidays (id INTEGER PRIMARY KEY AUTO_INCREMENT, title TEXT, start_date TEXT, days_count INTEGER)`, [], (err) => { if (err) console.error(err.message); });
        db.run(`CREATE TABLE IF NOT EXISTS player_evaluations (id INTEGER PRIMARY KEY AUTO_INCREMENT, player_id INTEGER, coach_id INTEGER, month TEXT, passing_score INTEGER, shooting_score INTEGER, running_score INTEGER, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`, [], (err) => { if (err) console.error(err.message); });

        // الحصص مرتبطة بالباقة والمدرب والفرع مباشرة (coach_id قابل للإلغاء)
        db.run(`CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTO_INCREMENT,
            package_id INTEGER NOT NULL,
            coach_id INTEGER,
            branch_id INTEGER,
            FOREIGN KEY(package_id) REFERENCES packages(id) ON DELETE CASCADE,
            FOREIGN KEY(coach_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY(branch_id) REFERENCES branches(id) ON DELETE SET NULL
        )`, [], (err) => { if (err) console.error(err.message); });

        // جدول التحضير للحصص
        db.run(`CREATE TABLE IF NOT EXISTS session_attendance (
            id INTEGER PRIMARY KEY AUTO_INCREMENT,
            session_id INTEGER NOT NULL,
            player_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
        )`, [], (err) => { if (err) console.error(err.message); });

        // التأكد من وجود الأعمدة المضافة في النسخ القديمة
        ensureColumn('players', 'branch_id', 'INTEGER');
        ensureColumn('packages', 'coach_id', 'INTEGER');
        ensureColumn('packages', 'branch_id', 'INTEGER');
        ensureColumn('users', 'branch_id', 'INTEGER');
        ensureColumn('users', 'permissions', 'TEXT');
        ensureColumn('sessions', 'coach_id', 'INTEGER');
        ensureColumn('sessions', 'branch_id', 'INTEGER');

        // إنشاء حساب المدير الافتراضي عند أول تشغيل
        db.get("SELECT COUNT(*) AS count FROM users", [], (err, row) => {
            if (!err && row && row.count === 0) {
                const hashedPassword = bcrypt.hashSync('password', 10);
                db.run("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)", ['المدير العام', 'admin@academy.com', hashedPassword, 'admin']);
                console.log('💡 تم إنشاء حساب المدير الافتراضي بنجاح (admin@academy.com).');
            }
        });

        db.get("SELECT COUNT(*) AS count FROM sports", [], (err, row) => {
            if (!err && row && row.count === 0) {
                db.run("INSERT INTO sports (name) VALUES (?)", ['كرة القدم']);
                db.run("INSERT INTO sports (name) VALUES (?)", ['سباحة']);
                db.run("INSERT INTO sports (name) VALUES (?)", ['تايكوندو']);
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

// تحديد نطاق الفرع: مدير الفرع مقيد بفرعه دائماً، والمدير العام يختار من الطلب
function getBranchScope(req) {
    if (req.user && req.user.role === 'branch_manager') {
        // مدير فرع بدون فرع مخصص → لا يرى أي بيانات (-1 لا يطابق أي فرع)
        return req.user.branch_id || -1;
    }
    const b = req.query.branch_id ? parseInt(req.query.branch_id) : null;
    return Number.isInteger(b) ? b : null;
}

// إذا لم يُحدد الفرع فيُعتبر الفرع الأول (الأصغر رقمياً)
function resolveBranchId(branchId, callback) {
    if (branchId) return callback(null, parseInt(branchId));
    db.get("SELECT id FROM branches ORDER BY id ASC LIMIT 1", [], (err, row) => {
        if (err) return callback(err);
        callback(null, row ? row.id : null);
    });
}

app.get('/api/dashboard/data', verifyToken, (req, res) => {
    res.json({ name: req.user.name, role: req.user.role, secretData: req.user.role === 'admin' ? "🔒 أرباحك 5000$" : "📋 لديك حصتين اليوم" });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ message: 'بيانات الدخول خاطئة' });
        const permissions = (user.permissions || '').split(',').filter(Boolean);
        const token = jwt.sign({ id: user.id, role: user.role, name: user.name, branch_id: user.branch_id, permissions }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, name: user.name, role: user.role, branch_id: user.branch_id, permissions } });
    });
});

// تسجيل لاعب جديد وتوليد معرف فريد تلقائياً
app.post('/api/players', verifyToken, (req, res) => {
    const { 
        name, birth_date, parent_phone, relative_relation, relative_phone, 
        height, weight, allergies, chronic_diseases, past_injuries, current_medications, branch_id 
    } = req.body;

    if (!name || !birth_date || !parent_phone) {
        return res.status(400).json({ message: 'الرجاء ملء جميع الحقول الإلزامية.' });
    }

    const generateUniqueMemberNumber = (callback) => {
        const year = new Date().getFullYear();
        const randomDigits = Math.floor(1000 + Math.random() * 9000);
        const generatedID = `MEM-${year}-${randomDigits}`;

        db.get("SELECT id FROM players WHERE member_number = ?", [generatedID], (err, row) => {
            if (row) generateUniqueMemberNumber(callback);
            else callback(generatedID);
        });
    };

    generateUniqueMemberNumber((finalMemberNumber) => {
        const branchId = (req.user.role === 'branch_manager') ? (req.user.branch_id || null) : (req.body.branch_id || null);
        const sql = `
            INSERT INTO players (
                name, birth_date, parent_phone, relative_relation, relative_phone, 
                member_number, height, weight, allergies, chronic_diseases, 
                past_injuries, current_medications, branch_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
            name, birth_date, parent_phone, relative_relation, relative_phone, 
            finalMemberNumber, height, weight, allergies, chronic_diseases, 
            past_injuries, current_medications, branchId
        ];

        db.run(sql, params, function(err) {
            if (err) return res.status(500).json({ message: 'فشل تسجيل اللاعب في قاعدة البيانات.' });
            res.status(201).json({ message: `تم تسجيل اللاعب بنجاح!`, member_number: finalMemberNumber, playerId: this.lastID });
        });
    });
});

app.get('/api/players', verifyToken, (req, res) => {
    const branchId = getBranchScope(req);
    if (branchId) {
        db.all("SELECT id, name, member_number FROM players WHERE branch_id = ? ORDER BY id DESC", [branchId], (err, rows) => { res.json(rows); });
    } else {
        db.all("SELECT id, name, member_number FROM players ORDER BY id DESC", [], (err, rows) => { res.json(rows); });
    }
});

// آخر المشتركين المسجلين (حسب الفرع المحدد إن وُجد) للوحة التحكم
app.get('/api/players/recent', verifyToken, (req, res) => {
    const branchId = getBranchScope(req);
    let limit = parseInt(req.query.limit) || 10;
    if (limit < 1) limit = 10;
    if (limit > 50) limit = 50;
    if (branchId) {
        db.all("SELECT id, name, member_number, created_at FROM players WHERE branch_id = ? ORDER BY id DESC LIMIT " + limit, [branchId], (err, rows) => { if (err) return res.status(500).json({ error: err.message }); res.json(rows || []); });
    } else {
        db.all("SELECT id, name, member_number, created_at FROM players ORDER BY id DESC LIMIT " + limit, [], (err, rows) => { if (err) return res.status(500).json({ error: err.message }); res.json(rows || []); });
    }
});

app.get('/api/players/:id/profile', (req, res) => {
    const playerId = req.params.id;
    db.get("SELECT * FROM players WHERE id = ?", [playerId], (err, player) => {
        if (err) return res.status(500).json({ message: 'خطأ في خادم قاعدة البيانات.' });
        if (!player) return res.status(404).json({ message: 'اللاعب غير موجود.' });

        const subscriptionsSql = "SELECT s.*, pd.months, pd.price, p.name AS package_name FROM subscriptions s JOIN package_durations pd ON s.duration_id = pd.id JOIN packages p ON pd.package_id = p.id WHERE s.player_id = ? ORDER BY s.start_date DESC";
        db.all(subscriptionsSql, [playerId], (errSubs, subs) => {
            const attendanceSql = `
                SELECT COUNT(*) as total_sessions, SUM(CASE WHEN status = 'حاضر' THEN 1 ELSE 0 END) as attended_sessions
                FROM attendance WHERE player_id = ?
            `;

            db.get(attendanceSql, [playerId], (errAtt, att) => {
                let attendanceRate = 100;
                if (att && att.total_sessions > 0) {
                    attendanceRate = Math.round((att.attended_sessions / att.total_sessions) * 100);
                } else {
                    attendanceRate = 85; 
                }

                res.json({
                    player,
                    attendance: { rate: attendanceRate, total: att ? att.total_sessions : 12, attended: att ? att.attended_sessions : 10 },
                    subscriptions: subs && subs.length > 0 ? subs : [
                        { id: 1, package_name: 'الباقة الربع سنوية - كرة قدم', start_date: '2026-05-01', end_date: '2026-08-01', status: 'نشط' }
                    ]
                });
            });
        });
    });
});

// تعديل بيانات اللاعب
app.put('/api/players/:id', verifyToken, (req, res) => {
    const playerId = req.params.id;
    const { name, birth_date, parent_phone, relative_relation, relative_phone, height, weight, allergies, chronic_diseases, past_injuries, current_medications } = req.body;

    const sql = `UPDATE players SET 
        name = COALESCE(?, name),
        birth_date = COALESCE(?, birth_date),
        parent_phone = COALESCE(?, parent_phone),
        relative_relation = COALESCE(?, relative_relation),
        relative_phone = COALESCE(?, relative_phone),
        height = COALESCE(?, height),
        weight = COALESCE(?, weight),
        allergies = COALESCE(?, allergies),
        chronic_diseases = COALESCE(?, chronic_diseases),
        past_injuries = COALESCE(?, past_injuries),
        current_medications = COALESCE(?, current_medications)
        WHERE id = ?`;

    db.run(sql, [name, birth_date, parent_phone, relative_relation, relative_phone, height, weight, allergies, chronic_diseases, past_injuries, current_medications, playerId], function(err) {
        if (err) return res.status(500).json({ message: 'خطأ أثناء تعديل بيانات اللاعب.' });
        if (this.changes === 0) return res.status(404).json({ message: 'اللاعب غير موجود.' });
        res.json({ message: '✅ تم تعديل بيانات اللاعب بنجاح!' });
    });
});

app.get('/api/sports', verifyToken, (req, res) => {
    db.all("SELECT * FROM sports", [], (err, rows) => { res.json(rows); });
});

app.post('/api/packages', verifyToken, (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'branch_manager') return res.status(403).json({ message: 'عذراً، هذه الصلاحية خاصة بالمدير العام أو مدير الفرع فقط!' });
    const { sport_name, name, days, session_time, durations, max_subscribers, coach_id } = req.body;
    const branchId = (req.user.role === 'branch_manager') ? (req.user.branch_id || null) : (req.body.branch_id || null);

    if (!sport_name || !name || !days || !session_time) {
        return res.status(400).json({ message: 'الرجاء التأكد من إدخال كافة البيانات الأساسية' });
    }

    db.get("SELECT id FROM sports WHERE name = ?", [sport_name.trim()], (err, row) => {
        if (err) return res.status(500).json({ message: 'خطأ في فحص الرياضة' });

        const insertPackageAndDurations = (sportId) => {
            const packageSql = `INSERT INTO packages (sport_id, name, days, session_time, max_subscribers, coach_id, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            db.run(packageSql, [sportId, name, days, session_time, max_subscribers || 0, coach_id || null, branchId], function(err) {
                if (err) return res.status(500).json({ message: 'حدث خطأ أثناء حفظ الباقة الأساسية' });

                const packageId = this.lastID;
                const durationSql = `INSERT INTO package_durations (package_id, months, price, is_active) VALUES (?, ?, ?, ?)`;
                const stmt = db.prepare(durationSql);

                durations.forEach(d => {
                    stmt.run(packageId, d.months, d.price || 0, d.is_active ? 1 : 0);
                });

                stmt.finalize((finalizeErr) => {
                    if (finalizeErr) return res.status(500).json({ message: 'خطأ في حفظ أسعار الفترات' });
                    // إنشاء الحصة تلقائياً إذا كانت الباقة مفعلة، ليرى المدرب المسؤول جدوله فوراً
                    const hasActive = (durations || []).some(d => d.is_active);
                    if (hasActive) {
                        db.run("INSERT INTO sessions (package_id, coach_id, branch_id) VALUES (?, ?, ?)",
                            [packageId, coach_id || null, branchId],
                            (sErr) => {
                                if (sErr) console.error('خطأ في إنشاء الحصة تلقائياً:', sErr.message);
                            }
                        );
                        return res.json({ message: '✅ تم إنشاء الباقة وحصتها التدريبية وجدولتها تلقائياً للمدرب المسؤول!' });
                    }
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
    const branchId = getBranchScope(req);
    const branchFilter = branchId ? ' AND p.branch_id = ?' : '';
    const branchParam = branchId ? [branchId] : [];
    const sql = `
        SELECT 
            pd.id AS duration_id, 
            s.name AS sport_name, 
            p.name AS package_name, 
            pd.months, 
            pd.price,
            p.max_subscribers,
            (SELECT COUNT(*) FROM subscriptions sub 
             JOIN package_durations pd2 ON sub.duration_id = pd2.id 
             WHERE pd2.package_id = p.id) AS current_subscribers
        FROM package_durations pd
        JOIN packages p ON pd.package_id = p.id
        JOIN sports s ON p.sport_id = s.id
        WHERE pd.is_active = 1
        ${branchFilter}
        ORDER BY s.name, p.name, pd.months
    `;
    db.all(sql, branchParam, (err, rows) => {
        if (err) return res.status(500).json({ message: 'خطأ في جلب الباقات' });
        res.json(rows);
    });
});

app.post('/api/subscriptions', verifyToken, (req, res) => {
    const { player_id, duration_id, start_date, end_date, age_bypass } = req.body;

    // إذا كان المستخدم مدرباً فلا يمكنه تخطي قيود العمر
    if (age_bypass && req.user.role === 'coach') {
        return res.status(403).json({ message: 'المدربون ليس لديهم صلاحية فك القيود العمرية. يرجى التواصل مع المدير.' });
    }

    const checkSql = `
        SELECT p.max_subscribers,
               (SELECT COUNT(*) FROM subscriptions sub 
                JOIN package_durations pd2 ON sub.duration_id = pd2.id 
                WHERE pd2.package_id = p.id) AS current_subscribers
        FROM package_durations pd
        JOIN packages p ON pd.package_id = p.id
        WHERE pd.id = ?
    `;

    db.get(checkSql, [duration_id], (err, row) => {
        if (err) return res.status(500).json({ message: 'خطأ في فحص سعة الباقة' });
        
        if (row && row.max_subscribers > 0 && row.current_subscribers >= row.max_subscribers) {
            return res.status(400).json({ message: `عذراً، لا يمكن إضافة المشترك. تم الوصول للحد الأقصى المسموح به لهذه الباقة وهو (${row.max_subscribers}) مشتركين.` });
        }

        db.run(`INSERT INTO subscriptions (player_id, duration_id, start_date, end_date) VALUES (?, ?, ?, ?)`, [player_id, duration_id, start_date, end_date], function(err) {
            if (err) return res.status(500).json({ message: 'خطأ أثناء حفظ الاشتراك' });
            res.json({ message: '✅ تم تفعيل اشتراك اللاعب بنجاح حسب المدة المحددة الباقة!' });
        });
    });
});

// تعديل تاريخ انتهاء اشتراك
app.put('/api/subscriptions/:id', verifyToken, (req, res) => {
    const subId = req.params.id;
    const { end_date } = req.body;
    if (!end_date) return res.status(400).json({ message: 'تاريخ الانتهاء مطلوب' });

    db.run("UPDATE subscriptions SET end_date = ? WHERE id = ?", [end_date, subId], function(err) {
        if (err) return res.status(500).json({ message: 'خطأ أثناء تعديل الاشتراك' });
        if (this.changes === 0) return res.status(404).json({ message: 'الاشتراك غير موجود' });
        res.json({ message: '✅ تم تعديل تاريخ انتهاء الاشتراك بنجاح!' });
    });
});

// جلب قائمة الباقات المتاحة مع تفاصيل الأيام والوقت للتوليد التلقائي للحصص
app.get('/api/packages-list', verifyToken, (req, res) => {
    const branchId = getBranchScope(req);
    const branchFilter = branchId ? ' WHERE p.branch_id = ?' : '';
    const branchParam = branchId ? [branchId] : [];
    const sql = `
        SELECT p.id, p.name AS package_name, s.name AS sport_name, p.days, p.session_time, p.max_subscribers, p.coach_id, p.branch_id, u.name AS coach_name
        FROM packages p
        JOIN sports s ON p.sport_id = s.id
        LEFT JOIN users u ON p.coach_id = u.id
        ${branchFilter}
    `;
    db.all(sql, branchParam, (err, rows) => {
        if (err) return res.status(500).json({ message: 'خطأ في جلب قائمة الباقات' });
        res.json(rows);
    });
});

// جلب تفاصيل باقة معينة للتعديل
app.get('/api/packages/:id', verifyToken, (req, res) => {
    const packageId = req.params.id;
    const sql = `
        SELECT p.*, s.name AS sport_name
        FROM packages p
        JOIN sports s ON p.sport_id = s.id
        WHERE p.id = ?
    `;
    db.get(sql, [packageId], (err, pkg) => {
        if (err) return res.status(500).json({ message: 'خطأ في جلب بيانات الباقة' });
        if (!pkg) return res.status(404).json({ message: 'الباقة غير موجودة' });

        db.all("SELECT * FROM package_durations WHERE package_id = ?", [packageId], (err, durations) => {
            res.json({ ...pkg, durations: durations || [] });
        });
    });
});

// تعديل باقة موجودة
app.put('/api/packages/:id', verifyToken, (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'branch_manager') return res.status(403).json({ message: 'عذراً، هذه الصلاحية خاصة بالمدير العام أو مدير الفرع فقط!' });
    const packageId = req.params.id;
    const { sport_name, name, days, session_time, max_subscribers, durations, coach_id } = req.body;
    const branchId = (req.user.role === 'branch_manager') ? (req.user.branch_id || null) : (req.body.branch_id || null);

    db.get("SELECT id FROM sports WHERE name = ?", [sport_name.trim()], (err, sportRow) => {
        if (err) return res.status(500).json({ message: 'خطأ في فحص الرياضة' });

        const updatePackage = (sportId) => {
            const sql = `UPDATE packages SET sport_id = ?, name = ?, days = ?, session_time = ?, max_subscribers = ?, coach_id = ?, branch_id = ? WHERE id = ?`;
            db.run(sql, [sportId, name, days, session_time, max_subscribers || 0, coach_id || null, branchId, packageId], function(err) {
                if (err) return res.status(500).json({ message: 'خطأ أثناء تعديل الباقة' });

                if (durations && durations.length > 0) {
                    db.run("DELETE FROM package_durations WHERE package_id = ?", [packageId]);
                    const stmt = db.prepare("INSERT INTO package_durations (package_id, months, price, is_active) VALUES (?, ?, ?, ?)");
                    durations.forEach(d => {
                        stmt.run(packageId, d.months, d.price || 0, d.is_active ? 1 : 0);
                    });
                    stmt.finalize();
                }

                res.json({ message: '✅ تم تعديل الباقة بنجاح!' });
            });
        };

        if (sportRow) {
            updatePackage(sportRow.id);
        } else {
            db.run("INSERT INTO sports (name) VALUES (?)", [sport_name.trim()], function(err) {
                if (err) return res.status(500).json({ message: 'خطأ في إنشاء الرياضة' });
                updatePackage(this.lastID);
            });
        }
    });
});

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

app.post('/api/attendance', verifyToken, (req, res) => {
    const { package_id, date, attendance_list } = req.body;

    if (!package_id || !date || !attendance_list || attendance_list.length === 0) {
        return res.status(400).json({ message: 'البيانات المرسلة غير مكتملة' });
    }

    db.serialize(() => {
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

// الفروع المتعددة (Branches)
app.get('/api/branches/comparison', verifyToken, (req, res) => {
    const sql = `
        SELECT 
            b.id, b.name, b.city, b.manager, b.phone, b.address,
            COUNT(DISTINCT p.id) as total_players,
            COUNT(DISTINCT sub.id) as total_subscriptions,
            COALESCE(SUM(pd.price), 0) as total_revenue
        FROM branches b
        LEFT JOIN players p ON p.branch_id = b.id
        LEFT JOIN subscriptions sub ON sub.player_id = p.id
        LEFT JOIN package_durations pd ON sub.duration_id = pd.id
        GROUP BY b.id
        ORDER BY total_revenue DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ message: 'خطأ في جلب بيانات المقارنة للفروع' });
        res.json(rows);
    });
});

app.get('/api/branches/:id/players', verifyToken, (req, res) => {
    const branchId = req.params.id;
    db.all("SELECT id, name, member_number, parent_phone FROM players WHERE branch_id = ? ORDER BY name ASC", [branchId], (err, rows) => {
        if (err) return res.status(500).json({ message: 'خطأ في جلب لاعبي الفرع' });
        res.json(rows);
    });
});

// ملخص بيانات فرع محدد للوحة التحكم
app.get('/api/branches/:id/summary', verifyToken, (req, res) => {
    const branchId = req.params.id;
    if (req.user.role === 'branch_manager' && parseInt(branchId) !== req.user.branch_id) {
        return res.status(403).json({ message: 'غير مصرح بالوصول لبيانات هذا الفرع' });
    }
    const sql = `
        SELECT 
            (SELECT COUNT(*) FROM players WHERE branch_id = ?) AS total_players,
            (SELECT COUNT(DISTINCT sub.id) FROM subscriptions sub
             JOIN players p ON sub.player_id = p.id
             WHERE p.branch_id = ? AND sub.end_date >= CURDATE()) AS total_subscriptions,
            (SELECT COALESCE(SUM(pd.price), 0) FROM subscriptions sub
             JOIN package_durations pd ON sub.duration_id = pd.id
             JOIN players p ON sub.player_id = p.id
             WHERE p.branch_id = ?) AS total_revenue
    `;
    db.get(sql, [branchId, branchId, branchId], (err, row) => {
        if (err) return res.status(500).json({ message: 'خطأ في جلب ملخص الفرع' });
        res.json(row || { total_players: 0, total_subscriptions: 0, total_revenue: 0 });
    });
});

app.post('/api/players/assign-branch', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'صلاحية خاصة بالمدير فقط!' });
    const { player_id, branch_id } = req.body;

    if (!player_id || !branch_id) return res.status(400).json({ message: 'البيانات المرسلة غير مكتملة' });

    db.run("UPDATE players SET branch_id = ? WHERE id = ?", [branch_id, player_id], function(err) {
        if (err) return res.status(500).json({ message: 'خطأ أثناء تعيين اللاعب للفرع' });
        res.json({ message: '✅ تم تعيين/نقل اللاعب للفرع بنجاح!' });
    });
});

app.post('/api/branches', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'عذراً، هذه الصلاحية خاصة بالمدير العام فقط!' });
    const { name, city, address, phone, manager } = req.body;

    if (!name || !city) return res.status(400).json({ message: 'اسم الفرع والمدينة مطلوبان.' });

    db.run(
        `INSERT INTO branches (name, city, address, phone, manager) VALUES (?, ?, ?, ?, ?)`,
        [name, city, address, phone, manager],
        function(err) {
            if (err) return res.status(500).json({ message: 'خطأ أثناء إضافة الفرع، قد يكون الاسم مكرراً.' });
            res.json({ message: '✅ تم إضافة الفرع الجديد بنجاح!' });
        }
    );
});

app.get('/api/branches', verifyToken, (req, res) => {
    if (req.user.role === 'branch_manager') {
        db.all("SELECT * FROM branches WHERE id = ? ORDER BY id DESC", [req.user.branch_id], (err, rows) => {
            if (err) return res.status(500).json({ message: 'خطأ في جلب الفروع' });
            res.json(rows);
        });
        return;
    }
    db.all("SELECT * FROM branches ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ message: 'خطأ في جلب الفروع' });
        res.json(rows);
    });
});

// الحسابات والمستردات والتقارير المالية
app.post('/api/refunds', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'عذراً، هذه الصلاحية خاصة بالمدير العام فقط!' });
    const { player_id, amount, date, reason } = req.body;

    if (!player_id || !amount || !date) return res.status(400).json({ message: 'الرجاء تعبئة الحقول الأساسية للمسترد' });

    db.run(
        `INSERT INTO refunds (player_id, amount, date, reason) VALUES (?, ?, ?, ?)`,
        [player_id, amount, date, reason],
        function(err) {
            if (err) return res.status(500).json({ message: 'حدث خطأ أثناء حفظ المبلغ المسترد' });
            res.json({ message: '✅ تم تسجيل المبلغ المسترد بنجاح وخصمه من تقرير الدخل!' });
        }
    );
});

app.get('/api/reports/summary', verifyToken, (req, res) => {
    const branchId = getBranchScope(req);
    const reportData = { totalIncome: 0, totalRefunds: 0, netIncome: 0, playersPerSport: [], totalPlayers: 0, recentRefundsList: [] };

    const branchCond = branchId ? ' AND p.branch_id = ?' : '';
    const branchParam = branchId ? [branchId] : [];

    const incomeSql = `
        SELECT SUM(pd.price) as total_income 
        FROM subscriptions sub 
        JOIN package_durations pd ON sub.duration_id = pd.id 
        JOIN players p ON sub.player_id = p.id
        WHERE DATE_FORMAT(sub.created_at, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m') ${branchCond}
    `;
    db.get(incomeSql, branchParam, (err, incomeRow) => {
        reportData.totalIncome = (incomeRow && incomeRow.total_income) ? incomeRow.total_income : 0;

        const refundSql = `
            SELECT SUM(r.amount) as total_refunds 
            FROM refunds r
            JOIN players p ON r.player_id = p.id
            WHERE DATE_FORMAT(r.date, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m') ${branchCond}
        `;
        db.get(refundSql, branchParam, (err, refundRow) => {
            reportData.totalRefunds = (refundRow && refundRow.total_refunds) ? refundRow.total_refunds : 0;
            reportData.netIncome = reportData.totalIncome - reportData.totalRefunds;

            const sportSql = `
                SELECT s.name as sport_name, COUNT(DISTINCT sub.player_id) as player_count
                FROM sports s
                LEFT JOIN packages p ON s.id = p.sport_id
                LEFT JOIN package_durations pd ON p.id = pd.package_id
                LEFT JOIN subscriptions sub ON pd.id = sub.duration_id
                LEFT JOIN players pl ON sub.player_id = pl.id
                ${branchId ? 'WHERE pl.branch_id = ?' : ''}
                GROUP BY s.id
            `;
            db.all(sportSql, branchParam, (err, sportRows) => {
                reportData.playersPerSport = sportRows || [];

                const totalPlayersSql = branchId ? "SELECT COUNT(*) as total FROM players WHERE branch_id = ?" : "SELECT COUNT(*) as total FROM players";
                db.get(totalPlayersSql, branchParam, (err, playerRow) => {
                    reportData.totalPlayers = (playerRow && playerRow.total) ? playerRow.total : 0;

                    const recentRefundsSql = `
                        SELECT r.id, r.amount, r.date, r.reason, p.name as player_name 
                        FROM refunds r
                        JOIN players p ON r.player_id = p.id
                        ${branchId ? 'WHERE p.branch_id = ?' : ''}
                        ORDER BY r.id DESC LIMIT 10
                    `;
                    db.all(recentRefundsSql, branchParam, (err, refundRows) => {
                        reportData.recentRefundsList = refundRows || [];
                        res.json(reportData);
                    });
                });
            });
        });
    });
});

// ==========================================
// ⚽ روابط وجداول الحصص والتمارين الأسبوعية (المؤتمتة والمحدثة)
// ==========================================

// 1. جلب الكباتن والمدربين فقط (مرتبط بالفرع المحدد إن وُجد)
app.get('/api/coaches', verifyToken, (req, res) => {
    const branchId = getBranchScope(req);
    const branchFilter = branchId ? ' AND branch_id = ?' : '';
    const branchParam = branchId ? [branchId] : [];
    db.all(`SELECT id, name, email, branch_id FROM users WHERE role IN ('coach', 'مدرب') ${branchFilter}`, branchParam, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 2. جلب جميع المستخدمين (إدارة الموظفين والصلاحيات - مدير النظام فقط)
app.get('/api/users', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'صلاحية خاصة بالمدير العام فقط!' });
    db.all("SELECT id, name, email, role, branch_id, permissions FROM users ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 3. تعديل مستخدم (الاسم/الدور/الصلاحيات/الفرع/كلمة المرور) - مدير النظام فقط
app.put('/api/users/:id', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'صلاحية خاصة بالمدير العام فقط!' });
    const userId = req.params.id;
    const { name, email, password, role, branch_id, permissions } = req.body;

    const fields = [];
    const params = [];

    if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()); }
    if (email !== undefined) { fields.push('email = ?'); params.push(String(email).trim().toLowerCase()); }
    if (role !== undefined) {
        const validRoles = ['admin', 'branch_manager', 'coach', 'employee'];
        if (!validRoles.includes(role)) return res.status(400).json({ message: 'دور غير صالح.' });
        fields.push('role = ?'); params.push(role);
    }
    if (permissions !== undefined) {
        const perms = Array.isArray(permissions) ? permissions : String(permissions || '').split(',');
        fields.push('permissions = ?'); params.push(perms.map(p => p.trim()).filter(Boolean).join(','));
    }
    if (password) { fields.push('password = ?'); params.push(bcrypt.hashSync(password, 10)); }

    const runUpdate = () => {
        if (fields.length === 0) return res.status(400).json({ message: 'لا توجد بيانات للتعديل.' });
        params.push(userId);
        db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params, function(err) {
            if (err) return res.status(500).json({ message: 'خطأ أثناء تعديل المستخدم، قد يكون البريد مستخدماً مسبقاً.' });
            if (this.changes === 0) return res.status(404).json({ message: 'المستخدم غير موجود.' });
            res.json({ message: '✅ تم تعديل المستخدم والصلاحيات بنجاح!' });
        });
    };

    if (branch_id !== undefined) {
        resolveBranchId(branch_id, (err, finalBranch) => {
            if (err) return res.status(500).json({ message: 'خطأ أثناء التحقق من الفرع' });
            fields.push('branch_id = ?');
            params.push(finalBranch);
            runUpdate();
        });
    } else {
        runUpdate();
    }
});

// 4. حذف مستخدم - مدير النظام فقط
app.delete('/api/users/:id', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'صلاحية خاصة بالمدير العام فقط!' });
    const userId = req.params.id;
    if (parseInt(userId) === req.user.id) return res.status(400).json({ message: 'لا يمكنك حذف حسابك الحالي!' });

    db.run("DELETE FROM users WHERE id = ?", [userId], function(err) {
        if (err) return res.status(500).json({ message: 'خطأ أثناء حذف المستخدم.' });
        if (this.changes === 0) return res.status(404).json({ message: 'المستخدم غير موجود.' });
        res.json({ message: '✅ تم حذف المستخدم بنجاح!' });
    });
});

// إضافة حساب موظف/مدرب/مدير فرع جديد (مدير النظام فقط)
app.post('/api/users', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'صلاحية خاصة بالمدير العام فقط!' });
    const { name, email, password, role, branch_id, permissions } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'الرجاء إدخال الاسم والبريد الإلكتروني وكلمة المرور.' });
    }

    const validRoles = ['admin', 'branch_manager', 'coach', 'employee'];
    const userRole = validRoles.includes(role) ? role : 'employee';
    const perms = Array.isArray(permissions) ? permissions.map(p => p.trim()).filter(Boolean).join(',') : '';
    const hashedPassword = bcrypt.hashSync(password, 10);

    resolveBranchId(branch_id, (err, finalBranch) => {
        if (err) return res.status(500).json({ message: 'خطأ أثناء التحقق من الفرع' });

        db.run(
            "INSERT INTO users (name, email, password, role, branch_id, permissions) VALUES (?, ?, ?, ?, ?, ?)",
            [name.trim(), email.trim().toLowerCase(), hashedPassword, userRole, finalBranch, perms],
            function(err2) {
                if (err2) return res.status(500).json({ message: 'خطأ في إنشاء الحساب، قد يكون البريد الإلكتروني مستخدماً مسبقاً.' });
                res.json({ message: '✅ تم إنشاء الحساب بنجاح!', id: this.lastID });
            }
        );
    });
});

// 2. إنشاء حصة تدريبية جديدة (المدرب يُؤخذ تلقائياً من الباقة)
app.post('/api/sessions', verifyToken, (req, res) => {
    const { package_id, branch_id } = req.body;
    if (!package_id) {
        return res.status(400).json({ message: "يرجى تحديد الباقة." });
    }
    // منع التكرار: الباقة لا تُضاف حصتها أكثر من مرة
        db.get("SELECT id FROM sessions WHERE package_id = ?", [package_id], (err, existing) => {
            if (err) return res.status(500).json({ error: err.message });
            if (existing) {
                return res.json({ message: 'هذه الحصة مفعلة مسبقاً في الجدول الأسبوعي.', sessionId: existing.id });
            }
        db.get("SELECT coach_id, branch_id AS pkg_branch FROM packages WHERE id = ?", [package_id], (err, pkg) => {
            if (err) return res.status(500).json({ error: err.message });
            const coach_id = (pkg && pkg.coach_id) || null;
            const finalBranch = (req.user.role === 'branch_manager') ? (req.user.branch_id || null)
                                : (branch_id || (pkg && pkg.pkg_branch) || null);
            db.run(
                "INSERT INTO sessions (package_id, coach_id, branch_id) VALUES (?, ?, ?)",
                [package_id, coach_id, finalBranch],
                function(err2) {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.json({ message: "تم تسجيل الحصة التدريبية بنجاح! ⚽", sessionId: this.lastID });
                }
            );
        });
    });
});

// 3. جلب جدول الحصص الأسبوعية المؤتمت مع دمج بيانات الباقة وتفكيك الوقت بدقة
app.get('/api/sessions', verifyToken, (req, res) => {
    const branchId = getBranchScope(req);
    const where = [];
    const params = [];
    if (branchId) { where.push('s.branch_id = ?'); params.push(branchId); }
    // المدرب يرى حصصه المسؤول عنها فقط
    if (req.user.role === 'coach' || req.user.role === 'مدرب') {
        where.push('s.coach_id = ?');
        params.push(req.user.id);
    }
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const sql = `
        SELECT 
            s.id AS id,
            s.package_id,
            s.coach_id,
            s.branch_id,
            p.name AS package_name,
            p.days AS day_of_week,
            p.session_time,
            sp.name AS sport_name,
            u.name AS coach_name,
            (
                SELECT COUNT(DISTINCT sub.player_id)
                FROM subscriptions sub
                JOIN package_durations pd ON sub.duration_id = pd.id
                WHERE pd.package_id = s.package_id
            ) AS active_subscribers_count,
            p.max_subscribers
        FROM sessions s
        JOIN packages p ON s.package_id = p.id
        JOIN sports sp ON p.sport_id = sp.id
        LEFT JOIN users u ON s.coach_id = u.id
        ${whereSql}
    `;
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // تفكيك تيار الوقت (مثل "17:00 - 18:30") لتأمين التوافق مع قوالب العرض القديمة والجديدة
        const formatted = rows.map(row => {
            const times = row.session_time ? row.session_time.split(/[-–]+/) : [];
            return {
                id: row.id,
                package_id: row.package_id,
                coach_id: row.coach_id,
                branch_id: row.branch_id,
                title: `${row.sport_name} - ${row.package_name}`,
                coach_name: row.coach_name || 'غير محدد',
                day_of_week: row.day_of_week,
                start_time: times[0] ? times[0].trim() : row.session_time,
                end_time: times[1] ? times[1].trim() : '',
                active_subscribers_count: row.active_subscribers_count,
                max_subscribers: row.max_subscribers
            };
        });
        res.json(formatted);
    });
});

// 4. جلب اللاعبين المشتركين بالباقة تلقائياً (كشف تحضير ديناميكي)
// التأكد أن المدرب يصل لحصته المسؤول عنها فقط
function ensureCoachSessionAccess(req, res, next) {
    if (req.user.role !== 'coach' && req.user.role !== 'مدرب') return next();
    db.get("SELECT coach_id FROM sessions WHERE id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ message: 'الحصة غير موجودة' });
        if (row.coach_id !== req.user.id) return res.status(403).json({ message: 'غير مصرح لك بالوصول لهذه الحصة' });
        next();
    });
}

app.get('/api/sessions/:id/players', verifyToken, ensureCoachSessionAccess, (req, res) => {
    const sessionId = req.params.id;
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const sql = `
        SELECT DISTINCT pl.id, pl.name, pl.member_number
        FROM players pl
        JOIN subscriptions sub ON pl.id = sub.player_id
        JOIN package_durations pd ON sub.duration_id = pd.id
        JOIN sessions s ON pd.package_id = s.package_id
        WHERE s.id = ?
          AND sub.start_date <= ? AND sub.end_date >= ?
          AND NOT EXISTS (
              SELECT 1 FROM session_attendance sa
              WHERE sa.session_id = s.id AND sa.player_id = pl.id AND sa.date = ?
          )
    `;
    db.all(sql, [sessionId, date, date, date], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// 5. جلب حضور حصة معينة في تاريخ محدد
app.get('/api/sessions/:id/attendance', verifyToken, ensureCoachSessionAccess, (req, res) => {
    const sessionId = req.params.id;
    const { date } = req.query; 
    const sql = `
        SELECT sa.player_id, sa.status, pl.name, pl.member_number
        FROM session_attendance sa
        JOIN players pl ON sa.player_id = pl.id
        WHERE sa.session_id = ? AND sa.date = ?
        ORDER BY sa.id ASC
    `;
    db.all(sql, [sessionId, date], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// 6. حفظ كشف التحضير الجماعي للحصة في تاريخ معين
app.post('/api/sessions/:id/attendance', verifyToken, ensureCoachSessionAccess, (req, res) => {
    const sessionId = req.params.id;
    const { date, records } = req.body; 

    if (!date || !records) return res.status(400).json({ message: "بيانات التحضير غير مكتملة." });

    db.serialize(() => {
        db.run("DELETE FROM session_attendance WHERE session_id = ? AND date = ?", [sessionId, date]);

        const stmt = db.prepare("INSERT INTO session_attendance (session_id, player_id, date, status) VALUES (?, ?, ?, ?)");
        records.forEach(rec => {
            stmt.run(sessionId, rec.player_id, date, rec.status);
        });
        stmt.finalize((err) => {
            if (err) return res.status(500).json({ message: "فشل حفظ كشف التحضير." });
            res.json({ message: "تم تسجيل الحضور والغياب للحصة بنجاح! ⚽" });
        });
    });
});

// 📌 1. البحث الفوري والشامل عن المشتركين بالاسم أو رقم العضوية
app.get('/api/players/search', verifyToken, (req, res) => {
  const { q } = req.query;
  const branchId = getBranchScope(req);
  if (branchId) {
    let sql = 'SELECT * FROM players WHERE (name LIKE ? OR member_number LIKE ?) AND branch_id = ?';
    db.all(sql, [`%${q}%`, `%${q}%`, branchId], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  } else {
    let sql = 'SELECT * FROM players WHERE name LIKE ? OR member_number LIKE ?';
    db.all(sql, [`%${q}%`, `%${q}%`], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  }
});

// 📌 6. تسجيل العطلات الرسمية وتمديد الاشتراكات النشطة تلقائياً
app.get('/api/holidays', verifyToken, (req, res) => {
    db.all("SELECT * FROM holidays ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/holidays', verifyToken, (req, res) => {
  const { title, start_date, days_count } = req.body;

  if (!title || !start_date || !days_count) {
    return res.status(400).json({ message: 'الرجاء ملء جميع الحقول المطلوبة' });
  }
  
  db.run(`INSERT INTO holidays (title, start_date, days_count) VALUES (?, ?, ?)`, [title, start_date, days_count], function(err) {
    if (err) return res.status(500).json({ error: err.message });

    // تمديد نهاية اشتراك كل اللاعبين الذين تاريخ انتهائهم لم ينتهِ بعد
    const extendSql = `UPDATE subscriptions SET end_date = DATE_ADD(end_date, INTERVAL ? DAY) WHERE end_date >= CURDATE()`;
    db.run(extendSql, [days_count], function(err2) {
      if (err2) {
        console.error('خطأ أثناء التمديد التلقائي:', err2);
        return res.status(500).json({ message: 'خطأ أثناء تمديد الاشتراكات' });
      }
      res.json({ message: `تم حفظ إجازة "${title}" (${days_count} يوم) وتمديد ${this.changes} اشتراك نشط تلقائياً بنجاح!` });
    });
  });
});

// 📌 7. حفظ تقييم الأداء الشهري قبل إرساله عبر WhatsApp
app.post('/api/evaluations', verifyToken, (req, res) => {
  const { player_id, month, passing_score, shooting_score, running_score, notes } = req.body;
  const sql = `INSERT INTO player_evaluations (player_id, coach_id, month, passing_score, shooting_score, running_score, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  
  db.run(sql, [player_id, req.user.id, month, passing_score, shooting_score, running_score, notes], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'تم حفظ تقييم اللاعب بنجاح' });
  });
});

app.listen(PORT, () => console.log(`السيرفر يعمل على بورت ${PORT}`));