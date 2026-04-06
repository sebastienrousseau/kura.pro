# CloudCDN — API リファレンス

## ベース URL
```
https://cloudcdn.pro
```

## アセット URL の形式
```
https://cloudcdn.pro/{プロジェクト}/images/{カテゴリ}/{ファイル名}.{形式}
```

例:
```
https://cloudcdn.pro/akande/images/banners/banner-akande.webp
```

## 画像変換 API(Pro プラン以上)

任意のアセット URL にクエリパラメータを追加することで、その場で画像を変換できます。

### サイズ変更
| パラメータ | 型 | 説明 | 例 |
|-----------|-----|------|-----|
| `w` | 整数 | ピクセル単位の幅(1-8192) | `?w=800` |
| `h` | 整数 | ピクセル単位の高さ(1-8192) | `?h=600` |
| `fit` | 文字列 | サイズ変更の動作 | `?fit=cover` |

**`fit` モード:**
- `cover` — 指定サイズを満たすようにリサイズし、はみ出した部分はトリミング(デフォルト)
- `contain` — 指定サイズに収まるようにリサイズし、アスペクト比を維持
- `fill` — 指定サイズに引き伸ばし(アスペクト比は無視)
- `inside` — 収まるようにリサイズ、拡大は行わない
- `outside` — 覆うようにリサイズ、縮小は行わない

### 形式変換
| パラメータ | 型 | 説明 | 例 |
|-----------|-----|------|-----|
| `format` | 文字列 | 出力形式 | `?format=auto` |
| `q` | 整数 | 品質(1-100) | `?q=80` |

**`format` の値:**
- `auto` — ブラウザの `Accept` ヘッダーに基づいて AVIF、WebP、またはオリジナルを配信
- `webp` — WebP 出力を強制
- `avif` — AVIF 出力を強制
- `png` — PNG 出力を強制
- `jpeg` — JPEG 出力を強制

### エフェクト
| パラメータ | 型 | 説明 | 例 |
|-----------|-----|------|-----|
| `blur` | 整数 | ガウシアンぼかし(1-250) | `?blur=20` |
| `sharpen` | 整数 | シャープ化(1-10) | `?sharpen=3` |
| `gravity` | 文字列 | トリミングのアンカーポイント | `?gravity=face` |

**`gravity` の値:** `center`、`north`、`south`、`east`、`west`、`northeast`、`northwest`、`southeast`、`southwest`、`face`(AI 検出)。

### パラメータの連結
複数のパラメータを `&` で組み合わせます:
```
https://cloudcdn.pro/project/image.png?w=400&h=300&fit=cover&format=auto&q=75&sharpen=2
```

### LQIP(低品質画像プレースホルダー)
プログレッシブ読み込み用の小さなぼかしプレースホルダーを生成します:
```
https://cloudcdn.pro/project/image.png?w=40&blur=50&q=20
```
これにより約 500 バイトのプレースホルダーが生成され、base64 データ URI としてインライン埋め込みが可能です。

## アセットマニフェスト

### GET /manifest.json
CDN 上のすべてのアセットを JSON 配列で返します。

**レスポンス:**
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

**フィールド:**
| フィールド | 型 | 説明 |
|----------|-----|------|
| `name` | 文字列 | ファイル名 |
| `path` | 文字列 | CDN ルートからの相対パス |
| `project` | 文字列 | プロジェクトディレクトリ名 |
| `category` | 文字列 | サブディレクトリのカテゴリ(banners、icons、logos など) |
| `format` | 文字列 | ファイル拡張子(png、webp、avif、svg、ico) |
| `size` | 整数 | バイト単位のファイルサイズ |

**キャッシュ:** `max-age=300`(5 分)、CORS 有効。

## HTTP ヘッダー

### アセットレスポンス
```
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
Content-Type: image/webp
```

### エラーレスポンス
| ステータス | 意味 |
|----------|------|
| `200` | 成功 |
| `304` | 未変更(条件付きリクエスト) |
| `404` | アセットが見つかりません |
| `429` | レート制限超過(Concierge API のみ) |

## キャッシュパージ(Pro 以上)

### Cloudflare ダッシュボード経由
Workers & Pages → cloudcdn-pro → Caching → Purge by URL。

### API 経由
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"files":["https://cloudcdn.pro/project/image.webp"]}'
```

## レート制限
| エンドポイント | 制限 |
|--------------|------|
| アセット配信 | 無制限(Cloudflare エッジ) |
| Manifest.json | 無制限(5 分キャッシュ) |
| Concierge チャット | 1,000 リクエスト/月 |
| 画像変換(Pro) | 50,000/月 |
| 画像変換(Enterprise) | 無制限 |

## SDK と統合

### HTML(レスポンシブ + 形式フォールバック)
```html
<picture>
  <source srcset="https://cloudcdn.pro/p/img/logo.avif" type="image/avif">
  <source srcset="https://cloudcdn.pro/p/img/logo.webp" type="image/webp">
  <img src="https://cloudcdn.pro/p/img/logo.png" alt="Logo" width="200" height="200" loading="lazy">
</picture>
```

### HTML(Pro プランでの自動形式)
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

// コンポーネント
import Image from 'next/image';
<Image src="https://cloudcdn.pro/project/images/logo.webp" alt="Logo" width={200} height={200} />
```

### CSS
```css
.hero {
  background-image: url('https://cloudcdn.pro/project/images/banners/hero.webp');
  background-image: image-set(
    url('https://cloudcdn.pro/project/images/banners/hero.avif') type('image/avif'),
    url('https://cloudcdn.pro/project/images/banners/hero.webp') type('image/webp')
  );
}
```

### Markdown
```markdown
![Logo](https://cloudcdn.pro/project/images/logos/logo.webp)
```
