# Product context

User: Sultan. End user: سلوى عوض الرويلي, رئيسة قسم الإحصاء الطبي بمستشفى الحديثة العام. All end-user copy is simple professional Arabic. App direction: minimalist, luxurious glass, smooth deliberate motion, exceptional chart entrance, optional subtle sound.

This is one private online application for one allowed account. It is not a public hospital portal or a marketing landing page. Do not publish automatically.

## Exact navigation
Physical far right: تعبئة. Inner right: البيانات. Center and initial screen: المساعد. Inner left: المؤشرات. Physical far left: استخراج. Settings opens from a top control. Preserve this physical arrangement in RTL.

## Workflows
- Assistant: ask a statistical question in Arabic; return only the requested answer, correct unit and period, a compact source/coverage line, and optional details/actions.
- Indicators: customizable charts and KPIs, shared date/department filters, table alternative, source and completeness, saved views.
- Data: XLSX/CSV import to staging, column mapping, validation, grain and date recognition, duplicate detection, explicit approval and version history.
- Fill: upload a received Excel template; map target cells to metric requests; show ambiguous fields; fill a preserved copy; verify totals and fidelity; download.
- Export: describe a new statistic; choose clear columns and filters; create a polished Arabic workbook using verified results.
- Settings: theme, font size, number format, calendar, motion and transparency reduction, sound on/off and volume, answer brevity, favorites, templates, connection status and data recovery.

## Accuracy contract
A single versioned metric engine feeds all four output surfaces. The model interprets requests and calls validated functions; database queries perform counts and ratios. A zero differs from missing coverage. Encounters differ from unique patients. Age is measured at encounter; 18-and-over includes exactly 18. Do not split coarse aggregate age bands into unsupported finer ones. Use Asia/Riyadh date boundaries.

## Current provider and cost decisions
The app uses the internet. The user wants zero paid subscriptions or usage charges. Groq Free with openai/gpt-oss-120b is the current candidate to evaluate; verify live availability and account quotas before coding. Do not open paid billing or paid fallbacks. Handle free-plan exhaustion honestly. Supabase is the requested database/storage; check dataset size against current free limits. Entire-app zero cost is conditional on actual hosting, storage, and inference quotas.

## Implementation boundaries
Use existing repo choices when reasonable; for a new app React/TypeScript is a practical default, not a requirement imposed on an existing native codebase. External credentials are not present in this pack. Use visibly marked demo data to build and test until real connections exist. Never fabricate actual hospital counts or a hospital logo. A demo is not a functioning production integration.

Use the full PROJECT_BRIEF_AR.md from the bundle when workflow details are needed. The newest user message overrides older assumptions.
