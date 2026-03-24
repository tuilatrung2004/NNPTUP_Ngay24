/**
 * Script: Import Users từ file Excel
 * Cách dùng: node scripts/importUsers.js
 *
 * Yêu cầu: file user.xlsx phải có cột "username" và "email"
 */

const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// ─── CẤU HÌNH MAILTRAP ────────────────────────────────────────────────────────
// Vào https://mailtrap.io → Inboxes → SMTP Settings → chọn Nodemailer
// Copy thông tin user/pass vào đây:
const MAILTRAP_USER = 'b3eb0a48e985f7';   // ← điền user Mailtrap của bạn
const MAILTRAP_PASS = '70c844fbdc9241';   // ← điền pass Mailtrap của bạn
// ──────────────────────────────────────────────────────────────────────────────

// ─── CẤU HÌNH ĐƯỜNG DẪN FILE EXCEL ───────────────────────────────────────────
const EXCEL_FILE = path.resolve(__dirname, '../../user.xlsx');
// ──────────────────────────────────────────────────────────────────────────────

const userModel  = require('../schemas/users');
const roleModel  = require('../schemas/roles');

// Tạo transporter Mailtrap
const transporter = nodemailer.createTransport({
    host: 'sandbox.smtp.mailtrap.io',
    port: 2525,
    secure: false,
    auth: {
        user: MAILTRAP_USER,
        pass: MAILTRAP_PASS,
    },
    tls: {
        rejectUnauthorized: false,
        ciphers: 'SSLv3'
    }
});

/**
 * Delay giữa các email để tránh rate limit Mailtrap free plan
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Sinh mật khẩu ngẫu nhiên 16 ký tự (chữ + số + ký tự đặc biệt)
 */
function generatePassword(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    return Array.from(crypto.randomFillSync(new Uint8Array(length)))
        .map(byte => chars[byte % chars.length])
        .join('');
}

/**
 * Gửi email thông báo mật khẩu
 */
async function sendPasswordEmail(email, username, password) {
    const info = await transporter.sendMail({
        from: '"Admin System" <admin@example.com>',
        to: email,
        subject: '🔐 Tài khoản của bạn đã được tạo',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; 
                    border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
            <div style="background: #4f46e5; padding: 20px; color: white; text-align: center;">
                <h2 style="margin:0;">🎉 Chào mừng bạn!</h2>
            </div>
            <div style="padding: 24px;">
                <p>Xin chào <strong>${username}</strong>,</p>
                <p>Tài khoản của bạn đã được tạo thành công. Dưới đây là thông tin đăng nhập:</p>
                <table style="width:100%; border-collapse:collapse; margin: 16px 0;">
                    <tr>
                        <td style="padding:8px; background:#f8f8f8; font-weight:bold;">Tên đăng nhập:</td>
                        <td style="padding:8px;">${username}</td>
                    </tr>
                    <tr>
                        <td style="padding:8px; background:#f8f8f8; font-weight:bold;">Email:</td>
                        <td style="padding:8px;">${email}</td>
                    </tr>
                    <tr>
                        <td style="padding:8px; background:#f8f8f8; font-weight:bold;">Mật khẩu:</td>
                        <td style="padding:8px; font-family:monospace; font-size:16px; color:#4f46e5;">
                            <strong>${password}</strong>
                        </td>
                    </tr>
                </table>
                <p style="color:#e53e3e;"><strong>⚠ Vui lòng đổi mật khẩu sau khi đăng nhập lần đầu.</strong></p>
            </div>
            <div style="background:#f0f0f0; padding:12px; text-align:center; font-size:12px; color:#666;">
                © 2026 NNPTUD System
            </div>
        </div>
        `,
    });
    console.log(`  📧 Email gửi tới ${email} → messageId: ${info.messageId}`);
}

/**
 * Hàm chính
 */
async function main() {
    // Kết nối MongoDB
    console.log('🔌 Kết nối MongoDB...');
    await mongoose.connect('mongodb://localhost:27017/NNPTUD-S3');
    console.log('✅ Kết nối thành công!\n');

    // Tìm role "USER" trong DB
    let userRole = await roleModel.findOne({ name: 'USER', isDeleted: false });
    if (!userRole) {
        // Nếu chưa có role USER thì tạo
        console.log('ℹ️  Không tìm thấy role "USER", đang tạo mới...');
        userRole = await roleModel.create({ name: 'USER', description: 'Default user role' });
        console.log('✅ Đã tạo role USER:', userRole._id);
    } else {
        console.log('✅ Tìm thấy role USER:', userRole._id);
    }

    // Đọc file Excel
    console.log(`\n📂 Đọc file: ${EXCEL_FILE}`);
    const workbook = XLSX.readFile(EXCEL_FILE);
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    console.log(`📋 Tổng số dòng: ${rows.length}\n`);

    let successCount = 0;
    let skipCount    = 0;
    let errorCount   = 0;

    for (const row of rows) {
        const username = (row['username'] || row['Username'] || '').toString().trim();
        const email    = (row['email']    || row['Email']    || '').toString().trim();

        if (!username || !email) {
            console.log(`⚠️  Bỏ qua dòng thiếu dữ liệu:`, row);
            skipCount++;
            continue;
        }

        // Kiểm tra user đã tồn tại chưa
        const existingUser = await userModel.findOne({
            $or: [{ username }, { email }],
            isDeleted: false,
        });

        if (existingUser) {
            console.log(`⏭️  Bỏ qua "${username}" (${email}) — đã tồn tại`);
            skipCount++;
            continue;
        }

        // Sinh mật khẩu random 16 ký tự
        const rawPassword = generatePassword(16);

        try {
            // Tạo user (password sẽ được hash tự động bởi pre-save hook)
            const newUser = new userModel({
                username,
                email,
                password: rawPassword,
                role: userRole._id,
                status: true,
            });
            await newUser.save();
            console.log(`✅ Tạo user: ${username} (${email})`);
            successCount++;
        } catch (err) {
            console.error(`❌ Lỗi tạo user "${username}":`, err.message);
            errorCount++;
            continue;
        }

        // Gửi email mật khẩu (tách riêng để không ảnh hưởng việc tạo user)
        try {
            await sleep(1200); // Tránh rate limit Mailtrap free plan
            await sendPasswordEmail(email, username, rawPassword);
        } catch (mailErr) {
            console.error(`  ⚠️  Gửi email thất bại cho ${email}:`, mailErr.message);
        }
    }

    console.log('\n═══════════════════════════════════════');
    console.log(`🏁 Hoàn thành!`);
    console.log(`   ✅ Thành công : ${successCount}`);
    console.log(`   ⏭️  Bỏ qua    : ${skipCount}`);
    console.log(`   ❌ Lỗi       : ${errorCount}`);
    console.log('═══════════════════════════════════════');

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('💥 Lỗi nghiêm trọng:', err);
    process.exit(1);
});
