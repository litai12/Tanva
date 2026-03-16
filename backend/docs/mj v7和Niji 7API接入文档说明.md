本文介绍悠船API提供的各类接口以及示例代码。

悠船开放API提供[图片生成](#8b7869b2e2orl)、[视频生成](#d7bf77cd6e0z4)、[账户管理](#040a0ea160vc1)、[moodboard](#moodboard)4大类接口。

**注意事项**

-   **高级编辑/转绘**：涉及高级编辑或转绘的任务仅支持"高清"操作
    
-   **授权信息**: 每次接口调用均需要API授权信息，具体请参照[授权](https://help.aliyun.com/zh/marketplace/api-authentication)
    
-   **OpenAPI**: OpenAPI格式接口定义文档 [index.yaml](https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250922/qjoqze/index.yaml)
    

**关于悠船开放API接口的调用代码与返回值示例详情，查阅以下链接：**[https://tob.youchuan.cn/docs/apis](https://tob.youchuan.cn/docs/apis)**。**

## **图片生成**

接口分为 **直接生成** 和 **二次编辑** 2类；直接生成是指只需要提供提示词等必须的参数，可以直接生成图片；二次编辑是指需要提供前一个任务ID和图片编号来执行图片生成。

| **接口名称** | **接口地址** | **分类** | **功能描述** |
| --- | --- | --- | --- |
| 文生图 | /v1/tob/diffusion | 直接生成 | 通过文本描述生成图像 |
| 变化  | /v1/tob/variation | 二次编辑 | 生成与原图相似但具有一定变化的图像 |
| 高清  | /v1/tob/upscale | 二次编辑 | 提升图像质量和分辨率 |
| 重新执行任务 | /v1/tob/reroll | 二次编辑 | 使用相同参数重新生成图像 |
| 延展  | /v1/tob/pan | 二次编辑 | 向指定方向延展图像 |
| 扩图  | /v1/tob/outpaint | 二次编辑 | 向所有方向同时扩展图像 |
| 区域重绘 | /v1/tob/inpaint | 二次编辑 | 重新生成图像中的特定区域 |
| 重塑  | /v1/tob/remix | 二次编辑 | 使用新的提示词调整图像 |
| 编辑  | /v1/tob/edit | 二次编辑 | 在画布上编辑现有图像 |
| 高级编辑 | /v1/tob/upload-paint | 直接生成 | 上传图像并进行高级编辑 |
| 转绘  | /v1/tob/retexture | 直接生成 | 改变图像的纹理风格 |
| 移除背景 | /v1/tob/remove-background | 直接生成 | 自动去除图像背景 |
| 增强  | /v1/tob/enhance | 二次编辑 | 增强图片质量,仅支持draft类型任务 |

### **文生图 (Diffusion)**

该接口也可用于**图生图**功能，详情请参考[图片引用](https://help.aliyun.com/zh/marketplace/youchuan-api-advanced-feature-image-reference)。

-   **接口**: `/v1/tob/diffusion`
    
-   **方法**: POST
    
-   **描述**: 通过文本描述生成图像
    
-   **请求参数**:
    
    -   `text`: 文本信息，长度\[1-8192\]（必填）
        
    -   `callback`: 任务结果回调通知接口（可选）
        
-   **错误码**:
    
    -   400: 无效Prompt参数
        
    -   401: 无效App身份
        
    -   402: 账户余额不足
        
    -   403: Prompt包含敏感词汇
        
    -   429: 已达当前套餐最大并发
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/diffusion"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "text": "A beautiful sunset over the mountains",
    "callback": "https://your-callback-url.com"
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/diffusion"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY"
    }
    data := map[string]string{
        "text": "A beautiful sunset over the mountains",
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"text\":\"A beautiful sunset over the mountains\"}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/diffusion"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/diffusion" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "text": "A beautiful sunset over the mountains",
           "callback": "https://your-callback-url.com"
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/diffusion', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    text: 'A beautiful sunset over the mountains',
    callback: 'https://your-callback-url.com'
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **变化 (Variation)**

-   **接口**: `/v1/tob/variation`
    
-   **方法**: POST
    
-   **描述**: 生成与原图相似但具有一定变化的图像
    
-   **请求参数**:
    
    -   `jobId`: 任务ID（必填）
        
    -   `imageNo`: 图片编号(0/1/2/3)（必填）
        
    -   `type`: 变换类型（必填）：0:轻微变换(subtle), 1:强烈变换(strong)
        
    -   `callback`: 任务结果回调通知接口（可选）
        
    -   `remixPrompt`: 新提示词, 长度\[1-8192\]（可选）
        
-   **错误码**:
    
    -   405: 高级编辑/转绘任务仅支持高清
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/variation"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "jobId": "12345",
    "imageNo": 0,
    "type": 1
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/variation"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    data := map[string]interface{}{
        "jobId":   "12345",
        "imageNo": 0,
        "type":    1,
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"jobId\":\"12345\",\"imageNo\":0,\"type\":1}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/variation"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/variation" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "jobId": "12345",
           "imageNo": 0,
           "type": 1
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/variation', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    jobId: '12345',
    imageNo: 0,
    type: 1
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **高清 (Upscale)**

-   **接口**: `/v1/tob/upscale`
    
-   **方法**: POST
    
-   **描述**: 提升图像质量和分辨率
    
-   **请求参数**:
    
    -   `jobId`: 任务ID（必填）
        
    -   `imageNo`: 图片编号(0/1/2/3)（必填）
        
    -   `type`: 高清类型（必填）：0:标准高清, 1:创意高清, 2:v5\_2x, 3:v5\_4x
        
    -   `callback`: 任务结果回调通知接口（可选）
        
-   **错误码**:
    
    -   400: 无效Prompt参数
        
    -   401: 无效App身份
        
    -   402: 账户余额不足
        
    -   403: 高清任务不支持此操作
        
    -   429: 已达当前套餐最大并发
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/upscale"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "jobId": "12345",
    "imageNo": 0,
    "type": 0
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/upscale"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    data := map[string]interface{}{
        "jobId":   "12345",
        "imageNo": 0,
        "type":    0,
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"jobId\":\"12345\",\"imageNo\":0,\"type\":0}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/upscale"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/upscale" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "jobId": "12345",
           "imageNo": 0,
           "type": 0
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/upscale', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    jobId: '12345',
    imageNo: 0,
    type: 0
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **延展 (Pan)**

-   **接口**: `/v1/tob/pan`
    
-   **方法**: POST
    
-   **描述**: 向指定方向延展图像
    
-   **请求参数**:
    
    -   `jobId`: 任务ID（必填）
        
    -   `imageNo`: 图片编号(0/1/2/3)（必填）
        
    -   `direction`: 延展方向（必填）：0:向下(bottom), 1:向右(right), 2:向上(top), 3:向左(left)
        
    -   `scale`: 延展目标比例，取值范围\[1.1-3.0\]（必填）
        
    -   `remixPrompt`: 延展区域提示词, 长度\[1-8192\]（可选）
        
    -   `callback`: 任务结果回调通知接口（可选）
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/pan"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "jobId": "12345",
    "imageNo": 0,
    "direction": 1,
    "scale": 1.5
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/pan"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    data := map[string]interface{}{
        "jobId":    "12345",
        "imageNo":  0,
        "direction": 1,
        "scale":    1.5,
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"jobId\":\"12345\",\"imageNo\":0,\"direction\":1,\"scale\":1.5}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/pan"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/pan" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "jobId": "12345",
           "imageNo": 0,
           "direction": 1,
           "scale": 1.5
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/pan', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    jobId: '12345',
    imageNo: 0,
    direction: 1,
    scale: 1.5
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **扩图 (Outpaint)**

-   **接口**: `/v1/tob/outpaint`
    
-   **方法**: POST
    
-   **描述**: 向所有方向同时扩展图像
    
-   **请求参数**:
    
    -   `jobId`: 任务ID（必填）
        
    -   `imageNo`: 图片编号(0/1/2/3)（必填）
        
    -   `scale`: 扩图目标比例，取值范围\[1.1-2.0\]（必填）
        
    -   `remixPrompt`: 扩图区域提示词, 长度\[1-8192\]（可选）
        
    -   `callback`: 任务结果回调通知接口（可选）
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/outpaint"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "jobId": "12345",
    "imageNo": 0,
    "scale": 1.5
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/outpaint"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    data := map[string]interface{}{
        "jobId":   "12345",
        "imageNo": 0,
        "scale":   1.5,
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"jobId\":\"12345\",\"imageNo\":0,\"scale\":1.5}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/outpaint"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/outpaint" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "jobId": "12345",
           "imageNo": 0,
           "scale": 1.5
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/outpaint', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    jobId: '12345',
    imageNo: 0,
    scale: 1.5
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **区域重绘 (Inpaint)**

-   **接口**: `/v1/tob/inpaint`
    
-   **方法**: POST
    
-   **描述**: 重新生成图像中的特定区域
    
-   **请求参数**:
    
    -   `jobId`: 任务ID（必填）
        
    -   `imageNo`: 图片编号(0/1/2/3)（必填）
        
    -   `mask`: 绘制区域（必填），支持多区域重绘
        
        -   `areas`: 多边形区域(支持指定多个区域)
            
        -   `url`: 以黑白2值图片指定多边形区域(白色区域为重绘区)
            
    -   `remixPrompt`: 重绘区域提示词, 长度\[1-8192\]（可选）
        
    -   `callback`: 任务结果回调通知接口（可选）
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/inpaint"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "jobId": "12345",
    "imageNo": 0,
    "mask": {
        "areas": [{
            "width": 100,
            "height": 100,
            "points": [10,10,10,100,100,100,100,10]
        }]
    },
    "remixPrompt": "Add a tree in the center"
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/inpaint"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    data := map[string]interface{}{
        "jobId":   "12345",
        "imageNo": 0,
        "mask": map[string]interface{}{
            "areas": []map[string]interface{}{
                {
                    "width": 100,
                    "height": 100,
                    "points": []int{10,10,10,100,100,100,100,10},
                },
            },
        },
        "remixPrompt": "Add a tree in the center",
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"jobId\":\"12345\",\"imageNo\":0,\"mask\":{\"areas\":[{\"width\":100,\"height\":100,\"points\":[10,10,10,100,100,100,100,10]}]},\"remixPrompt\":\"Add a tree in the center\"}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/inpaint"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/inpaint" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "jobId": "12345",
           "imageNo": 0,
           "mask": {
             "areas": [{
               "width": 100,
               "height": 100,
               "points": [10,10,10,100,100,100,100,10]
             }]
           },
           "remixPrompt": "Add a tree in the center"
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/inpaint', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    jobId: '12345',
    imageNo: 0,
    mask: {
      areas: [{
        width: 100,
        height: 100,
        points: [10,10,10,100,100,100,100,10]
      }]
    },
    remixPrompt: 'Add a tree in the center'
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **重塑 (Remix)**

-   **接口**: `/v1/tob/remix`
    
-   **方法**: POST
    
-   **描述**: 使用新的提示词调整图像
    
-   **请求参数**:
    
    -   `jobId`: 任务ID（必填）
        
    -   `imageNo`: 图片编号(0/1/2/3)（必填）
        
    -   `remixPrompt`: 新提示词, 长度\[1-8192\]（必填）
        
    -   `mode`: remix模式（可选）：0:强烈调整(strong), 1:细微调整(subtle)，默认为强烈模式
        
    -   `callback`: 任务结果回调通知接口（可选）
        
-   **错误码**:
    
    -   400: 无效Prompt参数
        
    -   401: 无效App身份
        
    -   402: 账户余额不足
        
    -   403: Prompt包含敏感词汇
        
    -   429: 已达当前套餐最大并发
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/remix"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "jobId": "12345",
    "imageNo": 0,
    "remixPrompt": "Change style to watercolor painting",
    "mode": 0
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/remix"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    data := map[string]interface{}{
        "jobId":      "12345",
        "imageNo":    0,
        "remixPrompt": "Change style to watercolor painting",
        "mode":       0,
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"jobId\":\"12345\",\"imageNo\":0,\"remixPrompt\":\"Change style to watercolor painting\",\"mode\":0}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/remix"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/remix" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "jobId": "12345",
           "imageNo": 0,
           "remixPrompt": "Change style to watercolor painting",
           "mode": 0
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/remix', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    jobId: '12345',
    imageNo: 0,
    remixPrompt: 'Change style to watercolor painting',
    mode: 0
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **编辑 (Edit)**

-   **接口**: `/v1/tob/edit`
    
-   **方法**: POST
    
-   **描述**: 在画布上编辑现有图像
    
-   **请求参数**:
    
    -   `jobId`: 任务ID（必填）
        
    -   `imageNo`: 图片编号(0/1/2/3)（必填）
        
    -   `canvas`: 画布对象（必填）
        
        -   `width`: 像素宽
            
        -   `height`: 像素高
            
    -   `imgPos`: 图片相对画布的坐标及大小（必填）
        
        -   `width`: 像素宽
            
        -   `height`: 像素高
            
        -   `x`: 相对画布左上角水平位移
            
        -   `y`: 相对画布左上角垂直位移
            
    -   `remixPrompt`: 提示词（必填）
        
    -   `mask`: 原图重绘区域（可选）
        
    -   `callback`: 任务结果回调通知接口（可选）
        
-   **错误码**:
    
    -   400: 无效Prompt参数
        
    -   401: 无效App身份
        
    -   402: 账户余额不足
        
    -   403: Prompt包含敏感词汇
        
    -   429: 已达当前套餐最大并发
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/edit"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "jobId": "12345",
    "imageNo": 0,
    "canvas": {
        "width": 1024,
        "height": 1024
    },
    "imgPos": {
        "width": 512,
        "height": 512,
        "x": 256,
        "y": 256
    },
    "remixPrompt": "A beautiful landscape with mountains"
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/edit"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    data := map[string]interface{}{
        "jobId":   "12345",
        "imageNo": 0,
        "canvas": map[string]int{
            "width":  1024,
            "height": 1024,
        },
        "imgPos": map[string]int{
            "width":  512,
            "height": 512,
            "x":      256,
            "y":      256,
        },
        "remixPrompt": "A beautiful landscape with mountains",
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"jobId\":\"12345\",\"imageNo\":0,\"canvas\":{\"width\":1024,\"height\":1024},\"imgPos\":{\"width\":512,\"height\":512,\"x\":256,\"y\":256},\"remixPrompt\":\"A beautiful landscape with mountains\"}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/edit"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/edit" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "jobId": "12345",
           "imageNo": 0,
           "canvas": {
             "width": 1024,
             "height": 1024
           },
           "imgPos": {
             "width": 512,
             "height": 512,
             "x": 256,
             "y": 256
           },
           "remixPrompt": "A beautiful landscape with mountains"
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/edit', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    jobId: '12345',
    imageNo: 0,
    canvas: {
      width: 1024,
      height: 1024
    },
    imgPos: {
      width: 512,
      height: 512,
      x: 256,
      y: 256
    },
    remixPrompt: 'A beautiful landscape with mountains'
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **高级编辑 (Uploadpaint)**

-   **接口**: `/v1/tob/upload-paint`
    
-   **方法**: POST
    
-   **描述**: 上传图像并进行高级编辑
    
-   **请求参数**:
    
    -   `imgUrl`: 图片url, 长度\[1-1024\]（必填）
        
    -   `mask`: 原图重绘区域（必填）
        
        -   `areas`: 多边形区域(支持指定多个区域)
            
        -   `url`: 以黑白2值图片指定多边形区域(白色区域为重绘区)
            
    -   `canvas`: 画布对象（必填）
        
        -   `width`: 像素宽
            
        -   `height`: 像素高
            
    -   `imgPos`: 图片相对画布的坐标及大小（必填）
        
        -   `width`: 像素宽
            
        -   `height`: 像素高
            
        -   `x`: 相对画布左上角水平位移
            
        -   `y`: 相对画布左上角垂直位移
            
    -   `remixPrompt`: 提示词（必填）
        
    -   `callback`: 任务结果回调通知接口（可选）
        
-   **错误码**:
    
    -   400: 无效Prompt参数
        
    -   401: 无效App身份
        
    -   402: 账户余额不足
        
    -   403: Prompt包含敏感词汇
        
    -   429: 已达当前套餐最大并发
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/upload-paint"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "imgUrl": "https://example.com/images/sample.jpg",
    "mask": {
        "areas": [{
            "width": 100,
            "height": 100,
            "points": [10,10,10,100,100,100,100,10]
        }]
    },
    "canvas": {
        "width": 1024,
        "height": 1024
    },
    "imgPos": {
        "width": 512,
        "height": 512,
        "x": 256,
        "y": 256
    },
    "remixPrompt": "A beautiful mountain scene with trees"
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/upload-paint"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    data := map[string]interface{}{
        "imgUrl": "https://example.com/images/sample.jpg",
        "mask": map[string]interface{}{
            "areas": []map[string]interface{}{
                {
                    "width": 100,
                    "height": 100,
                    "points": []int{10,10,10,100,100,100,100,10},
                },
            },
        },
        "canvas": map[string]int{
            "width":  1024,
            "height": 1024,
        },
        "imgPos": map[string]int{
            "width":  512,
            "height": 512,
            "x":      256,
            "y":      256,
        },
        "remixPrompt": "A beautiful mountain scene with trees",
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"imgUrl\":\"https://example.com/images/sample.jpg\",\"mask\":{\"areas\":[{\"width\":100,\"height\":100,\"points\":[10,10,10,100,100,100,100,10]}]},\"canvas\":{\"width\":1024,\"height\":1024},\"imgPos\":{\"width\":512,\"height\":512,\"x\":256,\"y\":256},\"remixPrompt\":\"A beautiful mountain scene with trees\"}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/upload-paint"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/upload-paint" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "imgUrl": "https://example.com/images/sample.jpg",
           "mask": {
             "areas": [{
               "width": 100,
               "height": 100,
               "points": [10,10,10,100,100,100,100,10]
             }]
           },
           "canvas": {
             "width": 1024,
             "height": 1024
           },
           "imgPos": {
             "width": 512,
             "height": 512,
             "x": 256,
             "y": 256
           },
           "remixPrompt": "A beautiful mountain scene with trees"
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/upload-paint', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    imgUrl: 'https://example.com/images/sample.jpg',
    mask: {
      areas: [{
        width: 100,
        height: 100,
        points: [10,10,10,100,100,100,100,10]
      }]
    },
    canvas: {
      width: 1024,
      height: 1024
    },
    imgPos: {
      width: 512,
      height: 512,
      x: 256,
      y: 256
    },
    remixPrompt: 'A beautiful mountain scene with trees'
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **转绘 (Retexture)**

-   **接口**: `/v1/tob/retexture`
    
-   **方法**: POST
    
-   **描述**: 改变图像的纹理风格
    
-   **请求参数**:
    
    -   `imgUrl`: 图片url, 长度\[1-1024\]（必填）
        
    -   `remixPrompt`: 提示词，目前只支持6.1及以上的模型（必填）
        
    -   `callback`: 任务结果回调通知接口（可选）
        
-   **错误码**:
    
    -   400: 无效Prompt参数
        
    -   401: 无效App身份
        
    -   402: 账户余额不足
        
    -   403: Prompt包含敏感词汇
        
    -   429: 已达当前套餐最大并发
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/retexture"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "imgUrl": "https://example.com/images/sample.jpg",
    "remixPrompt": "Convert to oil painting style"
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/retexture"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    data := map[string]string{
        "imgUrl":      "https://example.com/images/sample.jpg",
        "remixPrompt": "Convert to oil painting style",
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"imgUrl\":\"https://example.com/images/sample.jpg\",\"remixPrompt\":\"Convert to oil painting style\"}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/retexture"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/retexture" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "imgUrl": "https://example.com/images/sample.jpg",
           "remixPrompt": "Convert to oil painting style"
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/retexture', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    imgUrl: 'https://example.com/images/sample.jpg',
    remixPrompt: 'Convert to oil painting style'
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **移除背景 (Remove Background)**

-   **接口**: `/v1/tob/remove-background`
    
-   **方法**: POST
    
-   **描述**: 自动去除图像背景
    
-   **请求参数**:
    
    -   `imgUrl`: 图片url（必填）
        
    -   `callback`: 任务结果回调通知接口（可选）
        
-   **错误码**:
    
    -   400: 无效参数
        
    -   401: 无效App身份
        
    -   402: 账户余额不足
        
    -   429: 已达当前套餐最大并发
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/remove-background"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "imgUrl": "https://example.com/images/sample.jpg"
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/remove-background"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    data := map[string]string{
        "imgUrl": "https://example.com/images/sample.jpg",
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"imgUrl\":\"https://example.com/images/sample.jpg\"}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/remove-background"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/remove-background" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "imgUrl": "https://example.com/images/sample.jpg"
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/remove-background', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    imgUrl: 'https://example.com/images/sample.jpg'
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **增强 (Enhance)**

-   **接口**: `/v1/tob/enhance`
    
-   **方法**: POST
    
-   **描述**: 增强图片质量(仅支持draft类型任务)
    
-   **请求参数**:
    
    -   `jobId`: 任务ID（必填）
        
    -   `imageNo`: 图片编号(0/1/2/3)（必填）
        
    -   `callback`: 任务结果回调通知接口（可选）
        
-   **错误码**:
    
    -   400: 无效Prompt参数
        
    -   401: 无效App身份
        
    -   402: 账户余额不足
        
    -   403: Prompt包含敏感词汇
        
    -   429: 已达当前套餐最大并发
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/enhance"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "jobId": "12345",
    "imageNo": 0
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/enhance"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    data := map[string]string{
        "jobId": "12345",
        "imageNo": "0"
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"jobId\":\"12345\",\"imageNo\":\"0\"}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/enhance"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/enhance" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "jobId": "12345",
           "imageNo": "0"
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/enhance', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    jobId: '12345',
    imageNo: '0'
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

## **视频生成**

接口用于根据文本描述或图像生成短视频内容，支持多种分辨率和扩展功能，视频功能介绍和提示词的写法请参考[视频功能](https://help.aliyun.com/zh/marketplace/youchuan-api-advanced-feature-video)。

| **接口名称** | **接口地址** | **分类** | **功能描述** |
| --- | --- | --- | --- |
| 图生视频 | /v1/tob/video-diffusion | 直接生成 | 通过文本描述或基于图像生成短视频 |
| 视频延长 | /v1/tob/extend-video | 二次编辑 | 扩展现有视频的时长 |
| 视频高清 | /v1/tob/video-upscale | 二次编辑 | 提升视频质量和分辨率 |

### **图生视频 (Video Diffusion)**

-   **接口**: `/v1/tob/video-diffusion`
    
-   **方法**: POST
    
-   **描述**: 基于图像生成短视频，支持多种分辨率选择。jobId/prompt 二选一
    
-   **请求参数**:
    
    -   `jobId`: 任务ID（可选，用于基于图像生成视频）
        
    -   `imageNo`: 图片编号（0/1/2/3)（当提供jobId时使用）
        
    -   `prompt`: 视频生成提示文本，长度\[1-8192\]（与jobId二选一）
        
    -   `callback`: 任务结果回调通知接口（可选），长度\[1-2048\]
        
    -   `videoType`: 视频分辨率类型（可选）
        
        -   `0`: 480p
            
        -   `1`: 720p
            
-   **错误码**:
    
    -   400: 无效Prompt参数
        
    -   401: 无效App身份
        
    -   402: 账户余额不足
        
    -   403: Prompt包含敏感词汇
        
    -   429: 已达当前套餐最大并发
        
    -   500: 服务器内部错误
        

Python

```
import requests

# 文本生成视频
url = "https://ali.youchuan.cn/v1/tob/video-diffusion"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "prompt": "A beautiful sunset over the ocean with gentle waves",
    "callback": "https://your-callback-url.com"
}

response = requests.post(url, headers=headers, json=data)
print(response.json())

# 基于图像生成视频
data_with_image = {
    "jobId": "existing_job_id",
    "imageNo": 0,
    "prompt": "Make this image move with gentle animation",
    "callback": "https://your-callback-url.com"
}

response = requests.post(url, headers=headers, json=data_with_image)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/video-diffusion"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    
    // 文本生成视频
    data := map[string]interface{}{
        "prompt": "A beautiful sunset over the ocean with gentle waves",
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"prompt\":\"A beautiful sunset over the ocean with gentle waves\"}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/video-diffusion"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
# 文本生成视频
curl -X POST "https://ali.youchuan.cn/v1/tob/video-diffusion" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "prompt": "A beautiful sunset over the ocean with gentle waves",
           "callback": "https://your-callback-url.com"
         }'

# 基于图像生成视频
curl -X POST "https://ali.youchuan.cn/v1/tob/video-diffusion" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "jobId": "existing_job_id",
           "imageNo": 0,
           "prompt": "Make this image move with gentle animation",
           "callback": "https://your-callback-url.com"
         }'
```

JavaScript

```
// 文本生成视频
fetch('https://ali.youchuan.cn/v1/tob/video-diffusion', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    prompt: 'A beautiful sunset over the ocean with gentle waves',
    callback: 'https://your-callback-url.com'
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));

// 基于图像生成视频
fetch('https://ali.youchuan.cn/v1/tob/video-diffusion', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    jobId: 'existing_job_id',
    imageNo: 0,
    prompt: 'Make this image move with gentle animation',
    callback: 'https://your-callback-url.com'
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **视频延长 (Extend Video)**

-   **接口**: `/v1/tob/extend-video`
    
-   **方法**: POST
    
-   **描述**: 扩展现有视频的时长，最多可扩展4次
    
-   **请求参数**:
    
    -   `jobId`: 任务ID（必填）
        
    -   `videoNo`: 视频编号\[0/1/2/3\]（必填）
        
    -   `prompt`: 扩展视频的提示文本，长度\[1-8192\]（必填）
        
    -   `callback`: 任务结果回调通知接口（可选），长度\[1-2048\]
        
-   **错误码**:
    
    -   400: 无效请求参数
        
    -   401: 无效App身份
        
    -   402: 账户余额不足
        
    -   403: Prompt包含敏感词汇
        
    -   405: 视频最多可扩展4次
        
    -   429: 已达当前套餐最大并发
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/extend-video"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "jobId": "existing_job_id",
    "videoNo": 0,
    "prompt": "Continue with more dynamic movement and effects",  # 必填参数
    "callback": "https://your-callback-url.com"
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/extend-video"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    
    data := map[string]interface{}{
        "jobId": "existing_job_id",
        "videoNo": 0,
        "prompt": "Continue with more dynamic movement and effects",  // 必填参数
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"jobId\":\"existing_job_id\",\"videoNo\":0,\"prompt\":\"Continue with more dynamic movement and effects\"}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/extend-video"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/extend-video" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "jobId": "existing_job_id",
           "videoNo": 0,
           "prompt": "Continue with more dynamic movement and effects",
           "callback": "https://your-callback-url.com"
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/extend-video', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    jobId: 'existing_job_id',
    videoNo: 0,
    prompt: 'Continue with more dynamic movement and effects',  // 必填参数
    callback: 'https://your-callback-url.com'
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **视频高清 (Video Upscale)**

-   **接口**: `/v1/tob/video-upscale`
    
-   **方法**: POST
    
-   **描述**: 生成1080P视频
    
-   **请求参数**:
    
    -   `jobId`: 任务ID（必填）
        
    -   `videoNo`: 视频编号\[0/1/2/3\]（必填）
        
    -   `callback`: 任务结果回调通知接口（可选）
        
-   **错误码**:
    
    -   400: 无效Prompt参数
        
    -   401: 无效App身份
        
    -   402: 账户余额不足
        
    -   403: 高清任务不支持此操作
        
    -   429: 已达当前套餐最大并发
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/video-upscale"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "jobId": "existing_job_id",
    "videoNo": 0,
    "type": 0
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/video-upscale"
    headers := map[string]string{
        "x-youchuan-app": "YOUR_APP_ID",
        "x-youchuan-secret": "YOUR_SECRET_KEY",
    }
    data := map[string]interface{}{
        "jobId":   "existing_job_id",
        "videoNo": 0,
        "type":    0,
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    for key, value := range headers {
        req.Header.Set(key, value)
    }
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"jobId\":\"existing_job_id\",\"videoNo\":0,\"type\":0}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/video-upscale"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/video-upscale" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "jobId": "existing_job_id",
           "videoNo": 0,
           "type": 0
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/video-upscale', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    jobId: 'existing_job_id',
    videoNo: 0,
    type: 0
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

## **账户管理**

| **接口名称** | **接口地址** | **分类** | **功能描述** |
| --- | --- | --- | --- |
| 查询任务信息 | /v1/tob/job/{jobId} | 账户管理 | 获取特定任务的详情 |
| 查询任务消耗历史记录 | /v1/tob/costs | 账户管理 | 获取账户的消费历史 |
| 按计费周期列举消耗详情 | /v1/tob/cost-monthly | 账户管理 | 查看月度消费统计 |
| 获取当前账户信息 | /v1/tob/subscribe | 账户管理 | 查询账户订阅状态和资源情况 |
| 任务回调通知演示 | /v1/tob/callback | 账户管理 | 用于测试回调功能 |

### **查询任务信息**

-   **接口**: `/v1/tob/job/{jobId}`
    
-   **方法**: GET
    
-   **描述**: 获取特定任务的详情
    
-   **请求参数**:
    
    -   `jobId`: 任务ID（必填）
        
-   **错误码**:
    
    -   400: 无效参数
        
    -   401: 无效App身份
        
    -   404: 任务不存在
        
    -   500: 服务器内部错误
        

Python

```
import requests

job_id = "12345"
url = f"https://ali.youchuan.cn/v1/tob/job/{job_id}"
headers = {
  "x-youchuan-app": "YOUR_APP_ID",
  "x-youchuan-secret": "YOUR_SECRET_KEY"
}

response = requests.get(url, headers=headers)
print(response.json())
```

Go

```
package main

import (
    "fmt"
    "io/ioutil"
    "net/http"
)

func main() {
    jobId := "12345"
  url := fmt.Sprintf("https://ali.youchuan.cn/v1/tob/job/%s", jobId)

    req, _ := http.NewRequest("GET", url, nil)
  req.Header.Set("x-youchuan-app", "YOUR_APP_ID")
  req.Header.Set("x-youchuan-secret", "YOUR_SECRET_KEY")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()

    body, _ := ioutil.ReadAll(resp.Body)
    fmt.Println(string(body))
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String jobId = "12345";
        HttpRequest request = HttpRequest.newBuilder()
              .uri(URI.create("https://ali.youchuan.cn/v1/tob/job/" + jobId))
              .header("x-youchuan-app", "YOUR_APP_ID")
              .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .GET()
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X GET "https://ali.youchuan.cn/v1/tob/job/12345" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY"
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/job/12345', {
  method: 'GET',
  headers: {
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  }
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **查询任务消耗历史记录**

-   **接口**: `/v1/tob/costs`
    
-   **方法**: GET
    
-   **描述**: 获取账户的消费历史
    
-   **请求参数**:
    
    -   `pageNo`: 页码\[1-1000\]（必填）
        
    -   `pageSize`: 每页数据量\[1-500\]（必填）
        
    -   `since`: 起始时间（可选）
        
    -   `to`: 结束时间（可选）
        
-   **错误码**:
    
    -   400: 无效参数
        
    -   401: 无效App身份
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/costs"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
params = {
    "pageNo": 1,
    "pageSize": 10,
    "since": "2023-01-01T00:00:00Z",
    "to": "2023-12-31T23:59:59Z"
}

response = requests.get(url, headers=headers, params=params)
print(response.json())
```

Go

```
package main

import (
    "fmt"
    "io/ioutil"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/costs?pageNo=1&pageSize=10&since=2023-01-01T00:00:00Z&to=2023-12-31T23:59:59Z"

    req, _ := http.NewRequest("GET", url, nil)
    req.Header.Set("x-youchuan-app", "YOUR_APP_ID")
    req.Header.Set("x-youchuan-secret", "YOUR_SECRET_KEY")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()

    body, _ := ioutil.ReadAll(resp.Body)
    fmt.Println(string(body))
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/costs?pageNo=1&pageSize=10&since=2023-01-01T00:00:00Z&to=2023-12-31T23:59:59Z"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .GET()
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X GET "https://ali.youchuan.cn/v1/tob/costs?pageNo=1&pageSize=10&since=2023-01-01T00:00:00Z&to=2023-12-31T23:59:59Z" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY"
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/costs?pageNo=1&pageSize=10&since=2023-01-01T00:00:00Z&to=2023-12-31T23:59:59Z', {
  method: 'GET',
  headers: {
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  }
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **按计费周期列举消耗详情**

-   **接口**: `/v1/tob/cost-monthly`
    
-   **方法**: GET
    
-   **描述**: 查看月度消费统计
    
-   **请求参数**:
    
    -   `pageNo`: 页码\[1-1000\]（必填）
        
    -   `pageSize`: 每页数据量\[1-500\]（必填）
        
-   **错误码**:
    
    -   400: 无效参数
        
    -   401: 无效App身份
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/cost-monthly"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
params = {
    "pageNo": 1,
    "pageSize": 10
}

response = requests.get(url, headers=headers, params=params)
print(response.json())
```

Go

```
package main

import (
    "fmt"
    "io/ioutil"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/cost-monthly?pageNo=1&pageSize=10"

    req, _ := http.NewRequest("GET", url, nil)
    req.Header.Set("x-youchuan-app", "YOUR_APP_ID")
    req.Header.Set("x-youchuan-secret", "YOUR_SECRET_KEY")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()

    body, _ := ioutil.ReadAll(resp.Body)
    fmt.Println(string(body))
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/cost-monthly?pageNo=1&pageSize=10"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .GET()
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X GET "https://ali.youchuan.cn/v1/tob/cost-monthly?pageNo=1&pageSize=10" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY"
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/cost-monthly?pageNo=1&pageSize=10', {
  method: 'GET',
  headers: {
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  }
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **获取当前账户信息**

-   **接口**: `/v1/tob/subscribe`
    
-   **方法**: GET
    
-   **描述**: 查询账户订阅状态和资源情况
    
-   **请求参数**: 无
    
-   **错误码**:
    
    -   401: 无效App身份
        
    -   403: 无有效套餐
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/subscribe"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}

response = requests.get(url, headers=headers)
print(response.json())
```

Go

```
package main

import (
    "fmt"
    "io/ioutil"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/subscribe"

    req, _ := http.NewRequest("GET", url, nil)
    req.Header.Set("x-youchuan-app", "YOUR_APP_ID")
    req.Header.Set("x-youchuan-secret", "YOUR_SECRET_KEY")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()

    body, _ := ioutil.ReadAll(resp.Body)
    fmt.Println(string(body))
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/subscribe"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .GET()
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X GET "https://ali.youchuan.cn/v1/tob/subscribe" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY"
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/subscribe', {
  method: 'GET',
  headers: {
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  }
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **任务回调通知演示**

-   **接口**: `/v1/tob/callback`
    
-   **方法**: POST
    
-   **描述**: 用于测试回调功能
    
-   **请求参数**:
    
    -   `jobId`: 用于测试的任务信息（必填）
        
-   **错误码**:
    
    -   400: 无效参数
        
    -   401: 无效App身份
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/callback"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "jobId": "12345"
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/callback"
    data := map[string]string{
        "jobId": "12345",
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    req.Header.Set("x-youchuan-app", "YOUR_APP_ID")
    req.Header.Set("x-youchuan-secret", "YOUR_SECRET_KEY")
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"jobId\":\"12345\"}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/callback"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/callback" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "jobId": "12345"
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/callback', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    jobId: '12345'
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

## **moodboard**

灵感收集板(Moodboard)功能允许用户创建和管理图片集合，用于创意项目的视觉参考和灵感收集

| **接口名称** | **接口地址** | **功能描述** |
| --- | --- | --- |
| 创建Moodboard | /v1/tob/moodboard | 创建灵感收集板 |
| 更新Moodboard | /v1/tob/moodboard/{id} | 修改现有的灵感收集板 |
| 获取Moodboard列表 | /v1/tob/moodboards | 查询所有灵感收集板 |

### **创建Moodboard**

-   **接口**: `/v1/tob/moodboard`
    
-   **方法**: POST
    
-   **描述**: 创建灵感收集板
    
-   **请求参数**:
    
    -   `name`: Moodboard名称（必填）
        
    -   `description`: Moodboard描述（可选）
        
    -   `images`: 图片列表（可选）
        
-   **错误码**:
    
    -   400: 无效参数
        
    -   401: 无效App身份
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/moodboard"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "name": "我的创意收集",
    "description": "收集各种风景图片",
    "images": ["https://example.com/image1.jpg", "https://example.com/image2.jpg"]
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/moodboard"
    data := map[string]interface{}{
        "name":        "我的创意收集",
        "description": "收集各种风景图片",
        "images":      []string{"https://example.com/image1.jpg", "https://example.com/image2.jpg"},
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    req.Header.Set("x-youchuan-app", "YOUR_APP_ID")
    req.Header.Set("x-youchuan-secret", "YOUR_SECRET_KEY")
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String json = "{\"name\":\"我的创意收集\",\"description\":\"收集各种风景图片\",\"images\":[\"https://example.com/image1.jpg\",\"https://example.com/image2.jpg\"]}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/moodboard"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X POST "https://ali.youchuan.cn/v1/tob/moodboard" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "name": "我的创意收集",
           "description": "收集各种风景图片",
           "images": ["https://example.com/image1.jpg", "https://example.com/image2.jpg"]
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/moodboard', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    name: '我的创意收集',
    description: '收集各种风景图片',
    images: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg']
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **更新Moodboard**

-   **接口**: `/v1/tob/moodboard/{id}`
    
-   **方法**: PUT
    
-   **描述**: 修改现有的灵感收集板
    
-   **请求参数**:
    
    -   `id`: Moodboard ID（必填）
        
    -   `name`: 新的Moodboard名称（可选）
        
    -   `description`: 新的Moodboard描述（可选）
        
    -   `images`: 更新的图片列表（可选）
        
-   **错误码**:
    
    -   400: 无效参数
        
    -   401: 无效App身份
        
    -   404: Moodboard不存在
        
    -   500: 服务器内部错误
        

Python

```
import requests

moodboard_id = "12345"
url = f"https://ali.youchuan.cn/v1/tob/moodboard/{moodboard_id}"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "name": "更新后的创意收集",
    "description": "更新后的风景图片收集",
    "images": ["https://example.com/new-image1.jpg", "https://example.com/new-image2.jpg"]
}

response = requests.put(url, headers=headers, json=data)
print(response.json())
```

Go

```
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

func main() {
    moodboardId := "12345"
    url := fmt.Sprintf("https://ali.youchuan.cn/v1/tob/moodboard/%s", moodboardId)
    data := map[string]interface{}{
        "name":        "更新后的创意收集",
        "description": "更新后的风景图片收集",
        "images":      []string{"https://example.com/new-image1.jpg", "https://example.com/new-image2.jpg"},
    }
    jsonData, _ := json.Marshal(data)

    req, _ := http.NewRequest("PUT", url, bytes.NewBuffer(jsonData))
    req.Header.Set("x-youchuan-app", "YOUR_APP_ID")
    req.Header.Set("x-youchuan-secret", "YOUR_SECRET_KEY")
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        String moodboardId = "12345";
        String json = "{\"name\":\"更新后的创意收集\",\"description\":\"更新后的风景图片收集\",\"images\":[\"https://example.com/new-image1.jpg\",\"https://example.com/new-image2.jpg\"]}";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/moodboard/" + moodboardId))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X PUT "https://ali.youchuan.cn/v1/tob/moodboard/12345" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{
           "name": "更新后的创意收集",
           "description": "更新后的风景图片收集",
           "images": ["https://example.com/new-image1.jpg", "https://example.com/new-image2.jpg"]
         }'
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/moodboard/12345', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  },
  body: JSON.stringify({
    name: '更新后的创意收集',
    description: '更新后的风景图片收集',
    images: ['https://example.com/new-image1.jpg', 'https://example.com/new-image2.jpg']
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### **获取Moodboard列表**

-   **接口**: `/v1/tob/moodboards`
    
-   **方法**: GET
    
-   **描述**: 查询所有灵感收集板
    
-   **请求参数**:
    
    -   `pageNo`: 页码（可选）
        
    -   `pageSize`: 每页数据量（可选）
        
-   **错误码**:
    
    -   400: 无效参数
        
    -   401: 无效App身份
        
    -   500: 服务器内部错误
        

Python

```
import requests

url = "https://ali.youchuan.cn/v1/tob/moodboards"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
params = {
    "pageNo": 1,
    "pageSize": 10
}

response = requests.get(url, headers=headers, params=params)
print(response.json())
```

Go

```
package main

import (
    "fmt"
    "io/ioutil"
    "net/http"
)

func main() {
    url := "https://ali.youchuan.cn/v1/tob/moodboards?pageNo=1&pageSize=10"

    req, _ := http.NewRequest("GET", url, nil)
    req.Header.Set("x-youchuan-app", "YOUR_APP_ID")
    req.Header.Set("x-youchuan-secret", "YOUR_SECRET_KEY")

    client := &http.Client{}
    resp, _ := client.Do(req)
    defer resp.Body.Close()

    body, _ := ioutil.ReadAll(resp.Body)
    fmt.Println(string(body))
}
```

Java

```
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://ali.youchuan.cn/v1/tob/moodboards?pageNo=1&pageSize=10"))
                .header("x-youchuan-app", "YOUR_APP_ID")
                .header("x-youchuan-secret", "YOUR_SECRET_KEY")
                .GET()
                .build();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
```

curl

```
curl -X GET "https://ali.youchuan.cn/v1/tob/moodboards?pageNo=1&pageSize=10" \
     -H "x-youchuan-app: YOUR_APP_ID" \
     -H "x-youchuan-secret: YOUR_SECRET_KEY"
```

JavaScript

```
fetch('https://ali.youchuan.cn/v1/tob/moodboards?pageNo=1&pageSize=10', {
  method: 'GET',
  headers: {
    'x-youchuan-app': 'YOUR_APP_ID',
    'x-youchuan-secret': 'YOUR_SECRET_KEY'
  }
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

## **错误描述**

接口请求失败时，我们会返回失败信息，示例结构如下:

```
{ "code": 500, "message": "失败详细描述", "reason": "失败原因"}
```

| Code | Reason | Message |
| --- | --- | --- |
| 500 | Internal\\_Server\\_Error | 服务器内部错误 |
| 400 | Invalid\\_Argument | 无效参数 |
| 403 | Permission\\_Denied | 权限不足 |
| 503 | Server\\_Busy | 服务器忙碌 |
| 503 | Request\\_Timout | 请求处理超时 |
| 401 | Invalid\\_App\\_Identifier | 无效App身份 |
| 400 | Invalid\\_Prompt\\_Parameter | 无效Prompt参数 |
| 402 | No\\_More\\_Relax\\_Credit | Relax模式已用完 |
| 403 | Relax\\_Not\\_Allow | 当前套餐不支持Relax模式 |
| 429 | Max\\_Concurrent\\_Limited | 已达当前套餐最大并发 |
| 402 | Account\\_Fee\\_Not\\_Enough | 账户余额不足 |
| 400 | Cancel\\_Job\\_Not\\_Runnig | 无法取消非执行中的任务 |
| 400 | Job\\_ReUpscale\\_Not\\_Support | 高清任务不支持再次高清 |
| 403 | Msg\\_Sensitive | Prompt包含敏感词汇 |
| 403 | Upscale\\_Not\\_Support | 高清任务不支持此操作 |
| 405 | Not\\_Support | 不支持此操作 |
| 403 | No\\_Avaliable\\_Plan | 无有效套餐 |

## **返回值任务状态描述**

调用API接口的返回值中，`comment`字段的内容描述了任务调用状态的详情。

| `**comment**`**字段返回值** | **说明** |
| --- | --- |
| JobStatusCreated | 已创建 |
| JobStatusRunning | 执行中 |
| JobStatusSuccess | 成功  |
| JobStatusFail | 未知错误 |
| JobStatusError | 执行报错 |
| JobStatusReject | 图片审核未通过 |
| JobStatusTextReject | 文本审核未通过（生成失败的任务不消耗任务额度） |
| JobStatusBadPrompt | 提示词格式错误（生成失败的任务不消耗任务额度） |
| JobStatusInvalidParameter | 提示词格式错误，请重试（生成失败的任务不消耗任务额度） |
| JobStatusTimeout | 任务失败（超时） |
| JobStatusRequestTimeout | 任务处理失败（超时） |
| JobStatusInvalidImagePromptLink | 无效图片链接或获取图片超时，请修改链接或重试 |
| JobStatusMaxConcurrentLimited | 您已达到同时任务数上限 |
| JobStatusCreditNotEnough | 您当前任务额度已用完，请升级计划或者购买更多任务额度 |
| JobStatusCanceled | 任务已经取消 |
| JobStatusQueued | 排队中 |
| JobStatusImagePromptDenied | 图片prompt敏感 |
| JobStatusDuplicateImage | 存在重复图片 |