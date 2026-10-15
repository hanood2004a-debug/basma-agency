-- ============================================================================
-- Basma CRM — Default Outreach Templates (v1.6.3)
-- ============================================================================
-- Seeds the 10 standard outreach templates (Email/LinkedIn/WhatsApp) into
-- crm_outreach_templates so every fresh Basma CRM install has professional,
-- ready-to-use templates without anyone having to type them in by hand.
--
-- Idempotent: matches on (type, name) and only inserts rows that don't
-- already exist, so this file is safe to re-run any number of times and
-- will never duplicate a template or overwrite one an admin has since
-- edited or renamed. Does not modify CRM-OUTREACH-HUB.sql or any other
-- existing migration. Purely additive data — no schema changes.
--
-- Run this once, in full, in the Supabase SQL editor, after CRM-SETUP.sql
-- and CRM-OUTREACH-HUB.sql.
-- ============================================================================

do $$
begin
  if to_regclass('public.crm_outreach_templates') is null then
    raise exception 'crm_outreach_templates not found — run CRM-OUTREACH-HUB.sql first.';
  end if;
end $$;

insert into public.crm_outreach_templates (type, name, subject, body)
select v.type, v.name, v.subject, v.body
from (
  values

  -- 1. First Contact Email --------------------------------------------------
  (
    'email',
    'التواصل الأول (First Contact Email)',
    'تعاون رقمي محتمل بين Basma و{{company_name}}',
    $b$مرحبًا {{contact_name}}،

اطّلعنا على {{company_name}} في مجال {{industry}} في {{city}}، {{country}}، وأعجبنا فعلًا بما تقدمونه من خلال {{website}}.

نحن في Basma متخصصون في تصميم وتطوير الحلول الرقمية (مواقع، تطبيقات، وهوية رقمية متكاملة) التي تساعد شركات مثل شركتكم على النمو والوصول إلى عملاء أكثر.

هل يمكننا تحديد وقت قصير (15 دقيقة) للتعرف أكثر على احتياجاتكم الرقمية ومشاركة بعض الأفكار التي قد تفيدكم؟

بانتظار ردكم.

مع خالص التقدير،
{{sender_name}}
Basma$b$
  ),

  -- 2. Follow-up #1 -----------------------------------------------------------
  (
    'email',
    'متابعة أولى (Follow-up #1)',
    'متابعة: تعاون رقمي محتمل مع {{company_name}}',
    $b$مرحبًا {{contact_name}}،

أتابع معكم بخصوص رسالتي السابقة حول الفرص الرقمية المتاحة لـ {{company_name}}.

أدرك أن جدولكم قد يكون مزدحمًا، لذا أحببت التذكير بأننا في Basma جاهزون لمساعدتكم في تطوير حضوركم الرقمي بما يتناسب مع قطاع {{industry}}.

يسعدني ترتيب مكالمة قصيرة في الوقت الذي يناسبكم هذا الأسبوع أو الأسبوع القادم.

تحياتي،
{{sender_name}}
Basma$b$
  ),

  -- 3. Follow-up #2 -----------------------------------------------------------
  (
    'email',
    'متابعة ثانية (Follow-up #2)',
    'هل ما زلتم مهتمين بتطوير الحضور الرقمي لـ {{company_name}}؟',
    $b$مرحبًا {{contact_name}}،

لم أسمع منكم منذ رسالتي الأخيرة، وأتفهّم تمامًا انشغالكم.

أردت فقط التأكد من وصول رسالتي، ومعرفة إن كان هناك اهتمام حاليًا أو مستقبلًا بمناقشة كيف يمكن لـ Basma دعم {{company_name}} رقميًا.

إن لم يكن الوقت مناسبًا الآن، يسعدنا التواصل لاحقًا في الوقت الذي يناسبكم أكثر.

مع التقدير،
{{sender_name}}
Basma$b$
  ),

  -- 4. Partnership Proposal -----------------------------------------------
  (
    'email',
    'عرض شراكة (Partnership Proposal)',
    'اقتراح شراكة بين Basma و{{company_name}}',
    $b$مرحبًا {{contact_name}}،

بناءً على ما لمسناه من تميّز {{company_name}} في قطاع {{industry}} بمدينة {{city}}، نرى فرصة حقيقية لشراكة استراتيجية بين فريقينا.

يمكن لـ Basma أن تكون الشريك التقني/الرقمي الذي يدعم {{company_name}} في تطوير المنتجات الرقمية، التسويق الإلكتروني، أو تحسين تجربة العملاء عبر {{website}}.

هل تودّون تحديد اجتماع لمناقشة تفاصيل هذه الشراكة المحتملة وكيف يمكن أن تخدم أهداف الطرفين؟

مع التقدير،
{{sender_name}}
Basma$b$
  ),

  -- 5. Meeting Request ----------------------------------------------------
  (
    'email',
    'طلب اجتماع (Meeting Request)',
    'طلب تحديد اجتماع مع {{company_name}}',
    $b$مرحبًا {{contact_name}}،

نودّ ترتيب اجتماع قصير (20-30 دقيقة) مع فريق {{company_name}} لمناقشة كيف يمكن لـ Basma دعم أهدافكم الرقمية في {{country}}.

هل يناسبكم أحد الأوقات هذا الأسبوع؟ يمكنكم أيضًا اقتراح موعد يناسبكم بشكل أفضل.

بانتظار تأكيدكم.

تحياتي،
{{sender_name}}
Basma$b$
  ),

  -- 6. Thank You ------------------------------------------------------------
  (
    'email',
    'شكر وتقدير (Thank You)',
    'شكرًا لوقتكم، {{contact_name}}',
    $b$مرحبًا {{contact_name}}،

أشكركم على وقتكم واهتمامكم بمناقشة التعاون مع Basma. كان من دواعي سرورنا التعرّف أكثر على {{company_name}} وأهدافكم في قطاع {{industry}}.

سنوافيكم بالخطوات التالية قريبًا، ولا تترددوا بالتواصل معنا في أي وقت إن كان لديكم أي استفسار.

مع خالص الشكر والتقدير،
{{sender_name}}
Basma$b$
  ),

  -- 7. LinkedIn Connection --------------------------------------------------
  (
    'linkedin',
    'طلب تواصل LinkedIn (LinkedIn Connection)',
    null,
    $b$مرحبًا {{first_name}}،

أعمل في Basma، ونتابع باهتمام ما تقومون به في {{company_name}} ضمن قطاع {{industry}}. يسعدني التواصل معكم هنا على LinkedIn لتبادل الأفكار حول الفرص الرقمية المتاحة.

تحياتي،
{{sender_name}}$b$
  ),

  -- 8. LinkedIn Follow-up -----------------------------------------------------
  (
    'linkedin',
    'متابعة LinkedIn (LinkedIn Follow-up)',
    null,
    $b$مرحبًا {{first_name}}،

شكرًا لقبول طلب التواصل! أردت المتابعة لمعرفة إن كان لديكم اهتمام بمناقشة كيف يمكن لـ Basma دعم {{company_name}} رقميًا، سواء عبر تطوير موقع/تطبيق أو تحسين الحضور الرقمي.

يسعدني تحديد وقت مناسب لمكالمة قصيرة إن أحببتم.

تحياتي،
{{sender_name}}$b$
  ),

  -- 9. WhatsApp First Message ------------------------------------------------
  (
    'whatsapp',
    'رسالة واتساب أولى (WhatsApp First Message)',
    null,
    $b$مرحبًا {{contact_name}} 👋
أنا {{sender_name}} من Basma. اطّلعنا على {{company_name}} في {{city}} وأعجبنا بما تقدمونه ضمن قطاع {{industry}}.
نودّ مشاركتكم بعض الأفكار حول تطوير حضوركم الرقمي — هل يناسبكم التواصل بخصوص هذا الموضوع؟$b$
  ),

  -- 10. WhatsApp Follow-up -----------------------------------------------
  (
    'whatsapp',
    'متابعة واتساب (WhatsApp Follow-up)',
    null,
    $b$مرحبًا {{contact_name}} 👋
أتابع معكم بخصوص رسالتنا السابقة حول الفرص الرقمية لـ {{company_name}}.
هل لديكم بضع دقائق هذا الأسبوع لمكالمة قصيرة؟ يسعدنا مشاركة تفاصيل أكثر.
مع التحية، {{sender_name}} — Basma$b$
  )

) as v(type, name, subject, body)
where not exists (
  select 1 from public.crm_outreach_templates t
  where t.type = v.type and t.name = v.name
);

-- ============================================================================
-- Done. Idempotent — safe to run this file again (e.g. after restoring a
-- database, or on a second environment) without creating duplicates.
-- ============================================================================
