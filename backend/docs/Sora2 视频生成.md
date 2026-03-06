> ## Documentation Index
> Fetch the complete documentation index at: https://docs.apimart.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Sora2 视频生成

>  - 异步处理模式，返回任务ID用于后续查询
- 支持文本转视频、图生视频等多种生成模式
- 生成的视频链接，有效期为24小时，请尽快保存 

<RequestExample>
  ```bash cURL theme={null}
  curl --request POST \
    --url https://api.apimart.ai/v1/videos/generations \
    --header 'Authorization: Bearer <token>' \
    --header 'Content-Type: application/json' \
    --data '{
      "model": "sora-2",
      "prompt": "瀑布倾泻而下形成彩虹",
      "duration": 10,
      "aspect_ratio": "16:9",
      "private": false,
      "image_urls": ["https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png"]
    }'
  ```

  ```python Python theme={null}
  import requests

  url = "https://api.apimart.ai/v1/videos/generations"

  payload = {
      "model": "sora-2",
      "prompt": "瀑布倾泻而下形成彩虹",
      "duration": 10,
      "aspect_ratio": "16:9",
      "private": False,
      "image_urls": ["https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png"]
  }

  headers = {
      "Authorization": "Bearer <token>",
      "Content-Type": "application/json"
  }

  response = requests.post(url, json=payload, headers=headers)

  print(response.json())
  ```

  ```javascript JavaScript theme={null}
  const url = "https://api.apimart.ai/v1/videos/generations";

  const payload = {
    model: "sora-2",
    prompt: "瀑布倾泻而下形成彩虹",
    duration: 15,
    aspect_ratio: "16:9",
    private: false,
    image_urls: ["https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png"]
  };

  const headers = {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  };

  fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload)
  })
    .then(response => response.json())
    .then(data => console.log(data))
    .catch(error => console.error('Error:', error));
  ```

  ```go Go theme={null}
  package main

  import (
      "bytes"
      "encoding/json"
      "fmt"
      "io/ioutil"
      "net/http"
  )

  func main() {
      url := "https://api.apimart.ai/v1/videos/generations"

      payload := map[string]interface{}{
          "model":      "sora-2",
          "prompt":     "瀑布倾泻而下形成彩虹",
          "duration":   15,
          "aspect_ratio": "16:9",
          "image_urls":  ["https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png"],
      }

      jsonData, _ := json.Marshal(payload)

      req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
      req.Header.Set("Authorization", "Bearer <token>")
      req.Header.Set("Content-Type", "application/json")

      client := &http.Client{}
      resp, err := client.Do(req)
      if err != nil {
          panic(err)
      }
      defer resp.Body.Close()

      body, _ := ioutil.ReadAll(resp.Body)
      fmt.Println(string(body))
  }
  ```

  ```java Java theme={null}
  import java.net.http.HttpClient;
  import java.net.http.HttpRequest;
  import java.net.http.HttpResponse;
  import java.net.URI;

  public class Main {
      public static void main(String[] args) throws Exception {
          String url = "https://api.apimart.ai/v1/videos/generations";

          String payload = """
          {
            "model": "sora-2",
            "prompt": "瀑布倾泻而下形成彩虹",
            "duration": 10,
            "aspect_ratio": "16:9",
            "image_urls": ["https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png"]
          }
          """;

          HttpClient client = HttpClient.newHttpClient();
          HttpRequest request = HttpRequest.newBuilder()
              .uri(URI.create(url))
              .header("Authorization", "Bearer <token>")
              .header("Content-Type", "application/json")
              .POST(HttpRequest.BodyPublishers.ofString(payload))
              .build();

          HttpResponse<String> response = client.send(request,
              HttpResponse.BodyHandlers.ofString());

          System.out.println(response.body());
      }
  }
  ```

  ```php PHP theme={null}
  <?php

  $url = "https://api.apimart.ai/v1/videos/generations";

  $payload = [
      "model" => "sora-2",
      "prompt" => "瀑布倾泻而下形成彩虹",
      "duration" => 15,
      "aspect_ratio" => "16:9",
      "image_urls" => ["https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png"]
  ];

  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
      "Authorization: Bearer <token>",
      "Content-Type: application/json"
  ]);

  $response = curl_exec($ch);
  curl_close($ch);

  echo $response;
  ?>
  ```

  ```ruby Ruby theme={null}
  require 'net/http'
  require 'json'
  require 'uri'

  url = URI("https://api.apimart.ai/v1/videos/generations")

  payload = {
    model: "sora-2",
    prompt: "瀑布倾泻而下形成彩虹",
    duration: 15,
    aspect_ratio: "16:9",
    image_urls: ["https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png"]
  }

  http = Net::HTTP.new(url.host, url.port)
  http.use_ssl = true

  request = Net::HTTP::Post.new(url)
  request["Authorization"] = "Bearer <token>"
  request["Content-Type"] = "application/json"
  request.body = payload.to_json

  response = http.request(request)
  puts response.body
  ```

  ```swift Swift theme={null}
  import Foundation

  let url = URL(string: "https://api.apimart.ai/v1/videos/generations")!

  let payload: [String: Any] = [
      "model": "sora-2",
      "prompt": "瀑布倾泻而下形成彩虹",
      "duration": 10,
      "aspect_ratio": "16:9",
      "image_urls": ["https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png"]
  ]

  var request = URLRequest(url: url)
  request.httpMethod = "POST"
  request.setValue("Bearer <token>", forHTTPHeaderField: "Authorization")
  request.setValue("application/json", forHTTPHeaderField: "Content-Type")
  request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

  let task = URLSession.shared.dataTask(with: request) { data, response, error in
      if let error = error {
          print("Error: \(error)")
          return
      }
      
      if let data = data, let responseString = String(data: data, encoding: .utf8) {
          print(responseString)
      }
  }

  task.resume()
  ```

  ```csharp C# theme={null}
  using System;
  using System.Net.Http;
  using System.Text;
  using System.Threading.Tasks;

  class Program
  {
      static async Task Main(string[] args)
      {
          var url = "https://api.apimart.ai/v1/videos/generations";

          var payload = @"{
              ""model"": ""sora-2"",
              ""prompt"": ""瀑布倾泻而下形成彩虹"",
              ""duration"": 15,
              ""aspect_ratio"": ""16:9"",
              ""image_urls"": [""https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png""]
          }";

          using var client = new HttpClient();
          client.DefaultRequestHeaders.Add("Authorization", "Bearer <token>");

          var content = new StringContent(payload, Encoding.UTF8, "application/json");
          var response = await client.PostAsync(url, content);
          var result = await response.Content.ReadAsStringAsync();

          Console.WriteLine(result);
      }
  }
  ```

  ```c C theme={null}
  #include <stdio.h>
  #include <curl/curl.h>

  int main(void) {
      CURL *curl;
      CURLcode res;

      curl_global_init(CURL_GLOBAL_DEFAULT);
      curl = curl_easy_init();

      if(curl) {
          const char *url = "https://api.apimart.ai/v1/videos/generations";
          const char *payload = "{"
              "\"model\":\"sora-2\","
              "\"prompt\":\"瀑布倾泻而下形成彩虹\","
              "\"duration\":15,"
              "\"aspect_ratio\":\"16:9\","
              "\"image_urls\":[\"https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png\"]"
          "}";

          struct curl_slist *headers = NULL;
          headers = curl_slist_append(headers, "Authorization: Bearer <token>");
          headers = curl_slist_append(headers, "Content-Type: application/json");

          curl_easy_setopt(curl, CURLOPT_URL, url);
          curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload);
          curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

          res = curl_easy_perform(curl);

          if(res != CURLE_OK) {
              fprintf(stderr, "curl_easy_perform() failed: %s\n",
                      curl_easy_strerror(res));
          }

          curl_slist_free_all(headers);
          curl_easy_cleanup(curl);
      }

      curl_global_cleanup();
      return 0;
  }
  ```

  ```objectivec Objective-C theme={null}
  #import <Foundation/Foundation.h>

  int main(int argc, const char * argv[]) {
      @autoreleasepool {
          NSURL *url = [NSURL URLWithString:@"https://api.apimart.ai/v1/videos/generations"];
          
          NSDictionary *payload = @{
              @"model": @"sora-2",
              @"prompt": @"瀑布倾泻而下形成彩虹",
              @"duration": @15,
              @"aspect_ratio": @"16:9",
              @"image_urls": @[@"https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png"]
          };
          
          NSError *error;
          NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload
                                                            options:0
                                                              error:&error];
          
          NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
          [request setHTTPMethod:@"POST"];
          [request setValue:@"Bearer <token>" forHTTPHeaderField:@"Authorization"];
          [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
          [request setHTTPBody:jsonData];
          
          NSURLSessionDataTask *task = [[NSURLSession sharedSession] 
              dataTaskWithRequest:request
              completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
                  if (error) {
                      NSLog(@"Error: %@", error);
                      return;
                  }
                  NSString *result = [[NSString alloc] initWithData:data 
                                                          encoding:NSUTF8StringEncoding];
                  NSLog(@"%@", result);
              }];
          
          [task resume];
          [[NSRunLoop mainRunLoop] run];
      }
      return 0;
  }
  ```

  ```ocaml OCaml theme={null}
  (* Requires cohttp and yojson libraries *)
  open Lwt
  open Cohttp
  open Cohttp_lwt_unix

  let url = "https://api.apimart.ai/v1/videos/generations"

  let payload = {|{
    "model": "sora-2",
    "prompt": "瀑布倾泻而下形成彩虹",
    "duration": 10,
          "aspect_ratio": "16:9",
            "image_urls": ["https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png"]
  }|}

  let () =
    let headers = Header.init ()
      |> fun h -> Header.add h "Authorization" "Bearer <token>"
      |> fun h -> Header.add h "Content-Type" "application/json"
    in
    let body = Cohttp_lwt.Body.of_string payload in
    
    let response = Client.post ~headers ~body (Uri.of_string url) >>= fun (resp, body) ->
      body |> Cohttp_lwt.Body.to_string >|= fun body_str ->
      print_endline body_str
    in
    Lwt_main.run response
  ```

  ```dart Dart theme={null}
  import 'dart:convert';
  import 'package:http/http.dart' as http;

  void main() async {
    final url = Uri.parse('https://api.apimart.ai/v1/videos/generations');
    
    final payload = {
      'model': 'sora-2',
      'prompt': '瀑布倾泻而下形成彩虹',
      'duration': 15,
      'aspect_ratio': '16:9',
      'image_urls': ['https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png']
    };
    
    final response = await http.post(
      url,
      headers: {
        'Authorization': 'Bearer <token>',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(payload),
    );
    
    print(response.body);
  }
  ```

  ```r R theme={null}
  library(httr)
  library(jsonlite)

  url <- "https://api.apimart.ai/v1/videos/generations"

  payload <- list(
    model = "sora-2",
    prompt = "瀑布倾泻而下形成彩虹",
    duration = 15,
    aspect_ratio = "16:9",
    image_urls = c("https://cdn.apimart.ai/doc/9998238782946594-f62f70ce-348c-4b13-bb5f-15f17bee676b-image_task_01K88BEGZHVJWJ3ZV6HY99SWQR_0.png")
  )

  response <- POST(
    url,
    add_headers(
      Authorization = "Bearer <token>",
      `Content-Type` = "application/json"
    ),
    body = toJSON(payload, auto_unbox = TRUE),
    encode = "raw"
  )

  cat(content(response, "text"))
  ```
