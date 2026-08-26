/**
 * ==============================================================================
 * Supabase Admin Client (Server-Side Only / Service Role)
 * ==============================================================================
 * ⚠️ คำเตือน: ไฟล์นี้ต้องใช้เฉพาะบน Server (Node.js/Express/Next.js API Route) เท่านั้น
 * ห้ามนำไป import บน Frontend Browser หรือเปิดเผย Service Role Key เด็ดขาด!
 */

import { createClient } from '@supabase/supabase-js';

const getEnvVar = (name) => {
    if (typeof process !== 'undefined' && process.env && process.env[name]) {
        return process.env[name];
    }
    return '';
};

const supabaseUrl = getEnvVar('SUPABASE_URL');
const supabaseServiceRoleKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY');

/**
 * สร้าง Supabase Admin Client ที่มีสิทธิ์ Bypass RLS สำหรับงาน Backend Management
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

export default supabaseAdmin;
