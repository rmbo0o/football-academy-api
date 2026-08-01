const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_123';
const PORT = process.env.PORT || 5000;
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
        db.run(`CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL, package_id INTEGER NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL, FOREIGN KEY(player_id) REFERENCES players(id), FOREIGN KEY(package_id) REFERENCES packages(id))`);

        db.run(`CREATE TABLE IF NOT EXISTS branches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            city TEXT NOT NULL,
            address TEXT,
            phone TEXT,
            manager TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS refunds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL,
            reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(player_id) REFERENCES players(id)
        )`);


        db.run(`CREATE TABLE IF NOT EXISTS holidays (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            start_date TEXT,
            days_count INTEGER
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS player_evaluations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER,
            coach_id INTEGER,
            month TEXT,
            passing_score INTEGER,
            shooting_score INTEGER,
            running_score INTEGER,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

        // 🔄 فحص ترقية جدول الحصص تلقائياً وتفعيل الهيكلية الذكية الجديدة
        db.all("PRAGMA table_info(sessions)", [], (err, rows) => {
            if (err) return console.error(err.message);
            
            const hasPackageId = rows && rows.some(r => r.name === 'package_id');
            if (!hasPackageId) {
                db.serialize(() => {
                    db.run(`DROP TABLE IF EXISTS session_players`);
                    db.run(`DROP TABLE IF EXISTS session_attendance`);
                    db.run(`DROP TABLE IF EXISTS sessions`);

                    // الحصص الجديدة مرتبطة بالباقة والمدرب مباشرة
                    db.run(`
                        CREATE TABLE sessions (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            package_id INTEGER NOT NULL,
                            coach_id INTEGER NOT NULL,
                            branch_id INTEGER,
                            FOREIGN KEY(package_id) REFERENCES packages(id) ON DELETE CASCADE,
                            FOREIGN KEY(coach_id) REFERENCES users(id) ON DELETE CASCADE,
                            FOREIGN KEY(branch_id) REFERENCES branches(id) ON DELETE SET NULL
                        )
                    `);

                    // جدول التحضير للحصص الجديدة
                    db.run(`
                        CREATE TABLE session_attendance (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            session_id INTEGER NOT NULL,
                            player_id INTEGER NOT NULL,
                            date TEXT NOT NULL,
                            status TEXT NOT NULL,
                            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                            FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
                        )
                    `);
                    console.log('🔄 تم تحديث قاعدة البيانات بنجاح لنظام الحصص المترابط تلقائياً!');
                });
            }
        });

        // ترقية جدول اللاعبين لربطه بالفروع تلقائياً
        db.run(`ALTER TABLE players ADD COLUMN branch_id INTEGER`, (err) => {
            // تجاهل الخطأ إذا كان العمود مضافاً مسبقاً
        });

        db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
            if (row && row.count === 0) {
                const hashedPassword = bcrypt.hashSync('password', 10);
                db.run("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)", ['المدير العام', 'admin@academy.com', hashedPassword, 'admin']);
                console.log('💡 تم إنشاء حساب المدير الافتراضي بنجاح (admin@academy.com).');
            }
        });

                db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
            if (row && row.count === 0) {
                const hashedPassword = bcrypt.hashSync('password', 10);
                db.run("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)", ['المدرب', 'coach.ahmed@academy.com', hashedPassword, 'coach']);
                console.log('💡 تم إنشاء حساب المدرب الافتراضي بنجاح (coach.ahmed@academy.com).');
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

// تسجيل لاعب جديد وتوليد معرف فريد تلقائياً
app.post('/api/players', (req, res) => {
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
            past_injuries, current_medications, branch_id || null
        ];

        db.run(sql, params, function(err) {
            if (err) return res.status(500).json({ message: 'فشل تسجيل اللاعب في قاعدة البيانات.' });
            res.status(201).json({ message: `تم تسجيل اللاعب بنجاح!`, member_number: finalMemberNumber, playerId: this.lastID });
        });
    });
});

app.get('/api/players', verifyToken, (req, res) => {
    db.all("SELECT id, name, member_number FROM players ORDER BY id DESC", [], (err, rows) => { res.json(rows); });
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
        ORDER BY s.name, p.name, pd.months
    `;
    db.all(sql, [], (err, rows) => {
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
    const sql = `
        SELECT p.id, p.name AS package_name, s.name AS sport_name, p.days, p.session_time, p.max_subscribers
        FROM packages p
        JOIN sports s ON p.sport_id = s.id
    `;
    db.all(sql, [], (err, rows) => {
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
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'عذراً، هذه الصلاحية خاصة بالمدير العام فقط!' });
    const packageId = req.params.id;
    const { sport_name, name, days, session_time, max_subscribers, durations } = req.body;

    db.get("SELECT id FROM sports WHERE name = ?", [sport_name.trim()], (err, sportRow) => {
        if (err) return res.status(500).json({ message: 'خطأ في فحص الرياضة' });

        const updatePackage = (sportId) => {
            const sql = `UPDATE packages SET sport_id = ?, name = ?, days = ?, session_time = ?, max_subscribers = ? WHERE id = ?`;
            db.run(sql, [sportId, name, days, session_time, max_subscribers || 0, packageId], function(err) {
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
    const reportData = { totalIncome: 0, totalRefunds: 0, netIncome: 0, playersPerSport: [], totalPlayers: 0, recentRefundsList: [] };

    const incomeSql = `
        SELECT SUM(pd.price) as total_income 
        FROM subscriptions sub 
        JOIN package_durations pd ON sub.duration_id = pd.id 
        WHERE strftime('%Y-%m', sub.created_at) = strftime('%Y-%m', 'now')
    `;
    db.get(incomeSql, [], (err, incomeRow) => {
        reportData.totalIncome = (incomeRow && incomeRow.total_income) ? incomeRow.total_income : 0;

        const refundSql = `
            SELECT SUM(amount) as total_refunds 
            FROM refunds 
            WHERE strftime('%Y-%m', date) = strftime('%Y-%m', 'now')
        `;
        db.get(refundSql, [], (err, refundRow) => {
            reportData.totalRefunds = (refundRow && refundRow.total_refunds) ? refundRow.total_refunds : 0;
            reportData.netIncome = reportData.totalIncome - reportData.totalRefunds;

            const sportSql = `
                SELECT s.name as sport_name, COUNT(DISTINCT sub.player_id) as player_count
                FROM sports s
                LEFT JOIN packages p ON s.id = p.sport_id
                LEFT JOIN package_durations pd ON p.id = pd.package_id
                LEFT JOIN subscriptions sub ON pd.id = sub.duration_id
                GROUP BY s.id
            `;
            db.all(sportSql, [], (err, sportRows) => {
                reportData.playersPerSport = sportRows || [];

                db.get("SELECT COUNT(*) as total FROM players", [], (err, playerRow) => {
                    reportData.totalPlayers = (playerRow && playerRow.total) ? playerRow.total : 0;

                    const recentRefundsSql = `
                        SELECT r.id, r.amount, r.date, r.reason, p.name as player_name 
                        FROM refunds r
                        JOIN players p ON r.player_id = p.id
                        ORDER BY r.id DESC LIMIT 10
                    `;
                    db.all(recentRefundsSql, [], (err, refundRows) => {
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

// 1. جلب الكباتن والمدربين فقط
app.get('/api/coaches', verifyToken, (req, res) => {
    db.all("SELECT id, name, email FROM users WHERE role IN ('coach', 'مدرب')", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 2. إنشاء حصة تدريبية جديدة (ربط باقة بمدرب)
app.post('/api/sessions', verifyToken, (req, res) => {
    const { package_id, coach_id, branch_id } = req.body;
    if (!package_id || !coach_id) {
        return res.status(400).json({ message: "يرجى تحديد الباقة والمدرب الكابتن الحصة." });
    }
    db.run(
        "INSERT INTO sessions (package_id, coach_id, branch_id) VALUES (?, ?, ?)", 
        [package_id, coach_id, branch_id || null], 
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "تم تسجيل الحصة التدريبية بنجاح! ⚽", sessionId: this.lastID });
        }
    );
});

// 3. جلب جدول الحصص الأسبوعية المؤتمت مع دمج بيانات الباقة وتفكيك الوقت بدقة
app.get('/api/sessions', verifyToken, (req, res) => {
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
        JOIN users u ON s.coach_id = u.id
    `;
    db.all(sql, [], (err, rows) => {
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
                coach_name: row.coach_name,
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
app.get('/api/sessions/:id/players', verifyToken, (req, res) => {
    const sessionId = req.params.id;
    const sql = `
        SELECT DISTINCT pl.id, pl.name, pl.member_number
        FROM players pl
        JOIN subscriptions sub ON pl.id = sub.player_id
        JOIN package_durations pd ON sub.duration_id = pd.id
        JOIN sessions s ON pd.package_id = s.package_id
        WHERE s.id = ?
    `;
    db.all(sql, [sessionId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 5. جلب حضور حصة معينة في تاريخ محدد
app.get('/api/sessions/:id/attendance', verifyToken, (req, res) => {
    const sessionId = req.params.id;
    const { date } = req.query; 
    db.all("SELECT player_id, status FROM session_attendance WHERE session_id = ? AND date = ?", [sessionId, date], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 6. حفظ كشف التحضير الجماعي للحصة في تاريخ معين
app.post('/api/sessions/:id/attendance', verifyToken, (req, res) => {
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
  let sql = 'SELECT * FROM players WHERE name LIKE ? OR member_number LIKE ?';
  db.all(sql, [`%${q}%`, `%${q}%`], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
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
    const extendSql = `UPDATE subscriptions SET end_date = date(end_date, '+' || ? || ' days') WHERE end_date >= date('now')`;
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