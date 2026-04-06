# CloudCDN — دليل الإعداد

## المتطلبات الأساسية
- Git (يوصى بـ 2.34+)
- مفتاح SSH للالتزامات الموقعة (يوصى بـ Ed25519)
- حساب GitHub مع وصول إلى المستودع

## بداية سريعة (جميع المنصات)

### 1. استنسخ المستودع
```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cd cloudcdn.pro
```

### 2. أنشئ دليل مشروعك
```bash
mkdir -p my-project/images/{banners,icons,logos}
```

### 3. أضف أصولك
ضع ملفات PNG أو SVG أو WebP في الدليل الفرعي المناسب:
```bash
cp ~/Downloads/logo.png my-project/images/logos/
cp ~/Downloads/banner.png my-project/images/banners/
```

### 4. الالتزام والدفع
```bash
git add my-project/
git commit -S -m "add my-project assets"
git push origin main
```

### 5. الوصول إلى أصولك
أصبحت ملفاتك متاحة الآن على:
```
https://cloudcdn.pro/my-project/images/logos/logo.png
https://cloudcdn.pro/my-project/images/logos/logo.webp  (مولّد تلقائيًا)
https://cloudcdn.pro/my-project/images/logos/logo.avif  (مولّد تلقائيًا)
```

## ملاحظات خاصة بالمنصة

### macOS
ثبّت Git عبر Homebrew إذا لم يكن موجودًا بالفعل:
```bash
brew install git
```

أنشئ مفتاح توقيع SSH:
```bash
ssh-keygen -t ed25519 -C "your@email.com"
```

اضبط Git للالتزامات الموقعة:
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "your@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Linux (Arch/CachyOS)
```bash
sudo pacman -S git openssh
ssh-keygen -t ed25519 -C "your@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### WSL2 (Windows Subsystem for Linux)
افتح طرفية WSL2 الخاصة بك (يوصى بـ Ubuntu):
```bash
sudo apt update && sudo apt install git
ssh-keygen -t ed25519 -C "your@email.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

أضف مفتاح SSH الخاص بك إلى ssh-agent:
```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

## اصطلاح الأدلة
اتبع هذه البنية للاتساق:
```
my-project/
  images/
    banners/       # رسومات بتنسيق عريض (يوصى بـ 1200x630)
    icons/         # أيقونات متعددة الدقة (من 16x16 إلى 512x512)
    logos/          # شعارات وعلامات العلامة التجارية
    github/        # أصول خاصة بـ GitHub (معاينة اجتماعية، إلخ)
    titles/        # رسومات العناوين والرؤوس
  README.md        # وصف اختياري للمشروع
```

## تحسين الصور التلقائي
عند دفع ملفات PNG أو JPEG، يقوم خط أنابيب CI/CD تلقائيًا بـ:
1. توليد متغير WebP (جودة 80) — أصغر بنحو 60%
2. توليد متغير AVIF (جودة 65) — أصغر بنحو 70%
3. تحديث بيان الأصول (`manifest.json`)
4. نشر جميع المتغيرات على شبكة الحافة العالمية

لا تحتاج إلى إنشاء ملفات WebP أو AVIF يدويًا.

## استخدام عناوين URL لـ CDN في مشاريعك

### HTML
```html
<picture>
  <source srcset="https://cloudcdn.pro/my-project/images/logos/logo.avif" type="image/avif">
  <source srcset="https://cloudcdn.pro/my-project/images/logos/logo.webp" type="image/webp">
  <img src="https://cloudcdn.pro/my-project/images/logos/logo.png" alt="Logo">
</picture>
```

### Markdown
```markdown
![Logo](https://cloudcdn.pro/my-project/images/logos/logo.webp)
```

### CSS
```css
.hero {
  background-image: url('https://cloudcdn.pro/my-project/images/banners/hero.webp');
}
```
