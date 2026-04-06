# CloudCDN — مرجع واجهة برمجة التطبيقات

## عنوان URL الأساسي
```
https://cloudcdn.pro
```

## تنسيق عنوان URL للأصول
```
https://cloudcdn.pro/{المشروع}/images/{الفئة}/{اسم-الملف}.{التنسيق}
```

مثال:
```
https://cloudcdn.pro/akande/images/banners/banner-akande.webp
```

## واجهة برمجة تحويل الصور (خطة Pro وما فوق)

أضف معاملات استعلام إلى أي عنوان URL لأصل لتحويل الصورة فورًا.

### تغيير الحجم
| المعامل | النوع | الوصف | مثال |
|---------|------|-------|------|
| `w` | عدد صحيح | العرض بالبكسل (1-8192) | `?w=800` |
| `h` | عدد صحيح | الارتفاع بالبكسل (1-8192) | `?h=600` |
| `fit` | سلسلة | سلوك تغيير الحجم | `?fit=cover` |

**أوضاع `fit`:**
- `cover` — تغيير الحجم لملء الأبعاد، مع اقتصاص الزيادة (افتراضي)
- `contain` — تغيير الحجم للملاءمة مع الحفاظ على نسب العرض إلى الارتفاع
- `fill` — تمديد إلى الأبعاد الدقيقة (تجاهل النسب)
- `inside` — تغيير الحجم للملاءمة، دون تكبير أبدًا
- `outside` — تغيير الحجم للتغطية، دون تصغير أبدًا

### تحويل التنسيق
| المعامل | النوع | الوصف | مثال |
|---------|------|-------|------|
| `format` | سلسلة | تنسيق الإخراج | `?format=auto` |
| `q` | عدد صحيح | الجودة (1-100) | `?q=80` |

**قيم `format`:**
- `auto` — يقدم AVIF أو WebP أو الأصل بناءً على رأس `Accept` الخاص بالمتصفح
- `webp` — فرض إخراج WebP
- `avif` — فرض إخراج AVIF
- `png` — فرض إخراج PNG
- `jpeg` — فرض إخراج JPEG

### التأثيرات
| المعامل | النوع | الوصف | مثال |
|---------|------|-------|------|
| `blur` | عدد صحيح | تمويه غاوسي (1-250) | `?blur=20` |
| `sharpen` | عدد صحيح | حدة (1-10) | `?sharpen=3` |
| `gravity` | سلسلة | نقطة ارتكاز الاقتصاص | `?gravity=face` |

**قيم `gravity`:** `center`، `north`، `south`، `east`، `west`، `northeast`، `northwest`، `southeast`، `southwest`، `face` (مكتشف بالذكاء الاصطناعي).

### تسلسل المعاملات
ادمج معاملات متعددة باستخدام `&`:
```
https://cloudcdn.pro/المشروع/image.png?w=400&h=300&fit=cover&format=auto&q=75&sharpen=2
```

### LQIP (عنصر نائب لصورة منخفضة الجودة)
يُولّد عنصرًا نائبًا صغيرًا مموّهًا للتحميل التدريجي:
```
https://cloudcdn.pro/المشروع/image.png?w=40&blur=50&q=20
```
يُنتج هذا عنصرًا نائبًا بحجم 500 بايت تقريبًا يمكن تضمينه كـ data URI بتنسيق base64.

## بيان الأصول

### GET /manifest.json
يُرجع مصفوفة JSON لجميع الأصول في الـ CDN.

**الاستجابة:**
```json
[
  {
    "name": "banner-akande.webp",
    "path": "akande/images/banners/banner-akande.webp",
    "project": "akande",
    "category": "banners",
    "format": "webp",
    "size": 10850
  }
]
```

**الحقول:**
| الحقل | النوع | الوصف |
|-------|------|-------|
| `name` | سلسلة | اسم الملف |
| `path` | سلسلة | المسار الكامل بالنسبة لجذر الـ CDN |
| `project` | سلسلة | اسم دليل المشروع |
| `category` | سلسلة | فئة الدليل الفرعي (banners، icons، logos، إلخ) |
| `format` | سلسلة | امتداد الملف (png، webp، avif، svg، ico) |
| `size` | عدد صحيح | حجم الملف بالبايت |

**التخزين المؤقت:** `max-age=300` (5 دقائق)، CORS مُفعّل.

## رؤوس HTTP

### استجابات الأصول
```
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
Content-Type: image/webp
```

### استجابات الأخطاء
| الحالة | المعنى |
|--------|--------|
| `200` | نجاح |
| `304` | لم يتم التعديل (طلب شرطي) |
| `404` | الأصل غير موجود |
| `429` | تم تجاوز حد المعدل (واجهة Concierge فقط) |

## مسح ذاكرة التخزين المؤقت (Pro وما فوق)

### عبر لوحة تحكم Cloudflare
Workers & Pages → cloudcdn-pro → Caching → Purge by URL.

### عبر واجهة API
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"files":["https://cloudcdn.pro/المشروع/image.webp"]}'
```

## حدود المعدل
| نقطة النهاية | الحد |
|--------------|------|
| تسليم الأصول | غير محدود (حافة Cloudflare) |
| Manifest.json | غير محدود (تخزين مؤقت 5 دقائق) |
| محادثة Concierge | 1,000 طلب/شهر |
| تحويلات الصور (Pro) | 50,000/شهر |
| تحويلات الصور (Enterprise) | غير محدودة |

## مجموعات SDK والتكامل

### HTML (متجاوب مع تنسيق احتياطي)
```html
<picture>
  <source srcset="https://cloudcdn.pro/p/img/logo.avif" type="image/avif">
  <source srcset="https://cloudcdn.pro/p/img/logo.webp" type="image/webp">
  <img src="https://cloudcdn.pro/p/img/logo.png" alt="Logo" width="200" height="200" loading="lazy">
</picture>
```

### HTML (خطة Pro مع تنسيق تلقائي)
```html
<img src="https://cloudcdn.pro/p/img/logo.png?w=200&format=auto" alt="Logo" width="200" height="200">
```

### React
```jsx
function CdnImage({ project, path, alt, width, height, ...props }) {
  const base = `https://cloudcdn.pro/${project}/${path}`;
  return (
    <picture>
      <source srcSet={`${base.replace(/\.\w+$/, '.avif')}`} type="image/avif" />
      <source srcSet={`${base.replace(/\.\w+$/, '.webp')}`} type="image/webp" />
      <img src={base} alt={alt} width={width} height={height} loading="lazy" {...props} />
    </picture>
  );
}
```

### Next.js
```jsx
// next.config.js
module.exports = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'cloudcdn.pro' }],
  },
};

// المكوّن
import Image from 'next/image';
<Image src="https://cloudcdn.pro/المشروع/images/logo.webp" alt="Logo" width={200} height={200} />
```

### CSS
```css
.hero {
  background-image: url('https://cloudcdn.pro/المشروع/images/banners/hero.webp');
  background-image: image-set(
    url('https://cloudcdn.pro/المشروع/images/banners/hero.avif') type('image/avif'),
    url('https://cloudcdn.pro/المشروع/images/banners/hero.webp') type('image/webp')
  );
}
```

### Markdown
```markdown
![Logo](https://cloudcdn.pro/المشروع/images/logos/logo.webp)
```