</RequestExample>

<ResponseExample>
  ```json 200 theme={null}
  {
    "code": 200,
    "data": [
      {
        "status": "submitted",
        "task_id": "task_01K8SGYNNNVBQTXNR4MM964S7K"
      }
    ]
  }
  ```

  ```json 400 theme={null}
  {
    "error": {
      "code": 400,
      "message": "请求参数无效",
      "type": "invalid_request_error"
    }
  }
  ```

  ```json 401 theme={null}
  {
    "error": {
      "code": 401,
      "message": "身份验证失败，请检查您的API密钥",
      "type": "authentication_error"
    }
  }
  ```

  ```json 402 theme={null}
  {
    "error": {
      "code": 402,
      "message": "账户余额不足，请充值后再试",
      "type": "payment_required"
    }
  }
  ```

  ```json 403 theme={null}
  {
    "error": {
      "code": 403,
      "message": "访问被禁止，您没有权限访问此资源",
      "type": "permission_error"
    }
  }
  ```

  ```json 429 theme={null}
  {
    "error": {
      "code": 429,
      "message": "请求过于频繁，请稍后再试",
      "type": "rate_limit_error"
    }
  }
  ```

  ```json 500 theme={null}
  {
    "error": {
      "code": 500,
      "message": "服务器内部错误，请稍后重试",
      "type": "server_error"
    }
  }
  ```

  ```json 502 theme={null}
  {
    "error": {
      "code": 502,
      "message": "网关错误，服务器暂时不可用",
      "type": "bad_gateway"
    }
  }
  ```
