export default function GraphicCoursePage() {
  return (
    <div dir="rtl" className="min-h-screen text-white flex items-center justify-center p-4" style={{ background: 'radial-gradient(circle at top, #0b1d3a, #050b18)', fontFamily: 'Cairo, sans-serif' }}>
      <div className="max-w-2xl w-full bg-[#0b1736]/95 border border-cyan-500/30 rounded-3xl shadow-2xl p-6 md:p-10 backdrop-blur-md">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-block bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-950 font-extrabold px-5 py-1.5 rounded-full text-sm shadow-md mb-3">
            بصمة للحلول الرقمية 💡
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-2">دورة التصميم الجرافيكي الشاملة</h1>
          <p className="text-cyan-400 font-bold text-lg">بإشراف المدربة المبدعة: م. سجود أبو عواد</p>
          <p className="text-sm text-gray-300 mt-2">انتقل من الصفر إلى الاحتراف وابدأ بناء معرض أعمالك الخاص!</p>
        </div>

        {/* Teaser Price & Payment Methods Box */}
        <div className="bg-gradient-to-r from-blue-950/80 to-indigo-950/80 border border-amber-500/40 rounded-2xl p-5 mb-8 text-center shadow-inner">
          <div className="text-amber-400 font-extrabold text-xl mb-1">🎁 مفاجأة السعر الاستثنائي والتشويقي!</div>
          <p className="text-sm text-gray-200 mb-3">سعر مغري جداً ومناسب لكل الطلاب 🤫 (سيتم الكشف عن الخصومات الكبرى يوم السبت القادم)</p>
          
          <div className="border-t border-blue-900/60 pt-3 mt-3">
            <span className="text-xs text-cyan-300 font-semibold block mb-2">طرق الدفع المتاحة لتأكيد مقعدك لاحقاً:</span>
            <div className="flex justify-center gap-4">
              <span className="bg-[#11224d] border border-cyan-500/40 text-cyan-300 px-4 py-1.5 rounded-xl text-xs font-bold shadow">💳 PalPay (بال باي)</span>
              <span className="bg-[#11224d] border border-cyan-500/40 text-cyan-300 px-4 py-1.5 rounded-xl text-xs font-bold shadow">📱 Jawwal Pay (جوال باي)</span>
            </div>
          </div>
        </div>

        {/* Social Gate Section */}
        <div className="bg-slate-900/80 border border-cyan-500/30 rounded-2xl p-5 mb-8">
          <h3 className="text-sm font-bold text-amber-400 mb-3 text-center">✨ شروط تفعيل التسجيل (متابعة منصات بصمة والمؤسس):</h3>
          <div className="space-y-3">
            <a href="https://www.youtube.com/@ahme_sh7" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between bg-[#11224d] hover:bg-blue-900 border border-blue-800 p-3 rounded-xl transition text-sm font-semibold">
              <span>📺 اشترك في قناة اليوتيوب (أحمد شوقي)</span>
              <span className="text-xs bg-amber-500 text-slate-950 px-2.5 py-1 rounded-lg font-bold">اضغط للمتابعة</span>
            </a>

            <a href="https://whatsapp.com" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between bg-[#11224d] hover:bg-blue-900 border border-blue-800 p-3 rounded-xl transition text-sm font-semibold">
              <span>💬 انضم إلى قناة الواتساب الرسمية</span>
              <span className="text-xs bg-amber-500 text-slate-950 px-2.5 py-1 rounded-lg font-bold">اضغط للمتابعة</span>
            </a>

            <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between bg-[#11224d] hover:bg-blue-900 border border-blue-800 p-3 rounded-xl transition text-sm font-semibold">
              <span>📸 تابع حساب الإنستغرام لوكالة بصمة</span>
              <span className="text-xs bg-amber-500 text-slate-950 px-2.5 py-1 rounded-lg font-bold">اضغط للمتابعة</span>
            </a>
          </div>
        </div>

        {/* Registration Form */}
        <form onSubmit={(e) => {
          e.preventDefault();
          let name = document.getElementById('fullName').value;
          let email = document.getElementById('email').value;
          let wa = document.getElementById('whatsapp').value;
          let level = document.getElementById('level').value;
          let targetNumber = "970590000000"; 
          let message = `مرحباً بصمة للحلول الرقمية، أرغب بالتسجيل في دورة التصميم الجرافيكي الشاملة مع م. سجود أبو عواد.%0A%0A` +
                        `👤 الاسم: ${name}%0A` +
                        `📧 البريد: ${email}%0A` +
                        `📱 الواتساب: ${wa}%0A` +
                        `📊 المستوى: ${level}%0A%0A` +
                        `بانتظار تفاصيل السعر الاستثنائي والخصومات وطريقة الدفع (PalPay / Jawwal Pay).`;
          window.open(`https://wa.me/${targetNumber}?text=${message}`, '_blank');
        }} className="space-y-4">

          <div>
            <label className="block text-sm font-semibold mb-1">الاسم الثلاثي (للشهادة) *</label>
            <input type="text" id="fullName" required placeholder="أدخل اسمك الكامل" className="w-full p-3 rounded-xl bg-[#11224d] border border-blue-800 focus:border-amber-400 focus:outline-none text-white" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1">البريد الإلكتروني *</label>
              <input type="email" id="email" required placeholder="name@example.com" className="w-full p-3 rounded-xl bg-[#11224d] border border-blue-800 focus:border-amber-400 focus:outline-none text-white" />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">رقم الواتساب (مع رمز الدولة) *</label>
              <input type="tel" id="whatsapp" required placeholder="+97059XXXXXXX" className="w-full p-3 rounded-xl bg-[#11224d] border border-blue-800 focus:border-amber-400 focus:outline-none text-white" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">مستواك الحالي في التصميم *</label>
            <select id="level" required className="w-full p-3 rounded-xl bg-[#11224d] border border-blue-800 focus:border-amber-400 focus:outline-none text-white">
              <option value="">اختر مستواك...</option>
              <option value="مبتدئ تماماً (من الصفر)">مبتدئ تماماً (من الصفر)</option>
              <option value="أعرف الأساسيات أو أستخدم Canva">أعرف الأساسيات أو أستخدم Canva</option>
              <option value="لدي خبرة وأريد الاحتراف">لدي خبرة وأريد الاحتراف</option>
            </select>
          </div>

          <button type="submit" className="w-full bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 font-extrabold py-3.5 rounded-xl transition shadow-xl text-lg mt-4">
            إرسال تفاصيل التسجيل عبر الواتساب 🚀
          </button>
        </form>

      </div>
    </div>
  );
}