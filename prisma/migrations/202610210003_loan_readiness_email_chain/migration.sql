-- A researched, education-first 10-email sequence for future subscribers.
-- It remains a draft until the public consent language permits this cadence
-- and live delivery has been verified end to end.
WITH templates(
  "id", "name", "subject", "preheader", "eyebrow", "headline",
  "body", "ctaLabel", "accentColor"
) AS (
  VALUES
    (
      'email_template_readiness_01',
      'Loan readiness 01 · comparison checklist',
      'Your loan-options checklist, {{name}}',
      'Four details can make loan options easier to compare.',
      'A SMARTER FIRST LOOK',
      'Compare the whole offer',
      E'Hi {{name}}, before choosing any personal-loan option, compare four things: APR, fees, repayment term, and the total amount you would repay.\n\nThe lowest monthly payment is not always the lowest-cost choice. Your options link is ready when you want to review it.',
      'Review loan options',
      '#245f52'
    ),
    (
      'email_template_readiness_02',
      'Loan readiness 02 · APR explained',
      'APR and interest rate are not the same',
      'Use APR to see interest and certain fees together.',
      'KNOW THE NUMBERS',
      'What APR helps you compare',
      E'Hi {{name}}, an interest rate shows the cost of borrowing, while APR is designed to include interest plus certain lender fees.\n\nWhen two options have the same amount and term, APR can make the comparison clearer. Review the full lender disclosures before deciding.',
      'Compare available options',
      '#315f78'
    ),
    (
      'email_template_readiness_03',
      'Loan readiness 03 · payment versus cost',
      'A lower payment can still cost more',
      'Term length can change both the payment and total interest.',
      'MONTHLY PAYMENT VS. TOTAL COST',
      'Look beyond the monthly number',
      E'Hi {{name}}, a longer repayment term may reduce the monthly payment, but it can increase the total interest paid.\n\nCompare options using the same loan amount and look at both the monthly payment and total repayment.',
      'Review the full terms',
      '#7b6535'
    ),
    (
      'email_template_readiness_04',
      'Loan readiness 04 · lender factors',
      'What lenders may consider',
      'Eligibility and terms depend on more than one number.',
      'HOW LENDERS REVIEW A REQUEST',
      'Your full financial picture matters',
      E'Hi {{name}}, lenders use their own rules. Credit history, income, existing monthly debt, requested amount, and employment information may all affect eligibility and terms.\n\nA match or estimate is not a final approval.',
      'See provider options',
      '#5d547a'
    ),
    (
      'email_template_readiness_05',
      'Loan readiness 05 · debt-to-income',
      'A quick debt-to-income check',
      'Compare monthly debt payments with gross monthly income.',
      'A TWO-NUMBER BUDGET CHECK',
      'Know what already leaves your budget',
      E'Hi {{name}}, debt-to-income ratio compares monthly debt payments with gross monthly income.\n\nKnowing both numbers can help you judge whether another payment fits your budget before applying.',
      'Revisit loan options',
      '#2f7464'
    ),
    (
      'email_template_readiness_06',
      'Loan readiness 06 · right-size the request',
      'Borrow the amount you actually need',
      'A right-sized request can keep payments and interest in check.',
      'START WITH THE EXPENSE',
      'Right-size the amount',
      E'Hi {{name}}, requesting more than you need can mean a larger payment and more total interest.\n\nStart with the expense you need to cover, include any lender fee that may be deducted from proceeds, and compare the resulting payment with your budget.',
      'Review available options',
      '#436b3f'
    ),
    (
      'email_template_readiness_07',
      'Loan readiness 07 · credit inquiries',
      'Soft check, hard check: know the difference',
      'The provider disclosure should explain the credit inquiry.',
      'BEFORE YOU APPLY',
      'Know which credit check comes next',
      E'Hi {{name}}, some providers use a soft credit inquiry to show estimated options. A formal application may involve a hard inquiry that can affect your credit score.\n\nCheck the provider''s disclosure before submitting an application.',
      'Explore the next step',
      '#4c6180'
    ),
    (
      'email_template_readiness_08',
      'Loan readiness 08 · application details',
      'Have these details ready',
      'Accurate information can make the application process smoother.',
      'A LITTLE PREPARATION HELPS',
      'Prepare before visiting the provider',
      E'Hi {{name}}, a lender may ask for identity, income, employment, housing, and existing-debt details, and may request documents to verify them.\n\nNever enter sensitive information unless you are on the provider''s secure site.',
      'Continue securely',
      '#665b86'
    ),
    (
      'email_template_readiness_09',
      'Loan readiness 09 · scam warning',
      'Pause if anyone promises guaranteed approval',
      'Upfront-payment demands and pressure are warning signs.',
      'PROTECT YOURSELF',
      'Slow down when the pressure goes up',
      E'Hi {{name}}, legitimate lenders do not need you to pay with gift cards, cryptocurrency, or wire transfers to release a loan.\n\nBe cautious about guaranteed approval, upfront-payment demands, or pressure to act immediately. Read the written terms and verify who you are dealing with.',
      'Use your SpareCash link',
      '#8a4f3f'
    ),
    (
      'email_template_readiness_10',
      'Loan readiness 10 · final review',
      'One final comparison before you decide',
      'Confirm the proceeds, APR, payment schedule, and total repayment.',
      'YOUR FINAL CHECK',
      'Make the decision with the full picture',
      E'Hi {{name}}, before accepting an offer, confirm the amount you will receive after fees, APR, payment amount, number of payments, total repayment, due dates, and any late-payment terms.\n\nYou are never required to accept an option simply because you reviewed it.',
      'Compare your options',
      '#245f52'
    )
)
INSERT INTO "EmailTemplate" (
  "id", "name", "status", "subject", "preheader", "eyebrow", "headline",
  "body", "ctaLabel", "accentColor", "htmlSource", "createdAt", "updatedAt"
)
SELECT
  templates."id",
  templates."name",
  'ACTIVE'::"RunStatus",
  templates."subject",
  templates."preheader",
  templates."eyebrow",
  templates."headline",
  templates."body",
  templates."ctaLabel",
  templates."accentColor",
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM templates
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "status" = EXCLUDED."status",
  "subject" = EXCLUDED."subject",
  "preheader" = EXCLUDED."preheader",
  "eyebrow" = EXCLUDED."eyebrow",
  "headline" = EXCLUDED."headline",
  "body" = EXCLUDED."body",
  "ctaLabel" = EXCLUDED."ctaLabel",
  "accentColor" = EXCLUDED."accentColor",
  "updatedAt" = CURRENT_TIMESTAMP;

