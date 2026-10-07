-- Configure the LeadTechX self-optimizing link and the only outcome this pixel reports.
-- All other owner settings are preserved. This runs once per database.
UPDATE "Setting"
SET "value" = "value" || '{"roundskyUrl":"https://www.rnd3.com/ai/iframeRedirect.php?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.","roundskySubIdParameter":"subId3","roundskyPrepopulate":true,"stopOn":"SOLD"}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'general';
