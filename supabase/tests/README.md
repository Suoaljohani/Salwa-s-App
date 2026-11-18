# Engine check (generic datasets)

`engine_check.sql` runs the whole import → approve → query → correct → roll back cycle against the live
schema inside one `DO` block that ends with `RAISE EXCEPTION`, so nothing it creates is kept.
Run it in the Supabase SQL editor; the error message contains `"all_ok": true` and per-case results.
