-- FX rates gain a date and a source.
--
-- The currency switcher on the portfolio screen converted at `DEFAULT_FX` in
-- packages/money — three bigints written into source from the prototype. Every
-- call site omitted the optional `fx` argument, so the `fx_rates` table was
-- seeded once and then read by nothing except a `count(*)` on the admin
-- overview. An investor toggling to JMD saw their net worth converted at a rate
-- nobody had checked since the file was written, presented with the same
-- confidence as the balance itself.
--
-- CCN routes orders and holds no money, so it has no rate of its own to quote
-- and no business inventing one. The rate belongs to the central bank that
-- publishes it daily, and the two things that make it honest on screen are
-- which bank said so and when they said it.
--
-- `as_of` is the date the publisher assigns to the rate, not the time we fetched
-- it: a rate pulled on Monday morning is Friday's rate, and showing the fetch
-- time would claim a freshness the number does not have. Nullable because the
-- seeded fallback row genuinely has no publication date, and a made-up one would
-- be the exact failure this column exists to prevent.

ALTER TABLE "fx_rates" ADD COLUMN IF NOT EXISTS "as_of" date;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD COLUMN IF NOT EXISTS "source" text;--> statement-breakpoint

-- The seeded rows predate any publisher. Naming them for what they are keeps
-- "where did this number come from" answerable for every row in the table.
UPDATE "fx_rates" SET "source" = 'seed' WHERE "source" IS NULL;
