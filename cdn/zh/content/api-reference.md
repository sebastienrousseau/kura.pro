# CloudCDN — API 参考

## 基础 URL
```
https://cloudcdn.pro
```

## 资源 URL 格式
```
https://cloudcdn.pro/{项目}/images/{类别}/{文件名}.{格式}
```

示例：
```
https://cloudcdn.pro/akande/images/banners/banner-akande.webp
```

## 图片转换 API（Pro 套餐及以上）

为任意资源 URL 添加查询参数即可实时转换图片。

### 调整尺寸
| 参数 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `w` | 整数 | 宽度（像素，1-8192） | `?w=800` |
| `h` | 整数 | 高度（像素，1-8192） | `?h=600` |
| `fit` | 字符串 | 缩放行为 | `?fit=cover` |

**`fit` 模式：**
- `cover` — 缩放以填满指定尺寸，裁剪多余部分（默认）
- `contain` — 缩放以适应尺寸并保持宽高比
- `fill` — 拉伸到精确尺寸（忽略宽高比）
- `inside` — 缩放以适应，但绝不放大
- `outside` — 缩放以覆盖，但绝不缩小

### 格式转换
| 参数 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `format` | 字符串 | 输出格式 | `?format=auto` |
| `q` | 整数 | 质量（1-100） | `?q=80` |

**`format` 取值：**
- `auto` — 根据浏览器的 `Accept` 头返回 AVIF、WebP 或原始格式
- `webp` — 强制输出 WebP
- `avif` — 强制输出 AVIF
- `png` — 强制输出 PNG
- `jpeg` — 强制输出 JPEG

### 效果
| 参数 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `blur` | 整数 | 高斯模糊（1-250） | `?blur=20` |
| `sharpen` | 整数 | 锐化（1-10） | `?sharpen=3` |
| `gravity` | 字符串 | 裁剪锚点 | `?gravity=face` |

**`gravity` 取值：** `center`、`north`、`south`、`east`、`west`、`northeast`、`northwest`、`southeast`、`southwest`、`face`（AI 检测）。

### 参数链式组合
使用 `&` 组合多个参数：
```
https://cloudcdn.pro/项目/image.png?w=400&h=300&fit=cover&format=auto&q=75&sharpen=2
```

### LQIP（低质量图片占位符）
为渐进式加载生成小型模糊占位图：
```
https://cloudcdn.pro/项目/image.png?w=40&blur=50&q=20
```
这会生成约 500 字节的占位图，可作为 base64 数据 URI 内联嵌入。

## 资源清单

### GET /manifest.json
返回 CDN 中所有资源的 JSON 数组。

**响应：**
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

**字段：**
| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | 字符串 | 文件名 |
| `path` | 字符串 | 相对于 CDN 根目录的完整路径 |
| `project` | 字符串 | 项目目录名 |
| `category` | 字符串 | 子目录类别（banners、icons、logos 等） |
| `format` | 字符串 | 文件扩展名（png、webp、avif、svg、ico） |
| `size` | 整数 | 文件大小（字节） |

**缓存：** `max-age=300`（5 分钟），已启用 CORS。

## HTTP 头

### 资源响应
```
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
Content-Type: image/webp
```

### 错误响应
| 状态 | 含义 |
|------|------|
| `200` | 成功 |
| `304` | 未修改（条件请求） |
| `404` | 资源未找到 |
| `429` | 速率限制超出（仅 Concierge API） |

## 缓存清除（Pro 及以上）

### 通过 Cloudflare 控制台
Workers & Pages → cloudcdn-pro → Caching → Purge by URL。

### 通过 API
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"files":["https://cloudcdn.pro/项目/image.webp"]}'
```

## 速率限制
| 端点 | 限制 |
|------|------|
| 资源分发 | 无限制（Cloudflare 边缘） |
| Manifest.json | 无限制（5 分钟缓存） |
| Concierge 聊天 | 1,000 次请求/月 |
| 图片转换（Pro） | 50,000 次/月 |
| 图片转换（Enterprise） | 无限制 |

## SDK 与集成

### HTML（带格式回退的响应式）
```html
<picture>
  <source srcset="https://cloudcdn.pro/p/img/logo.avif" type="image/avif">
  <source srcset="https://cloudcdn.pro/p/img/logo.webp" type="image/webp">
  <img src="https://cloudcdn.pro/p/img/logo.png" alt="Logo" width="200" height="200" loading="lazy">
</picture>
```

### HTML（Pro 套餐自动格式）
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

// 组件
import Image from 'next/image';
<Image src="https://cloudcdn.pro/项目/images/logo.webp" alt="Logo" width={200} height={200} />
```

### CSS
```css
.hero {
  background-image: url('https://cloudcdn.pro/项目/images/banners/hero.webp');
  background-image: image-set(
    url('https://cloudcdn.pro/项目/images/banners/hero.avif') type('image/avif'),
    url('https://cloudcdn.pro/项目/images/banners/hero.webp') type('image/webp')
  );
}
```

### Markdown
```markdown
![Logo](https://cloudcdn.pro/项目/images/logos/logo.webp)
```
