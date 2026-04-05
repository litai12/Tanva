# 使用 seedream-5.0-lite

将 `YOUR_API_KEY` 替换为你的密钥即可调用。

## OpenAI 生图 协议

**cURL**
```bash
curl https://tokendance.agent-universe.cn/gateway/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "seedream-5.0-lite",
    "prompt": "A cute baby sea otter wearing a beret",
    "size": "1024x1024",
    "n": 1
  }'
```

**Python**
```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://tokendance.agent-universe.cn/gateway/v1"
)

response = client.images.generate(
    model="seedream-5.0-lite",
    prompt="A cute baby sea otter wearing a beret",
    size="1024x1024",
    n=1,
)
print(response.data[0].url or response.data[0].b64_json[:50])
```

**Node.js**
```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'YOUR_API_KEY',
  baseURL: 'https://tokendance.agent-universe.cn/gateway/v1',
});

const response = await client.images.generate({
  model: 'seedream-5.0-lite',
  prompt: 'A cute baby sea otter wearing a beret',
  size: '1024x1024',
  n: 1,
});
console.log(response.data[0].url || response.data[0].b64_json?.slice(0, 50));
```

## Ark 生图 协议

**cURL**
```bash
curl https://tokendance.agent-universe.cn/gateway/ark/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "seedream-5.0-lite",
    "prompt": "充满活力的特写编辑肖像，模特眼神犀利，头戴雕塑感帽子，色彩拼接丰富，眼部焦点锐利，景深较浅，具有Vogue杂志封面的美学风格，采用中画幅拍摄，工作室灯光效果强烈。",
    "size": "2K",
    "output_format": "png",
    "watermark": false
  }'
```

> 更多参数与用法请参考 [官方文档](https://www.volcengine.com/docs/82379/1541523)
