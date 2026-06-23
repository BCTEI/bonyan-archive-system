# تعليمات معالجة مشاكل تسجيل الدخول / Login debugging guide

## بيانات الدخول الافتراضية

- **اسم المستخدم:** `admin`
- **كلمة المرور:** `admin123`

## فحص سريع

1. شغّل البناء:
   ```bash
   bun run build:prod
   ```

2. شغّل Electron:
   ```bash
   bun run start
   ```

3. افتح أدوات المطوّر داخل النافذة: `Ctrl+Shift+I` (Linux/Windows).

4. افتح تبويبة **Console** وابحث عن:
   - `[Preload] Received login request for: admin`
   - `[Main] Handling auth:login for: admin`
   - `[Auth Service] Login result:`

## رسائل الخطأ الشائعة ومعناها

| الرسالة | السبب | الحل |
|---|---|---|
| `فشل تسجيل الدخول` | اسم المستخدم أو كلمة المرور غير صحيحة | استخدم `admin` / `admin123` |
| `انتهت مهلة الاتصال` | لم يتم الرد من العملية الرئيسية خلال 5 ثوانٍ | أعد تشغيل التطبيق، تحقق من سلامة قاعدة البيانات |
| `خطأ في الاتصال بالنظام` | خطأ غير متوقع في `main.ts` | راجع سجلّ console في DevTools |
| `خطأ غير متوقع أثناء تسجيل الدخول` | استثناء في Angular | راجع console |

## تصحيح الـ SQLite

### معرفة مسار قاعدة البيانات

في DevTools Console نفّذ:

```js
await window.electronAPI.getDbPath?.();
```

> ملاحظة: يجب أن تكون الدالة `getDbPath` مضافة في `preload.ts`.

### فحص المستخدمين

افتح ملف `archive.db` باستخدام أي أداة SQLite أو من الطرفية:

```bash
sqlite3 "$HOME/.config/Bonyan\ Archive\ System/archive.db" "SELECT * FROM users;"
```

### إعادة ضبط كلمة المرور

```bash
sqlite3 "$HOME/.config/Bonyan\ Archive\ System/archive.db" "DELETE FROM users WHERE username='admin';"
```

عند تشغيل التطبيق بعد ذلك سيُنشئ الحساب الافتراضي `admin` / `admin123`.

## تمكين سجلات أكثر تفصيلاً

في `electron/main.ts`:

```ts
const DEBUG = true;
```

وسيظهر في console:

- `Better-sqlite3 loaded successfully`
- `Database path: ...`
- `Admin user seeded: admin`

## التشغيل بدون SQLite (وضع احتياطي)

إذا فشل تحميل `better-sqlite3`، يعمل التطبيق تلقائيًا في وضع الذاكرة المؤقتة
وسجّل الدخول بـ `admin` / `admin123` سيعمل.

## فحص بيئة التشغيل

```bash
node --version    # يفضل 20+
bun --version     # يفضل 1.1+
electron --version
ls -la dist       # يجب أن تحتوي على app/main.js و app/preload.js
ls -la dist/bonyan-archive-system/browser  # ملفات Angular
```

## مسح البيانات وإعادة المحاولة

```bash
rm -rf "$HOME/.config/Bonyan\ Archive\ System"
bun run build:prod
bun run start
```

## الحد الأدنى للاختبار

استخدم الحساب التالي للتأكد من سلامة النظام:

```
Username: admin
Password: admin123
```
