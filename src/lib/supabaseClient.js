/**
 * ==============================================================================
 * Supabase Client Initialization (Frontend / Public / Client-Safe)
 * ==============================================================================
 * ใช้อนุญาตให้นักเรียนและระบบดึงข้อมูลตามสิทธิ์ RLS (Anon Key)
 * ปลอดภัยสำหรับการใช้งานบน Browser และ Frontend Application
 */

import { createClient } from '@supabase/supabase-js';

// ตรวจสอบและดึง Environment Variables (รองรับทั้ง Node.js, Vite, Webpack, และ Next.js)
const getEnvVar = (name) => {
    if (typeof process !== 'undefined' && process.env && process.env[name]) {
        return process.env[name];
    }
    // รองรับ Vite / Modern ESM bundlers
    if (typeof import.meta !== 'undefined' && import.meta.env) {
        if (import.meta.env[name]) return import.meta.env[name];
        if (import.meta.env[`VITE_${name}`]) return import.meta.env[`VITE_${name}`];
        if (import.meta.env[`NEXT_PUBLIC_${name}`]) return import.meta.env[`NEXT_PUBLIC_${name}`];
    }
    return '';
};

const supabaseUrl = getEnvVar('SUPABASE_URL') || getEnvVar('VITE_SUPABASE_URL') || getEnvVar('NEXT_PUBLIC_SUPABASE_URL');
const supabaseAnonKey = getEnvVar('SUPABASE_ANON_KEY') || getEnvVar('VITE_SUPABASE_ANON_KEY') || getEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY');

/**
 * สร้าง Supabase Client เริ่มต้น
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
    }
});

/**
 * ฟังก์ชันสร้าง Custom Supabase Client กรณีต้องการส่ง URL หรือ Key แบบไดนามิก
 * @param {string} url - Supabase Project URL
 * @param {string} anonKey - Supabase Anon Key
 */
export const createCustomClient = (url, anonKey) => {
    return createClient(url, anonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
        }
    });
};

export default supabase;
