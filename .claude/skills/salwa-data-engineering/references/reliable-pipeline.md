# Reliable statistical pipeline

## Request contract
Represent a request with metricId, startDate, endDateExclusive, timezone, dimensions, filters, sort, definitionVersion, and datasetVersion. Reject unsupported combinations. The allowed fields come from a server-side catalog, not a schema invented by the model.

## Result contract
Return value or rows, exact units, applied filters, sourceIds, coverage (complete/partial/unknown), qualityIssues, definitionVersion, datasetVersion, queryId, and extractedAt. Render the same contract in every output surface.

## Import contract
Record source grain, file hash, source period, effective version, mapping version, accepted/rejected counts, issue samples, and a reproducible import id. Do not send complete patient files to the model as a substitute for data ingestion.

## Template contract
Record template fingerprint, worksheet and target cells, metric request per target, preserved formula cells, supported features, and verification results. An ambiguous cell is not zero. Unsupported workbook features require a different editing strategy or an explicit unresolved status.

## Privacy and cost
Protect single-account access at both API and database/storage layers. Keep secrets in backend secret storage; public frontend keys do not replace authorization. Keep data-bearing requests out of generic analytics and exception logging.

Use only available free inference and free infrastructure capacity. Account quotas may change. If the dataset does not fit, report measured sizes and relevant constraints; do not silently reduce data fidelity or remove originals to claim zero cost.

## Verification cases
Use independent references, not the same implementation expressed twice. At least one fixture should contain multiple visits by one patient, a visit on the eighteenth birthday, a duplicate file, a corrected source version, and a missing month. For an age-aggregated source that spans the threshold, expect an unsupported answer rather than a guessed split.

## References
- Supabase database: https://supabase.com/docs/guides/database/overview
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Private storage: https://supabase.com/docs/guides/storage/buckets/fundamentals
- Groq tools: https://console.groq.com/docs/tool-use/overview
- Groq limits: https://console.groq.com/docs/rate-limits
- Excel fidelity limitations: https://openpyxl.readthedocs.io/en/stable/tutorial.html
