-- נקודה טובה וצילום ביטחון נדחו כי app_backups קיבל רק auto ו-manual.
-- השורות הקיימות נשארות. האילוץ החדש מתאים לסוגים שהאפליקציה כבר שולחת.

ALTER TABLE public.app_backups DROP CONSTRAINT IF EXISTS app_backups_kind_check;

ALTER TABLE public.app_backups ADD CONSTRAINT app_backups_kind_check
  CHECK (
    kind = ANY (ARRAY['auto', 'manual', 'good', 'safety', 'working', 'restore']::text[])
    OR kind LIKE 'good:%'
    OR kind LIKE 'safety-%'
    OR kind LIKE 'safety:%'
  );
