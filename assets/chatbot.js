(function () {
  "use strict";
  if (document.querySelector(".basma-chat")) return;

  var copy = {
    ar: {
      dir: "rtl", title: "مساعد بصمة الذكي", status: "متصل لمساعدتك",
      welcome: "مرحبًا بك 👋 أنا مساعد بصمة الذكي، كيف يمكنني مساعدتك؟",
      placeholder: "اكتب رسالتك...", send: "إرسال", open: "فتح المحادثة", close: "إغلاق",
      typing: "يكتب الآن...", error: "تعذر الاتصال حاليًا. يمكنك مراسلتنا مباشرة عبر واتساب.",
      whatsapp: "تواصل عبر واتساب", long: "الرسالة طويلة جدًا. الحد الأقصى 800 حرف.",
      wait: "يرجى الانتظار قليلًا قبل إرسال رسالة أخرى."
    },
    en: {
      dir: "ltr", title: "Basma AI Assistant", status: "Online to help",
      welcome: "Welcome 👋 I’m Basma’s AI assistant. How can I help you?",
      placeholder: "Type your message...", send: "Send", open: "Open chat", close: "Close",
      typing: "Typing...", error: "We cannot connect right now. You can contact us directly on WhatsApp.",
      whatsapp: "Contact via WhatsApp", long: "Your message is too long. Maximum 800 characters.",
      wait: "Please wait a moment before sending another message."
    },
    es: {
      dir: "ltr", title: "Asistente IA de Basma", status: "En línea para ayudarte",
      welcome: "Bienvenido 👋 Soy el asistente inteligente de Basma. ¿Cómo puedo ayudarte?",
      placeholder: "Escribe tu mensaje...", send: "Enviar", open: "Abrir chat", close: "Cerrar",
      typing: "Escribiendo...", error: "No podemos conectar ahora. Puedes contactarnos directamente por WhatsApp.",
      whatsapp: "Contactar por WhatsApp", long: "El mensaje es demasiado largo. Máximo 800 caracteres.",
      wait: "Espera un momento antes de enviar otro mensaje."
    }
  };

  function currentLanguage() {
    var lang = (localStorage.getItem("basma_lang") || document.documentElement.lang || "ar").slice(0, 2);
    return copy[lang] ? lang : "ar";
  }

  var lang = currentLanguage();
  var t = copy[lang];
  var history = [];
  var busy = false;
  var lastSentAt = 0;

  var root = document.createElement("div");
  root.className = "basma-chat";
  root.dir = t.dir;
  root.innerHTML =
    '<section class="basma-chat__window" role="dialog" aria-modal="false" aria-label="' + t.title + '">' +
      '<header class="basma-chat__header"><div class="basma-chat__identity"><span class="basma-chat__avatar">ب</span><div><h2 class="basma-chat__title">' + t.title + '</h2><p class="basma-chat__status">' + t.status + '</p></div></div><button class="basma-chat__close" type="button" aria-label="' + t.close + '">×</button></header>' +
      '<div class="basma-chat__messages" aria-live="polite"></div>' +
      '<form class="basma-chat__form"><input class="basma-chat__input" maxlength="800" autocomplete="off" placeholder="' + t.placeholder + '" aria-label="' + t.placeholder + '"><button class="basma-chat__send" type="submit" aria-label="' + t.send + '">←</button></form>' +
    '</section>' +
    '<button class="basma-chat__toggle" type="button" aria-label="' + t.open + '" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H6l-3 2 1-5a8.5 8.5 0 1 1 17-5z"></path><path d="M8 12h.01M12 12h.01M16 12h.01"></path></svg></button>';
  document.body.appendChild(root);

  var toggle = root.querySelector(".basma-chat__toggle");
  var close = root.querySelector(".basma-chat__close");
  var form = root.querySelector(".basma-chat__form");
  var input = root.querySelector(".basma-chat__input");
  var send = root.querySelector(".basma-chat__send");
  var messages = root.querySelector(".basma-chat__messages");

  function addMessage(text, type, whatsapp) {
    var item = document.createElement("div");
    item.className = "basma-chat__message basma-chat__message--" + type;
    item.textContent = text;
    if (whatsapp) {
      var link = document.createElement("a");
      link.className = "basma-chat__whatsapp";
      link.href = "https://wa.me/970592608998";
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = t.whatsapp + " ←";
      item.appendChild(document.createElement("br"));
      item.appendChild(link);
    }
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
    return item;
  }

  addMessage(t.welcome, "bot", false);

  function setOpen(open) {
    root.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) setTimeout(function () { input.focus(); }, 60);
  }
  toggle.addEventListener("click", function () { setOpen(!root.classList.contains("is-open")); });
  close.addEventListener("click", function () { setOpen(false); });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var message = input.value.trim();
    if (!message || busy) return;
    if (message.length > 800) return addMessage(t.long, "error", false);
    if (Date.now() - lastSentAt < 1200) return addMessage(t.wait, "error", false);

    lastSentAt = Date.now();
    busy = true;
    send.disabled = true;
    addMessage(message, "user", false);
    input.value = "";
    var typing = addMessage(t.typing, "bot typing", false);

    try {
      var response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message, history: history.slice(-8) })
      });
      var data = await response.json().catch(function () { return {}; });
      typing.remove();
      if (!response.ok || !data.reply) throw new Error(data.error || "Request failed");
      addMessage(data.reply, "bot", false);
      history.push({ role: "user", content: message }, { role: "assistant", content: data.reply });
      history = history.slice(-8);
    } catch (error) {
      typing.remove();
      addMessage(t.error, "error", true);
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
    }
  });
})();
