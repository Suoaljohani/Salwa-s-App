// Known hospital-system reports → dataset settings. Matching is by report title (row 3 of the export).
export interface ReportSpec {
  title: RegExp;
  name: string;
  unit: string;
  description: string;
  /** source header (lower-case) of the column that defines the period; null = aggregate/no period */
  period?: string | null;
  /** source header (lower-case) of the unique row key */
  key?: string | null;
  /** aggregate reports: rows are already counts; keep each file (period) as its own slice */
  aggregate?: boolean;
  skip?: string;
}

export const REPORTS: ReportSpec[] = [
  { title: /^all patient visit report new$/i, name: 'زيارات المرضى', unit: 'زيارة', description: 'كل زيارات الطوارئ والعيادات والتنويم من نظام المستشفى', period: 'actual visit start date & time', key: 'visit id' },
  { title: /^appointment list report$/i, name: 'قائمة المواعيد', unit: 'موعد', description: 'مواعيد العيادات مع القسم والطبيب والحالة', period: 'date' },
  { title: /^diagnosis captured detail$/i, name: 'التشخيصات المسجلة', unit: 'تشخيص', description: 'كل تشخيص مسجل (ICD-10) مع القسم والزيارة', period: 'captured on' },
  { title: /^outpatient worklist$/i, name: 'قائمة عمل العيادات الخارجية', unit: 'موعد', description: 'مواعيد العيادات الخارجية (جديد / متابعة) مع التشخيص', period: 'appointment date/time' },
  { title: /^patient revisit report/i, name: 'إعادة الزيارة خلال 28 يومًا', unit: 'إعادة زيارة', description: 'المرضى الذين عادوا خلال 28 يومًا', period: 'visit date' },
  { title: /^pharmacy pending report$/i, name: 'طلبات الصيدلية المعلقة', unit: 'بند دواء', description: 'بنود الأدوية المطلوبة وحالتها', period: 'order date & time', key: null },
  { title: /^referral out report$/i, name: 'التحويلات الخارجية', unit: 'تحويل', description: 'تحويل المرضى إلى جهات خارجية', period: 'referral date and time' },
  { title: /^rehabilitation manual kpi report/i, name: 'مؤشرات التأهيل الطبي - العيادات', unit: 'زيارة', description: 'مؤشرات زيارات التأهيل', period: "today's date (dd-mm-yyyy)" },
  { title: /^weekly business performance kpi/i, name: 'مؤشرات الأداء الأسبوعية', unit: 'مؤشر', description: 'مؤشرات الأداء الأسبوعية (أعداد مجمعة)', aggregate: true },
  { title: /^antibiotic & antiviral dispense report$/i, name: 'صرف المضادات الحيوية والفيروسية', unit: 'صنف', description: 'كميات الصرف المجمعة', aggregate: true },
  { title: /^doctor wise visit statistics$/i, name: 'الزيارات حسب الطبيب', unit: 'طبيب', description: 'أعداد زيارات العيادات الجديدة والمتابعة لكل طبيب (مجمعة)', aggregate: true },
  { title: /^opd consultation visit statistics/i, name: 'استشارات العيادات الخارجية', unit: 'استشارة', description: 'زيارات الاستشارة في العيادات الخارجية', period: 'arrival date/time' },
  { title: /^statistics of\s+pharmacy prescription$/i, name: 'إحصائية الوصفات اليومية', unit: 'يوم', description: 'عدد الوصفات لكل يوم حسب المناوبة', period: 'date' },
  { title: /^ambulance request report$/i, name: 'طلبات الإسعاف', unit: 'طلب', description: 'طلبات الإسعاف', period: 'requested on' },
  { title: /^claim status report$/i, name: 'حالة المطالبات التأمينية', unit: 'بند مطالبة', description: 'بنود المطالبات وحالتها والمبالغ', period: 'visit date' },
  { title: /^collection and bank deposit report$/i, name: 'التحصيل والإيداع البنكي', unit: 'يوم', description: 'المبالغ المحصلة والمودعة', period: 'date' },
  { title: /^diagnosis count based on speciality$/i, name: 'عدد التشخيصات حسب التخصص', unit: 'تشخيص', description: 'أعداد مجمعة لكل تشخيص حسب التخصص والجنسية والجنس والعمر', aggregate: true },
  { title: /^eligibility report$/i, name: 'الأهلية التأمينية', unit: 'طلب أهلية', description: 'طلبات التحقق من الأهلية', aggregate: true },
  { title: /^future slot report$/i, name: 'الفترات المتاحة للمواعيد', unit: 'فترة', description: 'الفترات المستخدمة وغير المستخدمة لكل خدمة', period: 'slot date' },
  { title: /^ipd referral report$/i, name: 'تحويلات التنويم الداخلية', unit: 'تحويل', description: 'التحويلات الداخلية للمنومين', period: 'referral date' },
  { title: /^ip manual kpi report$/i, name: 'مؤشرات التنويم', unit: 'حالة تنويم', description: 'أوقات التنويم والاستشارة والخروج', period: 'date and time of admission (dd-mm-yyyy hh:mm)' },
  { title: /^opd manual kpi report$/i, name: 'مؤشرات العيادات الخارجية', unit: 'موعد', description: 'الحضور والغياب والجديد والمتابعة وأوقات الانتظار', period: "today's date (dd-mm-yyyy)" },
  { title: /^physician productivity manual kpi report$/i, name: 'إنتاجية الأطباء', unit: 'طبيب', description: 'مؤشرات إنتاجية مجمعة لكل طبيب', aggregate: true },
  { title: /^physician wise sick leave request$/i, name: 'الإجازات المرضية', unit: 'إجازة', description: 'طلبات الإجازات المرضية لكل طبيب', period: 'visit date' },
  { title: /^er patient journey report$/i, name: 'رحلة مريض الطوارئ (الفرز CTAS)', unit: 'زيارة طوارئ', description: 'زيارات الطوارئ مع مستوى الفرز CTAS وأوقات الرحلة', period: 'visit date time' },
  { title: /^all bill list$/i, name: 'الفواتير', unit: 'فاتورة', description: 'الفواتير والمبالغ وجهة الدفع', period: 'bill date' },
  { title: /^deceased patient list$/i, name: 'الوفيات', unit: 'حالة وفاة', description: 'حالات الوفاة وأسبابها', period: 'death date time' },
  { title: /^unplanned revisit in emergency within 72hrs$/i, name: 'عودة الطوارئ خلال 72 ساعة', unit: 'عودة', description: 'العودة غير المخطط لها إلى الطوارئ خلال 72 ساعة', period: 'visit date' },
  { title: /^top 10 diagnosis report$/i, name: 'أعلى 10 تشخيصات', unit: 'تشخيص', description: 'أعلى عشرة تشخيصات لكل فترة (مجمعة)', aggregate: true },
  { title: /pulmo triage census/i, name: '', unit: '', description: '', skip: 'ملف بلا بيانات (عناوين فقط)' },
  { title: /road traffic accident/i, name: '', unit: '', description: '', skip: 'ملف بلا بيانات (عناوين فقط)' },
  { title: /diagnosis wise opip count/i, name: '', unit: '', description: '', skip: 'ملف بلا بيانات (عناوين فقط)' },
  { title: /cssd tray utilization/i, name: '', unit: '', description: '', skip: 'ملف بلا بيانات (عناوين فقط)' },
];
