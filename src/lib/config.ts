// Public client configuration. The publishable key is designed to ship in the browser;
// every table and function is protected by RLS / owner checks on the server.
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || 'https://znwlsbaacdvwhlruqzer.supabase.co';
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_MYVEy4HHoB8aGzCdSsrV3Q_U0Stodg2';
export const HOSPITAL_NAME = 'مستشفى الحديثة العام';
export const USER_NAME = 'سلوى';
export const USER_FULL_NAME = 'سلوى عوض الرويلي';
export const USER_TITLE = 'رئيسة قسم الإحصاء الطبي';