WITH existing AS (
  SELECT "id"
  FROM "Chain"
  WHERE "name" = 'Email · 30-day loan readiness guide'
    AND "channel" = 'EMAIL'::"Channel"
  ORDER BY "createdAt" DESC
  LIMIT 1
), inserted AS (
  INSERT INTO "Chain" (
    "id", "name", "channel", "status", "trigger", "maxDays", "createdAt", "updatedAt"
  )
  SELECT
    'chain_email_loan_readiness_10',
    'Email · 30-day loan readiness guide',
    'EMAIL'::"Channel",
    'DRAFT'::"RunStatus",
    'SUBSCRIBED',
    35,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  WHERE NOT EXISTS (SELECT 1 FROM existing)
  RETURNING "id"
), target AS (
  SELECT "id" FROM existing
  UNION ALL
  SELECT "id" FROM inserted
  LIMIT 1
), steps(
  "position", "delayHours", "subject", "body", "emailTemplateId"
) AS (
  VALUES
    (0, 0, 'Your loan-options checklist, {{name}}', E'Hi {{name}}, before choosing any personal-loan option, compare four things: APR, fees, repayment term, and the total amount you would repay.\n\nThe lowest monthly payment is not always the lowest-cost choice. Your options link is ready when you want to review it: {{link}}', 'email_template_readiness_01'),
    (1, 24, 'APR and interest rate are not the same', E'Hi {{name}}, an interest rate shows the cost of borrowing, while APR is designed to include interest plus certain lender fees.\n\nWhen two options have the same amount and term, APR can make the comparison clearer. Review the full lender disclosures before deciding: {{link}}', 'email_template_readiness_02'),
    (2, 48, 'A lower payment can still cost more', E'Hi {{name}}, a longer repayment term may reduce the monthly payment, but it can increase the total interest paid.\n\nCompare options using the same loan amount and look at both the monthly payment and total repayment: {{link}}', 'email_template_readiness_03'),
    (3, 72, 'What lenders may consider', E'Hi {{name}}, lenders use their own rules. Credit history, income, existing monthly debt, requested amount, and employment information may all affect eligibility and terms.\n\nA match or estimate is not a final approval: {{link}}', 'email_template_readiness_04'),
    (4, 72, 'A quick debt-to-income check', E'Hi {{name}}, debt-to-income ratio compares monthly debt payments with gross monthly income.\n\nKnowing both numbers can help you judge whether another payment fits your budget before applying: {{link}}', 'email_template_readiness_05'),
    (5, 72, 'Borrow the amount you actually need', E'Hi {{name}}, requesting more than you need can mean a larger payment and more total interest.\n\nStart with the expense you need to cover, include any lender fee that may be deducted from proceeds, and compare the resulting payment with your budget: {{link}}', 'email_template_readiness_06'),
    (6, 96, 'Soft check, hard check: know the difference', E'Hi {{name}}, some providers use a soft credit inquiry to show estimated options. A formal application may involve a hard inquiry that can affect your credit score.\n\nCheck the provider''s disclosure before submitting an application: {{link}}', 'email_template_readiness_07'),
    (7, 96, 'Have these details ready', E'Hi {{name}}, a lender may ask for identity, income, employment, housing, and existing-debt details, and may request documents to verify them.\n\nNever enter sensitive information unless you are on the provider''s secure site: {{link}}', 'email_template_readiness_08'),
    (8, 120, 'Pause if anyone promises guaranteed approval', E'Hi {{name}}, legitimate lenders do not need you to pay with gift cards, cryptocurrency, or wire transfers to release a loan.\n\nBe cautious about guaranteed approval, upfront-payment demands, or pressure to act immediately. Read the written terms and verify who you are dealing with: {{link}}', 'email_template_readiness_09'),
    (9, 120, 'One final comparison before you decide', E'Hi {{name}}, before accepting an offer, confirm the amount you will receive after fees, APR, payment amount, number of payments, total repayment, due dates, and any late-payment terms.\n\nYou are never required to accept an option simply because you reviewed it: {{link}}', 'email_template_readiness_10')
)
INSERT INTO "ChainStep" (
  "id", "chainId", "position", "delayHours", "subject", "body",
  "offerId", "emailTemplateId", "mediaAssetId"
)
SELECT
  'chain_email_loan_readiness_10_step_' || LPAD(steps."position"::text, 2, '0'),
  target."id",
  steps."position",
  steps."delayHours",
  steps."subject",
  steps."body",
  NULL,
  steps."emailTemplateId",
  NULL
FROM target
CROSS JOIN steps
ON CONFLICT ("chainId", "position") DO UPDATE SET
  "delayHours" = EXCLUDED."delayHours",
  "subject" = EXCLUDED."subject",
  "body" = EXCLUDED."body",
  "emailTemplateId" = EXCLUDED."emailTemplateId";
