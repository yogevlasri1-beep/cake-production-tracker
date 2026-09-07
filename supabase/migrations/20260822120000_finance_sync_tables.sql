-- PRE-PUBLISH / חובה לפני כל פרסום שמחבר כספים ל-SYNC_ORDER
-- ============================================================================
-- אל תפרסם קוד שמושך financeAccountMap / financeImports / financeLines
-- לפני שהשאילתה הזו רצה ב-SQL Editor של Supabase והחזירה הצלחה.
--
-- למה: משיכה לטבלת sync_* חסרה מפילה את כל הסנכרון (כמו sync_haccp_team_members).
-- המיגרציות כאן לא רצות דרך Vercel. להריץ ידנית, ואז:
--   NOTIFY pgrst, 'reload schema';
--
-- שלב 1 הנוכחי עדיין לא מוסיף את הטבלאות ל-SYNC_ORDER. הקובץ הזה מוכן
-- לשלב הפרסום הבא — אחרי הרצה ידנית בלבד.
-- ============================================================================

SELECT public.create_kitchen_sync_table('sync_finance_account_map');
SELECT public.create_kitchen_sync_table('sync_finance_imports');
SELECT public.create_kitchen_sync_table('sync_finance_lines');

NOTIFY pgrst, 'reload schema';
