# إعداد بوت بصمة الذكي باستخدام Gemini

## التشغيل المحلي

1. ثبّت Node.js 20 أو أحدث.
2. انسخ `.env.example` إلى `.env.local`.
3. أنشئ مفتاح Gemini API من Google AI Studio، ثم ضعه داخل `.env.local`:

```env
GEMINI_API_KEY=ضع_المفتاح_هنا
GEMINI_MODEL=gemini-2.5-flash-lite
```

4. لا ترفع `.env.local` إلى GitHub أو الاستضافة كملف.
5. نفّذ:

```bash
npm install
npm run dev
```

سيفتح الموقع عادة على `http://localhost:3000`.

## النشر على Vercel

1. ارفع المشروع إلى GitHub أو استورده مباشرة في Vercel.
2. من إعدادات المشروع في Vercel افتح **Environment Variables**.
3. أضف `GEMINI_API_KEY` كمتغير سري.
4. أضف اختياريًا `GEMINI_MODEL` بالقيمة `gemini-2.5-flash-lite`.
5. أعد النشر.

المفتاح يُستخدم فقط داخل `api/chat.js` ويرسل إلى Gemini في ترويسة
`x-goog-api-key`، ولا يصل إلى JavaScript الخاص بالمتصفح أو إلى رابط الطلب.

## الاستضافات التقليدية

رفع ملفات HTML وحدها إلى `public_html` لا يكفي لتشغيل الذكاء الاصطناعي؛ يجب أن تدعم الاستضافة Node.js أو Serverless Functions. إن كانت الاستضافة cPanel ثابتة فقط، انشر الواجهة والوظيفة على Vercel أو اطلب من مزود الاستضافة تفعيل Node.js، ثم اضبط مسار `/api/chat`.