</ResponseExample>

## Authorizations

<ParamField header="Authorization" type="string" required>
  所有接口均需要使用Bearer Token进行认证

  获取 API Key：

  访问 [API Key 管理页面](https://apimart.ai/console/token) 获取您的 API Key

  使用时在请求头中添加：

  ```
  Authorization: Bearer YOUR_API_KEY
  ```
</ParamField>

## Body

<ParamField body="model" type="string" default="sora-2" required>
  视频生成模型名称

  支持的模型：

  * `sora-2` - 标准版本
  * `sora-2-vip` - VIP版本，sora-2升级版
  * `sora-2-pro` - 专业版本，支持更长时长

  示例：`"sora-2"` 或 `"sora-2-vip"` 或 `"sora-2-pro"`
</ParamField>

<ParamField body="prompt" type="string" required>
  视频生成的文本描述

  **💡 @角色引用功能：**

  可以在 prompt 中使用 `@username` 格式引用已创建的角色，让该角色出现在生成的视频中。

  * 角色的 `username` 可通过[查询角色接口](/cn/api-reference/videos/sora-2/query-character)获取
  * 支持同时引用多个角色

  示例：`"小猫和小狗一起开汽车 @duksvfkf.cruisingki @zdqwahgj.baronbarki"`
</ParamField>

<ParamField body="duration" type="integer">
  视频时长（秒）

  * `sora-2`：支持 10 或 15 秒
  * `sora-2-pro`：支持 10 秒（高清）、15 秒（高清）或 25 秒

  示例：`10`
</ParamField>

<ParamField body="aspect_ratio" type="string">
  视频分辨率

  支持的格式：

  * `16:9` (横屏)
  * `9:16` (竖屏)
</ParamField>

<ParamField body="image_urls" type="array<url>">
  用于图生视频的参考图像 URL 数组

  支持公网可访问的图片 URL（http\:// 或 https\://）

  示例：`["https://example.com/image.jpg"]`

  **限制：**

  * 最大文件大小：10MB
  * 支持格式：.jpeg、.jpg、.png、.webp
</ParamField>

<ParamField body="watermark" type="boolean" default="false">
  是否在生成的视频中添加水印

  * `false`：不添加水印
  * `true`：在视频中添加Sora官方水印

  默认值：`false`
</ParamField>

<ParamField body="thumbnail" type="boolean">
  是否生成视频缩略图

  * `true`：生成视频缩略图，方便预览和展示

  **⚠️ 注意：** 缩略图仅保存1小时，如有需要请联系管理员

  如不需要生成缩略图，可省略此参数
</ParamField>

<ParamField body="private" type="boolean" default="false">
  是否开启隐私模式

  * `true`：视频不会发布，同时视频无法进行 remix 操作（二次编辑）
  * `false`：视频可以发布和进行 remix 操作

  默认值：`false`
</ParamField>

<ParamField body="style" type="string">
  视频风格

  支持的值：

  * `thanksgiving` - 感恩节风格
  * `comic` - 漫画风格
  * `news` - 新闻风格
  * `selfie` - 自拍风格
  * `nostalgic` - 复古风格
  * `anime` - 动漫风格

  示例：`"anime"`
</ParamField>

<ParamField body="storyboard" type="boolean">
  是否使用故事板实现更精细的视频生成细节控制

  * `true`：启用故事板功能
  * `false`：不使用故事板

  示例：`true`
</ParamField>

<ParamField body="character_url" type="string">
  参考视频里的角色 URL

  用于在生成的视频中复用参考视频中的角色

  示例：`"https://filesystem.site/cdn/20251030/javYrU4etHVFDqg8by7mViTWHlMOZy.mp4"`

  **⚠️ 注意：** 使用此参数时，生成的视频时长会减少 1 秒
</ParamField>

<ParamField body="character_timestamps" type="string">
  角色出现的时间戳

  指定参考视频中角色出现的时间范围，只支持 2 秒的时间段

  格式：`"起始秒,结束秒"`

  示例：`"1,3"` 表示参考视频中第 1 秒到第 3 秒的角色

  **⚠️ 注意：** 使用此参数时，生成的视频时长会减少 1 秒
</ParamField>

## Response

<ResponseField name="code" type="integer">
  响应状态码，成功时为 200
</ResponseField>

<ResponseField name="data" type="array">
  返回数据数组

  <Expandable title="数组元素">
    <ResponseField name="status" type="string">
      任务状态，初始提交时为 `submitted`
    </ResponseField>
    <ResponseField name="task_id" type="string">
      任务唯一标识符，用于查询任务状态和结果
    </ResponseField>
  </Expandable>
</ResponseField>
