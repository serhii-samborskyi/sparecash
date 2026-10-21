-- RoundSky publisher catalog captured from the owner's authenticated offer page.
-- Entries are assignable but non-default, so importing them never changes traffic.
WITH catalog("id", "name", "destinationUrl") AS (
  VALUES
    ('roundsky-self-optimizing', 'RoundSky · Self-optimizing', 'https://www.rnd3.com/ai/iframeRedirect.php?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-23', 'RoundSky · honestloans.net', 'https://www.honestloans.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-1', 'RoundSky · 100cashloans.com', 'https://www.100cashloans.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-3', 'RoundSky · cash4lending.net', 'https://www.cash4lending.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-8', 'RoundSky · cashmeloans.com', 'https://www.cashmeloans.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-13', 'RoundSky · familylendingservices.com', 'https://www.familylendingservices.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-24', 'RoundSky · installmentloanadvisors.com', 'https://www.installmentloanadvisors.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-26', 'RoundSky · lifefunds.net', 'https://www.lifefunds.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-28', 'RoundSky · medicalloans365.com', 'https://www.medicalloans365.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-29', 'RoundSky · mondayloans.net', 'https://www.mondayloans.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-35', 'RoundSky · onlineloannetwork.com', 'https://www.onlineloannetwork.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-44', 'RoundSky · simplecashlending.com', 'https://www.simplecashlending.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-49', 'RoundSky · tuesdayloans.net', 'https://www.tuesdayloans.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-51', 'RoundSky · wecashloans.com', 'https://www.wecashloans.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-52', 'RoundSky · winterloans.net', 'https://www.winterloans.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-89', 'RoundSky · hotloanstoday.com', 'https://www.hotloanstoday.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-39', 'RoundSky · priorityonepayday.com', 'https://www.priorityonepayday.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-96', 'RoundSky · fastmoneysource.com', 'https://www.fastmoneysource.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-5', 'RoundSky · cashfinance.co', 'https://www.cashfinance.co/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-6', 'RoundSky · cashforloansnow.net', 'https://www.cashforloansnow.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-4', 'RoundSky · cashdoc.net', 'https://www.cashdoc.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-14', 'RoundSky · fastcashonline.co', 'https://www.fastcashonline.co/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-7', 'RoundSky · cashkittyloans.com', 'https://www.cashkittyloans.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-10', 'RoundSky · comparemefunds.com', 'https://www.comparemefunds.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-93', 'RoundSky · dinerodinero.net', 'https://www.dinerodinero.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-57', 'RoundSky · directfundcenter.com', 'https://www.directfundcenter.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-17', 'RoundSky · fastloansgroup.com', 'https://www.fastloansgroup.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-30', 'RoundSky · moneycashfund.com', 'https://www.moneycashfund.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-97', 'RoundSky · fireworkloan.com', 'https://www.fireworkloan.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-87', 'RoundSky · firstfamilylending.com', 'https://www.firstfamilylending.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-106', 'RoundSky · fourleafloans.com', 'https://www.fourleafloans.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-112', 'RoundSky · fundsforowners.com', 'https://www.fundsforowners.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-20', 'RoundSky · getfundsquickly.com', 'https://www.getfundsquickly.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-63', 'RoundSky · halloweenloans.com', 'https://www.halloweenloans.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-65', 'RoundSky · halloweenloans.net', 'https://www.halloweenloans.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-103', 'RoundSky · loanturkey.com', 'https://www.loanturkey.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-31', 'RoundSky · moneypuploans.com', 'https://www.moneypuploans.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-32', 'RoundSky · motofunds.com', 'https://www.motofunds.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-34', 'RoundSky · onlinecashadvancers.com', 'https://www.onlinecashadvancers.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-36', 'RoundSky · onlineloansdirect.xyz', 'https://www.onlineloansdirect.xyz/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-37', 'RoundSky · paydaysos.com', 'https://www.paydaysos.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-25', 'RoundSky · installmentloansos.com', 'https://www.installmentloansos.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-54', 'RoundSky · onlineloannetwork.com/box/10', 'https://www.onlineloannetwork.com/box/10?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-59', 'RoundSky · quickcashadvanceusa.com', 'https://www.quickcashadvanceusa.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-40', 'RoundSky · quikloanlending.com', 'https://www.quikloanlending.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-42', 'RoundSky · rightloansusa.com', 'https://www.rightloansusa.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-9', 'RoundSky · claimmyloans.com', 'https://www.claimmyloans.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-12', 'RoundSky · drfunding.net', 'https://www.drfunding.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-91', 'RoundSky · earlypaytoday.com', 'https://www.earlypaytoday.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-15', 'RoundSky · fastlending.xyz', 'https://www.fastlending.xyz/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-21', 'RoundSky · happyloans.net', 'https://www.happyloans.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-50', 'RoundSky · wantmyloans.com', 'https://www.wantmyloans.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-43', 'RoundSky · santaloot.com', 'https://www.santaloot.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-67', 'RoundSky · christmasscash.com', 'https://www.christmasscash.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-75', 'RoundSky · christmasscheercash.com', 'https://www.christmasscheercash.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-83', 'RoundSky · decemberdough.com', 'https://www.decemberdough.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-73', 'RoundSky · decemberloans.net', 'https://www.decemberloans.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-79', 'RoundSky · givingseasonloans.com', 'https://www.givingseasonloans.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-85', 'RoundSky · holidaycheercash.com', 'https://www.holidaycheercash.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-81', 'RoundSky · holidaycheerloans.com', 'https://www.holidaycheerloans.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-77', 'RoundSky · mygiftmoney.com', 'https://www.mygiftmoney.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-71', 'RoundSky · snowmancash.com', 'https://www.snowmancash.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-45', 'RoundSky · slamdunkloans.co', 'https://www.slamdunkloans.co/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-46', 'RoundSky · strongfunds.net', 'https://www.strongfunds.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-2', 'RoundSky · approvedloans.net', 'https://www.approvedloans.net/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-22', 'RoundSky · holidaydough.com', 'https://www.holidaydough.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-38', 'RoundSky · paymyrentloans.com', 'https://www.paymyrentloans.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.'),
    ('roundsky-48', 'RoundSky · taxdayloans.com', 'https://www.taxdayloans.com/?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.')
)
INSERT INTO "Offer" (
  "id", "name", "status", "provider", "destinationUrl",
  "trackingParameter", "postbackKey", "postbackSecret", "isDefault",
  "createdAt", "updatedAt"
)
SELECT
  catalog."id",
  catalog."name",
  'ACTIVE'::"RunStatus",
  'ROUNDSKY',
  catalog."destinationUrl",
  'subId3',
  'offer-' || catalog."id",
  md5(random()::text || clock_timestamp()::text || catalog."id") ||
    md5(random()::text || clock_timestamp()::text || catalog."destinationUrl"),
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM catalog
WHERE NOT EXISTS (
  SELECT 1
  FROM "Offer" existing
  WHERE existing."destinationUrl" = catalog."destinationUrl"
)
ON CONFLICT ("id") DO NOTHING;

