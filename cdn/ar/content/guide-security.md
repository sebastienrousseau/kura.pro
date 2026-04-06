# CloudCDN — دليل الأمان

## نظرة عامة
يفرض CloudCDN الالتزامات الموقعة على جميع عمليات الدفع إلى الفرع main. يضمن هذا أن يتم التحقق من كل تغيير في الأصل تشفيريًا ويمكن تتبعه إلى مساهم محدد.

## لماذا الالتزامات الموقعة؟
- **النزاهة:** تضمن أن الأصول لم يتم العبث بها أثناء النقل.
- **مسار التدقيق:** كل تغيير مرتبط بهوية تم التحقق منها.
- **أمان سلسلة التوريد:** يمنع التعديلات غير المصرح بها على المحتوى المقدم بواسطة CDN.
- **الامتثال:** يلبي متطلبات الأمان المؤسسية لمصدر الأصول.

## إعداد مفتاح SSH (موصى به)

### إنشاء مفتاح Ed25519
```bash
ssh-keygen -t ed25519 -C "your@email.com" -f ~/.ssh/id_ed25519
```

لمفاتيح الأمان الصلبة (YubiKey، إلخ):
```bash
ssh-keygen -t ed25519-sk -C "your@email.com"
```

### تكوين Git
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### إضافة المفتاح إلى GitHub
1. انسخ مفتاحك العام: `cat ~/.ssh/id_ed25519.pub`
2. انتقل إلى GitHub → Settings → SSH and GPG keys → New SSH key
3. اختر **Signing Key** كنوع المفتاح
4. الصق واحفظ

### التحقق
```bash
echo "test" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n git
```

## إعداد مفتاح GPG (بديل)

### إنشاء مفتاح GPG
```bash
gpg --full-generate-key
```
اختر RSA 4096 بت، عيّن انتهاء الصلاحية، وأدخل بريدك الإلكتروني.

### تكوين Git
```bash
gpg --list-secret-keys --keyid-format=long
# انسخ معرف المفتاح (على سبيل المثال، 3AA5C34371567BD2)
git config --global user.signingkey 3AA5C34371567BD2
git config --global commit.gpgsign true
```

### إضافة المفتاح إلى GitHub
```bash
gpg --armor --export 3AA5C34371567BD2
```
انسخ الإخراج وأضفه في GitHub → Settings → SSH and GPG keys → New GPG key.

## حماية الفرع
الفرع main محمي بالقواعد التالية:
- **الالتزامات الموقعة مطلوبة:** يجب توقيع جميع الالتزامات تشفيريًا.
- **لا توجد عمليات دفع قسرية:** لا يمكن إعادة كتابة السجل.
- **لا حذف للفرع:** لا يمكن حذف الفرع main.

## أمان رموز API
لسير عمل CI/CD، يتم تخزين رموز API كأسرار GitHub:
- `CLOUDFLARE_API_TOKEN` — يُستخدم لنشر Cloudflare Pages.
- `CLOUDFLARE_ACCOUNT_ID` — معرف حساب Cloudflare الخاص بك.

لا تلتزم أبدًا برموز API أو الأسرار أو بيانات الاعتماد في المستودع. استخدم GitHub Secrets لجميع القيم الحساسة.

## أفضل ممارسات الأمان
1. استخدم مفاتيح الأمان الصلبة (Ed25519-SK) عند الإمكان.
2. قم بتدوير رموز API كل ربع سنة.
3. راجع سجل تدقيق GitHub للوصول غير المتوقع.
4. قم بتمكين المصادقة الثنائية على حساب GitHub الخاص بك.
5. استخدم الأمر `git log --show-signature` للتحقق من توقيعات الالتزام.
